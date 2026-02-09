import { mkdir, cp, access, readdir, rm, writeFile, stat } from 'fs/promises';
import { join, basename, normalize, resolve, sep, dirname } from 'path';
import type { Skill, RemoteSkill } from './types.ts';
import type { WellKnownSkill } from './providers/wellknown.ts';
import { DEFAULT_SKILLS_DIR } from './constants.ts';
import { parseSkillMd } from './skills.ts';

interface InstallResult {
  success: boolean;
  path: string;
  error?: string;
}

/**
 * Sanitizes a filename/directory name to prevent path traversal attacks
 * and ensures it follows kebab-case convention
 */
export function sanitizeName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '');

  return sanitized.substring(0, 255) || 'unnamed-skill';
}

/**
 * Validates that a path is within an expected base directory
 */
function isPathSafe(basePath: string, targetPath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));

  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

/**
 * Cleans and recreates a directory for skill installation.
 */
async function cleanAndCreateDirectory(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
  await mkdir(path, { recursive: true });
}

const EXCLUDE_FILES = new Set(['README.md', 'metadata.json']);
const EXCLUDE_DIRS = new Set(['.git']);

const isExcluded = (name: string, isDirectory: boolean = false): boolean => {
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.startsWith('_')) return true;
  if (isDirectory && EXCLUDE_DIRS.has(name)) return true;
  return false;
};

async function copyDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => !isExcluded(entry.name, entry.isDirectory()))
      .map(async (entry) => {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);

        if (entry.isDirectory()) {
          await copyDirectory(srcPath, destPath);
        } else {
          await cp(srcPath, destPath, {
            dereference: true,
            recursive: true,
          });
        }
      })
  );
}

/**
 * Install a skill from a local directory (cloned repo or local path) to the target directory.
 */
export async function installSkill(
  skill: Skill,
  targetDir: string = DEFAULT_SKILLS_DIR
): Promise<InstallResult> {
  const rawSkillName = skill.name || basename(skill.path);
  const skillName = sanitizeName(rawSkillName);
  const installDir = join(targetDir, skillName);

  if (!isPathSafe(targetDir, installDir)) {
    return {
      success: false,
      path: installDir,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    await cleanAndCreateDirectory(installDir);
    await copyDirectory(skill.path, installDir);

    return {
      success: true,
      path: installDir,
    };
  } catch (error) {
    return {
      success: false,
      path: installDir,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install a remote skill (single SKILL.md content) to the target directory.
 */
export async function installRemoteSkill(
  skill: RemoteSkill,
  targetDir: string = DEFAULT_SKILLS_DIR
): Promise<InstallResult> {
  const skillName = sanitizeName(skill.installName);
  const installDir = join(targetDir, skillName);

  if (!isPathSafe(targetDir, installDir)) {
    return {
      success: false,
      path: installDir,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    await cleanAndCreateDirectory(installDir);
    const skillMdPath = join(installDir, 'SKILL.md');
    await writeFile(skillMdPath, skill.content, 'utf-8');

    return {
      success: true,
      path: installDir,
    };
  } catch (error) {
    return {
      success: false,
      path: installDir,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install a well-known skill with multiple files to the target directory.
 */
export async function installWellKnownSkill(
  skill: WellKnownSkill,
  targetDir: string = DEFAULT_SKILLS_DIR
): Promise<InstallResult> {
  const skillName = sanitizeName(skill.installName);
  const installDir = join(targetDir, skillName);

  if (!isPathSafe(targetDir, installDir)) {
    return {
      success: false,
      path: installDir,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    await cleanAndCreateDirectory(installDir);

    for (const [filePath, content] of skill.files) {
      const fullPath = join(installDir, filePath);
      if (!isPathSafe(installDir, fullPath)) {
        continue; // Skip files that would escape the directory
      }

      const parentDir = dirname(fullPath);
      if (parentDir !== installDir) {
        await mkdir(parentDir, { recursive: true });
      }

      await writeFile(fullPath, content, 'utf-8');
    }

    return {
      success: true,
      path: installDir,
    };
  } catch (error) {
    return {
      success: false,
      path: installDir,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if a skill is installed in the target directory.
 */
export async function isSkillInstalled(
  skillName: string,
  targetDir: string = DEFAULT_SKILLS_DIR
): Promise<boolean> {
  const sanitized = sanitizeName(skillName);
  const skillDir = join(targetDir, sanitized);

  if (!isPathSafe(targetDir, skillDir)) {
    return false;
  }

  try {
    await access(skillDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the install path for a skill.
 */
export function getInstallPath(skillName: string, targetDir: string = DEFAULT_SKILLS_DIR): string {
  const sanitized = sanitizeName(skillName);
  const installPath = join(targetDir, sanitized);

  if (!isPathSafe(targetDir, installPath)) {
    throw new Error('Invalid skill name: potential path traversal detected');
  }

  return installPath;
}

export interface InstalledSkill {
  name: string;
  description: string;
  path: string;
}

/**
 * Lists all installed skills in the target directory.
 */
export async function listInstalledSkills(
  targetDir: string = DEFAULT_SKILLS_DIR
): Promise<InstalledSkill[]> {
  const skills: InstalledSkill[] = [];

  try {
    const entries = await readdir(targetDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDir = join(targetDir, entry.name);
      const skillMdPath = join(skillDir, 'SKILL.md');

      try {
        await stat(skillMdPath);
      } catch {
        continue;
      }

      const skill = await parseSkillMd(skillMdPath);
      if (!skill) {
        continue;
      }

      skills.push({
        name: skill.name,
        description: skill.description,
        path: skillDir,
      });
    }
  } catch {
    // Directory doesn't exist
  }

  return skills;
}
