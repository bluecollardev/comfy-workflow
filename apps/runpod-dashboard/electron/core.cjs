// The core (libs/core, docs/ADR-005) in the main process, exposed to the page over IPC.
//
// One channel, 'core', one dispatch table below: namespace -> function -> what it calls. The
// renderer's api/*.js modules route here when window.core exists (Electron) and over HTTP
// otherwise (browser, hot reload, the Playwright suite). Errors come back as {ok:false, error}
// so the page gets the core's message, not Electron's wrapping.
const path = require('node:path')
const fs = require('node:fs')
const { ipcMain, app, shell, BrowserWindow, dialog } = require('electron')
const { createSyncJobs } = require('./sync-jobs.cjs')
const { createMcpHost } = require('./mcp-host.cjs')
const { createStallMonitor } = require('./stall-monitor.cjs')

// Event-loop stall monitor (docs/TROUBLESHOOTING-BEACH-BALL.md): stalls.log in the config folder names what ran when the window froze.
const monitor = createStallMonitor({ file: path.join(process.env.POD_MANAGER_CONFIG_DIR || path.join(require('node:os').homedir(), '.config', 'runpod-pod-manager'), 'stalls.log') })

let core = null
let stopIdle = null

async function loadCore() {
  if (core) return core
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'core', 'index.js')
    : path.resolve(__dirname, '..', 'libs', 'core', 'dist', 'index.js')
  core = await import(require('node:url').pathToFileURL(file).href)
  // The history is pushed: every event recorded tells the windows (one message per burst), so the History window refreshes by itself.
  let timer = null
  const push = () => { if (timer) return; timer = setTimeout(() => { timer = null; for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('core:history', {}) }, 250) }
  core.history.onChange(push)
  core.ticks?.setTickHook((name, fn) => monitor.tick(name, fn))   // the core's timers (queue, auto-publish, auto sync, pod watches) are named in stalls.log
  core.queue.start()   // ADR-038: the round-import queue runs while the app is open
  // ADR-056, "Re-attach after a restart": chunked runs another process left on a pod are continued here (only the app adopts; the MCP server and the CLI never do)
  core.reattach?.adoptAll().then((rs) => { for (const r of rs) if (r.outcome !== 'skipped') console.log(`re-attach: ${r.outcome}: ${r.path || r.id}: ${r.reason}`) }).catch((e) => console.error(`re-attach failed: ${e.message}`))
  core.autopublish.start().catch(() => undefined)   // ADR-050: Auto-publish (off unless a person turned it on): its scheduler and the 60 s look for approved review videos
  core.autosync.start()   // ADR-046: Auto sync's timer (pulls for pods with it on) and the volume reconciler run while the app is open
  core.pods.startWatches()   // ADR-042 section 19: a pod waiting for a free card is tried again while the app is open
  // Events written by another process (the MCP server of another session, the CLI) arrive through the file.
  try { const hf = core.paths.historyFile(); require('node:fs').mkdirSync(path.dirname(hf), { recursive: true }); require('node:fs').watch(path.dirname(hf), (_ev, name) => { if (name === path.basename(hf)) push() }) } catch { /* in-process changes still push */ }
  return core
}

// The app's sync jobs: the cards (IPC below) and the MCP servers the app hosts (mcp-host.cjs) run and read the same ones.
const syncJobs = createSyncJobs({
  loadCore: () => loadCore(),
  broadcast: (payload) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('core:sync', payload) },
})

// The MCP servers served from this process (Connect › MCP, "Serve from the app"); built on first use, after main.cjs has set MCP_DIR.
let mcpHost = null
function host() {
  if (!mcpHost) mcpHost = createMcpHost({ loadCore: () => loadCore(), syncJobs, timeTool: (name, fn) => monitor.call(`mcp.${name}`, fn), mcpDir: process.env.MCP_DIR || path.resolve(__dirname, '..', 'mcp', 'dist'), preferBundle: !!app?.isPackaged })
  return mcpHost
}
const served = () => (mcpHost ? mcpHost.status() : {})

