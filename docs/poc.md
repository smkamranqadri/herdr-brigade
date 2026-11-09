# The proof of concept (2026-11-08)

`poc/` is the throwaway code that tested the design in herdr-app before phase 1. It is kept as a record; brigade itself is in `src/`, `mod/` and `prompts/`.

Relaxed on purpose for the POC (guide rule P8): no layers, no tests beyond the run below, no hooks, no CI, and hard-coded paths in the mod. Phase 1 starts clean.

## Run it

Needs Node 22, `hc` and `herdr-app` on this computer, and Claude Code signed in.

```sh
node poc/launch.mjs --repo <a git folder> --project demo "Start one worker task: create hello.txt ..."
cp poc/mod/main.js poc/mod/mod.json ~/.config/herdr-app/mods/brigade-poc/
herdr-app do mod.open --name brigade-poc
```

## Parts

| File | What it does |
| --- | --- |
| `poc/launch.mjs` | Starts the Captain as an interactive `claude` in a new `hc` terminal. |
| `poc/mcp.mjs` | The brigade MCP server (stdio, no packages). Captain tools: `create_task`, `list_tasks`. Worker tools: `finish`, `ask_user`. |
| `poc/agents.mjs` | Writes each agent's MCP config and system prompt, and builds its `claude` argv. |
| `poc/hc.mjs` | Calls `hc`, and answers Claude's folder-trust prompt. |
| `poc/prompts/*.md` | The Captain and worker system prompts. |
| `poc/mod/` | The herdr-app mod: agents grouped by project, live status, latest events. |

## Result

Run on hc 0.1.18, herdr-app 0.1.13, Claude Code 2.1.319, `claude-sonnet-5-5` at low effort.

| Check | Result |
| --- | --- |
| 1. An `hc` terminal runs interactive `claude` with brigade's MCP server, and the agent calls a tool without a permission prompt | Pass. The Captain called `create_task`. |
| 2. `create_task` starts a worker as an `hc` child with labels | Pass. Worker `t98` had `brigade`, `project`, `task` and `role` labels. |
| 3. The worker's `finish` wakes the Captain, and the Captain reports | Pass. The report arrived 8 s after the worker started. `hello.txt` held exactly `hello from brigade\n`, checked with `od -c`. |
| 4. The mod shows the brigade live | Pass. A screenshot showed both agents, their status and five events. `herdr-app check` passed, and `herdr-app status` showed no errors. |

## What we learned

- **Trust prompt.** Claude asks whether to trust each new folder, and its default answer is "No, exit". Brigade answers Down, Enter. This adds the folder to the trusted list in `~/.claude.json`.
- **`hc --json` placement.** `--json` must come before `--`. After it, `hc` passes the flag to the program. This bug made the first Captain exit.
- **The MCP server knows its agent.** `HC_TERMINAL_ID` reaches the MCP server through Claude's environment, so a tool knows which terminal called it.
- **Reports arrive tagged.** `hc send` delivers text as `<hc from="t98 brigade-w-…">…</hc>`. The Captain treated it as a worker report, as its prompt says.
- **Your own Claude setup reaches the workers.** A Stop hook from your global Claude config ran in the worker. Your global `CLAUDE.md` and memory load there too. Box Yard keeps these out with `CLAUDE_CONFIG_DIR`. Phase 1 must choose.
- **Herdr already shows the tree.** The Agents sidebar nests the worker under the Captain, from the `hc` parent link alone.
- **Ghost text.** Claude showed a suggested prompt ("commit hello.txt") in the Captain's input. It was not sent.

## Not tested yet

`ask_user`, Codex workers, workers on another machine, several workers at once, a crash or restart, a Coordinator above Captains, and the timeouts in `hc.mjs` under a slow start.
