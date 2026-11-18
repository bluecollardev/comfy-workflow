// Electron main process. The core (libs/core: mounts, pods, GPUs, datacenters, governance, idle,
// git accounts, repositories, image env) runs in this process and the page reaches it over IPC
// (core.cjs, preload.cjs). There is no server and no Python: one app (docs/ADR-005).
//
// The page loads from the app's own files (dist/). In development, VITE_DEV_SERVER_URL=http://localhost:5173
// loads Vite's dev server instead, with hot reload, still over IPC to this process.
//
// Settings (RUNPOD_API_KEY, GITHUB_CLIENT_ID, …) come from ~/.config/runpod-pod-manager/.env
// (and <repo>/.env in development).

const { app, BrowserWindow, dialog, shell, nativeImage, protocol } = require('electron')
const coreBridge = require('./core.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DEV_URL = process.env.VITE_DEV_SERVER_URL
const CONFIG_DIR = process.env.POD_MANAGER_CONFIG_DIR || path.join(os.homedir(), '.config', 'runpod-pod-manager')   // a test points this at its own folder: it must not read the user's keys
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
// Packaged: electron-builder copies dist/ → resources/dist and the shape and governance → resources/backend (the name stays).
const UI_DIST_DIR = app.isPackaged ? path.join(process.resourcesPath, 'dist') : path.resolve(__dirname, '..', 'dist')
const ICON = path.join(__dirname, '..', 'build', 'icon.png')

let win = null

const exists = (p) => {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function readEnvFile(file) {
  if (!exists(file)) return {}
  const env = {}
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return env
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'RunPod Manager',
    backgroundColor: '#1E1E1E',
    icon: process.platform === 'darwin' ? undefined : ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  })
  // target=_blank links (the pod's ComfyUI URL, provider profiles) open in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    win = null
  })
  return win
}

function buildInfo() {
  // What this app was built for (start.sh package --comfy): the comfy-app variant and the image a new pod boots by default.
  const file = app.isPackaged ? path.join(process.resourcesPath, 'build-info.json') : path.join(__dirname, '..', 'build', 'build-info.json')
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} }
}

function coreEnv() {
  // The core reads its config, the shape and the governance copy from these; packaged, they travel as resources.
  const info = buildInfo()
  if (info.comfy_image && !process.env.COMFY_IMAGE) process.env.COMFY_IMAGE = info.comfy_image
  const fromEnv = { ...(app.isPackaged || process.env.POD_MANAGER_CONFIG_DIR ? {} : readEnvFile(path.join(REPO_ROOT, '.env'))), ...readEnvFile(path.join(CONFIG_DIR, '.env')) }
  for (const [k, v] of Object.entries(fromEnv)) if (!(k in process.env)) process.env[k] = v
  if (app.isPackaged) {
    process.env.MOUNT_POINTS_FILE ||= path.join(process.resourcesPath, 'backend', 'mount-points.json')
    process.env.GOVERNANCE_DIR ||= path.join(process.resourcesPath, 'backend', 'governance')
    process.env.MCP_DIR ||= path.join(process.resourcesPath, 'mcp')   // the bundled MCP servers travel as resources (mcp/dist in a checkout); the Connect tab shows and spawns them from here
  }
  // Clients launch the MCP servers with this very executable as Node (ELECTRON_RUN_AS_NODE=1): no Node install. Packaged: the app; in development: the Electron binary.
  process.env.MCP_EXEC ||= process.execPath
  process.env.RUNPOD_MANAGER_VERSION ||= app.getVersion()   // the render sidecars record it (docs/ADR-048)
}

// podfile://<pod>-8188.proxy.runpod.net/view?... : the files of a pod's ComfyUI (the Outputs gallery and viewer). RunPod's proxy answers 403 to a page's own image or video request (the browser marks it cross-site), so the main
// process fetches them and hands the bytes (with Range, for video) to the page. Only the /view of a RunPod proxy host is fetched.
// corsEnabled: an <img> or <video> may load a podfile:// address from any page, but fetch() (the DPX viewer reads the bytes with it) is a cross-origin request from the page's own origin (Vite's localhost, or file://) and fails with "Failed to fetch" without it; the answer already carries access-control-allow-origin.
// ONE call for every custom scheme: Electron keeps only the last registerSchemesAsPrivileged call, so podfile, s3file and localfile are registered together (a third call made s3file requests fail: v1.5.0 gate).
protocol.registerSchemesAsPrivileged(['podfile', 's3file', 'localfile'].map((scheme) => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } })))
function handlePodFiles() {
  protocol.handle('podfile', async (request) => {
    const u = new URL(request.url)
    if (!/^[a-z0-9]+-\d+\.proxy\.runpod\.net$/i.test(u.hostname) || u.pathname !== '/view') return new Response('Only the /view of a pod\'s ComfyUI is served here.', { status: 403 })
    const range = request.headers.get('range')
    try {
      const r = await fetch(`https://${u.hostname}/view${u.search}`, { headers: range ? { range } : {}, signal: AbortSignal.timeout(10 * 60_000) })
      // content-length is not forwarded: fetch has already decoded the body (a gzipped one would then be cut short at the encoded length); the page reads it to the end. A partial answer keeps its content-range.
      const h = Object.fromEntries(['content-type', 'content-range', 'accept-ranges'].map((k) => [k, r.headers.get(k)]).filter(([, v]) => v))
      return new Response(r.body, { status: r.status, headers: { ...h, 'access-control-allow-origin': '*' } })
    } catch (e) { return new Response(`The pod did not answer: ${e.message}`, { status: 502 }) }
  })
}

