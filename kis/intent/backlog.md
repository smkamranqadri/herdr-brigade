# Backlog

These items wait for the owner's decision.

- **Nothing gets lost (next, from the 2026-11-12 review of real conversations).**
  - `report` fails while the receiving agent shows a permission dialog ("typing would answer its dialog"), and the report is dropped. Queue it and deliver it when the dialog closes.
  - A worker can end its turn with no brigade call, so its answer stays in its terminal. Brigade notices it (for example a Claude Stop hook) and reminds the worker. `list_tasks` shows "waiting on owner" and "idle, no report".
  - Brigade types each message into the receiving agent's input box. When the owner is typing there, the message lands inside the owner's text. Hold the message while the input box has text, and deliver it once the box is empty. Use the same queue as the dialog case. Adopted 2026-11-12.
  - An agent waits on a permission prompt until someone looks. The panel marks the task "waiting on permission" (hc reports the agent as blocked), and a desktop notification goes out. Adopted 2026-11-12.
  - Captains hit permission prompts on guessed paths. Show the worktree path in `list_tasks`, or let Captains read `~/.herdr/worktrees`.
- **Survive restarts and usage limits (adopted 2026-11-12).** In one 3.6-day run of the owner's earlier setup, 16 restarts, 13 API errors and a usage limit with 14 workers running lost work.
  - A handoff file per task, in its worktree: the worker keeps its brief, status and open threads there. A new worker starts from it when the old conversation is gone or full. This also closes the Codex and pi resume risk.
  - `brigade start` lists the workers that ended mid-task (for example in a reboot) and offers to resume them. No park step.
  - A cap on running workers, set in the config. A `create_task` over the cap waits in a queue, and the panel shows it as queued.
- **Review before finish (adopted 2026-11-12).**
  - `finish` carries the PR link and the head commit. Brigade reads the head commit from the worktree itself. The Captain checks that the branch has not moved since.
  - The worker prompt: before `finish`, run a review by another model through `hc`, fix or answer each finding, and name the result in `finish`.
  - A worker tool publishes a review page from the worktree over a local http port, with Approve and Needs changes per item. The owner's answers go back to that worker. The worker builds the page, not the Captain.
  - The Captain prompt: for design work with no clear target, ask the worker for 3 different directions on one review page first.
- **A port range per worker (adopted 2026-11-12).** Parallel workers clash on dev-server ports. Brigade gives each task a free port range (an env var such as `BRIGADE_PORT`), and the worker prompt names it. Rules for commands that must run one at a time (`flock`) go in project notes.
- **Work across task branches.** A Captain kept 12 jobs in one long task because a new task starts from the base branch, without the earlier task's files. Let `create_task` start from another task's branch, or merge locally when the owner wants no PR.
- **create_project.** Brigade can't create a repo, so new repos were made through an unrelated project's Captain, whose workers then worked outside their worktrees.
- **Coordinator context.** It reached 184k tokens in 40 hours. Its baseline (46k) includes MCP instructions and skills it never uses. Decide with the Coordinator item below.

- **Coordinator: optional, or a fresh context per request.** The owner asked on 2026-11-12 whether the Coordinator is needed: Captains have their own tabs now, and the Coordinator's conversation grows with every request (another tool the owner uses runs one fresh run per message instead). Brigade's state lives in its event log and tools, so a fresh context per request could work. The owner talks to Captains directly for a few days first, then decides: drop the Coordinator, make it optional, or give it a fresh context per request.
  - Decide together with it: **questions go straight to the owner.** Today a worker's `ask_user` goes worker → Captain → Coordinator → owner and back, one model call per hop (the owner's report, 2026-11-12). Proposal: the question stays in the worker's tab, and the panel marks the task "waiting on you"; the owner answers there. The Captain gets a note and does not relay. A Captain asks its own questions in its own tab. Maybe a desktop notification when something waits on the owner.
  - Adopted by the owner on 2026-11-12, from the review of the owner's earlier prompt-driven setups (about 2 turns per question there, about 6 in brigade):
    - `ask_user` takes options, with one marked as recommended. The agent that asks the owner shows them as a picker (AskUserQuestion).
    - Open questions from all workers wait in one queue ("Q2 of 4"), shown in the panel and in `list_tasks`. The owner answers them in turn.
- **Close the Codex and pi MCP gaps.** Start Codex and pi Captains and workers with brigade's MCP server only, as Claude ones are. The owner chose docs only on 2026-11-11, because every role runs on Claude Code. Do this before a role moves to Codex or pi. Approach found on 2026-11-11 (no model calls):
  - Codex 0.167: `-c mcp_servers.<name>.enabled=false` turns off one server. A new `mcp_servers` table does not replace the owner's, because Codex merges the two. Take the names from `codex mcp list --json`. If that command fails, refuse to start the agent. `-c features.{apps,plugins,computer_use,browser_use,in_app_browser}=false` removes plugin servers such as computer use. `--ignore-user-config` is not an option: only `codex exec` has it, and it would also drop the owner's Codex hooks.
  - pi 1.5.2: take the names from `pi mcp list --json`, then remove their tools with `--tools -mcp__<name>__*`. Not tested in a session yet. `--no-mcp` and `--no-extensions` are not options.
- **Tell rail letters apart.** The folded panel shows one letter per project, so two projects that start with the same letter look alike. Hovering names each one. Options: two letters, or a color per project as the left sidebar colors spaces. The owner has not decided.
- **Workers report to a Captain that has restarted.** A worker sends its reports to the Captain address it got at start (`context.parent`). After that Captain ends and a new one starts, the address is gone, and the reports are lost. It can happen when a Captain is stopped with `hc kill` while its workers run. Closing the Brigade space ends the workers too, so it does not happen there. A fix: look up the project's running Captain by its labels at report time. Found on 2026-11-11 in phase 3b.
