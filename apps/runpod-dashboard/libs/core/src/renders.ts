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
import { stat as fsStat, access, appendFile, mkdir, statfs, open, readFile, readdir, realpath, lstat, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { dirname, join, resolve, sep } from 'node:path'
import { CoreError, bad } from './errors.js'
import * as changes from './changes.js'
import * as history from './history.js'
import * as jobsregistry from './jobsregistry.js'
import * as failures from './failures.js'
import * as journal from './journal.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import * as podnames from './podnames.js'
import * as podpull from './podpull.js'
import * as autopublish from './autopublish.js'
import * as publish from './publish.js'
import { mirrorDir, rendersFile } from './paths.js'
import * as rp from './runpod.js'
import * as sync from './sync.js'
import * as syncrun from './syncrun.js'
import * as edl from './edl.js'
import * as tunnelj from './tunnel.js'

export const WIDTHS = [960, 1280, 1920] as const
/** A width: a downscale, or `source`, the frames' native size (3840x2160 for the IMAX frames), no scaling. */
/** `tunnel` is the Tunnel preset (1920x1080 H.264, tagged Rec.709): it is named like `source` (`<clip>.mp4`, no width suffix); only a preset sets it, never a request. */
export type Width = 'source' | 'tunnel' | 960 | 1280 | 1920
const named = (w: Width): boolean => w === 'source' || w === 'tunnel'
export const PROXIES = '.proxies'
export const MAX_SEQUENCES = 200, KEEP_JOBS = 20, LISTING_MS = 60_000

export interface Sequence { /** the start timecode of a Tunnel proxy, HH:MM:SS:FF non-drop (else the DPX header's, else the EDL's source-in; never a default) */ start_timecode?: string; /** what the DPX frames are, for the Tunnel proxy's converted Rec.709 view (no default: chosen per sequence) */ colour_in?: tunnelj.ColourIn; /** the clip name outputs carry (the EDL's), default the frames' stem; never used for the frames themselves */ clip_name?: string; dir: string; name: string; first: number; last: number; frames: number; pad: number; fps?: number }
export type Where = 'auto' | 'pod' | 'local'
export interface Range { from: number; to: number }
export interface PlannedSequence extends Omit<Sequence, 'start_timecode'> { /** where the colour used for this sequence came from when nobody stated it for the run (configuration format or a guess), and the assumption of a guess */ colour_source?: 'configuration' | 'guess' | 'ocio-record'; colour_assumption?: string; /** ADR-048 'The OCIO record': what the writer ComfyUI-OCIO recorded next to the sequence, and that the DPX header says something else */ ocio?: OcioInfo; header_disagrees?: boolean; /** what the DPX header says about the transfer, reported next to a stated colour (policy/colour.md) */ header_transfer?: string | null; /** the start timecode this sequence would carry (field, DPX header, EDL), null when none: it is flagged */ start_timecode?: string | null; timecode_source?: tunnelj.TimecodeSource | null; /** ADR-050 (EDL): what the plan says about this sequence for the Tunnel preset and the return */ flags?: tunnelj.Flag[]; blocked?: boolean; expected_frames?: number | null; edl_element?: tunnelj.EdlRow | null; edl_match?: tunnelj.Assessment['edl_match']; edl_candidates?: string[]; suggested_colour?: tunnelj.ColourIn | null; /** whether this run would skip it (with the given skip_existing): 'already rendered' (a proxy), 'already has review vNNN', else null */ skip?: string | null; /** ADR-048 "Colour details in the plan": the first frame's DPX header, decoded; null when it could not be read */ colour?: ColourDetails | null; clip_name: string; source?: { width: number; height: number; bits: number } | null; estimate?: { frames: number; note: string; output_gb: number }; colour_refusal?: string | null; shot?: string; next_version?: number; out: string; exists_remote: boolean; exists_local: boolean; gaps: number; where: 'pod' | 'local'; complete: boolean; missing: Range[]; partial: boolean }
export type SeqState = 'waiting' | 'rendering' | 'rendered' | 'pulled' | 'done' | 'failed' | 'skipped' | 'incomplete'
export interface SeqView { /** the OCIO record this sequence's colour came from (ComfyUI-OCIO), and whether the DPX header disagrees with it */ colour_source?: 'ocio-record'; ocio?: OcioInfo; header_disagrees?: boolean; /** for a failed or incomplete sequence: stage, node, message, recovery, retryable in words (never just the raw error) */ failure?: failures.Explained; /** the flags that refused it, or warned (Tunnel preset) */ flags?: tunnelj.Flag[]; /** where its start timecode came from */ timecode_source?: tunnelj.TimecodeSource | null; start_timecode?: string | null; /** why a sequence was skipped ('already rendered', 'already has review v002') */ reason?: string; clip_name?: string; outs?: string[]; shot?: string; version?: string; complete?: boolean; partial?: boolean; missing?: Range[]; where: 'pod' | 'local'; dir: string; name: string; state: SeqState; frames_done: number; frames_total: number; out: string; bytes: number; error: string; warning?: string }
export interface JobView {
  /** the request this job started with, so a failed one can be tried again (`retry`); never in status, where `retryable` says it is there */ request?: StartRequest; retryable?: boolean
  /** whether this job copies its renders to this PC (Sync); false: they stay on the volume (and are published from there) */ pull?: boolean
  /** for a failed job: the failure in words (what the MCP shows) */ failure?: failures.Explained
  /** who started it: the window, an MCP tool call (with the client's name), Auto-publish; `external` = another process (the MCP server, a script) owns it */ origin?: jobsregistry.Origin; mcp_client?: string; external?: boolean
  /** the sequences run with an EDL frame-count override (also written to the manifest notes) */ edl_overrides?: { stem: string; frames: number; expected: number }[]
  kind: 'proxy' | 'review'; approved_by: string; codecs: string[]; notes: string[]; /** the preset this job used (`tunnel`), and what it said about colour and timecode */ preset?: 'tunnel'; warnings?: string[]; /** what started the job: a person, or Auto-publish's automatic generation (the Queue lists those apart) */ trigger?: 'manual' | 'auto-publish'
  /** ADR-050: the publish run started for this job when it asked for one (`publish` in the start request) */ publish?: { job_id: string; /** one publish run per rendered sequence, each started as soon as its own files are on this PC */ job_ids?: string[]; state: string; error?: string }
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
/** A start timecode HH:MM:SS:FF, non-drop (a `;` is refused): the frames are below the frame rate. */
export function validateTimecode(v: unknown, fps = 24): string {
  const m = typeof v === 'string' ? /^(\d\d):(\d\d):(\d\d):(\d\d)$/.exec(v.trim()) : null
  if (!m) throw bad('start_timecode is HH:MM:SS:FF (non-drop, with colons), like 00:00:00:00')
  if (Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3]) > 59 || Number(m[4]) >= Math.ceil(fps)) throw bad(`start_timecode ${m[0]} is not a valid time at ${fps} fps (hours 0-23, minutes and seconds 0-59, frames below ${Math.ceil(fps)})`)
  return m[0]
}
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
  const tc = o.start_timecode === undefined || o.start_timecode === null || o.start_timecode === '' ? undefined : validateTimecode(o.start_timecode, o.fps ?? Number(fpsOf(name)))
  const colourIn = tunnelj.validateColourIn(o.colour_in)
  return { ...(tc ? { start_timecode: tc } : {}), ...(colourIn ? { colour_in: colourIn } : {}), ...(clip ? { clip_name: clip } : {}), dir, name, first: o.first!, last: o.last!, frames: o.frames!, pad: o.pad!, ...(o.fps !== undefined ? { fps: o.fps } : {}) }
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
export const proxyRel = (s: Pick<Sequence, 'dir' | 'name' | 'clip_name'>, width: Width, partial = false): string => `output/${PROXIES}/${s.dir ? `${s.dir}/` : ''}${clipOf(s)}${named(width) ? '' : `_${width}`}${partial ? '_partial' : ''}.mp4`
export const metaRel = (rel: string): string => `${rel}.meta.json`

export type Codec = 'h264' | 'prores422hq'
export const CODECS: Codec[] = ['h264', 'prores422hq']
/** Frame-exact timing: a fractional rate is the rational `N000/1001` (23.976 is 24000/1001), never a decimal that drifts. */
export const rationalFps = (f: string): string => { const v = Number(f); if (!Number.isFinite(v) || Number.isInteger(v)) return f; const k = Math.round(v * 1.001); return Math.abs(k / 1.001 - v) < 0.01 ? `${k * 1000}/1001` : f }
/**
 * The ffmpeg command, as an argument array, the same for both adapters. DPX is read as a numbered sequence. `source` width is NOT scaled (only the RGB to YUV matrix is told, BT.709); a number scales with lanczos.
 * quality 'proxy' (default): H.264 veryfast crf 18 for quick playback. quality 'review': H.264 medium crf 14 (`h264`, an .mp4), or ProRes 422 HQ (`prores422hq`, a .mov, 10-bit 4:2:2). No colour transform is applied.
 */
