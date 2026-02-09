# skulls

A simplified CLI for the open agent skills ecosystem. Fork of [vercel-labs/skills](https://github.com/vercel-labs/skills).

## Install a Skill

```bash
npx skulls add vercel-labs/agent-skills
```

Skills are installed to `~/.agents/skills/` by default. Use `--target-dir` (`-d`) to override.

### Source Formats

```bash
# GitHub shorthand (owner/repo)
npx skulls add vercel-labs/agent-skills

# Full GitHub URL
npx skulls add https://github.com/vercel-labs/agent-skills

# Direct path to a skill in a repo
npx skulls add https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines

# GitLab URL
npx skulls add https://gitlab.com/org/repo

# Any git URL
npx skulls add git@github.com:vercel-labs/agent-skills.git

# Local path
npx skulls add ./my-local-skills
```

### Options

| Option                   | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `-d, --target-dir <dir>` | Install to a specific directory (default: `~/.agents/skills/`) |
| `-s, --skill <names>`    | Install specific skills by name (use `*` for all)              |
| `-l, --list`             | List available skills without installing                       |
| `-y, --yes`              | Skip confirmation prompts                                      |
| `--all`                  | Shorthand for `--skill '*' -y`                                 |
| `--full-depth`           | Search all subdirectories even when a root SKILL.md exists     |

### Install a Specific Skill

```bash
# Using @skill syntax
npx skulls add vercel-labs/agent-skills@web-design-guidelines

# Using --skill flag
npx skulls add vercel-labs/agent-skills --skill web-design-guidelines
```

## Commands

| Command              | Description                    |
| -------------------- | ------------------------------ |
| `skulls`             | Interactive skill search       |
| `skulls add <pkg>`   | Install skills                 |
| `skulls find [query]`| Search for skills              |
| `skulls list`        | List installed skills          |
| `skulls remove`      | Remove installed skills        |
| `skulls init [name]` | Create a new SKILL.md template |
| `skulls check`       | Check for skill updates        |
| `skulls update`      | Update all skills              |

## Create a Skill

```bash
npx skulls init my-skill
```

This creates a `my-skill/SKILL.md` template. Skills are Markdown files with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does
---

# my-skill

Instructions for the agent...
```

## Development

```bash
# Install dependencies
pnpm install

# Run locally
pnpm dev add vercel-labs/agent-skills --list

# Type check
pnpm run type-check

# Run tests
pnpm test

# Format code
pnpm format
```

## License

MIT
