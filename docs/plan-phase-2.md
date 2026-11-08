# Phase 2 plan

Status: draft, waiting for the owner's approval. Date: 2026-11-09.

## Goal

The owner runs a real project with brigade from chat alone. They add the project by voice, give lasting rules once, and get pull requests back, with no hand edits to config files.

Done means:

- A dictated "add a project" request adds it.
- A rule the owner states reaches every later worker in that project.
- A worker on each harness opens a pull request, and brigade reports its live state from GitHub.
- The gate, a fresh review and a real-agent run on each harness all pass.

## Scope

### Part 1: Projects from chat

Today the owner must edit `projects` in `~/.config/herdr-brigade/config.json` by hand. In Box Yard, the owner's first message was "add a project called Harbor Sadat".

- **New Coordinator tools:**
  - `find_repo(name)`: searches the owner's repo folders for git repos whose folder name matches, and returns their paths and base branches. It is read-only. The search roots are a new optional config key, `repoRoots`, which defaults to `~/Repositories`, at most 3 levels deep.
  - `add_project(name, repo, baseBranch?)`: adds a project. It checks that the folder is a git repo, that the base branch exists (default: the repo's current default branch), and that the name is valid and unused.
  - `update_project(name, baseBranch?)`: changes a project's base branch.
- **A config store.** Every tool reads the config fresh, so a project added by one agent is visible to the others, whose MCP servers each loaded the config at start. Writes are atomic (write a temp file, then rename) and check that the file has not changed since it was read. A new port, `ConfigStore`, replaces the config loaded once in `Deps`.
- **A fix to `brigade init`:** it uses `git config user.name` for `owner`, not the login name.
- **Not in scope:** cloning a repo from GitHub, removing a project.

### Part 2: Project notes

In Box Yard, 8 project notes carried the owner's lasting rules, such as "no mosque shapes", "Urdu first, then English" and "no QR codes". Every agent started with them.

- **Storage:** events in the event log (`note_added`, `note_changed`, `note_removed`, `note_suggested`, `suggestion_resolved`). `domain/notes.ts` folds them into the current notes and the open suggestions, as `deriveTasks` does for tasks.
- **Budget:** at most 20 notes and about 2,000 tokens for each project. Over it, workers get the newest notes that fit, and their prompt says how many were left out.
- **Workers** start with the project's notes in their system prompt, through a new `{{NOTES}}` placeholder. They cannot write notes. New tool: `suggest_note(text, why)`.
- **Captains** curate the notes. New tools: `list_notes`, `add_note`, `change_note`, `remove_note`, `list_suggestions`, and `resolve_suggestion(id, accept | merge | reject, reason, text?)`.
  - When a task finishes and its worker made suggestions, the finish report that brigade sends the Captain lists them. That is the notes retro, and the Captain resolves each one with a reason.
  - When the owner states a lasting rule, the Captain saves it with `add_note`. The prompts give the rules: notes are for lasting rules and facts that are not in the code; code conventions belong in the repo's own `AGENTS.md`.
- **The Coordinator** gets `save_note(project, text)` for a rule the owner gives in its chat.
- **The panel** shows the number of notes and open suggestions for each project.

### Part 3: Push and pull requests

Today workers stop at a local commit. In Box Yard, 6 of the owner's 7 tasks ended in a pull request. Codex's sandbox blocks network access, so a Codex worker cannot push.

- **New worker tool, `create_pull_request(title, body)`:** brigade's MCP server runs it outside the agent's sandbox.
  1. It checks the worktree as `commit` does: top folder, repo, git folder and branch.
  2. It pushes the task branch to `origin`. The push is fast-forward only; it never forces.
  3. It opens the pull request against the project's base branch with `gh pr create`, or updates the one that exists with `gh pr edit`.
  4. It records `pr_opened` with the URL and number.
- **Live PR state.** `list_tasks` and the worker's `finish` report check the PR's state with `gh pr view <number> --json state,mergedAt,headRefOid`, with a 10-second timeout, and record `pr_state`. If GitHub doesn't answer, they say the state is the last known one, and how old it is. The Coordinator and Captain prompts say never to report a PR's state from memory. Box Yard needed the same rule after it reported a merged PR as "waiting".
- **The panel** shows a PR chip on each task: its number and last known state.
- **Merging stays with the owner,** on GitHub or by asking a worker in chat, as now. There's no merge tool and no button.
- **Credentials:** the push and `gh` use the owner's existing `gh` login on this computer. Brigade never reads, prints or passes a token.

### Part 4: Phase 1 gaps

- **A follow-up to a pi agent in its first seconds can lose its Enter.** After `send`, brigade checks that a turn started within 20 seconds, and presses Enter once more if the text is still in the input.
- **The three overlapping commit checks** (top folder, repo, git folder) each get a test that only they fail, and a mutation check.
- **The e2e script's timeout path** gets one real check, with a short `WAIT_SECONDS`.
- **Auto-focus on `brigade start`** gets one look by eye, at a time the owner chooses, so it doesn't pull their view away during their work.

## Out of scope

Schedules (`herdr-automations` already does them), remote machines (`hc run --on`), resuming a worker whose terminal has exited, hooks, buttons in the panel, a merge tool, cloning repos, and the clean-setup option.

## Steps

Each step is a thin slice through every layer with its tests (guide W4), the gate, a commit, and a real-agent run where it changes agent behavior.

1. **Config store and project tools** (Part 1). Real check: on Claude, the dictated "add a project called demo2 at <path>, then add hello.txt there" adds the project and finishes the task.
2. **Notes** (Part 2). Real check: the owner says "remember: in demo, every text file ends with a line 'end'". The note is saved, and the next task's worker follows it unprompted. The worker's suggestion goes through the retro.
3. **Pull requests** (Part 3). Real check on each harness: a worker opens a PR in a test repo on GitHub, and `list_tasks` reports its live state. This needs the owner's decision below.
4. **Phase 1 gaps** (Part 4).
5. **Review and final runs:** one fresh review of steps 1 to 4 (Codex `gpt-6.1-sol`, medium, read-only), then a run on each harness that uses all three parts.

## Structure (guide part 3)

| Layer | New |
| --- | --- |
| `domain` | `notes.ts` (fold note events, apply the budget), `pullRequests.ts` (PR state from events), project rules in `config.ts` |
| `application` | `projects.ts`, `notes.ts`, `pullRequests.ts` use cases; ports `ConfigStore`, `Repos` (find and inspect a repo), `PullRequests` (push, open, read state) |
| `adapters` | `config/fileConfigStore.ts`, `git/` gains repo inspection and push, `github/ghPullRequests.ts` (`gh` CLI) |
| `mod` | `model.js` gains notes and PR fields; the existing agreement test is extended |

No new dependencies. `gh` 2.103.3 is already installed and signed in.

## Risks

- **`config.json` gets written by agents.** Brigade writes it atomically and only when it has not changed since it was read. A hand edit made at the same moment makes the tool fail with a clear message instead of losing either change.
- **Pushing and opening PRs are outward-facing.** They happen only when a worker calls the tool, only for its own checked branch, and never with force. Merging stays with the owner.
- **`gh pr view` costs a network call.** States are read at most once per task every 30 seconds, and the last known state is used in between.
- **Note quality depends on the Captain's judgment.** The budget keeps a bad note from crowding out the others, and the owner can ask the Captain to remove one.

## Decisions for the owner

1. **A GitHub repo for the PR checks in step 3.** I recommend a new private repo on your account, `smkamranqadri/brigade-e2e-sandbox`, that holds only test files. Creating it is an outward-facing action, so it needs your yes, or you create it.
2. **Defaults to confirm:** the notes budget (20 notes, about 2,000 tokens), and `repoRoots` defaulting to `~/Repositories`.
