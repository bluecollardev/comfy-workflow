/**
 * Rendered sequences (docs/ADR-048): DPX frames are about 50 MB each, too heavy to play over RunPod's proxy, so the RUNNING pod where the frames already sit renders them with
 * ffmpeg into an H.264 mp4 PROXY on the volume (`comfy-shared/output/.proxies/<dir>/<name>_<width>.mp4`, a hidden folder), and the proxy is pulled to this PC with the existing sync
 * (`paths`, so `sync_parallel` streams, S3 or SSH). The DPX modal then plays the local file through the read-only `localfile://` protocol.
 *
 * One ffmpeg at a time per pod (DPX decoding is CPU heavy; `nice`). Every path goes to the pod as a quoted argument (`q`), never concatenated. A proxy that already exists and is newer than the
 * sequence's last frame is skipped, so a re-run does nothing. A failed sequence does not stop the next. Cancel kills the ffmpeg over a second SSH call (a pid file) and removes the .part.
 * ASYNC RULE: ssh and the sync are spawned; files are read with fs.promises; status() answers from memory. The deps are injectable, so the tests run with no pod.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, appendFile, mkdir, statfs, open, readFile, readdir, realpath, lstat, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { dirname, join, resolve, sep } from 'node:path'
import { CoreError, bad } from './errors.js'
import * as changes from './changes.js'
import * as history from './history.js'
import * as journal from './journal.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import * as podnames from './podnames.js'
import * as podpull from './podpull.js'
import { mirrorDir, rendersFile } from './paths.js'
import * as rp from './runpod.js'
import * as sync from './sync.js'
import * as syncrun from './syncrun.js'

export const WIDTHS = [960, 1280, 1920] as const
/** A width: a downscale, or `source`, the frames' native size (3840x2160 for the IMAX frames), no scaling. */
export type Width = 'source' | 960 | 1280 | 1920
export const PROXIES = '.proxies'
export const MAX_SEQUENCES = 200, KEEP_JOBS = 20, LISTING_MS = 60_000

export interface Sequence { /** the clip name outputs carry (the EDL's), default the frames' stem; never used for the frames themselves */ clip_name?: string; dir: string; name: string; first: number; last: number; frames: number; pad: number; fps?: number }
export type Where = 'auto' | 'pod' | 'local'
export interface Range { from: number; to: number }
export interface PlannedSequence extends Sequence { clip_name: string; source?: { width: number; height: number; bits: number } | null; estimate?: { frames: number; note: string; output_gb: number }; colour_refusal?: string | null; shot?: string; next_version?: number; out: string; exists_remote: boolean; exists_local: boolean; gaps: number; where: 'pod' | 'local'; complete: boolean; missing: Range[]; partial: boolean }
export type SeqState = 'waiting' | 'rendering' | 'rendered' | 'pulled' | 'done' | 'failed' | 'skipped' | 'incomplete'
export interface SeqView { clip_name?: string; outs?: string[]; shot?: string; version?: string; complete?: boolean; partial?: boolean; missing?: Range[]; where: 'pod' | 'local'; dir: string; name: string; state: SeqState; frames_done: number; frames_total: number; out: string; bytes: number; error: string; warning?: string }
export interface JobView {
  kind: 'proxy' | 'review'; approved_by: string; codecs: string[]; notes: string[]
  job_id: string; pod_id: string; pod_name: string; state: 'queued' | 'rendering' | 'pulling' | 'done' | 'failed' | 'cancelled'; started_at: string; finished_at: string
  width: Width; frames_done: number; frames_total: number; rate_fps: number; current: string; sequences: SeqView[]; pulled_files: number; pulled_bytes: number; error: string; summary: string
}
/** `complete`, `fps` and `frames` come from the sidecar (null when there is none: unknown, not an error); `partial` is known from the file name. */
export interface ProxyItem { dir: string; name: string; width: Width | 0; height: number | null; exists_remote: boolean; exists_local: boolean; local_url: string; remote_ready: boolean; bytes: number; modified: string; partial: boolean; complete: boolean | null; fps: number | null; frames: number | null }

// ----- validation and quoting -----

/** A string as ONE shell word: single-quoted, every embedded quote closed and reopened. File names with spaces, quotes, `;` or `$()` stay data. */
export const q = (s: string): string => `'${String(s).replace(/'/g, `'\\''`)}'`
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f]/
const safeSegments = (p: string) => !p.startsWith('/') && !p.includes('\\') && !CTRL.test(p) && !p.split('/').some((x) => x === '..' || x === '.' || x === '')
export function validateSequence(s: unknown): Sequence {
  const o = s as Partial<Sequence> | null
  if (!o || typeof o !== 'object') throw bad('A sequence is { dir, name, first, last, frames, pad }')
  const { dir, name } = o
  if (typeof dir !== 'string' || (dir !== '' && !safeSegments(dir)) || dir.length > 400) throw bad(`Not a folder under the output folder: ${String(dir).slice(0, 80)}`)
  if (typeof name !== 'string' || !name || name.length > 240 || /[/\\%]/.test(name) || CTRL.test(name) || name.startsWith('.')) throw bad(`Not a sequence name (no slash, no %): ${String(name).slice(0, 80)}`)
  for (const k of ['first', 'last', 'frames', 'pad'] as const) if (!Number.isInteger(o[k]) || (o[k] as number) < 0) throw bad(`${k} is a whole number`)
  if (o.last! < o.first!) throw bad('last is not before first')
  if (o.pad! < 1 || o.pad! > 12 || o.frames! < 1 || o.frames! > 1_000_000) throw bad('pad is 1 to 12 digits and frames at least 1')
  if (o.fps !== undefined && !(typeof o.fps === 'number' && o.fps >= 1 && o.fps <= 240)) throw bad('fps is a number from 1 to 240')
  const clip = o.clip_name === undefined || o.clip_name === null ? undefined : validateClipName(o.clip_name)
  return { ...(clip ? { clip_name: clip } : {}), dir, name, first: o.first!, last: o.last!, frames: o.frames!, pad: o.pad!, ...(o.fps !== undefined ? { fps: o.fps } : {}) }
}
/** A clip name (the EDL's, so a conform relinks): letters, digits, `. _ - ` and space; no traversal, slash, control character, overlong name, or uuid- or hash-looking token (shared/governance/policy/naming.md). Returned trimmed. */
export function validateClipName(v: unknown): string {
  if (typeof v !== 'string') throw bad('clip_name is text')
  const t = v.trim()
  if (!t || t.length > 200) throw bad('clip_name is 1 to 200 characters')
  if (t.includes('..') || !/^[A-Za-z0-9._ -]+$/.test(t)) throw bad('clip_name has letters, digits and . _ - or space only: no slash, no .., no control characters')
  if (t.startsWith('.') || t.endsWith('.')) throw bad('clip_name does not start or end with a dot')
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(t) || t.split(/[._ -]+/).some((x) => x.length >= 16 && /^[0-9a-f]+$/i.test(x))) throw bad('clip_name must not contain a uuid or a hash (policy/naming.md)')
  return t
}
/** The base name every output carries: the EDL clip name (an override), else the frames' stem, which already is the clip name. */
export const clipOf = (s: Pick<Sequence, 'name' | 'clip_name'>): string => s.clip_name ?? s.name
export function validateWidth(w: unknown): Width { if (w === 'source') return 'source'; const n = Number(w); if (!(WIDTHS as readonly number[]).includes(n)) throw bad(`width is source or one of ${WIDTHS.join(', ')}`); return n as Width }
/** The frame rate: the request's, else the number between underscores in the name (12 to 120, e.g. `_23.976_`), else 24. */
export function fpsOf(name: string, requested?: number): string {
  if (requested) return String(requested)
  for (const m of name.matchAll(/_(\d{2,3}(?:\.\d{1,3})?)_/g)) { const v = Number(m[1]); if (v >= 12 && v <= 120) return m[1] }
  return '24'
}
/** The proxy's path relative to ComfyUI-Shared. A PARTIAL render never takes the full-length name: it is `<name>_<width>_partial.mp4`. */
export const proxyRel = (s: Pick<Sequence, 'dir' | 'name' | 'clip_name'>, width: Width, partial = false): string => `output/${PROXIES}/${s.dir ? `${s.dir}/` : ''}${clipOf(s)}${width === 'source' ? '' : `_${width}`}${partial ? '_partial' : ''}.mp4`
export const metaRel = (rel: string): string => `${rel}.meta.json`

export type Codec = 'h264' | 'prores422hq'
export const CODECS: Codec[] = ['h264', 'prores422hq']
/** Frame-exact timing: a fractional rate is the rational `N000/1001` (23.976 is 24000/1001), never a decimal that drifts. */
export const rationalFps = (f: string): string => { const v = Number(f); if (!Number.isFinite(v) || Number.isInteger(v)) return f; const k = Math.round(v * 1.001); return Math.abs(k / 1.001 - v) < 0.01 ? `${k * 1000}/1001` : f }
/**
 * The ffmpeg command, as an argument array, the same for both adapters. DPX is read as a numbered sequence. `source` width is NOT scaled (only the RGB to YUV matrix is told, BT.709); a number scales with lanczos.
 * quality 'proxy' (default): H.264 veryfast crf 18 for quick playback. quality 'review': H.264 medium crf 14 (`h264`, an .mp4), or ProRes 422 HQ (`prores422hq`, a .mov, 10-bit 4:2:2). No colour transform is applied.
 */
export function ffmpegArgs(s: Sequence, width: Width, o: { fps?: number; outputDir: string; frames?: number; partial?: boolean; final?: string; codec?: Codec; quality?: Kind; timecode?: string | null }): string[] {
  const input = `${o.outputDir}/${s.dir ? `${s.dir}/` : ''}${s.name}.%0${s.pad}d.dpx`, out = `${o.final ?? `${o.outputDir}/${PROXIES}/${s.dir ? `${s.dir}/` : ''}${clipOf(s)}${width === 'source' ? '' : `_${width}`}${o.partial ? '_partial' : ''}.mp4`}.part`
  const scale = width === 'source' ? 'scale=out_color_matrix=bt709' : `scale=${width}:-2:flags=lanczos:out_color_matrix=bt709`, review = o.quality === 'review'
  const codec = o.codec === 'prores422hq'
    ? ['-vf', `${scale},format=yuv422p10le`, '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0', '-colorspace', 'bt709']
    : ['-vf', `${scale},format=yuv420p`, '-c:v', 'libx264', '-preset', review ? 'medium' : 'veryfast', '-crf', review ? '14' : '18', ...(review ? ['-pix_fmt', 'yuv420p'] : []), '-colorspace', 'bt709', '-movflags', '+faststart']
  return ['ffmpeg', '-nostdin', '-y', '-loglevel', 'warning', '-framerate', rationalFps(fpsOf(s.name, o.fps ?? s.fps)), '-start_number', String(s.first), '-i', input, '-frames:v', String(o.frames ?? s.frames), ...codec, ...(o.timecode ? ['-timecode', o.timecode] : []), '-an', '-progress', 'pipe:1', out]
}

// ----- the DPX header and the colour record (shared/governance/policy/colour.md: stated, never guessed) -----

export interface DpxInfo { width: number; height: number; bits: number; packing: number; descriptor: number; transfer: number; colorimetric: number; be: boolean; /** the start timecode HH:MM:SS:FF from the television header, or null when absent or invalid */ timecode: string | null }
/** The header fields that matter, from the first bytes of a frame (SMPTE 268M, the layout src/utils/dpx.js reads): size @772/776, descriptor @800, transfer @801, colorimetric @802, bits @803, packing @804. null when it is not a DPX header. */
/** The television header's time code (SMPTE 268M, a U32 at byte 1664 in the file's byte order): packed BCD HHMMSSFF. null when it is unset (0 or 0xFFFFFFFF) or not valid BCD (a digit above 9, hours 24 or more, minutes or seconds 60 or more, frames 100 or more). Never invented. */
export function bcdTimecode(v: number): string | null {
  if (v === 0 || v === 0xffffffff) return null
  const d = Array.from({ length: 8 }, (_, i) => (v >>> (28 - 4 * i)) & 0xf)
  if (d.some((x) => x > 9)) return null
  const [hh, mm, ss, ff] = [d[0] * 10 + d[1], d[2] * 10 + d[3], d[4] * 10 + d[5], d[6] * 10 + d[7]]
  if (hh > 23 || mm > 59 || ss > 59) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`
}
export function parseDpxInfo(buf: Uint8Array): DpxInfo | null {
  if (buf.length < 820) return null
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]); if (magic !== 'SDPX' && magic !== 'XPDS') return null
  const le = magic === 'XPDS', dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  return { width: dv.getUint32(772, le), height: dv.getUint32(776, le), descriptor: dv.getUint8(800), transfer: dv.getUint8(801), colorimetric: dv.getUint8(802), bits: dv.getUint8(803), packing: dv.getUint16(804, le), be: !le, timecode: buf.length >= 1668 ? bcdTimecode(dv.getUint32(1664, le)) : null }
}
export const TRANSFER_NAMES: Record<number, string> = { 0: 'user defined', 1: 'printing density', 2: 'linear', 3: 'logarithmic', 4: 'unspecified video', 5: 'SMPTE 240M', 6: 'ITU-R 709-4', 7: 'ITU-R 601-5 system B or G', 8: 'ITU-R 601-5 system M', 9: 'NTSC composite video', 10: 'PAL composite video', 11: 'Z linear', 12: 'Z homogeneous', 13: 'ADX' }
/** Transfer characteristics that are not display-referred: printing density (Cineon), linear, logarithmic, Z, ADX. A conversion of these must be stated, never guessed. */
export const NOT_DISPLAY = [1, 2, 3, 11, 12, 13]
const PACKING = ['packed', 'filled (method A)', 'filled (method B)']
/** Why a REVIEW is refused on colour grounds, or null. The viewer applies no transform and neither does the proxy; if the header says the frames are log or linear, a review would look wrong, so it is refused. */
export function colourRefusal(h: DpxInfo | null): string | null {
  if (!h) return "The DPX header of the first frame could not be read, so its colour cannot be stated (shared/governance/policy/colour.md: stated, never guessed). A review video was not made."
  if (NOT_DISPLAY.includes(h.transfer)) return `The frames say ${TRANSFER_NAMES[h.transfer] ?? h.transfer} in their DPX header, not a display-referred encoding. shared/governance/policy/colour.md says a conversion is stated, never guessed, so this app will not make a review video with a guessed one.`
  return null
}
/** The `colour:` lines of DELIVERY.md and the sidecar: the header, and exactly what ffmpeg was told. */
export function colourLines(h: DpxInfo | null, codecs: Codec[]): string[] {
  const t = (n: number) => `${TRANSFER_NAMES[n] ?? 'unknown'} (${n})`
  return [`colour: DPX header: ${h ? `${h.width}x${h.height}, ${h.bits}-bit, ${PACKING[h.packing] ?? `packing ${h.packing}`}, descriptor ${h.descriptor}, transfer ${t(h.transfer)}, colorimetric ${t(h.colorimetric)}` : 'not read'}.`,
    'colour: conversion told to ffmpeg: no colour transform applied (the values are passed through as they are); only the RGB to YUV matrix is BT.709' + (codecs.includes('prores422hq') ? ', 10-bit 4:2:2 for ProRes' : '') + '.',
    'colour: primaries and transfer are not tagged in the file (they are not guessed); the values are as served (policy/colour.md; the in-app viewer applies no transform either).']
}