export function ffmpegArgs(s: Sequence, width: Width, o: { fps?: number; outputDir: string; frames?: number; partial?: boolean; final?: string; codec?: Codec; quality?: Kind; timecode?: string | null; dims?: { width: number; height: number } | null; /** the Tunnel proxy: what the DPX is; its picture is CONVERTED to a Rec.709 view (log is only tagged) */ colourIn?: tunnelj.ColourIn | null }): string[] {
  const input = `${o.outputDir}/${s.dir ? `${s.dir}/` : ''}${s.name}.%0${s.pad}d.dpx`, out = `${o.final ?? `${o.outputDir}/${PROXIES}/${s.dir ? `${s.dir}/` : ''}${clipOf(s)}${named(width) ? '' : `_${width}`}${o.partial ? '_partial' : ''}.mp4`}.part`
  const wide = !o.dims || Math.abs(o.dims.width / o.dims.height - 16 / 9) < 0.01   // a 16:9 source goes to exactly 1920x1080, any other keeps its aspect with an even height
  const scale = width === 'tunnel' ? `scale=${wide ? '1920:1080' : '1920:-2'}:flags=lanczos:out_color_matrix=bt709:out_range=tv` : width === 'source' ? 'scale=out_color_matrix=bt709' : `scale=${width}:-2:flags=lanczos:out_color_matrix=bt709`, review = o.quality === 'review'
  const view = o.colourIn ? tunnelj.colourFilters(o.colourIn) : null
  const reviewScale = width === 'tunnel' || width === 'source' ? '' : `scale=${width}:-2:flags=lanczos,`   // a stated colour: resize in the DPX's own encoding, then convert in 16-bit RGB
  const reviewView = view && width !== 'tunnel' ? `${reviewScale}${view.join(',')},scale=out_color_matrix=bt709` : null
  const tunnelVf = view ? `scale=${wide ? '1920:1080' : '1920:-2'}:flags=lanczos,${view.join(',')},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p` : `${scale},format=yuv420p`   // resize in the DPX's own encoding, then convert (P3-D65 to Rec.709) in 16-bit RGB, then the matrix to limited-range YUV
  const codec = width === 'tunnel'
    ? ['-vf', tunnelVf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart']   // bt709 tags; the picture is a converted view for P3-D65, tag only for log; no drawtext, no overlay, ever
    : o.codec === 'prores422hq'
    ? ['-vf', `${reviewView ?? scale},format=yuv422p10le`, '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0', '-colorspace', 'bt709', ...(reviewView ? ['-color_primaries', 'bt709', '-color_trc', 'bt709'] : [])]
    : ['-vf', `${reviewView ?? scale},format=yuv420p`, '-c:v', 'libx264', '-preset', review ? 'medium' : 'veryfast', '-crf', review ? '14' : '18', ...(review ? ['-pix_fmt', 'yuv420p'] : []), '-colorspace', 'bt709', ...(reviewView ? ['-color_primaries', 'bt709', '-color_trc', 'bt709'] : []), '-movflags', '+faststart']
  return ['ffmpeg', '-nostdin', '-y', '-loglevel', 'warning', '-framerate', rationalFps(fpsOf(s.name, o.fps ?? s.fps)), '-start_number', String(s.first), '-i', input, '-frames:v', String(o.frames ?? s.frames), ...codec, ...(o.timecode ? ['-timecode', o.timecode] : []), '-an', '-progress', 'pipe:1', '-f', out.endsWith('.mov.part') ? 'mov' : 'mp4', out]   // the output is a .part file: ffmpeg cannot pick the container from that extension, so it is named
}

// ----- the DPX header and the colour record (shared/governance/policy/colour.md: stated, never guessed) -----

export interface DpxInfo { width: number; height: number; bits: number; packing: number; descriptor: number; transfer: number; colorimetric: number; be: boolean; /** the start timecode HH:MM:SS:FF (HH:MM:SS;FF when the drop-frame bit is set) from the television header, or null when the file has none, or it is unset or invalid */ timecode: string | null; /** the header field `offset to image data` (bytes 4-8); null when it is not plausible (below 1664, or past the file size field) */ data_offset: number | null; /** the film header (from byte 1664) is in the file only when the image data starts at 1920 or later; the television header (from 1920) only at 2048 or later */ has_film_header: boolean; has_tv_header: boolean; /** the frame rate the header states (television 1940, else film 1724), when present and valid */ frame_rate: number | null }
/** The header fields that matter, from the first bytes of a frame (SMPTE 268M, the layout src/utils/dpx.js reads): size @772/776, descriptor @800, transfer @801, colorimetric @802, bits @803, packing @804. null when it is not a DPX header. */
/** The television header's time code (SMPTE 268M, SMPTE 12M packed BCD HHMMSSFF, a U32 at byte 1920 in the file's byte order, and ONLY where the file has a television header). null when it is unset (0 or 0xFFFFFFFF) or not valid: a digit above 9, hours 24 or more, minutes or seconds 60 or more, frames at or above the frame rate (when it is given; else 100). The frames-tens nibble carries flags: bit 6 is drop-frame (the separator becomes `;`), bit 7 the colour-frame flag. Never invented. */
export function bcdTimecode(v: number, fps?: number | null): string | null {
  if (v === 0 || v === 0xffffffff) return null
  const d = Array.from({ length: 8 }, (_, i) => (v >>> (28 - 4 * i)) & 0xf), drop = (d[6] & 4) !== 0
  d[6] &= 3   // the flag bits are not part of the digit
  if (d.some((x) => x > 9)) return null
  const [hh, mm, ss, ff] = [d[0] * 10 + d[1], d[2] * 10 + d[3], d[4] * 10 + d[5], d[6] * 10 + d[7]]
  if (hh > 23 || mm > 59 || ss > 59 || ff >= (fps && fps >= 1 ? Math.ceil(fps) : 100)) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(hh)}:${p(mm)}:${p(ss)}${drop ? ';' : ':'}${p(ff)}`
}
export function parseDpxInfo(buf: Uint8Array): DpxInfo | null {
  if (buf.length < 820) return null
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]); if (magic !== 'SDPX' && magic !== 'XPDS') return null
  const le = magic === 'XPDS', dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // WHERE the image data starts decides which headers exist: a file with its pixels at 1664 has NO film or television header, and the bytes at 1664 and 1920 are PIXELS (a real file from Binc, 2026-11-19)
  const off = dv.getUint32(4, le), size = dv.getUint32(16, le), okOff = off >= 1664 && (size === 0 || size === 0xffffffff || off <= size) ? off : null
  const film = okOff !== null && okOff >= 1920 && buf.length >= 1728, tv = okOff !== null && okOff >= 2048 && buf.length >= 1944
  const rate = (o: number) => { const f = dv.getFloat32(o, le); return Number.isFinite(f) && f >= 1 && f <= 240 ? Math.round(f * 1000) / 1000 : null }
  const frame_rate = (tv ? rate(1940) : null) ?? (film ? rate(1724) : null)
  return { width: dv.getUint32(772, le), height: dv.getUint32(776, le), descriptor: dv.getUint8(800), transfer: dv.getUint8(801), colorimetric: dv.getUint8(802), bits: dv.getUint8(803), packing: dv.getUint16(804, le), be: !le, timecode: tv ? bcdTimecode(dv.getUint32(1920, le), frame_rate) : null, data_offset: okOff, has_film_header: film, has_tv_header: tv, frame_rate }
}
export const TRANSFER_NAMES: Record<number, string> = { 0: 'user defined', 1: 'printing density', 2: 'linear', 3: 'logarithmic', 4: 'unspecified video', 5: 'SMPTE 240M', 6: 'ITU-R 709-4', 7: 'ITU-R 601-5 system B or G', 8: 'ITU-R 601-5 system M', 9: 'NTSC composite video', 10: 'PAL composite video', 11: 'Z linear', 12: 'Z homogeneous', 13: 'ADX' }
/** Transfer characteristics that are not display-referred: printing density (Cineon), linear, logarithmic, Z, ADX. A conversion of these must be stated, never guessed. */
export const NOT_DISPLAY = [1, 2, 3, 11, 12, 13]
const PACKING = ['packed', 'filled (method A)', 'filled (method B)']
/** Why a REVIEW is refused on colour grounds, or null. The viewer applies no transform and neither does the proxy; if the header says the frames are log or linear, a review would look wrong, so it is refused. */
export function colourRefusal(h: DpxInfo | null): string | null {
  if (!h) return "The DPX header of the first frame could not be read, so its colour cannot be stated (shared/governance/policy/colour.md: stated, never guessed). A review video was not made."
  if (NOT_DISPLAY.includes(h.transfer)) return `transfer: ${TRANSFER_NAMES[h.transfer] ?? `unknown (${h.transfer})`} (code ${h.transfer}): the frames say ${TRANSFER_NAMES[h.transfer] ?? `unknown (${h.transfer})`} in their DPX header, not a display-referred encoding. shared/governance/policy/colour.md says a conversion is stated, never guessed, so this app will not make a review video with a guessed one. State the colour of these frames (Generate window: Colour).`
  return null
}
/** The `colour:` lines of DELIVERY.md and the sidecar: the header, and exactly what ffmpeg was told. */
type StatedColour = { conversion: tunnelj.ColourIn; by: string; at: string; guessed?: string; ocio?: OcioStated }
/** The `colour:` lines with Convert To Rec.709 told: converted (the picture is a Rec.709 view, `converted: <colour> -> rec709`) or kept (the frames' signal, only stated, `converted: no`). Not stated: as before. */
export function colourLines(h: DpxInfo | null, codecs: Codec[], stated?: StatedColour, convert = true): string[] {
  const base = colourLinesBase(h, codecs, stated)
  if (!stated) return base
  if (convert) return [...base, `converted: ${stated.conversion} -> rec709`]
  const prores = codecs.includes('prores422hq') ? ', 10-bit 4:2:2 for ProRes' : ''
  return [base[0]!, `colour: STATED by ${stated.by} at ${stated.at}: the frames are ${stated.conversion}${stated.ocio ? ` (OCIO record ${stated.ocio.colorInteropID})` : ''}; NOT converted to Rec.709: the picture keeps the frames' signal and is not a Rec.709 picture; only the RGB to YUV matrix is BT.709${prores}.`, `converted: no (${stated.conversion} kept as it is; Convert To Rec.709 is off)`, "colour: primaries and transfer are not tagged in the file (they are not guessed); the statement above is the record of the signal."]
}
function colourLinesBase(h: DpxInfo | null, codecs: Codec[], stated?: StatedColour): string[] {
  const t = (n: number) => `${TRANSFER_NAMES[n] ?? 'unknown'} (${n})`
  if (stated?.ocio) return [`colour: DPX header: ${h ? `${h.width}x${h.height}, ${h.bits}-bit, transfer ${t(h.transfer)}, colorimetric ${t(h.colorimetric)}` : 'not read'}.`, `colour: OCIO record: stated by the writer ComfyUI-OCIO (colorInteropID ${stated.ocio.colorInteropID}${stated.ocio.colorspace ? `, ${stated.ocio.colorspace}` : ''}): the frames are ${stated.conversion}; ${tunnelj.colourNote(stated.conversion)}; limited range, yuv420p/yuv422p10le, tagged bt709.${stated.ocio.header_disagrees ? ' The DPX header disagrees (it says ' + (h ? (TRANSFER_NAMES[h.transfer] ?? 'unknown') : 'something else') + '); the record was used, not the header.' : ''}`]
  if (stated?.guessed) return [`colour: DPX header: ${h ? `${h.width}x${h.height}, ${h.bits}-bit, transfer ${t(h.transfer)}, colorimetric ${t(h.colorimetric)}` : 'not read'}.`, `colour guessed from the DPX header: ${stated.guessed}. Converted as ${stated.conversion} (${tunnelj.colourNote(stated.conversion)}); nobody stated this colour (render.colour.mode guess).`]
  if (stated) return [`colour: DPX header: ${h ? `${h.width}x${h.height}, ${h.bits}-bit, transfer ${t(h.transfer)}, colorimetric ${t(h.colorimetric)}` : 'not read'}.`, `colour: STATED by ${stated.by} at ${stated.at}: the frames are ${stated.conversion}; ${tunnelj.colourNote(stated.conversion)}; limited range, yuv420p/yuv422p10le, tagged bt709 (policy/colour.md: a conversion is stated, never guessed).`]
  return [`colour: DPX header: ${h ? `${h.width}x${h.height}, ${h.bits}-bit, ${PACKING[h.packing] ?? `packing ${h.packing}`}, descriptor ${h.descriptor}, transfer ${t(h.transfer)}, colorimetric ${t(h.colorimetric)}` : 'not read'}.`,
    'colour: conversion told to ffmpeg: no colour transform applied (the values are passed through as they are); only the RGB to YUV matrix is BT.709' + (codecs.includes('prores422hq') ? ', 10-bit 4:2:2 for ProRes' : '') + '.',
    'colour: primaries and transfer are not tagged in the file (they are not guessed); the values are as served (policy/colour.md; the in-app viewer applies no transform either).']
}

// ----- colour details in the plan (ADR-048): the first frame's header of EVERY sequence, read cheaply -----

export const DESCRIPTOR_NAMES: Record<number, string> = { 1: 'R', 2: 'G', 3: 'B', 4: 'A', 6: 'Y (luma)', 7: 'CbCr', 8: 'Z (depth)', 9: 'composite', 50: 'RGB', 51: 'RGBA', 52: 'ABGR', 100: 'CbYCrY (4:2:2)', 101: 'CbYACrYA (4:2:2:4)', 102: 'CbYCr (4:4:4)', 103: 'CbYCrA (4:4:4:4)' }
export const PACKING_NAMES = ['packed', 'filled A', 'filled B']
const nameOf = (t: Record<number, string> | string[], n: number): string => (t as Record<number, string>)[n] ?? `unknown (${n})`
export interface ColourDetails {
  transfer: number; transfer_name: string; colorimetric: number; colorimetric_name: string; descriptor: number; descriptor_name: string; bits: number; packing: number; packing_name: string; encoding: number; endian: 'big' | 'little'
  width: number; height: number; pixel_aspect?: string; orientation?: number; start_timecode: string | null; /** why there is none (the file has no television header, or it holds no valid code) */ timecode_note?: string; frame_rate_hint: number | null
  /** what the render tells ffmpeg about colour */ conversion: string; verdict: 'ok' | 'refused'; refusal?: string
}
export const CONVERSION_NOTE = 'none: no colour transform applied (the values pass through as they are, a plain scale when resized); only the RGB to YUV matrix is BT.709'
/** The header fields as the plan shows them (SMPTE 268M: orientation @768, size @772/776, descriptor @800, transfer @801, colorimetric @802, bits @803, packing @804, encoding @806, pixel aspect @1628, film frame rate @1724, TV frame rate @1940; the film header (1664) and the television header (1920) exist only when the offset to image data, bytes 4-8, is 1920 or 2048 or more). null when the bytes are not a DPX header. A `review` kind may be refused on colour grounds; the quick proxy never is. */
export function colourDetails(buf: Uint8Array | null | undefined, review: boolean, tunnel = false): ColourDetails | null {
  const h = buf ? parseDpxInfo(buf) : null
  if (!buf || !h) return null
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), le = !h.be
  const u32 = (o: number) => (buf.length >= o + 4 ? dv.getUint32(o, le) : null), f32 = (o: number) => (buf.length >= o + 4 ? dv.getFloat32(o, le) : null)
    const ah = u32(1628), av = u32(1632)
  const refusal = review ? colourRefusal(h) : null
  return {
    transfer: h.transfer, transfer_name: nameOf(TRANSFER_NAMES, h.transfer), colorimetric: h.colorimetric, colorimetric_name: nameOf(TRANSFER_NAMES, h.colorimetric), descriptor: h.descriptor, descriptor_name: nameOf(DESCRIPTOR_NAMES, h.descriptor),
    bits: h.bits, packing: h.packing, packing_name: nameOf(PACKING_NAMES, h.packing), encoding: dv.getUint16(806, le), endian: h.be ? 'big' : 'little', width: h.width, height: h.height,
    ...(ah && av && ah !== 0xffffffff && av !== 0xffffffff ? { pixel_aspect: `${ah}:${av}` } : {}), ...(dv.getUint16(768, le) !== 0xffff ? { orientation: dv.getUint16(768, le) } : {}),
    start_timecode: h.timecode, frame_rate_hint: h.frame_rate, ...(h.timecode ? {} : { timecode_note: h.data_offset === null ? 'the DPX header gives no valid offset to the image data, so no timecode is read' : h.has_tv_header ? 'the television header has no valid time code' : 'no television header in this file' }), conversion: tunnel ? `Rec.709 view converted from the colour you choose (colour_in), not from this header; header transfer: ${nameOf(TRANSFER_NAMES, h.transfer)}` : CONVERSION_NOTE, verdict: refusal ? 'refused' : 'ok', ...(refusal ? { refusal } : {}),
  }
}
export interface ColourGroup { key: string; count: number; transfer_name: string; colorimetric_name: string; descriptor_name: string; bits: number; packing_name: string; width: number; height: number; verdict: 'ok' | 'refused'; refusal?: string }
export interface ColourSummary { groups: ColourGroup[]; uniform: boolean; /** sequences whose header could not be read */ unreadable: number }
export function summarize2(seqs: { colour?: ColourDetails | null; source?: { width: number; height: number; bits: number } | null }[]): { colour_summary: ColourSummary; source_summary: { groups: { width: number; height: number; bits: number; count: number }[] } } {
  const groups = new Map<string, ColourGroup>(), src = new Map<string, { width: number; height: number; bits: number; count: number }>()
  let unreadable = 0
  for (const x of seqs) {
    const c = x.colour
    if (!c) unreadable++
    else {
      const key = [c.transfer, c.colorimetric, c.descriptor, c.bits, c.packing, c.width, c.height, c.verdict].join('/')
      const g = groups.get(key); if (g) g.count++
      else groups.set(key, { key, count: 1, transfer_name: c.transfer_name, colorimetric_name: c.colorimetric_name, descriptor_name: c.descriptor_name, bits: c.bits, packing_name: c.packing_name, width: c.width, height: c.height, verdict: c.verdict, ...(c.refusal ? { refusal: c.refusal } : {}) })
    }
    if (x.source) { const k = `${x.source.width}x${x.source.height}x${x.source.bits}`; const g = src.get(k); if (g) g.count++; else src.set(k, { ...x.source, count: 1 }) }
  }
  const gs = [...groups.values()].sort((a, b) => b.count - a.count)
  return { colour_summary: { groups: gs, uniform: gs.length <= 1 && unreadable === 0, unreadable }, source_summary: { groups: [...src.values()].sort((a, b) => b.count - a.count) } }
}

