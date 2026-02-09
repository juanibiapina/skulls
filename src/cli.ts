#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { basename, join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { runAdd, parseAddOptions, initTelemetry } from './add.ts';
import { runFind } from './find.ts';
import { runList } from './list.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { track } from './telemetry.ts';
import { fetchSkillFolderHash, getGitHubToken } from './skill-lock.ts';
import { DEFAULT_SKILLS_DIR } from './constants.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const VERSION = getVersion();
initTelemetry(VERSION);

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';

function showHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} skulls <command> [options]

${BOLD}Commands:${RESET}
  add <package>     Add a skill package
                    e.g. vercel-labs/agent-skills
                         https://github.com/vercel-labs/agent-skills
  remove [skills]   Remove installed skills
  list, ls          List installed skills
  find [query]      Search for skills interactively
  init [name]       Initialize a skill (creates <name>/SKILL.md or ./SKILL.md)
  check             Check for available skill updates
  update            Update all skills to latest versions

${BOLD}Add Options:${RESET}
  -d, --target-dir <dir>  Install to a specific directory (default: ${DEFAULT_SKILLS_DIR})
  -s, --skill <skills>    Specify skill names to install (use '*' for all skills)
  -l, --list              List available skills in the repository without installing
  -y, --yes               Skip confirmation prompts
  --all                   Shorthand for --skill '*' -y
  --full-depth            Search all subdirectories even when a root SKILL.md exists

${BOLD}Remove Options:${RESET}
  -d, --target-dir <dir>  Target directory (default: ${DEFAULT_SKILLS_DIR})
  -y, --yes               Skip confirmation prompts
  --all                   Remove all skills

${BOLD}List Options:${RESET}
  -d, --target-dir <dir>  Target directory (default: ${DEFAULT_SKILLS_DIR})

${BOLD}Options:${RESET}
  --help, -h        Show this help message
  --version, -v     Show version number

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} skulls                              ${DIM}# interactive search${RESET}
  ${DIM}$${RESET} skulls add vercel-labs/agent-skills
  ${DIM}$${RESET} skulls add vercel-labs/agent-skills --skill pr-review commit
  ${DIM}$${RESET} skulls remove                       ${DIM}# interactive remove${RESET}
  ${DIM}$${RESET} skulls remove web-design
  ${DIM}$${RESET} skulls list
  ${DIM}$${RESET} skulls find typescript
  ${DIM}$${RESET} skulls init my-skill
  ${DIM}$${RESET} skulls check
  ${DIM}$${RESET} skulls update

Discover more skills at ${TEXT}https://skills.sh/${RESET}
`);
}

function showRemoveHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} skulls remove [skills...] [options]

${BOLD}Description:${RESET}
  Remove installed skills. If no skill names are provided,
  an interactive selection menu will be shown.

${BOLD}Arguments:${RESET}
  skills            Optional skill names to remove (space-separated)

${BOLD}Options:${RESET}
  -d, --target-dir <dir>  Target directory (default: ${DEFAULT_SKILLS_DIR})
  -y, --yes               Skip confirmation prompts
  --all                   Remove all skills

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} skulls remove                       ${DIM}# interactive selection${RESET}
  ${DIM}$${RESET} skulls remove my-skill
  ${DIM}$${RESET} skulls remove skill1 skill2 -y
  ${DIM}$${RESET} skulls remove --all

Discover more skills at ${TEXT}https://skills.sh/${RESET}
`);
}

