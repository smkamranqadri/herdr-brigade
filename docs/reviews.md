# Reviews

## Phase 1, steps 2 and 3 (2026-11-08)

Reviewer: Codex CLI, `gpt-6.1-sol` at medium effort, read-only sandbox. It read `REVIEW.md`, the plan, `AGENTS.md`, the architecture note, the engineering guide and the diff `ee8c506..0d326c3`, but not the implementer's summary (guide W5).

Each finding was checked against the code before it was fixed. Each fix has a test, and each test was mutation-checked: undoing the fix makes that test fail, and the file was restored byte for byte (guide T7).

| ID | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| R1 | blocking | A worker's report could be logged before its `task_created` event, and then be dropped. | Fixed. `launchAgent` records the start event as soon as the terminal exists, before the trust wait. |
| R2 | blocking | A trust-prompt timeout was reported as a successful launch. | Fixed. `answerTrust` returns `answered`, `ready` or `timeout`; a timeout fails with the terminal's address. |
| R3 | blocking | A half-written last line in the event log broke every later read. | Fixed. An append after a fragment starts on a new line, and a read skips and reports damaged lines. |
| R4 | suggestion | A follow-up left a task as "asking" or "finished". | Fixed. A message to the worker puts the task back to "working". |
| R5 | suggestion | A JSON `null` line could crash an agent's MCP server. | Fixed. The server answers non-requests with Invalid Request and failures with Internal error, and keeps serving. |
| R6 | suggestion | The suppression count missed casts and config exemptions (guide C11, Q4). | Fixed. It now counts both. Six avoidable casts were removed; the baseline is 9 (4 `JSON.parse` casts at file and `hc` borders, 5 config exemptions). |

The reviewer could not run coverage or the two file-system adapter suites inside its sandbox, and ran no real agents. The implementer ran the full gate and both real-agent runs (`docs/e2e-runs.md`).
