/**
 * The BKK return layout, the manifest and the hashes (docs/ADR-050, "The BKK return layout, the manifest and the Tunnel proxy"). Pure functions: the
 * keys a publish uses under `<prefix><round>/`, the `RETURN-MANIFEST.json` (schema bh-return-1) and its merge with the one already in the round.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename, posix } from 'node:path'
import { bad, CoreError } from './errors.js'

export type Layout = 'as-is' | 'bkk-return'
export const ROUND_RE = /^[A-Za-z0-9._-]{3,100}$/
export const SCHEMA = 'bh-return-1', MANIFEST = 'RETURN-MANIFEST.json'
export const NEEDS_ROUND = 'Publishing to a return needs a round name'
const DPX_FRAME = /^(.*?)([._-]?)(\d+)\.dpx$/i
const MEDIA = /\.(mov|mp4|m4v|mxf|webm|avi|mkv)$/i

/** The layout of a destination: the setting when there is one, else bkk-return under returns/BKK/. */
export const layoutFor = (prefix: string, stored?: string): Layout => (stored === 'as-is' || stored === 'bkk-return' ? stored : /^returns\/BKK\//i.test(prefix) ? 'bkk-return' : 'as-is')
export function validateRound(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw bad(NEEDS_ROUND)
  const t = v.trim()
  if (!ROUND_RE.test(t) || t.includes('..')) throw bad('round is 3 to 100 characters: letters, digits and . _ - (for example qc_2026-11-02_r01)')
  return t
}
/** A clip name as the renders validate it (renders.validateClipName), kept here so this module needs nothing from them. */
export function validateClipName(v: unknown): string {
  if (typeof v !== 'string') throw bad('clip_names: each name is text')
  const t = v.trim()
  if (!t || t.length > 200) throw bad('clip_names: a name is 1 to 200 characters')
  if (t.includes('..') || !/^[A-Za-z0-9._ -]+$/.test(t)) throw bad('clip_names: a name has letters, digits and . _ - or space only')
  if (t.startsWith('.') || t.endsWith('.')) throw bad('clip_names: a name does not start or end with a dot')
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(t) || t.split(/[._ -]+/).some((x) => x.length >= 16 && /^[0-9a-f]+$/i.test(x))) throw bad('clip_names: a name must not contain a uuid or a hash')
  return t
}
export function validateClipNames(v: unknown): Record<string, string> {
  if (v === undefined || v === null) return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('clip_names maps a sequence stem to its clip name')
  const out: Record<string, string> = {}
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) { if (!k || k.length > 300 || /[\\/\0]/.test(k)) throw bad('clip_names: a stem is the file name before the frame number'); out[k] = validateClipName(n) }
  return out
}
export const dpxParts = (file: string): { stem: string; digits: string } | null => { const m = DPX_FRAME.exec(basename(file)); return m ? { stem: m[1], digits: m[3] } : null }
export const isMedia = (name: string): boolean => MEDIA.test(name)

