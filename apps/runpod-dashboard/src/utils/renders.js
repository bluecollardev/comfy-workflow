/**
 * Render sequences (docs/ADR-048), pure helpers: a DPX sequence tile of the Outputs window as the item the core renders, the frame rate a name carries,
 * the plan line, a job's progress. No DOM, no Vue; `npm run dpx:test`.
 */
export const WIDTHS = [{ id: 'small', px: 960 }, { id: 'medium', px: 1280 }, { id: 'hd', px: 1920 }]
export const DEFAULT_WIDTH = 'source'   // the source size (IMAX 4K); 1920, 1280 and 960 play faster
/** The label of a proxy's width: '1280 px', or 'source size' for the source resolution. */
export const widthLabel = (w) => (typeof w === 'number' || /^\d+$/.test(String(w)) ? `${w} px` : 'source size')
export const FPS_CHOICES = ['auto', 23.976, 24, 25, 30]
export const WHERE_CHOICES = ['auto', 'pod', 'local']
export const ACTIVE = ['queued', 'running', 'rendering', 'pulling', 'publishing']
export const KINDS = ['proxy', 'review']
export const REVIEW_WIDTH = 'source'   // a review video is rendered at the source size (IMAX 4K); the quick proxy is for playing it in the app at 960 to 1920
export const CODECS = [{ id: 'h264', label: 'outputs.render.codecH264' }, { id: 'prores422hq', label: 'outputs.render.codecProres' }]
export const APPROVED_KEY = 'runpod-manager.approved-by'
/** The shot a sequence belongs to, from its name (archival-085 from ARCHIVAL-085_MAIN_FINAL_...): letters, a dash, digits and an optional letter; lower case. '' when none. */
export const shotOfName = (name) => { const m = /^([A-Za-z]+-\d+[a-z]?)/i.exec(String(name || '')); return m ? m[1].toLowerCase() : '' }
const v3 = (n) => String(n).padStart(3, '0')
/** A review video's version as the folder names it: 3 -> 'v003'. */
export const versionName = (n) => `v${v3(n)}`
export const reviewFolder = (shot, version) => `output/deliver/${shot}/${versionName(version)}/`
/** The latest review (highest version) among the core's `deliverables` for the shot of a sequence item, or null. */
export function latestReview(deliverables, item) {
  const shot = shotOfName(item?.name)
  if (!shot) return null
  const mine = (deliverables || []).filter((d) => String(d.shot || '').toLowerCase() === shot && (d.exists_local || d.exists_remote))
  return mine.sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))[0] || null
}
/** The playable file of a deliverable: its H.264 .mp4 (the ProRes .mov is a master copy the app cannot play). `files` lists several per version; an older shape has just `file`/`local_url`. { local_url, file } with `file` the path of the mp4. */
export function reviewMp4(d) {
  if (!d) return null
  const f = (d.files || []).find((x) => /\.mp4$/i.test(x.name || '') || x.codec === 'h264')
  if (!f) return /\.mov$/i.test(d.file || '') ? null : { local_url: d.local_url || '', file: d.file || '' }
  const dir = String(d.file || '').includes('/') ? String(d.file).slice(0, String(d.file).lastIndexOf('/') + 1) : ''
  return { local_url: f.local_url || (d.files.length === 1 ? d.local_url : '') || '', file: `${dir}${f.name}` }
}
/** The files of a deliverable the app cannot play (the ProRes .mov), by name. */
export const unplayableFiles = (d) => (d?.files || []).filter((x) => !/\.mp4$/i.test(x.name || '') && x.codec !== 'h264').map((x) => x.name)
/** The folder and file name of a deliverable under the output folder: its `file` may or may not start with output/ . */
export function deliverableParts(d) {
  const rel = String(d?.file || '').replace(/^\/+/, '').replace(/^(comfy-shared\/)?output\//, ''), i = rel.lastIndexOf('/')
  return { subfolder: i < 0 ? '' : rel.slice(0, i), filename: i < 0 ? rel : rel.slice(i + 1) }
}
/** The starting choices of the Render sequences window, as a configuration's `render` carries them (a missing key is this). */
export const RENDER_DEFAULTS = { where: 'auto', kind: 'proxy', proxy_width: 'source', review_width: 'source', codecs: ['prores422hq'], fps: 'auto', pull: false, publish: { s3: false, slack: false }, skip_existing: true, preset: 'none' }
/** The keys a configuration sends only when it already had them or they changed (an untouched configuration saves exactly as before). */
export const RENDER_OPTIONAL = ['pull', 'publish', 'skip_existing', 'preset']
const renderNorm = (r) => { const { start_timecode_default: _gone, ...x } = { ...RENDER_DEFAULTS, ...(r || {}) }; return { ...x, publish: { s3: !!x.publish?.s3, slack: !!x.publish?.slack } } }   // a stored start_timecode_default is ignored and dropped (no default timecode anywhere)
export const WIDTH_CHOICES = ['source', 1920, 1280, 960]
/** Why a `render` settings object is refused, or ''. */
export function renderProblem(r) {
  if (!r) return ''
  if (!Array.isArray(r.codecs) || !r.codecs.length || r.codecs.some((c) => !['h264', 'prores422hq'].includes(c))) return 'codecs'
  if (!['auto', 'pod', 'local'].includes(r.where) || !['proxy', 'review'].includes(r.kind)) return 'choice'
  if (!WIDTH_CHOICES.includes(r.proxy_width) || !WIDTH_CHOICES.includes(r.review_width)) return 'width'
  if (!['none', 'tunnel'].includes(r.preset ?? 'none')) return 'choice'
  return ''
}
export const renderIsDefault = (r) => JSON.stringify(renderNorm(r)) === JSON.stringify(renderNorm({}))
/** What a configuration sends: the optional keys only when loaded with it or changed from the default. */
export const renderBody = (r, loadedKeys = []) => { const o = renderNorm(r), d = renderNorm({}); for (const k of RENDER_OPTIONAL) if (!loadedKeys.includes(k) && JSON.stringify(o[k]) === JSON.stringify(d[k])) delete o[k]; return o }
/** Why the publish-when-done settings are refused (the core's rules), or ''. */
export function renderPublishProblem(r) {
  const p = r?.publish || {}
  if (p.slack && !p.s3) return 'slackNeedsS3'
  if ((p.s3 || p.slack) && r.where !== 'local' && !r.pull) return 'needSync'
  return ''
}
/** Why a clip name is refused (the core's rules), or '': not empty, no slashes or `..`, no control characters, letters digits and `._- ` only, at most 200. */
export function clipProblem(name) {
  const s = String(name ?? '')
  if (!s.trim()) return 'clipEmpty'
  // eslint-disable-next-line no-control-regex
  if (/[/\\]/.test(s) || s.includes('..')) return 'clipSlash'
  if (s.length > 200) return 'clipLong'
  if (!/^[A-Za-z0-9._\- ]+$/.test(s)) return 'clipChars'
  return ''
}
/** The file names a plan item will write: review -> <clip>.mov and/or .mp4; proxy -> <clip>.mp4 (source) or <clip>_<width>.mp4. The core returns the clip name; the sequence name is the default. */
export function outputNames(seq, { kind = 'proxy', codecs = ['h264'], width = 'source' } = {}) {
  const clip = seq.clip_name || seq.name
  if (kind === 'review') return [...(codecs.includes('prores422hq') ? [`${clip}.mov`] : []), ...(codecs.includes('h264') ? [`${clip}.mp4`] : [])]
  return [width === 'source' ? `${clip}.mp4` : `${clip}_${width}.mp4`]
}
export const BREW_COMMAND = 'brew install ffmpeg'

const FRAME = /^(.*?)([._-]?)(\d+)\.dpx$/i

/** `NAME.0000.dpx` -> { name: 'NAME', sep: '.', pad: 4, number: 0 }; null when it is not a numbered DPX. `name` is the stem before the separator. */
export function parseFrameName(filename) {
  const m = FRAME.exec(String(filename || ''))
  if (!m) return null
  return { name: m[1], sep: m[2], pad: m[3].length, number: Number(m[3]) }
}

/** The frame rate a name carries: a number between underscores, 12 to 120 (`_23.976_`, `_25_`); null when it has none. 4-digit sizes (`_3840X2160_`) never match. */
export function fpsFromName(name) {
  for (const m of String(name || '').matchAll(/_(\d{2}(?:\.\d{1,3})?)_/g)) { const v = Number(m[1]); if (v >= 12 && v <= 120) return v }
  return null
}
/** The rate to render at: a fixed choice, else the name's, else 24. */
export const fpsFor = (choice, name) => (choice && choice !== 'auto' ? Number(choice) : fpsFromName(name) || 24)

/** The key a sequence is known by in the proxy lists and the badges. */
export const seqKey = (s) => `${s.dir || ''}/${s.name}`

/** The item the core renders for one gallery tile (utils/outputs.js galleryTiles: kind 'dpx', frames sorted by number), or null when it cannot be rendered:
 * a temp file (not under the output folder), no frames, frames not numbered, or a separator other than '.' (the core names frames NAME.%0Nd.dpx). */
export function sequenceItem(tile, fpsChoice = 'auto') {
  if (!tile || tile.kind !== 'dpx' || !tile.frames?.length) return null
  const first = tile.frames[0]
  if (first.type === 'temp') return null
  const p = parseFrameName(first.filename), last = parseFrameName(tile.frames[tile.frames.length - 1].filename)
  if (!p || !last || p.sep !== '.' || !p.name) return null
  return { dir: first.subfolder || '', name: p.name, first: p.number, last: last.number, frames: tile.frames.length, pad: p.pad, fps: fpsFor(fpsChoice, p.name) }
}
/** The items of many tiles, one per sequence (the same sequence in two runs counts once), in order; `skipped` counts the DPX sequences that cannot be rendered. */
export function sequenceItems(tiles, fpsChoice = 'auto') {
  const seen = new Set(), items = []
  let skipped = 0
  for (const t of tiles || []) {
    if (t?.kind !== 'dpx') continue
    const it = sequenceItem(t, fpsChoice)
    if (!it) { skipped++; continue }
    const k = seqKey(it)
    if (seen.has(k)) continue
    seen.add(k); items.push(it)
  }
  return { items, skipped }
}

/** A sequence is complete when the core says so (`complete`), else when it has no gaps. */
export const isComplete = (s) => (s.complete === undefined ? gapsOf(s) === 0 : !!s.complete)
/** Missing frame ranges as text: `101-150, 200`. */
export const missingText = (ranges) => (ranges || []).map((r) => (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`)).join(', ')
const gapsOf = (s) => (Array.isArray(s.gaps) ? s.gaps.length : Number(s.gaps) || 0)
/** The numbers of the plan line from the core's plan(): sequences, frames, already rendered (on the volume or here), gaps, and how many go to each adapter. */
export function planSummary(plan) {
  const seqs = plan?.sequences || []
  const by = { pod: 0, local: 0 }
  for (const s of seqs) if (s.where === 'local') by.local++; else by.pod++
  return {
    sequences: seqs.length,
    frames: plan?.total_frames ?? seqs.reduce((n, s) => n + (s.frames || 0), 0),
    rendered: seqs.filter((s) => s.exists_remote || s.exists_local).length,
    gaps: seqs.reduce((n, s) => n + gapsOf(s), 0),
    complete: seqs.filter(isComplete).length, incomplete: seqs.filter((s) => !isComplete(s)).length,
    pod: by.pod, local: by.local,
  }
}

/** The state of the two adapters from plan().adapters: { pod, local } each { ok, reason, code, hint }; a missing entry is not ok with no reason. */
export function adapterMap(adapters) {
  const pick = (id) => { const a = (adapters || []).find((x) => x.id === id); return a ? { ok: !!a.ok, reason: a.reason || '', code: a.code || '', hint: a.install_hint || '' } : { ok: false, reason: '', code: '', hint: '' } }
  return { pod: pick('pod'), local: pick('local') }
}
/** Whether the choice `where` can start: Auto needs either adapter, the others their own. `why` is the reason(s) when it cannot. */
export function whereState(where, adapters) {
  const a = adapterMap(adapters)
  if (where === 'pod') return { ok: a.pod.ok, why: a.pod.ok ? [] : [a.pod.reason] }
  if (where === 'local') return { ok: a.local.ok, why: a.local.ok ? [] : [a.local.reason] }
  const ok = a.pod.ok || a.local.ok
  return { ok, why: ok ? [] : [a.pod.reason, a.local.reason] }
}
/** The ffmpeg problem to show: the local adapter's when it is the code `no_ffmpeg` or `ffmpeg_broken`, or an error from start() carrying the same code. `blocker`: it is what stops this choice (no usable adapter). */
export function ffmpegProblem(adapters, where, err) {
  const a = adapterMap(adapters)
  const bad = (x) => x && (x.code === 'no_ffmpeg' || x.code === 'ffmpeg_broken' || /ffmpeg is not installed/i.test(x.reason || ''))
  let kind = '', reason = '', hint = BREW_COMMAND
  if (bad(a.local)) { kind = a.local.code === 'ffmpeg_broken' ? 'broken' : 'missing'; reason = a.local.reason; hint = a.local.hint || hint }
  else if (err) { const code = err.code || err.response?.data?.code, msg = String(err.response?.data?.detail || err.message || err); if (code === 'no_ffmpeg' || /ffmpeg is not installed/i.test(msg)) { kind = 'missing'; reason = msg } else if (code === 'ffmpeg_broken') { kind = 'broken'; reason = msg } }
  if (!kind) return null
  const blocker = where === 'local' ? true : where === 'pod' ? false : !a.pod.ok
  return { kind, reason, hint, blocker }
}

const stateDone = (s) => ['rendered', 'pulled', 'done', 'skipped'].includes(s)
/** A job's overall percent (frames done of frames total; a finished job is 100). */
export function jobPercent(job) {
  if (!job) return 0
  if (job.state === 'done') return 100
  const total = Number(job.frames_total) || 0
  return total > 0 ? Math.max(0, Math.min(100, Math.round((100 * (Number(job.frames_done) || 0)) / total))) : 0
}
/** The 1-based position of the sequence being worked on: the first rendering, else the first waiting, else the last. */
export function currentSequence(job) {
  const ss = job?.sequences || []
  if (!ss.length) return 0
  let i = ss.findIndex((s) => s.state === 'rendering')
  if (i < 0) i = ss.findIndex((s) => s.state === 'waiting')
  if (i < 0) i = ss.length - 1
  return i + 1
}
export const isActive = (job) => !!job && ACTIVE.includes(job.state)
export const allSequencesDone = (job) => !!job?.sequences?.length && job.sequences.every((s) => stateDone(s.state))
/** The most relevant job for a pod: an active one, else the latest started. With podId '' any pod; a local job (no pod) counts for every pod. */
export function jobFor(jobs, podId) {
  const mine = (jobs || []).filter((j) => !podId || !j.pod_id || j.pod_id === podId)
  return mine.find(isActive) || [...mine].sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))[0] || null
}

// ---- Source size and colour (the Generate window): what the files are, read from their headers by the core ----
const group = (list, keyOf) => { const m = new Map(); for (const x of list) { const k = keyOf(x); m.set(k, [...(m.get(k) || []), x]) } return [...m.values()] }
/** The size groups of a plan: the core's `source_summary`, else grouped from the sequences' `source`; [] when nothing was read. */
export function sourceGroups(plan) {
  const g = plan?.source_summary?.groups
  if (Array.isArray(g) && g.length) return g
  const seqs = (plan?.sequences || []).filter((s) => s.source && s.source.width)
  return group(seqs, (s) => `${s.source.width}x${s.source.height}x${s.source.bits}`).map((l) => ({ width: l[0].source.width, height: l[0].source.height, bits: l[0].source.bits, count: l.length }))
}
/** '3840 × 2160, 16-bit' (or '3840 × 2160' when the depth is unknown). */
export const dimsText = (g) => `${g.width} × ${g.height}${g.bits ? `, ${g.bits}-bit` : ''}`
/** The height a downscale to `width` gives (the aspect kept, an even number). */
export const scaledHeight = (g, width) => Math.max(2, 2 * Math.round((g.height * width) / g.width / 2))
/** The colour groups of a plan: the core's `colour_summary`, else grouped from the sequences' `colour`; [] when nothing was read (an older core, or unreadable headers). */
export function colourGroups(plan) {
  const g = plan?.colour_summary?.groups
  if (Array.isArray(g) && g.length) return g
  const seqs = (plan?.sequences || []).filter((s) => s.colour)
  return group(seqs, (s) => ['transfer_name', 'colorimetric_name', 'descriptor_name', 'bits', 'packing_name', 'width', 'height', 'verdict'].map((k) => s.colour[k]).join('|')).map((l) => { const c = l[0].colour; return { count: l.length, transfer_name: c.transfer_name, colorimetric_name: c.colorimetric_name, descriptor_name: c.descriptor_name, bits: c.bits, packing_name: c.packing_name, endian: c.endian, width: c.width, height: c.height, verdict: c.verdict, refusal: c.refusal } })
}
/** 'Transfer: logarithmic · Colorimetric: unspecified video · RGB · 16-bit packed · big-endian' */
export const colourLine = (g) => [`Transfer: ${g.transfer_name || '?'}`, `Colorimetric: ${g.colorimetric_name || '?'}`, g.descriptor_name, g.bits ? `${g.bits}-bit${g.packing_name ? ` ${g.packing_name}` : ''}` : g.packing_name, g.endian ? `${g.endian}-endian` : ''].filter(Boolean).join(' · ')
/** The distinct conversions the sequences report (plain words), in order. */
export const conversions = (plan) => [...new Set((plan?.sequences || []).map((s) => s.colour?.conversion).filter(Boolean))]
export const noTransform = (c) => /^none\b/i.test(String(c || ''))
/** Whether a Review is refused: some group has verdict 'refused' (the reasons, once each). */
export const refusals = (groups) => [...new Set((groups || []).filter((g) => g.verdict === 'refused').map((g) => g.refusal || 'refused'))]
/** The colour block as plain text for pasting: the groups with counts, the conversion, the verdicts. */
export function colourText(plan) {
  const lines = [], gs = colourGroups(plan)
  for (const g of gs) lines.push(`${g.count} sequence${g.count === 1 ? '' : 's'}: ${colourLine(g)}${g.width ? ` · ${g.width} × ${g.height}` : ''} · ${g.verdict === 'refused' ? `Review refused: ${g.refusal || 'refused'}` : 'Review allowed'}`)
  for (const c of conversions(plan)) lines.push(`Conversion applied: ${c}`)
  return lines.join('\n')
}
