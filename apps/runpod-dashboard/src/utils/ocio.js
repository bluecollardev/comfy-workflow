/**
 * The colour of a DPX sequence, as the Outputs window and the viewer show it (docs/ADR-048, amendment 2026-11-20): what the writer said (the ComfyUI-OCIO record `<dir>/<stem>.json` next to the frames) and what the
 * DPX header says (transfer, colorimetric), side by side, so a person SEES where they disagree. The record is read through the same file mechanism the viewer and the thumbnails use (the pod's /view, or the
 * volume's s3file:// through the main process); never a new network path. Lazy, cached per record address, a failed read is "no record" and never an error.
 * `OCIO_INTEROP` and `TRANSFER_NAMES` are the renderer's copy of libs/core/src/renders.ts (the window has no TypeScript core to import); libs/core/tests/ocio-parity.test.ts fails when they drift.
 */
import { viewUrl } from './outputs.js'
import { createLimiter } from './thumbs.js'

/** colorInteropID -> the converter's colour id (what Generate converts from), the friendly label, and whether the data is linear. Same table as the core's. */
export const OCIO_INTEROP = {
  g26_p3d65_display: { colour_in: 'p3-d65-gamma26', label: 'Gamma 2.6 P3-D65', linear: false },
  srgb_p3d65_display: { colour_in: 'p3-d65-srgb', label: 'sRGB P3-D65', linear: false },
  g22_p3d65_display: { colour_in: 'p3-d65-gamma22', label: 'Gamma 2.2 P3-D65', linear: false },
  lin_p3d65_scene: { colour_in: 'linear-p3-d65', label: 'Linear P3-D65', linear: true },
  lin_rec709_scene: { colour_in: 'linear-rec709', label: 'Linear Rec.709', linear: true },
}
export const TRANSFER_NAMES = { 0: 'user defined', 1: 'printing density', 2: 'linear', 3: 'logarithmic', 4: 'unspecified video', 5: 'SMPTE 240M', 6: 'ITU-R 709-4', 7: 'ITU-R 601-5 system B or G', 8: 'ITU-R 601-5 system M', 9: 'NTSC composite video', 10: 'PAL composite video', 11: 'Z linear', 12: 'Z homogeneous', 13: 'ADX' }
/** Transfer codes that are not display-referred (the core's NOT_DISPLAY). */
export const NOT_DISPLAY = [1, 2, 3, 11, 12, 13]
export const OCIO_MAX_BYTES = 256 * 1024

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000 ? v : null)
/** "R 0.68, 0.32 · G 0.265, 0.69 · B 0.15, 0.06 · W 0.3127, 0.329" from the record's eight chromaticity numbers; null for anything else. */
export function chromaText(c) {
  if (!Array.isArray(c) || c.length !== 8 || c.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null
  return ['R', 'G', 'B', 'W'].map((n, i) => `${n} ${c[2 * i]}, ${c[2 * i + 1]}`).join(' · ')
}
/** A record's text -> what the window shows; null (never a throw) when it is not JSON, has no known colorInteropID or is over 256 KB. The interop id decides `colour_in`; the rest is the writer's own words. */
export function parseOcioRecord(text) {
  try {
    if (!text || text.length > OCIO_MAX_BYTES) return null
    const j = JSON.parse(text), a = j && typeof j === 'object' && !Array.isArray(j) ? j.attributes : null
    const id = a && typeof a === 'object' ? a.colorInteropID : null
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(OCIO_INTEROP, id)) return null
    const m = OCIO_INTEROP[id]
    return {
      colour_in: m.colour_in, label: m.label, linear: m.linear, colorInteropID: id,
      colorspace: str(a['com.ocio.colorspace']), gamut: str(a['com.ocio.gamut']), chromaticities: chromaText(a.chromaticities),
      writer: str(j.writer), fps: num(a.fps) ?? num(a.framerate) ?? num(a.frameRate) ?? num(a.framesPerSecond) ?? num(j.fps),
    }
  } catch { return null }
}
/** The header's transfer in the words the chips use ("linear", "printing density"; "code 99" when unknown). */
export const transferName = (code) => TRANSFER_NAMES[code] ?? `code ${code}`
/** Does the header contradict the record? A linear record with a header that is not linear; a display record with a header that says linear, log or density (the core's rule). */
export const headerDisagrees = (rec, h) => !!rec && !!h && (rec.linear ? h.transfer !== 2 : NOT_DISPLAY.includes(h.transfer))
/**
 * The chips of one sequence, as data (the components give them their words, in the locale): `record` { label } when there is one, `header` { name, disagrees } when the header is known and either there
 * is no record (the header's own words, grey) or the record contradicts it (amber). A record that agrees with the header says it all: no header chip. Either may be null.
 */
