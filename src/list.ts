import { homedir } from 'os';
import { listInstalledSkills, type InstalledSkill } from './installer.ts';
import { DEFAULT_SKILLS_DIR } from './constants.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const CYAN = '\x1b[36m';

interface ListOptions {
  targetDir?: string;
}

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 */
function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  if (fullPath.startsWith(home)) {
    return fullPath.replace(home, '~');
  }
  if (fullPath.startsWith(cwd)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

export function parseListOptions(args: string[]): ListOptions {
  const options: ListOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-d' || arg === '--target-dir') {
      i++;
      options.targetDir = args[i];
    }
  }

  return options;
}

export async function runList(args: string[]): Promise<void> {
  const options = parseListOptions(args);
  const targetDir = options.targetDir || DEFAULT_SKILLS_DIR;

  const installedSkills = await listInstalledSkills(targetDir);

  const cwd = process.cwd();

  if (installedSkills.length === 0) {
    const shortTarget = shortenPath(targetDir, cwd);
    console.log(`${DIM}No skills found in ${shortTarget}${RESET}`);
    console.log(
      `${DIM}Install skills with${RESET} ${TEXT}npx @juanibiapina/skulls add <package>${RESET}`
    );
    return;
  }

  function printSkill(skill: InstalledSkill): void {
    const shortPath = shortenPath(skill.path, cwd);
    console.log(`${CYAN}${skill.name}${RESET} ${DIM}${shortPath}${RESET}`);
  }

  const shortTarget = shortenPath(targetDir, cwd);
  console.log(`${BOLD}Installed Skills${RESET} ${DIM}(${shortTarget})${RESET}`);
  console.log();
  for (const skill of installedSkills) {
    printSkill(skill);
  }
  console.log();
}
