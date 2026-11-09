# The Brigade panel in herdr-app

`brigade mod install` copies `mod/` to `~/.config/herdr-app/mods/brigade` and writes `config.js`, which names the state folder (`BRIGADE_STATE`, default `~/.local/state/herdr-brigade`). It then runs `herdr-app check` on it.

Open the panel in either of these ways. Neither is needed for brigade itself: the Coordinator, Captains and workers run without the panel, and `brigade start` works from any terminal.

- **A window, with nothing else to set up:** `brigade panel` (it runs `herdr-app do mod.open --name brigade`; run it again to close).
- **A Brigade button beside Automations** (optional). This needs the `auto-tabs` mod, which draws the buttons above the side panel, and two edits to your own herdr-app config, which `brigade mod install` does not make:
  1. In `layouts/main-folders.json`, add `{ "id": "brigade", "type": "block", "content": { "mod": "brigade" } }` to the children of the `panel-body` stack, after `automations`.
  2. In `mods/auto-tabs/main.js`, add `"brigade"` to the `enabled` list after `"automations"`, and add `.child(panelButton("brigade", "Brigade", "mods/brigade/brigade.svg"))` after the Automations button.

When no Coordinator is running, the panel shows a **Start brigade** button. It runs `brigade start` for the config and state the panel reads (`START` in the installed `config.js`, written by `brigade mod install`), which starts the Coordinator and shows it over your tab. Otherwise the panel only shows. A click on a row shows that agent's terminal over your tab (herdr-app's peek), where you type to it; ↗ keep makes it a tab. `brigade start` also shows the Coordinator this way when herdr-app is on PATH. brigade's agents run without a pane, so they are not in herdr-app's Agents sidebar, and `agent.focus` has nothing to switch to.