export function chipsOf(rec, h) {
  const out = { record: null, header: null }
  if (rec) out.record = { label: rec.label }
  if (h && (!rec || headerDisagrees(rec, h))) out.header = { name: transferName(h.transfer), disagrees: !!rec }
  return out
}

/** The DPX header's colour fields (SMPTE 268M, element 0: transfer @801, colorimetric @802), read leniently from the first bytes of a frame; null when it is not a DPX header. */
export function headerColour(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (u8.byteLength < 804) return null
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3])
  if (magic !== 'SDPX' && magic !== 'XPDS') return null
  return { transfer: u8[801], colorimetric: u8[802] }
}

/** The address of a sequence's record: `<stem>.json` beside its frames, stem = the frame's name without `.NNNN.dpx` (a single unnumbered frame: without `.dpx`). */
export const stemOf = (filename) => String(filename || '').replace(/[._-]?\d+\.dpx$/i, '').replace(/\.dpx$/i, '')
export const recordUrl = (base, frame) => (base && frame?.filename ? viewUrl(base, { filename: `${stemOf(frame.filename)}.json`, subfolder: frame.subfolder || '', type: frame.type || 'output' }) : '')

const HEADER_BYTES = 2048
const slot = createLimiter(3)   // the window never has more than three of these reads in flight
const cache = new Map()   // address -> Promise<result>; a failed read is cached as null (shown as nothing) until the cache is cleared
const memo = (key, make) => { let p = cache.get(key); if (!p) { p = make().catch(() => null); cache.set(key, p) } return p }
const listeners = new Set()
/** Be told when what was read is forgotten (the chips on screen ask again); returns the way to stop listening. */
export const onColourCleared = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
/** Forget what was read (a refresh of the Outputs window); the chips on screen ask again. */
export const clearColourCache = () => { cache.clear(); for (const fn of [...listeners]) fn() }

/** The text of a small file at `url`: fetch first, the app's reader (core.files.read) when the page's own fetch is refused, like the frame loader. null for anything that fails or is over `max` bytes. */
async function readText(url, fallback, max = OCIO_MAX_BYTES) {
  let bytes
  try {
    const r = await fetch(url)
    if (r.status < 200 || r.status > 299) return null
    bytes = new Uint8Array(await r.arrayBuffer())
  } catch (e) {
    if (!(e instanceof TypeError) || !fallback) return null
    const r = await fallback(url)
    if (!r || r.status < 200 || r.status > 299) return null
    bytes = r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes)
  }
  return bytes.byteLength > max ? null : new TextDecoder().decode(bytes)
}
/** A sequence's OCIO record (parsed), once per address; null when there is none, it cannot be read or it names no known colour space. */
export const loadRecord = (url, { fallback } = {}) => (url ? memo(`rec:${url}`, () => slot(async () => parseOcioRecord(await readText(url, fallback)))) : Promise.resolve(null))
/**
 * A frame's header colour (transfer, colorimetric) from its first 2 KB only: the body is cancelled as soon as they have arrived (a DPX is ~50 MB). Over the volume's s3file:// (no streaming to the page) it is not
 * read at all: null, so the window shows the record alone until the viewer has the frame.
 */
export const loadHeaderColour = (url) => (url && !/^s3file:/.test(url) ? memo(`hdr:${url}`, () => slot(async () => {
  const ac = new AbortController()
  try {
    const r = await fetch(url, { signal: ac.signal })
    if (r.status < 200 || r.status > 299 || !r.body) return null
    const reader = r.body.getReader(), parts = []
    let got = 0
    while (got < HEADER_BYTES) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length }
    const all = new Uint8Array(got); let p = 0
    for (const c of parts) { all.set(c, p); p += c.length }
    return headerColour(all)
  } finally { ac.abort() }
})) : Promise.resolve(null))
