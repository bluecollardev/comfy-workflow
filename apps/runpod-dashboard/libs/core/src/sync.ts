/**
 * Push and pull between this PC's mapped folders and the network volume (docs/ADR-007).
 *
 * One plan, two transports. Push: the mapped folders go to their places under the mount path,
 * plates only with a named yes (shared/governance/policy/agent-permissions.md), the repo's
 * workflows beside ComfyUI-Shared's. Pull: what the pod writes comes back, ComfyUI's output and
 * each shot's renders and packages (ADR-007's table of who writes where). Over SSH it is rsync
 * into a running pod; over RunPod's S3 API (option G) it is the AWS CLI straight onto the volume
 * with no pod, which only the S3 datacenters serve.
 *
 * Everything here is pure: the plans say which folder goes where, the command builders return
 * argv, the CLI runs the processes. Additive both ways: --delete is never passed, nothing on
 * either side is removed.
 */
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CoreError, bad } from './errors.js'
import * as mounts from './mounts.js'
import { REPO_ROOT } from './paths.js'
import { S3_DATACENTERS } from './pods.js'
import type { RawPod } from './runpod.js'
import * as settings from './settings.js'

/** One copy: `local` on this PC, `remote` on the volume as the pod sees it (under the mount path). Both end in '/'. */
export interface Step { key: string; local: string; remote: string }

/** What never leaves the PC: OS litter, git, Python caches, logs, virtualenvs. rsync patterns. */
export const EXCLUDE = ['.DS_Store', '._*', '.git', '__pycache__', '*.pyc', 'logs/', '.venv/']

/** The repo's workflows (ours, tracked in git) go to comfy-shared/workflows on the volume, the folder the image links
 *  ComfyUI's Workflows panel to. Key `workflows`. */
export const WORKFLOWS_DIR = resolve(REPO_ROOT, 'apps', 'comfy-app', 'workflows')

const slash = (p: string) => p.replace(/\/+$/, '') + '/'

// ----- push -----

/** The folders to copy up, in the panel's order: plates only when asked, an unmapped folder skipped with a word
 *  to `warn`, `only` narrowing to the keys named (project, plates, comfy-shared, workflows). */
export function plan(cfg: mounts.MountsConfig, only: Set<string> = new Set(), plates = false, warn: (msg: string) => void = () => {}): Step[] {
  const out: Step[] = []
  const rows = mounts.folderRows(cfg)
  for (const r of rows) {
    if (r.custom || (only.size && !only.has(r.key))) continue
    if (r.key === 'plates' && !plates) continue
    if (!r.local) { warn(`skip ${r.key}: not mapped on this PC`); continue }
    out.push({ key: r.key, local: slash(r.local), remote: slash(r.container) })
  }
  // The workflows ride with comfy-shared's place on the volume, whether or not that folder is mapped here.
  const shared = rows.find((r) => r.key === 'comfy-shared')
  if (shared && (!only.size || only.has('workflows'))) out.push({ key: 'workflows', local: slash(WORKFLOWS_DIR), remote: slash(shared.container) + 'workflows/' })
  return out
}

// ----- rsync over SSH -----

/** root@<public ip> and the port of the pod's 22/tcp mapping, from RunPod's pod record. */
export function sshTarget(pod: RawPod): { host: string; port: number } {
  for (const p of pod.runtime?.ports || []) {
    if (p.privatePort === 22 && p.isIpPublic) return { host: `root@${p.ip}`, port: Number(p.publicPort) }
  }
  throw new CoreError(409, `pod ${pod.id}: no public 22/tcp port; is it running with SSH exposed?`)
}

/** macOS ships openrsync, which has --progress but not --info=progress2. Takes `rsync --version`'s output. */
export const progressFlag = (version: string) => (/openrsync/.test(version) ? '--progress' : '--info=progress2')

/** verbose: every file named as it lands (the app's progress view); stats: the counts at the end (the listing pass);
 *  exclude: patterns beyond EXCLUDE (the renders); shallow: the folder's own files and its directory entries, no recursion (the root stream). */
export interface RsyncOptions { dryRun?: boolean; progress?: string; verbose?: boolean; stats?: boolean; exclude?: string[]; shallow?: boolean }

