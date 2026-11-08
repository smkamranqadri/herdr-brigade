# Review guide

Read the plan (`docs/plan-phase-1.md`) and the diff. Do not read the implementer's summary first (guide W5, W9).

## Check

- **Relevance and completeness:** the diff does the step in the plan, all of it, and nothing more (guide W8).
- **Correctness:** wrong argv for a harness, a missed trust prompt, a message sent to the wrong terminal, a lost event.
- **Tests:** each use case and each adapter has a test; assertions are exact (guide T6); a new guard was mutation-checked (T7).
- **Security:** no secret in argv, logs or events; no write to the owner's global config; nothing that stops the owner's `hc` core or herdr-app.
- **Project rules:** the layer rules, the playbooks in `AGENTS.md`, and guide rules C3, C8, C12 and M2, by ID.

## Skip

Anything the formatter or linter already enforces, and taste in names.

## Severity

- `blocking`: must be fixed before merge.
- `suggestion`: worth doing; the implementer may decline with a reason.
- `nit`: small; fix if convenient.
