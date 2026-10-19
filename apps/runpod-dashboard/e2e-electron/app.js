// Launch the real app for a test: its own config folder (never the user's), no Python backend,
// the core over IPC. `dry: true` turns no-spend mode on through the environment.
import { _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const APP = resolve(import.meta.dirname, '..')
const REPO = resolve(APP, '..', '..')

function dotenv(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

export async function launchApp({ dry = true, live = false } = {}) {
  const configDir = mkdtempSync(join(tmpdir(), 'runpod-manager-e2e-'))
  const env = {
    ...process.env,
    ...(live ? dotenv(join(REPO, '.env')) : {}),
    POD_MANAGER_CONFIG_DIR: configDir,
    MOUNTS_FILE: join(configDir, 'mounts.json'),
    IDLE_FILE: join(configDir, 'idle.json'),
    DRY_PODS_FILE: join(configDir, 'dry-pods.json'),
    RUNPOD_MANAGER_NO_BACKEND: '1',
    IDLE_WATCH: '0',
    COMFY_MODE: 'dev',
  }
  if (dry) env.RUNPOD_DRY_RUN = '1'; else delete env.RUNPOD_DRY_RUN
  if (!live) delete env.RUNPOD_API_KEY
  const app = await electron.launch({ args: ['.'], cwd: APP, env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.navbar-brand').waitFor()
  return { app, page, configDir }
}

export const toast = (page) => page.locator('.toast-container .toast')
export const podCard = (page, name) => page.locator('.card.h-100', { hasText: name })
export async function openCreatePod(page) {
  await page.locator('[aria-controls="create-pod-form"]').click()
  await page.getByLabel('Name').waitFor()
}
