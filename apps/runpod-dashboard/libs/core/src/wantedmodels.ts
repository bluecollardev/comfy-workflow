/**
 * The stored wanted-models list and what to do with it (ADR-042 section 12): add and remove entries, record what a volume holds, read Binc's pull list,
 * say which entries a volume lacks, and load those onto it through the same Hugging Face fetch as Shared > Models. The list lives in the configuration
 * (mounts.json `wanted_models`) and travels in the export; it is tied to no volume, so any Shared volume in any datacenter can be filled from it.
 */
import { bad } from './errors.js'
import * as hf from './hf.js'
import * as mounts from './mounts.js'
import * as podpull from './podpull.js'
import * as pods from './pods.js'
import * as wanted from './wanted.js'
import * as history from './history.js'

type PullOpts = Parameters<typeof podpull.modelsOnVolume>[1]
export const BINC_LIST = 'comfy-shared/models/_canalv2_pull/MODELS_PULL_v003.csv'
const PER_JOB = 20

export const list = (): wanted.WantedModel[] => mounts.load().wanted_models
const save = (l: wanted.WantedModel[]) => { mounts.put({ ...mounts.load(), wanted_models: l }, { quiet: true }); return l }

/** Add (or replace by key) entries; each is checked as `wanted.check` does. Returns the list and what was added. */
export function add(items: unknown[]) {
  if (!Array.isArray(items) || !items.length) throw bad('Give at least one model.')
  const incoming = items.map((x) => wanted.check(x))
  const have = list(), before = new Set(have.map(wanted.keyOf))
  const next = wanted.merge(have, incoming)
  if (next.length === have.length && !incoming.some((e) => !before.has(wanted.keyOf(e)))) { /* only replaced */ }
  save(next)
  const added = incoming.filter((e) => !before.has(wanted.keyOf(e))).length
  history.record({ kind: 'change', area: 'configuration', action: 'wanted models added', what: `${added} new, ${incoming.length - added} updated` })
  return { added, updated: incoming.length - added, models: next }
}
/** Remove by key (`wanted.keyOf`), or every entry with `all`. */
export function remove(keys: string[], all = false) {
  const have = list()
  const next = all ? [] : have.filter((e) => !keys.includes(wanted.keyOf(e)))
  if (!all && !keys.length) throw bad('Name the entries to remove, or pass all.')
  save(next)
  history.record({ kind: 'change', area: 'configuration', action: 'wanted models removed', what: `${have.length - next.length}` })
  return { removed: have.length - next.length, models: next }
}

/** Binc's pull list, from pasted CSV text or read off the volume (S3, no cost): its rows added. */
export async function addPullList(o: { csv?: string; volume_id?: string }, opts: PullOpts = {}) {
  let text = o.csv
  if (text === undefined || text === '') {
    const vol = (o.volume_id || mounts.load().shared_volume_id || mounts.load().network_volume_id || '').trim()
    if (!vol) throw bad('No volume: pass volume_id, choose the Shared volume, or paste the CSV.')
    text = (await podpull.readVolumeText(vol, BINC_LIST, opts)) ?? undefined
    if (text === undefined) throw bad('The volume cannot be read over S3 from here (no S3 keys, or its datacenter has no S3 API): paste the CSV text instead.')
  }
  const { entries, skipped } = wanted.fromCsv(text)
  if (!entries.length) throw bad(`No usable rows in the list${skipped.length ? ` (${skipped.length} skipped: ${skipped[0].file}: ${skipped[0].why})` : ''}.`)
  return { ...add(entries), skipped }
}

const VOLUME = (v?: string) => (v || mounts.load().shared_volume_id || mounts.load().network_volume_id || '').trim()
const WEIGHT = /\.(safetensors|gguf|pth)$/i
/** Record what a volume holds under models/ (S3, no cost): weight files over 1 MB, with the repo and path of an entry already in the list kept, else with no repo. */
export async function saveInstalled(volumeId?: string, opts: PullOpts = {}) {
  const vol = VOLUME(volumeId); if (!vol) throw bad('No volume: pass volume_id or choose the Shared volume.')
  const onVol = await podpull.modelsOnVolume(vol, opts)
  if (onVol === null) throw bad('This volume cannot be listed over S3 from here (no S3 keys, or its datacenter has no S3 API).')
  const known = new Map(list().map((e) => [`${e.folder}/${e.name}`, e]))
  const items: wanted.WantedModel[] = []
  let skipped = 0
  for (const v of onVol) {
    if (!WEIGHT.test(v.name) || v.bytes < 1_000_000) { skipped++; continue }
    const parts = v.name.split('/'), file = parts.pop()!
    if (parts.length > 1) { skipped++; continue }
    const folder = [v.folder, ...parts].join('/')
    if (!hf.isFolder(folder)) { skipped++; continue }
    const k = known.get(`${folder}/${file}`)
    try { items.push(wanted.check({ ...(k ?? {}), folder, name: file, repo: k?.repo ?? '', path: k?.path ?? '', bytes: v.bytes })) } catch { skipped++ }
  }
  if (!items.length) throw bad('No weight files to record on this volume.')
  return { ...add(items), skipped }
}

