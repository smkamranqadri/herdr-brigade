---
name: kis
description: Trigger this if the user says 'kis'.
metadata:
  version: "0.14.0"
---

# KIS

KIS is the project's operational memory. Keep it small and synchronized so a fresh agent can recover what the project is and where it is going, what shipped, what the user wants now, what is happening, and what is next.

```text
kis/
  knowledge/   stable facts: stack, architecture, design direction, domain terms, constraints, standards, durable decisions; project.md (purpose, audience, problem), compass.md (vision, North Star, principles)
  intent/      PRDs, plans, goals, acceptance criteria, user stories, backlog; private/ holds notes git ignores
  reality/     what shipped: features, their behavior, known defects; overview.md summarizes the features
  state/       branches, worktrees, tasks, blockers, commands, status, proof, next action
```

If `kis/` does not exist, read [bootstrap.md](references/bootstrap.md).

Write every KIS file in plain language, so a person can read it quickly and act on it. Before writing to `kis/`, read [writing.md](references/writing.md).

## Truth Hierarchy

```text
State > Intent > Reality > Knowledge > conversation > repository inspection
```

A layer ranks higher the more often it is kept current: State changes every session, Knowledge rarely. When sources contradict, fix the single source of truth instead of duplicating the fact.

## State

State should answer the recovery questions, near the top:

```text
What branch?  What worktree?  What task?  What command?  What blocker?  What's next?
```

Keep State lean: only what is happening now, so a fresh agent can read it in seconds.

When work runs in more than one worktree, the top fields describe the main work and each other worktree gets a `## <worktree>` block with its own Branch, Task, Blocker, and Next.

A `Run: <description>; live record at <path>` line in State means an orchestrator is mid-run: its live record, not State, holds Task and Next. Read [execution.md](references/execution.md) (Orchestrated Runs) before changing State. `Run:` is reserved for this pointer; the how-to-run line is `How to run:`.

State's `Stamp:` line fingerprints the code at the last sync. When the anchor or start reports `Stale State`, the code has moved on since: check State against the repo before trusting Task and Next, and say so in your report.

## Work Modes

Choose one before starting.

| Mode | Use for | Process |
| --- | --- | --- |
| Fast | quick lookup, small config or copy change, obvious bug fix, localized refactor | Load State, inspect only what matters, act, verify, then update whichever layer changed. No interview. |
| Standard | multi-file changes, normal feature work, unclear product changes, anything that changes KIS | Run the full loop below. |
| Phase | multi-session work, major refactor, architecture change, migration, deployment | Run the full loop, split into phases, verify each phase. Read [execution.md](references/execution.md). |

When a Fast Mode task turns out to be ambiguous or risky, stop and switch to Standard.

## Operating Loop

```text
LOAD -> QUESTION -> CHALLENGE -> STRUCTURE -> PLAN -> ACT -> SYNCHRONIZE
```

### LOAD

Read `kis/state/*`, then the relevant `kis/intent/*`, then only the required `kis/knowledge/*` and `kis/reality/*`. Inspect the repository only where KIS is unclear or looks stale.

Done when: you can answer the recovery questions without reading anything else.

### QUESTION

Interview the user relentlessly until you reach a shared understanding of the work. This is the step that prevents wasted implementation, so do not shortcut it by assuming.

- Ask one question at a time and wait for the answer: the decisions are the user's, and several questions at once are bewildering.
- Walk down each branch of the decision tree, resolving dependencies between decisions one by one.
- Give your recommended answer with every question, and say briefly why.
- If a fact can be found in KIS, the filesystem, the repository, or available tools, look it up instead of asking.

Skip the interview only in Fast Mode, and only while the task stays unambiguous and reversible.

Done when: the user confirms the understanding is shared.

### CHALLENGE

Challenge vague ideas, weak requirements, risky assumptions, missing edge cases, scope creep, and approaches heavier than the goal needs. Explain the practical tradeoff and offer a clearer path.

Done when: every assumption you are relying on has been put to the user.

### STRUCTURE

Route each fact to one layer: decided and stable to Knowledge, wanted to Intent, shipped to Reality, happening now to State. A bug in what shipped is a defect in Reality, a planned fix goes on the Intent backlog, and a bug in unshipped current work stays in State.

Done when: every new fact sits in exactly one layer.

### PLAN

Plan only enough to execute safely: scope, acceptance checks, risk, files likely involved, verification method, and whether a review is needed.

A written plan in `kis/intent/` is reviewed before ACT by a different CLI than its author, because a second model catches the gaps the author's model is blind to. Propose the harness, model, and effort to the user and get approval first. Record the outcome, or the user's waiver, in the plan's `## Review` section in the format [execution.md](references/execution.md) (Plan Review) owns.

Done when: the user has approved the scope and, for a written plan, `scripts/plan-review.sh check` passes. In Fast Mode, when the verification method is settled.

### ACT

Refuse a written plan whose `scripts/plan-review.sh check` fails. Update State with the current task, mode, status, and verification plan. Then implement only the current scope, avoid unrelated changes, and keep changes reviewable. For written plans and Phase Mode, read [execution.md](references/execution.md).

Done when: proof exists. See Proof Before Done.

### SYNCHRONIZE

Ask whether Knowledge, Reality, Intent, or State changed, and update only those files. Record proof in State when it helps recovery. Do not paste implementation history into KIS. For cleanup rules and when to run a consistency sweep, read [file-hygiene.md](references/file-hygiene.md).

Done when: every fact that changed sits in exactly one layer, and nothing left in `kis/` contradicts it.

## Proof Before Done

Never mark a task done from intuition, code inspection, or an agent report. Proof is test, build, lint, or typecheck output, a manual verification result, a screenshot or browser check for visible UI, a deployment check, or a failing reproduction that no longer fails.

```text
Proof:
- npm test - passed
- npm run build - passed
- Manual check: login flow works
```

If verification fails, record it in State as the current blocker instead of marking the task done.

## Commands

Each file in `commands/` is an explicit entry point into one step of this loop: `start` (LOAD), `plan`, `act`, `sync`, `check` (maintenance), and `init` (bootstrap). A command re-enters the loop; it is not a second workflow. For host adapters and the re-anchor layer, read [commands.md](references/commands.md).