export type Role = 'dpx' | 'proxy-h264' | 'review' | 'graph' | 'sidecar' | 'file'
export function roleOf(path: string): Role {
  const name = basename(path)
  if (/\.dpx$/i.test(name)) return 'dpx'
  if (/\.meta\.json$/i.test(name) || name === 'DELIVERY.md') return 'sidecar'
  if (/\.json$/i.test(name)) return 'graph'
  if (MEDIA.test(name)) return /(^|\/)deliver\//.test(path) || /\.(mov|mxf)$/i.test(name) ? 'review' : 'proxy-h264'
  return 'file'
}
export interface KeyInfo { key: string; shot: string; clip: string; stem: string; role: Role; renamed_from?: string }
/** Where one file goes under the round: DPX frames to `<shot>/<clip>/<clip>.<frame>.dpx` (the frame number as it is on disk), movies to `<shot>/<clip>.<ext>`, the rest to `<shot>/<file>`. Frames on disk are never renamed. `shotOf(name, dir)` is the renders' rule. */
const SHOTLIKE = /^[A-Za-z]+-\d+/
/** The shot of a file: from its (delivered) clip name, else from its name on disk, else from the folder. */
const shotFrom = (clip: string, stem: string, dir: string, shotOf: (n: string, d: string) => string): string => (SHOTLIKE.test(clip) || !SHOTLIKE.test(stem) ? shotOf(clip, dir) : shotOf(stem, dir))
export function layoutKey(o: { prefix: string; round: string; path: string; clipNames: Record<string, string>; shotOf: (name: string, dir: string) => string; deliverShot?: (path: string) => string | null }): KeyInfo {
  const root = `${o.prefix}${o.round}/`, name = basename(o.path), dir = posix.dirname(o.path) === '.' ? '' : posix.dirname(o.path), role = roleOf(o.path)
  const dp = dpxParts(name)
  if (dp) {
    const clip = o.clipNames[dp.stem] ?? dp.stem, shot = shotFrom(clip, dp.stem, dir, o.shotOf)
    return { key: `${root}${shot}/${clip}/${clip}.${dp.digits}.dpx`, shot, clip, stem: dp.stem, role, ...(clip !== dp.stem ? { renamed_from: name } : {}) }
  }
  if (MEDIA.test(name)) {
    const ext = posix.extname(name), stem = name.slice(0, -ext.length), clip = o.clipNames[stem] ?? stem, shot = o.deliverShot?.(o.path) ?? shotFrom(clip, stem, dir, o.shotOf)
    return { key: `${root}${shot}/${clip}${ext}`, shot, clip, stem, role, ...(clip !== stem ? { renamed_from: name } : {}) }
  }
  const stem = name.replace(/\.meta\.json$/i, '').replace(/\.[^.]+$/, ''), clip = o.clipNames[stem] ?? stem, shot = o.deliverShot?.(o.path) ?? shotFrom(clip, stem, dir, o.shotOf)
  const file = clip !== stem && name.startsWith(`${stem}.`) ? `${clip}${name.slice(stem.length)}` : name   // a sidecar follows its clip's delivered name
  return { key: `${root}${shot}/${file}`, shot, clip, stem, role, ...(file !== name ? { renamed_from: name } : {}) }
}
/** The take of a clip name: `ARCHIVAL-077_A_FINAL_V03_...` is A, anything else main. */
/** The element of a clip name: the part between the shot and FINAL/STILL/ALT (`ARCHIVAL-087_RAIN_FINAL_V01_...` -> RAIN, `ARCHIVAL-077_A_FINAL_...` -> A). MAIN stays 'main' (as before). Until 2026-11-21 only a single letter was an element, so PLATFORM, RAIN, ASCENT, CHASM07... all became 'main' and one shot's elements shared one manifest. */
export const elementOf = (clip: string): string => {
  const m = /^[A-Za-z]+-\d+[a-z]?_(.+?)_(?:FINAL|STILL|ALT)(?:_|$)/i.exec(clip) ?? /^[A-Za-z]+-\d+[a-z]?_([A-Za-z])_/.exec(clip)
  if (!m) return 'main'
  const e = m[1]; return /^main$/i.test(e) ? 'main' : e.toUpperCase()
}