const pidFile = (jobId: string, i: number) => `/tmp/render-${jobId.replace(/[^\w-]/g, '_')}-${i}.pid`

/** `find` treats `*`, `?`, `[` and `\` in a -name pattern as globs: a file stem with one of them must match literally. */
const globEscape = (n: string) => n.replace(/[*?[\\]/g, '\\$&')
/** The script that looks at one sequence on the pod: its frame files (size and mtime of each, in one `find`), ffmpeg's version, and the proxy (full and partial name) and its sidecar if they exist. */
export function probeScript(s: Sequence, width: Width, outputDir: string): string {
  const dir = `${outputDir}/${s.dir}`.replace(/\/$/, ''), base = `${outputDir}/${PROXIES}/${s.dir ? `${s.dir}/` : ''}${clipOf(s)}${width === 'source' ? '' : `_${width}`}`
  const st = (tag: string, f: string, fmt: string) => `echo "${tag} $(stat -c ${fmt} ${q(f)} 2>/dev/null || echo 0)"`
  return ['set -u', `echo "FFV $(ffmpeg -version 2>&1 | head -1)"`, st('OUTM', `${base}.mp4`, '%Y'), st('OUTS', `${base}.mp4`, '%s'), st('OMETS', `${base}.mp4.meta.json`, '%s'),
    st('POUTM', `${base}_partial.mp4`, '%Y'), st('POUTS', `${base}_partial.mp4`, '%s'), st('PMETS', `${base}_partial.mp4.meta.json`, '%s'),
    `cd ${q(dir)} 2>/dev/null || { echo PROBE-NODIR; exit 0; }`, `echo "HDR $(od -An -tx1 -v -N 1700 ${q(`${s.name}.${String(s.first).padStart(s.pad, '0')}.dpx`)} 2>/dev/null | tr -d ' \n')"`, `echo "FFP $(command -v ffprobe >/dev/null 2>&1 && echo 1 || echo 0)"`, `find . -maxdepth 1 -type f -name ${q(`${globEscape(s.name)}.*.dpx`)} -printf 'F %s %T@ %f\\n'`, 'echo PROBE-DONE', ''].join('\n')
}
export interface Probe {
  nodir: boolean; run: number; gaps: number; complete: boolean
  /** the missing frame numbers as ranges (at most 10) and how many ranges there are in all */
  missing: Range[]; ranges: number
  /** files named like the sequence that do not fit its pattern (another digit count, no number), and frames whose size differs from the usual one: reported, never hidden */
  odd: number; size_odd: number
  /** an up-to-date proxy exists (the full name for a complete sequence, the partial name otherwise), its size, and whether its sidecar does */
  skip: boolean; out_bytes: number; meta_exists: boolean
  source_bytes: number; ffmpeg_version: string
  /** the first frame's DPX header (size, bit depth, transfer, colorimetric), and whether ffprobe exists where the render runs */
  header: DpxInfo | null; ffprobe: boolean
}
/** One frame file found: its number, size and mtime (seconds). */
export interface FrameFile { n: number; size: number; mtime: number }
/** The probe's answer from the frames found, shared by both adapters. */
export function buildProbe(frames: FrameFile[], odd: number, s: Sequence, info: { outM: number; outS: number; metS: number; poutM: number; poutS: number; pmetS: number; ffv: string; nodir?: boolean; header?: DpxInfo | null; ffprobe?: boolean }): Probe {
  const have = new Map(frames.map((f) => [f.n, f])), sum = summarize(new Set(have.keys()), s)
  const sizes = new Map<number, number>(); for (const f of frames) sizes.set(f.size, (sizes.get(f.size) ?? 0) + 1)
  const usual = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  const newest = frames.reduce((a, f) => Math.max(a, f.mtime), 0), complete = sum.run === s.last - s.first + 1
  const [m, bytes, met] = complete ? [info.outM, info.outS, info.metS] : [info.poutM, info.poutS, info.pmetS]
  return { nodir: !!info.nodir, ...sum, complete, missing: sum.missing, ranges: sum.ranges, odd, size_odd: frames.filter((f) => f.size !== usual).length, skip: m > 0 && bytes > 0 && newest > 0 && m >= newest, out_bytes: bytes, meta_exists: met > 0,
    source_bytes: frames.reduce((a, f) => a + f.size, 0), ffmpeg_version: info.ffv, header: info.header ?? null, ffprobe: info.ffprobe ?? false }
}
/** What the probe says: the contiguous run from `first`, the missing ranges, and whether an up-to-date proxy exists. */
export function parseProbe(lines: string[], s: Sequence): Probe {
  const re = new RegExp(`^${s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)\\.dpx$`), frames: FrameFile[] = []
  const info = { outM: 0, outS: 0, metS: 0, poutM: 0, poutS: 0, pmetS: 0, ffv: '', nodir: false, header: null as DpxInfo | null, ffprobe: false }
  let odd = 0
  for (const l of lines) {
    if (l === 'PROBE-NODIR') info.nodir = true
    else if (l.startsWith('F ')) { const m = /^F (\d+) ([\d.]+) (.+)$/.exec(l); if (!m) continue; const f = re.exec(m[3]); if (f && f[1].length === s.pad) frames.push({ n: Number(f[1]), size: Number(m[1]), mtime: Math.floor(Number(m[2])) }); else odd++ }
    else if (l.startsWith('FFV ')) info.ffv = l.slice(4).trim()
    else if (l.startsWith('FFP ')) info.ffprobe = l.slice(4).trim() === '1'
    else if (l.startsWith('HDR ')) { const hex = l.slice(4).trim(); if (/^([0-9a-f]{2})+$/i.test(hex)) info.header = parseDpxInfo(Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)))) }
    else { const m = /^(OUTM|OUTS|OMETS|POUTM|POUTS|PMETS) (\d+)/.exec(l); if (m) { const k = ({ OUTM: 'outM', OUTS: 'outS', OMETS: 'metS', POUTM: 'poutM', POUTS: 'poutS', PMETS: 'pmetS' } as const)[m[1] as 'OUTM']; info[k] = Number(m[2]) } }
  }
  return buildProbe(frames, odd, s, info)
}
/** The contiguous run from `first`, the number of missing frames, and the missing ranges (at most 10 listed), from the frame numbers found (shared by both adapters). */
export function summarize(have: Set<number>, s: Sequence): { run: number; gaps: number; missing: Range[]; ranges: number } {
  let run = 0; while (s.first + run <= s.last && have.has(s.first + run)) run++
  let present = 0, ranges = 0; const missing: Range[] = []
  for (let n = s.first; n <= s.last; n++) if (have.has(n)) present++
  // ranges, in one pass
  let from = -1
  for (let n = s.first; n <= s.last + 1; n++) {
    const gone = n <= s.last && !have.has(n)
    if (gone && from < 0) from = n
    if (!gone && from >= 0) { ranges++; if (missing.length < 10) missing.push({ from, to: n - 1 }); from = -1 }
  }
  return { run, gaps: s.last - s.first + 1 - present, missing, ranges }
}
/** "Incomplete: frames 101-150, 160 are missing (2 gaps)": at most the first 10 ranges are named. */
export function incompleteMessage(p: Pick<Probe, 'missing' | 'ranges' | 'gaps'>): string {
  const list = p.missing.map((r) => (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`)).join(', ') + (p.ranges > p.missing.length ? ', ...' : '')
  return `Incomplete: frames ${list} ${p.gaps === 1 ? 'is' : 'are'} missing (${p.ranges} gap${p.ranges === 1 ? '' : 's'})`
}
/** The sidecar that travels with a proxy or a review (docs/ADR-048 "Governance fit"): what it is, how it was made, and (review) who said yes. */
export function buildMeta(s: Sequence, o: { width: Width; fps?: number; probe: Probe; partial: boolean; adapter: 'pod' | 'local'; args: string[]; version: string; at: string; kind?: 'proxy' | 'review'; extra?: Record<string, unknown> }): Record<string, unknown> {
  const h = o.probe.header
  return { ...(o.extra ?? {}), kind: o.kind ?? 'proxy', source_dir: s.dir, name: s.name, first: s.first, last: s.last, frames: o.probe.run, complete: o.probe.complete, partial: o.partial, fps: Number(fpsOf(s.name, o.fps ?? s.fps)), width: h && o.width === 'source' ? h.width : o.width, height: h && o.width === 'source' ? h.height : null, width_setting: o.width, adapter: o.adapter,
    ffmpeg_args: o.args, ffmpeg_version: o.version || o.probe.ffmpeg_version, rendered_at: o.at, app_version: process.env.RUNPOD_MANAGER_VERSION ?? '', source_sizes_total: o.probe.source_bytes }
}
/** A file the render script writes next to the video after it succeeded. `@@SHA256_k@@`, `@@BYTES_k@@` and `@@FRAMES_k@@` (k = the pass) are filled in on the pod from the finished file. Written to a temp name, then renamed. */
export interface Extra { path: string; content: string; /** add to the file instead of replacing it (a second clip of the same shot adds its section to DELIVERY.md) */ append?: boolean }
/** One ffmpeg pass: its arguments, the container to check it as, and the frame count `ffprobe -count_frames` must find (null: not checked). */
export interface Pass { args: string[]; fmt: 'mp4' | 'mov'; verify: number | null }
/**
 * The script that renders one sequence: each pass niced (a review under a 2 hour `timeout`), its pid kept for Cancel, the decoded frame count checked BEFORE the .part is moved into place (a mismatch fails loudly and removes it),
 * then the extra files (sidecar, DELIVERY.md). A REVIEW creates its version folder with a plain `mkdir` (it fails if the version exists: nothing is ever overwritten).
 */
export function renderScript(passes: Pass[], jobId: string, index: number, extras: Extra[] = [], o: { versionDir?: string; createDir?: boolean; timeout?: number } = {}): string {
  const pid = pidFile(jobId, index), outs = passes.map((p) => p.args[p.args.length - 1].replace(/\.part$/, ''))
  const heredoc = (e: Extra, n: number) => [`cat > ${q(e.path + '.tmp')} <<'RENDER_EOF_${n}'`, e.content.replace(new RegExp(`^RENDER_EOF_${n}$`, 'gm'), ' RENDER_EOF'), `RENDER_EOF_${n}`,
    `sed -i ${passes.map((_p, k) => `-e "s/@@SHA256_${k}@@/$SHA_${k}/g" -e "s/@@BYTES_${k}@@/$SZ_${k}/g" -e "s/@@FRAMES_${k}@@/$N_${k}/g" -e "s/@@RATE_${k}@@/$RATE_${k}/g"`).join(' ')} ${q(e.path + '.tmp')} && ${e.append ? `cat ${q(e.path + '.tmp')} >> ${q(e.path)} && rm -f ${q(e.path + '.tmp')}` : `mv ${q(e.path + '.tmp')} ${q(e.path)}`}`]
  const pass = (p: Pass, k: number): string[] => {
    const part = p.args[p.args.length - 1], out = outs[k]
    return [`echo "PASS ${k}"`, `T_${k}=$(date +%s)`, `${o.timeout ? `timeout ${o.timeout} ` : ''}nice -n 10 ${p.args.map(q).join(' ')} &`, `echo $! > ${q(pid)}`, 'wait $!', 'rc=$?', `rm -f ${q(pid)}`,
      `if [ $rc -ne 0 ]; then rm -f ${q(part)}; echo "RENDER-EXIT $rc"; exit 0; fi`,
      ...(p.verify !== null ? [`N_${k}=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 -f ${p.fmt} -i ${q(part)} 2>/dev/null | head -1)`,
        `if [ "$N_${k}" != "${p.verify}" ]; then rm -f ${q(part)}; echo "RENDER-COUNT $N_${k} ${p.verify}"; exit 0; fi`] : [`N_${k}=${p.verify ?? 0}`]),
      `mv ${q(part)} ${q(out)}; SHA_${k}=$(sha256sum ${q(out)} | cut -d' ' -f1); SZ_${k}=$(stat -c %s ${q(out)})`, `RATE_${k}=$(awk "BEGIN{e=$(( $(date +%s) - T_${k} )); if(e<1)e=1; printf \"%.2f\", $N_${k}/e}")`, `echo "RENDER-DONE ${k} $SZ_${k} $N_${k}"`]
  }
  return ['set -u',
    ...(o.versionDir ? [o.createDir === false ? `mkdir -p ${q(o.versionDir)}` : `mkdir -p ${q(dirname(o.versionDir))} && mkdir ${q(o.versionDir)} || { echo RENDER-VEXISTS; exit 0; }`] : [`mkdir -p ${q(dirname(outs[0]))} && rm -f ${q(passes[0].args[passes[0].args.length - 1])}`]),
    ...passes.flatMap(pass), ...extras.flatMap(heredoc), 'echo RENDER-ALL', ''].join('\n')
}
export const cancelScript = (jobId: string, index: number, part: string): string => [`kill $(cat ${q(pidFile(jobId, index))} 2>/dev/null) 2>/dev/null`, `rm -f ${q(part)} ${q(pidFile(jobId, index))}`, 'echo CANCELLED', ''].join('\n')
/** ffmpeg's `-progress pipe:1` lines are `key=value`; `frame=N` is the count so far. */
export function parseProgress(line: string): { frame?: number; ended?: boolean } | null {
  const m = /^(\w+)=(.*)$/.exec(line.trim()); if (!m) return null
  if (m[1] === 'frame') { const n = Number(m[2]); return Number.isFinite(n) ? { frame: n } : null }
  if (m[1] === 'progress') return { ended: m[2] === 'end' }
  return null
}

// ----- dependencies (injectable) -----

export interface Deps {
  now(): number
  /** The pod's SSH address while it runs, else why not */
  target(podId: string): Promise<{ host: string; port: number } | { reason: string }>
  ssh: podpull.SshRunner
  /** Pull proxies to this PC: the existing sync, `paths` and all */
  pull(req: syncrun.SyncRequest, signal: AbortSignal): Promise<syncrun.SyncResult>
  outputDir(podId: string): string
  localRoot(podId: string): string | null
  podName(podId: string): string
  volumeId(podId: string): string
  listing(volumeId: string, dir: string): Promise<{ name: string; bytes: number; modified: string }[] | null>
  emit(volumeId: string, prefix: string, bytes: number): Promise<unknown>
  /** Where a local ffmpeg is (PATH, then the usual install folders), or null; never installs anything */
  findFfmpeg(): Promise<string | null>
  /** Spawn a local process, streaming its lines; resolves with its exit code. Killed when the signal aborts. Tests give a fake. */
  spawn(cmd: string, args: string[], onLine: (l: string) => void, signal: AbortSignal): Promise<{ code: number | null }>
  /** The file names in a local folder (async) */
  readdir(dir: string): Promise<string[]>
  /** Free bytes where a folder is on this PC, or null (async statfs) */
  localFree(dir: string): Promise<number | null>
  /** ffprobe next to the given ffmpeg (or on PATH), or null; looks only */
  findFfprobe(ffmpegPath: string): Promise<string | null>
  /** The version folders already on the volume for a shot (an S3 listing of output/deliver/<shot>/ by prefix), best effort */
  deliverDirs(volumeId: string, shot: string): Promise<string[]>
  /** Everything under output/deliver/<shot>/ on the volume (name relative to the shot folder, bytes), best effort */
  deliverFiles(volumeId: string, shot: string): Promise<{ name: string; bytes: number }[]>
}
export const FFMPEG_PATHS = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
export const NO_FFMPEG = 'ffmpeg is not installed on this PC. Install it with Homebrew: brew install ffmpeg (Homebrew itself: https://brew.sh), then try again.'
export const INSTALL_HINT = 'brew install ffmpeg'
export const MISS_RECHECK_MS = 30_000
export const NO_FRAMES = 'The frames are not on this PC yet: sync the outputs first, or render on the pod'
/** PATH first, then the explicit folders (an Electron app has a minimal PATH). Looks only; installs and downloads nothing. */
async function lookFfmpeg(): Promise<string | null> {
  const dirs = (process.env.PATH ?? '').split(':').filter(Boolean).map((d) => join(d, 'ffmpeg'))
  for (const p of [...dirs, ...FFMPEG_PATHS]) { try { await access(p); return p } catch { /* next */ } }
  return null
}
export interface FfmpegState { path: string | null; broken?: string; version?: string }
let ffState: { at: number; v: FfmpegState } | null = null
/** Where ffmpeg is and whether it runs (`-version`). A hit is cached for good; a miss or a broken one is looked at again after 30 s, so installing it and retrying needs no restart. */
export async function ffmpegState(): Promise<FfmpegState> {
  if (ffState && (ffState.v.path && !ffState.v.broken ? true : deps.now() - ffState.at < MISS_RECHECK_MS)) return ffState.v
  const path = await deps.findFfmpeg()
  let v: FfmpegState = { path }
  if (path) {
    const lines: string[] = []
    const r = await deps.spawn(path, ['-version'], (l) => { if (l.trim()) lines.push(l.trim()) }, AbortSignal.timeout(15_000)).catch((e) => ({ code: -1 as number | null, err: (e as Error).message }))
    v = r.code !== 0 ? { path, broken: lines[0] ?? ('err' in r ? r.err : `exit ${r.code}`) } : { path, version: lines[0] ?? '' }
  }
  ffState = { at: deps.now(), v }
  return v
}
export const forgetFfmpeg = () => { ffState = null }
const spawnLocal: Deps['spawn'] = (cmd, args, onLine, signal) => new Promise((resolve) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const kill = () => child.kill('SIGTERM')
  if (signal.aborted) kill(); else signal.addEventListener('abort', kill, { once: true })
  for (const st of [child.stdout, child.stderr]) createInterface({ input: st }).on('line', onLine)
  child.on('error', (e) => { onLine(`cannot run ${cmd}: ${e.message}`); resolve({ code: 127 }) })
  child.on('close', (code) => { signal.removeEventListener('abort', kill); resolve({ code }) })
})
const cfgOf = (podId: string) => podconfigs.get(podId) ?? mounts.load()
const defaults = (): Deps => ({
  now: () => Date.now(),
  target: async (podId) => {
    if (mounts.dryRun(mounts.load())) return { host: 'root@simulated', port: 22 }
    const raw = await rp.getPod(podId); if (!raw) return { reason: `No pod ${podId}` }
    if ((raw.runtime?.uptimeInSeconds ?? 0) <= 0) return { reason: 'Start the pod: rendering happens on the pod' }
    try { return sync.sshTarget(raw) } catch { return { reason: 'Start the pod: rendering happens on the pod (it has no SSH)' } }
  },
  ssh: podpull.runSsh,
  pull: (req, signal) => syncrun.run(req, () => undefined, signal),
  outputDir: (podId) => `${(mounts.folderRows(cfgOf(podId)).find((r) => r.key === 'comfy-shared')?.container || '/workspace/comfy-shared/').replace(/\/+$/, '')}/output`,
  localRoot: (podId) => mounts.folderRows(cfgOf(podId)).find((r) => r.key === 'comfy-shared')?.local || null,
  podName: (id) => podnames.get(id) || id,
  volumeId: (podId) => syncrun.volumeIdFor(podId),
  listing: async (vol, dir) => { try { return (await changes.listRows(vol, `comfy-shared/output/${PROXIES}/${dir}`.replace(/\/$/, ''), false)).filter((r) => !r.key.endsWith('/')).map((r) => ({ name: r.key.split('/').pop()!, bytes: r.bytes, modified: r.modified ?? '' })) } catch { return null } },
  emit: (vol, prefix, bytes) => journal.emit(vol, { writer: 'app:render', op: 'created', prefix, files: 1, bytes }),
  deliverDirs: async (vol, shot) => { try { return (await changes.listRows(vol, `comfy-shared/output/deliver/${shot}`, false)).filter((r) => r.key.endsWith('/')).map((r) => r.key.split('/').filter(Boolean).pop()!) } catch { return [] } },
  deliverFiles: async (vol, shot) => { try { const base = `comfy-shared/output/deliver/${shot}/`; return (await changes.listRows(vol, base.replace(/\/$/, ''), true)).filter((r) => !r.key.endsWith('/')).map((r) => ({ name: r.key.slice(base.length), bytes: r.bytes })) } catch { return [] } },
  findFfmpeg: lookFfmpeg,
  localFree: async (dir) => { try { let d = dir; for (let i = 0; i < 6; i++) { try { const st = await statfs(d); return Number(st.bavail) * Number(st.bsize) } catch { d = dirname(d) } } return null } catch { return null } },
  findFfprobe: async (ff) => { const p = join(dirname(ff), 'ffprobe'); try { await access(p); return p } catch { return null } },
  spawn: spawnLocal,
  readdir: (dir) => readdir(dir),
})
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

// ----- local files -----

/** The mapped local folder the proxies live in: ComfyUI-Shared/output/.proxies (null when ComfyUI-Shared is not mapped). */
export const localProxyRoot = (podId = ''): string | null => { const r = deps.localRoot(podId); return r ? join(r, 'output', PROXIES) : null }

/**
 * The guard behind the `localfile://` protocol and `clearLocal`, pure of Electron: a request path (the part after `localfile://p/`) may name ONLY a `.mp4` inside the proxies folder.
 * Rejected: `..`, absolute, backslash, control characters, any other extension, a path that resolves (after the real path of the folder and of the file) outside it, a symlink.
 */
export async function resolveProxyFile(root: string | null, urlPath: string): Promise<{ ok: true; path: string; size: number } | { ok: false; status: number; message: string }> {
  const no = (status: number, message: string) => ({ ok: false as const, status, message })
  if (!root) return no(404, 'ComfyUI-Shared is not mapped on this PC.')
  let rel: string
  try { rel = decodeURIComponent(urlPath.replace(/^\/+/, '')) } catch { return no(400, 'Bad address.') }
  if (!rel || !safeSegments(rel) || rel.length > 600) return no(403, 'Not a proxy path.')
  if (!/\.mp4$/i.test(rel)) return no(403, 'Only .mp4 proxies are served.')
  const full = resolve(root, rel)
  if (!full.startsWith(resolve(root) + sep)) return no(403, 'Outside the proxies folder.')
  try {
    const realRoot = await realpath(root), l = await lstat(full)
    if (l.isSymbolicLink() || !l.isFile()) return no(403, 'Not a plain file.')
    const real = await realpath(full)
    if (!real.startsWith(realRoot + sep)) return no(403, 'Outside the proxies folder.')
    return { ok: true, path: real, size: l.size }
  } catch { return no(404, 'No such proxy.') }
}
const localUrl = (rel: string) => `localfile://p/${rel.split('/').map(encodeURIComponent).join('/')}`

/** Delete the proxies cached on this PC, and ONLY them: files inside the mapped `output/.proxies/`. Nothing on the volume. A symlink is unlinked itself and never followed. */
export async function clearLocal(podId = ''): Promise<{ removed: number; bytes: number }> {
  const root = localProxyRoot(podId); if (!root) return { removed: 0, bytes: 0 }
  const base = resolve(root); let removed = 0, bytes = 0
  const walk = async (dir: string): Promise<void> => {
    let names: string[]; try { names = await readdir(dir) } catch { return }
    for (const n of names) {
      const p = join(dir, n)
      if (!resolve(p).startsWith(base + sep)) continue   // the guard, once more, right before anything is removed
      let l; try { l = await lstat(p) } catch { continue }
      if (l.isDirectory() && !l.isSymbolicLink()) { await walk(p); await rm(p, { recursive: false, force: true }).catch(() => undefined) }   // an emptied folder; rm without recursive refuses a non-empty one
      else { await unlink(p).catch(() => undefined); removed++; bytes += l.size }
    }
  }
  await walk(base)
  return { removed, bytes }
}

// ----- the review kind: a versioned, visible deliverable folder (docs/ADR-048 "Governance fit") -----

export type Kind = 'proxy' | 'review'
export const NEEDS_NAME = 'A review video needs the name of who says yes'
/** The shot id: the lowercased `^[A-Za-z]+-\d+[a-z]?` prefix of the sequence name (corrosion-015), else the last segment of its folder. */
export const shotOf = (name: string, dir: string): string => {
  const m = /^[A-Za-z]+-\d+[a-z]?/.exec(name); if (m) return m[0].toLowerCase()
  return (dir.split('/').filter(Boolean).pop() ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '-') || 'shot'
}
export const versionName = (v: number): string => `v${String(v).padStart(3, '0')}`
/** The next free version: one above the highest `v###` folder that exists, starting at v001. An existing version is never reused. */
export const nextVersion = (existing: string[]): number => existing.reduce((a, n) => { const m = /^v(\d{3,})$/.exec(n); return m ? Math.max(a, Number(m[1])) : a }, 0) + 1
/** A review file is named by the CLIP NAME (the EDL's, so a conform relinks): `<clip>.mov` (ProRes 422 HQ) or `<clip>.mp4` (H.264); the version lives in the `v###` folder, not in the name. */
export const reviewFile = (clip: string, codec: Codec = 'prores422hq'): string => `${clip}.${codec === 'prores422hq' ? 'mov' : 'mp4'}`
export const reviewRel = (shot: string, v: number, clip: string, codec: Codec = 'prores422hq'): string => `output/deliver/${shot}/${versionName(v)}/${reviewFile(clip, codec)}`
export const DELIVERY_NOTE = "Ready for Binc's review. Sending to the client is Binc's; this app never sends."
export const PRORES_NOTE = 'A ProRes .mov cannot be played in this app (play it in QuickTime, DJV or the grading tool); the H.264 .mp4 plays here.'
const CODEC_NAME: Record<Codec, string> = { h264: 'H.264 (libx264, preset medium, crf 14, yuv420p)', prores422hq: 'ProRes 422 HQ (prores_ks profile 3, yuv422p10le, 10-bit 4:2:2)' }

/** DELIVERY.md for a version folder (policy: what changed, what was measured). `@@SHA256_k@@`, `@@BYTES_k@@` and `@@FRAMES_k@@` are filled in once each file exists. */
export function deliveryMd(o: { clip: string; shot: string; version: number; s: Sequence; width: Width; fps: number; probe: Probe; adapter: 'pod' | 'local'; source: string; ffv: string; passes: string[][]; codecs: Codec[]; approvedBy: string; at: string }): string {
  const frames = o.s.last - o.s.first + 1, dur = Math.round((frames / o.fps) * 1000) / 1000, h = o.probe.header
  const size = o.width === 'source' ? (h ? `the source resolution ${h.width}x${h.height}` : 'the source resolution') : `${o.width} px wide`
  return [`# ${o.shot} ${versionName(o.version)}: review video`, '', DELIVERY_NOTE, '',
    '## What changed', `- A new version: \`${versionName(o.version)}\` of the stitched review video for ${o.shot}. Nothing was overwritten, moved or deleted.`,
    `- Clip name: \`${o.clip}\` (the EDL's clip name, so a conform relinks).${o.clip !== o.s.name ? ` It differs from the frames' stem \`${o.s.name}\`; the frames keep their served names.` : ''}`,
    ...o.codecs.map((c, k) => `- File: \`${reviewFile(o.clip, c)}\` (${CODEC_NAME[c]}), with its \`.meta.json\` beside it.${k === 0 ? '' : ' A companion.'}`),
    ...(o.codecs.includes('prores422hq') ? [`- ${PRORES_NOTE}`] : []),
    `- Source sequence: \`${o.s.name}\` in \`output/${o.s.dir}\`, frames ${o.s.first} to ${o.s.last} (${frames} frames), served names and numbers unchanged (the frames were only read).`,
    `- Spec is not set in deliverables.csv; rendered at ${size}, ${o.codecs.map((c) => (c === 'h264' ? 'H.264' : 'ProRes 422 HQ')).join(' and ')}, ${o.fps} fps (review of the full sequence).`,
    `- Start timecode: ${h?.timecode ? `${h.timecode}, read from the DPX television header (SMPTE 268M, byte 1664) and embedded (-timecode)` : 'no timecode in the DPX header; none embedded (never invented)'}.`,
    `- Tool: ${o.ffv || 'ffmpeg'} (${o.adapter === 'pod' ? 'on the pod' : 'on this PC'}); frames read from ${o.source}.`, '',
    '## What was measured', ...o.codecs.map((c, k) => `- ${reviewFile(o.clip, c)}: decoded frame count (ffprobe -count_frames) @@FRAMES_${k}@@ of ${frames} expected (a mismatch fails the render); ${'@@BYTES_' + k + '@@'} bytes; sha256 @@SHA256_${k}@@`),
    `- Measured encode rate: ${o.codecs.map((c, k) => `${c} @@RATE_${k}@@ frames per second`).join(', ')}.`,
    `- Frames rendered: ${o.probe.run} of ${frames} expected; frame numbers contiguous from ${o.s.first} to ${o.s.last}: ${o.probe.complete ? 'verified' : 'NOT complete'}.`,
    `- Source files named like the sequence that do not fit its pattern: ${o.probe.odd}; frames of an unusual size: ${o.probe.size_odd}.`, `- Duration: ${dur} s (${frames} frames at ${o.fps} fps; frame-exact timing, no drops or duplicates).`, '',
    '## Colour', ...colourLines(h, o.codecs).map((l) => `- ${l}`), '',
    '## Who and when', `- Rendered at ${o.at} for ${o.approvedBy} (the named yes).`, ...o.passes.map((a) => `- ffmpeg command: \`${a.slice(1).join(' ')}\``), ''].join('\n')
}

/** Writing under Binc's mirror (projects/desktop/) is never allowed: the app writes only the volume and the mapped local ComfyUI-Shared. */
export function assertNotMirror(p: string): void {
  const m = resolve(mirrorDir()), r = resolve(p)
  if (r === m || r.startsWith(m + sep)) throw bad(`Refused: ${p} is inside Binc's mirror (projects/desktop/), which this app never writes to`)
}
export const localDeliverRoot = (podId = ''): string | null => { const r = deps.localRoot(podId); return r ? join(r, 'output', 'deliver') : null }

// ----- settings: the effective render settings (the pod's own configuration, else the Default Configuration, else the defaults) -----

export type RenderSettings = mounts.RenderSettings
export const effectiveSettings = (podId?: string): RenderSettings => (podId ? podconfigs.get(podId)?.render : undefined) ?? mounts.load().render ?? { ...mounts.RENDER_DEFAULT }

// ----- plan and proxies -----

const cache = new Map<string, { at: number; rows: { name: string; bytes: number; modified: string }[] | null }>()
export const forgetListings = () => cache.clear()
async function listed(vol: string, dir: string) {
  const k = `${vol}|${dir}`, hit = cache.get(k)
  if (hit && deps.now() - hit.at < LISTING_MS) return hit.rows
  const rows = vol ? await deps.listing(vol, dir) : null
  cache.set(k, { at: deps.now(), rows }); return rows
}
const exists = async (p: string) => { try { return (await stat(p)).isFile() } catch { return false } }

function clean(sequences: unknown): Sequence[] {
  if (!Array.isArray(sequences) || !sequences.length) throw bad('Choose at least one sequence.')
  if (sequences.length > MAX_SEQUENCES) throw bad(`At most ${MAX_SEQUENCES} sequences at once.`)
  return sequences.map(validateSequence)
}
const kindOf = (k: unknown, dflt: Kind = 'proxy'): Kind => { if (k === undefined || k === null || k === '') return dflt; if (k === 'proxy' || k === 'review') return k; throw bad('kind is proxy or review') }
const codecsOf = (c: unknown, dflt: Codec[]): Codec[] => {
  if (c === undefined || c === null) return dflt
  if (!Array.isArray(c) || !c.length || c.some((x) => !CODECS.includes(x))) throw bad(`codecs is a non-empty list of ${CODECS.join(', ')}`)
  return [...new Set(c as Codec[])]
}
/** The request's width, else the effective setting for the kind (default `source`). */
const widthFor = (kind: Kind, w: unknown, st: RenderSettings): Width => validateWidth(w === undefined || w === null || w === '' ? (kind === 'review' ? st.review_width : st.proxy_width) : w)
const slow = (width: Width) => (width === 'source' || width === 1920 ? 'slow: expect minutes per 100 frames at full resolution (a 4K H.264 encode on a pod CPU is a few frames per second); the measured rate and time left show while it renders' : 'faster: a downscale encodes much quicker than the source size')

export interface AdapterState { id: 'pod' | 'local'; ok: boolean; reason?: string; code?: string; install_hint?: string }
/** Which adapters can work now. pod: a running pod with SSH. local: ffmpeg on this PC and ComfyUI-Shared mapped (and not Binc's mirror). */
export async function adapterStates(podId?: string): Promise<AdapterState[]> {
  const pod = await podAdapter(podId).check(), loc = await localAdapter(podId).check()
  return [{ id: 'pod', ok: pod.ok, ...(pod.reason ? { reason: pod.reason } : {}) }, { id: 'local', ok: loc.ok, ...(loc.reason ? { reason: loc.reason } : {}), ...(loc.code ? { code: loc.code } : {}), ...(loc.install_hint ? { install_hint: loc.install_hint } : {}) }]
}
/** The adapter `where` chooses, or throws with the reasons: auto is the pod when it runs, else this PC, else both reasons; explicit pod or local fails with that adapter's own reason. */
export function chooseWhere(where: Where, adapters: AdapterState[]): 'pod' | 'local' {
  const pod = adapters.find((a) => a.id === 'pod')!, loc = adapters.find((a) => a.id === 'local')!
  if (where === 'pod') { if (!pod.ok) throw bad(pod.reason ?? 'The pod cannot render'); return 'pod' }
  if (where === 'local') { if (!loc.ok) throw new CoreError(400, loc.reason ?? 'This PC cannot render', loc.code); return 'local' }
  if (pod.ok) return 'pod'
  if (loc.ok) return 'local'
  throw new CoreError(400, `Nothing can render: on the pod, ${pod.reason ?? 'not available'}; on this PC, ${loc.reason ?? 'not available'}`, loc.code)
}
const whereOf = (w: unknown, dflt: Where = 'auto'): Where => { if (w === undefined || w === null || w === '') return dflt; if (w === 'auto' || w === 'pod' || w === 'local') return w; throw bad('where is auto, pod or local') }

export interface PlanRequest { pod_id?: string; sequences: unknown; width?: unknown; where?: Where; kind?: Kind; codecs?: Codec[]; allow_partial?: boolean; fps?: number }
/** What the pod has to render with (DPX decode and ffmpeg are CPU-bound: the GPU is idle, so a cheap card with many vCPUs is enough), and what the output folder has free. */
export interface PodCpu { cores: number; mem_mb: number; free_gb: number }
export interface PlanResult { pod_cpu?: PodCpu; local_free_gb?: number; estimate: { output_gb: number; note: string }; pod_ok: boolean; reason?: string; adapters: AdapterState[]; where: 'pod' | 'local' | null; kind: Kind; width: Width; codecs: Codec[]; settings: RenderSettings; settings_source: 'pod' | 'default'; notes: string[]; total_frames: number; sequences: PlannedSequence[] }
/** `nproc`, `free -m` and `df -Pk` of the pod's output folder over SSH: 5 seconds at most, best effort, never throws, absent when it fails. */
export async function probePod(podId: string, target: { host: string; port: number }): Promise<PodCpu | null> {
  try {
    const lines: string[] = [], ac = new AbortController(), t = setTimeout(() => ac.abort(), 5000)
    try {
      const script = ['echo "NPROC $(nproc 2>/dev/null || echo 0)"', `free -m 2>/dev/null | awk '/^Mem:/{print "MEM " $2 " " $7}'`, `echo "DF $(df -Pk ${q(deps.outputDir(podId))} 2>/dev/null | tail -1 | awk '{print $4}')"`, ''].join('\n')
      await Promise.race([deps.ssh({ host: target.host, port: target.port, script, onLine: (l) => lines.push(l), signal: ac.signal }), new Promise((_r, rej) => ac.signal.addEventListener('abort', () => rej(new Error('timeout'))))])
    } finally { clearTimeout(t) }
    const n = Number(/^NPROC (\d+)/m.exec(lines.join('\n'))?.[1]), mem = /^MEM (\d+) (\d+)/m.exec(lines.join('\n')), df = Number(/^DF (\d+)/m.exec(lines.join('\n'))?.[1])
    if (!(n > 0) || !mem || !Number.isFinite(df)) return null
    return { cores: n, mem_mb: Number(mem[1]), free_gb: Math.round((df / 1024 / 1024) * 10) / 10 }
  } catch { return null }
}
/** Output size, honestly a rough guess: ProRes 422 HQ at 4K is about 5.3 GB per minute of picture at 24 fps (scaled by the pixel count); H.264 review about 0.8; the quick H.264 proxy about 0.4. */
export const GB_PER_MIN = { prores422hq: 5.3, h264_review: 0.8, h264_proxy: 0.4 }
export function outputGb(frames: number, fps: number, codecs: Codec[], kind: Kind, pixelFactor: number): number {
  const minutes = frames / fps / 60, rate = codecs.reduce((a, c) => a + (c === 'prores422hq' ? GB_PER_MIN.prores422hq : kind === 'review' ? GB_PER_MIN.h264_review : GB_PER_MIN.h264_proxy), 0)
  return Math.round(minutes * rate * pixelFactor * 10) / 10
}
export const GATE_GB = 5

export async function plan(o: PlanRequest): Promise<PlanResult> {
  const st = effectiveSettings(o.pod_id), kind = kindOf(o.kind, st.kind), seqs = clean(o.sequences), width = widthFor(kind, o.width, st), want = whereOf(o.where, st.where), codecs = kind === 'review' ? codecsOf(o.codecs, st.codecs) : ['h264' as Codec]
  if (kind === 'review' && o.allow_partial) throw bad('A review video is only made from a complete sequence: allow_partial is not available for kind review')
  if (want === 'pod' && !o.pod_id) throw bad('Which pod?')
  const adapters = await adapterStates(o.pod_id)
  let chosen: 'pod' | 'local' | null = null
  try { chosen = chooseWhere(want, adapters) } catch { chosen = null }
  const ad = chosen === 'pod' ? podAdapter(o.pod_id) : chosen === 'local' ? localAdapter(o.pod_id ?? '') : null
  if (ad) await ad.check()
  const st2 = st
  const podTarget = chosen === 'pod' ? (ad as ReturnType<typeof podAdapter>).target : undefined
  const pod_cpu = podTarget && o.pod_id ? (await probePod(o.pod_id, podTarget)) ?? undefined : undefined
  const lroot = chosen === 'local' ? localProxyRoot(o.pod_id ?? '') : null, localFreeB = lroot ? await deps.localFree(lroot) : null
  void st2
  const vol = o.pod_id ? deps.volumeId(o.pod_id) : '', root = localProxyRoot(o.pod_id ?? ''), out: PlannedSequence[] = []
  const notes = [slow(width), ...(kind === 'proxy' ? ['The quick proxy is always H.264 (this app cannot play ProRes); a review defaults to ProRes 422 HQ, and the .mov is for QuickTime, DJV or the conform.'] : []), ...(kind === 'review' && codecs.includes('prores422hq') ? [PRORES_NOTE] : [])]
  for (const s of seqs) {
    const file = `${clipOf(s)}${width === 'source' ? '' : `_${width}`}.mp4`
    const remote = vol ? ((await listed(vol, s.dir).catch(() => null))?.some((r) => r.name === file) ?? false) : false
    let probe: Probe | null = null; if (ad && seqs.length <= 30) probe = await ad.plan(s, width).catch(() => null)
    const complete = probe ? probe.complete : s.frames === s.last - s.first + 1, partial = !!o.allow_partial && !complete, h = probe?.header ?? null
    const base: PlannedSequence = { ...s, clip_name: clipOf(s), out: proxyRel(s, width, partial), exists_remote: remote, exists_local: root ? await exists(join(root, proxyRel(s, width, partial).slice(`output/${PROXIES}/`.length))) : false, gaps: probe ? probe.gaps : Math.max(0, s.last - s.first + 1 - s.frames), where: chosen ?? 'pod', complete, missing: probe?.missing ?? [], partial,
      source: h ? { width: h.width, height: h.height, bits: h.bits } : null, estimate: { frames: probe ? probe.run : s.frames, note: slow(width), output_gb: outputGb(probe ? probe.run : s.frames, Number(fpsOf(s.name, o.fps ?? s.fps ?? (typeof st.fps === 'number' ? st.fps : undefined))), codecs, kind, width === 'source' ? (h ? (h.width * h.height) / (3840 * 2160) : 1) : (width / 3840) ** 2) } }
    if (kind === 'review') { const shot = shotOf(clipOf(s), s.dir), existing = [...(ad ? await ad.versions(shot).catch(() => []) : []), ...(vol ? await deps.deliverDirs(vol, shot).catch(() => []) : [])]; const v = nextVersion(existing); out.push({ ...base, shot, next_version: v, out: reviewRel(shot, v, clipOf(s), codecs[0]), exists_remote: false, exists_local: false, colour_refusal: colourRefusal(h) }) }
    else out.push(base)
  }
  const totalGb = Math.round(out.reduce((a, x) => a + (x.estimate?.output_gb ?? 0), 0) * 10) / 10, fullRes = width === 'source' || width === 1920
  if (pod_cpu && kind === 'review' && fullRes && pod_cpu.cores < 8) notes.push(`This pod has ${pod_cpu.cores} vCPUs: a 4K review will be slow (expect minutes per 100 frames). A pod with more cores or On this PC may be faster.`)
  if (pod_cpu && totalGb > pod_cpu.free_gb) notes.push(`Only ${pod_cpu.free_gb} GB are free on the pod's output volume; about ${totalGb} GB is needed (not refused: free some space or render on this PC).`)
  if (localFreeB !== null && totalGb > localFreeB / 1e9) notes.push(`Only ${Math.round(localFreeB / 1e8) / 10} GB are free on this PC; about ${totalGb} GB is needed (not refused).`)
  if (chosen === 'pod' && st.pull && totalGb > GATE_GB) notes.push(`About ${totalGb} GB: a sync of this size asks for approval (Auto sync) or takes a while.`)
  const pod = adapters[0]
  return { ...(pod_cpu ? { pod_cpu } : {}), ...(localFreeB !== null ? { local_free_gb: Math.round(localFreeB / 1e8) / 10 } : {}), estimate: { output_gb: totalGb, note: 'A rough guess (ProRes 422 HQ at 4K is about 5.3 GB per minute of picture at 24 fps); the real size shows when it is done.' }, pod_ok: pod.ok, ...(chosen ? {} : { reason: pod.reason ?? adapters[1].reason }), adapters, where: chosen, kind, width, codecs, settings: st, settings_source: (o.pod_id && podconfigs.get(o.pod_id)?.render) ? 'pod' : 'default', notes, total_frames: seqs.reduce((a, s) => a + s.frames, 0), sequences: out }
}

export interface Deliverable { clip_name: string; shot: string; version: string; file: string; files: string[]; exists_local: boolean; exists_remote: boolean; bytes: number; approved_by?: string; rendered_at?: string; local_url: string }
const readMeta = async (p: string): Promise<Record<string, unknown> | null> => { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null } }
const REVIEW_EXT = /\.(mov|mp4)$/i

/** Where each proxy is: on the volume (an S3 listing of its folder by prefix, cached 60 s, works with the pod stopped) and on this PC (a stat); the sidecar says whether it is complete, partial, its fps, frames and real size. `deliverables` lists the review versions of the clip (its files in each `v###` folder). */
export async function proxies(o: { pod_id?: string; volume_id?: string; items: { dir: string; name: string; clip_name?: string }[]; width?: unknown }): Promise<{ items: (ProxyItem & { clip_name: string; deliverables: Deliverable[] })[] }> {
  if (!Array.isArray(o.items) || o.items.length > 500) throw bad('items is a list of { dir, name, clip_name? } (at most 500)')
  const wantWidth = o.width === undefined || o.width === null || o.width === '' || o.width === 0 ? null : validateWidth(o.width)
  const vol = o.volume_id || (o.pod_id ? deps.volumeId(o.pod_id) : '') || mounts.load().shared_volume_id || mounts.load().network_volume_id || ''
  const root = localProxyRoot(o.pod_id ?? ''), droot = localDeliverRoot(o.pod_id ?? ''), out: (ProxyItem & { clip_name: string; deliverables: Deliverable[] })[] = []
  for (const it of o.items) {
    const s = validateSequence({ ...it, first: 0, last: 0, frames: 1, pad: 1 }), clip = clipOf(s)
    const rows = (await listed(vol, s.dir).catch(() => null)) ?? []
    const re = new RegExp(`^${clip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:_(\\d+))?(_partial)?\\.mp4$`)
    const rank = (w: string) => (w === 'source' ? 1e9 : Number(w))
    const found = rows.map((r) => { const m = re.exec(r.name); return { r, w: m ? (m[1] ?? 'source') : '', partial: !!m?.[2] } }).filter((x) => x.w && (!wantWidth || x.w === String(wantWidth))).sort((a, b) => rank(b.w) - rank(a.w) || Number(a.partial) - Number(b.partial))[0]
    // nothing on the volume (or not listed): look at this PC's own proxies folder for the same clip
    let lw = '', lpartial = false
    if (!found && root && !wantWidth) { try { const names = await deps.readdir(join(root, s.dir)); const best = names.map((n) => { const m = re.exec(n); return m ? { w: m[1] ?? 'source', partial: !!m[2] } : null }).filter(Boolean).sort((a, b) => rank(b!.w) - rank(a!.w) || Number(a!.partial) - Number(b!.partial))[0]; if (best) { lw = best.w; lpartial = best.partial } } catch { /* none */ } }
    const wname = found?.w ?? (lw || (wantWidth ? String(wantWidth) : '')), partial = found?.partial ?? lpartial, rel = `${s.dir ? `${s.dir}/` : ''}${clip}${wname === 'source' ? '' : `_${wname}`}${partial ? '_partial' : ''}.mp4`
    let local = false, meta: Record<string, unknown> | null = null
    if (root && wname) { local = await exists(join(root, rel)); if (local) meta = await readMeta(join(root, `${rel}.meta.json`)) }
    const shot = shotOf(clip, s.dir), dl = new Map<string, Deliverable>()
    const slot = (v: string): Deliverable => { let d = dl.get(v); if (!d) { d = { clip_name: clip, shot, version: v, file: '', files: [], exists_local: false, exists_remote: false, bytes: 0, local_url: '' }; dl.set(v, d) } return d }
    const pick = (d: Deliverable) => { d.file = d.files.find((f) => f.endsWith('.mp4')) ?? d.files[0] ?? ''; return d }
    const remoteFiles = vol ? await deps.deliverFiles(vol, shot).catch(() => []) : []
    for (const f of remoteFiles) { const m = /^(v\d{3,})\/([^/]+)$/.exec(f.name); if (m && m[2].startsWith(`${clip}.`) && REVIEW_EXT.test(m[2]) && m[2] === `${clip}${m[2].slice(clip.length)}` && !m[2].endsWith('.meta.json')) { const d = slot(m[1]); d.files.push(m[2]); d.exists_remote = true; d.bytes += f.bytes } }
    if (droot) { let vs: string[] = []; try { vs = (await deps.readdir(join(droot, shot))).filter((n) => /^v\d{3,}$/.test(n)) } catch { /* none */ }
      for (const v of vs) { let names: string[] = []; try { names = await deps.readdir(join(droot, shot, v)) } catch { /* none */ }
        const mine = names.filter((n) => n === `${clip}.mov` || n === `${clip}.mp4`); if (!mine.length) continue
        const d = slot(v); for (const n of mine) if (!d.files.includes(n)) d.files.push(n); d.exists_local = true; pick(d)
        const m = await readMeta(join(droot, shot, v, `${d.file}.meta.json`)); if (typeof m?.approved_by === 'string') d.approved_by = m.approved_by; if (typeof m?.rendered_at === 'string') d.rendered_at = m.rendered_at
        if (mine.includes(`${clip}.mp4`)) d.local_url = `localfile://d/${[shot, v, `${clip}.mp4`].map(encodeURIComponent).join('/')}` } }   // only the .mp4 plays in the app
    const width = wname === 'source' ? (typeof meta?.width === 'number' ? meta.width : 0) : Number(wname) || 0
    out.push({ dir: s.dir, name: s.name, clip_name: clip, width: width as never, height: typeof meta?.height === 'number' ? meta.height : null, exists_remote: !!found, exists_local: local, local_url: local ? localUrl(rel) : '', remote_ready: !!found, bytes: found?.r.bytes ?? 0, modified: found?.r.modified ?? '', partial,
      complete: typeof meta?.complete === 'boolean' ? meta.complete : null, fps: typeof meta?.fps === 'number' ? meta.fps : null, frames: typeof meta?.frames === 'number' ? meta.frames : null,
      deliverables: [...dl.values()].map(pick).sort((a, b) => a.version.localeCompare(b.version)) })
  }
  return { items: out }
}

// ----- the two render adapters -----

export interface RenderOpts {
  width: Width; fps?: number; frames: number; jobId: string; index: number; signal: AbortSignal; onProgress: (frame: number, pass: number) => void
  probe: Probe; partial: boolean; kind: Kind; codecs: Codec[]; shot: string; version: number; approvedBy: string; source: string; at: string
  /** the clip name the files carry; whether this clip creates the version folder (the first of its shot in the job) or adds to it */ clip: string; createDir: boolean
}
export interface RenderResult { out: string; outs: string[]; bytes: number; files: string[] }
/** A render adapter: `pod` (ffmpeg over SSH on the running pod, then the proxy is pulled) or `local` (ffmpeg on this PC, no pull). Both run the SAME ffmpeg argument arrays. */
export interface RenderAdapter {
  id: 'pod' | 'local'; needsPull: boolean
  check(): Promise<{ ok: boolean; reason?: string; code?: string; install_hint?: string }>
  plan(seq: Sequence, width: Width): Promise<Probe>
  /** The version folders that already exist for a shot (review) */
  versions(shot: string): Promise<string[]>
  render(seq: Sequence, o: RenderOpts): Promise<RenderResult>
}
const eachChunk = async <T>(items: T[], fn: (x: T) => void): Promise<void> => { for (let i = 0; i < items.length; i += 500) { for (const x of items.slice(i, i + 500)) fn(x); await new Promise((r) => setImmediate(r)) } }
class VersionExists extends Error {}
const isReview = (o: RenderOpts) => o.kind === 'review'
export const REVIEW_TIMEOUT_S = 7200   // a review pass on the pod may take 2 hours at most

/** The passes of a render and where each lands (relative to ComfyUI-Shared): one for a proxy, one per codec for a review. */
function passesOf(s: Sequence, o: RenderOpts, outputDir: string): { passes: Pass[]; rels: string[]; finals: string[] } {
  const review = isReview(o), rels = review ? o.codecs.map((c) => reviewRel(o.shot, o.version, o.clip, c)) : [proxyRel(s, o.width, o.partial)]
  const finals = rels.map((r) => `${outputDir}/${r.slice('output/'.length)}`)
  const codecs: Codec[] = review ? o.codecs : ['h264']
  const passes = codecs.map((c, k): Pass => ({ args: ffmpegArgs(s, o.width, { fps: o.fps, outputDir, frames: o.frames, partial: o.partial, final: finals[k], codec: c, quality: o.kind, timecode: o.probe.header?.timecode }), fmt: c === 'prores422hq' ? 'mov' : 'mp4', verify: review ? o.frames : null }))
  return { passes, rels, finals }
}
/** What a render writes next to its videos: a sidecar per file, and for a review DELIVERY.md. */
function sidecars(s: Sequence, o: RenderOpts, adapter: 'pod' | 'local', passes: Pass[], rels: string[]): { metas: Record<string, unknown>[]; delivery: string | null } {
  const review = isReview(o), fps = Number(fpsOf(s.name, o.fps ?? s.fps)), codecs: Codec[] = review ? o.codecs : ['h264'], h = o.probe.header
  const metas = rels.map((rel, k) => buildMeta(s, { width: o.width, fps: o.fps, probe: o.probe, partial: o.partial, adapter, args: passes[k].args, version: o.probe.ffmpeg_version, at: o.at, kind: o.kind, extra: {
    ...(review ? { clip_name: o.clip, frames_stem: s.name, shot: o.shot, version: versionName(o.version), approved_by: o.approvedBy, source: o.source, delivery_note: DELIVERY_NOTE, duration_s: Math.round(((s.last - s.first + 1) / fps) * 1000) / 1000, codec: codecs[k],
      outputs: rels.map((r, j) => ({ file: r.slice(r.lastIndexOf('/') + 1), codec: codecs[j], bytes: `@@BYTES_${j}@@`, sha256: `@@SHA256_${j}@@`, frames_decoded: `@@FRAMES_${j}@@`, render_fps: `@@RATE_${j}@@` })) } : {}),
    start_timecode: h?.timecode ?? null, timecode_source: h?.timecode ? 'DPX television header (SMPTE 268M, byte 1664)' : null, ...(h?.timecode ? {} : { timecode_note: 'no timecode in the DPX header' }),
    colour: { header: h, transform: 'none', lines: colourLines(h, codecs) }, ffmpeg_passes: passes.map((p) => p.args), notes: codecs.includes('prores422hq') ? [PRORES_NOTE] : [] } }))
  return { metas, delivery: review ? deliveryMd({ clip: o.clip, shot: o.shot, version: o.version, s, width: o.width, fps, probe: o.probe, adapter, source: o.source, ffv: o.probe.ffmpeg_version, passes: passes.map((p) => p.args), codecs, approvedBy: o.approvedBy, at: o.at }) : null }
}
const metaText = (m: Record<string, unknown>) => JSON.stringify(m, null, 1).replace(/"(@@(?:BYTES|FRAMES|RATE)_\d+@@)"/g, '$1')

function podAdapter(podId?: string): RenderAdapter & { target?: { host: string; port: number } } {
  const me: RenderAdapter & { target?: { host: string; port: number } } = {
    id: 'pod', needsPull: true,
    async check() {
      if (!podId) return { ok: false, reason: 'No pod chosen: rendering on the pod needs a running pod' }
      const t = await deps.target(podId).catch((e) => ({ reason: (e as Error).message }))
      if ('reason' in t) return { ok: false, reason: t.reason }
      me.target = t; return { ok: true }
    },
    async plan(s, width) {
      const t = me.target!, lines: string[] = []
      await deps.ssh({ host: t.host, port: t.port, script: probeScript(s, width, deps.outputDir(podId!)), onLine: (l) => lines.push(l), signal: new AbortController().signal })
      return parseProbe(lines, s)
    },
    async versions(shot) {
      const t = me.target!, names: string[] = []
      await deps.ssh({ host: t.host, port: t.port, script: `ls -1 ${q(`${deps.outputDir(podId!)}/deliver/${shot}`)} 2>/dev/null; echo`, onLine: (l) => { if (/^v\d{3,}$/.test(l.trim())) names.push(l.trim()) }, signal: new AbortController().signal })
      return names
    },
    async render(s, o) {
      const t = me.target!, outputDir = deps.outputDir(podId!), review = isReview(o)
      if (review && !o.probe.ffprobe) throw new Error('ffprobe is not installed on the pod, so the frame count of the review cannot be verified: not rendered')
      const { passes, rels, finals } = passesOf(s, o, outputDir), sc = sidecars(s, o, 'pod', passes, rels)
      const extras: Extra[] = [...rels.map((r, k) => ({ path: `${finals[k]}.meta.json`, content: metaText(sc.metas[k]) })), ...(sc.delivery ? [{ path: `${dirname(finals[0])}/DELIVERY.md`, content: o.createDir ? sc.delivery : `\n---\n\n${sc.delivery}`, append: !o.createDir }] : [])]
      let exit = -1, pass = 0, vexists = false, mismatch = ''; const bytes: number[] = [], tail: string[] = []
      const res = await deps.ssh({ host: t.host, port: t.port, script: renderScript(passes, o.jobId, o.index, extras, { ...(review ? { versionDir: dirname(finals[0]), createDir: o.createDir, timeout: REVIEW_TIMEOUT_S } : {}) }), signal: o.signal, onLine: (l) => {
        const pr = parseProgress(l)
        if (pr?.frame !== undefined) o.onProgress(pr.frame, pass)
        else if (!pr) {
          const t1 = l.trim(), ps = /^PASS (\d+)$/.exec(t1), d = /^RENDER-DONE (\d+) (\d+)/.exec(t1), e = /^RENDER-EXIT (\d+)/.exec(t1), c = /^RENDER-COUNT (\S*) (\d+)/.exec(t1)
          if (ps) pass = Number(ps[1]); else if (t1 === 'RENDER-VEXISTS') vexists = true; else if (d) bytes[Number(d[1])] = Number(d[2]); else if (e) exit = Number(e[1]); else if (c) mismatch = `decoded ${c[1] || 'no'} frames, expected ${c[2]}`; else if (t1 === 'RENDER-ALL') exit = 0; else if (t1) { tail.push(t1); if (tail.length > 5) tail.shift() }
        }
      } })
      if (vexists) throw new VersionExists('the version folder already exists')
      if (o.signal.aborted) { await deps.ssh({ host: t.host, port: t.port, script: cancelScript(o.jobId, o.index, passes[Math.min(pass, passes.length - 1)].args.at(-1)!), onLine: () => undefined, signal: new AbortController().signal }).catch(() => undefined); throw new Error('cancelled') }
      if (mismatch) throw new Error(`The frame count does not match: ${mismatch}. The file was removed; nothing was delivered.`)
      if (exit !== 0) throw new Error(`ffmpeg failed${exit > 0 ? ` (exit ${exit})` : res.code ? ` (ssh exit ${res.code})` : ''}${tail.length ? `: ${tail.join(' | ')}` : ''}`)
      return { out: rels[0], outs: rels, bytes: bytes.reduce((a, b) => a + (b || 0), 0), files: [...rels, ...rels.map(metaRel), ...(sc.delivery ? [`${rels[0].slice(0, rels[0].lastIndexOf('/'))}/DELIVERY.md`] : [])] }
    },
  }
  return me
}

const sha256Of = (file: string): Promise<string> => new Promise((resolveHash, reject) => { const h = createHash('sha256'); createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolveHash(h.digest('hex'))).on('error', reject) })   // streamed: a video is large
const writeAtomic = async (path: string, text: string) => { await writeFile(`${path}.tmp`, text); await rename(`${path}.tmp`, path) }
/** The first bytes of a local frame, async. */
async function readHead(file: string, n = 1700): Promise<Uint8Array | null> { try { const fh = await open(file, 'r'); try { const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, 0); return new Uint8Array(b.subarray(0, bytesRead)) } finally { await fh.close() } } catch { return null } }