export const HDR_BYTES = 2048, HDR_BATCH = 40, HDR_TTL_MS = 10 * 60_000, HDR_TIMEOUT_MS = 20_000
const hdrCache = new Map<string, { at: number; size: number; mtime: number; buf: Uint8Array | null }>()
let hdrLock: Promise<unknown> = Promise.resolve()
export const forgetHeaders = () => { hdrCache.clear() }
const firstFrame = (s: Sequence): string => `${s.dir ? `${s.dir}/` : ''}${s.name}.${String(s.first).padStart(s.pad, '0')}.dpx`
/** The first 2 KB of the first frame of every sequence, best effort (null where it could not be read). On this PC: a stat and a read each, a few at a time. On the pod: ONE ssh call per up to 40 sequences, one call at a time, 20 s each. Cached for 10 minutes (this PC: by path, size and mtime; the pod: by path, since a pod stat would cost the very call it saves). */
export async function headerPass(where: 'pod' | 'local', podId: string, seqs: Sequence[], target?: { host: string; port: number }): Promise<(Uint8Array | null)[]> {
  const out: (Uint8Array | null)[] = seqs.map(() => null), now = deps.now()
  if (where === 'local') {
    const root = deps.localRoot(podId); if (!root) return out
    for (let i = 0; i < seqs.length; i += 8) {
      await Promise.all(seqs.slice(i, i + 8).map(async (s, k) => {
        const path = join(root, 'output', firstFrame(s)), key = `local:${path}`
        try {
          const st = await fsStat(path), hit = hdrCache.get(key)
          if (hit && now - hit.at < HDR_TTL_MS && hit.size === st.size && hit.mtime === st.mtimeMs) { out[i + k] = hit.buf; return }
          const buf = await readHead(path, HDR_BYTES); hdrCache.set(key, { at: now, size: st.size, mtime: st.mtimeMs, buf }); out[i + k] = buf
        } catch { out[i + k] = null }
      }))
    }
    return out
  }
  if (!target) return out
  const outDir = deps.outputDir(podId), need: number[] = []
  seqs.forEach((s, i) => { const hit = hdrCache.get(`pod:${podId}:${firstFrame(s)}`); if (hit && now - hit.at < HDR_TTL_MS) out[i] = hit.buf; else need.push(i) })
  for (let b = 0; b < need.length; b += HDR_BATCH) {
    const batch = need.slice(b, b + HDR_BATCH)
    const script = ['set -u', ...batch.map((i, k) => { const f = q(`${outDir}/${firstFrame(seqs[i])}`); return `[ -r ${f} ] && echo "HDR ${k} $(head -c ${HDR_BYTES} ${f} | base64 -w0)"` }), 'exit 0'].join('\n')
    const run = async () => {
      const ac = new AbortController(), timer = setTimeout(() => ac.abort(), HDR_TIMEOUT_MS)
      try {
        await deps.ssh({ host: target.host, port: target.port, script, signal: ac.signal, onLine: (l) => {
          const m = /^HDR (\d+) ([A-Za-z0-9+/=]+)\s*$/.exec(l); if (!m) return
          const i = batch[Number(m[1])]; if (i === undefined) return
          const buf = new Uint8Array(Buffer.from(m[2], 'base64')); out[i] = buf; hdrCache.set(`pod:${podId}:${firstFrame(seqs[i])}`, { at: now, size: 0, mtime: 0, buf })
        } })
      } catch { /* best effort: the plan goes on without colour */ } finally { clearTimeout(timer) }
    }
    const turn = hdrLock.then(run, run); hdrLock = turn.catch(() => undefined); await turn   // one call at a time, across plans too
  }
  return out
}

const pidFile = (jobId: string, i: number) => `/tmp/render-${jobId.replace(/[^\w-]/g, '_')}-${i}.pid`

