import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { sep } from 'path';
import { parseSource, getOwnerRepo, parseOwnerRepo, isRepoPrivate } from './source-parser.ts';

/**
 * Check if a source identifier (owner/repo format) represents a private GitHub repo.
 */
async function isSourcePrivate(source: string): Promise<boolean | null> {
  const ownerRepo = parseOwnerRepo(source);
  if (!ownerRepo) {
    return false;
  }
  return isRepoPrivate(ownerRepo.owner, ownerRepo.repo);
}
import { cloneRepo, cleanupTempDir, GitCloneError } from './git.ts';
import { discoverSkills, getSkillDisplayName, filterSkills } from './skills.ts';
import {
  installSkill,
  installRemoteSkill,
  installWellKnownSkill,
  isSkillInstalled,
} from './installer.ts';
import { track, setVersion } from './telemetry.ts';
import { findProvider, wellKnownProvider, type WellKnownSkill } from './providers/index.ts';
import { fetchMintlifySkill } from './mintlify.ts';
import { addSkillToLock, fetchSkillFolderHash } from './skill-lock.ts';
import type { Skill, RemoteSkill } from './types.ts';
import { DEFAULT_SKILLS_DIR } from './constants.ts';
import packageJson from '../package.json' with { type: 'json' };

export function initTelemetry(version: string): void {
  setVersion(version);
}