/** The local adapter: frames from the mapped local ComfyUI-Shared output folder (same relative dir and name as on the pod), the same ffmpeg arguments with a local ffmpeg, the proxy written next to them under .proxies (a review under deliver/<shot>/v###/) via a .part file and a rename. */
function localAdapter(podId = ''): RenderAdapter {
  const outDir = () => { const r = deps.localRoot(podId); return r ? join(r, 'output') : null }
  return {
    id: 'local', needsPull: false,
    async check() {
      const out = outDir()
      if (!out) return { ok: false, reason: 'ComfyUI-Shared is not mapped on this PC: set it in Configuration, Folders' }
      try { assertNotMirror(out) } catch (e) { return { ok: false, reason: (e as Error).message } }
      const ff = await ffmpegState()
      if (!ff.path) return { ok: false, reason: NO_FFMPEG, code: 'no_ffmpeg', install_hint: INSTALL_HINT }
      if (ff.broken) return { ok: false, reason: `ffmpeg was found at ${ff.path} but did not run: ${ff.broken}`, code: 'ffmpeg_broken' }
      return { ok: true }
    },
    async plan(s, width) {
      const out = outDir()!, dir = join(out, s.dir)
      const zero = { outM: 0, outS: 0, metS: 0, poutM: 0, poutS: 0, pmetS: 0, ffv: '' }
      let names: string[]; try { names = await deps.readdir(dir) } catch { return buildProbe([], 0, s, { ...zero, nodir: true }) }
      const re = new RegExp(`^${s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)\\.dpx$`), frames: FrameFile[] = []; let odd = 0
      const mine: { n: string; num: number }[] = []
      await eachChunk(names, (n) => { if (!n.startsWith(`${s.name}.`) || !n.endsWith('.dpx')) return; const m = re.exec(n); if (m && m[1].length === s.pad) mine.push({ n, num: Number(m[1]) }); else odd++ })
      for (let i = 0; i < mine.length; i += 500) { const part = await Promise.all(mine.slice(i, i + 500).map(async (f) => { try { const st = await stat(join(dir, f.n)); return { n: f.num, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) } } catch { return null } })); for (const f of part) if (f) frames.push(f) }
      const base = join(out, PROXIES, s.dir, `${clipOf(s)}${width === 'source' ? '' : `_${width}`}`), st = async (p: string) => { try { const x = await stat(p); return { m: Math.floor(x.mtimeMs / 1000), s: x.size } } catch { return { m: 0, s: 0 } } }
      const [o1, m1, o2, m2] = await Promise.all([st(`${base}.mp4`), st(`${base}.mp4.meta.json`), st(`${base}_partial.mp4`), st(`${base}_partial.mp4.meta.json`)])
      const first = mine.find((f) => f.num === s.first), header = first ? parseDpxInfo((await readHead(join(dir, first.n))) ?? new Uint8Array()) : null
      const ff = await ffmpegState()
      return buildProbe(frames, odd, s, { outM: o1.m, outS: o1.s, metS: m1.s, poutM: o2.m, poutS: o2.s, pmetS: m2.s, ffv: ff.version ?? '', header, ffprobe: !!(ff.path && (await deps.findFfprobe(ff.path))) })
    },
    async versions(shot) { try { return (await deps.readdir(join(outDir()!, 'deliver', shot))).filter((n) => /^v\d{3,}$/.test(n)) } catch { return [] } },
    async render(s, o) {
      const ff = await ffmpegState(); if (!ff.path) throw new Error(NO_FFMPEG); if (ff.broken) throw new Error(`ffmpeg was found at ${ff.path} but did not run: ${ff.broken}`); const bin = ff.path
      const out = outDir()!, review = isReview(o), base = resolve(out, review ? 'deliver' : PROXIES)
      assertNotMirror(out)
      const probeBin = review ? await deps.findFfprobe(bin) : null
      if (review && !probeBin) throw new Error('ffprobe was not found next to ffmpeg, so the frame count of the review cannot be verified: not rendered (brew install ffmpeg installs both)')
      const { passes, rels, finals } = passesOf(s, o, out), sc = sidecars(s, o, 'local', passes, rels)
      for (const p of [...passes.map((x) => x.args.at(-1)!), ...finals]) if (!resolve(p).startsWith(base + sep)) throw new Error(`Refused: the file would be written outside the ${review ? 'deliver' : '.proxies'} folder`)   // never outside it
      const dirFinal = dirname(finals[0])
      if (review && !o.createDir) await mkdir(dirFinal, { recursive: true })
      else if (review) { await mkdir(dirname(dirFinal), { recursive: true }); try { await mkdir(dirFinal) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new VersionExists('the version folder already exists'); throw e } }   // a plain mkdir: an existing version is never reused
      else { await mkdir(dirFinal, { recursive: true }); await rm(passes[0].args.at(-1)!, { force: true }) }
      const bytes: number[] = [], shas: string[] = [], counts: number[] = [], rates: string[] = []
      const cleanup = async () => { for (const p of passes) await rm(p.args.at(-1)!, { force: true }).catch(() => undefined); if (review) { for (const f of finals) await rm(f, { force: true }).catch(() => undefined); await rmdir(dirFinal).catch(() => undefined) } }
      const signal = review ? AbortSignal.any([o.signal, AbortSignal.timeout(REVIEW_TIMEOUT_S * 1000)]) : o.signal
      for (const [k, p] of passes.entries()) {
        const part = p.args.at(-1)!, tail: string[] = [], t0 = deps.now()
        const res = await deps.spawn(bin, p.args.slice(1), (l) => { const pr = parseProgress(l); if (pr?.frame !== undefined) o.onProgress(pr.frame, k); else if (!pr && l.trim()) { tail.push(l.trim()); if (tail.length > 5) tail.shift() } }, signal)
        if (o.signal.aborted) { await cleanup(); throw new Error('cancelled') }
        if (res.code !== 0) { await cleanup(); throw new Error(`ffmpeg failed (exit ${res.code})${tail.length ? `: ${tail.join(' | ')}` : ''}`) }
        let n = 0
        if (p.verify !== null) {   // the decoded frame count must equal the expected: no drops, no duplicates
          const nums: string[] = []
          await deps.spawn(probeBin!, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', '-f', p.fmt, '-i', part], (l) => { if (/^\d+$/.test(l.trim())) nums.push(l.trim()) }, signal)
          n = Number(nums[0] ?? NaN)
          if (n !== p.verify) { await cleanup(); throw new Error(`The frame count does not match: decoded ${nums[0] ?? 'no'} frames, expected ${p.verify}. The file was removed; nothing was delivered.`) }
        }
        counts.push(n); rates.push((n > 0 && deps.now() > t0 ? n / ((deps.now() - t0) / 1000) : 0).toFixed(2)); await rename(part, finals[k]); bytes.push((await stat(finals[k])).size); shas.push(review ? await sha256Of(finals[k]) : '')
      }
      const fill = (t: string) => passes.reduce((acc, _p, k) => acc.replace(new RegExp(`@@SHA256_${k}@@`, 'g'), shas[k]).replace(new RegExp(`@@BYTES_${k}@@`, 'g'), String(bytes[k])).replace(new RegExp(`@@FRAMES_${k}@@`, 'g'), String(counts[k])).replace(new RegExp(`@@RATE_${k}@@`, 'g'), rates[k]), t)
      for (const [k] of passes.entries()) await writeAtomic(`${finals[k]}.meta.json`, fill(metaText(sc.metas[k])))
      if (sc.delivery) { if (o.createDir) await writeAtomic(join(dirFinal, 'DELIVERY.md'), fill(sc.delivery)); else await appendFile(join(dirFinal, 'DELIVERY.md'), `\n---\n\n${fill(sc.delivery)}`) }
      return { out: rels[0], outs: rels, bytes: bytes.reduce((a, b) => a + b, 0), files: [] }
    },
  }
}

