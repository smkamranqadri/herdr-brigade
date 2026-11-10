---
description: Audit KIS for contradictions, staleness, and bloat, then propose a cleanup.
argument-hint: [optional area to audit]
---

# KIS Check

Audit project memory. Report first, change nothing until the user approves.

Full instructions: `.agents/skills/kis/SKILL.md`. Cleanup rules: `.agents/skills/kis/references/file-hygiene.md`.

## Checks

1. Structure: does `kis/` hold `knowledge/`, `intent/`, and `state/`, plus `reality/` once something has shipped, and is every file in the right layer? Is `kis/intent/private/`, when present, ignored by git?
2. Truth: does State contradict Intent, Reality, Knowledge, the repository, or the current branch? Does Reality match what the code actually does?
3. Duplication: is any fact stored in more than one place? Task status copied from a `Run:` live record into State is a finding.
4. Staleness: resolved blockers, completed ledgers, superseded plans, obsolete next actions, dead file or command references. A `Run:` line whose live-record file does not exist is a finding, and so is a `Run:` line that names no live record (State's how-to-run line is `How to run:`).
5. Recovery: can State answer branch, worktree, task, command, blocker, and next without reading anything else? A State with a `Run:` pointer line passes: the pointer answers task and next.
6. Size: is `kis/state/current.md` past roughly 80 lines, or is any file hard to skim?
7. Proof: is anything marked done without recorded proof?
8. Readability: does any file break `.agents/skills/kis/references/writing.md`? Look for a sentence past 20 words for an instruction or 25 for a description, two instructions in one sentence, a passive sentence that hides who acts, one thing named two ways, or detail before the answer.

## Report

```text
Health: good | drifting | stale

Contradictions:
- <file> - <claim> vs <source of truth>

Misplaced facts:
- <fact> - in <layer>, belongs in <layer>

Stale content:
- <file> - <what to prune>

Hard to read:
- <file> - <sentence or section> - <rule it breaks>

Missing:
- <what a fresh agent could not recover>

Proposed cleanup:
- <smallest set of edits>
```

Apply the cleanup only after the user approves. Then re-report the file sizes so the trend is visible.