function runInit(args: string[]): void {
  const cwd = process.cwd();
  const skillName = args[0] || basename(cwd);
  const hasName = args[0] !== undefined;

  const skillDir = hasName ? join(cwd, skillName) : cwd;
  const skillFile = join(skillDir, 'SKILL.md');
  const displayPath = hasName ? `${skillName}/SKILL.md` : 'SKILL.md';

  if (existsSync(skillFile)) {
    console.log(`${TEXT}Skill already exists at ${DIM}${displayPath}${RESET}`);
    return;
  }

  if (hasName) {
    mkdirSync(skillDir, { recursive: true });
  }

  const skillContent = `---
name: ${skillName}
description: A brief description of what this skill does
---

# ${skillName}

Instructions for the agent to follow when this skill is activated.

## When to use

Describe when this skill should be used.

## Instructions

1. First step
2. Second step
3. Additional steps as needed
`;

  writeFileSync(skillFile, skillContent);

  console.log(`${TEXT}Initialized skill: ${DIM}${skillName}${RESET}`);
  console.log();
  console.log(`${DIM}Created:${RESET}`);
  console.log(`  ${displayPath}`);
  console.log();
  console.log(`${DIM}Next steps:${RESET}`);
  console.log(`  1. Edit ${TEXT}${displayPath}${RESET} to define your skill instructions`);
  console.log(
    `  2. Update the ${TEXT}name${RESET} and ${TEXT}description${RESET} in the frontmatter`
  );
  console.log();
  console.log(`${DIM}Publishing:${RESET}`);
  console.log(
    `  ${DIM}GitHub:${RESET}  Push to a repo, then ${TEXT}npx @juanibiapina/skulls add <owner>/<repo>${RESET}`
  );
  console.log(
    `  ${DIM}URL:${RESET}     Host the file, then ${TEXT}npx @juanibiapina/skulls add https://example.com/${displayPath}${RESET}`
  );
  console.log();
  console.log(`Browse existing skills for inspiration at ${TEXT}https://skills.sh/${RESET}`);
  console.log();
}

// ============================================
// Check and Update Commands
// ============================================

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.skill-lock.json';
const CURRENT_LOCK_VERSION = 3;

interface SkillLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  skillPath?: string;
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

interface SkillLockFile {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

function getSkillLockPath(): string {
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

function readSkillLock(): SkillLockFile {
  const lockPath = getSkillLockPath();
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;
    if (typeof parsed.version !== 'number' || !parsed.skills) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    if (parsed.version < CURRENT_LOCK_VERSION) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    return parsed;
  } catch {
    return { version: CURRENT_LOCK_VERSION, skills: {} };
  }
}

function writeSkillLock(lock: SkillLockFile): void {
  const lockPath = getSkillLockPath();
  const dir = join(homedir(), AGENTS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
}

async function runCheck(args: string[] = []): Promise<void> {
  console.log(`${TEXT}Checking for skill updates...${RESET}`);
  console.log();

  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length === 0) {
    console.log(`${DIM}No skills tracked in lock file.${RESET}`);
    console.log(`${DIM}Install skills with${RESET} ${TEXT}npx @juanibiapina/skulls add <package>${RESET}`);
    return;
  }

  const token = getGitHubToken();

  const skillsBySource = new Map<string, Array<{ name: string; entry: SkillLockEntry }>>();
  let skippedCount = 0;

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    if (entry.sourceType !== 'github' || !entry.skillFolderHash || !entry.skillPath) {
      skippedCount++;
      continue;
    }

    const existing = skillsBySource.get(entry.source) || [];
    existing.push({ name: skillName, entry });
    skillsBySource.set(entry.source, existing);
  }

  const totalSkills = skillNames.length - skippedCount;
  if (totalSkills === 0) {
    console.log(`${DIM}No GitHub skills to check.${RESET}`);
    return;
  }

  console.log(`${DIM}Checking ${totalSkills} skill(s) for updates...${RESET}`);

  const updates: Array<{ name: string; source: string }> = [];
  const errors: Array<{ name: string; source: string; error: string }> = [];

