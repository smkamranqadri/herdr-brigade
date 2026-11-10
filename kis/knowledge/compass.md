# Compass: herdr-brigade

## Vision

One chat runs all of the owner's coding work across projects, and the owner only reviews and merges the results.

## North Star

none yet

## Principles

- Brigade's own code enforces every power with outside effect. Prompts explain the rules but are never the rule.
- Each task gets its own branch and git worktree, so parallel work never collides.
- Any role runs on Claude Code, Codex or pi. No feature depends on one harness.
- The owner merges. Brigade opens pull requests but never merges them.
- Keep the owner's own names, paths and accounts out of shipped files.

## Not building

- A multi-user or hosted product.
- A merge tool.
- Schedules: the `herdr-automations` mod already does them.
- Agents on remote machines.
- Cloning repos: projects come from repos already on disk.

## POC vs MVP

### POC (testing)

The proof of concept in `poc/` ran on 2026-11-08 and is done. It is throwaway reference code (`docs/poc.md`).

### MVP (committed)

Phases 1 and 2 shipped as v1.0.0 on 2026-11-09. See `kis/reality/overview.md`.