/** namespace -> fn -> (core, ...args) => value */
const TABLE = {
  mounts: {
    get: (c) => c.mounts.payload(c.mounts.load()),
    put: (c, cfg) => c.mounts.put(cfg),
    preview: (c, cfg) => c.mounts.preview(cfg),
    reset: (c) => c.mounts.payload(c.mounts.reset()),
    env: (c) => c.mounts.envLines(c.mounts.load()),
    dirs: (c, p, hidden, filter) => c.listDirs(p || '', !!hidden, String(filter || '')),   // async with a 15 s timeout and a 2,000-folder cap; `filter` narrows a huge folder before the cap
    volumes: (c) => c.listVolumes(),   // the volumes mounted on this PC (the folder picker's side list); a mount that does not answer is listed unreadable, never waited for
  },
  pods: {
    dashboard: (c) => c.pods.dashboard(),
    list: (c) => c.pods.list(),
    get: (c, id) => c.pods.get(id),
    // Only the hosts the pod has to clone from get a credential (GIT_CREDENTIALS), as the Python API did.
    create: async (c, req) => c.pods.create(req, undefined, req.custom_nodes?.length ? await c.git.credentialsEnv(req.custom_nodes.map((n) => n.url || '')) : {}),
    stop: (c, id) => c.pods.stop(id),
    resume: (c, id) => c.pods.resume(id),
    // Retry later (ADR-042 section 19): keep trying to resume or create until RunPod has a free card.
    resumeWhenFree: (c, id, opts) => c.pods.resumeWhenFree(id, opts || {}),
    createWhenFree: (c, req, opts) => c.pods.createWhenFree(req, opts || {}),
    createLikeWhenFree: (c, id, gpu, opts) => c.pods.createLikeWhenFree(id, gpu, opts || {}),
    watches: (c) => c.pods.watches(),
    cancelWatch: (c, id) => c.pods.cancelWatch(id),
    remove: (c, id) => c.pods.remove(id),
    gpus: (c, dc) => c.pods.gpuMenu(undefined, dc || undefined),
    volume: (c, id) => c.pods.volumeInfo(id || undefined),
    datacenters: (c, fresh) => c.pods.datacenters(undefined, !!fresh),
    setIdle: (c, id, minutes) => c.pods.setIdleStop(id, Number(minutes)),
    rename: (c, id, name) => c.pods.rename(id, name),
    setRound: (c, id, round) => c.pods.setRound(id, round || ''),
    setShot: (c, id, shot) => c.pods.setShot(id, shot || ''),
    renameRound: (c, round, name) => c.pods.renameRound(round, name || ''),
    deleteRound: (c, round) => c.pods.deleteRound(round),
    rounds: (c) => c.pods.rounds(),
    credits: (c) => c.pods.credits(),

    details: (c, id) => c.pods.details(id),
    recreate: (c, id) => c.pods.recreate(id),
    config: (c, id) => c.pods.config(id),
    setConfig: (c, id, cfg) => c.pods.setConfig(id, cfg),
  },
  history: {
    list: (c, kind, limit) => c.history.list({ ...(kind ? { kind } : {}), ...(limit ? { limit: Number(limit) } : {}) }),
    spend: (c) => c.history.spend(),
    note: (c, o) => c.history.note(o),   // a window's own History line (change / outputs only, strings only)
    runs: (c, podId) => c.comfyruns.runs(podId),
    saved: (c, q) => c.outputs.saved(q || {}),
    export: (c, opts) => c.history.exportHistory({ format: opts && opts.format, what: opts && opts.what }),
    logs: (c, podId, opts) => c.comfyruns.logs(podId, opts || {}),
    outputSources: (c, ctx) => c.outputsources.availability(ctx || {}),   // docs/ADR-045: which output sources can answer now, and why not
    listOutputs: (c, ctx, o) => c.outputsources.listOutputs(ctx || {}, o || {}),   // `all: true` lists the whole volume output/ tree in one listing (ADR-045); with `job: true` it returns { job_id } for outputsStatus
    outputsStatus: (c, jobId) => c.outputsources.jobStatus(String(jobId || '')),   // { state, files_seen, folders_seen, elapsed_s, result? }
    outputsCancel: (c, jobId) => c.outputsources.jobCancel(String(jobId || '')),   // all of them merged, or one `source`; `prefix` browses the volume
  },
  ratelimit: {
    status: (c) => c.ratelimit.status(),   // RunPod's request limit: local state, no request to RunPod
  },
  volumes: {
    list: (c) => c.volumes.list(),
    create: (c, input) => c.volumes.create(input),
    resize: (c, id, size) => c.volumes.resize(id, Number(size)),
    remove: (c, id) => c.volumes.remove(id),
    useAsDefault: (c, id) => c.volumes.useAsDefault(id),
    setShared: (c, id) => c.volumes.setShared(id || ''),
    plan: (c, id) => c.podpull.volumePlan(id),   // what a browse or erase on this volume would run on and cost
    browse: (c, id, path) => c.podpull.browseVolume(id, path ? { path } : {}),
    erase: (c, id, keys, o) => c.podpull.eraseVolume(id, keys || [], o || {}),
    clone: (c, id, o) => c.podpull.cloneVolume(id, o || {}),
    job: (c, id) => c.podpull.job(id),
    jobs: (c) => c.podpull.volumeJobs(),   // the volume jobs (fetch, delete, erase, clone, browse) and the pods of ones lost at a restart (ADR-042 section 16)
    dropInterrupted: (c, name) => c.podpull.dropInterrupted(name),
    reattach: (c, name) => c.podpull.reattach(name),   // follow a fetch the app lost (or could not reach) on its pod again (ADR-042 section 17)
    cancel: (c, id) => c.podpull.cancel(id),
    changes: (c, o) => c.journal.list({ volume_id: (o && o.volume_id) || c.mounts.load().shared_volume_id || c.mounts.load().network_volume_id, since: o && o.since, prefix: o && o.prefix, limit: o && o.limit }),   // ADR-046: the volume's change feed (read-only, no pod)
    erasable: (c) => Object.entries(c.podpull.ERASABLE).map(([key, e]) => ({ key, label: e.label, path: e.path })),
  },
  autosync: {   // docs/ADR-046: pull a volume's changes (and push this PC's) by themselves; all answers are plain JSON
    get: (c, podId) => c.autosync.get(podId),
    set: (c, podId, settings) => c.autosync.set(podId, settings || {}),   // enabled: true needs approved_by (a named yes)
    status: (c) => c.autosync.status(),
    pause: (c, on) => c.autosync.pause(!!on),
    syncNow: (c, podId) => c.autosync.syncNow(podId),
    approve: (c, podId, yes) => c.autosync.approve(podId, yes === true),
    dismiss: (c, podId) => c.autosync.dismiss(podId),
  },
  sync: {   // docs/ADR-011 "Leaving folders out": the top-level folders of each push step, and the size of one on demand (the copy itself runs through core:sync:* below)
    folders: (c, o) => c.syncfolders.folders(o || {}),
    measure: (c, o) => c.syncfolders.measure(o || {}),
    measureCancel: (c, id) => c.syncfolders.measureCancel(String(id || '')),
  },
  syncs: {   // docs/ADR-046 "Sync explorer and logs": every sync run (manual and automatic), its log, and what the watchers do; all from memory except a finished run's log
    active: (c) => c.syncruns.registry.active(),
    recent: (c, podId, limit) => c.syncruns.registry.recent(podId || undefined, limit ? Number(limit) : 20),
    log: (c, runId, o) => c.syncruns.registry.log(String(runId || ''), o || {}),
    watch: (c) => c.autosync.watch(),
  },
  storage: {   // docs/ADR-063 Storage adapters: S3-compatible places files go to (publish mirrors) and come from; Wasabi and your own are records, never code
    list: (c) => c.storage.list(),
    save: (c, o) => c.storage.save(o || {}),   // a destination and its keys are entered by a person in the window
    setEnabled: (c, id, on) => c.storage.setEnabled(String(id || ''), !!on),
    remove: (c, id) => c.storage.remove(String(id || '')),
    test: (c, id) => c.storage.test(String(id || '')),
  },
  autopublish: {   // docs/ADR-050 Auto-publish: approved review videos are uploaded by themselves under a standing, named approval; off by default
    status: (c) => c.autopublish.statusNow(),
    settings: (c) => c.autopublish.settings(),
    hold: (c, o) => c.autopublish.hold(o || {}),   // a held shot version is never auto-published until a person releases it
    release: (c, o) => c.autopublish.release(o || {}),
    holds: (c) => c.autopublish.holds(),
    dryRunReport: (c) => c.autopublish.dryRunReport(),   // the text the dry-run Slack summary would post (preview, posts nothing)
    generateExisting: (c, o) => c.autopublish.generateExisting(o || {}),   // preview without confirm; a confirmed run starts renders (a pod needs a name)
    setSettings: (c, o) => c.autopublish.setSettings(o || {}),   // on needs approved_by and understood: true; live needs a fresh name
    off: (c) => c.autopublish.offCount(),
    reviews: (c) => c.autopublish.reviews(),
    approvals: (c) => c.autopublish.approvals(),
    approve: (c, o) => c.autopublish.approve(o || {}),
    revoke: (c, o) => c.autopublish.revoke(o || {}),
    cancel: (c, o) => c.autopublish.cancel(o || {}),
    publishNow: (c, o) => c.autopublish.publishNow(o || {}),
    publishAllDry: (c, o) => c.autopublish.publishAllDry(o || {}),
    purgeDryRuns: (c, o) => c.autopublish.purgeDryRuns(o || {}),
    restoreDryRuns: (c) => c.autopublish.restoreDryRuns(),
    scanVolume: (c) => c.autopublish.scanVolume(),   // "Scan now": list the volume's deliver/ (one level at a time) for finished reviews
  },
  runningjobs: {   // jobs other processes (the MCP server, a script) are running, from the shared running-jobs file; cancel asks their owner
    external: (c, o) => ({ jobs: c.jobsregistry.externals(o && o.kind || undefined) }),
    cancel: (c, id) => c.jobsregistry.requestCancel(String(id || '')).then((found) => ({ ok: found })),
  },
  failures: {   // graph failures, logged (failures.jsonl in the config folder: the audit record, never edited here)
    list: (c, o) => c.failures.list(o || {}),   // { dismissed: 'hide' (default) | 'only' | 'all', limit, since, shot, job_id }
    retry: (c, id) => c.failures.retry(String(id || '')),   // run a RETRYABLE failed graph again (at most twice); a graph or validation error is never retried
    plan: (c, o) => c.failures.plan(o || {}),   // how many a dismiss or restore would cover (nothing written)
    dismiss: (c, o) => c.failures.dismiss(o || {}),   // hide by id (or all shown) from the Queue: an id in failures-dismissed.json, the log is untouched
    restore: (c, o) => c.failures.restore(o || {}),   // show them again (ids or all)
  },
  edl: {   // docs/ADR-050: the V11 edit list (CMX3600) decides timecode, frame count and what may be delivered; read-only from the exchange bucket, cached with its sha256
    load: (c, o) => c.edl.load(o || {}),
    status: (c) => c.edl.ensure().then(() => c.edl.status()),
    elements: (c) => c.edl.ensure().then(() => ({ elements: c.edl.elements(), status: c.edl.status() })),
    lookup: (c, o) => c.edl.ensure().then(() => c.edl.lookup(o || {})),
  },
  publish: {   // docs/ADR-050: send finished outputs to S3 and Slack; a person's explicit act (approved_by on every run); secrets never returned
    settings: (c) => c.publish.settings(),
    setSettings: (c, input) => c.publish.setSettings(input || {}),
    test: (c, o) => c.publish.test(o || {}),
    local: (c, o) => c.publish.local(o || {}),
    plan: (c, o) => c.publish.plan(o || {}),
    run: (c, o) => c.publish.run(o || {}),
    status: (c, jobId) => c.publish.status(jobId || undefined, { summary: true }),   // the window polls this every second: without an id the per-file lists are left out (an id returns the whole job; the MCP tool is unchanged)
    cancel: (c, jobId) => c.publish.cancel(String(jobId || '')),
    slack: (c, o) => c.publish.slack(o || {}),
    rounds: (c) => c.publish.rounds(),   // the rounds already in the destination (BKK return), newest name first
    retry: (c, childId) => c.publish.retry(String((childId && childId.child_id) || childId || '')),   // one failed shot again, alone
    volume: (c, o) => c.publish.volume(o || {}),   // one level of the volume's comfy-shared/output/ (S3, read-only), with an `empty` flag per folder
    volumeSize: (c, o) => c.publish.volumeSize(o || {}),   // files and bytes under one volume folder, on demand, cached 5 minutes
    volumeSizeCancel: (c, o) => c.publish.volumeSizeCancel(o || {}),
    backfill: (c, op, o) => { const p = c.publish, x = o || {}; if (op === 'scan') return p.scan(x); if (op === 'inventory') return p.inventory(x.job_id || undefined); if (op === 'plan') return p.backfillPlan(x); if (op === 'run') return p.backfillRun(x); throw Object.assign(new Error('op is scan, inventory, plan or run'), { status: 400 }) },   // ADR-050 Backfill: what the outputs hold, then upload them as they are
  },
  applogs: { list: (c) => c.applogs.list(), read: (c, name, o) => c.applogs.read(String(name || ''), o || {}), purge: (c, o) => c.applogs.purge(o || {}) },   // the application's own log in the config folder
  podlogs: { save: (c, podId, o) => c.podlogs.save(String(podId || ''), o || {}), list: (c, o) => c.podlogs.list(o || {}), read: (c, name, o) => c.podlogs.read(String(name || ''), o || {}), purge: (c, o) => c.podlogs.purge(o || {}) },   // pod logs kept in the config folder, never deleted
  dpxfix: { run: (c, o) => c.dpxfix.run(o || {}), plan: (c, o) => c.dpxfix.plan(o || {}) },   // corrected copies of DPX frames for delivery (Tunnel V11 plan, section 9)
  manifestcheck: { check: (c, o) => c.manifestcheck.check(o || {}), plan: (c, o) => c.manifestcheck.plan(o || {}), run: (c, o) => c.manifestcheck.run(o || {}) },   // RETURN-MANIFEST.json checked and rebuilt from the element manifests (ADR-055 section 14)
  dpxmake: { run: (c, o) => c.dpxmake.run(o || {}), plan: (c, o) => c.dpxmake.plan(o || {}) },   // unpack a master video into a 16-bit DPX sequence on the pod (Tunnel V11 plan, section 12 step 2)
  runsplit: { plan: (c, o) => c.runsplit.plan(o || {}), start: (c, o) => c.runsplit.start(o || {}), status: (c, o) => c.runsplit.status((o || {}).job_id), cancel: (c, o) => c.runsplit.cancel((o || {}).job_id) },
  framepreviews: { start: (c, o) => c.framepreviews.start(o || {}), status: (c, o) => c.framepreviews.status(o || {}), cancel: (c, o) => c.framepreviews.cancel(o || {}), relaunch: (c, o) => c.framepreviews.relaunch(o || {}), list: (c, o) => c.framepreviews.list(o || {}), jobs: (c, o) => c.framepreviews.jobsList((o || {}).limit), cancelAny: (c, o) => c.framepreviews.cancelAny(o || {}) },   // frame previews of DPX sequences, made on the pod as small JPEGs (a job)
  renders: {   // docs/ADR-048: DPX sequences rendered into mp4 proxies (on the pod, or on this PC), kept on the volume and on this PC
    plan: (c, o) => c.renders.plan(o || {}),
    start: (c, o) => c.renders.start(o || {}),
    status: (c, jobId) => c.renders.status(jobId || undefined),
    cancel: (c, jobId) => c.renders.cancel(String(jobId || '')),
    retry: (c, jobId) => c.renders.retry(String(jobId || '')),
    proxies: (c, o) => c.renders.proxies(o || {}),
    clearLocal: (c) => c.renders.clearLocal(),   // only files inside the mapped local output/.proxies
  },
  governance: {
    summary: (c) => c.governance.summary(),
  },
  settings: {
    get: (c) => c.settings.get(),
    checkAnthropic: (c, typed) => c.settings.checkAnthropic(typed || null),
    set: (c, values) => { const r = c.settings.set(values); if (process.env.RUNPOD_API_KEY && !stopIdle) startIdleWatch().catch(() => {}); return r },
  },
  git: {
    accounts: (c) => c.git.listAccounts(),
    disconnect: (c, id) => c.git.disconnect(id),
    repos: (c, id, q) => c.git.listRepos(id, q || ''),
    // The OAuth round-trip: the core binds the loopback callback and builds the authorize URL, the system
    // browser opens it, and the call resolves with the account once the provider sends the browser back.
    connect: async (c, provider) => { const s = await c.git.startConnect(provider); await shell.openExternal(s.url); return s.done },
  },
  repositories: {
    list: (c) => c.repositories.list(),
    add: (c, url, branch) => c.repositories.add(url, branch || null),
    remove: (c, id) => c.repositories.remove(id),
    search: (c, q) => c.repositories.search(q || ''),
    branches: (c, url) => c.repositories.branches(url),
    folders: (c, url, branch) => c.repositories.folders(url, branch || 'main'),
  },
  remote: {   // docs/ADR-019: MCP servers this app uses (BH's console)
    status: (c) => c.remote.status(),
    check: (c) => c.remote.check(),
    setKey: (c, key) => c.remote.setKey(key || null),
  },
  configio: {   // docs/ADR-023: the Default Configuration as a JSON file; plan changes nothing, apply backs up first
    export: (c, opts) => c.configio.exportConfig({ appVersion: app.getVersion(), includeSecrets: !(opts && opts.includeSecrets === false) }),   // keys and tokens are in by default; the panel's box turns them off
    suggestedName: (c) => c.configio.suggestedName(),
    plan: (c, file) => c.configio.planImport(file),
    apply: (c, file, sections) => c.configio.applyImport(file, { sections: Array.isArray(sections) ? sections : [] }),
    undo: (c) => c.configio.undoImport(),
    backups: (c) => c.configio.listBackups(),
  },
  queue: {   // docs/ADR-038: importing a round queues work for the pool pods
    plan: (c, round, opts) => c.queue.planImport(round, opts || {}),
    import: (c, round, opts) => c.queue.importRound(round, opts || {}),
    importMany: (c, items, opts) => c.queue.importRounds(items || [], opts || {}),
    list: (c) => c.queue.list(),
    cancelTask: (c, id) => c.queue.cancelTask(id),
    cancelImport: (c, id) => c.queue.cancelImport(id),
    retryTask: (c, id) => c.queue.retryTask(id),
    purge: (c, opts) => c.queue.purge(opts || {}),
    setLimits: (c, id, limits) => c.queue.setImportLimits(id, limits || {}),
  },
  runflows: {   // docs/ADR-037: run workflows on a pod
    list: (c, podId) => c.runflows.list(podId),
    run: (c, podId, paths, approvedBy, ranges) => c.runflows.run(podId, paths, { ...(approvedBy ? { approvedBy } : {}), ...(ranges ? { ranges } : {}) }),
    models: (c, podId) => c.runflows.models(podId),
    setModels: (c, podId, choice) => c.runflows.setModels(podId, choice || {}),
    job: (c, id) => c.runflows.job(id),
    latest: (c, podId) => c.runflows.latest(podId),
    cancel: async (c, id) => (c.runflows.job(id) ? c.runflows.cancel(id) : c.runflows.cancelAny(id)),   // a run of this process, else another process's (through the registry)
    jobs: (c) => ({ jobs: c.runflows.jobsList() }),   // the render runs of the app and of other processes, for the Queue's Generations
  },
  agentguard: {   // docs/ADR-042 section 10: the Bash guard for agents, in the user's Claude Code settings
    status: (c) => c.agentguard.status(),
    set: (c, on) => { c.settings.set({ agent_shell_guard: !!on }); return c.agentguard.status() },
  },
  models: {   // docs/ADR-042: Hugging Face onto the Shared volume
    search: (c, q) => c.hf.search(String(q || '')),
    files: (c, repo, revision) => c.hf.files(String(repo || ''), revision || 'main'),
    fetch: (c, volumeId, items) => c.podpull.fetchModels(volumeId || c.mounts.load().shared_volume_id || c.mounts.load().network_volume_id, items || [], {}),
    status: (c, volumeId) => c.podpull.modelsOnVolume(volumeId || c.mounts.load().shared_volume_id || c.mounts.load().network_volume_id),
    folders: (c) => [...c.hf.FOLDERS],
    delete: (c, volumeId, items, confirmed) => c.podpull.deleteModels(volumeId || c.mounts.load().shared_volume_id || c.mounts.load().network_volume_id, items || [], { confirmed: confirmed === true }),   // ADR-042 section 15: the window has asked first
  },
  wanted: {   // docs/ADR-042 section 12: the wanted-models list (names, not weights), loadable onto a Shared volume anywhere
    list: (c) => c.wantedmodels.list(),
    status: (c, volumeId) => c.wantedmodels.status(volumeId || ''),
    add: (c, items) => c.wantedmodels.add(items || []),
    addList: (c, o) => c.wantedmodels.addPullList(o || {}),
    saveInstalled: (c, volumeId) => c.wantedmodels.saveInstalled(volumeId || ''),
    remove: (c, keys, all) => c.wantedmodels.remove(keys || [], !!all),
    load: (c, volumeId) => c.wantedmodels.loadMissing(volumeId || '', {}),
  },
  library: {   // docs/ADR-044: where rounds come from (the BH bucket first, a network volume second); a source only lists, read-only
    sources: (c) => c.library.sources(),
    status: (c, sourceId, opts) => c.library.status(sourceId || undefined, opts || {}),   // can this source be used now, and why not (a volume asks RunPod about its datacenter)
    list: (c, sourceId, opts) => c.library.list(sourceId || undefined, opts || {}),   // opts: { volume_id, fresh }
    round: (c, volumeId, round, opts) => c.library.round(volumeId || undefined, round, opts || {}),   // one round described by the round adapter
    roundFiles: (c, volumeId, round, shot, opts) => c.library.roundFiles(volumeId || undefined, round, shot || '', opts || {}),   // a round (or one shot) as a read-only file tree, listed by prefix over S3
    preflight: (c, volumeId, round, opts) => c.library.preflight(volumeId || undefined, round, opts || {}),   // one round's models checked against the volume's model list
  },
  panama: {   // docs/ADR-015: the exchange bucket as an import source
    status: (c) => c.panama.status(),
    rounds: (c) => c.panama.roundsAsync(),   // not the sync ones: they would hold the main process, and so the window, while aws lists the bucket
    size: (c, round) => c.panama.sizeAsync(round),
    files: (c, round) => c.panama.filesAsync(round),
    browse: (c, prefix) => c.panama.browse(prefix),   // one level of the bucket, read-only (Network Volumes > Explore)
    stageDrop: (c, paths) => c.panama.stageDropAsync(paths),   // copied and unzipped off the main loop
    pull: (c, round) => c.panama.pull(round),
    job: (c, id) => c.panama.job(id),
    cancel: (c, id) => c.panama.cancel(id),
    remove: (c, round) => c.panama.removeAsync(round),
    // ADR-022: rounds on the network volume, pulled by a pod (libs/core/src/podpull.ts)
    podRounds: (c) => c.podpull.rounds(),
    podPlan: (c, round, route) => c.podpull.plan(round, route ? { route } : {}),
    podPull: (c, round, route) => c.podpull.pull(round, route ? { route } : {}),
    podJob: (c, id) => c.podpull.job(id),
    podCancel: (c, id) => c.podpull.cancel(id),
    podRemove: (c, round) => c.podpull.remove(round),
    // ADR-033: put a pulled round's inputs where its graphs look, on the running pod
    podPlace: (c, round, podId, dryRun) => c.podpull.placeRound(round, { pod_id: podId || undefined, dry_run: dryRun }),
  },
  imports: {   // docs/ADR-008: a folder through an adapter into ComfyUI-Shared
    list: (c) => c.imports.list(),
    detect: (c, dir) => c.imports.detect(dir),
    plan: (c, dir, adapter, options) => c.imports.plan(dir, adapter || undefined, options || {}),
    apply: (c, plan, opts) => c.imports.apply(plan, opts || {}),
    source: (c, id) => c.imports.source(id),
    save: (c, id, text) => c.imports.save(id, text),
    spec: (c) => c.imports.spec(),
    draftPreview: async (c, dir) => { const { _texts, ...rest } = await c.imports.draftPreviewAsync(dir); return rest },   // walked off the main loop
    draft: (c, dir, opts) => c.imports.draft(dir, opts || {}),
    validateSource: (c, text, id) => c.imports.validateSource(text, id || undefined),
    describe: (c, dir) => c.imports.describe(dir),
    syncAfter: (c, podId) => c.imports.syncAfter(podId || null),
    remove: (c, id) => c.imports.remove(id),
    template: (c, id, name) => c.imports.template(id, name || undefined),
    getPrompt: (c, id) => c.imports.getPrompt(id),
    savePrompt: (c, id, text) => c.imports.savePrompt(id, text),
    rename: (c, id, to) => c.imports.rename(id, to || {}),
    history: (c, id) => c.imports.history(id),
    duplicate: (c, from, id) => c.imports.duplicate(from, id),
  },
  studio: {   // docs/ADR-009: the Adapter Studio's engine
    step: (c, state) => c.studio.step(state),
    saveChecked: (c, id, text, folder) => c.studio.saveChecked(id, text, { folder: folder || null }),
    document: (c, id) => c.studio.documentAdapter(id),
    tree: (c, folder) => c.studio.packageTree(folder),
    file: (c, folder, rel) => c.studio.readPackageFile(folder, rel),
    problems: (c, id, folder) => c.studio.problems(id, folder || null),
    context: async (c, folder) => { const { _texts, ...rest } = await c.imports.draftPreviewAsync(folder); return rest },
  },
  images: {
    env: (c, params) => c.images.env(params || {}),
    dockerfile: (c, params) => c.images.dockerfile(params || {}),
  },
  // The Connect › MCP tab: the two endpoints with their client snippets (the bridge's target URL flows in),
  // what the bridge can point at, Check (the core spawns the server over stdio and lists its tools; an endpoint
  // the app serves itself is asked over HTTP), and the "Serve from the app" switch with its port.
  mcp: {
    endpoints: (c, comfy) => c.mcp.endpoints({ comfy: comfy || null, served: served() }),
    targets: (c) => c.mcp.targets(),
    probe: (c, id, comfy) => { const st = served()[id]; return c.mcp.probe(id, { comfy: comfy || null, http: st?.running ? st.url : null }) },
    // Saves the switch and port in the Default Configuration, then makes the host match. A port that cannot be bound is refused and the switch goes back off.
    serve: async (c, id, enabled, port) => {
      const before = c.mounts.load().mcp_http[id]
      c.mcp.setServe(id, !!enabled, port ?? undefined)
      const st = (await host().apply())[id]
      if (enabled && !st.running) {
        c.mcp.setServe(id, !!before?.enabled, before?.port)   // back to what was saved (and what was serving)
        await host().apply()
        throw Object.assign(new Error(st.error || `${id} could not be served`), { status: 409 })
      }
      return c.mcp.endpoints({ comfy: null, served: served() }).find((e) => e.id === id)
    },
  },
}

