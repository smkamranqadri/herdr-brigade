# The Brigade panel in herdr-app

`brigade mod install` copies `mod/` to `~/.config/herdr-app/mods/brigade` and writes `config.js`, which names the state folder (`BRIGADE_STATE`, default `~/.local/state/herdr-brigade`). It then runs `herdr-app check` on it.

Open the panel in either of these ways:

- **A Brigade button beside Automations** (the owner's setup since 2026-11-09). This needs two edits to the owner's own herdr-app config, which `brigade mod install` does not make:
  1. In `layouts/main-folders.json`, add `{ "id": "brigade", "type": "block", "content": { "mod": "brigade" } }` to the children of the `panel-body` stack, after `automations`.
  2. In `mods/auto-tabs/main.js`, add `"brigade"` to the `enabled` list after `"automations"`, and add `.child(panelButton("brigade", "Brigade", "mods/brigade/brigade.svg"))` after the Automations button.
- **A window:** `brigade panel` (it runs `herdr-app do mod.open --name brigade`; run it again to close).

When no Coordinator is running, the panel shows a **Start brigade** button. It runs `brigade start` for the config and state the panel reads (`START` in the installed `config.js`, written by `brigade mod install`), which starts the Coordinator and shows it over your tab. Otherwise the panel only shows. A click on a row shows that agent's terminal over your tab (herdr-app's peek), where you type to it; ↗ keep makes it a tab. `brigade start` also shows the Coordinator this way when herdr-app is on PATH. brigade's agents run without a pane, so they are not in herdr-app's Agents sidebar, and `agent.focus` has nothing to switch to.
