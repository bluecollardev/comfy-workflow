# ADR-051: Notifications are built on events: one event model, groups, and a choice per event and per channel

**Date:** 2026-11-19
**Status:** Proposed. Nothing is built yet; the decisions at the end are Lucas's.
**Context from:** Lucas ("our notifications should be built around a concept of events adr this. queues, pod actions (start / stop / etc), all of these things can be events. group events and allow group select / deselect all.").
**Extends / touches:** ADR-028 (every ability over MCP), ADR-046 (auto sync: its banner and errors), ADR-050 (publishing: the Slack settings), the History log (`libs/core/src/history.ts`: `pod`, `job` and `change` entries), the toast store (`src/stores/toast.js`). Binc's `agent-permissions.md` applies to anything that writes to Slack.

## Context

The app already tells the person things, but each thing does it its own way:

- **Toasts** for the result of a button (`toast.run`, `toast.error`), shown top right for 4 to 12 seconds, then gone.
- **Banners and badges**: the Auto sync progress banner, the Queue badge count, the pod card's watch lines.
- **The History** (a durable log of what happened on this PC): every pod action (`created`, `started`, `stopped`, `recreated`, `renamed`, `moved`, `deleted`), every job (`pull`, `remove`, `browse`, `erase`, `clone`, `fetch`, `delete-models`, `sync`, `run`, `queue`, `render`, `publish`, each `done`, `failed`, `cancelled` or `interrupted`) and every change (volume, configuration, import, adapter, pod).
- **Things nobody is told**: an idle stop that ended a pod, a Retry Later wait that found a card while the window was in the background, a queued import that held for its cost cap, a volume nearing full, a RunPod rate limit.

There is no place to choose *what* you hear about, no way to hear about something while the window is closed or in the background, and no channel beyond the window. Publishing (ADR-050) adds Slack as a destination, which makes the gap visible: a person who wants "tell me when a pod stops, and nothing else" has no way to say it.

## Decision

### 1. One thing: an event
An **event** is a small record the core emits when something worth knowing happens:

```
{ id (time-sortable), ts,
  type      'pod.stopped'          // group.name, from the catalog below
  group     'pod'
  severity  'info' | 'success' | 'warning' | 'error'
  title     'ComfyUI-Dev stopped'  // one line, from a template (i18n)
  body      'Idle for 30 minutes'  // optional, one or two lines
  subject   { kind: 'pod'|'queue'|'import'|'sync'|'render'|'publish'|'volume'|'app', id, name }
  data      { ... small, plain, no secrets }
  source    'app' | 'mcp' | 'auto'  // a person's click, an agent, or the app on its own
  correlates  id of the job/import it belongs to }
```

Events never carry a secret, a signed URL, a key, an `approved_by` of someone else's, or file contents. Names and ids only.

**The History becomes the first emitter, not a second system.** `history.record(...)` already runs for every pod action, job end and change; it gets one additive hook that turns each entry into an event of the matching type. History stays the durable audit ("what happened on this PC"); events are the live stream with delivery decisions. A few events are not History entries (a queue task moved, an idle warning, a watch found a card, Auto sync needs approval, free space is low); those are emitted directly by the code that knows.

### 2. The catalog: groups and types
Every event type belongs to one **group**. The first catalog (each type has a default of on or off, a severity and a title template):

| Group | Event types |
|---|---|
| **Pods** | created, started, stopped, recreated, renamed, moved, deleted · idle stop ended it · resume failed (host full) · a wait found a card · a wait gave up |
| **Queue** | import started · task started / finished / failed · task held (cost cap) · pod limit reached · import done / cancelled |
| **Runs** | a Run workflows job done / failed / cancelled |
| **Sync** | sync done / failed / cancelled · volume full / disk full · conflict found · needs approval (over the size gate) · Auto sync error (the third in a row) |
| **Generate** | previews batch done / failed · render job started / done / failed / cancelled · review version written · sequence refused as incomplete |
| **Publish** | published · done with a warning (Slack failed) · failed |
| **Storage** | volume resized / deleted / erased · models fetched · free space low |
| **Configuration** | configuration saved / imported · adapter saved · shot pack imported (default off) |
| **Money** | credits low · a cost cap reached · a pod has run longer than N hours |
| **App** | RunPod rate limit · RunPod unreachable · the core restarted · an update is available |

Types are added by adding a catalog row; a type unknown to a saved setting takes its default, so adding events never breaks anyone's settings.

### 3. Channels: where an event goes
| Channel | What it is | Default |
|---|---|---|
| **Toast** | the existing top-right toast | on for warnings and errors |
| **Inbox** | a bell in the nav with an unread count and a window listing events (filter by group and severity, mark all read); the last 500 or 7 days are kept on disk | on for everything that is on |
| **OS notification** | an Electron `Notification` when the window is in the background or closed to the tray | off, one click to turn on |
| **Slack** | a post to the Slack destination in the publishing settings (ADR-050) | **off**; see section 6 |
| **MCP** | `events { since, group, severity }` for agents, read-only | always available |