// ----- jobs -----

interface Job { versions: Map<string, number>; view: JobView; seqs: Sequence[]; kind: Kind; codecs: Codec[]; approvedBy: string; allowPartial: boolean; pull: boolean; fps?: number; auto: boolean; abort: AbortController; started: number; done: Promise<void> }
const jobs = new Map<string, Job>()
let finished: JobView[] = []
let write: Promise<void> = Promise.resolve()
const chain = new Map<string, Promise<void>>()   // one render job at a time per pod (and one at a time on this PC)
let seq = 0
const iso = (ms = deps.now()) => new Date(ms).toISOString()

export function load(): Promise<void> {
  return (async () => { try { const j = JSON.parse(await readFile(rendersFile(), 'utf8')); if (Array.isArray(j?.jobs)) finished = j.jobs.slice(0, KEEP_JOBS) } catch { /* none yet */ } })()
}
const persist = () => { const snap = JSON.stringify({ jobs: finished }); write = write.then(async () => { const f = rendersFile(); await mkdir(dirname(f), { recursive: true }); const t = `${f}.${process.pid}.tmp`; await writeFile(t, snap); await rename(t, f) }).catch(() => undefined); return write }
export const settled = async (): Promise<void> => { for (const j of jobs.values()) await j.done; await write }

const copy = (v: JobView): JobView => ({ ...v, sequences: v.sequences.map((s) => ({ ...s })) })
/** The jobs, from memory: running ones first, then the newest finished (kept across a restart). With an id, just that one. */
export function status(jobId?: string): { jobs: JobView[] } {
  const all = [...[...jobs.values()].map((j) => j.view), ...finished]
  return { jobs: (jobId ? all.filter((v) => v.job_id === jobId) : all).map(copy) }
}

