import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';

describe('remove command', () => {
  let testDir: string;
  let skillsDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skulls-remove-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    skillsDir = join(testDir, 'skills');
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createTestSkill(name: string, description?: string) {
    const skillDir = join(skillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: ${name}
description: ${description || `A test skill called ${name}`}
---

# ${name}

This is a test skill.
`
    );
  }

  describe('with no skills installed', () => {
    it('should show message when no skills found', () => {
      const result = runCli(['remove', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('No skills found');
      expect(result.stdout).toContain('to remove');
      expect(result.exitCode).toBe(0);
    });

    it('should show error for non-existent skill name', () => {
      const result = runCli(['remove', 'non-existent-skill', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('No skills found');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('with skills installed', () => {
    beforeEach(() => {
      createTestSkill('skill-one', 'First test skill');
      createTestSkill('skill-two', 'Second test skill');
      createTestSkill('skill-three', 'Third test skill');
    });

    it('should remove specific skill by name with -y flag', () => {
      const result = runCli(['remove', 'skill-one', '-d', skillsDir], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('1 skill');

      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(true);
      expect(existsSync(join(skillsDir, 'skill-three'))).toBe(true);
    });

    it('should remove multiple skills by name', () => {
      const result = runCli(['remove', 'skill-one', 'skill-two', '-d', skillsDir], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('2 skill');

      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-three'))).toBe(true);
    });

    it('should remove all skills with --all flag', () => {
      const result = runCli(['remove', '--all', '-d', skillsDir], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('3 skill');

      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-three'))).toBe(false);
    });

    it('should show error for non-existent skill name when skills exist', () => {
      const result = runCli(['remove', 'non-existent', '-d', skillsDir], testDir);

      expect(result.stdout).toContain('No matching skills');
      expect(result.exitCode).toBe(0);
    });

    it('should be case-insensitive when matching skill names', () => {
      const result = runCli(['remove', 'SKILL-ONE', '-d', skillsDir], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);
    });

    it('should remove skills without confirmation', () => {
      const result = runCli(['remove', 'skill-one', 'skill-two', '-d', skillsDir], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(false);
    });
  });

  describe('command aliases', () => {
    beforeEach(() => {
      createTestSkill('alias-test-skill');
    });

    it('should support "rm" alias', () => {
      const result = runCli(['rm', 'alias-test-skill', '-y', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);
    });

    it('should support "r" alias', () => {
      const result = runCli(['r', 'alias-test-skill', '-y', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle skill names with special characters', () => {
      createTestSkill('skill-with-dashes');
      createTestSkill('skill_with_underscores');

      const result = runCli(['remove', 'skill-with-dashes', '-y', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(skillsDir, 'skill-with-dashes'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill_with_underscores'))).toBe(true);
    });

    it('should handle removing last remaining skill', () => {
      createTestSkill('last-skill');

      const result = runCli(['remove', 'last-skill', '-y', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('1 skill');

      const remaining = readdirSync(skillsDir);
      expect(remaining.length).toBe(0);
    });
  });

  describe('help and info', () => {
    it('should show help with --help', () => {
      const result = runCli(['remove', '--help'], testDir);
      expect(result.stdout).toContain('Usage');
      expect(result.stdout).toContain('remove');
      expect(result.stdout).toContain('--target-dir');
      expect(result.stdout).not.toContain('--yes');
      expect(result.exitCode).toBe(0);
    });

    it('should show help with -h', () => {
      const result = runCli(['remove', '-h'], testDir);
      expect(result.stdout).toContain('Usage');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('option parsing', () => {
    beforeEach(() => {
      createTestSkill('parse-test-skill');
    });

    it('should parse -d as target-dir', () => {
      const result = runCli(['remove', 'parse-test-skill', '-d', skillsDir], testDir);
      expect(result.stdout).toContain('Successfully removed');
    });
  });
});
