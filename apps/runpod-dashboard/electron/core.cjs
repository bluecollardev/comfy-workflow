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

// The app's sync jobs: the cards (IPC below) and the MCP servers the app hosts (mcp-host.cjs) run and read the same ones.
const syncJobs = createSyncJobs({
  loadCore: () => loadCore(),
  broadcast: (payload) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('core:sync', payload) },
})

// The MCP servers served from this process (Connect › MCP, "Serve from the app"); built on first use, after main.cjs has set MCP_DIR.
let mcpHost = null
function host() {
  if (!mcpHost) mcpHost = createMcpHost({ loadCore: () => loadCore(), syncJobs, mcpDir: process.env.MCP_DIR || path.resolve(__dirname, '..', 'mcp', 'dist'), preferBundle: !!app?.isPackaged })
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
    datacenters: (c, fresh) => c.pods.datacenters(undefined, !!fresh),
    setIdle: (c, id, minutes) => c.pods.setIdleStop(id, Number(minutes)),
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
  panama: {   // docs/ADR-015: the exchange bucket as an import source
    status: (c) => c.panama.status(),
    rounds: (c) => c.panama.rounds(),
    size: (c, round) => c.panama.size(round),
    files: (c, round) => c.panama.files(round),
    pull: (c, round) => c.panama.pull(round),
    job: (c, id) => c.panama.job(id),
    cancel: (c, id) => c.panama.cancel(id),
    remove: (c, round) => c.panama.remove(round),
    // ADR-022: rounds on the network volume, pulled by a pod (libs/core/src/podpull.ts)
    podRounds: (c) => c.podpull.rounds(),
    podPlan: (c, round, route) => c.podpull.plan(round, route ? { route } : {}),
    podPull: (c, round, route) => c.podpull.pull(round, route ? { route } : {}),
    podJob: (c, id) => c.podpull.job(id),
    podCancel: (c, id) => c.podpull.cancel(id),
    podRemove: (c, round) => c.podpull.remove(round),
  },
  imports: {   // docs/ADR-008: a folder through an adapter into ComfyUI-Shared
    list: (c) => c.imports.list(),
    detect: (c, dir) => c.imports.detect(dir),
    plan: (c, dir, adapter, options) => c.imports.plan(dir, adapter || undefined, options || {}),
    apply: (c, plan, opts) => c.imports.apply(plan, opts || {}),
    source: (c, id) => c.imports.source(id),
    save: (c, id, text) => c.imports.save(id, text),
    spec: (c) => c.imports.spec(),
    draftPreview: (c, dir) => { const { _texts, ...rest } = c.imports.draftPreview(dir); return rest },
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
    context: (c, folder) => { const { _texts, ...rest } = c.imports.draftPreview(folder); return rest },
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

function register() {
  // The two native file dialogs the configuration export and import use (docs/ADR-023). They only pick one path and move one UTF-8 text file; the page gets the text, never a path to read.
  ipcMain.handle('core:file:save', async (event, suggested, text) => {
    if (typeof text !== 'string' || text.length > MAX_FILE_BYTES) return { ok: false, error: { message: 'There is nothing to save, or it is too large.' } }
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), path.basename(String(suggested || 'pod-manager-config.json'))), filters: JSON_FILTER })
    if (r.canceled || !r.filePath) return { ok: true, canceled: true }
    // 0600: the file may hold keys and tokens, and the mode option only applies to a file this call creates, so chmod too
    try { await fs.promises.writeFile(r.filePath, text, { encoding: 'utf8', mode: 0o600 }); await fs.promises.chmod(r.filePath, 0o600) } catch (e) { return { ok: false, error: { message: `Could not write ${path.basename(r.filePath)}: ${e.message}` } } }
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
  ipcMain.handle('core:sync:count', async (_event, req) => { const c = await loadCore(); return c.syncrun.countFor(req) })   // the listing passes: what the push would send, with and without the renders
  ipcMain.handle('core:sync:plan', async (_event, req) => { const c = await loadCore(); const [steps, transport] = await Promise.all([Promise.resolve().then(() => c.syncrun.planFor(req)), c.syncrun.transportFor(req.pod_id)]); return { steps, transport, shared: c.syncrun.effectiveShared(req) } })

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

/** Start the MCP servers the configuration switches on (at launch), and stop them (at quit). */
async function startMcpHost() { await host().apply() }
async function stopMcpHost() { if (mcpHost) await mcpHost.stop() }

module.exports = { register, loadCore, startIdleWatch, stopIdleWatch, startMcpHost, stopMcpHost, syncJobs, TABLE }