/** `find` treats `*`, `?`, `[` and `\` in a -name pattern as globs: a file stem with one of them must match literally. */
const globEscape = (n: string) => n.replace(/[*?[\\]/g, '\\$&')
/** The script that looks at one sequence on the pod: its frame files (size and mtime of each, in one `find`), ffmpeg's version, and the proxy (full and partial name) and its sidecar if they exist. */
export function probeScript(s: Sequence, width: Width, outputDir: string): string {
  const dir = `${outputDir}/${s.dir}`.replace(/\/$/, ''), base = `${outputDir}/${PROXIES}/${s.dir ? `${s.dir}/` : ''}${clipOf(s)}${named(width) ? '' : `_${width}`}`
  const st = (tag: string, f: string, fmt: string) => `echo "${tag} $(stat -c ${fmt} ${q(f)} 2>/dev/null || echo 0)"`
  return ['set -u', `echo "FFV $(ffmpeg -version 2>&1 | head -1)"`, st('OUTM', `${base}.mp4`, '%Y'), st('OUTS', `${base}.mp4`, '%s'), st('OMETS', `${base}.mp4.meta.json`, '%s'),
    st('POUTM', `${base}_partial.mp4`, '%Y'), st('POUTS', `${base}_partial.mp4`, '%s'), st('PMETS', `${base}_partial.mp4.meta.json`, '%s'),
    `cd ${q(dir)} 2>/dev/null || { echo PROBE-NODIR; exit 0; }`, `echo "HDR $(od -An -tx1 -v -N 2048 ${q(`${s.name}.${String(s.first).padStart(s.pad, '0')}.dpx`)} 2>/dev/null | tr -d ' \n')"`, `echo "FFP $(command -v ffprobe >/dev/null 2>&1 && echo 1 || echo 0)"`, `find . -maxdepth 1 -type f -name ${q(`${globEscape(s.name)}.*.dpx`)} -printf 'F %s %T@ %f\\n'`, 'echo PROBE-DONE', ''].join('\n')
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
  return { ...(o.extra ?? {}), kind: o.kind ?? 'proxy', source_dir: s.dir, name: s.name, first: s.first, last: s.last, frames: o.probe.run, complete: o.probe.complete, partial: o.partial, fps: Number(fpsOf(s.name, o.fps ?? s.fps)), width: o.width === 'tunnel' ? 1920 : h && o.width === 'source' ? h.width : o.width, height: o.width === 'tunnel' ? (h && Math.abs(h.width / h.height - 16 / 9) > 0.01 ? Math.round((1920 * h.height) / h.width / 2) * 2 : 1080) : h && o.width === 'source' ? h.height : null, width_setting: o.width, adapter: o.adapter,
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
    `sed -i ${passes.map((_p, k) => `-e "s/@@SHA256_${k}@@/$SHA_${k}/g" -e "s/@@BYTES_${k}@@/$SZ_${k}/g" -e "s/@@FRAMES_${k}@@/$N_${k}/g" -e "s/@@RATE_${k}@@/\${RATE_${k}:-0}/g"`).join(' ')} ${q(e.path + '.tmp')} && ${e.append ? `cat ${q(e.path + '.tmp')} >> ${q(e.path)} && rm -f ${q(e.path + '.tmp')}` : `mv ${q(e.path + '.tmp')} ${q(e.path)}`}`]
  // a failed review must not leave an EMPTY version folder behind (it would eat the number: v001 and v002 were failed attempts): rmdir removes it only when it is empty
  const rmv = o.versionDir && o.createDir !== false ? `rmdir ${q(o.versionDir)} 2>/dev/null; ` : ''
  const pass = (p: Pass, k: number): string[] => {
    const part = p.args[p.args.length - 1], out = outs[k]
    return [`echo "PASS ${k}"`, `T_${k}=$(date +%s)`, `${o.timeout ? `timeout ${o.timeout} ` : ''}nice -n 10 ${p.args.map(q).join(' ')} &`, `echo $! > ${q(pid)}`, 'wait $!', 'rc=$?', `rm -f ${q(pid)}`,
      `if [ $rc -ne 0 ]; then rm -f ${q(part)}; ${rmv}echo "RENDER-EXIT $rc"; exit 0; fi`,
      ...(p.verify !== null ? [`N_${k}=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 -f ${p.fmt} -i ${q(part)} 2>/dev/null | head -1)`,
        `if [ "$N_${k}" != "${p.verify}" ]; then rm -f ${q(part)}; ${rmv}echo "RENDER-COUNT $N_${k} ${p.verify}"; exit 0; fi`] : [`N_${k}=${p.verify ?? 0}`]),
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
  /** A small text file of the volume's output folder (path relative to output/), at most 256 KB, null when absent or unreadable; the OCIO record's last resort. Optional: absent means the volume is not asked. */
  readText?(volumeId: string, rel: string): Promise<string | null>
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
  readText: async (vol, rel) => { try { return vol ? await publish.volumeReadText(rel, OCIO_MAX_BYTES) : null } catch { return null } },
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
export const ALL_DONE = 'Everything in this scope is already rendered: untick Skip existing to render again'
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
export function deliveryMd(o: { clip: string; shot: string; version: number; s: Sequence; width: Width; fps: number; probe: Probe; adapter: 'pod' | 'local'; source: string; ffv: string; passes: string[][]; codecs: Codec[]; approvedBy: string; at: string; stated?: { conversion: tunnelj.ColourIn; by: string; at: string; guessed?: string; ocio?: OcioStated }; /** Convert To Rec.709 (default true: the older behaviour of a stated colour) */ convert?: boolean }): string {
  const frames = o.s.last - o.s.first + 1, dur = Math.round((frames / o.fps) * 1000) / 1000, h = o.probe.header
  const size = o.width === 'source' ? (h ? `the source resolution ${h.width}x${h.height}` : 'the source resolution') : `${o.width} px wide`
  return [`# ${o.shot} ${versionName(o.version)}: review video`, '', DELIVERY_NOTE, '',
    '## What changed', `- A new version: \`${versionName(o.version)}\` of the stitched review video for ${o.shot}. Nothing was overwritten, moved or deleted.`,
    `- Clip name: \`${o.clip}\` (the EDL's clip name, so a conform relinks).${o.clip !== o.s.name ? ` It differs from the frames' stem \`${o.s.name}\`; the frames keep their served names.` : ''}`,
    ...o.codecs.map((c, k) => `- File: \`${reviewFile(o.clip, c)}\` (${CODEC_NAME[c]}), with its \`.meta.json\` beside it.${k === 0 ? '' : ' A companion.'}`),
    ...(o.codecs.includes('prores422hq') ? [`- ${PRORES_NOTE}`] : []),
    `- Source sequence: \`${o.s.name}\` in \`output/${o.s.dir}\`, frames ${o.s.first} to ${o.s.last} (${frames} frames), served names and numbers unchanged (the frames were only read).`,
    `- Spec is not set in deliverables.csv; rendered at ${size}, ${o.codecs.map((c) => (c === 'h264' ? 'H.264' : 'ProRes 422 HQ')).join(' and ')}, ${o.fps} fps (review of the full sequence).`,
    `- Start timecode: ${h?.timecode ? `${h.timecode}, read from the DPX television header (SMPTE 268M, byte 1920) and embedded (-timecode)` : `no timecode in the DPX header${h && !h.has_tv_header ? ' (the file has no television header)' : ''}; none embedded (never invented)`}.`,
    `- Tool: ${o.ffv || 'ffmpeg'} (${o.adapter === 'pod' ? 'on the pod' : 'on this PC'}); frames read from ${o.source}.`, '',
    '## What was measured', ...o.codecs.map((c, k) => `- ${reviewFile(o.clip, c)}: decoded frame count (ffprobe -count_frames) @@FRAMES_${k}@@ of ${frames} expected (a mismatch fails the render); ${'@@BYTES_' + k + '@@'} bytes; sha256 @@SHA256_${k}@@`),
    `- Measured encode rate: ${o.codecs.map((c, k) => `${c} @@RATE_${k}@@ frames per second`).join(', ')}.`,
    `- Frames rendered: ${o.probe.run} of ${frames} expected; frame numbers contiguous from ${o.s.first} to ${o.s.last}: ${o.probe.complete ? 'verified' : 'NOT complete'}.`,
    `- Source files named like the sequence that do not fit its pattern: ${o.probe.odd}; frames of an unusual size: ${o.probe.size_odd}.`, `- Duration: ${dur} s (${frames} frames at ${o.fps} fps; frame-exact timing, no drops or duplicates).`, '',
    '## Colour', ...colourLines(h, o.codecs, o.stated, o.convert !== false).map((l) => `- ${l}`), '',
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

/** A request-level `colour_in` (a person's stated colour) applies to every sequence that has none of its own. */
const withColour = (seqs: Sequence[], v: unknown): Sequence[] => { const c = tunnelj.validateColourIn(v); return c ? seqs.map((s) => (s.colour_in ? s : { ...s, colour_in: c })) : seqs }
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
/** The preset of a run: the request's, else the configuration's. `tunnel` makes it a quick H.264 proxy at 1920x1080, tagged Rec.709, named like the clip. */
const presetOf = (p: unknown, st: RenderSettings): 'none' | 'tunnel' => { if (p === undefined || p === null || p === '') return st.preset ?? 'none'; if (p !== 'none' && p !== 'tunnel') throw bad('preset is none or tunnel'); return p }
/** Convert To Rec.709: the request's, else the configuration's (default off). The Tunnel preset is always a converted Rec.709 view. */
export const rec709Of = (v: unknown, st: RenderSettings, tunnel = false): boolean => { if (tunnel) return true; if (v === undefined || v === null || v === '') return st.rec709 !== false; if (typeof v !== 'boolean') throw bad('rec709 is true or false'); return v }
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

export interface PlanRequest { /** Convert To Rec.709 for this run (review and proxy videos are converted from the stated colour to a Rec.709 view); omitted: the configuration's render.rec709 (default ON, today's behaviour: converted when the colour is known; off: the frames' signal is kept and only stated). The Tunnel preset always converts. */ rec709?: boolean; /** per run: ask | format | guess overrides render.colour.mode for review and proxy (the Tunnel preset never guesses) */ colour_mode?: ColourMode; /** a stated colour for the frames of every sequence that has none of its own (a person says it; the DPX header is reported next to it) */ colour_in?: tunnelj.ColourIn; /** a sequence stem -> true: run it although its frame count differs from the EDL cut (recorded in the manifest notes); never for not-in-edl */ edl_override?: Record<string, boolean>; /** `tunnel`: the Tunnel proxy (default: the configuration's render.preset) */ preset?: 'none' | 'tunnel'; /** skip what is already done (default true): a proxy newer than its frames, a clip that already has a review version. Per run only, never a stored default. */ skip_existing?: boolean; pod_id?: string; sequences: unknown; width?: unknown; where?: Where; kind?: Kind; codecs?: Codec[]; allow_partial?: boolean; fps?: number }
/** What the pod has to render with (DPX decode and ffmpeg are CPU-bound: the GPU is idle, so a cheap card with many vCPUs is enough), and what the output folder has free. */
export interface PodCpu { cores: number; mem_mb: number; free_gb: number }
export interface PlanResult { /** Convert To Rec.709 as this run will use it */ rec709: boolean; /** the EDL this plan was judged against (edl.status()) */ edl?: edl.EdlStatus; /** quiet notes about the plan: a source that says log or linear under the Tunnel preset (it is tagged Rec.709, never converted) */ warnings: string[]; preset: 'none' | 'tunnel'; pod_cpu?: PodCpu; local_free_gb?: number; estimate: { output_gb: number; note: string }; pod_ok: boolean; reason?: string; adapters: AdapterState[]; where: 'pod' | 'local' | null; kind: Kind; width: Width; codecs: Codec[]; settings: RenderSettings; settings_source: 'pod' | 'default'; notes: string[]; total_frames: number; sequences: PlannedSequence[]; skip_existing: boolean; totals: { to_render: number; skipped: number; blocked?: number }; colour_summary: ColourSummary; source_summary: { groups: { width: number; height: number; bits: number; count: number }[] } }
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

const overrides = (v: unknown): Record<string, boolean> => {
  if (v === undefined || v === null) return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('edl_override maps a sequence stem to true')
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x === true).map(([k]) => [k, true])) as Record<string, boolean>
}
export type ColourMode = 'ask' | 'format' | 'guess' | 'known'
const colourModeOf = (v: unknown, st: RenderSettings): ColourMode => { if (v === undefined || v === null || v === '') return st.colour?.mode ?? 'known'; if (v !== 'ask' && v !== 'format' && v !== 'guess' && v !== 'known') throw bad('colour_mode is ask, format, guess or known'); return v }
export const KNOWN_LINEAR = 'the DPX header says linear but this project\'s frames are Gamma 2.6 P3-D65 (the ComfyUI-OCIO record of every sequence, and the 20 Nov Tunnel PDF): Gamma 2.6 P3-D65 used as the project default; state the colour to override'
export const COLOUR_HOW = 'Set render.colour.mode to format or guess, or pass colour_in'
/** The colour of frames whose header says log, linear or printing density and that no person stated (ADR-048, 'the colour of linear and log frames is a setting'): ask = skip with a warning, format = the configured format, guess = from the header (and said so). */
export function pickColour(mode: ColourMode, set: { format?: string; set_by?: string; set_at?: string }, transfer: number, review: boolean): { colour_in?: tunnelj.ColourIn; by?: string; guessed?: string; skip?: string } {
  const named = `${TRANSFER_NAMES[transfer] ?? transfer} (code ${transfer})`
  if (mode === 'format' && set.format) return { colour_in: set.format as tunnelj.ColourIn, by: 'configuration' }
  // known (the default): what the project already tells us. A linear DPX is P3-D65 (Kyle, 14 Nov: generated shots are P3-D65), so a linear header is converted from linear P3-D65 and the sidecar says it was derived, not stated. Log and printing density are never derived: a person states those (colour.md).
  if (mode === 'known' && transfer === 2) return { colour_in: 'p3-d65-gamma26', by: 'project default', guessed: KNOWN_LINEAR }
  if (mode === 'guess') return transfer === 2 ? { colour_in: 'linear-rec709', by: 'configuration (guess)', guessed: 'linear transfer: Rec.709 primaries assumed, shown with the Rec.709 transfer' } : transfer === 1 ? { colour_in: 'cineon', by: 'configuration (guess)', guessed: 'printing density: the Cineon reference of policy/colour.md (white 685, black 95, gamma 0.6) to display, Rec.709 primaries assumed' } : { colour_in: 'kodak-log', by: 'configuration (guess)', guessed: 'log: no view transform, tagged only (not a viewable picture)' }
  return review ? { skip: `colour not stated (render.colour.mode ${mode}): the DPX header says ${named}. ${COLOUR_HOW}.` } : {}
}

// ----- the OCIO record (ADR-048 "The OCIO record", ADR-050): what the writer says about its own frames -----
/** The colour precedence, strongest first: (1) a person's `colour_in` (per sequence or per run); (2) the colour record ComfyUI-OCIO wrote next to the sequence, `<dir>/<stem>.json`, stated by the writer and never guessed; (3) the configured render.colour.mode (format, ask, guess); (4) `known` (a linear header is linear P3-D65). The DPX header is NOT consulted when a record resolves: on this project the header is wrong (it says linear while the pixels are Gamma 2.6). The Tunnel preset stays strict: a record counts as stated, with none and no statement it never guesses. */
export const OCIO_INTEROP: Record<string, { colour_in: tunnelj.ColourIn; label: string; linear: boolean }> = {
  g26_p3d65_display: { colour_in: 'p3-d65-gamma26', label: 'Gamma 2.6 P3-D65', linear: false },
  srgb_p3d65_display: { colour_in: 'p3-d65-srgb', label: 'sRGB P3-D65', linear: false },
  g22_p3d65_display: { colour_in: 'p3-d65-gamma22', label: 'Gamma 2.2 P3-D65', linear: false },
  lin_p3d65_scene: { colour_in: 'linear-p3-d65', label: 'Linear P3-D65', linear: true },
  lin_rec709_scene: { colour_in: 'linear-rec709', label: 'Linear Rec.709', linear: true },
}
export const OCIO_MAX_BYTES = 256 * 1024
/** What a usable record says: the converter's colour id, the writer's own words, and the friendly label the window shows. */
export interface OcioStated { colorInteropID: string; colorspace: string | null; gamut: string | null; header_disagrees?: boolean }
export interface OcioInfo extends OcioStated { colour_in: tunnelj.ColourIn; label: string }
/** Parse a record; null (never a throw) when it is not JSON, has no colorInteropID or names one this converter does not know (never guessed). */
export function parseOcioRecord(text: string | null | undefined): OcioInfo | null {
  try {
    if (!text || Buffer.byteLength(text) > OCIO_MAX_BYTES) return null
    const j = JSON.parse(text), a = j && typeof j === 'object' ? (j as { attributes?: Record<string, unknown> }).attributes : null
    const id = a && typeof a === 'object' ? a.colorInteropID : null
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(OCIO_INTEROP, id)) return null
    const m = OCIO_INTEROP[id], str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return { colour_in: m.colour_in, label: m.label, colorInteropID: id, colorspace: str(a!['com.ocio.colorspace']), gamut: str(a!['com.ocio.gamut']) }
  } catch { return null }
}
/** Does the DPX header contradict the record? A linear record with a header that is not linear, a display record with a header that says linear, log or density. */
export const headerDisagrees = (rec: OcioInfo, h: DpxInfo | null): boolean => !!h && (OCIO_INTEROP[rec.colorInteropID].linear ? h.transfer !== 2 : NOT_DISPLAY.includes(h.transfer))
const recordRel = (s: Sequence) => `${s.dir ? `${s.dir}/` : ''}${s.name}.json`
/** The record of every sequence, best effort (null: none, unreadable, unknown id). Where the frames are (this PC: fs; the pod: one ssh per 40, `base64` through `tr`), then the volume (S3) when that found nothing. At most 256 KB each; never throws. */
export async function recordPass(where: 'pod' | 'local' | null, podId: string, seqs: Sequence[], target?: { host: string; port: number }): Promise<(OcioInfo | null)[]> {
  const text: (string | null)[] = seqs.map(() => null)
  try {
    if (where === 'local') {
      const root = deps.localRoot(podId)
      if (root) await Promise.all(seqs.map(async (s, i) => { try { const f = join(root, 'output', recordRel(s)); if ((await fsStat(f)).size <= OCIO_MAX_BYTES) text[i] = await readFile(f, 'utf8') } catch { /* none */ } }))
    } else if (where === 'pod' && target) {
      const outDir = deps.outputDir(podId)
      for (let b = 0; b < seqs.length; b += HDR_BATCH) {
        const batch = seqs.slice(b, b + HDR_BATCH)
        const script = ['set -u', ...batch.map((s, k) => { const f = q(`${outDir}/${recordRel(s)}`); return `[ -r ${f} ] && [ "$(wc -c < ${f})" -le ${OCIO_MAX_BYTES} ] && echo "REC ${k} $(base64 < ${f} | tr -d '\\n')"` }), 'exit 0'].join('\n')
        const run = async () => {
          const ac = new AbortController(), timer = setTimeout(() => ac.abort(), HDR_TIMEOUT_MS)
          try { await deps.ssh({ host: target.host, port: target.port, script, signal: ac.signal, onLine: (l) => { const m = /^REC (\d+) ([A-Za-z0-9+/=]+)\s*$/.exec(l); if (m && batch[Number(m[1])]) text[b + Number(m[1])] = Buffer.from(m[2], 'base64').toString('utf8') } }) } catch { /* best effort */ } finally { clearTimeout(timer) }
        }
        const turn = hdrLock.then(run, run); hdrLock = turn.catch(() => undefined); await turn
      }
    }
    const vol = podId ? deps.volumeId(podId) : ''
    if (deps.readText) await Promise.all(seqs.map(async (s, i) => { if (text[i] === null) { try { text[i] = await deps.readText!(vol, recordRel(s)) } catch { /* none */ } } }))
  } catch { /* never throws */ }
  return text.map(parseOcioRecord)
}
/** `recordPass` for the sequences nobody stated a colour for (a person's statement is never second-guessed, so its record is not even read); aligned with `seqs`. */
async function recordsOf(where: 'pod' | 'local' | null, podId: string, seqs: Sequence[], target?: { host: string; port: number }): Promise<(OcioInfo | null)[]> {
  const idx = seqs.flatMap((s, i) => (s.colour_in ? [] : [i])), got = idx.length ? await recordPass(where, podId, idx.map((i) => seqs[i]), target) : [], out: (OcioInfo | null)[] = seqs.map(() => null)
  idx.forEach((i, k) => { out[i] = got[k] })
  return out
}
/** The sequence as the colour decision sees it: a person's colour_in, else the OCIO record's, else (Tunnel, mode format) the configured one. */
const withRecord = (s: Sequence, rec: OcioInfo | null | undefined, configured?: tunnelj.ColourIn): Sequence => (s.colour_in ? s : rec ? { ...s, colour_in: rec.colour_in } : configured ? { ...s, colour_in: configured } : s)
const headerFlag = (rec: OcioInfo, h: DpxInfo | null): tunnelj.Flag => ({ code: 'header-disagrees', level: 'info', message: `the DPX header says ${h ? (TRANSFER_NAMES[h.transfer] ?? `code ${h.transfer}`) : 'something else'}; the colour record of ComfyUI-OCIO says ${rec.label} (${rec.colorInteropID}): the record was used, not the header` })
const ocioView = (rec: OcioInfo, dis: boolean): OcioInfo => ({ ...rec, ...(dis ? { header_disagrees: true } : {}) })
/** One sequence judged against the EDL (ADR-050): the Tunnel preset needs a start timecode, a chosen colour and (with the EDL) a matching frame count; otherwise only a quiet note. */
const assessSeq = (s: Sequence, headerTc: string | null, tunnel: boolean, ov: Record<string, boolean>): tunnelj.Assessment =>
  tunnelj.assess({ name: s.name, ...(s.clip_name ? { clip_name: s.clip_name } : {}), frames: s.frames, ...(s.start_timecode ? { start_timecode: s.start_timecode } : {}), header_tc: headerTc, colour_in: s.colour_in ?? null, override: !!ov[s.name] || !!ov[clipOf(s)], needColour: tunnel, strict: tunnel })
const asmFields = (a: tunnelj.Assessment) => ({ flags: a.flags, blocked: a.blocked, expected_frames: a.expected_frames, edl_element: a.edl_element, edl_match: a.edl_match, ...(a.candidates ? { edl_candidates: a.candidates } : {}), start_timecode: a.start_timecode, timecode_source: a.timecode_source, suggested_colour: a.suggested_colour })

export async function plan(o: PlanRequest): Promise<PlanResult> {
  await edl.ensure()
  const ov = overrides(o.edl_override)
  const st = effectiveSettings(o.pod_id), cmode = colourModeOf(o.colour_mode, st), preset = presetOf(o.preset, st), tunnel = preset === 'tunnel', kind: Kind = tunnel ? 'proxy' : kindOf(o.kind, st.kind), configured = (tunnel && cmode === 'format' ? st.colour?.format : undefined) as tunnelj.ColourIn | undefined, seqs = withColour(clean(o.sequences), o.colour_in), width: Width = tunnel ? 'tunnel' : widthFor(kind, o.width, st), want = whereOf(o.where, st.where), codecs = kind === 'review' ? codecsOf(o.codecs, st.codecs) : ['h264' as Codec]
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
  // one lookup of the existing review versions per SHOT, not per sequence: 46 sequences of a few shots no longer make 46 slow round trips to the pod and to S3
  const verCache = new Map<string, Promise<string[]>>()
  const versionsOf = (shot: string): Promise<string[]> => { let p = verCache.get(shot); if (!p) { p = (async () => [...(ad ? await ad.versions(shot).catch(() => []) : []), ...(vol ? await deps.deliverDirs(vol, shot).catch(() => []) : [])])(); verCache.set(shot, p) } return p }
  const heads = ad && chosen ? await headerPass(chosen, o.pod_id ?? '', seqs, podTarget) : seqs.map(() => null)
  const recs = await recordsOf(chosen, o.pod_id ?? '', seqs, podTarget)   // ADR-048: what ComfyUI-OCIO recorded next to each sequence
  const skipExisting = (o.skip_existing ?? st.skip_existing) !== false, clipMemo = new Map<string, Promise<{ version: string; clip: string }[]>>()
  for (const [idx, s] of seqs.entries()) {
    const file = `${clipOf(s)}${named(width) ? '' : `_${width}`}.mp4`
    const remote = vol ? ((await listed(vol, s.dir).catch(() => null))?.some((r) => r.name === file) ?? false) : false
    let probe: Probe | null = null; if (ad && seqs.length <= 30) probe = await ad.plan(s, width).catch(() => null)
    const complete = probe ? probe.complete : s.frames === s.last - s.first + 1, partial = !!o.allow_partial && !complete, h = probe?.header ?? (heads[idx] ? parseDpxInfo(heads[idx]!) : null), colour0 = colourDetails(heads[idx], kind === 'review', tunnel)
    const rec = recs[idx], dis = !!rec && headerDisagrees(rec, h), se = withRecord(s, rec, configured)
    const colour = rec && colour0 ? { ...colour0, verdict: 'ok' as const, refusal: undefined, conversion: `Rec.709 view converted from the OCIO record (${rec.label}), not from this header; header transfer: ${colour0.transfer_name}` } : colour0   // a record that resolves is not refused on the header's word
    if (colour && !colour.refusal) delete colour.refusal
    const asm = assessSeq(se, h?.timecode ?? null, tunnel, ov)
    if (rec && dis) asm.flags.push(headerFlag(rec, h))
    let colourNote: { colour_in?: tunnelj.ColourIn; by?: string; guessed?: string; skip?: string } = {}
    if (!tunnel && !!h && NOT_DISPLAY.includes(h.transfer) && !s.colour_in && !rec) {   // a WARNING for everyone, never a failed job; the Tunnel preset stays strict
      colourNote = pickColour(cmode, st.colour ?? { mode: 'known' }, h.transfer, kind === 'review')
      if (colourNote.skip) asm.flags.push({ code: 'colour-not-stated', level: 'warn', message: colourNote.skip })
      else if (colourNote.guessed) asm.flags.push({ code: 'colour-guessed', level: 'warn', message: `colour guessed from the DPX header: ${colourNote.guessed}` })
    }
    const base: PlannedSequence = { ...se, ...asmFields(asm), header_transfer: h ? `${TRANSFER_NAMES[h.transfer] ?? 'unknown'} (code ${h.transfer})` : null, ...(rec ? { colour_in: rec.colour_in, colour_source: 'ocio-record' as const, ocio: ocioView(rec, dis), ...(dis ? { header_disagrees: true } : {}) } : colourNote.colour_in ? { colour_in: colourNote.colour_in, colour_source: colourNote.guessed ? 'guess' as const : 'configuration' as const } : {}), ...(colourNote.guessed ? { colour_assumption: colourNote.guessed } : {}), clip_name: clipOf(s), out: proxyRel(s, width, partial), exists_remote: remote, exists_local: root ? await exists(join(root, proxyRel(s, width, partial).slice(`output/${PROXIES}/`.length))) : false, gaps: probe ? probe.gaps : Math.max(0, s.last - s.first + 1 - s.frames), where: chosen ?? 'pod', complete, missing: probe?.missing ?? [], partial,
      source: h ? { width: h.width, height: h.height, bits: h.bits } : null, colour, estimate: { frames: probe ? probe.run : s.frames, note: slow(width), output_gb: outputGb(probe ? probe.run : s.frames, Number(fpsOf(s.name, o.fps ?? s.fps ?? (typeof st.fps === 'number' ? st.fps : undefined))), codecs, kind, width === 'source' ? (h ? (h.width * h.height) / (3840 * 2160) : 1) : width === 'tunnel' ? (1920 / 3840) ** 2 : (width / 3840) ** 2) } }
    if (kind === 'review') { const shot = shotOf(clipOf(s), s.dir), existing = await versionsOf(shot); const v = nextVersion(existing), have = skipExisting ? await reviewVersionsOf(ad, vol, shot, clipOf(s), clipMemo) : []; out.push({ ...base, skip: have.length ? `already has review ${have[have.length - 1]}` : colourNote.skip ? 'colour not stated' : null, shot, next_version: v, out: reviewRel(shot, v, clipOf(s), codecs[0]), exists_remote: false, exists_local: false, colour_refusal: rec ? null : colourRefusal(h) }) }
    else out.push({ ...base, skip: asm.blocked ? null : skipExisting && (probe ? probe.skip : base.exists_local || base.exists_remote) ? 'already rendered' : null })
  }
  const totalGb = Math.round(out.reduce((a, x) => a + (x.estimate?.output_gb ?? 0), 0) * 10) / 10, fullRes = width === 'source' || width === 1920
  if (pod_cpu && kind === 'review' && fullRes && pod_cpu.cores < 8) notes.push(`This pod has ${pod_cpu.cores} vCPUs: a 4K review will be slow (expect minutes per 100 frames). A pod with more cores or On this PC may be faster.`)
  if (pod_cpu && totalGb > pod_cpu.free_gb) notes.push(`Only ${pod_cpu.free_gb} GB are free on the pod's output volume; about ${totalGb} GB is needed (not refused: free some space or render on this PC).`)
  if (localFreeB !== null && totalGb > localFreeB / 1e9) notes.push(`Only ${Math.round(localFreeB / 1e8) / 10} GB are free on this PC; about ${totalGb} GB is needed (not refused).`)
  if (chosen === 'pod' && st.pull && totalGb > GATE_GB) notes.push(`About ${totalGb} GB: a sync of this size asks for approval (Auto sync) or takes a while.`)
  const pod = adapters[0]
  const tunnelWarnings = tunnel ? out.flatMap((x) => (x.colour && x.colour_source !== 'ocio-record' && NOT_DISPLAY.includes(x.colour.transfer) && x.colour_in !== 'kodak-log' ? [`${x.clip_name}: the DPX header says ${x.colour.transfer_name}; the Tunnel proxy is converted from the colour you chose (${x.colour_in ?? 'not set'}), not from the header: check that choice`] : x.colour === null ? [`${x.clip_name}: the DPX header could not be read, so its colour is not stated`] : [])) : []
  return { rec709: rec709Of(o.rec709, st, tunnel), warnings: tunnelWarnings, preset: preset as 'none' | 'tunnel', ...(pod_cpu ? { pod_cpu } : {}), ...(localFreeB !== null ? { local_free_gb: Math.round(localFreeB / 1e8) / 10 } : {}), estimate: { output_gb: totalGb, note: 'A rough guess (ProRes 422 HQ at 4K is about 5.3 GB per minute of picture at 24 fps); the real size shows when it is done.' }, pod_ok: pod.ok, ...(chosen ? {} : { reason: pod.reason ?? adapters[1].reason }), adapters, where: chosen, kind, width, codecs, settings: st, settings_source: (o.pod_id && podconfigs.get(o.pod_id)?.render) ? 'pod' : 'default', notes, total_frames: seqs.reduce((a, s) => a + s.frames, 0), sequences: out, skip_existing: skipExisting, totals: { to_render: out.filter((x) => !x.skip && !x.blocked).length, skipped: out.filter((x) => x.skip).length, ...(out.some((x) => x.blocked) ? { blocked: out.filter((x) => x.blocked).length } : {}) }, edl: edl.status(), ...summarize2(out) }
}

export interface Deliverable { clip_name: string; shot: string; version: string; file: string; files: string[]; exists_local: boolean; exists_remote: boolean; bytes: number; approved_by?: string; rendered_at?: string; local_url: string }
const readMeta = async (p: string): Promise<Record<string, unknown> | null> => { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null } }
const REVIEW_EXT = /\.(mov|mp4)$/i

/** The review versions that already hold this clip, newest last: what the adapter sees (on the pod or on this PC) and what the volume lists. */
async function reviewVersionsOf(ad: RenderAdapter | null, vol: string, shot: string, clip: string, memo: Map<string, Promise<{ version: string; clip: string }[]>>): Promise<string[]> {
  let all = memo.get(shot)
  if (!all) {
    all = (async () => [...(ad ? await ad.deliveredClips(shot).catch(() => []) : []), ...(vol ? (await deps.deliverFiles(vol, shot).catch(() => [])).flatMap((f) => { const m = /^(v\d{3,})\/(.+)\.(?:mov|mp4)$/.exec(f.name); return m ? [{ version: m[1], clip: m[2] }] : [] }) : [])])()
    memo.set(shot, all)
  }
  return [...new Set((await all).filter((x) => x.clip === clip).map((x) => x.version))].sort()
}

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
  /** convert the picture to a Rec.709 view when a colour is stated (the Tunnel preset always does; a review or proxy unless Convert To Rec.709 is off); off: the frames' signal is kept, only stated */ rec709?: boolean
  probe: Probe; partial: boolean; /** a person's stated colour for these frames (review or Tunnel): who, when, and what the DPX header said */ stated?: { by: string; at: string; header_transfer: string | null; guessed?: string; set_by?: string; set_at?: string; ocio?: OcioStated }; kind: Kind; codecs: Codec[]; shot: string; version: number; approvedBy: string; source: string; at: string
  /** the Tunnel preset, and the start timecode it carries with where it came from */ preset?: 'tunnel'; tc?: { value: string | null; source: tunnelj.TimecodeSource | null }; colour_in?: tunnelj.ColourIn | null; /** what the manifest's notes carry (EDL override, low resolution) and the EDL element the frames were matched to */ notes?: string[]; edl?: { element: tunnelj.EdlRow | null; sha256: string | null; expected_frames: number | null }
  /** the clip name the files carry; whether this clip creates the version folder (the first of its shot in the job) or adds to it */ clip: string; createDir: boolean
}
export interface RenderResult { out: string; outs: string[]; bytes: number; files: string[] }
/** A render adapter: `pod` (ffmpeg over SSH on the running pod, then the proxy is pulled) or `local` (ffmpeg on this PC, no pull). Both run the SAME ffmpeg argument arrays. */
export interface RenderAdapter {
  /** Every review file under deliver/<shot>/: which version folder holds which clip */
  deliveredClips(shot: string): Promise<{ version: string; clip: string }[]>
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
  const passes = codecs.map((c, k): Pass => ({ args: ffmpegArgs(s, o.width, { fps: o.fps, outputDir, frames: o.frames, partial: o.partial, final: finals[k], codec: c, quality: o.kind, timecode: o.preset === 'tunnel' ? o.tc?.value : o.probe.header?.timecode, ...(o.colour_in && (o.rec709 || o.preset === 'tunnel') ? { colourIn: o.colour_in } : {}), dims: o.probe.header ? { width: o.probe.header.width, height: o.probe.header.height } : null }), fmt: c === 'prores422hq' ? 'mov' : 'mp4', verify: review || o.preset === 'tunnel' ? o.frames : null }))
  return { passes, rels, finals }
}
/** What a render writes next to its videos: a sidecar per file, and for a review DELIVERY.md. */
function sidecars(s: Sequence, o: RenderOpts, adapter: 'pod' | 'local', passes: Pass[], rels: string[]): { metas: Record<string, unknown>[]; delivery: string | null } {
  const review = isReview(o), fps = Number(fpsOf(s.name, o.fps ?? s.fps)), codecs: Codec[] = review ? o.codecs : ['h264'], h = o.probe.header
  const convert = !!(o.colour_in && (o.rec709 || o.preset === 'tunnel')), statedBlock = o.stated && o.colour_in ? { ...(o.stated.guessed ? { guessed: true, assumption: o.stated.guessed } : {}), ...(o.stated.set_by ? { set_by: o.stated.set_by, set_at: o.stated.set_at } : {}), ...(o.stated.ocio ? { colour_source: 'ocio-record', ocio: { colorInteropID: o.stated.ocio.colorInteropID, colorspace: o.stated.ocio.colorspace, gamut: o.stated.ocio.gamut }, ...(o.stated.ocio.header_disagrees ? { header_disagrees: true } : {}) } : {}), stated_by: o.stated.by, header_transfer: h ? `${TRANSFER_NAMES[h.transfer] ?? 'unknown'} (code ${h.transfer})` : 'not read', conversion: o.colour_in, stated_at: o.stated.at } : null
  const metas = rels.map((rel, k) => buildMeta(s, { width: o.width, fps: o.fps, probe: o.probe, partial: o.partial, adapter, args: passes[k].args, version: o.probe.ffmpeg_version, at: o.at, kind: o.kind, extra: {
    ...(review ? { clip_name: o.clip, frames_stem: s.name, shot: o.shot, version: versionName(o.version), approved_by: o.approvedBy, source: o.source, delivery_note: DELIVERY_NOTE, duration_s: Math.round(((s.last - s.first + 1) / fps) * 1000) / 1000, codec: codecs[k],
      outputs: rels.map((r, j) => ({ file: r.slice(r.lastIndexOf('/') + 1), codec: codecs[j], bytes: `@@BYTES_${j}@@`, sha256: `@@SHA256_${j}@@`, frames_decoded: `@@FRAMES_${j}@@`, render_fps: `@@RATE_${j}@@` })) } : {}),
    ...(o.preset === 'tunnel' ? { preset: 'tunnel', start_timecode: o.tc?.value ?? null, timecode_source: o.tc?.source ?? null, colour_in: o.colour_in ?? null, ...(o.colour_in ? { colour_block: tunnelj.colourBlock(o.colour_in), colour_record: tunnelj.colourNote(o.colour_in) } : {}), header_transfer: h ? (TRANSFER_NAMES[h.transfer] ?? `unknown (${h.transfer})`) : 'not read', ...(o.edl ? { edl: { element: o.edl.element?.clip ?? null, speeds: o.edl.element?.speeds ?? null, expected_frames: o.edl.expected_frames, sha256: o.edl.sha256 } } : {}), ...(o.notes?.length ? { manifest_notes: o.notes } : {}) } : { start_timecode: h?.timecode ?? null, timecode_source: h?.timecode ? 'DPX television header (SMPTE 268M, byte 1920)' : null }), ...(h?.timecode ? {} : { timecode_note: h && !h.has_tv_header ? 'no timecode in the DPX header (the file has no television header)' : 'no timecode in the DPX header' }),
    ...(o.stated && o.colour_in ? { colour_stated: statedBlock } : {}), colour: { header: h, transform: o.colour_in ? (convert ? tunnelj.colourNote(o.colour_in) : `kept: ${o.colour_in} (not converted to Rec.709)`) : 'none', ...(o.colour_in ? { converted: convert ? `${o.colour_in} -> rec709` : 'no', rec709: convert } : {}), lines: colourLines(h, codecs, o.stated && o.colour_in ? { conversion: o.colour_in, by: o.stated.by, at: o.stated.at, ...(o.stated.guessed ? { guessed: o.stated.guessed } : {}), ...(o.stated.ocio ? { ocio: o.stated.ocio } : {}) } : undefined, convert), ...(statedBlock ? statedBlock : {}) }, ffmpeg_passes: passes.map((p) => p.args), notes: codecs.includes('prores422hq') ? [PRORES_NOTE] : [] } }))
  return { metas, delivery: review ? deliveryMd({ clip: o.clip, shot: o.shot, version: o.version, s, width: o.width, fps, probe: o.probe, adapter, source: o.source, ffv: o.probe.ffmpeg_version, passes: passes.map((p) => p.args), codecs, approvedBy: o.approvedBy, at: o.at, ...(o.stated && o.colour_in ? { stated: { conversion: o.colour_in, by: o.stated.by, at: o.stated.at, ...(o.stated.guessed ? { guessed: o.stated.guessed } : {}), ...(o.stated.ocio ? { ocio: o.stated.ocio } : {}) } } : {}), convert }) : null }
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
    async deliveredClips(shot) {
      const t = me.target!, found: { version: string; clip: string }[] = []
      await deps.ssh({ host: t.host, port: t.port, script: `find ${q(`${deps.outputDir(podId!)}/deliver/${shot}`)} -maxdepth 2 -type f \\( -name '*.mov' -o -name '*.mp4' \\) 2>/dev/null; echo`, onLine: (l) => { const m = /\/(v\d{3,})\/([^/]+)\.(?:mov|mp4)$/.exec(l.trim()); if (m) found.push({ version: m[1], clip: m[2] }) }, signal: new AbortController().signal })
      return found
    },
    async versions(shot) {
      const t = me.target!, names: string[] = []
      await deps.ssh({ host: t.host, port: t.port, script: `ls -1 ${q(`${deps.outputDir(podId!)}/deliver/${shot}`)} 2>/dev/null; echo`, onLine: (l) => { if (/^v\d{3,}$/.test(l.trim())) names.push(l.trim()) }, signal: new AbortController().signal })
      return names
    },
    async render(s, o) {
      const t = me.target!, outputDir = deps.outputDir(podId!), review = isReview(o)
      if ((review || o.preset === 'tunnel') && !o.probe.ffprobe) throw new Error('ffprobe is not installed on the pod, so the frame count cannot be verified: not rendered')
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
      const base = join(out, PROXIES, s.dir, `${clipOf(s)}${named(width) ? '' : `_${width}`}`), st = async (p: string) => { try { const x = await stat(p); return { m: Math.floor(x.mtimeMs / 1000), s: x.size } } catch { return { m: 0, s: 0 } } }
      const [o1, m1, o2, m2] = await Promise.all([st(`${base}.mp4`), st(`${base}.mp4.meta.json`), st(`${base}_partial.mp4`), st(`${base}_partial.mp4.meta.json`)])
      const first = mine.find((f) => f.num === s.first), header = first ? parseDpxInfo((await readHead(join(dir, first.n))) ?? new Uint8Array()) : null
      const ff = await ffmpegState()
      return buildProbe(frames, odd, s, { outM: o1.m, outS: o1.s, metS: m1.s, poutM: o2.m, poutS: o2.s, pmetS: m2.s, ffv: ff.version ?? '', header, ffprobe: !!(ff.path && (await deps.findFfprobe(ff.path))) })
    },
    async deliveredClips(shot) {
      const found: { version: string; clip: string }[] = []
      try { for (const v of (await deps.readdir(join(outDir()!, 'deliver', shot))).filter((n) => /^v\d{3,}$/.test(n))) { for (const n of await deps.readdir(join(outDir()!, 'deliver', shot, v)).catch(() => [] as string[])) { const m = /^(.+)\.(?:mov|mp4)$/.exec(n); if (m) found.push({ version: v, clip: m[1] }) } } } catch { /* no deliver folder */ }
      return found
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

interface Job { /** Convert To Rec.709 for this run (a review or proxy is converted from its stated colour only when on) */ rec709: boolean; stopTrack?: () => void; /** Tunnel preset with render.colour.mode format: the configured colour, weaker than an OCIO record */ configured?: tunnelj.ColourIn; colourMode: ColourMode; colourSet: { format?: string; set_by?: string; set_at?: string }; pubIds: string[]; pubDirs: Set<string>; pubErr: string; preset?: 'tunnel'; ov: Record<string, boolean>; pre?: Map<number, Probe | null>; clipMemo: Map<string, Promise<{ version: string; clip: string }[]>>; skipExisting: boolean; publish?: { targets: publish.Target[]; message?: string; round?: string; clip_names?: Record<string, string>; edl_override?: Record<string, boolean> }; versions: Map<string, number>; view: JobView; seqs: Sequence[]; kind: Kind; codecs: Codec[]; approvedBy: string; allowPartial: boolean; pull: boolean; fps?: number; auto: boolean; abort: AbortController; started: number; done: Promise<void> }
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
/** A failed job or sequence in words: where it failed and what to do (`failure`), for the MCP and the Queue. */
const explainJob = (v: JobView): JobView => { for (const s of v.sequences) if ((s.state === 'failed' || s.state === 'incomplete') && s.error && !s.failure) s.failure = failures.explain(s.error, { stage: /frames .*missing|incomplete/i.test(s.error) ? 'encode' : undefined }); if (v.state === 'failed' && v.error && !v.failure) v.failure = failures.explain(v.error); return v }
/** Render jobs another process (the MCP server, a script) is running, as the registry file says: listed with `external: true`. */
const externalViews = (): JobView[] => jobsregistry.externals('render').filter((x) => !jobs.has(x.id)).map((x) => ({ job_id: x.id, kind: 'proxy', approved_by: x.approved_by ?? '', codecs: [], notes: [], pod_id: '', pod_name: 'another process', state: x.interrupted ? 'failed' : (x.state as JobView['state']), started_at: x.started_at, finished_at: x.interrupted ? new Date().toISOString() : '', width: 'source', frames_done: x.progress?.done ?? 0, frames_total: x.progress?.total ?? 0, rate_fps: 0, current: x.label, sequences: [], pulled_files: 0, pulled_bytes: 0, error: x.interrupted ? 'The process that was running this job stopped: it was interrupted' : '', summary: x.label, trigger: (x.trigger === 'auto-publish' ? 'auto-publish' : 'manual'), origin: x.origin, ...(x.mcp_client ? { mcp_client: x.mcp_client } : {}), external: true }) as JobView)
export function status(jobId?: string): { jobs: JobView[] } {
  const all = [...[...jobs.values()].map((j) => j.view), ...externalViews(), ...finished]
  return { jobs: (jobId ? all.filter((v) => v.job_id === jobId) : all).map(copy).map((v) => { const { request, ...rest } = v; return { ...rest, retryable: !!request } as JobView }).map((v) => explainJob(v)).map((v) => { const ids = v.publish?.job_ids?.length ? v.publish.job_ids : v.publish?.job_id ? [v.publish.job_id] : [], pjs = ids.map((i) => publish.status(i).jobs[0]).filter(Boolean), pj = pjs.length ? (pjs.find((x) => x.state === 'failed' || x.state === 'cancelled') ?? pjs.find((x) => !['done', 'done_with_warning'].includes(x.state)) ?? pjs[0]) : undefined; return pj && v.publish ? { ...v, publish: { ...v.publish, state: pj.state, ...(pj.error ? { error: pj.error } : {}) } } : v }) }
}

export interface StartRequest extends PlanRequest { /** what started it: a person ('manual', the default) or Auto-publish's generation */ trigger?: 'manual' | 'auto-publish'; pull?: boolean; approved_by?: string; /** ADR-050: publish the finished files once they are on this PC. Per run only, never a stored default; needs approved_by (also for a proxy). */ publish?: { targets: publish.Target[]; message?: string; /** the BKK return: the round, and sequence stem -> clip name */ round?: string; clip_names?: Record<string, string>; /** a sequence stem -> true: deliver it although its frame count differs from the EDL cut */ edl_override?: Record<string, boolean> } }
export async function start(o: StartRequest): Promise<{ job_id: string }> {
  await edl.ensure()
  const ov = overrides(o.edl_override)
  const st = effectiveSettings(o.pod_id), cmode = colourModeOf(o.colour_mode, st), preset = presetOf(o.preset, st), tunnel = preset === 'tunnel', kind: Kind = tunnel ? 'proxy' : kindOf(o.kind, st.kind), configured = (tunnel && cmode === 'format' ? st.colour?.format : undefined) as tunnelj.ColourIn | undefined, seqs = withColour(clean(o.sequences), o.colour_in), width: Width = tunnel ? 'tunnel' : widthFor(kind, o.width, st), want = whereOf(o.where, st.where), codecs = kind === 'review' ? codecsOf(o.codecs, st.codecs) : ['h264' as Codec]
  const fps = o.fps ?? (typeof st.fps === 'number' ? st.fps : undefined)
  if (kind === 'review') {
    if (!(o.approved_by ?? '').trim()) throw bad(NEEDS_NAME)
    if (o.allow_partial) throw bad('A review video is only made from a complete sequence: allow_partial is not available for kind review')
  }
  if (o.publish) {
    if (!(o.approved_by ?? '').trim()) throw bad('Publishing a render needs the name of who says yes (approved_by), also for a proxy')
    if (!Array.isArray(o.publish.targets) || !o.publish.targets.length || o.publish.targets.some((t) => t !== 's3' && t !== 'slack')) throw bad("publish.targets is a list of 's3' and/or 'slack'")
    const ps = await publish.settings()
    const blockers = [...(o.publish.targets.includes('s3') && !ps.s3.ready ? [`S3 is not configured: ${ps.s3.problem}`] : []), ...(o.publish.targets.includes('slack') && !ps.slack.ready ? [`Slack is not configured: ${ps.slack.problem}`] : [])]
    if (blockers.length) throw bad(`Cannot publish: ${blockers.join('; ')}`)
    if (ps.s3.layout === 'bkk-return' && o.publish.targets.includes('s3')) { publish.validateRound(o.publish.round); publish.validateClipNames(o.publish.clip_names) }   // the BKK return needs its round before anything is rendered
  }
  if (tunnel) {   // ADR-050: a sequence the Tunnel preset cannot take is refused (the others go on); when none can be taken the run is a 400. The timecode may still come from the DPX header, so it is judged at render time.
    let recs0: (OcioInfo | null)[] = seqs.map(() => null)   // a record counts as a stated colour (ADR-050), so it is looked for before a sequence is refused for having none
    if (seqs.some((s) => !s.colour_in)) { try { const w = chooseWhere(want, await adapterStates(o.pod_id)), pa = w === 'pod' ? podAdapter(o.pod_id) : null; if (pa) await pa.check(); recs0 = await recordsOf(w, o.pod_id ?? '', seqs, pa?.target) } catch { /* no record */ } }
    const judged = seqs.map((s, i) => withRecord(s, recs0[i], configured))
    const open = judged.filter((s) => !assessSeq(s, null, true, ov).flags.some((f) => f.level === 'block' && f.code !== 'no-start-timecode'))
    if (!open.length) throw bad(`Refused: ${judged.slice(0, 3).map((s) => `${clipOf(s)}: ${tunnelj.blockReasons(assessSeq(s, null, true, ov))}`).join(' | ')}${seqs.length > 3 ? ` (and ${seqs.length - 3} more)` : ''}`)
  }
  if (want === 'pod' && !o.pod_id) throw bad('Which pod?')
  if (fps !== undefined && !(typeof fps === 'number' && fps >= 1 && fps <= 240)) throw bad('fps is a number from 1 to 240')
  const chosen = chooseWhere(want, await adapterStates(o.pod_id))   // throws with the reason(s)
  // Skip existing (the default): when everything in the scope is already done, say so now instead of starting a job that does nothing. The probes made here are the job's own (run() does not ask the pod twice).
  let pre: Map<number, Probe | null> | undefined
  const skipWanted = (o.skip_existing ?? st.skip_existing) !== false   // the request's own value wins; absent, the configuration's
  if (skipWanted && seqs.length) {
    if (seqs.length <= 30) {
      const ad0 = chosen === 'pod' ? podAdapter(o.pod_id) : localAdapter(o.pod_id ?? ''); await ad0.check(); pre = new Map()
      const vol0 = o.pod_id ? deps.volumeId(o.pod_id) : '', memo = new Map<string, Promise<{ version: string; clip: string }[]>>()
      let done = 0
      for (const [i, s] of seqs.entries()) {
        const pr = await ad0.plan(s, width).catch(() => null); pre.set(i, pr)
        if (kind === 'review') { if (pr && !pr.nodir && (await reviewVersionsOf(ad0, vol0, shotOf(clipOf(s), s.dir), clipOf(s), memo)).length) done++ }
        else if (pr?.skip) done++
      }
      if (done === seqs.length) throw bad(ALL_DONE)
    } else {
      const pl = await plan({ ...o, skip_existing: true }).catch(() => null)
      if (pl && pl.totals.to_render === 0) throw bad(ALL_DONE)
    }
  }
  const podId = o.pod_id ?? '', id = `render-${deps.now().toString(36)}-${(seq++).toString(36)}`
  const view: JobView = { ...(tunnel ? { preset: 'tunnel' as const } : {}), trigger: o.trigger === 'auto-publish' ? 'auto-publish' : 'manual', job_id: id, pull: !!(o.pull ?? st.pull), kind, approved_by: (o.approved_by ?? '').trim(), codecs, notes: [slow(width), ...(codecs.includes('prores422hq') && kind === 'review' ? [PRORES_NOTE] : [])], pod_id: podId, pod_name: podId ? deps.podName(podId) : 'this PC', state: 'queued', started_at: iso(), finished_at: '', width, frames_done: 0,
    frames_total: seqs.reduce((a, s) => a + s.frames, 0) * (kind === 'review' ? codecs.length : 1), rate_fps: 0, current: '',
    sequences: seqs.map((s) => ({ where: chosen, dir: s.dir, name: s.name, clip_name: clipOf(s), state: 'waiting', frames_done: 0, frames_total: s.frames * (kind === 'review' ? codecs.length : 1), out: proxyRel(s, width), bytes: 0, error: '' })), pulled_files: 0, pulled_bytes: 0, error: '', summary: '' }
  const job: Job = { rec709: rec709Of(o.rec709, st, tunnel), ...(configured ? { configured } : {}), colourMode: cmode, colourSet: st.colour ?? { mode: 'known' }, pubIds: [], pubDirs: new Set(), pubErr: '', ...(tunnel ? { preset: 'tunnel' as const } : {}), ov, ...(pre ? { pre } : {}), clipMemo: new Map(), skipExisting: skipWanted, ...(o.publish ? { publish: { targets: [...o.publish.targets], ...(o.publish.message ? { message: o.publish.message } : {}), ...(o.publish.round ? { round: o.publish.round } : {}), ...(o.publish.clip_names ? { clip_names: o.publish.clip_names } : {}), edl_override: { ...ov, ...(o.publish.edl_override ?? {}) } } } : {}), versions: new Map(), view, seqs, kind, codecs, approvedBy: view.approved_by, allowPartial: !!o.allow_partial, pull: o.pull ?? st.pull, fps, auto: want === 'auto', abort: new AbortController(), started: deps.now(), done: Promise.resolve() }
  view.request = { ...o, sequences: seqs }
  jobs.set(id, job)
  { // where it came from, and visible to the other processes while it runs (docs/ADR-050, 'MCP actions are shown in the Queue')
    const who = history.currentOrigin(), origin: jobsregistry.Origin = o.trigger === 'auto-publish' ? 'auto-publish' : who?.source === 'mcp' ? 'mcp' : 'window'
    view.origin = origin; if (origin === 'mcp' && who?.client) view.mcp_client = who.client
    job.stopTrack = jobsregistry.track({ id, kind: 'render', trigger: view.trigger ?? 'manual', origin, ...(view.mcp_client ? { client: view.mcp_client } : {}), label: `render ${kind} ${seqs.length} sequence${seqs.length === 1 ? '' : 's'}`, ...(view.approved_by ? { approved_by: view.approved_by } : {}), started_at: view.started_at, view: () => ({ state: view.state, progress: { done: view.frames_done, total: view.frames_total, unit: 'frames' } }), cancel: () => { try { cancel(id) } catch { /* over */ } } })
    if (origin === 'mcp') history.record({ kind: 'change', area: 'configuration', action: 'started by MCP', what: `render ${kind} ${seqs.map((s) => clipOf(s)).slice(0, 3).join(', ')}${seqs.length > 3 ? ` (and ${seqs.length - 3} more)` : ''}`, detail: `${view.mcp_client ? `client ${view.mcp_client}; ` : ''}${view.approved_by ? `approved by ${view.approved_by}; ` : ''}job ${id}` })
  }
  const key = chosen === 'pod' ? podId : 'local', prev = chain.get(key) ?? Promise.resolve()
  job.done = prev.then(() => run(job)).catch(() => undefined)
  chain.set(key, job.done)
  return { job_id: id }
}

/** Try a failed or cancelled job again: the sequences that did not finish, with the request it started with (what is done is skipped). */
export async function retry(jobId: string): Promise<{ job_id: string }> {
  const v = jobs.get(jobId)?.view ?? finished.find((x) => x.job_id === jobId)
  if (!v) throw new CoreError(404, `No such render job: ${jobId}`)
  if (v.state !== 'failed' && v.state !== 'cancelled') throw bad('Only a failed or cancelled render job can be tried again')
  const req = v.request; if (!req) throw bad('This job was started by an older version of the app and cannot be retried: start it again from Outputs')
  const left = new Set(v.sequences.filter((s) => s.state !== 'done' && s.state !== 'skipped').map((s) => `${s.dir}\0${s.name}`))
  const seqs = (req.sequences as Sequence[]).filter((s) => left.has(`${s.dir}\0${s.name}`))
  if (!seqs.length) throw bad('Every sequence of this job finished: nothing to try again')
  return start({ ...req, sequences: seqs, trigger: 'manual' })
}

export function cancel(jobId: string): JobView {
  const j = jobs.get(jobId); if (!j) { const f = finished.find((v) => v.job_id === jobId); if (f) return copy(f); const ext = externalViews().find((v) => v.job_id === jobId) ?? (jobsregistry.knows(jobId) ? status(jobId).jobs[0] : undefined); if (ext) { void jobsregistry.requestCancel(jobId).catch(() => undefined); return { ...ext, state: 'cancelled' as const } }; throw new CoreError(404, `No such render job: ${jobId}`) }   // a job another process owns: the cancel is a request that process picks up within seconds
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
      let ad = adapters[sv.where], p = (job.pre?.get(i) ?? null) ?? await ad.plan(s, v.width)
      if (job.auto && sv.where === 'pod' && (p.nodir || p.run === 0) && localOk) {   // the pod cannot read it but this PC has it: render it here
        const lp = await adapters.local.plan(s, v.width)
        if (lp.run > 0) { ad = adapters.local; sv.where = 'local'; p = lp }
      }
      if (p.nodir || p.run === 0) throw new Error(ad.id === 'local' ? NO_FRAMES : p.nodir ? `The folder ${s.dir || 'output'} is not on the pod's output folder` : `The first frame (${String(s.first).padStart(s.pad, '0')}) is not on the pod`)
      sv.complete = p.complete; sv.missing = p.missing
      const rec = s.colour_in ? null : (await recordsOf(ad.id, v.pod_id, [s], ad.id === 'pod' ? adapters.pod.target : undefined))[0] ?? null, dis = !!rec && headerDisagrees(rec, p.header), se = withRecord(s, rec, job.configured)
      if (rec) { sv.colour_source = 'ocio-record'; sv.ocio = ocioView(rec, dis); if (dis) sv.header_disagrees = true }
      let asm: tunnelj.Assessment | null = null
      if (job.preset === 'tunnel') {   // ADR-050: no start timecode, no colour, a frame count that differs from the EDL, not in the EDL: this sequence is refused, the others go on
        asm = assessSeq(se, p.header?.timecode ?? null, true, job.ov); if (rec && dis) asm.flags.push(headerFlag(rec, p.header)); sv.flags = asm.flags; sv.start_timecode = asm.start_timecode; sv.timecode_source = asm.timecode_source
        if (asm.blocked) throw new Error(`Refused: ${tunnelj.blockReasons(asm)}`)
        if (asm.overridden) v.edl_overrides = [...(v.edl_overrides ?? []), asm.overridden]
      }
      if (!p.complete) {
        if (!job.allowPartial) { sv.state = 'incomplete'; sv.error = incompleteMessage(p); incompleteN++; continue }   // never the full-length name for an incomplete sequence
        sv.partial = true; sv.out = proxyRel(s, v.width, true)
        sv.warning = `${p.gaps} frame number${p.gaps === 1 ? '' : 's'} missing: rendered the ${p.run} contiguous frames from ${s.first} as a partial`
      }
      if (review && job.skipExisting) {
        const have = await reviewVersionsOf(ad, vol, shotOf(clipOf(s), s.dir), clipOf(s), job.clipMemo)
        if (have.length) { sv.state = 'skipped'; sv.reason = `already has review ${have[have.length - 1]}`; sv.shot = shotOf(clipOf(s), s.dir); sv.frames_done = p.run * passes; v.frames_done += p.run * passes; skippedN++; continue }
      }
      let eff: tunnelj.ColourIn | undefined = s.colour_in ?? rec?.colour_in, how: ReturnType<typeof pickColour> | undefined
      if (!asm && !eff && p.header && NOT_DISPLAY.includes(p.header.transfer)) {   // log, linear or printing density that nobody stated: the colour setting decides (a WARNING, never a failed job)
        how = pickColour(job.colourMode, job.colourSet, p.header.transfer, review)
        if (how.skip) { sv.state = 'skipped'; sv.reason = how.skip; sv.warning = how.skip; sv.flags = [{ code: 'colour-not-stated', level: 'warn', message: how.skip }]; sv.frames_done = p.run * passes; v.frames_done += p.run * passes; skippedN++; continue }
        if (how.colour_in) { eff = how.colour_in; if (how.guessed) v.warnings = [...new Set([...(v.warnings ?? []), `${clipOf(s)}: colour guessed from the DPX header: ${how.guessed}`])] }
      }
      if (review) { const refusal = colourRefusal(p.header); if (refusal && !(eff && (p.header || rec))) throw new Error(refusal) }   // colour.md: stated, never guessed; a person's stated colour_in lets a log or linear sequence through, with the header reported next to it
      if (p.odd || p.size_odd) sv.warning = `${sv.warning ? `${sv.warning}; ` : ''}${p.odd ? `${p.odd} file(s) named like the sequence do not fit its pattern` : ''}${p.odd && p.size_odd ? '; ' : ''}${p.size_odd ? `${p.size_odd} frame(s) have an unusual size` : ''}`
      sv.frames_total = p.run * passes
      let last = [0, 0]
      if (p.skip && !review && job.skipExisting) { sv.state = 'skipped'; sv.reason = 'already rendered'; sv.bytes = p.out_bytes; sv.frames_done = p.run; v.frames_done += p.run; skippedN++; if (job.pull && ad.needsPull) await pullOne(job, sv, p.meta_exists ? [sv.out, metaRel(sv.out)] : [sv.out]); await publishSeq(job, sv, ad.needsPull && !job.pull); continue }
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
          const tc = asm ? { value: asm.start_timecode, source: asm.timecode_source } : undefined
          if (asm && !rec && p.header && NOT_DISPLAY.includes(p.header.transfer) && asm.colour_in !== 'kodak-log') v.warnings = [...new Set([...(v.warnings ?? []), `${clipOf(s)}: the DPX header says ${TRANSFER_NAMES[p.header.transfer] ?? p.header.transfer}; the proxy is converted from the colour you chose (${asm.colour_in}), not from the header`])]
          if (asm?.colour_in === 'kodak-log') v.warnings = [...new Set([...(v.warnings ?? []), `${clipOf(s)}: Kodak log: log, not a viewable picture (tagged Rec.709, no view transform)`])]
          r = await ad.render(s, { rec709: job.rec709, ...(!asm && eff ? { colour_in: eff } : {}), ...(rec ? { stated: { by: 'the OCIO record (stated by the writer ComfyUI-OCIO)', at: iso(), header_transfer: p.header ? `${TRANSFER_NAMES[p.header.transfer] ?? 'unknown'} (code ${p.header.transfer})` : null, ocio: ocioView(rec, dis) } } : {}), ...(!rec && how?.colour_in ? { stated: { by: how.by!, ...(how.guessed ? { guessed: how.guessed } : { set_by: job.colourSet.set_by ?? 'unknown', set_at: job.colourSet.set_at ?? '' }), at: iso(), header_transfer: p.header ? `${TRANSFER_NAMES[p.header.transfer] ?? 'unknown'} (code ${p.header.transfer})` : null } } : {}), ...(!how && !rec && s.colour_in && job.approvedBy ? { stated: { by: job.approvedBy, at: iso(), header_transfer: p.header ? `${TRANSFER_NAMES[p.header.transfer] ?? 'unknown'} (code ${p.header.transfer})` : null } } : {}), ...(asm ? { preset: 'tunnel' as const, tc, colour_in: asm.colour_in, notes: asm.notes, edl: { element: asm.edl_element, expected_frames: asm.expected_frames, sha256: edl.status().sha256 } } : {}), width: v.width, fps: job.fps, frames: p.run, jobId: v.job_id, index: i, signal: ac.signal, probe: p, partial: !p.complete, kind: job.kind, codecs: job.codecs, shot, version, clip, createDir, approvedBy: job.approvedBy, at: iso(), source: ad.id === 'pod' ? `the pod ${v.pod_name} (${v.pod_id})` : 'this PC (local ComfyUI-Shared output)',
            onProgress: (frame, pass) => { const f = Math.min(frame, p.run); v.frames_done += f - (last[pass] ?? 0); last[pass] = f; sv.frames_done = Math.min(sv.frames_total, (sv.frames_done ?? 0) + 0); sv.frames_done = last.reduce((a, b) => a + b, 0); const sec = (deps.now() - job.started) / 1000; v.rate_fps = sec > 0 ? Math.round((v.frames_done / sec) * 10) / 10 : 0 } })
        } catch (e) { if (e instanceof VersionExists && review && createDir) { version++; last = [0, 0]; continue } throw e }   // someone took that version: the next one, never the same
      }
      if (!r) throw new Error('Could not find a free version folder')
      if (review) job.versions.set(shot, version)
      sv.state = 'rendered'; sv.bytes = r.bytes; v.frames_done += p.run * passes - last.reduce((a, b) => a + b, 0); sv.frames_done = sv.frames_total; renderedN++
      if (ad.id === 'pod' && vol) void deps.emit(vol, review ? `output/deliver/${shot}/${versionName(version)}/` : `output/${PROXIES}/${s.dir ? `${s.dir}/` : ''}`, r.bytes).catch(() => undefined)   // one journal batch event per sequence, best effort
      if (ad.needsPull && job.pull) await pullOne(job, sv, r.files)
      else if (!ad.needsPull) sv.state = 'done'   // a local render has no pull: rendered, then done
      await publishSeq(job, sv, ad.needsPull && !job.pull)   // this sequence's publish starts as soon as ITS files are here, not when the others are
    } catch (e) { sv.state = 'failed'; sv.error = (e as Error).message; failedN++ }
  }
  v.current = ''
  v.state = ac.signal.aborted ? 'cancelled' : (failedN || incompleteN) && !renderedN && !skippedN ? 'failed' : 'done'
  const used = [...new Set(v.sequences.map((s) => s.where))].join('+')
  v.summary = `${job.kind}: ${renderedN} rendered, ${skippedN} already there, ${incompleteN} incomplete, ${failedN} failed (${used}); ${v.pulled_files} file${v.pulled_files === 1 ? '' : 's'} pulled (${v.pulled_bytes} bytes), ${v.width === 'source' ? 'source size' : `width ${v.width}`}${review ? `; approved by ${job.approvedBy}` : ''}`
  const bad = v.sequences.find((s) => (s.state === 'failed' && s.error !== 'cancelled') || s.state === 'incomplete'); if (bad) v.error = bad.error
  if (job.publish && !job.pubIds.length && !job.pubErr && v.state === 'done') v.publish = { job_id: '', job_ids: [], state: 'refused', error: 'Nothing was rendered to publish' }
  if (job.kind === 'review' && v.state === 'done') { try { autopublish.considerSoon() } catch { /* Auto-publish never fails a render */ } }   // ADR-050: an approved, finished review may go on its way
  end(job)
}

