// Electron main process. The core (libs/core: mounts, pods, GPUs, governance, idle) runs in
// this process and the page reaches it over IPC (core.cjs, preload.cjs): no server for those.
// The FastAPI backend is still started for what is not ported yet (git accounts, repositories,
// image env, OAuth) and serves the built UI; it goes when the port is complete (docs/ADR-005).
//
// The backend serves the built UI at http://localhost:8000 (same origin as /api, so no CORS,
// and the OAuth round-trip lands back in this window). In development, set
// VITE_DEV_SERVER_URL=http://localhost:5173 to load Vite's dev server instead.
//
// Python resolution (first that exists): $RUNPOD_MANAGER_PYTHON →
// ~/.config/runpod-pod-manager/venv → <repo>/.venv (dev only) → python3 on PATH.
// Backend settings (RUNPOD_API_KEY, GITHUB_CLIENT_ID, …) are read from
// ~/.config/runpod-pod-manager/.env (and <repo>/.env in development).

const { app, BrowserWindow, dialog, shell, nativeImage } = require('electron')
const coreBridge = require('./core.cjs')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const PORT = 8000
const API = `http://localhost:${PORT}`
const DEV_URL = process.env.VITE_DEV_SERVER_URL
const CONFIG_DIR = path.join(os.homedir(), '.config', 'runpod-pod-manager')
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
// Packaged: electron-builder copies apps/runpod-api → resources/backend and dist/ → resources/dist.
// Dev: the API is in apps/runpod-api and the built UI in apps/runpod-dashboard/dist.
const BACKEND_DIR = app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.join(REPO_ROOT, 'apps', 'runpod-api')
const UI_DIST_DIR = app.isPackaged ? path.join(process.resourcesPath, 'dist') : path.resolve(__dirname, '..', 'dist')
const ICON = path.join(__dirname, '..', 'build', 'icon.png')

let backend = null
let backendError = null
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

function findPython() {
  const candidates = [
    process.env.RUNPOD_MANAGER_PYTHON,
    path.join(CONFIG_DIR, 'venv', 'bin', 'python'),
    path.join(CONFIG_DIR, 'venv', 'Scripts', 'python.exe'),
    !app.isPackaged && path.join(REPO_ROOT, '.venv', 'bin', 'python'),
  ].filter(Boolean)
  return candidates.find(exists) || (process.platform === 'win32' ? 'python' : 'python3')
}

function healthy() {
  return new Promise((resolve) => {
    const req = http.get(`${API}/health`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForBackend(ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await healthy()) return true
    if (backendError || (backend && backend.exitCode !== null)) return false
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

function startBackend() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const python = findPython()
  const env = {
    ...process.env,
    ...(app.isPackaged ? {} : readEnvFile(path.join(REPO_ROOT, '.env'))),
    ...readEnvFile(path.join(CONFIG_DIR, '.env')),
    API_HOST: '127.0.0.1',
    API_PORT: String(PORT),
    API_RELOAD: '0',
    UI_DIST_DIR,
    API_BASE_URL: API,
    FRONTEND_URL: DEV_URL || API,
    PYTHONUNBUFFERED: '1',
  }
  backend = spawn(python, [path.join(BACKEND_DIR, 'pod_manager_api.py')], { cwd: CONFIG_DIR, env, stdio: 'inherit' })
  backend.on('error', (e) => {
    backendError = e
  })
  return python
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
  const fromEnv = { ...(app.isPackaged ? {} : readEnvFile(path.join(REPO_ROOT, '.env'))), ...readEnvFile(path.join(CONFIG_DIR, '.env')) }
  for (const [k, v] of Object.entries(fromEnv)) if (!(k in process.env)) process.env[k] = v
  if (app.isPackaged) {
    process.env.MOUNT_POINTS_FILE ||= path.join(process.resourcesPath, 'backend', 'mount-points.json')
    process.env.GOVERNANCE_DIR ||= path.join(process.resourcesPath, 'backend', 'governance')
  }
}

async function boot() {
  if (process.platform === 'darwin' && !app.isPackaged && exists(ICON)) app.dock.setIcon(nativeImage.createFromPath(ICON))
  coreEnv()
  coreBridge.register()
  coreBridge.startIdleWatch().catch((e) => console.error(`idle watch: ${e.message}`))
  createWindow()
  await win.loadFile(path.join(__dirname, 'loading.html'))

  // The core runs in this process; the page loads from the app's own files. The deprecated
  // Python backend is optional: when a Python is found it is started for the parts not ported
  // yet (git accounts, repositories, image env, OAuth) and the page is served from it so the
  // OAuth round-trip lands home. Without it the app still runs; those four parts report
  // "not available" when used.
  // RUNPOD_MANAGER_NO_BACKEND=1 skips the Python backend on purpose (the self-contained boot, as a packaged app without Python behaves).
  const noBackend = !!process.env.RUNPOD_MANAGER_NO_BACKEND
  let backendUp = !noBackend && (await healthy())
  if (!backendUp && !noBackend && exists(findPython())) {
    startBackend()
    backendUp = await waitForBackend(15_000)
    if (!backendUp) console.warn('Python backend did not start; git accounts, repositories, image env and OAuth are unavailable this session')
  }
  if (DEV_URL) await win.loadURL(DEV_URL)
  else if (backendUp) await win.loadURL(API)
  else await win.loadFile(path.join(UI_DIST_DIR, 'index.html'))

  // RUNPOD_MANAGER_SMOKE=1: report what loaded and exit — a headless check for CI / packaging.
  if (process.env.RUNPOD_MANAGER_SMOKE) {
    const title = await win.webContents.executeJavaScript('document.title')
    const brand = await win.webContents.executeJavaScript('document.querySelector(".navbar-brand")?.textContent.trim() ?? ""')
    // The core over IPC, from the page: the GPU menu and the mount configuration's mode.
    const bridge = await win.webContents.executeJavaScript(
      "window.core ? Promise.all([window.core.invoke('pods','gpus'), window.core.invoke('mounts','get')]).then(([g, m]) => `gpus=${g.gpus.map((x) => x.value).join(',')} mode=${m.mode} folders=${m.folders.length}`).catch((e) => 'bridge error: ' + e.message) : 'no bridge'",
    )
    console.log(`SMOKE url=${win.webContents.getURL()} title="${title}" brand="${brand}" backend=${backend ? 'spawned' : backendUp ? 'external' : 'none'} core: ${bridge}`)
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
  if (backend && backend.exitCode === null) backend.kill()
})