export type RowState = 'present' | 'missing' | 'unknown'
export interface Row extends wanted.WantedModel { key: string; state: RowState; loadable: boolean }
export interface Status {
  volume_id: string; volume_name: string | null; datacenter: string | null; volume_gb: number | null
  rows: Row[]; present: number; missing: number; unknown: number; missing_bytes: number; present_bytes: number
  /** the models on the volume plus the missing ones are more than the volume's size (rounds and other data on it are not counted, so this is the least it needs) */
  short_by_bytes: number
}
/** Each wanted entry against what the volume holds (S3, no cost; 'unknown' where the volume cannot be listed that way). */
export async function status(volumeId?: string, opts: PullOpts = {}): Promise<Status> {
  const vol = VOLUME(volumeId); if (!vol) throw bad('No volume: pass volume_id or choose the Shared volume.')
  const [onVol, info] = await Promise.all([podpull.modelsOnVolume(vol, opts), pods.volumeInfo(vol, opts?.client).catch(() => null)])
  const have = new Map((onVol ?? []).map((v) => [`${v.folder}/${v.name}`, v.bytes]))
  const rows: Row[] = list().map((e) => {
    const got = have.get(`${e.folder}/${e.name}`)
    const state: RowState = onVol === null ? 'unknown' : got !== undefined && (e.bytes === 0 || got >= e.bytes * 0.98) ? 'present' : 'missing'
    return { ...e, key: wanted.keyOf(e), state, loadable: !!e.repo }
  })
  const sum = (s: RowState) => rows.filter((r) => r.state === s).reduce((n, r) => n + r.bytes, 0)
  const present_bytes = onVol ? onVol.reduce((n, v) => n + v.bytes, 0) : 0, missing_bytes = sum('missing')
  const cap = info ? info.size_gb * 1e9 : null
  return {
    volume_id: vol, volume_name: info?.name ?? null, datacenter: info?.datacenter ?? null, volume_gb: info?.size_gb ?? null, rows,
    present: rows.filter((r) => r.state === 'present').length, missing: rows.filter((r) => r.state === 'missing').length, unknown: rows.filter((r) => r.state === 'unknown').length,
    missing_bytes, present_bytes, short_by_bytes: cap === null ? 0 : Math.max(0, present_bytes + missing_bytes - cap),
  }
}

const chains = new Map<string, { volume_id: string; jobs: string[]; chunks: number; state: 'running' | 'done' | 'stopped'; error?: string }>()
export const chainOf = (volumeId: string) => chains.get(volumeId) ?? null
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Load what the volume lacks, in jobs of at most 20 files one after another (a volume runs one job at a time): the first job is started and returned,
 * the rest follow when each finishes, stopping at the first that fails. An entry with no repo cannot be loaded (it only names a file). Repos that are
 * gated are refused by Hugging Face's lookup, as in Shared > Models; that stops the job it is in with Hugging Face's message.
 * With S3 not available the whole list is sent: the pod skips a file already there at the right size.
 */
export async function loadMissing(volumeId?: string, o: { approved_by?: string; poll_ms?: number } = {}, opts: PullOpts & { fetchFn?: typeof fetch; fetchModels?: typeof podpull.fetchModels; jobOf?: typeof podpull.job } = {}) {
  const vol = VOLUME(volumeId); if (!vol) throw bad('No volume: pass volume_id or choose the Shared volume.')
  const fetchModels = opts.fetchModels ?? podpull.fetchModels, jobOf = opts.jobOf ?? podpull.job
  const running = chains.get(vol); if (running?.state === 'running') throw bad('A load is already running on this volume: wait for it to finish.')
  const st = await status(vol, opts)
  const todo = st.rows.filter((r) => r.state !== 'present' && r.loadable)
  if (!todo.length) throw bad(st.rows.length ? 'Nothing to load: every wanted model that has a repo is on this volume.' : 'The wanted list is empty.')
  const items: hf.FetchItem[] = todo.map((r) => ({ repo: r.repo, path: r.path, revision: r.revision ?? 'main', folder: r.folder }))
  const chunks: hf.FetchItem[][] = []
  for (let i = 0; i < items.length; i += PER_JOB) chunks.push(items.slice(i, i + PER_JOB))
  const first = await fetchModels(vol, chunks[0], { approved_by: o.approved_by }, opts)
  const chain = { volume_id: vol, jobs: [first.id], chunks: chunks.length, state: 'running' as 'running' | 'done' | 'stopped', error: undefined as string | undefined }
  chains.set(vol, chain)
  void (async () => {
    try {
      let cur = first.id
      for (let c = 1; c <= chunks.length; c++) {
        for (;;) { const j = jobOf(cur); if (!j) throw new Error('the job is gone'); if (['done', 'failed', 'cancelled'].includes(j.state)) { if (j.state !== 'done') throw new Error(j.error || `job ${j.state}`); break } await sleep(o.poll_ms ?? 3000) }
        if (c === chunks.length) break
        cur = (await fetchModels(vol, chunks[c], { approved_by: o.approved_by }, opts)).id; chain.jobs.push(cur)
      }
      chain.state = 'done'
    } catch (e) { chain.state = 'stopped'; chain.error = (e as Error).message }
  })()
  const need = todo.reduce((n, r) => n + r.bytes, 0)
  return { job: first, jobs: chunks.length, files: items.length, bytes: need, volume_gb: st.volume_gb, short_by_bytes: st.short_by_bytes, warning: st.short_by_bytes > 0 ? `The volume is ${st.volume_gb} GB; the models alone need about ${Math.ceil((st.present_bytes + st.missing_bytes) / 1e9)} GB. Grow it first (Volumes > Resize).` : null }
}
