// The core (libs/core, docs/ADR-005) in the main process, exposed to the page over IPC.
//
// One channel, 'core', one dispatch table below: namespace -> function -> what it calls. The
// renderer's api/*.js modules route here when window.core exists (Electron) and over HTTP
// otherwise (browser, hot reload, the Playwright suite). Errors come back as {ok:false, error}
// so the page gets the core's message, not Electron's wrapping.
const path = require('node:path')
const { ipcMain, app, shell, BrowserWindow } = require('electron')

let core = null
let stopIdle = null

async function loadCore() {
  if (core) return core
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'core', 'index.js')
    : path.resolve(__dirname, '..', 'libs', 'core', 'dist', 'index.js')
  core = await import(require('node:url').pathToFileURL(file).href)
  return core
}

/** namespace -> fn -> (core, ...args) => value */
const TABLE = {
  mounts: {
    get: (c) => c.mounts.payload(c.mounts.load()),
    put: (c, cfg) => c.mounts.put(cfg),
    preview: (c, cfg) => c.mounts.preview(cfg),
    reset: (c) => c.mounts.payload(c.mounts.reset()),
    env: (c) => c.mounts.envLines(c.mounts.load()),
    dirs: (c, p, hidden) => c.listDirs(p || '', !!hidden),
  },
  pods: {
    dashboard: (c) => c.pods.dashboard(),
    list: (c) => c.pods.list(),
    get: (c, id) => c.pods.get(id),
    // Only the hosts the pod has to clone from get a credential (GIT_CREDENTIALS), as the Python API did.
    create: async (c, req) => c.pods.create(req, undefined, req.custom_nodes?.length ? await c.git.credentialsEnv(req.custom_nodes.map((n) => n.url || '')) : {}),
    stop: (c, id) => c.pods.stop(id),
    resume: (c, id) => c.pods.resume(id),
    remove: (c, id) => c.pods.remove(id),
    gpus: (c, dc) => c.pods.gpuMenu(undefined, dc || undefined),
    volume: (c, id) => c.pods.volumeInfo(id || undefined),
    datacenters: (c) => c.pods.datacenters(),
    setIdle: (c, id, minutes) => { c.idle.register(id, Number(minutes)); return { pod_id: id, idle_stop_minutes: Math.max(Number(minutes), 0) } },
    details: (c, id) => c.pods.details(id),
    recreate: (c, id) => c.pods.recreate(id),
    config: (c, id) => c.pods.config(id),
    setConfig: (c, id, cfg) => c.pods.setConfig(id, cfg),
  },
  volumes: {
    list: (c) => c.volumes.list(),
    create: (c, input) => c.volumes.create(input),
    resize: (c, id, size) => c.volumes.resize(id, Number(size)),
    remove: (c, id) => c.volumes.remove(id),
    useAsDefault: (c, id) => c.volumes.useAsDefault(id),
  },
  governance: {
    summary: (c) => c.governance.summary(),
  },
  settings: {
    get: (c) => c.settings.get(),
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
  images: {
    env: (c, params) => c.images.env(params || {}),
  },
}

// Log streams: one per pod per window, pushed to the page as 'core:logs' events until stopped.
const streams = new Map()
const syncJobs = new Map()   // pod id -> { ac, events, done }
function streamKey(sender, id) { return `${sender.id}:${id}` }

function register() {
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
  ipcMain.handle('core:sync:start', async (event, req) => {
    const id = req.pod_id
    if (syncJobs.has(id)) return { ok: false, running: true }
    const ac = new AbortController()
    const job = { ac, events: [], done: false }
    syncJobs.set(id, job)
    const c = await loadCore()
    const send = (payload) => { job.events.push(payload); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('core:sync', { id, ...payload }) }
    c.syncrun.run(req, send, ac.signal)
      .then((r) => send({ kind: 'result', result: r }))
      .catch((e) => send({ kind: 'error', text: e.message || String(e) }))
      .finally(() => { job.done = true; setTimeout(() => { if (syncJobs.get(id) === job) syncJobs.delete(id) }, 60_000) })
    return { ok: true }
  })
  ipcMain.handle('core:sync:cancel', (_event, id) => { syncJobs.get(id)?.ac.abort(); return { ok: true } })
  ipcMain.handle('core:sync:state', (_event, id) => { const j = syncJobs.get(id); return j ? { running: !j.done, events: j.events } : { running: false, events: [] } })
  ipcMain.handle('core:sync:plan', async (_event, req) => { const c = await loadCore(); const [steps, transport] = await Promise.all([Promise.resolve().then(() => c.syncrun.planFor(req)), c.syncrun.transportFor(req.pod_id)]); return { steps, transport } })

  ipcMain.handle('core', async (_event, ns, fn, args = []) => {
    try {
      const f = TABLE[ns]?.[fn]
      if (!f) throw Object.assign(new Error(`no core call ${ns}.${fn}`), { status: 404 })
      const value = await f(await loadCore(), ...args)
      return { ok: true, value }
    } catch (e) {
      return { ok: false, error: { status: e.status || 500, message: e.message || String(e) } }
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

module.exports = { register, loadCore, startIdleWatch, stopIdleWatch, TABLE }