// -rlt, not -a: the network volume refuses chown, so no owner, group or perms; times and links are kept.
// With progress2 the whole list is scanned first (--no-inc-recursive): the percentage is of the real total and only
// climbs; scanned incrementally it falls back every time more files turn up. openrsync has neither option.
function rsyncBase(port: number, o: RsyncOptions): string[] {
  const progress = o.progress || '--info=progress2'
  return ['rsync', ...(o.dryRun ? ['-n'] : []), ...(o.verbose ? ['-v'] : []), ...(o.stats ? ['--stats'] : []), ...(o.shallow ? ['-lt', '-d'] : ['-rlt']), progress, ...(progress === '--info=progress2' ? ['--no-inc-recursive'] : []), '--partial',
    '-e', `ssh -p ${port} -o StrictHostKeyChecking=accept-new`, ...[...EXCLUDE, ...(o.exclude || [])].flatMap((e) => ['--exclude', e])]
}
/** Push one folder into the pod. */
export const rsyncCmd = (local: string, host: string, port: number, remote: string, o: RsyncOptions = {}): string[] =>
  [...rsyncBase(port, o), local, `${host}:${remote}`]
/** Pull one folder out of the pod. */
export const rsyncPullCmd = (host: string, port: number, remote: string, local: string, o: RsyncOptions = {}): string[] =>
  [...rsyncBase(port, o), `${host}:${remote}`, local]

// ----- RunPod's S3 API onto the volume -----

/** A network volume as the S3 transport needs it: the bucket is the volume id, the endpoint is per datacenter. */
export interface VolumeRef { id: string; datacenter: string }

export const s3Endpoint = (datacenter: string) => `https://s3api-${datacenter.toLowerCase()}.runpod.io/`

/** Refuse the S3 transport unless the volume sits in a datacenter that serves it, and say where it is served. */
export function assertS3(volume: VolumeRef | null): VolumeRef {
  if (!volume) throw bad('No network volume: set one in Configuration or pass --volume <id>')
  if (!S3_DATACENTERS.has(volume.datacenter)) {
    throw bad(`Volume ${volume.id} is in ${volume.datacenter}, which has no S3 API. RunPod serves it in ${[...S3_DATACENTERS].join(', ')} (docs/ADR-007, option G): make a volume there, or sync over SSH into a running pod (--pod <id>).`)
  }
  return volume
}

/** The key prefix on the bucket for a path on the pod: the volume is the bucket, so the mount path comes off. */
export function s3Key(remote: string, mountPath = '/workspace'): string {
  const base = slash(mountPath || '/workspace')
  if (!remote.startsWith(base)) throw bad(`${remote} is not under the volume's mount path ${base}`)
  return remote.slice(base.length)
}

/** The AWS CLI's exclude globs for EXCLUDE: `*` crosses '/', so each name is matched at the root and below, as a file and as a folder. */
export const s3Excludes = (): string[] => EXCLUDE.map((e) => e.replace(/\/$/, '')).flatMap((n) => [n, `*/${n}`, `${n}/*`, `*/${n}/*`]).flatMap((p) => ['--exclude', p])