export interface StartRequest extends PlanRequest { pull?: boolean; approved_by?: string }
export async function start(o: StartRequest): Promise<{ job_id: string }> {
  const st = effectiveSettings(o.pod_id), kind = kindOf(o.kind, st.kind), seqs = clean(o.sequences), width = widthFor(kind, o.width, st), want = whereOf(o.where, st.where), codecs = kind === 'review' ? codecsOf(o.codecs, st.codecs) : ['h264' as Codec]
  const fps = o.fps ?? (typeof st.fps === 'number' ? st.fps : undefined)
  if (kind === 'review') {
    if (!(o.approved_by ?? '').trim()) throw bad(NEEDS_NAME)
    if (o.allow_partial) throw bad('A review video is only made from a complete sequence: allow_partial is not available for kind review')
  }
  if (want === 'pod' && !o.pod_id) throw bad('Which pod?')
  if (fps !== undefined && !(typeof fps === 'number' && fps >= 1 && fps <= 240)) throw bad('fps is a number from 1 to 240')
  const chosen = chooseWhere(want, await adapterStates(o.pod_id))   // throws with the reason(s)
  const podId = o.pod_id ?? '', id = `render-${deps.now().toString(36)}-${(seq++).toString(36)}`
  const view: JobView = { job_id: id, kind, approved_by: (o.approved_by ?? '').trim(), codecs, notes: [slow(width), ...(codecs.includes('prores422hq') && kind === 'review' ? [PRORES_NOTE] : [])], pod_id: podId, pod_name: podId ? deps.podName(podId) : 'this PC', state: 'queued', started_at: iso(), finished_at: '', width, frames_done: 0,
    frames_total: seqs.reduce((a, s) => a + s.frames, 0) * (kind === 'review' ? codecs.length : 1), rate_fps: 0, current: '',
    sequences: seqs.map((s) => ({ where: chosen, dir: s.dir, name: s.name, clip_name: clipOf(s), state: 'waiting', frames_done: 0, frames_total: s.frames * (kind === 'review' ? codecs.length : 1), out: proxyRel(s, width), bytes: 0, error: '' })), pulled_files: 0, pulled_bytes: 0, error: '', summary: '' }
  const job: Job = { versions: new Map(), view, seqs, kind, codecs, approvedBy: view.approved_by, allowPartial: !!o.allow_partial, pull: o.pull ?? st.pull, fps, auto: want === 'auto', abort: new AbortController(), started: deps.now(), done: Promise.resolve() }
  jobs.set(id, job)
  const key = chosen === 'pod' ? podId : 'local', prev = chain.get(key) ?? Promise.resolve()
  job.done = prev.then(() => run(job)).catch(() => undefined)
  chain.set(key, job.done)
  return { job_id: id }
}

