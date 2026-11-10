# KIS File Hygiene

Use this when creating, updating, or cleaning KIS files.

## Mutation Questions

Before creating a new file, ask:

1. Can an existing file be updated?
2. Does this information already exist?
3. Is it temporary or permanent?
4. Which KIS layer owns it?
5. Will this file reduce confusion or create maintenance burden?

Prefer updating over creating.

## Knowledge Evolution

Knowledge should evolve around concepts, not templates.

Examples:

```text
knowledge/
  project.md
  compass.md
  technical.md
  rules.md
```

or:

```text
knowledge/
  authentication.md
  deployment.md
  payments.md
```

Prefer names that help recovery. Avoid clever names.

## Reality

`reality/overview.md` summarizes the shipped features. A feature, or a group of features, gets its own file once it is worth describing. Known defects in what shipped go in `reality/defects.md`; remove one when its fix ships.

## Private Notes

Before writing to `kis/intent/private/`, make sure `.gitignore` covers it: those notes must never be committed.

## State Hygiene

On direction or status changes:

- rewrite `Now`
- rewrite `Next`
- rewrite `Status`
- remove stale operational text
- avoid appending new truth under old truth

State should carry:

- active branch, and the worktree when it is not the main one
- how to run it, as a `How to run:` line (`Run:` is reserved, see `SKILL.md`)
- current task
- current blocker
- next action
- a `Stamp:` line: the verbatim output of `scripts/state-stamp.sh <project root>` (the directory that holds `kis/`), run last in a sync, after the State rewrite is final, with no markdown around it and one `Stamp:` line only

Completed ledgers, resolved findings, and superseded plans belong in git history or short Intent notes, not lingering in State.

## Consistency Sweep

Run a consistency sweep when:

- user approves or rejects direction
- project pivots
- plan is replaced
- implementation approach changes
- task status changes materially
- deployment status changes
- a delegated agent reports KIS-relevant updates
- a feature ships

Rules:

- Mutable status lives in State.
- Approval/active/superseded/done status belongs in State.
- Long-lived docs should point to State instead of duplicating live status.
- Grep KIS for changed terms.
- Remove stale references.
- Fix contradictions immediately.

## Garbage Collection

Run cleanup when:

- State grows past roughly 80 lines
- any file becomes hard to skim
- roughly every 10 tasks
- plans pile up
- stale information causes confusion

Actions:

- dedupe repeated facts
- relocate stable facts from State to Knowledge
- relocate plans from State to Intent
- relocate the lasting description of a shipped plan to Reality
- mark old plans `SUPERSEDED - see <new plan>`
- prune obsolete blockers, stale notes, old ledgers, and outdated next items

If KIS only grows, it is becoming the documentation pile KIS exists to avoid.
