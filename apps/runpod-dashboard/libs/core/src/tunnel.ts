/**
 * The Tunnel preset's and the BKK return's judgement of one sequence (docs/ADR-050, "The EDL decides timecode, frame count and what may be
 * delivered"): the start timecode and where it came from, the frame count against the EDL, what is not in the EDL, the source raster, and the
 * colour the proxy is converted from. Pure over the loaded EDL (edl.ts). Also the ffmpeg colour chain of the converted Rec.709 view.
 */
import * as edl from './edl.js'

export type FlagLevel = 'block' | 'warn'
export interface Flag { code: string; level: FlagLevel; message: string }
export const COLOUR_INS = ['p3-d65-gamma26', 'p3-d65-srgb', 'p3-d65-gamma22', 'kodak-log', 'linear-p3-d65', 'linear-rec709', 'cineon'] as const   // the same list as mounts.COLOUR_INS (the configuration validates against it)
export type ColourIn = (typeof COLOUR_INS)[number]
export type TimecodeSource = 'sequence field' | 'DPX header' | 'EDL'
export const isColourIn = (v: unknown): v is ColourIn => (COLOUR_INS as readonly string[]).includes(v as string)
export function validateColourIn(v: unknown): ColourIn | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (!isColourIn(v)) { const e = new Error(`colour_in is one of ${COLOUR_INS.join(', ')} (no default: it is chosen per sequence)`) as Error & { status: number }; e.status = 400; throw e }
  return v
}
/** Shots that start `corrosion-` are Kodak log: shown as a suggestion, never applied. */
export const suggestedColour = (name: string): ColourIn | null => (/^corrosion-/i.test(name.trim()) ? 'kodak-log' : null)

// ----- the converted Rec.709 view -----
/** The linear P3-D65 to linear Rec.709 matrix (rows are the output R, G, B), from the two sets of primaries with the same D65 white. */
export const P3_TO_709 = [[1.2249401, -0.2249404, 0], [-0.0420569, 1.0420571, 0], [-0.0196376, -0.0786361, 1.0982735]] as const
const L = 'val/maxval'
const DECODE: Record<Exclude<ColourIn, 'kodak-log' | 'linear-p3-d65' | 'linear-rec709' | 'cineon'>, string> = {
  'p3-d65-gamma26': `pow(${L},2.6)`, 'p3-d65-gamma22': `pow(${L},2.2)`,
  'p3-d65-srgb': `if(lte(${L},0.04045),${L}/12.92,pow((${L}+0.055)/1.055,2.4))`,
}
const CINEON = `(pow(10,(${L}*1023-685)*0.002/0.6)-pow(10,(95-685)*0.002/0.6))/(1-pow(10,(95-685)*0.002/0.6))`
const ENCODE_709 = `if(lt(${L},0.018),4.5*${L},1.099*pow(${L},0.45)-0.099)`
/**
 * ffmpeg filters (after the scale, in RGB) of the view: linearise with the transfer the DPX uses (a 16-bit lookup, `lutrgb`), P3-D65 primaries to
 * Rec.709 primaries (`colorchannelmixer`, linear light), then the Rec.709 transfer. The local ffmpeg has no `zscale`, and `colorspace` cannot take
 * a gamma 2.6 input or RGB, so the three portable filters do it. null for Kodak log: no view transform (the picture is log, tagged only).
 */
export function colourFilters(c: ColourIn): string[] | null {
  if (c === 'kodak-log') return null
  const lut = (e: string) => `lutrgb=r='maxval*(${e})':g='maxval*(${e})':b='maxval*(${e})'`, m = P3_TO_709.flat()
  const mix = `colorchannelmixer=${['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'].map((k, i) => `${k}=${m[i]}`).join(':')}`
  if (c === 'cineon') return ['format=gbrp16le', lut(CINEON), lut(ENCODE_709)]   // printing density (reference white 685, black 95, gamma 0.6; policy/colour.md) to linear, then the Rec.709 transfer
  if (c === 'linear-rec709') return ['format=gbrp16le', lut(ENCODE_709)]   // already linear light in Rec.709 primaries: only the Rec.709 transfer
  if (c === 'linear-p3-d65') return ['format=gbrp16le', mix, lut(ENCODE_709)]   // linear light: primaries P3-D65 to Rec.709, then the Rec.709 transfer
  return ['format=gbrp16le', lut(DECODE[c]), mix, lut(ENCODE_709)]
}
export interface ColourBlock { working_space: 'P3-D65' | 'Kodak log' | 'Linear P3-D65' | 'Linear Rec.709' | 'Cineon printing density'; transfer: 'gamma 2.6' | 'sRGB' | 'gamma 2.2' | 'log' | 'linear'; proxy: 'Rec.709 view (converted)' | 'tagged only (log)' }
export const colourBlock = (c: ColourIn): ColourBlock => c === 'cineon' ? { working_space: 'Cineon printing density', transfer: 'log', proxy: 'Rec.709 view (converted)' } : c === 'linear-p3-d65' ? { working_space: 'Linear P3-D65', transfer: 'linear', proxy: 'Rec.709 view (converted)' } : c === 'linear-rec709' ? { working_space: 'Linear Rec.709', transfer: 'linear', proxy: 'Rec.709 view (converted)' } : c === 'kodak-log' ? { working_space: 'Kodak log', transfer: 'log', proxy: 'tagged only (log)' } : { working_space: 'P3-D65', transfer: c === 'p3-d65-gamma26' ? 'gamma 2.6' : c === 'p3-d65-srgb' ? 'sRGB' : 'gamma 2.2', proxy: 'Rec.709 view (converted)' }
export const colourNote = (c: ColourIn): string => c === 'kodak-log' ? 'Kodak log: log, not a viewable picture (tagged Rec.709, no view transform)' : `converted Rec.709 view of ${colourBlock(c).working_space} (${colourBlock(c).transfer})`

