# End-to-end runs

Each run uses real agents in real `hc` terminals, with a scratch config, state folder, repo and worktrees (`BRIGADE_CONFIG`, `BRIGADE_STATE`, `BRIGADE_WORKTREES`).

## 2026-11-08: phase 1 step 3, all roles on Claude Code

Versions: hc 0.1.18, Claude Code 2.1.319, `claude-sonnet-5-5` at low effort for the Coordinator, the Captain and the worker.

Request typed into the Coordinator, in a dictated style: "ok so in the demo project can you add a hello file, hello.txt, with just the line hello from brigade, and commit it on the task branch, thats it".

| Step | Result |
| --- | --- |
| `brigade start` twice | The first started the Coordinator (`t9q`). The second said "Already running" (after the fix below). |
| Coordinator → `send_to_captain` | It rewrote the request as a full brief (goal, exact content, no push, what done means) and started the demo Captain (`t9r`). |
| Captain → `create_task` | It made branch `brigade/add-hello-txt-86b5d9` in its own worktree and started the worker (`t9s`). |
| Worker | It stopped on Claude's permission prompt for `git add` and `git commit` (see below). After one approval it committed and called `finish`. |
| Relay | Captain → `report` → Coordinator → owner, with "This is the worker's report; I did not check the commit myself." |
| Git, checked by hand | `a4b772e Add hello.txt` holds only `hello.txt`; `od -c` shows `hello from brigade\n`; the source repo's `main` was unchanged. |

### What the run found

- **Bug, fixed:** `hc ls --json` does not include labels, so brigade could not find a running Coordinator and tried to start a second one (`name_taken`). The `Terminals` port now asks `hc ls --label k=v` to do the matching.
- **The worker needs shell approval.** In `acceptEdits` mode, Claude asks before running shell commands such as `git commit`. The worker was blocked until the owner approved. `hc` then told the Captain the worker was blocked, and the Captain told the Coordinator. That relay worked well, but routine work needs a decision on the worker's permission mode.
- **A stale status can end a wait early.** `hc wait` returned at once with the old `blocked` status after the approval. Brigade itself never waits on status; it reacts to `finish` and `ask_user` events.

Not checked in this run: Codex or pi in any role (step 4), several workers at once (step 5), and `send_to_task` follow-ups with real agents.