A rule says, per event type, which channels it uses. A **severity floor** per channel hides the quiet ones (for example Slack: errors only).

### 4. Choosing what you hear about
A **Notifications** section in the app-wide Settings, as a table: rows are groups (collapsible) and, under each, its event types; columns are the channels.

- Each cell is a checkbox. Each **group row has a three-state checkbox** per channel (all on / some / all off): clicking it **selects or deselects every event type in the group** for that channel.
- **Select all / Deselect all** for the whole table, and for each channel column.
- **Presets** at the top: *Quiet* (errors only), *Normal* (the defaults), *Everything*. A preset only sets checkboxes; nothing is locked.
- Stored in `notifications.json` in the app's config folder (atomic write, a schema version; a corrupt file starts from the defaults). Not part of a pod's configuration: it is about the person, not the pod. A **per-pod mute** (a pod's events go nowhere) is a later, small addition.

### 5. Behaviour rules
1. **Bursts become a digest.** An import that creates 20 pods emits 20 `pod.created`; within a short window (2 seconds) events of the same type and subject kind are delivered as one ("20 pods created"). The inbox keeps the individual events and shows the digest as a group.
2. **No double messages.** A toast that already comes from a button's own result (`toast.run`) stays; the event layer does not toast the same action again for events whose `source` is the person's click in the foreground, unless the event is a warning or an error. Over time the ad-hoc toasts are replaced by the toast channel, group by group.
3. **Live state is not an event.** The Auto sync banner, the Queue badge and the pod card's watch lines show *current state*; they stay. Events are *things that happened* and are never re-sent while state persists (the third Auto sync error is one event, not one per tick).
4. **Quiet and safe.** No event is sent for a failure that is retried silently and recovers (the aws and RunPod retries); the event for a transient failure is the *third* one in a row. Slack is rate limited (at most N posts per minute; beyond that, one digest line).
5. **Delivery never blocks.** The router is a pure function (`event + rules -> deliveries`), the channels run asynchronously with timeouts, and a failing channel never fails the action that caused the event.

### 6. Slack is governed
Binc's `agent-permissions.md` says "any write to Slack needs a named yes" and lists "Slack messaging" as on hold. A person-initiated publish (ADR-050) carries a named approver on every run. **A notification posts by itself**, so it cannot carry a per-post name. Therefore:

- The Slack **connection** (the Beinghuman workspace and its Incoming Webhook) is made once under **nav > Connect > Slack**, and publishing (ADR-050) and notifications both use it. The Slack channel for notifications is **off by default and has its own destination channel** (its own channel setting, separate from publishing).
- Turning it on needs a **named standing approval**: the person's name is recorded once (History `change` entry, shown in the settings: "Approved by Lucas on 2026-11-19"), and turning it off clears it.
- **Lucas confirms with Binc** before the first real notification post. Until then the channel can be configured and tested, not enabled.
- The Slack notification text carries names and counts only, never links to files.

### 7. Where it lives
- **Core:** `libs/core/src/events.ts` (the catalog, `emit`, the router, the ring buffer and `events.jsonl`, the settings), IPC `events.*` (`list`, `unread`, `markRead`, `settings`, `setSettings`) and a push channel `core:events` so the window updates at once; the History hook; the direct emitters.
- **Page:** the bell and inbox, the Settings table, and the toast channel.
- **MCP (ADR-028 parity):** `events` (list since a cursor, by group and severity) and `notification_settings` (get; set with the same rules as the window).
- **Tests:** the router as a pure function with fake channels (every rule, the digest window, the severity floors, the group checkboxes as data), the catalog (every History kind maps to an event type), and the Slack governance (cannot be enabled without the named approval).

### 8. Backfill: events from the initial state of the outputs
Events only exist from the day the app emits them, but the outputs already exist, and the client side asks what has been delivered (Kyle, 2026-11-19: "I can't find a finished shot anywhere we can see ... Upload finished shots to S3 returns/BKK/ as they are ... Naming can be fixed after"). So the app gets one **job: Scan outputs and backfill** that reads the *current state* and produces, after the fact, what would have been recorded had the app been watching:

1. **Scan** (read-only, async, by prefix, never the whole volume): the places finished work lives, each chosen in a checklist: this PC's `output/` (including `deliver/<shot>/v###/` and `.proxies/`), and on the volume `comfy-shared/output/`, `comfy-shared/input/pipe_finals/`, `project/90_DELIVERIES/`. Result: an **inventory**: one row per sequence or file (shot, name, kind (DPX sequence, review movie, proxy, other), frame count, bytes, modified time, where it is: this PC, the volume, or both, and whether it is already in the destination bucket).
2. **Events**: one event per row, with its original time (the file's modified time), of the types `output.found` (or `render.review_written` / `publish.published` when the files and sidecars say so), flagged `backfilled: true`, grouped by shot, so the inbox, the History and any channel show the real state of the project from day one. Re-running is idempotent (an event id is derived from the path and size, so nothing is duplicated).
3. **Publish as they are** (optional, the same job): upload the inventory's rows to the configured S3 destination with their **names unchanged** under the configured directory (for the BKK returns: `returns/BKK/`), skipping what is already there with the same size, using the publishing path of ADR-050 (the same plan the person sees, the same named approver, the same refusal of model weights). Files that are only on the volume are streamed through this PC to the bucket (no local copy needed; `aws s3 cp` to stdout piped to `aws s3 cp -` with `--expected-size`), a few at a time.
4. **Report**: a summary per shot (what was found, what went up, what was already there, what could not be read), kept as a file next to the upload (`returns/BKK/_inventory_<date>.csv`) so the client side can see exactly what exists, and, when Slack is enabled, one **status update** to the configured channel (counts per shot, total size, the destination, "uploaded as they are; naming to be fixed after") with the same named approval as any Slack post.

The scan answers "what exists and where" before anything is sent, which is the first thing the client side asked ("has anything reached Tunnel; where are the finished elements now"). The job never claims what it cannot see: a shot with no finished files shows as "none found", not as delivered.

### 9. Everything that runs is a job on the Queue, and every job is an event source (amendment 2026-11-19)
Lucas: "these generations are events too, and they really should be on the queue ... our queue should track this." Today the Queue window shows the **imports** (and, since v1.4.0, a **Syncs** section). The **Generate** window's work lives only inside that window: the preview batch (state in the page's `previewBus`) and the render jobs (the renders store). Closing the window hides them, and the Queue does not know about them. Decision:

1. **One job shape for the Queue.** Every long-running thing is a *job* with: `id`, `kind` (`import`, `sync`, `preview-batch`, `render`, `publish`, `backfill`, `erase`, `fetch`, `pull`, ...), a title, a subject (pod or shot), `state` (`queued`, `running`, `done`, `failed`, `cancelled`), progress (`done` of `total`, bytes, rate, current item), `started_at`, `finished_at`, a link to its log, and **Stop**. The Queue window lists them in sections by kind (Imports, Syncs, **Generations**, Publishing), newest first, with the same Stop, Logs and "open the thing" actions. The nav's Queue badge counts jobs that are running.
2. **Generations are two kinds of job.** *Previews* (the Generate window's "Generate all previews": N sequences, done, failed, Stop) and *Renders* (ADR-048: sequences, frames, rate, the adapter, `where`, kind proxy or review, and the pull and publish phases). Both appear on the Queue the moment they start, whichever window started them, and stay there after the window closes.
3. **A job's life is events.** A job emits `<kind>.started`, `<kind>.finished`, `<kind>.failed`, `<kind>.cancelled`: not one event per frame or per file, and no progress events (progress is the Queue's job). The catalog gains: **Generate: previews batch done / failed (with the failed count), render job started / done / failed / cancelled, review version written, sequence refused as incomplete.** The *Render* group of section 2 becomes *Generate* and covers both.
4. **The Queue is the live view, events are the record.** The Queue shows state; the inbox shows what happened. They share the job id, so an event links to its job (and the job to its events).
5. **Built on what exists.** The sync registry (`syncruns.ts`), the render registry (`renders.ts` jobs), the publish jobs and the queue's imports each keep their own store today; the Queue window reads them through one `jobs.list()` that merges them into the shape above (a thin adapter per kind, no rewrite). The preview batch moves from the page's `previewBus` into a store-level job (like the render job already is) so it survives closing the window.

## Phases
1. **The model**: the catalog, `emit`, the History hook, the inbox, the toast channel, and the Settings table with group select / deselect all and the presets.
2. **OS notifications** and the burst digest.
3. **Slack** (after Binc's answer) with its own destination and the standing approval.
4. **Per-pod mute**, quiet hours, the long-running and low-credit thresholds, MCP.

## Consequences
- One place decides what is said and where; adding a feature means adding catalog rows, not another banner.
- The History keeps its meaning; events add the live stream and the choice.
- It touches many emitters: the first slice (Pods, Queue, Sync, Render, Publish) covers what is most useful and the History hook gives the rest for free.
- A person who turns everything on will hear a lot; the digest, the severity floors and the presets are the answer.

## Decisions needed (Lucas)
1. **Defaults:** are *Pods* (started / stopped / idle stop) and *Queue* (task failed, held) on by default in the toast and inbox, with everything else inbox-only? (Proposed: yes.)
2. **OS notifications:** on from the start when the window is in the background, or opt-in? (Proposed: opt-in, one click.)
3. **Slack for notifications:** a separate channel from publishing (proposed), and the named standing approval; and who tells Binc.
4. **Retention:** the last 500 events or 7 days, whichever is smaller (proposed).
5. **Money events:** the thresholds for "credits low" and "a pod has run long" (proposed: credits under 24 hours of current spend; a pod running more than 12 hours).
6. **Per-pod mute:** in phase 1 or later? (Proposed: later.)