// Log streams: one per pod per window, pushed to the page as 'core:logs' events until stopped.
const streams = new Map()
function streamKey(sender, id) { return `${sender.id}:${id}` }

const MAX_FILE_BYTES = 2 * 1024 * 1024   // a configuration is a few KB
const JSON_FILTER = [{ name: 'JSON', extensions: ['json'] }]

/** Only the /view of a pod's ComfyUI (a RunPod proxy address, or this PC) is fetched for the Outputs viewer's Download and Download zip. */
function podViewUrl(url) {
  let u
  try { u = new URL(String(url)) } catch { return null }
  const okHost = (u.protocol === 'https:' && /\.proxy\.runpod\.net$/i.test(u.hostname)) || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))
  return okHost && u.pathname === '/view' ? u : null
}

/** An address the main process may fetch: a pod's /view, or (s3file://) a signed read of one output file of a known volume. Returns { url, headers? } or { status, message }; the signature headers never leave the main process. */
async function fetchable(url, range) {
  if (/^s3file:/i.test(String(url))) {
    try { return await (await loadCore()).outputsources.signGet(String(url), { range }) } catch (e) { return { status: e.status || 502, message: e.message } }
  }
  const u = podViewUrl(url)
  return u ? { url: u.href } : { status: 403, message: 'Only a file of a pod\'s ComfyUI or of a volume\'s output folder can be read here.' }
}

