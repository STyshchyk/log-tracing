---
trigger: always_on
---

# Editing & Goal Discipline

- Repo files use CRLF line endings. When an `edit_file` multi-line Target fails once, do not retry variants: use a single-line Target, or rewrite via a PowerShell/Node script, or `write_file` with Overwrite.
- Never pass `ArtifactMetadata` to `write_file`/`edit_file` unless the path is inside the artifact directory.
- `search_web` takes only `query` (and optional `domain`); use `run_command` (e.g. `rg`) for code search.
- Only emit `<!-- GOAL_COMPLETE -->` after `pnpm typecheck`, `pnpm build` and `pnpm test` pass and every ticket deliverable is checked off. Never claim completion from partial progress; report honestly what is unfinished.
- On a user request to "revert", revert only files changed in this session (`git checkout -- <files>`); keep pre-existing spec/ticket files.
- Before starting a new phase/feature branch or delegating to subagents, check `git status -sb` and fast-forward the base branch (`git pull --ff-only origin develop`) so work never lands on a stale pre-merge commit.
- When committing or cleaning up failed subagent edits in a dirty working tree, stage or revert explicit file paths only (`git add <paths>`, `git checkout -- <paths>`) — never run `git add -A`, `git add .`, or `git reset --hard`.
