import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the core's files live: config under ~/.config/runpod-pod-manager, the shape and the governance
 *  copy in the repo checkout or beside the packaged app. Every path can be overridden by env for tests. */
const HERE = dirname(fileURLToPath(import.meta.url))          // libs/core/src or libs/core/dist
export const PACKAGE_DIR = resolve(HERE, '..')                  // apps/runpod-dashboard/libs/core
export const APP_DIR = resolve(PACKAGE_DIR, '..', '..')          // apps/runpod-dashboard
export const REPO_ROOT = resolve(APP_DIR, '..', '..')

export const configDir = () => process.env.POD_MANAGER_CONFIG_DIR || join(homedir(), '.config', 'runpod-pod-manager')
export const mountsFile = () => process.env.MOUNTS_FILE || join(configDir(), 'mounts.json')
export const idleFile = () => process.env.IDLE_FILE || join(configDir(), 'idle.json')
export const podConfigsFile = () => process.env.POD_CONFIGS_FILE || join(configDir(), 'pod-configs.json')
export const gitAccountsFile = () => process.env.GIT_ACCOUNTS_FILE || join(configDir(), 'git_accounts.json')
export const repositoriesFile = () => process.env.REPOSITORIES_FILE || join(configDir(), 'repositories.json')
export const dockerfilePath = () => process.env.DOCKERFILE_PATH || join(REPO_ROOT, 'apps', 'comfy-app', 'Dockerfile')
export const mirrorDir = () => resolve(REPO_ROOT, 'projects', 'desktop')   // Binc's mirror, read-only by rule

export function shapeFile(): string | null {
  const candidates = [
    process.env.MOUNT_POINTS_FILE,
    join(REPO_ROOT, 'shared', 'shapes', 'mount-points.json'),   // repo checkout
    join(PACKAGE_DIR, 'mount-points.json'),
    join(PACKAGE_DIR, 'backend', 'mount-points.json'),          // packaged app: resources/backend, found from resources/core
  ].filter(Boolean) as string[]
  return candidates.find((p) => existsSync(p)) || null
}

export function governanceDir(): string | null {
  const candidates = [
    process.env.GOVERNANCE_DIR,
    join(REPO_ROOT, 'shared', 'governance'),
    join(PACKAGE_DIR, 'governance'),
    join(PACKAGE_DIR, 'backend', 'governance'),                 // packaged app
  ].filter(Boolean) as string[]
  return candidates.find((p) => existsSync(p)) || null
}

export const readJson = <T = unknown>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T