const version = packageJson.version;
setVersion(version);

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 */
function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  if (fullPath === home || fullPath.startsWith(home + sep)) {
    return '~' + fullPath.slice(home.length);
  }
  if (fullPath === cwd || fullPath.startsWith(cwd + sep)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

export interface AddOptions {
  yes?: boolean;
  skill?: string[];
  list?: boolean;
  all?: boolean;
  fullDepth?: boolean;
  targetDir?: string;
}

/**
 * Resolve the target directory for installation.
 */
function resolveTargetDir(options: AddOptions): string {
  return options.targetDir || DEFAULT_SKILLS_DIR;
}

/**
 * Handle remote skill installation from any supported host provider.
 */
async function handleRemoteSkill(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  const provider = findProvider(url);

  if (!provider) {
    await handleDirectUrlSkillLegacy(source, url, options, spinner);
    return;
  }

  spinner.start(`Fetching skill.md from ${provider.displayName}...`);
  const providerSkill = await provider.fetchSkill(url);

  if (!providerSkill) {
    spinner.stop(pc.red('Invalid skill'));
    p.outro(
      pc.red('Could not fetch skill.md or missing required frontmatter (name, description).')
    );
    process.exit(1);
  }

  const remoteSkill: RemoteSkill = {
    name: providerSkill.name,
    description: providerSkill.description,
    content: providerSkill.content,
    installName: providerSkill.installName,
    sourceUrl: providerSkill.sourceUrl,
    providerId: provider.id,
    sourceIdentifier: provider.getSourceIdentifier(url),
    metadata: providerSkill.metadata,
  };

  spinner.stop(`Found skill: ${pc.cyan(remoteSkill.installName)}`);

  p.log.info(`Skill: ${pc.cyan(remoteSkill.name)}`);
  p.log.message(pc.dim(remoteSkill.description));
  p.log.message(pc.dim(`Source: ${remoteSkill.sourceIdentifier}`));

  if (options.list) {
    console.log();
    p.log.step(pc.bold('Skill Details'));
    p.log.message(`  ${pc.cyan('Name:')} ${remoteSkill.name}`);
    p.log.message(`  ${pc.cyan('Install as:')} ${remoteSkill.installName}`);
    p.log.message(`  ${pc.cyan('Provider:')} ${provider.displayName}`);
    p.log.message(`  ${pc.cyan('Description:')} ${remoteSkill.description}`);
    console.log();
    p.outro('Run without --list to install');
    process.exit(0);
  }

  const targetDir = resolveTargetDir(options);
  const cwd = process.cwd();

  // Check for overwrites
  const alreadyInstalled = await isSkillInstalled(remoteSkill.installName, targetDir);

  // Build installation summary
  const summaryLines: string[] = [];
  const shortTarget = shortenPath(targetDir, cwd);
  summaryLines.push(`${pc.cyan(remoteSkill.installName)}`);
  summaryLines.push(`  ${pc.dim('target:')} ${shortTarget}`);

  if (alreadyInstalled) {
    summaryLines.push(`  ${pc.yellow('overwrites existing skill')}`);
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Installation Summary');

  if (!options.yes) {
    const confirmed = await p.confirm({
      message: 'Proceed with installation?',
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }
  }

  spinner.start('Installing skill...');

  const result = await installRemoteSkill(remoteSkill, targetDir);

  spinner.stop('Installation complete');

  if (result.success) {
    const shortPath = shortenPath(result.path, cwd);
    p.note(`${pc.green('✓')} ${shortPath}`, pc.green('Installed 1 skill'));

    // Track telemetry
    const isPrivate = await isSourcePrivate(remoteSkill.sourceIdentifier);
    if (isPrivate !== true) {
      track({
        event: 'install',
        source: remoteSkill.sourceIdentifier,
        skills: remoteSkill.installName,
        agents: 'skulls',
        skillFiles: JSON.stringify({ [remoteSkill.installName]: url }),
        sourceType: remoteSkill.providerId,
      });
    }

    // Add to lock file
    try {
      let skillFolderHash = '';
      if (remoteSkill.providerId === 'github') {
        const hash = await fetchSkillFolderHash(remoteSkill.sourceIdentifier, url);
        if (hash) skillFolderHash = hash;
      }

      await addSkillToLock(remoteSkill.installName, {
        source: remoteSkill.sourceIdentifier,
        sourceType: remoteSkill.providerId,
        sourceUrl: url,
        skillFolderHash,
      });
    } catch {
      // Don't fail installation if lock file update fails
    }
  } else {
    p.log.error(pc.red(`Failed to install: ${result.error}`));
  }

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review skills before use; they run with full agent permissions.')
  );
}

/**
 * Handle skills from a well-known endpoint (RFC 8615).
 */
async function handleWellKnownSkills(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  spinner.start('Discovering skills from well-known endpoint...');

  const skills = await wellKnownProvider.fetchAllSkills(url);

  if (skills.length === 0) {
    spinner.stop(pc.red('No skills found'));
    p.outro(
      pc.red(
        'No skills found at this URL. Make sure the server has a /.well-known/skills/index.json file.'
      )
    );
    process.exit(1);
  }

  spinner.stop(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

  for (const skill of skills) {
    p.log.info(`Skill: ${pc.cyan(skill.installName)}`);
    p.log.message(pc.dim(skill.description));
    if (skill.files.size > 1) {
      p.log.message(pc.dim(`  Files: ${Array.from(skill.files.keys()).join(', ')}`));
    }
  }

  if (options.list) {
    console.log();
    p.log.step(pc.bold('Available Skills'));
    for (const skill of skills) {
      p.log.message(`  ${pc.cyan(skill.installName)}`);
      p.log.message(`    ${pc.dim(skill.description)}`);
      if (skill.files.size > 1) {
        p.log.message(`    ${pc.dim(`Files: ${skill.files.size}`)}`);
      }
    }
    console.log();
    p.outro('Run without --list to install');
    process.exit(0);
  }

  // Filter skills if --skill option is provided
  let selectedSkills: WellKnownSkill[];

  if (options.skill?.includes('*')) {
    selectedSkills = skills;
    p.log.info(`Installing all ${skills.length} skills`);
  } else if (options.skill && options.skill.length > 0) {
    selectedSkills = skills.filter((s) =>
      options.skill!.some(
        (name) =>
          s.installName.toLowerCase() === name.toLowerCase() ||
          s.name.toLowerCase() === name.toLowerCase()
      )
    );

    if (selectedSkills.length === 0) {
      p.log.error(`No matching skills found for: ${options.skill.join(', ')}`);
      p.log.info('Available skills:');
      for (const s of skills) {
        p.log.message(`  - ${s.installName}`);
      }
      process.exit(1);
    }

    p.log.info(
      `Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(s.installName)).join(', ')}`
    );
  } else if (skills.length === 1) {
    selectedSkills = skills;
    const firstSkill = skills[0]!;
    p.log.info(`Skill: ${pc.cyan(firstSkill.installName)}`);
  } else if (options.yes) {
    selectedSkills = skills;
    p.log.info(`Installing all ${skills.length} skills`);
  } else {
    const skillChoices = skills.map((s) => ({
      value: s,
      label: s.installName,
      hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
    }));

    const selected = await p.multiselect({
      message: `Select skills to install ${pc.dim('(space to toggle)')}`,
      options: skillChoices as p.Option<WellKnownSkill>[],
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }

    selectedSkills = selected as WellKnownSkill[];
  }

  const targetDir = resolveTargetDir(options);
  const cwd = process.cwd();

  // Build installation summary
  const summaryLines: string[] = [];
  const shortTarget = shortenPath(targetDir, cwd);

  for (const skill of selectedSkills) {
    if (summaryLines.length > 0) summaryLines.push('');
    summaryLines.push(`${pc.cyan(skill.installName)}`);
    summaryLines.push(`  ${pc.dim('target:')} ${shortTarget}`);
    if (skill.files.size > 1) {
      summaryLines.push(`  ${pc.dim('files:')} ${skill.files.size}`);
    }
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Installation Summary');

  if (!options.yes) {
    const confirmed = await p.confirm({ message: 'Proceed with installation?' });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }
  }

  spinner.start('Installing skills...');

  const results: { skill: string; success: boolean; path: string; error?: string }[] = [];

  for (const skill of selectedSkills) {
    const result = await installWellKnownSkill(skill, targetDir);
    results.push({
      skill: skill.installName,
      ...result,
    });
  }

  spinner.stop('Installation complete');

  console.log();
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track telemetry
  const sourceIdentifier = wellKnownProvider.getSourceIdentifier(url);
  const skillFiles: Record<string, string> = {};
  for (const skill of selectedSkills) {
    skillFiles[skill.installName] = skill.sourceUrl;
  }

  const isPrivate = await isSourcePrivate(sourceIdentifier);
  if (isPrivate !== true) {
    track({
      event: 'install',
      source: sourceIdentifier,
      skills: selectedSkills.map((s) => s.installName).join(','),
      agents: 'skulls',
      skillFiles: JSON.stringify(skillFiles),
      sourceType: 'well-known',
    });
  }

  // Add to lock file
  if (successful.length > 0) {
    const successfulSkillNames = new Set(successful.map((r) => r.skill));
    for (const skill of selectedSkills) {
      if (successfulSkillNames.has(skill.installName)) {
        try {
          await addSkillToLock(skill.installName, {
            source: sourceIdentifier,
            sourceType: 'well-known',
            sourceUrl: skill.sourceUrl,
            skillFolderHash: '',
          });
        } catch {
          // Don't fail installation if lock file update fails
        }
      }
    }
  }

  if (successful.length > 0) {
    const resultLines: string[] = [];
    for (const r of successful) {
      const shortPath = shortenPath(r.path, cwd);
      resultLines.push(`${pc.green('✓')} ${shortPath}`);
    }
    const title = pc.green(
      `Installed ${successful.length} skill${successful.length !== 1 ? 's' : ''}`
    );
    p.note(resultLines.join('\n'), title);
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to install ${failed.length}`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill}: ${pc.dim(r.error)}`);
    }
  }

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review skills before use; they run with full agent permissions.')
  );
}

/**
 * Legacy handler for direct URL skill installation (Mintlify-hosted skills)
 */
async function handleDirectUrlSkillLegacy(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  spinner.start('Fetching skill.md...');
  const mintlifySkill = await fetchMintlifySkill(url);

  if (!mintlifySkill) {
    spinner.stop(pc.red('Invalid skill'));
    p.outro(
      pc.red(
        'Could not fetch skill.md or missing required frontmatter (name, description, mintlify-proj).'
      )
    );
    process.exit(1);
  }

  const remoteSkill: RemoteSkill = {
    name: mintlifySkill.name,
    description: mintlifySkill.description,
    content: mintlifySkill.content,
    installName: mintlifySkill.mintlifySite,
    sourceUrl: mintlifySkill.sourceUrl,
    providerId: 'mintlify',
    sourceIdentifier: 'mintlify/com',
  };

  spinner.stop(`Found skill: ${pc.cyan(remoteSkill.installName)}`);

  p.log.info(`Skill: ${pc.cyan(remoteSkill.name)}`);
  p.log.message(pc.dim(remoteSkill.description));

  if (options.list) {
    console.log();
    p.log.step(pc.bold('Skill Details'));
    p.log.message(`  ${pc.cyan('Name:')} ${remoteSkill.name}`);
    p.log.message(`  ${pc.cyan('Site:')} ${remoteSkill.installName}`);
    p.log.message(`  ${pc.cyan('Description:')} ${remoteSkill.description}`);
    console.log();
    p.outro('Run without --list to install');
    process.exit(0);
  }

  const targetDir = resolveTargetDir(options);
  const cwd = process.cwd();

  const alreadyInstalled = await isSkillInstalled(remoteSkill.installName, targetDir);

  const summaryLines: string[] = [];
  const shortTarget = shortenPath(targetDir, cwd);
  summaryLines.push(`${pc.cyan(remoteSkill.installName)}`);
  summaryLines.push(`  ${pc.dim('target:')} ${shortTarget}`);

  if (alreadyInstalled) {
    summaryLines.push(`  ${pc.yellow('overwrites existing skill')}`);
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Installation Summary');

  if (!options.yes) {
    const confirmed = await p.confirm({
      message: 'Proceed with installation?',
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }
  }

  spinner.start('Installing skill...');

  const result = await installRemoteSkill(remoteSkill, targetDir);

  spinner.stop('Installation complete');

  if (result.success) {
    const shortPath = shortenPath(result.path, cwd);
    p.note(`${pc.green('✓')} ${shortPath}`, pc.green('Installed 1 skill'));

    track({
      event: 'install',
      source: 'mintlify/com',
      skills: remoteSkill.installName,
      agents: 'skulls',
      skillFiles: JSON.stringify({ [remoteSkill.installName]: url }),
      sourceType: 'mintlify',
    });

    try {
      await addSkillToLock(remoteSkill.installName, {
        source: `mintlify/${remoteSkill.installName}`,
        sourceType: 'mintlify',
        sourceUrl: url,
        skillFolderHash: '',
      });
    } catch {
      // Don't fail installation if lock file update fails
    }
  } else {
    p.log.error(pc.red(`Failed to install: ${result.error}`));
  }

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review skills before use; they run with full agent permissions.')
  );
}

export async function runAdd(args: string[], options: AddOptions = {}): Promise<void> {
  const source = args[0];

  if (!source) {
    console.log();
    console.log(
      pc.bgRed(pc.white(pc.bold(' ERROR '))) + ' ' + pc.red('Missing required argument: source')
    );
    console.log();
    console.log(pc.dim('  Usage:'));
    console.log(`    ${pc.cyan('npx skulls add')} ${pc.yellow('<source>')} ${pc.dim('[options]')}`);
    console.log();
    console.log(pc.dim('  Example:'));
    console.log(`    ${pc.cyan('npx skulls add')} ${pc.yellow('vercel-labs/agent-skills')}`);
    console.log();
    process.exit(1);
  }

  // --all implies --skill '*' and -y
  if (options.all) {
    options.skill = ['*'];
    options.yes = true;
  }

  console.log();
  p.intro(pc.bgCyan(pc.black(' skulls ')));

  let tempDir: string | null = null;

  try {
    const spinner = p.spinner();

    spinner.start('Parsing source...');
    const parsed = parseSource(source);
    spinner.stop(
      `Source: ${parsed.type === 'local' ? parsed.localPath! : parsed.url}${parsed.ref ? ` @ ${pc.yellow(parsed.ref)}` : ''}${parsed.subpath ? ` (${parsed.subpath})` : ''}${parsed.skillFilter ? ` ${pc.dim('@')}${pc.cyan(parsed.skillFilter)}` : ''}`
    );

    // Handle direct URL skills via provider system
    if (parsed.type === 'direct-url') {
      await handleRemoteSkill(source, parsed.url, options, spinner);
      return;
    }

    // Handle well-known skills
    if (parsed.type === 'well-known') {
      await handleWellKnownSkills(source, parsed.url, options, spinner);
      return;
    }

    let skillsDir: string;

    if (parsed.type === 'local') {
      spinner.start('Validating local path...');
      if (!existsSync(parsed.localPath!)) {
        spinner.stop(pc.red('Path not found'));
        p.outro(pc.red(`Local path does not exist: ${parsed.localPath}`));
        process.exit(1);
      }
      skillsDir = parsed.localPath!;
      spinner.stop('Local path validated');
    } else {
      spinner.start('Cloning repository...');
      tempDir = await cloneRepo(parsed.url, parsed.ref);
      skillsDir = tempDir;
      spinner.stop('Repository cloned');
    }

    // If skillFilter is present from @skill syntax, merge into options.skill
    if (parsed.skillFilter) {
      options.skill = options.skill || [];
      if (!options.skill.includes(parsed.skillFilter)) {
        options.skill.push(parsed.skillFilter);
      }
    }

    const includeInternal = !!(options.skill && options.skill.length > 0);

    spinner.start('Discovering skills...');
    const skills = await discoverSkills(skillsDir, parsed.subpath, {
      includeInternal,
      fullDepth: options.fullDepth,
    });

    if (skills.length === 0) {
      spinner.stop(pc.red('No skills found'));
      p.outro(
        pc.red('No valid skills found. Skills require a SKILL.md with name and description.')
      );
      await cleanup(tempDir);
      process.exit(1);
    }

    spinner.stop(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

    if (options.list) {
      console.log();
      p.log.step(pc.bold('Available Skills'));
      for (const skill of skills) {
        p.log.message(`  ${pc.cyan(getSkillDisplayName(skill))}`);
        p.log.message(`    ${pc.dim(skill.description)}`);
      }
      console.log();
      p.outro('Use --skill <name> to install specific skills');
      await cleanup(tempDir);
      process.exit(0);
    }

    let selectedSkills: Skill[];

    if (options.skill?.includes('*')) {
      selectedSkills = skills;
      p.log.info(`Installing all ${skills.length} skills`);
    } else if (options.skill && options.skill.length > 0) {
      selectedSkills = filterSkills(skills, options.skill);

      if (selectedSkills.length === 0) {
        p.log.error(`No matching skills found for: ${options.skill.join(', ')}`);
        p.log.info('Available skills:');
        for (const s of skills) {
          p.log.message(`  - ${getSkillDisplayName(s)}`);
        }
        await cleanup(tempDir);
        process.exit(1);
      }

      p.log.info(
        `Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(getSkillDisplayName(s))).join(', ')}`
      );
    } else if (skills.length === 1) {
      selectedSkills = skills;
      const firstSkill = skills[0]!;
      p.log.info(`Skill: ${pc.cyan(getSkillDisplayName(firstSkill))}`);
      p.log.message(pc.dim(firstSkill.description));
    } else if (options.yes) {
      selectedSkills = skills;
      p.log.info(`Installing all ${skills.length} skills`);
    } else {
      const skillChoices = skills.map((s) => ({
        value: s,
        label: getSkillDisplayName(s),
        hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
      }));

      const selected = await p.multiselect({
        message: `Select skills to install ${pc.dim('(space to toggle)')}`,
        options: skillChoices as p.Option<Skill>[],
        required: true,
      });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      selectedSkills = selected as Skill[];
    }

    const targetDir = resolveTargetDir(options);
    const cwd = process.cwd();

    // Check for overwrites
    const overwriteChecks = await Promise.all(
      selectedSkills.map(async (skill) => ({
        skillName: skill.name,
        installed: await isSkillInstalled(skill.name, targetDir),
      }))
    );
    const overwriteStatus = new Map(
      overwriteChecks.map(({ skillName, installed }) => [skillName, installed])
    );

    // Build installation summary
    const summaryLines: string[] = [];
    const shortTarget = shortenPath(targetDir, cwd);

    for (const skill of selectedSkills) {
      if (summaryLines.length > 0) summaryLines.push('');
      summaryLines.push(`${pc.cyan(getSkillDisplayName(skill))}`);
      summaryLines.push(`  ${pc.dim('target:')} ${shortTarget}`);

      if (overwriteStatus.get(skill.name)) {
        summaryLines.push(`  ${pc.yellow('overwrites existing skill')}`);
      }
    }

    console.log();
    p.note(summaryLines.join('\n'), 'Installation Summary');

    if (!options.yes) {
      const confirmed = await p.confirm({ message: 'Proceed with installation?' });

      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }
    }

    spinner.start('Installing skills...');

    const results: { skill: string; success: boolean; path: string; error?: string }[] = [];

    for (const skill of selectedSkills) {
      const result = await installSkill(skill, targetDir);
      results.push({
        skill: getSkillDisplayName(skill),
        ...result,
      });
    }

    spinner.stop('Installation complete');

    console.log();
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Track telemetry
    const skillFiles: Record<string, string> = {};
    for (const skill of selectedSkills) {
      let relativePath: string;
      if (tempDir && skill.path === tempDir) {
        relativePath = 'SKILL.md';
      } else if (tempDir && skill.path.startsWith(tempDir + sep)) {
        relativePath =
          skill.path
            .slice(tempDir.length + 1)
            .split(sep)
            .join('/') + '/SKILL.md';
      } else {
        continue;
      }
      skillFiles[skill.name] = relativePath;
    }

    const normalizedSource = getOwnerRepo(parsed);

    if (normalizedSource) {
      const ownerRepo = parseOwnerRepo(normalizedSource);
      if (ownerRepo) {
        const isPrivate = await isRepoPrivate(ownerRepo.owner, ownerRepo.repo);
        if (isPrivate === false) {
          track({
            event: 'install',
            source: normalizedSource,
            skills: selectedSkills.map((s) => s.name).join(','),
            agents: 'skulls',
            skillFiles: JSON.stringify(skillFiles),
          });
        }
      } else {
        track({
          event: 'install',
          source: normalizedSource,
          skills: selectedSkills.map((s) => s.name).join(','),
          agents: 'skulls',
          skillFiles: JSON.stringify(skillFiles),
        });
      }
    }

    // Add to lock file
    if (successful.length > 0 && normalizedSource) {
      const successfulSkillNames = new Set(successful.map((r) => r.skill));
      for (const skill of selectedSkills) {
        const skillDisplayName = getSkillDisplayName(skill);
        if (successfulSkillNames.has(skillDisplayName)) {
          try {
            let skillFolderHash = '';
            const skillPathValue = skillFiles[skill.name];
            if (parsed.type === 'github' && skillPathValue) {
              const hash = await fetchSkillFolderHash(normalizedSource, skillPathValue);
              if (hash) skillFolderHash = hash;
            }

            await addSkillToLock(skill.name, {
              source: normalizedSource,
              sourceType: parsed.type,
              sourceUrl: parsed.url,
              skillPath: skillPathValue,
              skillFolderHash,
            });
          } catch {
            // Don't fail installation if lock file update fails
          }
        }
      }
    }

    if (successful.length > 0) {
      const resultLines: string[] = [];
      for (const r of successful) {
        const shortPath = shortenPath(r.path, cwd);
        resultLines.push(`${pc.green('✓')} ${shortPath}`);
      }
      const title = pc.green(
        `Installed ${successful.length} skill${successful.length !== 1 ? 's' : ''}`
      );
      p.note(resultLines.join('\n'), title);
    }

    if (failed.length > 0) {
      console.log();
      p.log.error(pc.red(`Failed to install ${failed.length}`));
      for (const r of failed) {
        p.log.message(`  ${pc.red('✗')} ${r.skill}: ${pc.dim(r.error)}`);
      }
    }

    console.log();
    p.outro(
      pc.green('Done!') +
        pc.dim('  Review skills before use; they run with full agent permissions.')
    );
  } catch (error) {
    if (error instanceof GitCloneError) {
      p.log.error(pc.red('Failed to clone repository'));
      for (const line of error.message.split('\n')) {
        p.log.message(pc.dim(line));
      }
    } else {
      p.log.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
    p.outro(pc.red('Installation failed'));
    process.exit(1);
  } finally {
    await cleanup(tempDir);
  }
}

async function cleanup(tempDir: string | null) {
  if (tempDir) {
    try {
      await cleanupTempDir(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Parse command line options from args array
export function parseAddOptions(args: string[]): { source: string[]; options: AddOptions } {
  const options: AddOptions = {};
  const source: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '-l' || arg === '--list') {
      options.list = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '-d' || arg === '--target-dir') {
      i++;
      options.targetDir = args[i];
    } else if (arg === '-s' || arg === '--skill') {
      options.skill = options.skill || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.skill.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--;
    } else if (arg === '--full-depth') {
      options.fullDepth = true;
    } else if (arg && !arg.startsWith('-')) {
      source.push(arg);
    }
  }

  return { source, options };
}