/** The AWS CLI's globs for the run's own excludes: `/NAME/` is the top level of the folder pushed, `NAME/` that folder anywhere below it. */
export const s3ExcludesFor = (exclude: string[] = []): string[] => exclude.flatMap((e) => {
  const name = e.replace(/^\//, '').replace(/\/$/, '')
  return (e.startsWith('/') ? [`${name}/*`] : [`${name}/*`, `*/${name}/*`]).flatMap((g) => ['--exclude', g])
})

export const S3_KEYS = ['RUNPOD_S3_ACCESS_KEY', 'RUNPOD_S3_SECRET_KEY'] as const

/** The env the AWS CLI reads, from RUNPOD_S3_ACCESS_KEY / RUNPOD_S3_SECRET_KEY in the environment or the settings file. */
export function s3Env(lookup: (name: string) => string = settings.lookup): Record<string, string> {
  const [access, secret] = S3_KEYS.map(lookup)
  if (!access || !secret) throw new CoreError(401, `${S3_KEYS.join(' and ')} are not set: make an S3 API key in the RunPod console (Settings, S3 API keys; the secret shows once) and put both in the environment or ${settings.file()}`)
  return { AWS_ACCESS_KEY_ID: access, AWS_SECRET_ACCESS_KEY: secret }
}

export interface S3Options { mountPath?: string; dryRun?: boolean; exclude?: string[] }

// cp --recursive, not sync: sync struggles past 10,000 files (ADR-007 G), so the push goes folder by folder; a rerun
// carries on over what is there, files over the part size go up as multipart, and nothing is ever removed.
function s3Base(volume: VolumeRef, o: S3Options): string[] {
  return ['aws', 's3', 'cp', '--recursive', '--endpoint-url', s3Endpoint(volume.datacenter), '--region', volume.datacenter, ...(o.dryRun ? ['--dryrun'] : []), ...s3Excludes(), ...s3ExcludesFor(o.exclude)]
}
const bucketUrl = (volume: VolumeRef, remote: string, o: S3Options) => `s3://${volume.id}/${s3Key(remote, o.mountPath)}`
/** Push one folder onto the volume. */
export const s3Cmd = (local: string, volume: VolumeRef, remote: string, o: S3Options = {}): string[] => [...s3Base(volume, o), local, bucketUrl(volume, remote, o)]
/** Pull one folder off the volume. */
export const s3PullCmd = (volume: VolumeRef, remote: string, local: string, o: S3Options = {}): string[] => [...s3Base(volume, o), bucketUrl(volume, remote, o), local]

// ----- pull -----

/** Where the shots live and what a shot is called (shared/shapes/shot-folder.json: applies_to, name_pattern). */
export const SHOT_AREAS = ['10_CORROSION', '20_STEREO', '30_CREATIVE', '40_TITLES', '50_RND']
export const SHOT_NAME = /^[a-z]+-[0-9]{3}[a-z]?$/
/** The folders a pod writes in a shot (ADR-007's table). */
export const SHOT_OUTPUTS = { review: '06_REVIEW', deliver: '07_DELIVER' } as const
export const PULL_KEYS = ['output', 'shared/input', 'shared/models', 'shared/workflows', ...Object.keys(SHOT_OUTPUTS)]

const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }

/** The shots in the project tree on this PC, as `<area>/<shot>`, sorted. Templates and anything not shaped like a shot are left out. */
export function listShots(projectRoot: string): string[] {
  const out: string[] = []
  for (const area of SHOT_AREAS) {
    const dir = join(projectRoot, area)
    if (!isDir(dir)) continue
    for (const name of readdirSync(dir).sort()) if (SHOT_NAME.test(name) && isDir(join(dir, name))) out.push(`${area}/${name}`)
  }
  return out
}

/** What comes down: ComfyUI's output, then each shot's 06_REVIEW and 07_DELIVER. `shots` are `<area>/<shot>` under
 *  the project tree (listShots); `only` narrows to output, review, deliver. A folder not mapped here is skipped with a
 *  word to `warn`. */
export function pullPlan(cfg: mounts.MountsConfig, shots: string[], only: Set<string> = new Set(), warn: (msg: string) => void = () => {}): Step[] {
  const want = (k: string) => !only.size || only.has(k)
  const rows = mounts.folderRows(cfg)
  const out: Step[] = []
  const shared = rows.find((r) => r.key === 'comfy-shared')
  const keyOf = (d: string) => (d === 'output' ? 'output' : `shared/${d}`)
  const dirs = (cfg.pull_shared ?? [...mounts.PULL_SHARED_DEFAULT]).filter((d) => want(keyOf(d)))
  if (shared && dirs.length) {
    if (!shared.local) warn('skip output: comfy-shared is not mapped on this PC')
    else for (const d of dirs) out.push({ key: keyOf(d), local: slash(shared.local) + d + '/', remote: slash(shared.container) + d + '/' })
  }
  const project = rows.find((r) => r.key === 'project')
  const shotKeys = Object.entries(SHOT_OUTPUTS).filter(([k]) => want(k))
  if (project && shotKeys.length) {
    if (!project.local) warn('skip shots: project is not mapped on this PC')
    else for (const shot of shots) for (const [, folder] of shotKeys) out.push({ key: `${shot}/${folder}`, local: `${slash(project.local)}${shot}/${folder}/`, remote: `${slash(project.container)}${shot}/${folder}/` })
  }
  return out
}
