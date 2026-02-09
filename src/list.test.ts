import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import { parseListOptions } from './list.ts';

describe('list command', () => {
  let testDir: string;
  let skillsDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skulls-list-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    skillsDir = join(testDir, 'skills');
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('parseListOptions', () => {
    it('should parse empty args', () => {
      const options = parseListOptions([]);
      expect(options).toEqual({});
    });

    it('should parse -d flag', () => {
      const options = parseListOptions(['-d', '/tmp/skills']);
      expect(options.targetDir).toBe('/tmp/skills');
    });

    it('should parse --target-dir flag', () => {
      const options = parseListOptions(['--target-dir', '/tmp/skills']);
      expect(options.targetDir).toBe('/tmp/skills');
    });
  });

  describe('CLI integration', () => {
    it('should show message when no skills found', () => {
      const result = runCli(['list', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('No skills found');
      expect(result.exitCode).toBe(0);
    });

    it('should run ls alias', () => {
      const result = runCli(['ls', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('No skills found');
      expect(result.exitCode).toBe(0);
    });

    it('should list skills', () => {
      const skillDir = join(skillsDir, 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill for listing
---

# Test Skill

This is a test skill.
`
      );

      const result = runCli(['list', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.stdout).toContain('Installed Skills');
      expect(result.exitCode).toBe(0);
    });

    it('should list multiple skills', () => {
      const skill1Dir = join(skillsDir, 'skill-one');
      const skill2Dir = join(skillsDir, 'skill-two');
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

      const result = runCli(['list', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('Installed Skills');
      expect(result.exitCode).toBe(0);
    });

    it('should ignore directories without SKILL.md', () => {
      const validDir = join(skillsDir, 'valid-skill');
      mkdirSync(validDir, { recursive: true });
      writeFileSync(
        join(validDir, 'SKILL.md'),
        `---
name: valid-skill
description: Valid skill
---
# Valid
`
      );

      const invalidDir = join(skillsDir, 'invalid-skill');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'README.md'), '# Not a skill');

      const result = runCli(['list', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('valid-skill');
      expect(result.stdout).not.toContain('invalid-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should handle SKILL.md with missing frontmatter', () => {
      const validDir = join(skillsDir, 'valid-skill');
      mkdirSync(validDir, { recursive: true });
      writeFileSync(
        join(validDir, 'SKILL.md'),
        `---
name: valid-skill
description: Valid skill
---
# Valid
`
      );

      const invalidDir = join(skillsDir, 'invalid-skill');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'SKILL.md'), '# Invalid\nNo frontmatter here');

      const result = runCli(['list', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('valid-skill');
      expect(result.stdout).not.toContain('invalid-skill');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('help output', () => {
    it('should include list command in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('list, ls');
      expect(result.stdout).toContain('List installed skills');
    });
  });
});
