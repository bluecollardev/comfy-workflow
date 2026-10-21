// Electron main process. The core (libs/core: mounts, pods, GPUs, datacenters, governance, idle,
// git accounts, repositories, image env) runs in this process and the page reaches it over IPC
// (core.cjs, preload.cjs). There is no server and no Python: one app (docs/ADR-005).
//
// The page loads from the app's own files (dist/). In development, VITE_DEV_SERVER_URL=http://localhost:5173
// loads Vite's dev server instead, with hot reload, still over IPC to this process.
//
// Settings (RUNPOD_API_KEY, GITHUB_CLIENT_ID, …) come from ~/.config/runpod-pod-manager/.env
// (and <repo>/.env in development).

const { app, BrowserWindow, dialog, shell, nativeImage } = require('electron')
const coreBridge = require('./core.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DEV_URL = process.env.VITE_DEV_SERVER_URL
const CONFIG_DIR = path.join(os.homedir(), '.config', 'runpod-pod-manager')
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
})
