/**
 * Tests for the simplified installer (copy-only, single target directory).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkill, listInstalledSkills } from '../src/installer.ts';

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  const skillMd = `---\nname: ${name}\ndescription: test\n---\n`;
  await writeFile(join(dir, 'SKILL.md'), skillMd, 'utf-8');
  return dir;
}

describe('installSkill', () => {
  let root: string;
  let targetDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'skulls-test-'));
    targetDir = join(root, 'skills');
    await mkdir(targetDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('copies skill files to target directory', async () => {
    const skillName = 'test-skill';
    const skillDir = await makeSkillSource(root, skillName);

    const result = await installSkill(
      { name: skillName, description: 'test', path: skillDir },
      targetDir
    );

    expect(result.success).toBe(true);

    const installedPath = join(targetDir, skillName);
    const stats = await stat(installedPath);
    expect(stats.isDirectory()).toBe(true);

    const contents = await readFile(join(installedPath, 'SKILL.md'), 'utf-8');
    expect(contents).toContain(`name: ${skillName}`);
  });

  it('overwrites existing skill on reinstall', async () => {
    const skillName = 'overwrite-skill';
    const skillDir = await makeSkillSource(root, skillName);

    // Install once
    await installSkill({ name: skillName, description: 'test', path: skillDir }, targetDir);

    // Update the source
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: updated\n---\n`,
      'utf-8'
    );

    // Install again
    const result = await installSkill(
      { name: skillName, description: 'updated', path: skillDir },
      targetDir
    );

    expect(result.success).toBe(true);

    const contents = await readFile(join(targetDir, skillName, 'SKILL.md'), 'utf-8');
    expect(contents).toContain('description: updated');
  });

  it('sanitizes skill name for directory', async () => {
    const skillDir = await makeSkillSource(root, 'test');

    const result = await installSkill(
      { name: 'My Cool Skill!', description: 'test', path: skillDir },
      targetDir
    );

    expect(result.success).toBe(true);
    // Name should be sanitized to kebab-case (trailing ! stripped as hyphen then trimmed)
    expect(result.path).toContain('my-cool-skill');
  });
});

describe('listInstalledSkills', () => {
  let root: string;
  let targetDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'skulls-test-'));
    targetDir = join(root, 'skills');
    await mkdir(targetDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function createSkillDir(
    skillName: string,
    skillData: { name: string; description: string }
  ): Promise<string> {
    const skillDir = join(targetDir, skillName);
    await mkdir(skillDir, { recursive: true });
    const skillMdContent = `---
name: ${skillData.name}
description: ${skillData.description}
---

# ${skillData.name}

${skillData.description}
`;
    await writeFile(join(skillDir, 'SKILL.md'), skillMdContent);
    return skillDir;
  }

  it('should return empty array for empty directory', async () => {
    const skills = await listInstalledSkills(targetDir);
    expect(skills).toEqual([]);
  });

  it('should find single skill', async () => {
    await createSkillDir('test-skill', {
      name: 'test-skill',
      description: 'A test skill',
    });

    const skills = await listInstalledSkills(targetDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('test-skill');
    expect(skills[0]!.description).toBe('A test skill');
  });

  it('should find multiple skills', async () => {
    await createSkillDir('skill-1', {
      name: 'skill-1',
      description: 'First skill',
    });
    await createSkillDir('skill-2', {
      name: 'skill-2',
      description: 'Second skill',
    });

    const skills = await listInstalledSkills(targetDir);
    expect(skills).toHaveLength(2);
    const skillNames = skills.map((s) => s.name).sort();
    expect(skillNames).toEqual(['skill-1', 'skill-2']);
  });

  it('should ignore directories without SKILL.md', async () => {
    await createSkillDir('valid-skill', {
      name: 'valid-skill',
      description: 'Valid skill',
    });

    const invalidDir = join(targetDir, 'invalid-skill');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'other-file.txt'), 'content');

    const skills = await listInstalledSkills(targetDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('valid-skill');
  });

  it('should handle invalid SKILL.md gracefully', async () => {
    await createSkillDir('valid-skill', {
      name: 'valid-skill',
      description: 'Valid skill',
    });

    const invalidDir = join(targetDir, 'invalid-skill');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'SKILL.md'), '# Invalid\nNo frontmatter');

    const skills = await listInstalledSkills(targetDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('valid-skill');
  });

  it('should return empty array for non-existent directory', async () => {
    const skills = await listInstalledSkills(join(root, 'non-existent'));
    expect(skills).toEqual([]);
  });
});
