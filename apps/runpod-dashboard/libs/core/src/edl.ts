/**
 * The EDL (docs/ADR-050, "The EDL decides timecode, frame count and what may be delivered"): the CMX3600 edit list of the V11 cut, read from the
 * Panama exchange bucket (or a file), parsed into EVENTS and grouped per ELEMENT (a clip name), cached under the config folder with its sha256 so it
 * works offline. Read-only: nothing is ever written to the bucket. Async and chunked; no secret is read or logged.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bad, CoreError } from './errors.js'
import { configDir } from './paths.js'
import * as mounts from './mounts.js'
import * as panama from './panama.js'
import * as podpull from './podpull.js'

export const DEFAULT_KEY = 'rounds/tunnel-v11-edl-2026-11-18/PANAMA 2026_2.0_v11_110426_COLOR_VFX1.edl'
export const FPS = 24, MAX_BYTES = 4 * 1024 * 1024
export type Source = { bucket: string; key: string } | { file: string }
export interface EdlEvent { event: number; clip: string; track: string; trans: string; dissolve_frames: number; src_in: string; src_out: string; rec_in: string; rec_out: string; frames: number; speed_fps: number | null; effects: string[]; frameflex: string[]; from_clip?: string; to_clip?: string }
export interface EdlElement {
  clip: string; shot: string; element: string; kind: 'FINAL' | 'ALT' | 'STILL'; version: string; raster: string | null
  first_source_in: string; record_in: string; record_out: string; frames_in_cut: number
  /** speed percents per event with a retime (sign: negative = reverse); 100 for a normal-speed event */ speeds: number[]
  effects: string[]; frameflex: string[]; source_ranges: { in: string; out: string }[]; events: number
}
export interface EdlStatus { loaded: boolean; source: string | null; sha256: string | null; events: number; elements: number; loaded_at: string | null; error?: string }
export type Match = { match: 'exact' | 'shot-element'; element: EdlElement } | { match: 'ambiguous'; candidates: EdlElement[] } | { match: 'not-in-edl' }

export interface Deps { now(): number; aws: podpull.AwsRunner }
const defaults = (): Deps => ({ now: () => Date.now(), aws: (a, e, o) => podpull.defaultAws(a, e, o) })
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

const dir = () => join(configDir(), 'edl')
const tcFrames = (tc: string): number => { const m = /^(\d\d):(\d\d):(\d\d)[:;](\d\d)$/.exec(tc); return m ? ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * FPS + Number(m[4]) : 0 }
const TC = '(\\d\\d:\\d\\d:\\d\\d[:;]\\d\\d)'
const EVENT = new RegExp(`^(\\d{3,6})\\s+(.+?)\\s+(V|A|AA|A2|B|VA|NONE)\\s+(C|D|W\\d*|K\\w*)\\s*(\\d{0,3})\\s+${TC}\\s+${TC}\\s+${TC}\\s+${TC}\\s*$`)
const EXT = /\.(mov|mp4|m4v|mxf|webm|avi|mkv)$/i
export const clipKey = (name: string): string => name.trim().replace(EXT, '').toLowerCase()
const SHOT = /^([A-Za-z]+-(?:\d+[a-z]?|[A-Za-z]+))(?:_|$)/

/** The shot and element a clip name carries: `ENHANCE-146_B_FINAL_V01_...` is enhance-146 and b, `CREATURE-266_BREACH-ALT1_...` is creature-266 and breach-alt1. */
export function parseName(clip: string): { shot: string; element: string; kind: EdlElement['kind']; version: string; raster: string | null } {
  const base = clip.trim().replace(EXT, ''), m = SHOT.exec(base), shot = (m?.[1] ?? '').toLowerCase()
  const rest = m ? base.slice(m[0].length) : '', element = (rest.split('_')[0] ?? '').toLowerCase()
  const kind: EdlElement['kind'] = /STILL/i.test(base) ? 'STILL' : /ALT/i.test(element) ? 'ALT' : 'FINAL'
  return { shot, element, kind, version: /_V(\d+)(?:_|$)/i.exec(base) ? `V${/_V(\d+)(?:_|$)/i.exec(base)![1]}` : '', raster: /(\d{3,5})X(\d{3,5})/i.exec(base) ? `${/(\d{3,5})X(\d{3,5})/i.exec(base)![1]}x${/(\d{3,5})X(\d{3,5})/i.exec(base)![2]}` : null }
}