/** ADR-050: after a sequence is rendered, hand its files to publishing with the job's approver. Files on this PC go from here; a render that stayed on the pod (Sync off) is published from the VOLUME, streamed through this PC with no local copy (the same `{ where: 'volume' }` item the Publish window uses), so Sync is not needed to publish. */
async function publishSeq(job: Job, sv: SeqView, notPulled: boolean): Promise<void> {
  const p = job.publish; if (!p) return
  const v = job.view, strip = (rel: string) => rel.replace(/^output\//, '')
  const note = (error: string) => { v.publish = { job_id: job.pubIds[0] ?? '', job_ids: [...job.pubIds], state: job.pubIds.length ? 'partial' : 'refused', error } }
  try {
    const onVolume = notPulled || sv.state === 'rendered'   // rendered on the pod and not pulled: it is on the volume only
    if (!onVolume && !['pulled', 'done', 'skipped'].includes(sv.state)) return
    const rel = job.kind === 'review' ? strip(dirname(sv.out)) : strip(sv.out)
    if (job.pubDirs.has(rel)) return
    job.pubDirs.add(rel)
    const item = onVolume ? { where: 'volume' as const, path: rel } : rel
    const req = { items: [item], targets: p.targets, approved_by: job.approvedBy, ...(p.message ? { message: p.message } : {}), ...(p.round ? { round: p.round } : {}), ...(p.clip_names ? { clip_names: p.clip_names } : {}), ...(p.edl_override && Object.keys(p.edl_override).length ? { edl_override: p.edl_override } : {}), ...(job.seqs.find((q) => q.name === sv.name)?.start_timecode ? { start_timecodes: { [sv.name]: job.seqs.find((q) => q.name === sv.name)!.start_timecode! } } : {}) }
    const pl = await publish.plan(req)
    if (pl.items.some((i) => i.skip === 'missing')) { job.pubErr ||= onVolume ? 'The render was not found on the volume' : 'Pull the renders to this PC first'; return note(job.pubErr) }
    const r = await publish.run({ ...req, trigger: 'render' })
    job.pubIds.push(r.job_id); v.publish = { job_id: job.pubIds[0], job_ids: [...job.pubIds], state: 'queued' }
  } catch (e) { job.pubErr ||= (e as Error).message; note((e as Error).message) }
}

/** Pull a finished proxy (and its sidecar; a review's whole version folder) to this PC with the existing sync: exactly those paths, so they land at the same relative path under the mapped ComfyUI-Shared. */
async function pullOne(job: Job, sv: SeqView, paths: string[]): Promise<void> {
  const v = job.view; v.state = 'pulling'
  try {
    const r = await deps.pull({ pod_id: v.pod_id, direction: 'pull', paths, ...(sv.bytes && paths.length === 1 ? { path_sizes: { [sv.out]: sv.bytes } } : {}), existing: job.skipExisting ? 'size' : 'replace', trigger: 'render:pull' }, job.abort.signal)
    if (r.failed) throw new Error('The pull of the proxy failed')
    sv.state = 'pulled'; v.pulled_files++; v.pulled_bytes += sv.bytes
  } finally { if (v.state === 'pulling') v.state = 'rendering' }
}

function end(job: Job): void {
  const v = job.view; v.finished_at = iso(); job.stopTrack?.()
  jobs.delete(v.job_id); finished.unshift(copy(v)); finished.length = Math.min(finished.length, KEEP_JOBS)
  const used = [...new Set(v.sequences.map((s) => s.where))].join('+'), shots = [...new Set(v.sequences.map((s) => s.shot).filter(Boolean))], vers = v.sequences.map((s) => s.version).filter(Boolean)
  history.record({ kind: 'job', job: 'render', state: v.state === 'cancelled' ? 'cancelled' : v.state === 'failed' ? 'failed' : 'done', started_at: v.started_at, what: `render ${v.kind} ${v.sequences.length} sequence${v.sequences.length === 1 ? '' : 's'} on ${v.pod_name} (${used})`, ...(v.pod_id ? { pod_id: v.pod_id, pod_name: v.pod_name } : {}), files: v.pulled_files || v.sequences.filter((s) => s.state === 'rendered' || s.state === 'done').length, bytes: v.sequences.reduce((a, s) => a + s.bytes, 0),
    detail: `${v.summary}${shots.length ? `; shot ${shots.join(', ')} ${vers.join(', ')}` : ''}${v.kind === 'review' ? `; codecs ${v.codecs.join(', ')}` : ''}`, ...(v.approved_by ? { approved_by: v.approved_by } : {}), ...(v.error ? { error: v.error } : {}) })
  void persist()
}
/** Forget everything in memory (tests). */
export function reset(): void { hdrCache.clear(); hdrLock = Promise.resolve(); jobs.clear(); finished = []; chain.clear(); cache.clear(); forgetFfmpeg(); setDeps(null) }
void load()