  for (const [source, skills] of skillsBySource) {
    for (const { name, entry } of skills) {
      try {
        const latestHash = await fetchSkillFolderHash(source, entry.skillPath!, token);

        if (!latestHash) {
          errors.push({ name, source, error: 'Could not fetch from GitHub' });
          continue;
        }

        if (latestHash !== entry.skillFolderHash) {
          updates.push({ name, source });
        }
      } catch (err) {
        errors.push({
          name,
          source,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }

  console.log();

  if (updates.length === 0) {
    console.log(`${TEXT}✓ All skills are up to date${RESET}`);
  } else {
    console.log(`${TEXT}${updates.length} update(s) available:${RESET}`);
    console.log();
    for (const update of updates) {
      console.log(`  ${TEXT}↑${RESET} ${update.name}`);
      console.log(`    ${DIM}source: ${update.source}${RESET}`);
    }
    console.log();
    console.log(
      `${DIM}Run${RESET} ${TEXT}npx @juanibiapina/skulls update${RESET} ${DIM}to update all skills${RESET}`
    );
  }

  if (errors.length > 0) {
    console.log();
    console.log(`${DIM}Could not check ${errors.length} skill(s) (may need reinstall)${RESET}`);
  }

  track({
    event: 'check',
    skillCount: String(totalSkills),
    updatesAvailable: String(updates.length),
  });

  console.log();
}

async function runUpdate(): Promise<void> {
  console.log(`${TEXT}Checking for skill updates...${RESET}`);
  console.log();

  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length === 0) {
    console.log(`${DIM}No skills tracked in lock file.${RESET}`);
    console.log(`${DIM}Install skills with${RESET} ${TEXT}npx @juanibiapina/skulls add <package>${RESET}`);
    return;
  }

  const token = getGitHubToken();

  const updates: Array<{ name: string; source: string; entry: SkillLockEntry }> = [];
  let checkedCount = 0;

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    if (entry.sourceType !== 'github' || !entry.skillFolderHash || !entry.skillPath) {
      continue;
    }

    checkedCount++;

    try {
      const latestHash = await fetchSkillFolderHash(entry.source, entry.skillPath, token);

      if (latestHash && latestHash !== entry.skillFolderHash) {
        updates.push({ name: skillName, source: entry.source, entry });
      }
    } catch {
      // Skip skills that fail to check
    }
  }

  if (checkedCount === 0) {
    console.log(`${DIM}No skills to check.${RESET}`);
    return;
  }

  if (updates.length === 0) {
    console.log(`${TEXT}✓ All skills are up to date${RESET}`);
    console.log();
    return;
  }

  console.log(`${TEXT}Found ${updates.length} update(s)${RESET}`);
  console.log();

  let successCount = 0;
  let failCount = 0;

  for (const update of updates) {
    console.log(`${TEXT}Updating ${update.name}...${RESET}`);

    let installUrl = update.entry.sourceUrl;
    if (update.entry.skillPath) {
      let skillFolder = update.entry.skillPath;
      if (skillFolder.endsWith('/SKILL.md')) {
        skillFolder = skillFolder.slice(0, -9);
      } else if (skillFolder.endsWith('SKILL.md')) {
        skillFolder = skillFolder.slice(0, -8);
      }
      if (skillFolder.endsWith('/')) {
        skillFolder = skillFolder.slice(0, -1);
      }

      installUrl = update.entry.sourceUrl.replace(/\.git$/, '').replace(/\/$/, '');
      installUrl = `${installUrl}/tree/main/${skillFolder}`;
    }

    const result = spawnSync('npx', ['-y', '@juanibiapina/skulls', 'add', installUrl, '-y'], {
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    if (result.status === 0) {
      successCount++;
      console.log(`  ${TEXT}✓${RESET} Updated ${update.name}`);
    } else {
      failCount++;
      console.log(`  ${DIM}✗ Failed to update ${update.name}${RESET}`);
    }
  }

  console.log();
  if (successCount > 0) {
    console.log(`${TEXT}✓ Updated ${successCount} skill(s)${RESET}`);
  }
  if (failCount > 0) {
    console.log(`${DIM}Failed to update ${failCount} skill(s)${RESET}`);
  }

  track({
    event: 'update',
    skillCount: String(updates.length),
    successCount: String(successCount),
    failCount: String(failCount),
  });

  console.log();
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // No args → interactive find
  if (args.length === 0) {
    await runFind([]);
    return;
  }

  const command = args[0];
  const restArgs = args.slice(1);

  switch (command) {
    case 'find':
    case 'search':
    case 'f':
    case 's':
      await runFind(restArgs);
      break;
    case 'init':
      runInit(restArgs);
      break;
    case 'i':
    case 'install':
    case 'a':
    case 'add': {
      const { source, options } = parseAddOptions(restArgs);
      await runAdd(source, options);
      break;
    }
    case 'remove':
    case 'rm':
    case 'r':
      if (restArgs.includes('--help') || restArgs.includes('-h')) {
        showRemoveHelp();
        break;
      }
      const { skills, options: removeOptions } = parseRemoveOptions(restArgs);
      await removeCommand(skills, removeOptions);
      break;
    case 'list':
    case 'ls':
      await runList(restArgs);
      break;
    case 'check':
      runCheck(restArgs);
      break;
    case 'update':
    case 'upgrade':
      runUpdate();
      break;
    case '--help':
    case '-h':
      showHelp();
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;

    default:
      console.log(`Unknown command: ${command}`);
      console.log(`Run ${BOLD}skulls --help${RESET} for usage.`);
  }
}

main();
