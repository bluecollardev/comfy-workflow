// The core (libs/core, docs/ADR-005) in the main process, exposed to the page over IPC.
//
// One channel, 'core', one dispatch table below: namespace -> function -> what it calls. The
// renderer's api/*.js modules route here when window.core exists (Electron) and over HTTP
// otherwise (browser, hot reload, the Playwright suite). Errors come back as {ok:false, error}
// so the page gets the core's message, not Electron's wrapping.
const path = require('node:path')
const { ipcMain, app } = require('electron')

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
    reset: (c) => c.mounts.payload(c.mounts.reset()),
    env: (c) => c.mounts.envLines(c.mounts.load()),
    dirs: (c, p, hidden) => c.listDirs(p || '', !!hidden),
  },
  pods: {
    dashboard: (c) => c.pods.dashboard(),
    list: (c) => c.pods.list(),
    get: (c, id) => c.pods.get(id),
    create: (c, req) => c.pods.create(req),
    stop: (c, id) => c.pods.stop(id),
    resume: (c, id) => c.pods.resume(id),
    remove: (c, id) => c.pods.remove(id),
    gpus: (c) => c.pods.gpuMenu(),
    setIdle: (c, id, minutes) => { c.idle.register(id, Number(minutes)); return { pod_id: id, idle_stop_minutes: Math.max(Number(minutes), 0) } },
    details: (c, id) => c.pods.details(id),
    recreate: (c, id) => c.pods.recreate(id),
  },
  governance: {
    summary: (c) => c.governance.summary(),
  },
  settings: {
    get: (c) => c.settings.get(),
    set: (c, values) => { const r = c.settings.set(values); if (process.env.RUNPOD_API_KEY && !stopIdle) startIdleWatch().catch(() => {}); return r },
  },
}

// Log streams: one per pod per window, pushed to the page as 'core:logs' events until stopped.
const streams = new Map()
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

module.exports = { register, loadCore, startIdleWatch, stopIdleWatch }
