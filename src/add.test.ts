import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import { shouldInstallInternalSkills } from './skills.ts';
import { parseAddOptions } from './add.ts';

describe('add command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skulls-add-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should show error when no source provided', () => {
    const result = runCli(['add'], testDir);
    expect(result.stdout).toContain('ERROR');
    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('should show error for non-existent local path', () => {
    const result = runCli(['add', './non-existent-path'], testDir);
    expect(result.stdout).toContain('Local path does not exist');
    expect(result.exitCode).toBe(1);
  });

  it('should list skills from local path with --list flag', () => {
    const skillDir = join(testDir, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: test-skill
description: A test skill for testing
---

# Test Skill

This is a test skill.
`
    );

    const result = runCli(['add', testDir, '--list'], testDir);
    expect(result.stdout).toContain('test-skill');
    expect(result.stdout).toContain('A test skill for testing');
    expect(result.exitCode).toBe(0);
  });

  it('should show no skills found for empty directory', () => {
    const result = runCli(['add', testDir], testDir);
    expect(result.stdout).toContain('No skills found');
    expect(result.stdout).toContain('No valid skills found');
    expect(result.exitCode).toBe(1);
  });

  it('should install skill from local path with -y flag', () => {
    const skillDir = join(testDir, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: my-skill
description: My test skill
---

# My Skill

Instructions here.
`
    );

    const targetDir = join(testDir, 'target-skills');
    mkdirSync(targetDir, { recursive: true });

    const result = runCli(['add', testDir, '-d', targetDir], testDir);
    expect(result.stdout).toContain('my-skill');
    expect(result.stdout).toContain('Done!');
    expect(result.exitCode).toBe(0);
  });

  it('should filter skills by name with --skill flag', () => {
    const skill1Dir = join(testDir, 'skills', 'skill-one');
    const skill2Dir = join(testDir, 'skills', 'skill-two');
    mkdirSync(skill1Dir, { recursive: true });
    mkdirSync(skill2Dir, { recursive: true });

    writeFileSync(
      join(skill1Dir, 'SKILL.md'),
      `---
name: skill-one
description: First skill
---
# Skill One
`
    );

    writeFileSync(
      join(skill2Dir, 'SKILL.md'),
      `---
name: skill-two
description: Second skill
---
# Skill Two
`
    );

    const result = runCli(['add', testDir, '--list', '--skill', 'skill-one'], testDir);
    expect(result.stdout).toContain('skill-one');
  });

  it('should support add command aliases (a, i, install)', () => {
    const resultA = runCli(['a'], testDir);
    const resultI = runCli(['i'], testDir);
    const resultInstall = runCli(['install'], testDir);

    expect(resultA.stdout).toContain('Missing required argument: source');
    expect(resultI.stdout).toContain('Missing required argument: source');
    expect(resultInstall.stdout).toContain('Missing required argument: source');
  });

  describe('internal skills', () => {
    it('should skip internal skills by default', () => {
      const skillDir = join(testDir, 'internal-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: internal-skill
description: An internal skill
metadata:
  internal: true
---

# Internal Skill

This is an internal skill.
`
      );

      const result = runCli(['add', testDir, '--list'], testDir);
      expect(result.stdout).not.toContain('internal-skill');
    });

    it('should show internal skills when INSTALL_INTERNAL_SKILLS=1', () => {
      const skillDir = join(testDir, 'internal-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: internal-skill
description: An internal skill
metadata:
  internal: true
---

# Internal Skill

This is an internal skill.
`
      );

      const result = runCli(['add', testDir, '--list'], testDir, {
        INSTALL_INTERNAL_SKILLS: '1',
      });
      expect(result.stdout).toContain('internal-skill');
      expect(result.stdout).toContain('An internal skill');
    });

    it('should not treat metadata.internal: false as internal', () => {
      const skillDir = join(testDir, 'not-internal-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: not-internal-skill
description: Explicitly not internal
metadata:
  internal: false
---
# Not Internal
`
      );

      const result = runCli(['add', testDir, '--list'], testDir);
      expect(result.stdout).toContain('not-internal-skill');
    });
  });
});

describe('shouldInstallInternalSkills', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return false when INSTALL_INTERNAL_SKILLS is not set', () => {
    delete process.env.INSTALL_INTERNAL_SKILLS;
    expect(shouldInstallInternalSkills()).toBe(false);
  });

  it('should return true when INSTALL_INTERNAL_SKILLS=1', () => {
    process.env.INSTALL_INTERNAL_SKILLS = '1';
    expect(shouldInstallInternalSkills()).toBe(true);
  });

  it('should return true when INSTALL_INTERNAL_SKILLS=true', () => {
    process.env.INSTALL_INTERNAL_SKILLS = 'true';
    expect(shouldInstallInternalSkills()).toBe(true);
  });

  it('should return false for other values', () => {
    process.env.INSTALL_INTERNAL_SKILLS = '0';
    expect(shouldInstallInternalSkills()).toBe(false);

    process.env.INSTALL_INTERNAL_SKILLS = 'false';
    expect(shouldInstallInternalSkills()).toBe(false);

    process.env.INSTALL_INTERNAL_SKILLS = 'yes';
    expect(shouldInstallInternalSkills()).toBe(false);
  });
});

describe('parseAddOptions', () => {
  it('should parse --all flag', () => {
    const result = parseAddOptions(['source', '--all']);
    expect(result.source).toEqual(['source']);
    expect(result.options.all).toBe(true);
  });

  it('should parse --skill with wildcard', () => {
    const result = parseAddOptions(['source', '--skill', '*']);
    expect(result.source).toEqual(['source']);
    expect(result.options.skill).toEqual(['*']);
  });

  it('should parse --skill wildcard', () => {
    const result = parseAddOptions(['source', '--skill', '*']);
    expect(result.source).toEqual(['source']);
    expect(result.options.skill).toEqual(['*']);
  });

  it('should parse combined flags with wildcards', () => {
    const result = parseAddOptions(['source', '--skill', '*']);
    expect(result.source).toEqual(['source']);
    expect(result.options.skill).toEqual(['*']);
  });

  it('should parse --full-depth flag', () => {
    const result = parseAddOptions(['source', '--full-depth']);
    expect(result.source).toEqual(['source']);
    expect(result.options.fullDepth).toBe(true);
  });

  it('should parse --target-dir flag', () => {
    const result = parseAddOptions(['source', '--target-dir', '/tmp/skills']);
    expect(result.source).toEqual(['source']);
    expect(result.options.targetDir).toBe('/tmp/skills');
  });

  it('should parse -d flag', () => {
    const result = parseAddOptions(['source', '-d', '/tmp/skills']);
    expect(result.source).toEqual(['source']);
    expect(result.options.targetDir).toBe('/tmp/skills');
  });

  it('should parse --full-depth with other flags', () => {
    const result = parseAddOptions(['source', '--full-depth', '--list']);
    expect(result.source).toEqual(['source']);
    expect(result.options.fullDepth).toBe(true);
    expect(result.options.list).toBe(true);
  });
});