export function cancel(jobId: string): JobView {
  const j = jobs.get(jobId); if (!j) { const f = finished.find((v) => v.job_id === jobId); if (f) return copy(f); throw new CoreError(404, `No such render job: ${jobId}`) }
  j.abort.abort()
  return copy(j.view)
}

async function run(job: Job): Promise<void> {
  const v = job.view, ac = job.abort, vol = v.pod_id ? deps.volumeId(v.pod_id) : '', review = job.kind === 'review', passes = review ? job.codecs.length : 1
  if (ac.signal.aborted) { v.state = 'cancelled'; return end(job) }
  v.state = 'rendering'
  const adapters = { pod: podAdapter(v.pod_id || undefined), local: localAdapter(v.pod_id) }
  if (v.sequences[0]?.where === 'pod') await adapters.pod.check()   // fills in the SSH address
  const localOk = job.auto && (await adapters.local.check()).ok
  let renderedN = 0, skippedN = 0, failedN = 0, incompleteN = 0
  for (const [i, s] of job.seqs.entries()) {
    const sv = v.sequences[i]
    if (ac.signal.aborted) { sv.state = 'failed'; sv.error = 'cancelled'; continue }
    v.current = s.name; sv.state = 'rendering'
    try {
      let ad = adapters[sv.where], p = await ad.plan(s, v.width)
      if (job.auto && sv.where === 'pod' && (p.nodir || p.run === 0) && localOk) {   // the pod cannot read it but this PC has it: render it here
        const lp = await adapters.local.plan(s, v.width)
        if (lp.run > 0) { ad = adapters.local; sv.where = 'local'; p = lp }
      }
      if (p.nodir || p.run === 0) throw new Error(ad.id === 'local' ? NO_FRAMES : p.nodir ? `The folder ${s.dir || 'output'} is not on the pod's output folder` : `The first frame (${String(s.first).padStart(s.pad, '0')}) is not on the pod`)
      sv.complete = p.complete; sv.missing = p.missing
      if (!p.complete) {
        if (!job.allowPartial) { sv.state = 'incomplete'; sv.error = incompleteMessage(p); incompleteN++; continue }   // never the full-length name for an incomplete sequence
        sv.partial = true; sv.out = proxyRel(s, v.width, true)
        sv.warning = `${p.gaps} frame number${p.gaps === 1 ? '' : 's'} missing: rendered the ${p.run} contiguous frames from ${s.first} as a partial`
      }
      if (review) { const refusal = colourRefusal(p.header); if (refusal) throw new Error(refusal) }   // colour.md: stated, never guessed
      if (p.odd || p.size_odd) sv.warning = `${sv.warning ? `${sv.warning}; ` : ''}${p.odd ? `${p.odd} file(s) named like the sequence do not fit its pattern` : ''}${p.odd && p.size_odd ? '; ' : ''}${p.size_odd ? `${p.size_odd} frame(s) have an unusual size` : ''}`
      sv.frames_total = p.run * passes
      let last = [0, 0]
      if (p.skip && !review) { sv.state = 'skipped'; sv.bytes = p.out_bytes; sv.frames_done = p.run; v.frames_done += p.run; skippedN++; if (job.pull && ad.needsPull) await pullOne(job, sv, p.meta_exists ? [sv.out, metaRel(sv.out)] : [sv.out]); continue }
      let shot = '', version = 0, createDir = true
      const clip = clipOf(s)
      if (review) {
        shot = shotOf(clip, s.dir); sv.shot = shot
        if (job.versions.has(shot)) { version = job.versions.get(shot)!; createDir = false }   // one version per shot per job: another take of the same shot goes into the same v### folder
        else { const taken = [...(await ad.versions(shot).catch(() => [])), ...(vol ? await deps.deliverDirs(vol, shot).catch(() => []) : [])]; version = nextVersion(taken) }
      }
      let r: RenderResult | null = null
      for (let attempt = 0; attempt < 5 && !r; attempt++) {
        if (review) { sv.version = versionName(version); sv.out = reviewRel(shot, version, clip, job.codecs[0]) }
        try {
          r = await ad.render(s, { width: v.width, fps: job.fps, frames: p.run, jobId: v.job_id, index: i, signal: ac.signal, probe: p, partial: !p.complete, kind: job.kind, codecs: job.codecs, shot, version, clip, createDir, approvedBy: job.approvedBy, at: iso(), source: ad.id === 'pod' ? `the pod ${v.pod_name} (${v.pod_id})` : 'this PC (local ComfyUI-Shared output)',
            onProgress: (frame, pass) => { const f = Math.min(frame, p.run); v.frames_done += f - (last[pass] ?? 0); last[pass] = f; sv.frames_done = Math.min(sv.frames_total, (sv.frames_done ?? 0) + 0); sv.frames_done = last.reduce((a, b) => a + b, 0); const sec = (deps.now() - job.started) / 1000; v.rate_fps = sec > 0 ? Math.round((v.frames_done / sec) * 10) / 10 : 0 } })
        } catch (e) { if (e instanceof VersionExists && review && createDir) { version++; last = [0, 0]; continue } throw e }   // someone took that version: the next one, never the same
      }
      if (!r) throw new Error('Could not find a free version folder')
      if (review) job.versions.set(shot, version)
      sv.state = 'rendered'; sv.bytes = r.bytes; v.frames_done += p.run * passes - last.reduce((a, b) => a + b, 0); sv.frames_done = sv.frames_total; renderedN++
      if (ad.id === 'pod' && vol) void deps.emit(vol, review ? `output/deliver/${shot}/${versionName(version)}/` : `output/${PROXIES}/${s.dir ? `${s.dir}/` : ''}`, r.bytes).catch(() => undefined)   // one journal batch event per sequence, best effort
      if (ad.needsPull && job.pull) await pullOne(job, sv, r.files)
      else if (!ad.needsPull) sv.state = 'done'   // a local render has no pull: rendered, then done
    } catch (e) { sv.state = 'failed'; sv.error = (e as Error).message; failedN++ }
  }
  v.current = ''
  v.state = ac.signal.aborted ? 'cancelled' : (failedN || incompleteN) && !renderedN && !skippedN ? 'failed' : 'done'
  const used = [...new Set(v.sequences.map((s) => s.where))].join('+')
  v.summary = `${job.kind}: ${renderedN} rendered, ${skippedN} already there, ${incompleteN} incomplete, ${failedN} failed (${used}); ${v.pulled_files} file${v.pulled_files === 1 ? '' : 's'} pulled (${v.pulled_bytes} bytes), ${v.width === 'source' ? 'source size' : `width ${v.width}`}${review ? `; approved by ${job.approvedBy}` : ''}`
  const bad = v.sequences.find((s) => (s.state === 'failed' && s.error !== 'cancelled') || s.state === 'incomplete'); if (bad) v.error = bad.error
  end(job)
}

