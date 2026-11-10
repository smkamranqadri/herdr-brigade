# KIS Execution

Use this for written plans, Standard Mode with meaningful risk, Phase Mode, and orchestrated runs.

## Setup

Before execution:

1. Confirm or create a feature branch when the repo uses branches.
2. Keep a short progress ledger in `kis/state/current.md`.
3. Pre-flight the plan for contradictions.
4. Raise blocking contradictions before starting.
5. Choose the smallest capable agent/model for each role.
6. Record the execution approach in State when useful.

## Plan Self-Review

Before coding, check:

- Does every requirement map to a task?
- Are commands exact?
- Are file paths clear where needed?
- Are acceptance checks clear?
- Are risky assumptions called out?
- Is the task small enough to execute safely?
- Can a fresh agent understand it without the full conversation?
- Does the plan avoid unrelated changes?

If the plan is weak, improve it before implementation. This is the author's own pass; the external review and its record follow it (see `SKILL.md`, PLAN).

## Plan Review

A written plan carries a `## Review` section; `scripts/plan-review.sh check <plan>` enforces it. This section owns the format and the rules.

```text
## Review
- Reviewed: <YYYY-MM-DD> by <cli> <model> (<effort>); plan hash <12 hex>
- [fixed] <finding> - <what changed>
- [rejected] <finding> - <reason>
- [open] <finding>
```

- A waiver is `- Reviewed: waived by the owner <YYYY-MM-DD>; plan hash <12 hex>`. Only the user waives.
- Each finding carries exactly one tag: `[fixed]`, `[rejected]` (with a reason) or `[open]`. Any `[open]` finding fails the check.
- Resolve every finding with the user where it changes scope.
- Take the hash last, from `plan-review.sh hash <plan>`, after the plan is final: any later edit to the plan's substance voids the review.
- A plan with no Review section (for example one written before the review existed) is unreviewed like any other: review it, or get the user's waiver and record the waiver line.
- Mark a task done only by ticking its `[ ]` to `[x]` or by a `Status:` line. Any other edit to the plan (a "(done)" suffix, strikethrough, an emoji) voids the review and the next ACT refuses the plan.

## Per-Task Loop

For each task or cohesive task group:

```text
PICK -> IMPLEMENT -> VERIFY/REVIEW -> RESOLVE -> INTEGRATION CHECK -> FINISH
```

### PICK

Select the next unfinished task from the plan. Keep it small enough to review.

### IMPLEMENT

Use a fresh implementer when available and useful. Otherwise implement directly only when the user accepted fallback risk or the work is small enough for Fast Mode.

The implementer should receive:

- assigned task
- relevant files
- interfaces it needs
- acceptance criteria
- commands to run
- Knowledge/Intent constraints
- instruction not to modify `kis/`

### VERIFY / REVIEW

Use a separate reviewer when changes are non-trivial, risky, or visible to users.

The reviewer checks:

- diff against the plan/spec
- correctness
- missing edge cases
- code quality
- maintainability
- tests
- regressions

Tag findings:

```text
Critical
Important
Minor
```

Resolve Critical and Important findings or get explicit user acceptance of the risk.

### UI / UX Review

For visible UI, user flow, interaction, hierarchy, forms, navigation, or empty/error/loading states, evaluate the actual UI.

Acceptable proof:

- live preview inspected
- screenshots captured
- responsive/device checks where relevant
- accessibility basics checked

Text descriptions are not enough for visual UI acceptance.

### INTEGRATION CHECK

Verify behavior that unit tests cannot prove:

- UI rendering
- browser flow
- animation
- deployment behavior
- auth callback
- webhook/payment behavior
- mobile/responsive behavior
- generated files

### FINISH

Only when review and verification are clean:

- mark the task done in the plan (tick `[ ]` to `[x]` or add a `Status:` line, nothing else; see Plan Review)
- append a short State ledger line when useful
- record proof
- synchronize KIS
- move to the next task

## After All Tasks

When all tasks are complete:

1. Run final review.
2. Run final verification commands.
3. Confirm acceptance criteria.
4. Clean stale State.
5. Update Intent if the plan outcome changed.
6. Describe what shipped in Reality.
7. Update Knowledge only for stable new understanding.
8. Prepare a concise final summary.

## Orchestrated Runs

A `Run: <description>; live record at <path>` line in State means an orchestrator is mid-run, and the file it names is the live record for task status and the next action.

- While the run is active, take the current Task and Next from the live record, not from State or the conversation.
- A live-record path that does not exist is a contradiction to report.
- State keeps the pointer and one proof line per merged unit of work.
- KIS steps never copy task status from the live record into State and never remove the `Run:` line.
- The orchestrator removes the `Run:` line when the run closes, then flushes the run's decisions to Intent.
- `Run:` is reserved for this pointer. State's line on how to run the project is `How to run:`, and a `Run:` line that names no live record is not a pointer.
