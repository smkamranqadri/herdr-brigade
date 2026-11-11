# The Brigade panel in herdr-app

`brigade mod install` copies `mod/` to `~/.config/herdr-app/mods/brigade` and writes `config.js`, which names the state folder (`BRIGADE_STATE`, default `~/.local/state/herdr-brigade`). It then runs `herdr-app check` on it.

Open the panel in one of these ways. None is needed for brigade itself: the Coordinator, Captains and workers run without the panel, and `brigade start` works from any terminal.

- **A column of its own (recommended).** It stays on screen in every space, because a layout block belongs to the window, not to a space. Add this block as the last child of the `root` row in a layout you own (clone `main` first with `herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`; shipped layouts are read-only):

  ```json
  { "id": "brigade", "type": "block", "size": { "px": 368 }, "min": 40, "max": 560, "content": { "mod": "brigade" } }
  ```

  Keep the id `brigade`: the panel's fold icon resizes the block with that id. The icon at the top right folds the column to a 44 px rail, as the left sidebar's icon does, and the rail keeps the brigade in view: the Coordinator, a letter for each project with its Captain's status, and a dot for each open task. A click on any of them opens that agent, and hovering names it. Dragging the edge below 160 px folds it too. To fold it with a key, add `"super-alt-b": "brigade.toggle"` to the `global` section of `keys.json` (pick another key if your window manager uses that one).

- **A window:** `brigade panel` (it runs `herdr-app do mod.open --name brigade`; run it again to close). A window has no column, so it has no fold icon.
- **A button in the side panel stack, beside Automations.** Avoid this one: herdr-app remembers the stack's shown child per space, so the panel goes away when you switch spaces. It also needs the `auto-tabs` mod and two edits to your own herdr-app config, which `brigade mod install` does not make:
  1. In your layout, add `{ "id": "brigade", "type": "block", "content": { "mod": "brigade" } }` to the children of the `panel-body` stack, after `automations`.
  2. In `mods/auto-tabs/main.js`, add `"brigade"` to the `enabled` list after `"automations"`, and add `.child(panelButton("brigade", "Brigade", "mods/brigade/brigade.svg"))` after the Automations button.

When no Coordinator is running, the panel shows a **Start brigade** button. It runs `brigade start` for the config and state the panel reads (`START` in the installed `config.js`, written by `brigade mod install`), which starts the Coordinator and shows it over your tab. Otherwise the panel only shows. A click on a row shows that agent's terminal over your tab (herdr-app's peek), where you type to it; ↗ keep makes it a tab. `brigade start` also shows the Coordinator this way when herdr-app is on PATH. It continues the Coordinator's last conversation, and `brigade start --new` starts a new one. brigade's agents run without a pane, so they are not in herdr-app's Agents sidebar, and `agent.focus` has nothing to switch to.

## Spaces, tabs and core keep (probed 2026-11-11)

Probed with herdr-app 0.1.15 and hc 0.1.20, with `sleep` terminals in a `brigade-probe` space. These facts are for phase 3b (`kis/intent/plan-phase-3b.md`).

| Command | What it did |
| --- | --- |
| `space.new {name, folder}` | Made the space and showed it. Its tab 1 got a shell terminal. It returned `{space, tab, terminal}`. |
| `space.select` then `terminal.keep {terminal, place: "tab"}` | Made the tab in the selected space and showed it. It added the labels `herdr.space` and `herdr.tab`. |
| `terminal.keep` | **Turned hc's core keep on** for that terminal. |
| `hc keep <t> --off` | Turned core keep off. It stayed off, and the tab stayed. |
| `tab.move {id, index: 1}`, `tab.select {id}` | Worked. |
| `tab.close {id, confirmed: true}` | Closed the tab and ended its terminal. |
| `space.close {id, confirmed: true}` | Closed the space and ended its terminals, kept ones too. |
| `hc kill` on a kept terminal with keep off | herdr-app removed its tab. When that was the last tab, it removed the space and showed the space shown before. |
| A child started with `--parent P` and without `--outlive-parent` | Ended when P ended. A child with `--outlive-parent` kept running. |

Why core keep matters: with keep on, hc puts a shell where a program was lost to a reboot. The owner's revive mod then resumes the agent in that shell with only the flags it carries, so a brigade agent would come back without its tool limits.

Not probed: what herdr-app and hc do with kept terminals after a window restart or a reboot.
