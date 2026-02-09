# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-02-09

First stable release. Fork of [vercel-labs/skills](https://github.com/vercel-labs/skills) with a simplified installation model.

### Added

- `skulls` command with no args launches interactive skill search
- `skulls add <pkg>` to install skills from GitHub repos, URLs, or local paths
- `skulls remove [skills]` to remove installed skills (interactive or by name)
- `skulls find [query]` to search for skills interactively
- `skulls list` to list installed skills
- `skulls init [name]` to create a new SKILL.md template
- `skulls check` to check for available skill updates
- `skulls update` to update all skills to latest versions
- `--target-dir` (`-d`) flag for add, list, and remove commands
- `--skill` (`-s`) flag to install specific skills by name
- `--all` flag as shorthand for `--skill '*'`
- `--list` (`-l`) flag to preview available skills without installing
- `--full-depth` flag to search all subdirectories
- Well-known endpoint support for skill discovery
- Lock file tracking for installed skills with update checking via GitHub tree SHA
- Support for GitHub, GitLab, HuggingFace, and Mintlify skill sources

### Changed

- **Simplified installation model**: Single target directory copy model instead of per-agent symlinks. Skills are copied to `~/.agents/skills/` by default
- **No confirmation prompts**: All install and remove operations proceed immediately without asking for confirmation
- **Scoped npm package**: Published as `@juanibiapina/skulls`

### Removed

- Agent detection and selection logic (no `--agent`/`-a` flag)
- Symlink-based installation
- Global install flag (`--global`/`-g`)
- Confirmation prompts (`--yes`/`-y` flag)
- Husky, lint-staged, and xdg-basedir dependencies
- Agent sync/validation scripts
