---
trigger: always_on
---

# Editing & Goal Discipline

- Repo files use CRLF line endings. When an `edit_file` multi-line Target fails once, do not retry variants: use a single-line Target, or rewrite via a PowerShell/Node script, or `write_file` with Overwrite.
- Keep every source and test file under `700` lines (`< 35 KB`) so it fits in a single `read_file` call (`800`-line / `46 KB` limit) and parallel subagents can edit without collisions.
- Separate concerns across files: never inline large CSS stylesheets, client JS runtimes, or SSR HTML view builders inside Fastify route files (`src/routes/*`); place styles, client scripts, and view builders in dedicated `src/ui/*` submodules and re-export public symbols when preserving existing import contracts.
- Never pass `ArtifactMetadata` to `write_file`/`edit_file` unless the path is inside the artifact directory.
- `search_web` takes only `query` (and optional `domain`); use `run_command` with `git grep -E` for code search (`rg` is not installed in PowerShell on this host).
- Only emit `<!-- GOAL_COMPLETE -->` after `pnpm typecheck`, `pnpm build` and `pnpm test` pass and every ticket deliverable is checked off. Never claim completion from partial progress; report honestly what is unfinished.
- On a user request to "revert", revert only files changed in this session (`git checkout -- <files>`); keep pre-existing spec/ticket files.
- Before starting a new phase/feature branch or delegating to subagents, check `git status -sb` and fast-forward the base branch (`git pull --ff-only origin develop`) so work never lands on a stale pre-merge commit.
- When committing or cleaning up failed subagent edits in a dirty working tree, stage or revert explicit file paths only (`git add <paths>`, `git checkout -- <paths>`) — never run `git add -A`, `git add .`, or `git reset --hard`.
