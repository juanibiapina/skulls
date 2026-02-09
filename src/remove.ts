import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, rm } from 'fs/promises';
import { join } from 'path';
import { track } from './telemetry.ts';
import { removeSkillFromLock, getSkillFromLock } from './skill-lock.ts';
import { getInstallPath } from './installer.ts';
import { DEFAULT_SKILLS_DIR } from './constants.ts';

export interface RemoveOptions {
  all?: boolean;
  targetDir?: string;
}

export async function removeCommand(skillNames: string[], options: RemoveOptions) {
  const targetDir = options.targetDir || DEFAULT_SKILLS_DIR;

  const spinner = p.spinner();

  spinner.start('Scanning for installed skills...');
  const skillNamesSet = new Set<string>();

  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        skillNamesSet.add(entry.name);
      }
    }
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code !== 'ENOENT') {
      p.log.warn(`Could not scan directory ${targetDir}: ${err.message}`);
    }
  }

  const installedSkills = Array.from(skillNamesSet).sort();
  spinner.stop(`Found ${installedSkills.length} installed skill(s)`);

  if (installedSkills.length === 0) {
    p.outro(pc.yellow('No skills found to remove.'));
    return;
  }

  let selectedSkills: string[] = [];

  if (options.all) {
    selectedSkills = installedSkills;
  } else if (skillNames.length > 0) {
    selectedSkills = installedSkills.filter((s) =>
      skillNames.some((name) => name.toLowerCase() === s.toLowerCase())
    );

    if (selectedSkills.length === 0) {
      p.log.error(`No matching skills found for: ${skillNames.join(', ')}`);
      return;
    }
  } else {
    const choices = installedSkills.map((s) => ({
      value: s,
      label: s,
    }));

    const selected = await p.multiselect({
      message: `Select skills to remove ${pc.dim('(space to toggle)')}`,
      options: choices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }

    selectedSkills = selected as string[];
  }

  spinner.start('Removing skills...');

  const results: {
    skill: string;
    success: boolean;
    source?: string;
    sourceType?: string;
    error?: string;
  }[] = [];

  for (const skillName of selectedSkills) {
    try {
      const skillPath = getInstallPath(skillName, targetDir);
      await rm(skillPath, { recursive: true, force: true });

      const lockEntry = await getSkillFromLock(skillName);
      const effectiveSource = lockEntry?.source || 'local';
      const effectiveSourceType = lockEntry?.sourceType || 'local';

      await removeSkillFromLock(skillName);

      results.push({
        skill: skillName,
        success: true,
        source: effectiveSource,
        sourceType: effectiveSourceType,
      });
    } catch (err) {
      results.push({
        skill: skillName,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  spinner.stop('Removal process complete');

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track removal
  if (successful.length > 0) {
    const bySource = new Map<string, { skills: string[]; sourceType?: string }>();

    for (const r of successful) {
      const source = r.source || 'local';
      const existing = bySource.get(source) || { skills: [] };
      existing.skills.push(r.skill);
      existing.sourceType = r.sourceType;
      bySource.set(source, existing);
    }

    for (const [source, data] of bySource) {
      track({
        event: 'remove',
        source,
        skills: data.skills.join(','),
        agents: 'skulls',
        sourceType: data.sourceType,
      });
    }
  }

  if (successful.length > 0) {
    p.log.success(pc.green(`Successfully removed ${successful.length} skill(s)`));
  }

  if (failed.length > 0) {
    p.log.error(pc.red(`Failed to remove ${failed.length} skill(s)`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill}: ${r.error}`);
    }
  }

  console.log();
  p.outro(pc.green('Done!'));
}

/**
 * Parse command line options for the remove command.
 */
export function parseRemoveOptions(args: string[]): { skills: string[]; options: RemoveOptions } {
  const options: RemoveOptions = {};
  const skills: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--all') {
      options.all = true;
    } else if (arg === '-d' || arg === '--target-dir') {
      i++;
      options.targetDir = args[i];
    } else if (arg && !arg.startsWith('-')) {
      skills.push(arg);
    }
  }

  return { skills, options };
}