const yieldLoop = () => new Promise<void>((r) => setImmediate(r))
/** Parse a CMX3600 list: events (a cut or a dissolve row), their `M2` speed line (fps over the 24 fps record), `*FROM/TO CLIP NAME` and effect comments. Chunked. */
export async function parse(text: string): Promise<EdlEvent[]> {
  const lines = text.split(/\r?\n/), out: EdlEvent[] = []; let cur: EdlEvent | null = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], m = EVENT.exec(l.trim())
    if (m) { cur = { event: Number(m[1]), clip: m[2].trim(), track: m[3], trans: m[4], dissolve_frames: m[5] ? Number(m[5]) : 0, src_in: m[6], src_out: m[7], rec_in: m[8], rec_out: m[9], frames: Math.max(0, tcFrames(m[9]) - tcFrames(m[8])), speed_fps: null, effects: [], frameflex: [] }; out.push(cur); }
    else if (cur) {
      const t = l.trim()
      const sp = /^M2\s+\S+\s+(-?\d+(?:\.\d+)?)\s+\d\d:\d\d:\d\d[:;]\d\d/.exec(t)
      if (sp) cur.speed_fps = Number(sp[1])
      else if (/^\*FROM CLIP NAME:/i.test(t)) cur.from_clip = t.replace(/^\*FROM CLIP NAME:\s*/i, '').trim()
      else if (/^\*TO CLIP NAME:/i.test(t)) cur.to_clip = t.replace(/^\*TO CLIP NAME:\s*/i, '').trim()
      else if (/^\*.*FRAMEFLEX/i.test(t)) cur.frameflex.push(t.replace(/^\*\s*/, ''))
      else if (/^\*(AVX2 EFFECT|TIMEWARP EFFECT|BLEND|.*EFFECT)/i.test(t)) cur.effects.push(t.replace(/^\*\s*/, ''))
    }
    if (i % 500 === 499) await yieldLoop()
  }
  if (!out.length) throw bad('That does not look like a CMX3600 edit list (no events were found)')
  return out
}
/** Group the events per element (the clip name without its extension, case-insensitive): record order, the first event's source-in, the frames of the cut (the sum of the events' record durations, a dissolve row counting its own range), the speeds. */
export function elementsOf(events: EdlEvent[]): EdlElement[] {
  const by = new Map<string, EdlEvent[]>()
  for (const e of events) { const k = clipKey(e.clip); (by.get(k) ?? by.set(k, []).get(k)!).push(e) }
  const out: EdlElement[] = []
  for (const evs of by.values()) {
    const sorted = [...evs].sort((a, b) => tcFrames(a.rec_in) - tcFrames(b.rec_in) || a.event - b.event), first = sorted[0], clip = first.clip.replace(EXT, ''), n = parseName(clip)
    out.push({ clip, ...n, first_source_in: first.src_in, record_in: first.rec_in, record_out: sorted.reduce((a, e) => (tcFrames(e.rec_out) > tcFrames(a) ? e.rec_out : a), first.rec_out), frames_in_cut: evs.reduce((a, e) => a + e.frames, 0),
      speeds: sorted.filter((e) => e.frames > 0).map((e) => (e.speed_fps === null ? 100 : Math.round((e.speed_fps / FPS) * 1000) / 10)), effects: [...new Set(evs.flatMap((e) => e.effects))], frameflex: [...new Set(evs.flatMap((e) => e.frameflex))], source_ranges: sorted.map((e) => ({ in: e.src_in, out: e.src_out })), events: evs.length })
  }
  return out.sort((a, b) => tcFrames(a.record_in) - tcFrames(b.record_in) || a.clip.localeCompare(b.clip))
}

let state: { events: EdlEvent[]; elements: EdlElement[]; byClip: Map<string, EdlElement>; meta: { source: string; sha256: string; loaded_at: string } } | null = null
let lastError = ''
let ready: Promise<void> | null = null
const install = async (text: string, source: string): Promise<void> => {
  const events = await parse(text), elements = elementsOf(events)
  state = { events, elements, byClip: new Map(elements.map((e) => [clipKey(e.clip), e])), meta: { source, sha256: createHash('sha256').update(text).digest('hex'), loaded_at: new Date(deps.now()).toISOString() } }
}
async function writeCache(text: string, source: string): Promise<void> {
  await mkdir(dir(), { recursive: true }); const f = join(dir(), 'current.edl'), tmp = `${f}.${process.pid}.tmp`
  await writeFile(tmp, text, { mode: 0o600 }); await rename(tmp, f)
  const m = join(dir(), 'current.json'), mt = `${m}.${process.pid}.tmp`; await writeFile(mt, JSON.stringify({ source, sha256: state?.meta.sha256, loaded_at: state?.meta.loaded_at }), { mode: 0o600 }); await rename(mt, m)
}
async function readCache(): Promise<boolean> {
  try { const text = await readFile(join(dir(), 'current.edl'), 'utf8'), meta = JSON.parse(await readFile(join(dir(), 'current.json'), 'utf8')) as { source?: string }; await install(text, meta.source ?? 'the cached copy'); return true } catch { return false }
}
/** Load the cached copy if nothing is loaded yet (cheap, offline). Callers that only need to look at the EDL call this. */
export const ensure = (): Promise<void> => (ready ??= readCache().then(() => undefined))