/** An ISO time with the local UTC offset, like 2026-11-19T14:21:31+07:00. */
export function isoWithOffset(ms: number): string {
  const d = new Date(ms), p = (n: number, l = 2) => String(n).padStart(l, '0'), off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`
}

/** The sha256 of a file, streamed in chunks (bounded memory, the main process stays free). */
export function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256'), s = createReadStream(path, { highWaterMark: 1 << 20 })
    const stop = () => { s.destroy(new CoreError(499, 'cancelled')) }
    signal?.addEventListener('abort', stop, { once: true })
    s.on('data', (c) => h.update(c)); s.on('error', (e) => { signal?.removeEventListener('abort', stop); reject(e) }); s.on('end', () => { signal?.removeEventListener('abort', stop); resolve(h.digest('hex')) })
  })
}
export const newHasher = () => createHash('sha256')

// ----- the manifest -----
export interface MediaInfo { /** the Tunnel proxy's colour block (working space, transfer, how the proxy was made) */ colour?: { working_space: string; transfer: string; proxy: string }; /** what the proxy's sidecar adds to the item's notes (EDL override, low resolution, start timecode) */ notes?: string[]; width?: number; height?: number; fps?: string; frames?: number; codec?: string; bit_depth?: number; working_space?: string }
export interface ManifestFile { /** per sequence notes from the plan (the EDL override, the low resolution, the start timecode and where it came from) */ notes?: string[]; key: string; shot: string; clip: string; stem: string; role: Role; sha256: string; bytes: number; media?: MediaInfo; renamed_from?: string }
export interface Pod { provider: string; pod_id: string; gpu: string; hours: number; cost_usd: number; paid_by: string; provider_api_calls: number | string }
export const NO_POD: Pod = { provider: 'n/a', pod_id: 'n/a', gpu: 'n/a', hours: 0.0, cost_usd: 0.0, paid_by: 'n/a', provider_api_calls: 'n/a' }
export interface ManifestOutput { path: string; role: Role; sha256: string; bytes: number; width?: number; height?: number; fps?: string; frames?: number; codec?: string; bit_depth?: number; colour?: { working_space: string; transfer?: string; proxy?: string } }
export interface ManifestItem { shot: string; element: string; input_final: { delivered_name: string; sha256: string }; graph: { name: string; sha256: string; returned_path: string }; outputs: ManifestOutput[]; measures: { kind: string; frames: number; notes: string } }
export interface Manifest { schema_version: string; round: string; returned_by: string; returned_at: string; pod: Pod; items: ManifestItem[] }

export function buildItems(files: ManifestFile[], rootKey: string): ManifestItem[] {
  const groups = new Map<string, { shot: string; element: string; files: ManifestFile[] }>(), loose: ManifestFile[] = []
  for (const f of files) {
    if (f.role === 'dpx' || f.role === 'proxy-h264' || f.role === 'review') { const element = elementOf(f.clip), k = `${f.shot}|${element}`; (groups.get(k) ?? groups.set(k, { shot: f.shot, element, files: [] }).get(k)!).files.push(f) } else loose.push(f)
  }
  for (const f of loose) { const g = [...groups.values()].find((x) => x.shot === f.shot) ?? groups.set(`${f.shot}|main`, { shot: f.shot, element: 'main', files: [] }).get(`${f.shot}|main`)!; g.files.push(f) }
  const rel = (k: string) => (k.startsWith(rootKey) ? k.slice(rootKey.length) : k)
  return [...groups.values()].sort((a, b) => a.shot.localeCompare(b.shot) || a.element.localeCompare(b.element)).map((g) => {
    const dpx = g.files.filter((f) => f.role === 'dpx').sort((a, b) => a.key.localeCompare(b.key)), main = g.files.find((f) => f.role === 'review' || f.role === 'proxy-h264'), graph = g.files.find((f) => f.role === 'graph')
    const delivered = dpx[0]?.clip ?? main?.clip ?? g.shot
    const digest = dpx.length ? createHash('sha256').update(dpx.map((f) => `${basename(f.key)} ${f.sha256}\n`).join('')).digest('hex') : main?.sha256 ?? 'n/a'
    const renamed = g.files.find((f) => f.renamed_from)
    const outputs: ManifestOutput[] = g.files.sort((a, b) => a.key.localeCompare(b.key)).map((f) => ({ path: rel(f.key), role: f.role, sha256: f.sha256, bytes: f.bytes,
      ...(f.media ? { ...(f.media.width ? { width: f.media.width } : {}), ...(f.media.height ? { height: f.media.height } : {}), ...(f.media.fps ? { fps: f.media.fps } : {}), ...(f.media.frames !== undefined ? { frames: f.media.frames } : {}), ...(f.media.codec ? { codec: f.media.codec } : {}), ...(f.media.bit_depth ? { bit_depth: f.media.bit_depth } : {}), ...(f.media.colour || f.media.working_space ? { colour: f.media.colour ?? { working_space: f.media.working_space! } } : {}) } : {}) }))
    return { shot: g.shot, element: g.element, input_final: { delivered_name: delivered, sha256: digest }, graph: graph ? { name: basename(graph.key), sha256: graph.sha256, returned_path: rel(graph.key) } : { name: 'n/a', sha256: 'n/a', returned_path: 'n/a' }, outputs,
      measures: { kind: dpx.length ? 'FINAL delivery' : 'proxy', frames: dpx.length || main?.media?.frames || 0, notes: [...(renamed ? [`delivered as ${renamed.clip}; on disk ${renamed.stem}`] : []), ...new Set(g.files.flatMap((f) => [...(f.notes ?? []), ...(f.media?.notes ?? [])]))].join('; ') } }
  })
}
/** A problem a reader of one element's manifest should know about (ADR-055 section 10). Derived from what is in the item, never guessed: an empty list means none of these was found, not that the element was checked by a person. */
export interface Issue { code: 'no-dpx' | 'no-review-video' | 'no-h264' | 'no-frames'; severity: 'warning' | 'info'; text: string }
export function issuesOf(item: ManifestItem): Issue[] {
  const has = (r: Role) => item.outputs.some((o) => o.role === r), out: Issue[] = [], dpx = has('dpx')
  if (!dpx) out.push({ code: 'no-dpx', severity: 'warning', text: 'This element has no DPX frames in the delivery (a proxy only).' })
  else if (!item.measures.frames) out.push({ code: 'no-frames', severity: 'warning', text: 'The DPX frame count is zero.' })
  if (!has('review') && !has('proxy-h264')) out.push({ code: 'no-review-video', severity: dpx ? 'warning' : 'info', text: 'No review video (ProRes or H.264) was delivered with this element.' })
  else if (!has('proxy-h264')) out.push({ code: 'no-h264', severity: 'info', text: 'A ProRes review video was delivered but no H.264 proxy.' })
  return out
}
/** The manifest of this run merged into the one already in the round: the other shots' items stay, this run's shots are replaced. A manifest that cannot be read is a 409, never overwritten. */
export function mergeManifest(existing: string | null, o: { round: string; returned_by: string; now: number; pod: Pod; items: ManifestItem[] }): Manifest {
  let old: Manifest | null = null
  if (existing !== null) {
    try { old = JSON.parse(existing) as Manifest } catch { throw new CoreError(409, `The RETURN-MANIFEST.json already in round ${o.round} cannot be read (it is not valid JSON): nothing was overwritten. Fix or remove it on the bucket first.`) }
    if (!old || old.schema_version !== SCHEMA || !Array.isArray(old.items) || (old.round !== undefined && old.round !== o.round)) throw new CoreError(409, `The RETURN-MANIFEST.json already in round ${o.round} is not a ${SCHEMA} manifest for this round: nothing was overwritten.`)
  }
  // this run's elements replace their own entries only (shot + element): publishing 123 f must not drop the 123 c entry that an earlier run put in (until 2026-11-21 the whole shot was replaced)
  const mine = new Set(o.items.map((i) => `${i.shot}|${i.element}`)), kept = (old?.items ?? []).filter((i) => !mine.has(`${i.shot}|${i.element}`))
  const pod = o.pod.pod_id === 'n/a' && old?.pod && old.pod.pod_id !== 'n/a' ? old.pod : o.pod
  return { schema_version: SCHEMA, round: o.round, returned_by: o.returned_by, returned_at: isoWithOffset(o.now), pod, items: [...kept, ...o.items].sort((a, b) => a.shot.localeCompare(b.shot) || a.element.localeCompare(b.element)) }
}
