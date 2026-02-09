# AGENTS.md

This file provides guidance to AI coding agents working on the `skulls` CLI codebase.

## Project Overview

`skulls` is a simplified fork of `vercel-labs/skills` — the CLI for the open agent skills ecosystem.

Key simplification: no agent concept, no symlinks — just copy skill files to a single target directory (`~/.agents/skills/` by default, overridable with `--target-dir`/`-d`).

## Commands

| Command              | Description                                         |
| -------------------- | --------------------------------------------------- |
| `skulls`             | Interactive skill search (runs `find`)              |
| `skulls add <pkg>`   | Install skills from git repos, URLs, or local paths |
| `skulls find [query]`| Search for skills interactively                     |
| `skulls list`        | List installed skills (alias: `ls`)                 |
| `skulls remove`      | Remove installed skills (aliases: `rm`, `r`)        |
| `skulls init [name]` | Create a new SKILL.md template                      |
| `skulls check`       | Check for available skill updates                   |
| `skulls update`      | Update all skills to latest versions                |

Aliases: `skulls a`, `skulls i`, `skulls install` all work for `add`. `skulls ls` works for `list`.

## Architecture

```
src/
├── cli.ts           # Main entry point, command routing, init/check/update
├── cli.test.ts      # CLI tests
├── add.ts           # Core add command logic
├── add.test.ts      # Add command tests
├── installer.ts     # Skill installation logic (copy to target dir) + listInstalledSkills
├── list.ts          # List installed skills command
├── list.test.ts     # List command tests
├── remove.ts        # Remove installed skills command
├── remove.test.ts   # Remove command tests
├── find.ts          # Interactive skill search
├── constants.ts     # Default target directory constant
├── types.ts         # TypeScript types (Skill, ParsedSource, RemoteSkill)
├── skills.ts        # Skill discovery and parsing
├── skill-lock.ts    # Lock file management
├── source-parser.ts # Parse git URLs, GitHub shorthand, local paths
├── git.ts           # Git clone operations
├── telemetry.ts     # Anonymous usage tracking
├── mintlify.ts      # Mintlify skill fetching (legacy)
├── plugin-manifest.ts # Plugin manifest parsing
├── providers/       # Remote skill providers (GitHub, HuggingFace, Mintlify, well-known)
│   ├── index.ts
│   ├── registry.ts
│   ├── types.ts
│   ├── huggingface.ts
│   ├── mintlify.ts
│   └── wellknown.ts
├── init.test.ts     # Init command tests
├── source-parser.test.ts # Source parser tests
└── test-utils.ts    # Test utilities

tests/
├── sanitize-name.test.ts          # Tests for sanitizeName (path traversal prevention)
├── skill-matching.test.ts         # Tests for filterSkills (multi-word skill name matching)
├── source-parser.test.ts          # Tests for URL/path parsing
├── installer.test.ts              # Tests for installer (copy + listInstalledSkills)
├── skill-path.test.ts             # Tests for skill path handling
├── cross-platform-paths.test.ts   # Tests for cross-platform path handling
├── wellknown-provider.test.ts     # Tests for well-known provider
├── full-depth-discovery.test.ts   # Tests for full-depth skill discovery
├── plugin-manifest-discovery.test.ts # Tests for plugin manifest discovery
└── dist.test.ts                   # Tests for built distribution
```

## Installation Model

- Default target: `~/.agents/skills/<skill-name>/`
- Override with `--target-dir <dir>` (`-d <dir>`)
- No agent concept, no symlinks — just copy files to the target directory
- All `add`, `list`, `remove` commands accept `--target-dir`/`-d`

## Update Checking System

### How `skulls check` and `skulls update` Work

1. Read `~/.agents/.skill-lock.json` for installed skills
2. For each GitHub-sourced skill, fetch the latest tree SHA via GitHub Trees API
3. Compare with stored `skillFolderHash`
4. Report skills with different hashes as having updates available

### Lock File

Located at `~/.agents/.skill-lock.json`. Format is v3 with key field `skillFolderHash` (GitHub tree SHA).

## Key Integration Points

| Feature          | Implementation                                      |
| ---------------- | --------------------------------------------------- |
| `skulls add`     | `src/add.ts` — parse source, discover, install      |
| `skulls check`   | `src/cli.ts` — fetch hashes from GitHub Trees API   |
| `skulls update`  | `src/cli.ts` — check + reinstall per skill          |

## Development

```bash
# Install dependencies
pnpm install

# Run locally
pnpm dev add vercel-labs/agent-skills --list
pnpm dev check
pnpm dev update
pnpm dev init my-skill

# Run all tests
pnpm test

# Run specific test file(s)
pnpm test tests/sanitize-name.test.ts

# Type check
pnpm type-check

# Format code
pnpm format
```

## Code Style

This project uses Prettier for code formatting. **Always run `pnpm format` before committing changes** to ensure consistent formatting.

```bash
# Format all files
pnpm format

# Check formatting without fixing
pnpm prettier --check .
```
