// Launch the real app for a test: its own config folder (never the user's), no Python backend,
// the core over IPC. `dry: true` turns no-spend mode on through the environment.
import { _electron as electron, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

export async function launchApp({ dry = true, live = false, env: extra = {} } = {}) {
  const configDir = mkdtempSync(join(tmpdir(), 'runpod-manager-e2e-'))
  const env = {
    ...process.env,
    ...(live ? dotenv(join(REPO, '.env')) : {}),
    POD_MANAGER_CONFIG_DIR: configDir,
    MOUNTS_FILE: join(configDir, 'mounts.json'),
    IDLE_FILE: join(configDir, 'idle.json'),
    DRY_PODS_FILE: join(configDir, 'dry-pods.json'),
    CLAUDE_USER_SETTINGS: join(configDir, 'claude-user-settings.json'),   // the shell guard writes a hook into the user's Claude settings: a spec must never touch the real ~/.claude
    RUNPOD_MANAGER_NO_BACKEND: '1',
    IDLE_WATCH: '0',
    COMFY_MODE: 'dev',
    SYNC_SIM_MS: '60',   // a simulated Sync paces its events, so a spec sees the run as a person would
    ...extra,
  }
  if (dry) env.RUNPOD_DRY_RUN = '1'; else delete env.RUNPOD_DRY_RUN
  if (!live) delete env.RUNPOD_API_KEY
  env.PANAMA_S3_PROFILE ||= 'no-such-profile-for-tests'   // this PC's real AWS profile 'panama' must not turn the BH source on in a spec (docs/ADR-016)
  const app = await electron.launch({ args: ['.', `--user-data-dir=${join(configDir, 'profile')}`], cwd: APP, env })   // its own profile: what the real app remembers (the Studio's view, wrap) must not reach a spec
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.navbar-brand').waitFor()
  return { app, page, configDir }
}

export const toast = (page) => page.getByTestId('toast')
export const podCard = (page, name) => page.locator(`[data-testid="pod-card"][data-name="${name}"]`)
export const configModal = (page) => page.locator('.modal.show', { has: page.getByTestId('config-modal') })
export async function openCreatePod(page) {
  await page.getByTestId('create-pod-toggle').click()
  await page.locator('#pod-name').waitFor()
}

export const SIM_VOLUME = { id: 'dryvole2e', name: 'sim-volume' }
/** The Sync window is a network volume's (docs/ADR-067): give the simulated app a volume, the Default Configuration's, so every simulated pod is on it; then open it from its row. */
/** The Sync window sits on the Storage windows: close whatever is left before the next spec uses the app. */
export async function closeWindows(page) {
  await expect(async () => { await page.keyboard.press('Escape'); await expect(page.locator('.modal.show')).toHaveCount(0, { timeout: 500 }) }).toPass({ timeout: 15_000 })
}
export async function openSimVolumeSync(page, configDir, podName) {
  // a simulated pod boots for a while: only a running one can be synced
  await expect(podCard(page, podName).getByTestId('pod-status-dot')).toHaveAttribute('data-status', 'running', { timeout: 90_000 })
  writeFileSync(join(configDir, 'dry-volumes.json'), JSON.stringify([{ ...SIM_VOLUME, size: 10, dataCenterId: 'local' }]))
  const file = join(configDir, 'mounts.json')
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), network_volume_id: SIM_VOLUME.id }, null, 2))
  await page.getByTestId('open-shared').click(); await page.getByTestId('shared-volumes').click()
  await page.locator(`[data-testid="volume"][data-id="${SIM_VOLUME.id}"]`).getByTestId('volume-sync-btn').click()
  const sync = page.getByTestId('sync-modal')
  await expect(sync.getByTestId('sync-from-pod')).toBeVisible()
  await sync.getByTestId('sync-from-pod').selectOption({ label: podName })
  return sync
}