const describe = (s: Source): string => ('file' in s ? s.file : `s3://${s.bucket}/${s.key}`)
export const resolveSource = (cfg: Source | null | undefined): Source => cfg ?? { bucket: panama.bucket(), key: DEFAULT_KEY }
/** Fetch and parse the edit list: from the bucket (read-only, the Panama access and profile of Settings) or a file; cached with its sha256. A fetch that fails keeps the cached copy and says why. */
export async function load(o: { source?: Source | null } = {}): Promise<EdlStatus> {
  const src = resolveSource(o.source ?? (await configured())), label = describe(src)
  await ensure()
  try {
    let text: string
    if ('file' in src) { if (!src.file.startsWith('/')) throw bad('file is an absolute path'); text = await readFile(src.file, 'utf8') }
    else {
      const k = panama.appKeys(), common = [...(k ? [] : ['--profile', panama.profile()]), '--region', panama.region()]
      const r = await deps.aws(['s3', 'cp', `s3://${src.bucket}/${src.key}`, '-', ...common], k ? { AWS_ACCESS_KEY_ID: k.id, AWS_SECRET_ACCESS_KEY: k.secret, AWS_REGION: panama.region() } : {}, { stallMs: 30_000 })
      if (r.code !== 0) throw new CoreError(502, r.transient ? podpull.STORAGE_UNREACHABLE : `The EDL could not be read from ${label}: ${(r.stderr || r.stdout).trim().split('\n').pop()?.replace(/https?:\/\/\S+/g, '<url>') || `aws exited ${r.code}`}`)
      text = r.stdout
    }
    if (Buffer.byteLength(text) > MAX_BYTES) throw bad('That file is too large to be an edit list')
    await install(text, label); await writeCache(text, label); lastError = ''
  } catch (e) { lastError = (e as Error).message.replace(/https?:\/\/\S+/g, '<url>'); if (!state) throw e }
  return status()
}
/** Where the configuration says the EDL is (the `edl.source` block of the Default Configuration); null = the V11 path. */
const configured = async (): Promise<Source | null> => mounts.load().edl?.source ?? null
export const status = (): EdlStatus => ({ loaded: !!state, source: state?.meta.source ?? null, sha256: state?.meta.sha256 ?? null, events: state?.events.length ?? 0, elements: state?.elements.length ?? 0, loaded_at: state?.meta.loaded_at ?? null, ...(lastError ? { error: lastError } : {}) })
export const elements = (): EdlElement[] => state?.elements.map((e) => ({ ...e })) ?? []
export const isLoaded = (): boolean => !!state
/** Find an element: by clip name first; else by shot and element. */
export function lookup(o: { clip?: string; shot?: string; element?: string }): Match {
  if (!state) return { match: 'not-in-edl' }
  if (o.clip) { const hit = state.byClip.get(clipKey(o.clip)); if (hit) return { match: 'exact', element: hit } }
  let shot = (o.shot ?? '').toLowerCase(), element = (o.element ?? '').toLowerCase()
  if (!shot && o.clip) { const p = parseName(o.clip); shot = p.shot; element = element || p.element }
  if (!shot) return { match: 'not-in-edl' }
  const c = state.elements.filter((e) => e.shot === shot && (!element || e.element === element))
  if (c.length === 1) return { match: 'shot-element', element: c[0] }
  return c.length > 1 ? { match: 'ambiguous', candidates: c } : { match: 'not-in-edl' }
}
/** A sequence (its clip name if it has one, else the frames' stem) matched to the EDL. */
export const matchSequence = (s: { clip_name?: string; name: string }): Match => {
  const byClip = s.clip_name ? lookup({ clip: s.clip_name }) : { match: 'not-in-edl' as const }
  if (byClip.match === 'exact') return byClip
  const byStem = lookup({ clip: s.name }); if (byStem.match === 'exact') return byStem
  return lookup({ clip: s.clip_name ?? s.name })
}
export function reset(): void { state = null; lastError = ''; ready = null; setDeps(null) }
