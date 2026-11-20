/**
 * Runs before every core test file (vitest `setupFiles`): the config directory is a scratch one, so a test that forgets to
 * isolate a file (History, mounts, settings, backups, the volume cache, Claude's settings) writes into the scratch one
 * and never into the user's real ~/.config/runpod-pod-manager (ADR-042 section 18). `helpers.scratch()` still replaces it per test.
 */
import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setStopReader } from '../src/outputruns.js'
import { setAwsOverride, setAwsRetrySleep } from '../src/podpull.js'
import { setFfmpegOverride } from '../src/publish.js'
import { setRetrySleep } from '../src/runpod.js'

setAwsOverride(async () => ({ code: 127, stdout: '', stderr: 'aws is not run in tests: inject an AwsRunner' }))   // no test ever reaches a real volume
delete process.env.RUNPOD_API_KEY   // a test that needs a key sets its own; none ever reaches the real RunPod with the developer's
setRetrySleep(async () => {})   // the RunPod client's wait between network retries is instant in tests
setAwsRetrySleep(async () => {})   // the wait between aws retries is instant in tests
setFfmpegOverride(async () => null)   // a test that publishes with a preview frame gives its own ffmpeg lookup; none ever runs the real one
setStopReader(async () => null)   // a test that stops a pod never reads a real pod's history first (outputruns.test.ts sets its own)

const dir = mkdtempSync(join(tmpdir(), 'runpod-core-global-'))
process.env.POD_MANAGER_CONFIG_DIR = dir
process.env.CLAUDE_USER_SETTINGS = join(dir, 'claude-settings.json')
for (const k of ['MOUNTS_FILE', 'HISTORY_FILE', 'SETTINGS_ENV_FILE', 'POD_MANAGER_BACKUPS_DIR', 'GIT_ACCOUNTS_FILE', 'REPOSITORIES_FILE', 'QUEUE_FILE', 'IDLE_FILE', 'VOLUMES_CACHE_FILE', 'OUTPUT_RUNS_FILE']) delete process.env[k]
;(globalThis as Record<string, unknown>).__realConfigDir = join(homedir(), '.config', 'runpod-pod-manager')

// the pod logs are kept at the end of a run and before a pod is deleted; the suite never reaches a pod (podlogs.test.ts passes its own deps)
process.env.POD_LOGS_OFF = '1'