function register() {
  monitor.start()
  // The two native file dialogs the configuration export and import use (docs/ADR-023). They only pick one path and move one UTF-8 text file; the page gets the text, never a path to read.
  ipcMain.handle('core:file:save', async (event, suggested, text) => {
    if (typeof text !== 'string' || text.length > MAX_FILE_BYTES) return { ok: false, error: { message: 'There is nothing to save, or it is too large.' } }
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), path.basename(String(suggested || 'pod-manager-config.json'))), filters: /\.csv$/i.test(String(suggested)) ? [{ name: 'CSV', extensions: ['csv'] }] : JSON_FILTER })
    if (r.canceled || !r.filePath) return { ok: true, canceled: true }
    // 0600: the file may hold keys and tokens, and the mode option only applies to a file this call creates, so chmod too
    try { await fs.promises.writeFile(r.filePath, text, { encoding: 'utf8', mode: 0o600 }); await fs.promises.chmod(r.filePath, 0o600) } catch (e) { return { ok: false, error: { message: `Could not write ${path.basename(r.filePath)}: ${e.message}` } } }
    return { ok: true, path: r.filePath }
  })
  // A printable page as a PDF (the Queue's and History's log export): a hidden window prints it, the user picks where it goes. Scripts are off and the page is loaded from a data URL.
  ipcMain.handle('core:file:savePdf', async (event, suggested, html) => {
    if (typeof html !== 'string' || html.length > 20 * 1024 * 1024) return { ok: false, error: { message: 'There is nothing to save, or it is too large.' } }
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), path.basename(String(suggested || 'log.pdf'))), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (r.canceled || !r.filePath) return { ok: true, canceled: true }
    const hidden = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } })
    try {
      await hidden.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      const pdf = await hidden.webContents.printToPDF({ landscape: true, printBackground: true, pageSize: 'A4' })
      await fs.promises.writeFile(r.filePath, pdf)
    } catch (e) { return { ok: false, error: { message: `Could not write ${path.basename(r.filePath)}: ${e.message}` } } } finally { hidden.destroy() }
    return { ok: true, path: r.filePath }
  })
  ipcMain.handle('core:file:open', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: JSON_FILTER })
    if (r.canceled || !r.filePaths[0]) return { ok: true, canceled: true }
    const p = r.filePaths[0]
    try {
      const st = await fs.promises.stat(p)
      if (st.size > MAX_FILE_BYTES) return { ok: false, error: { message: `${path.basename(p)} is ${Math.round(st.size / 1024)} KB: far too large to be a configuration, so it was not read.` } }
      return { ok: true, path: p, name: path.basename(p), text: await fs.promises.readFile(p, 'utf8') }
    } catch (e) { return { ok: false, error: { message: `Could not read ${path.basename(p)}: ${e.message}` } } }
  })

  // Download one output file of a run (the viewer's Download): a Save As dialog, then the bytes from the pod's ComfyUI /view. Only an https RunPod proxy address (or this PC) is fetched, and the page never sees a path.
  ipcMain.handle('core:file:download', async (event, url, suggested) => {
    const f = await fetchable(url)
    if (!f.url) return { ok: false, error: { message: f.message } }
    const u = new URL(f.url)   // an s3file address is signed by headers that stay in this function
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), path.basename(String(suggested || u.searchParams.get('filename') || decodeURIComponent(u.pathname.split('/').pop() || '') || 'output'))) })
    if (r.canceled || !r.filePath) return { ok: true, canceled: true }
    try {
      const res = await fetch(u, { headers: f.headers, signal: AbortSignal.timeout(30 * 60_000) })
      if (!res.ok || !res.body) return { ok: false, error: { message: `The pod answered HTTP ${res.status} for that file.` } }
      await require('node:stream/promises').pipeline(require('node:stream').Readable.fromWeb(res.body), fs.createWriteStream(r.filePath))
      return { ok: true, path: r.filePath }
    } catch (e) { return { ok: false, error: { message: `Could not download the file: ${e.message}` } } }
  })

  // Read one output file of a run into the page (the DPX viewer decodes the bytes in the page): the same https /view address the Download uses, fetched here in the main process. This is the fallback for when the page's own
  // fetch() of a podfile:// address fails (the scheme lacks its privilege); the answer carries the HTTP status so the page can tell a missing file from a pod it cannot reach. Only a pod's /view is read.
  ipcMain.handle('core:file:read', async (event, url) => {
    const f = await fetchable(url)
    if (!f.url) return { ok: false, status: f.status, error: { message: f.message } }
    try {
      const res = await fetch(f.url, { headers: f.headers, signal: AbortSignal.timeout(10 * 60_000) })
      return { ok: true, status: res.status, bytes: res.ok ? Buffer.from(await res.arrayBuffer()) : null }
    } catch (e) { return { ok: false, error: { message: `Could not reach the file: ${/^s3file:/i.test(String(url)) ? 'the volume did not answer' : e.message}` } } }
  })

  // Download all (zip): Save As, then every file of the list fetched from the pod and streamed into one zip (electron/zip.cjs). The page passes [{ url, name }]; each url is checked like a single download.
  ipcMain.handle('core:file:downloadZip', async (event, entries, suggested) => {
    if (!Array.isArray(entries) || !entries.length || entries.length > 5000) return { ok: false, error: { message: 'There are no files to put in a zip.' } }
    const fs_ = await Promise.all(entries.map((e) => fetchable(e && e.url))), signed = new Map(fs_.filter((f) => f.headers).map((f) => [f.url, f.headers]))
    const urls = fs_.map((f) => (f.url ? { href: f.url } : null))   // s3file entries are signed here, in the main process
    if (urls.some((u) => !u)) return { ok: false, error: { message: 'Only files of a pod\'s ComfyUI or of a volume\'s output folder can be downloaded here.' } }
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), path.basename(String(suggested || 'outputs.zip'))), filters: [{ name: 'Zip', extensions: ['zip'] }] })
    if (r.canceled || !r.filePath) return { ok: true, canceled: true }
    try {
      const out = await require('./zip.cjs').writeZip(entries.map((e, i) => ({ url: urls[i].href, name: String(e.name || '') })), r.filePath, { fetchFn: (u) => fetch(u, { headers: signed.get(String(u)), signal: AbortSignal.timeout(30 * 60_000) }) })
      return { ok: true, path: r.filePath, files: out.files, bytes: out.bytes }
    } catch (e) { return { ok: false, error: { message: `Could not make the zip: ${e.message}` } } }
  })

  ipcMain.handle('core:logs:start', async (event, id, opts = {}) => {
    const key = streamKey(event.sender, id)
    streams.get(key)?.abort()
    const ac = new AbortController()
    streams.set(key, ac)
    const c = await loadCore()
    const send = (payload) => { if (!event.sender.isDestroyed()) event.sender.send('core:logs', { id, ...payload }) }
    c.pods.logs(id, opts, (ev) => send({ event: ev }), ac.signal)
      .then(() => send({ end: true }))
      .catch((e) => send({ error: e.message || String(e) }))
      .finally(() => { if (streams.get(key) === ac) streams.delete(key) })
    return { ok: true }
  })
  ipcMain.handle('core:logs:stop', (event, id) => { const key = streamKey(event.sender, id); streams.get(key)?.abort(); streams.delete(key); return { ok: true } })

  // Sync jobs: one per pod, pushed to every window as 'core:sync' events; they outlive the window that started them.
  // (sync-jobs.cjs: the same runner the MCP servers hosted by the app use.)
  ipcMain.handle('core:sync:start', async (_event, req) => { const r = await syncJobs.start(req); return r.ok ? { ok: true } : { ok: false, running: true } })
  ipcMain.handle('core:sync:cancel', (_event, id) => { syncJobs.cancel(id); return { ok: true } })
  ipcMain.handle('core:sync:state', (_event, id) => syncJobs.state(id))
  ipcMain.handle('core:sync:count', async (_event, req) => { const c = await loadCore(); return monitor.call('sync.count', () => c.syncrun.countFor(req)) })   // the listing passes: what the push would send, with and without the renders
  ipcMain.handle('core:sync:plan', async (_event, req) => { const c = await loadCore(); const [steps, transport] = await Promise.all([Promise.resolve().then(() => monitor.call('sync.plan', () => c.syncrun.planFor(req))), c.syncrun.transportFor(req.pod_id)]); return { steps, transport, shared: c.syncrun.effectiveShared(req) } })

  ipcMain.handle('core', async (_event, ns, fn, args = []) => {
    try {
      const f = TABLE[ns]?.[fn]
      if (!f) throw Object.assign(new Error(`no core call ${ns}.${fn}`), { status: 404 })
      const c = await loadCore()
      const value = await monitor.call(`${ns}.${fn}`, () => f(c, ...args))   // times the synchronous part: what blocks the window
      return { ok: true, value }
    } catch (e) {
      return { ok: false, error: { status: e.status || 500, message: e.message || String(e), ...(e.code ? { code: e.code } : {}), ...(e.hint ? { hint: e.hint } : {}) } }
    }
  })
}

/** The idle watch runs while the app is open: a pod with nothing queued for its minutes is stopped. */
async function startIdleWatch() {
  if (!process.env.RUNPOD_API_KEY || process.env.IDLE_WATCH === '0') return
  const c = await loadCore()
  stopIdle = c.idle.loop(c.pods.runningIds(), c.pods.stopper())
}
function stopIdleWatch() { if (stopIdle) stopIdle(); stopIdle = null }

/** Start the MCP servers the configuration switches on (at launch), and stop them (at quit). */
async function startMcpHost() { await host().apply() }
async function stopMcpHost() { if (mcpHost) await mcpHost.stop() }

module.exports = { monitor, fetchable, register, loadCore, startIdleWatch, stopIdleWatch, startMcpHost, stopMcpHost, syncJobs, TABLE }
