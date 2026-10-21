# Testing

One app, so one place: everything runs from `apps/runpod-dashboard` through
`./start.sh`. Nothing merges red (`.claude/rules/branching.md`).

| Suite | Command | What it covers |
|---|---|---|
| Core (Vitest) | `./start.sh core-test` | `libs/core`: mounts and the mapping, pod plans and the RunPod mutations, stock-aware card choice, datacenters and prices, the volume and its cost, idle decisions, no-spend simulation, governance, settings, per-pod configuration, git accounts, repositories, image env, the sync plan. Fake `fetch`, a scratch config dir per test (`tests/helpers.ts`). |
| Browser (Playwright) | `./start.sh e2e` | The Vue page against a fake API (`e2e/fixtures.js`, `page.route`): the panel, the form, the cards, toasts, the datacenter and card menus, the volume line, the step bar, per-pod configuration. Playwright starts Vite itself. Locators are `data-testid`; strings come from `src/locales/en.json` through `e2e/i18n.js`. |
| Electron, no-spend | `./start.sh e2e-app` | The real app through Electron with its own config folder, pods simulated, nothing bills: launching a pod, the whole lifecycle, every card action (details, idle stop, logs, own configuration, recreate), volumes and datacenters, the Connect modal, a configuration save, all over IPC. |
| Live proof | `./start.sh e2e-live` | One real pod on RunPod with the stock image, seen running, stopped and deleted by the test. Spends. `RUNPOD_LIVE_KEEP=1` leaves it stopped. |
| IPC table | `npm run ipc:test` in `apps/runpod-dashboard` | Pins every call the page makes to its namespace in the Electron dispatch table (`electron/core.cjs`); a call that falls out shows as "no core call …" in the app. |
| MCP server | `npm run mcp:test` in `apps/runpod-dashboard` | Spawns `mcp/server.mjs` in no-spend mode, performs initialize, tools/list and a tool call over stdio. |
| Smoke | `./start.sh smoke` | Boots the app headless, calls the core from the page, prints what loaded, quits. |
| ComfyUI image | `apps/comfy-app/check.sh` | The Mac install against the pins. |

**The merge gate** is `./start.sh test`: the core suite, the IPC table, the browser suite, then the app in no-spend mode.

Conventions: a test says what the user sees, not how the code does it; a
feature ships with its test in the same commit; the fake API grows with the
real one (`e2e/fixtures.js` answers every route the page calls, and can be
made slow or failing per route from a spec); no test reaches RunPod except the
live proof.
