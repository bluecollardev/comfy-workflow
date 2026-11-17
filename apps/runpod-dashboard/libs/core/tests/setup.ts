/**
 * Runs before every core test file (vitest `setupFiles`): the config directory is a scratch one, so a test that forgets to
 * isolate a file (History, mounts, settings, backups, the volume cache, Claude's settings) writes into the scratch one
 * and never into the user's real ~/.config/runpod-pod-manager (ADR-042 section 18). `helpers.scratch()` still replaces it per test.
 */
import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setStopReader } from '../src/outputruns.js'

setStopReader(async () => null)   // a test that stops a pod never reads a real pod's history first (outputruns.test.ts sets its own)

const dir = mkdtempSync(join(tmpdir(), 'runpod-core-global-'))
process.env.POD_MANAGER_CONFIG_DIR = dir
process.env.CLAUDE_USER_SETTINGS = join(dir, 'claude-settings.json')
for (const k of ['MOUNTS_FILE', 'HISTORY_FILE', 'SETTINGS_ENV_FILE', 'POD_MANAGER_BACKUPS_DIR', 'GIT_ACCOUNTS_FILE', 'REPOSITORIES_FILE', 'QUEUE_FILE', 'IDLE_FILE', 'VOLUMES_CACHE_FILE', 'OUTPUT_RUNS_FILE']) delete process.env[k]
;(globalThis as Record<string, unknown>).__realConfigDir = join(homedir(), '.config', 'runpod-pod-manager')
