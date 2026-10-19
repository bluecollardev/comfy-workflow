// Electron main process: starts the FastAPI backend, waits for it, and loads the UI from it.
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
// Packaged: electron-builder copies infra/scripts → resources/backend and dist/ → resources/dist.
// Dev: the API is in infra/scripts and the built UI in apps/runpod-dashboard/dist.
const BACKEND_DIR = app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.join(REPO_ROOT, 'infra', 'scripts')
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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

async function boot() {
  if (process.platform === 'darwin' && !app.isPackaged && exists(ICON)) app.dock.setIcon(nativeImage.createFromPath(ICON))
  createWindow()
  await win.loadFile(path.join(__dirname, 'loading.html'))

  let python = null
  if (!(await healthy())) {
    python = startBackend()
    if (!(await waitForBackend(30_000))) {
      const envFile = path.join(CONFIG_DIR, '.env')
      dialog.showErrorBox(
        'Backend did not start',
        [
          `Tried to run the API with: ${python}`,
          backendError ? `Error: ${backendError.message}` : 'It exited or never answered on port 8000.',
          '',
          'Set up a Python 3.12 environment for it once:',
          `  python3 -m venv ${path.join(CONFIG_DIR, 'venv')}`,
          `  ${path.join(CONFIG_DIR, 'venv', 'bin', 'pip')} install -r "${path.join(BACKEND_DIR, 'requirements.txt')}"`,
          '',
          `Then put RUNPOD_API_KEY (and optional GITHUB_/GITLAB_ OAuth settings) in ${envFile} and relaunch.`,
        ].join('\n'),
      )
      return
    }
  }
  await win.loadURL(DEV_URL || API)

  // RUNPOD_MANAGER_SMOKE=1: report what loaded and exit — a headless check for CI / packaging.
  if (process.env.RUNPOD_MANAGER_SMOKE) {
    const title = await win.webContents.executeJavaScript('document.title')
    const brand = await win.webContents.executeJavaScript('document.querySelector(".navbar-brand")?.textContent.trim() ?? ""')
    console.log(`SMOKE url=${win.webContents.getURL()} title="${title}" brand="${brand}" backend=${backend ? 'spawned' : 'external'}`)
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
  if (backend && backend.exitCode === null) backend.kill()
})