// ----- the judgement -----
export interface EdlRow { clip: string; shot: string; element: string; version: string; raster: string | null; speeds: number[]; first_source_in: string; frames_in_cut: number }
export interface Assessment {
  stem: string; clip: string; frames: number; expected_frames: number | null; edl_element: EdlRow | null; edl_match: 'exact' | 'shot-element' | 'ambiguous' | 'not-in-edl' | 'no-edl'; candidates?: string[]
  start_timecode: string | null; timecode_source: TimecodeSource | null; colour_in: ColourIn | null; suggested_colour: ColourIn | null
  flags: Flag[]; blocked: boolean; /** the frame-count override this run uses */ overridden?: { stem: string; frames: number; expected: number }; /** what the manifest's measures.notes carries (override, low resolution) */ notes: string[]
}
const pct = (s: number[]) => s.map((x) => `${x}%`).join(', ')
export interface AssessIn { name: string; clip_name?: string; frames: number; start_timecode?: string | null; header_tc?: string | null; colour_in?: ColourIn | null; override?: boolean; /** a test round (`_TEST_...`): the frame count is not checked, it is a visible warning and a manifest note */ waiveFrames?: boolean; /** the Tunnel preset: colour must be chosen */ needColour?: boolean; /** the timecode, the frame count and the EDL membership matter (the Tunnel preset, a return publish) */ strict?: boolean }
export function assess(o: AssessIn): Assessment {
  const clip = o.clip_name ?? o.name, loaded = edl.isLoaded(), flags: Flag[] = [], notes: string[] = []
  const m = loaded ? edl.matchSequence({ name: o.name, ...(o.clip_name ? { clip_name: o.clip_name } : {}) }) : null
  const el = m && (m.match === 'exact' || m.match === 'shot-element') ? m.element : null
  const row: EdlRow | null = el ? { clip: el.clip, shot: el.shot, element: el.element, version: el.version, raster: el.raster, speeds: el.speeds, first_source_in: el.first_source_in, frames_in_cut: el.frames_in_cut } : null
  let overridden: Assessment['overridden']
  let tc: string | null = null, source: TimecodeSource | null = null
  if (o.start_timecode) { tc = o.start_timecode; source = 'sequence field' }
  else if (o.header_tc && !o.header_tc.includes(';')) { tc = o.header_tc; source = 'DPX header' }
  else if (el) { tc = el.first_source_in; source = 'EDL' }
  if (!loaded) flags.push({ code: 'no-edl', level: 'warn', message: 'No EDL loaded' })
  if (o.strict) {
    if (!tc) flags.push({ code: 'no-start-timecode', level: 'block', message: 'No start timecode: set it or load the EDL' })
    if (m?.match === 'ambiguous') flags.push({ code: 'ambiguous-edl-element', level: 'block', message: `More than one EDL element matches (${m.candidates.map((c) => c.clip).join(', ')}): give the clip name` })
    else if (m?.match === 'not-in-edl') flags.push({ code: 'not-in-edl', level: 'block', message: 'Not in the V11 EDL: do not deliver' })
    if (el && o.frames !== el.frames_in_cut) {
      const retimed = el.speeds.some((s) => s !== 100), msg = `${o.frames} frames, the EDL cut has ${el.frames_in_cut}${retimed ? ` (speeds ${pct(el.speeds)})` : ''}: the DPX must carry the retime`
      if (o.waiveFrames) { flags.push({ code: 'frames-differ-from-edl', level: 'warn', message: `EDL frame count not checked in a test round: ${o.frames} frames, the cut has ${el.frames_in_cut}` }); notes.push('EDL check waived: test round') }
      else if (o.override) { flags.push({ code: 'frames-differ-from-edl', level: 'warn', message: `${msg} (overridden for this run)` }); notes.push(`EDL override: ${o.frames} frames vs ${el.frames_in_cut} in the cut`); overridden = { stem: o.name, frames: o.frames, expected: el.frames_in_cut } }
      else flags.push({ code: 'frames-differ-from-edl', level: 'block', message: msg })
    }
  }
  if (el?.raster) { const w = Number(el.raster.split('x')[0]); if (w < 1920) { flags.push({ code: 'low-source-resolution', level: 'warn', message: `the source is ${el.raster}: flag if the 4K is not usable` }); notes.push(`the source is ${el.raster}: flag if the 4K is not usable`) } }
  if (o.needColour && !o.colour_in) flags.push({ code: 'colour-not-set', level: 'block', message: 'Colour not set: choose what the DPX frames are (P3-D65 with its transfer, or Kodak log)' })
  const key = o.name
  return { stem: key, clip, frames: o.frames, expected_frames: el ? el.frames_in_cut : null, edl_element: row, edl_match: !loaded ? 'no-edl' : m!.match, ...(m?.match === 'ambiguous' ? { candidates: m.candidates.map((c) => c.clip) } : {}),
    start_timecode: tc, timecode_source: source, colour_in: o.colour_in ?? null, suggested_colour: suggestedColour(clip) ?? suggestedColour(o.name), flags, blocked: flags.some((f) => f.level === 'block'), ...(overridden ? { overridden } : {}), notes }
}
export const blockReasons = (a: Assessment): string => a.flags.filter((f) => f.level === 'block').map((f) => f.message).join('; ')
