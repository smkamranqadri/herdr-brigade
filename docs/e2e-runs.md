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

## 2026-11-08: workers on `auto` permissions

The owner chose a per-role `permissions` setting (`ask`, `auto` or `bypass`), with workers on `auto` by default. Same setup as above, request "in demo, add bye.txt with the single line bye from brigade and commit it on the task branch, nothing else".

| Check | Result |
| --- | --- |
| Claude in auto mode shows no opt-in screen at start | Pass: started with no prompt, footer "auto mode on" |
| The worker commits with no approval prompt | Pass: created 11:01:01, `finish` 11:01:11; 0 approval prompts in its history |
| Git, checked by hand | `2f118b6 Add bye.txt` holds only `bye.txt`; `od -c` shows `bye from brigade\n`; worktree clean; `main` unchanged |

Found: the Captain first called a bare `create_task` ("No such tool available") and then the real `mcp__brigade__create_task`. The prompts now say the tools are on the `brigade` MCP server.

## 2026-11-08: phase 1 step 4, all roles on Codex

Versions: Codex CLI 0.167.0, `gpt-6.1-terra` at low effort for the Coordinator, the Captain and the worker. Request: "in demo add codex.txt with the single line hello from codex, commit it on the task branch, nothing else".

The first two attempts got stuck. Each fix below came from those attempts:

- **Codex shows its ready footer for about a second before its trust prompt.** Brigade read "? for shortcuts" as ready and stopped. Ready now has to hold for 3 seconds with no prompt.
- **Codex can draw the trust prompt before it reads keys.** A press it drops is now repeated. Brigade reads the cursor and presses Down or Enter one key at a time, and counts the prompt answered only once it is gone.
- **Codex 0.167 drops a first message given on its command line once its trust prompt shows.** Three probes showed this, with and without `--`, and after waiting 20 seconds. Brigade now types Codex's first message in after start.
- **`hc send` refuses while a new agent's output settles** ("still starting"). `send` now retries for up to 30 seconds on that error only.
- **`-c projects."<folder>".trust_level="trusted"` does not skip the trust prompt.** Answering the prompt saves the folder as trusted in `~/.codex/config.toml`, as Claude saves it in `~/.claude.json`.

Third attempt, after the fixes:

| Step | Result |
| --- | --- |
| Coordinator → Captain → worker, all on Codex | Pass. The Captain's brief was typed in once it was ready. The worker's trust prompt was answered and its brief typed in. |
| Worker commits | **Fail.** Codex's `workspace-write` sandbox keeps git metadata read-only, even with `--add-dir <repo>/.git`: `index.lock: Read-only file system`. The worker called `ask_user`, and the Captain reported the problem to the Coordinator correctly. |

Open: how a sandboxed Codex worker commits. This is the owner's decision.
