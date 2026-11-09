# Security

## Reporting a problem

Please report security problems privately through GitHub's
[security advisories](https://github.com/smkamranqadri/herdr-brigade/security/advisories/new),
not in a public issue. Expect a first reply within a week.

## Threat model

herdr-brigade is built for **one owner** on their own computer. It starts coding agents (Claude Code, Codex, pi) that
run **as your user**, in your repos, with the permission level you set for each role. It is not a multi-user product.

Treat a worker like a junior developer with a shell on your machine:

- A Claude Code or pi worker has **no sandbox**. On `auto` or `bypass` it can run any command your user can.
- A Codex worker runs in Codex's `workspace-write` sandbox, unless its level is `bypass`.
- The Coordinator and Captains get no shell or file-edit tools, at any level. They only route work through brigade's
  tools.

Brigade's own tools (commit, push, open a pull request, change the config) run **outside** every agent's sandbox. They
are the privileged part, and the guards below are about them.

## How to run it safely

- **Pick permission levels on purpose.** `auto` lets a worker act without asking. Use `ask` for repos where a mistake
  is costly, and keep `bypass` for throwaway work.
- **Sign `gh` in with the least access you need.** Workers push and open pull requests with your `gh` and git
  credentials. Brigade never reads, prints or passes a token.
- **Review pull requests before you merge them.** Brigade has no merge tool; merging stays on GitHub, with you.
- **Don't edit `config.json` by hand while agents run.** Brigade's writes take a lock; a hand edit doesn't.

## Known limits

- **Folder trust is answered for you.** Claude Code and Codex ask whether to trust each new folder. Brigade answers yes
  for the folders it starts agents in, and each harness saves that in its own file (`~/.claude.json`,
  `~/.codex/config.toml`). Every worktree adds an entry.
- **Your global agent setup reaches the agents.** Your global `CLAUDE.md`, hooks and memory load in Claude Code agents,
  as they do in your own sessions.
- **Git hooks are off for sandboxed Codex workers.** Brigade commits and pushes for them outside the sandbox, and a hook
  manager (such as lefthook) runs commands from files the worker can edit. So those commits run no hooks, and the
  worker is told to run the repo's checks itself. Claude Code and pi workers have no sandbox, so their commits run your
  hooks as usual. See `docs/decisions.md`.
- **The event log is plain text.** `~/.local/state/herdr-brigade/events.jsonl` keeps tasks, messages, notes and pull
  request links. Don't put secrets in requests or notes.

## Safeguards

- **Commits land only in the task's own worktree.** Before it commits or pushes, brigade checks four things against
  the task's record (never the agent's word): the worktree's top folder, the repo it belongs to, its git folder, and
  its branch. Each check has a test that only it fails.
- **Pushes go only to the pinned repo.** A project's GitHub repo is pinned when it is added, from its `origin`, and no
  agent can change it. A push goes only to that repo, only the task's own branch, with no force, no tags and no
  submodules. A git URL rewrite rule that would send the push elsewhere is refused.
- **Merged or closed work stays closed.** Before every push, brigade asks GitHub about the branch's pull requests and
  refuses to push to a merged or closed one. A retry after a crash finds the existing pull request instead of opening
  a second.
- **Agents can't widen their own powers.** Each role gets only its own tools, every tool checks the caller's project,
  and tools reject unknown arguments, so an agent can't set `owner`, `roles`, `repoRoots` or a project's GitHub repo.
- **No credentials in messages.** A refused remote URL is shown without any user name or password.
- **Config writes are locked.** Writes from any number of brigade processes go one at a time, under a lock file, so none is lost
  or half-written. A lock left by a crash is taken over after 30 seconds.
- **Reviewed.** Three independent code reviews and a plan review, with every finding and its fix, are recorded in
  `docs/reviews.md`.