/** Pull a finished proxy (and its sidecar; a review's whole version folder) to this PC with the existing sync: exactly those paths, so they land at the same relative path under the mapped ComfyUI-Shared. */
async function pullOne(job: Job, sv: SeqView, paths: string[]): Promise<void> {
  const v = job.view; v.state = 'pulling'
  try {
    const r = await deps.pull({ pod_id: v.pod_id, direction: 'pull', paths, ...(sv.bytes && paths.length === 1 ? { path_sizes: { [sv.out]: sv.bytes } } : {}), existing: 'size', trigger: 'render:pull' }, job.abort.signal)
    if (r.failed) throw new Error('The pull of the proxy failed')
    sv.state = 'pulled'; v.pulled_files++; v.pulled_bytes += sv.bytes
  } finally { if (v.state === 'pulling') v.state = 'rendering' }
}

function end(job: Job): void {
  const v = job.view; v.finished_at = iso()
  jobs.delete(v.job_id); finished.unshift(copy(v)); finished.length = Math.min(finished.length, KEEP_JOBS)
  const used = [...new Set(v.sequences.map((s) => s.where))].join('+'), shots = [...new Set(v.sequences.map((s) => s.shot).filter(Boolean))], vers = v.sequences.map((s) => s.version).filter(Boolean)
  history.record({ kind: 'job', job: 'render', state: v.state === 'cancelled' ? 'cancelled' : v.state === 'failed' ? 'failed' : 'done', started_at: v.started_at, what: `render ${v.kind} ${v.sequences.length} sequence${v.sequences.length === 1 ? '' : 's'} on ${v.pod_name} (${used})`, ...(v.pod_id ? { pod_id: v.pod_id, pod_name: v.pod_name } : {}), files: v.pulled_files || v.sequences.filter((s) => s.state === 'rendered' || s.state === 'done').length, bytes: v.sequences.reduce((a, s) => a + s.bytes, 0),
    detail: `${v.summary}${shots.length ? `; shot ${shots.join(', ')} ${vers.join(', ')}` : ''}${v.kind === 'review' ? `; codecs ${v.codecs.join(', ')}` : ''}`, ...(v.approved_by ? { approved_by: v.approved_by } : {}), ...(v.error ? { error: v.error } : {}) })
  void persist()
}
/** Forget everything in memory (tests). */
export function reset(): void { jobs.clear(); finished = []; chain.clear(); cache.clear(); forgetFfmpeg(); setDeps(null) }
void load()