// s3file://<volume>/<url-encoded key> : one output file straight from a network volume over RunPod's S3 API, with no pod (docs/ADR-045). The core checks the address (only keys under comfy-shared/output/ of a volume the app knows,
// never `..`: anything else is a 403) and signs a read (SigV4 headers: RunPod's S3 API refuses presigned query URLs) with the app's RunPod S3 keys; this handler fetches it, Range included, and hands the bytes to the page. The keys and the signature stay in this process: they are
// not in the answer, a header or a log. Only GET and HEAD.
function handleS3Files() {
  protocol.handle('s3file', async (request) => {
    const text = (status, msg) => new Response(msg, { status, headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*' } })
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Volume files are read-only.')
    const range = request.headers.get('range')
    const f = await coreBridge.fetchable(request.url, range)
    if (!f.url) return text(f.status || 502, f.message)
    try {
      const r = await fetch(f.url, { method: request.method, headers: f.headers || (range ? { range } : {}), signal: AbortSignal.timeout(10 * 60_000) })
      if (r.status >= 400) return text(r.status === 403 ? 502 : r.status, `The volume's S3 API answered HTTP ${r.status}.`)   // never its body: it may echo the request
      const h = Object.fromEntries(['content-type', 'content-range', 'accept-ranges'].map((k) => [k, r.headers.get(k)]).filter(([, v]) => v))
      const ext = decodeURIComponent(new URL(request.url).pathname).split('.').pop().toLowerCase(), guess = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', wav: 'audio/wav', mp3: 'audio/mpeg' }[ext]
      if (guess && (!h['content-type'] || /octet-stream/.test(h['content-type']))) h['content-type'] = guess   // an S3 object often has no type: a <video> needs one
      return new Response(r.body, { status: r.status, headers: { ...h, 'access-control-allow-origin': '*' } })
    } catch (e) { return text(502, `The volume did not answer (${e.cause?.code || e.name}).`) }
  })
}

// localfile://p/<url-encoded path under output/.proxies> (or localfile://d/<shot>/v###/<file> under output/deliver) : a rendered proxy (.mp4) cached on this PC, read-only (docs/ADR-048). The core's guard (renders.resolveProxyFile) decides: only a plain .mp4 inside the mapped
// ComfyUI-Shared output/.proxies/, never `..`, never a symlink out; GET and HEAD, Range included, so a <video> can seek.
function handleLocalFiles() {
  protocol.handle('localfile', async (request) => {
    const text = (status, msg) => new Response(msg, { status, headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*' } })
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Proxies are read-only.')
    const core = await coreBridge.loadCore()
    const u = new URL(request.url), root = u.hostname === 'd' ? core.renders.localDeliverRoot() : core.renders.localProxyRoot()   // d: a review in output/deliver/<shot>/v###/, p: a proxy in output/.proxies/
    const f = await core.renders.resolveProxyFile(root, u.pathname)
    if (!f.ok) return text(f.status, f.message)
    const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '')
    let start = 0, end = f.size - 1, status = 200
    if (m && (m[1] || m[2])) { if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])) } else { start = Math.max(0, f.size - Number(m[2])) } status = 206; if (start > end || start >= f.size) return new Response('', { status: 416, headers: { 'content-range': `bytes */${f.size}` } }) }
    const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), 'access-control-allow-origin': '*', ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${f.size}` } : {}) }
    if (request.method === 'HEAD') return new Response(null, { status, headers })
    return new Response(require('node:stream').Readable.toWeb(fs.createReadStream(f.path, { start, end })), { status, headers })
  })
}

async function boot() {
  handlePodFiles()
  handleLocalFiles()
  handleS3Files()
  if (process.platform === 'darwin' && !app.isPackaged && exists(ICON)) app.dock.setIcon(nativeImage.createFromPath(ICON))
  coreEnv()
  coreBridge.register()
  coreBridge.startIdleWatch().catch((e) => console.error(`idle watch: ${e.message}`))
  coreBridge.startMcpHost().catch((e) => console.error(`mcp host: ${e.message}`))   // the endpoints the configuration serves from the app
  createWindow()
  await win.loadFile(path.join(__dirname, 'loading.html'))

  // The page: Vite's dev server in development (hot reload, still IPC to this process), else the app's own files.
  if (DEV_URL) await win.loadURL(DEV_URL)
  else await win.loadFile(path.join(UI_DIST_DIR, 'index.html'))

  // RUNPOD_MANAGER_SMOKE=1: report what loaded and exit — a headless check for CI / packaging.
  if (process.env.RUNPOD_MANAGER_SMOKE) {
    const title = await win.webContents.executeJavaScript('document.title')
    const brand = await win.webContents.executeJavaScript('document.querySelector(".navbar-brand")?.textContent.trim() ?? ""')
    // The core over IPC, from the page: the GPU menu and the mount configuration's mode.
    const bridge = await win.webContents.executeJavaScript(
      "window.core ? Promise.all([window.core.invoke('pods','gpus'), window.core.invoke('mounts','get')]).then(([g, m]) => `gpus=${g.gpus.map((x) => x.value).join(',')} mode=${m.mode} folders=${m.folders.length}`).catch((e) => 'bridge error: ' + e.message) : 'no bridge'",
    )
    console.log(`SMOKE url=${win.webContents.getURL()} title="${title}" brand="${brand}" backend=none core: ${bridge}`)
    app.quit()
  }
}

app.whenReady().then(boot)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) boot()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  coreBridge.stopIdleWatch()
  coreBridge.stopMcpHost().catch(() => {})
})
