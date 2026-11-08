# Spike: Codex and pi as brigade agents

Date: 2026-11-08. Versions: hc 0.1.18, Codex CLI 0.167.0 (`gpt-6.1-terra`, low effort), pi 1.5.0 (`openai/gpt-6.1-sol`, low thinking), Claude Code 2.1.319 (from the POC).

Each harness ran one worker turn with the POC's MCP server. The task: write `hello.txt`, then call `finish`. A plain `cat` terminal stood in for the Captain. The spike scripts lived in a scratch folder and are not kept.

## Result

| Check | Claude Code | Codex | pi |
| --- | --- | --- | --- |
| Brigade MCP tool called with no prompt | Pass, with `--allowedTools mcp__brigade` | Pass, with `default_tools_approval_mode="approve"` | Pass, with an `-e` extension that calls `pi.registerMcpServer(..., { exposure: "direct" })` |
| The MCP server gets `HC_TERMINAL_ID` | Pass (inherited) | Pass, with `env_vars=["HC_TERMINAL_ID"]` | Pass (the extension passes it on) |
| `hc send` works from inside the MCP server | Pass | Pass: the `workspace-write` sandbox did not block it | Pass |
| File written, checked with `od -c` | Pass | Pass | Pass |
| `hc` status ends as `done` | Pass | Pass | Pass |

## Facts for the adapters

- **Codex tool approval** accepts `auto`, `prompt`, `writes` or `approve`. Codex listed these when it was given a wrong value. Brigade uses `approve`.
- **Trust prompts differ:**
  - Claude: "Yes, I trust this folder" is the second choice, so brigade presses Down, then Enter.
  - Codex: "Trust this folder?" and its first choice is "Trust and continue", so brigade presses Enter. Codex saves the decision.
  - pi: it asked nothing in a folder with no pi project files.
- **A startup idle comes before the first turn.** For Codex and pi, `hc wait` returned `idle` at turn 0, before the turn started. Brigade must not read the first idle as "done". It uses its own `finish` events, and the mod shows "starting" until turn 1.
- **The launch command name matters to `hc`.** The pi spike started with `env K=V pi …`, so `hc` named the agent `env`. Status still worked. Phase 1 will pass settings without the `env` prefix, for example through a flag that the extension registers, if pi allows it. If not, it uses a config file named in one variable.
- **The source of pi's status is not confirmed.** No installed pi extension sends the status signal (OSC 7501). `herdr-agent-state.ts` is the TUI integration and needs `HERDR_ENV=1`. `hc` probably detects pi itself.
- **Your shared setup reaches every harness**, as you chose:
  - Claude ran your Stop hook.
  - Codex read your engineering guide because of your global instructions. It also loaded `~/.codex/hooks.json`, which caused one warning about a SessionEnd timeout.
  - pi loaded your skills and extensions (herdr, lore, orca-*).

## Not tested

- A second message into a running Codex or pi agent through `hc send`. A Captain or Coordinator on those harnesses depends on this. Step 3 tests it first.
- Codex's trust prompt when brigade answers it automatically. In the spike I pressed Enter by hand.
