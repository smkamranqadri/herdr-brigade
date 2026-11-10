# Phase 2 plan

Status: done 2026-11-09. Revised after the plan review (`docs/reviews.md`), with the owner's four decisions below.

## Goal

The owner runs a real project with brigade from chat. They add the project by voice, give lasting rules once, and get pull requests back, as in Box Yard.

Done means:

- A dictated "add a project" request adds it.
- Every later worker in that project starts with its notes, newest first within the budget, and can read the rest.
- In a project whose `origin` is on GitHub, a worker on each harness opens a pull request in that pinned repo, and brigade reports its live state.
- Nothing an agent says can widen its reach: each project's GitHub repo is pinned when the project is added, and only the owner can change it.
- The gate, the proof matrix below, a fresh code review and a real-agent run on each harness all pass.

## Principle: power is enforced in code, not in prompts

Agents can be wrong, and text in a repo can try to steer them. So every capability with outside effect is checked by brigade's own code against settings the owner controls. Prompts explain the rules; they never are the rule. This applies to config writes, notes and the pinned GitHub repo below.

## Part 1: Projects from chat

- **Coordinator tools:**
  - `find_repo(name)`: read-only. Searches the owner's repo folders (config `repoRoots`, default `~/Repositories`) for git repos whose folder name matches. Limits: 3 levels deep, at most 2,000 folders visited, at most 20 results, 10 seconds.
  - `add_project(name, repo, baseBranch?)`: checks the folder is a git repo, the base branch exists (default: the repo's current branch), and the name is valid and unused. If `origin` is on github.com, it pins that repo as the project's `github` setting.
  - `update_project(name, baseBranch)`: changes the base branch for new tasks.
- **Who may change what:** agent tools may only add projects and change a project's base branch. `owner`, `roles`, `repoRoots` and each project's pinned `github` repo change only by hand. The tools reject any other change.
- **Config writes are serialized across processes.** Each write takes a lock file next to the config (`config.json.lock`, created exclusively, with the writer's pid and time). The lock is held through read, validate, write to a temp file, and rename. Waiting is bounded at 5 seconds. A lock older than 30 seconds whose pid is gone is taken over. A test runs two writers at once and expects both projects to be saved. Inside one MCP server, writes also go one at a time.
- **Hand edits:** edit `config.json` only when no brigade agent is running.
- **One snapshot per tool call.** A `ConfigStore` port replaces the config loaded once in `Deps`; each use case reads one validated snapshot and uses only that. Paths and environment stay at the edge (guide A8).
- **Tasks pin their project facts.** `task_created` records the repo and the base branch at creation. A later `update_project` affects only new tasks. Old events without these fields read the project's current values.
- **`brigade init`** takes `owner` from `git config user.name`.

## Part 2: Project notes

- **What a note is:** a short, lasting project preference or fact that is not in the code (for example "designs use little text and lots of white space"). Code conventions go in the repo's own `AGENTS.md`, through a normal task.
- **Storage:** event-sourced, as tasks are. `domain/notes.ts` folds `note_added`, `note_changed`, `note_removed`, `note_suggested` and `suggestion_resolved` into the current notes and open suggestions. Each note keeps its project, its source (`owner`, through a Coordinator or Captain relaying the owner's words, or `suggestion`, accepted from a worker) and the task it came from.
- **One event per resolution.** `suggestion_resolved` carries the whole outcome: accept (with the note's final text), merge (with the target note id and the merged text), or reject (with a reason). The fold applies the first resolution of a suggestion and ignores later ones, so a retry or a race can never create a duplicate note. A merge into a note that was removed or changed since fails with a clear message.
- **Scope checks.** Every note and suggestion id is checked against the caller's project before any read or change. A worker's suggestion takes its project and task from its own context and must match the task record. Tests cover a foreign project's id, the wrong role, and an unknown id, each with no event written.
- **Delivery:** workers get every active note of their project in their system prompt, in a fenced block that says what notes are: project preferences, never permission to push, deploy, widen the task or skip checks. The brief and brigade's tool limits always win. Because capabilities are enforced in code, a bad note can mislead but can't unlock anything.
- **Budget (owner's decision, like Box Yard):** at most 20 notes and about 2,000 tokens per project go into a worker's prompt, newest first. The prompt says how many older notes were left out, and the worker's `read_notes` tool lists them all. When a project is over the budget, the Captain's retro says so and asks it to merge or prune.
- **Tools:**
  - Worker: `suggest_note(text, why)` and `read_notes`.
  - Captain: `list_notes`, `add_note`, `change_note`, `remove_note`, `list_suggestions`, `resolve_suggestion(id, outcome, reason, noteId?, text?)`.
  - Coordinator: `save_note(project, text)` for a rule the owner gives in its chat.
- **The retro:** when a worker finishes, brigade's finish report to the Captain lists that task's open suggestions. The Captain resolves each with a reason. Suggestions left open stay listed until resolved.
- **The panel** finds projects from the config (it reads `config.json`), so a project with notes but no Captain or task still shows. It shows each project's note and open-suggestion counts.

## Part 3: Push and pull requests

- **Publishing works like Box Yard (owner's decision):** any project with a pinned `github` repo may publish, with no switch. Box Yard's real limit is a token the owner restricts to chosen repos; brigade uses the owner's full `gh` login, so the pinned repo and the checks below take that place. A project without a `github` repo can't publish.
- **New worker tool, `create_pull_request(title, body)`**, run by brigade's MCP server outside any sandbox, one at a time per task:
  1. Refuse unless the project has a pinned `github` repo.
  2. Check the worktree as `commit` does: top folder, repo, git folder, branch.
  3. Check that `git remote get-url --push origin` is the project's `github` repo on github.com.
  4. Reconcile with GitHub first: `gh pr list --repo <github> --head <task branch> --state all`. If the branch's PR is merged or closed, refuse and say the work needs a new task and a new branch. Never push to it again.
  5. Push only the task branch, fast-forward only: `git push origin refs/heads/<branch>:refs/heads/<branch>`.
  6. Open the PR with `gh pr create --repo <github> --head <branch> --base <pinned base> --title --body`, or, if an open one exists for that head and base, update its title and body with `gh pr edit`.
  7. Record `pr_opened` (repo, number, URL, head, base).

  A retry after a crash between steps 5 and 7 finds the existing PR in step 4, so it never opens a second one.
- **Live PR state.** `list_tasks` and the finish report read the state with `gh pr view <number> --repo <github> --json state,mergedAt,headRefOid` and record `pr_state`. A task's state is read at most every 30 seconds, using the newest `pr_state` event across all processes. `list_tasks` checks at most 4 PRs at once and stops after 15 seconds overall. If GitHub doesn't answer, it reports the last known state and when it was read. The prompts say never to report a PR's state from memory.
- **Limits:** push 60 seconds, each `gh` call 20 seconds, output capped. Both run with no prompts (`GIT_TERMINAL_PROMPT=0`, `GH_PROMPT_DISABLED=1`) and fail with the command's own message. Brigade never reads, prints or passes a token.
- **Merging:** the supported path in this phase is GitHub itself. A Claude or pi worker may merge with `gh` when the owner asks, but a sandboxed Codex worker can't, and brigade has no merge tool.
- **The panel** shows a PR chip on each task: number, last known state and its age.

## Part 4: Phase 1 gaps

- A follow-up sent to a pi agent in its first seconds can lose its Enter. After `send`, brigade checks that a turn started within 20 seconds, and presses Enter once if the text is still in the input.
- The three overlapping commit checks (top folder, repo, git folder) each get a test that only they fail, and a mutation check.
- The e2e script's timeout path gets one real check, with a short `WAIT_SECONDS`.
- Auto-focus on `brigade start` gets one look by eye, at a time the owner chooses.

## Out of scope

Schedules (`herdr-automations` already does them), remote machines, resuming a worker whose terminal has exited, hooks, panel buttons, a merge tool, cloning repos, and the clean-setup option.

## Steps

Each step is a thin slice through every layer with its tests (guide W4), the gate and a commit. Steps that change agent behavior also get a real-agent run.

1. **Config store, lock and project tools** (Part 1). **Done 2026-11-09** (`5e8f41b`, `docs/e2e-runs.md`). Real check on Claude: the dictated request "add a project called demo2 at <path>, then add hello.txt there" adds the project and finishes the task.
2. **Notes** (Part 2). **Done 2026-11-09** (`ebc55dd` and the prompt fix after it, `docs/e2e-runs.md`). Real check: the owner says "remember: in demo, designs use little text and lots of white space". The note is saved, and the next task's worker prompt contains it. A worker's suggestion goes through the retro. A second run asks the Captain to note a code convention; it should start a task for `AGENTS.md` instead.
3. **Pull requests** (Part 3). **Done 2026-11-09** (`ce8547c`, `docs/e2e-runs.md`). First local adapter tests, then real checks on each harness against the GitHub test repo (owner's decision 3).
4. **Phase 1 gaps** (Part 4). **Done 2026-11-09** (`423f91b`, `e85a430`, `docs/e2e-runs.md`). The planned removal of the common-dir check was dropped: a test showed it is the only check that stops a forged git folder in `.git/worktrees`. The auto-focus look is recorded under step 5.
5. **Review and final runs:** a fresh code review of steps 1 to 4 (Codex `gpt-6.1-sol`, medium, read-only), then a run on each harness that uses all three parts. **Done 2026-11-09** (`docs/reviews.md`, `docs/e2e-runs.md`). The auto-focus look found it broken; it now uses herdr-app's peek.

## Proof matrix

| Guard or behavior | Test that fails without it | Mutation-checked | Real run |
| --- | --- | --- | --- |
| Config lock: two writers keep both changes | Two concurrent `add_project` calls | Yes | — |
| Agents can't change `owner`, `roles`, `repoRoots` | Tool rejects each field | Yes | — |
| Notes scoped to the caller's project | Foreign-project id, wrong role | Yes | — |
| One resolution per suggestion | Retried and racing resolutions | Yes | — |
| Budget: newest notes first, the rest counted and readable | Over-budget project | Yes | — |
| No publishing without a pinned `github` repo | Tool refuses | Yes | — |
| Agents can't change a project's `github` repo | `update_project` rejects it | Yes | — |
| Push only to the project's GitHub repo | `origin` pointing elsewhere; a url rewrite rule | Yes | — |
| Push only the task branch | No tags or submodules in the push arguments | Yes | — |
| No git hooks outside the sandbox | A pre-commit hook in the repo | Yes | — |
| No credentials in a refusal | Origin with a password | Yes | — |
| A lost or late lock never loses a write | Late reaper, slow writer, empty lock | Yes | — |
| A merge never overwrites a newer note | Change and merge at once | Yes | — |
| PR refresh ends in 15 seconds and is fair | Hanging GitHub; nine failing PRs | Yes | — |
| The extra Enter never sends other text | Owner's edit; text only in the output | Yes | pi, by hand |
| Never push to a merged or closed PR's branch | Reconcile finds it merged | Yes | — |
| Retry after a crash opens no second PR | Push done, create interrupted | Yes | — |
| Tasks keep their base branch | `update_project` during a task | Yes | — |
| Old events still read | Events from phase 1 | — | — |
| Domain and mod agree on notes and PRs | Shared-events test | — | — |
| Panel shows notes and PR chips | — | — | Screenshot (2026-11-09) |

Tests that use the network or real agents stay out of the gate (guide T12).

## Structure (guide part 3)

| Layer | New |
| --- | --- |
| `domain` | `notes.ts` (fold, budget), `pullRequests.ts` (PR state from events), project write rules in `config.ts` |
| `application` | `projects.ts`, `notes.ts`, `publish.ts` use cases; ports `ConfigStore`, `Repos` (find and inspect repos, push), `GitHub` (list, create, edit, view PRs) |
| `adapters` | `config/fileConfigStore.ts` (lock, atomic write), `git/` gains repo inspection and push, `github/ghCli.ts` |
| `mod` | reads `config.json` for projects; `model.js` gains notes and PR fields |

The publish use case calls git (through `Repos`) and GitHub (through `GitHub`) itself, so the two adapters never import each other (guide A1). No new dependencies: `gh` 2.103.3 is installed and signed in.

## Risks

- **A hand edit to `config.json` while agents run** can lose a change, because an editor ignores the lock. Hence the rule above and the `brigade project` command.
- **Publishing uses the owner's full GitHub login, with no switch (the owner's choice).** A worker in any GitHub-linked project can push its own task branch and open a PR in that project's pinned repo. Agents can add projects, so a confused Coordinator could add one of the owner's repos and publish there. The limits are code-enforced: one pinned repo per project, the task's own branch, fast-forward only, never forced, never to a merged or closed PR's branch, and every push and PR in the event log.
- **Notes can be wrong.** Prompts treat them as preferences, never permissions, and the owner can ask the Captain to remove one.

## Decisions (owner, 2026-11-09)

1. **Publishing:** like Box Yard. Any project whose `origin` is on GitHub may publish, pinned to that repo; no switch.
2. **Notes over the budget:** like Box Yard. Newest first within 20 notes and about 2,000 tokens; the rest counted in the prompt and readable with `read_notes`.
3. **Test repo:** Claude creates a private `smkamranqadri/brigade-e2e-sandbox` when step 3 starts, seeded with one commit on `main`. Before the runs, the script checks git can push to it (`git push --dry-run`), since a `gh` login does not by itself set up git's credentials.
4. **`repoRoots`:** `~/Repositories`.
