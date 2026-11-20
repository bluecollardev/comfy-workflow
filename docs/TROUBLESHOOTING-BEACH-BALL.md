# Troubleshooting: the beach ball (the window freezes)

## What it means here

The spinning beach ball on macOS means the app's **main process** did not answer the system for a
moment. RunPod Manager runs its core (`apps/runpod-dashboard/libs/core`) inside Electron's main
process, so any slow *synchronous* work there (walking a big folder with `readdirSync` and `statSync`,
unzipping with `spawnSync`, parsing a huge JSON file, copying a tree with `cpSync`) stops the window
from painting and from handling clicks until it finishes. Large local folders and a large state make
those walks long.

## The stall log

The app watches for this by itself, always, at no measurable cost: a timer ticks every 100 ms in the
main process, and when a tick is more than 300 ms late the loop was blocked. Each stall is one line in

```
~/.config/runpod-pod-manager/stalls.log        (POD_MANAGER_CONFIG_DIR changes the folder)
```

The file is JSON lines and is kept to the newest ~500 lines. It holds names and durations only: never
arguments, paths, keys or values. Code: `apps/runpod-dashboard/electron/stall-monitor.cjs`.

Three kinds of line:

```json
{"time":"2026-11-20T14:02:11.402Z","kind":"stall","lag_ms":1840,
 "calls":[{"name":"imports.plan","ms":1790,"ago_ms":60}],
 "ticks":[{"name":"autopublish.consider","ms":35,"ago_ms":900}]}
{"time":"...","kind":"slow_call","name":"panama.stageDrop","ms":4210}
{"time":"...","kind":"slow_tick","name":"queue.tick","ms":310}
```

- `stall`: the loop was late by `lag_ms`. `calls` are the IPC calls (`namespace.function`, the same name
  as in `electron/core.cjs`; `mcp.<tool>` for a tool of an MCP server the app hosts; `sync.plan` and
  `sync.count`) that ran in the 2 seconds before, with how long their **synchronous part** took and
  how long ago it ended. `ticks` are the core's timers (`queue.tick`, `autopublish.tick`,
  `autopublish.consider`, `autopublish.volumeTick`, `autosync.tick`, `podwatch.tick`).
- `slow_call` / `slow_tick`: one call or tick whose synchronous part alone blocked for more than 200 ms.
  This is the shortest path to the culprit: the `name` is the button or timer.

The time of a call is the part before its first `await`. A function that is async all the way down shows
a short time even if it is slow overall, which is what we want: only the part that blocks the window counts.

## How to read it

1. Open the file and look at the **biggest `ms`** among `slow_call` and `slow_tick` lines, and at which
   name repeats. That name is the code to fix.
2. A `stall` with a long `lag_ms` and no `calls` or `ticks` means the block was not in an IPC call or core
   timer: something in the window itself, in another module, or in a native dialog. Send the file anyway
   and use the macOS fallback below.
3. Send `stalls.log` (it holds no secrets) and say which click froze the window.

## macOS fallback: Sample Process

If the log does not name the cause:

1. Open **Activity Monitor**, find **RunPod Manager** (the main process, not a "Helper").
2. While the beach ball is showing, choose **Sample Process** (the gear menu, or double-click the process
   and press Sample).
3. When the sample finishes, **Save** the text file and send it with `stalls.log`.

The sample shows which function the main thread was inside for the whole time; the biggest stack with
`fs` or `spawnSync` near the top is the culprit.

## What has already been moved off the main loop

These ran synchronously and are now async, with the event loop yielded to between batches
(`libs/core/src/asyncfs.ts`):

- Local staged rounds (`panama.rounds`, round sizes and states): one async walk per round, kept for
  10 seconds while the round folder is unchanged.
- A round's file list (`panama.files`), dropping a folder or a zip onto Rounds (`panama.stageDrop`,
  copy and unzip), and deleting a staged round (`panama.remove`).
- The folder look the Adapter Studio and "Write adapter with Claude" use (`imports.draftPreview`,
  `studio.context`, `imports.describe`).
- `history.record` no longer reads and splits the whole history file after every event.
- The Publish status the window polls every second no longer carries every file of every job
  (the per-job `files` and `results`; `sha256_count` and the counts stay). Asking for one job by id, and
  the MCP `publish` tool, return the whole job as before.

Still synchronous (named by the log if they hurt): the Import plan and apply (`imports.plan`,
`imports.apply`), the sync plan, and the mounts and studio helpers.
