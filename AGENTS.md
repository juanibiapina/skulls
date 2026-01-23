# AGENTS.md

This file provides guidance to AI coding agents working on the `add-skill` codebase.

## Project Overview

`add-skill` is a CLI tool that installs agent skills (reusable instruction sets in `SKILL.md` files) onto various coding agents. It supports 23+ agents including OpenCode, Claude Code, Cursor, Codex, and more.

### Usage

```bash
npx skills add <source>          # Install a skill from GitHub, URL, or local path
npx skills add <source> --global # Install globally for the current user
npx skills list                  # List installed skills
npx skills remove <name>         # Remove an installed skill
```

## Architecture

```
src/
├── index.ts          # CLI entry point, main flow orchestration
├── types.ts          # Core TypeScript types (AgentType, Skill, etc.)
├── agents.ts         # Agent configurations (paths, detection logic)
├── skills.ts         # Skill discovery from SKILL.md files
├── installer.ts      # Installation logic (symlink/copy modes)
├── source-parser.ts  # Parse input sources (GitHub, local, URLs)
├── git.ts            # Git clone operations
├── mintlify.ts       # Legacy Mintlify skill fetching
├── telemetry.ts      # Anonymous usage tracking
├── skill-lock.ts     # Lock file for installed skills
└── providers/
    ├── index.ts      # Provider registry exports
    ├── types.ts      # HostProvider interface
    ├── registry.ts   # Provider registration
    ├── mintlify.ts   # Mintlify provider
    └── huggingface.ts # HuggingFace provider
```

## Key Concepts

### Agent Configuration

Each agent is defined in `src/agents.ts` with:

- `name`: CLI identifier (e.g., `claude-code`)
- `displayName`: Human-readable name
- `skillsDir`: Project-level skill directory
- `globalSkillsDir`: User-level skill directory
- `detectInstalled`: Function to check if agent is installed

### Skill Format

Skills are directories containing a `SKILL.md` with YAML frontmatter:

```markdown
---
name: skill-name
description: What this skill does
---

# Instructions...
```

### Installation Modes

1. **Symlink (default)**: Skills are stored in `.agents/skills/<name>/` and symlinked to each agent's directory
2. **Copy**: Skills are copied directly to each agent's directory

### Skill Lock File

The `.skill-lock.json` file (at `~/.agents/.skill-lock.json`) tracks globally installed skills. Managed by `src/skill-lock.ts`.

**Lock File Format (v2):**
```json
{
  "version": 2,
  "skills": {
    "skill-name": {
      "source": "owner/repo",
      "sourceType": "github",
      "sourceUrl": "https://github.com/owner/repo.git",
      "skillPath": "skills/skill-name/SKILL.md",
      "contentHash": "sha256-of-skill-md-content",
      "installedAt": "...",
      "updatedAt": "..."
    }
  }
}
```

**Key fields:**
- `contentHash`: SHA-256 hash of SKILL.md content, used by `skills check` to detect updates
- `version`: Schema version. If < 2, lock file is wiped (old format lacked contentHash)

**How hashes are computed:**
```typescript
import { createHash } from 'crypto';
const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
```

The hash is computed from raw SKILL.md content at install time and stored in the lock file. The `skills check` command sends this hash to the `/check-updates` API to compare against the latest content from GitHub.

### Provider System

For remote skills (Mintlify, HuggingFace), providers implement the `HostProvider` interface:

- `match(url)`: Check if URL belongs to this provider
- `fetchSkill(url)`: Download and parse the skill
- `toRawUrl(url)`: Convert to raw content URL
- `getSourceIdentifier(url)`: Get telemetry identifier

## Common Tasks

### Adding a New Agent

1. Add the agent type to `AgentType` union in `src/types.ts`
2. Add configuration in `src/agents.ts`
3. Run `pnpm tsx scripts/sync-agents.ts` to update README.md

### Adding a New Provider

1. Create provider in `src/providers/<name>.ts` implementing `HostProvider`
2. Register in `src/providers/index.ts`

### Testing

```bash
pnpm test           # Run tests
pnpm typecheck      # Type checking
pnpm lint           # Linting
```

## Code Style

- Use TypeScript strict mode
- Prefer async/await over callbacks
- Use `chalk` for colorized output
- Use `@clack/prompts` for interactive prompts
- Sanitize user input paths to prevent directory traversal

## Important Files

- `src/agents.ts`: Primary file when adding/modifying agent support
- `src/installer.ts`: Core installation logic, path security
- `src/skills.ts`: Skill discovery and parsing
- `README.md`: Auto-updated sections (agent list, discovery paths)

## Security Considerations

- All skill names are sanitized via `sanitizeName()` in `installer.ts`
- Paths are validated with `isPathSafe()` to prevent traversal attacks
- Telemetry is anonymous and respects `DO_NOT_TRACK`/`DISABLE_TELEMETRY`

## Dependencies

Key dependencies:

- `commander`: CLI argument parsing
- `@clack/prompts`: Interactive prompts
- `gray-matter`: YAML frontmatter parsing
- `chalk`: Terminal colors
- `simple-git`: Git operations

## CI/CD

- GitHub Actions runs on push/PR to main
- Validates agent configurations via `scripts/validate-agents.ts`
- Type checking and linting enforced
