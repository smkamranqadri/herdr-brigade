# herdr-brigade

herdr-brigade runs a brigade of coding agents inside Herdr from one chat. It is public and MIT licensed.

## Who it is for

One owner, on their own Linux computer, who works on several repos with coding agents. It is not a multi-user product.

## The problem

Running many coding agents by hand means many terminals, branches and follow-ups to track. The owner wants to ask in one chat and get pull requests back.

## How it works

- The owner talks to one **Coordinator**. It routes each request to the right project's **Captain**.
- A Captain splits the work and starts one **worker** per task.
- Each worker runs in its own Herdr terminal, on its own branch and git worktree. It commits through brigade and can open a pull request.
- Each role runs on Claude Code, Codex or pi, with its own model, effort and permission level.
- The Brigade panel in herdr-app shows the brigade live.

## Where the facts live

| Topic | File |
| --- | --- |
| Layers and where new code goes | `docs/architecture.md` |
| Decisions and dependencies, with reasons | `docs/decisions.md` |
| Threat model, guards and known limits | `SECURITY.md` |
| Agent rules, the gate and playbooks | `AGENTS.md` |
| Real-agent runs | `docs/e2e-runs.md` |
| Code reviews and their fixes | `docs/reviews.md` |
| Release history | `CHANGELOG.md` |
