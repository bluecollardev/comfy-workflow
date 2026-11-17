/** Where a volume's outputs live (the s3file:// protocol serves only keys under it). */
export const OUTPUT_ROOT = 'comfy-shared/output'
export const s3Base = (volumeId) => (volumeId ? `s3file://${volumeId}` : '')
/** The address of one output file on a pod's ComfyUI: GET /view?filename=&subfolder=&type= (the `base` is the pod's web address). */
/** `web: true` is the https address (Open in a tab, Download); otherwise, in the app, the podfile:// address the main process serves (RunPod's proxy refuses a page's own request for these files with a 403). `thumb` asks ComfyUI for a small WebP of an image (the 4K frames are several MB). */
export const viewUrl = (base, f, o = {}) => {
  let b = String(base || '').replace(/\/$/, '')
  if (/^s3file:\/\//i.test(b)) return `${b}/${encodeURIComponent(`${OUTPUT_ROOT}/${[f.subfolder, f.filename].filter(Boolean).join('/')}`)}`   // a network volume's file with no pod (docs/ADR-045): the key under comfy-shared/output/, served by the main process
  if (!o.web && typeof window !== 'undefined' && window.core) b = b.replace(/^https:\/\//, 'podfile://')
  return `${b}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${encodeURIComponent(f.type || 'output')}${o.thumb ? '&preview=webp;70' : ''}`
}

const KINDS = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', avif: 'image', mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', wav: 'audio', mp3: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio' }
export const kindOf = (filename) => KINDS[String(filename).split('.').pop().toLowerCase()] || 'other'
/** A run started in ComfyUI's own window has no workflow tag: guess the shot from the file names a delivery uses (`<shot>__<name>`), e.g. archival-123__archival-123c-wide-… -> archival-123c. */
export function guessOf(outputs) {
  for (const o of outputs || []) {
    const seg = String(o.filename).split('__')[1]
    const m = seg && seg.match(/^([A-Za-z]+-\d+[a-z]?)/)
    if (m) return m[1]
  }
  return ''
}
/** The name of a run for headers and zip folders: the workflow's file name (without .json), else the guessed shot, else nothing. */
export const runName = (r) => (r.workflow ? r.workflow.split('/').pop().replace(/\.json$/i, '') : r.guess || '')
/** A pod's finished runs as the runs that produced files: saved results and previews, never the `input` echoes of a loader; newest first. Each carries the workflow it came from (the app's tag in ComfyUI's history) or a guess from the file names. */
export function runsWithOutputs(runs) {
  return (runs || []).filter((r) => r.status === 'success').map((r) => ({
    prompt_id: r.prompt_id, started_at: r.started_at, duration_s: r.duration_s, workflow: r.workflow || '', guess: r.workflow ? '' : guessOf(r.outputs),
    files: (r.outputs || []).filter((o) => o.type === 'output' || o.type === 'temp').map((o) => ({ filename: o.filename, subfolder: o.subfolder || '', type: o.type, kind: kindOf(o.filename) }))
      .sort((a, b) => Number(a.type === 'temp') - Number(b.type === 'temp')),
  })).filter((r) => r.files.length)
}
/** The runs of one shot: the workflow's path or the guessed shot contains the shot's name. */
export const runsForShot = (runs, shot) => (shot ? (runs || []).filter((r) => `${r.workflow || ''} ${r.guess || ''}`.toLowerCase().includes(String(shot).toLowerCase())) : runs || [])

/** DPX frames: the browser cannot decode them (src/utils/dpx.js does), so the gallery shows a sequence as ONE tile. A frame is `<name>.<number>.dpx` (or `_`/`-`/none before the number); frames differ only by that number. */
const DPX_FRAME = /^(.*?)([._-]?)(\d+)\.dpx$/i
export const isDpx = (filename) => /\.dpx$/i.test(String(filename))
/** The gallery's tiles from its files, in order: each is { key, kind, file, frames? }. Non-DPX files are one tile each (kind from the file); the .dpx files of one folder that differ only by frame number are one tile `kind: 'dpx'` with `frames` sorted by number (at the place of the first); a lone .dpx is a one-frame tile. */
export function galleryTiles(files) {
  const tiles = [], seqs = new Map()
  for (const f of files || []) {
    const id = `${f.type}/${f.subfolder}/${f.filename}`
    if (!isDpx(f.filename)) { tiles.push({ key: id, kind: f.kind, file: f }); continue }
    const m = DPX_FRAME.exec(f.filename)
    const key = m ? `dpx:${f.type}/${f.subfolder}/${m[1]}${m[2]}#` : `dpx:${id}`
    let t = seqs.get(key)
    if (!t) { t = { key, kind: 'dpx', file: f, frames: [] }; seqs.set(key, t); tiles.push(t) }
    t.frames.push(f)
  }
  const num = (f) => Number(DPX_FRAME.exec(f.filename)?.[3] ?? 0)
  for (const t of seqs.values()) { t.frames.sort((a, b) => num(a) - num(b) || a.filename.localeCompare(b.filename)); t.file = t.frames[0]; const m = DPX_FRAME.exec(t.file.filename); t.name = t.frames.length > 1 && m ? `${m[1]}${m[2]}${'#'.repeat(m[3].length)}.dpx` : t.file.filename }
  return tiles
}

/** The app's saved runs (core outputs.saved: prompt_id, workflow, started_at, duration_s, pod_id, volume_id, files [{ filename, subfolder, type }]) in the shape of runsWithOutputs, each marked `saved: true`. */
export const savedAsRuns = (saved) => (saved || []).map((r) => ({
  prompt_id: r.prompt_id, started_at: r.started_at, duration_s: r.duration_s, workflow: r.workflow || '', guess: r.workflow ? '' : guessOf(r.files), saved: true, source: 'saved',
  files: (r.files || []).filter((o) => o.type === 'output').map((o) => ({ filename: o.filename, subfolder: o.subfolder || '', type: 'output', kind: kindOf(o.filename) })),
})).filter((r) => r.files.length)
/** The live runs (a running pod's ComfyUI history) and the saved ones as one list, newest first; a run in both is the live one (it has the pod's full record). `saved: true` marks a run that exists only in the app's record. */
export function mergeRuns(live, saved) {
  const seen = new Set((live || []).map((r) => r.prompt_id))
  const all = [...(live || []).map((r) => ({ ...r, saved: false, source: 'pod' })), ...savedAsRuns(saved).filter((r) => !seen.has(r.prompt_id))]
  return all.map((r, i) => ({ r, i })).sort((a, b) => (a.r.started_at && b.r.started_at ? String(b.r.started_at).localeCompare(String(a.r.started_at)) : a.i - b.i)).map((x) => x.r)
}

/** The volume source's runs (core outputsources: a leaf folder that holds files) in the gallery's run shape, tagged `source: 'volume'`. */
export const volumeAsRuns = (runs) => (runs || []).map((r) => ({
  prompt_id: r.prompt_id, started_at: r.started_at, duration_s: null, workflow: '', guess: '', saved: false, source: 'volume', folder: r.folder || '',
  files: (r.files || []).map((o) => ({ filename: o.filename, subfolder: o.subfolder || '', type: 'output', kind: kindOf(o.filename), bytes: o.bytes, modified: o.modified })),
})).filter((r) => r.files.length)
/** The pod/saved runs and the volume's together, newest first. A volume folder is the same run as a pod or saved run that wrote into it (any file in common): the pod's or saved one shows, as the core's merge does. */
export function mergeWithVolume(podRuns, volumeRuns) {
  const have = new Set((podRuns || []).flatMap((r) => r.files.map((f) => `${f.subfolder || ''}/${f.filename}`)))
  const extra = (volumeRuns || []).filter((r) => !r.files.some((f) => have.has(`${f.subfolder || ''}/${f.filename}`)))
  return [...(podRuns || []), ...extra].map((r, i) => ({ r, i })).sort((a, b) => (a.r.started_at && b.r.started_at ? String(b.r.started_at).localeCompare(String(a.r.started_at)) : a.r.started_at ? -1 : b.r.started_at ? 1 : a.i - b.i)).map((x) => x.r)
}
/** Whether a run has files in a folder of the output tree (the volume browser's selection): some file's subfolder is that folder or one inside it. No folder (the root) is every run. */
export const inFolder = (run, prefix) => {
  const p = String(prefix || '').replace(/^\/+|\/+$/g, '')
  if (!p) return true
  return (run?.files || []).some((f) => { const s = String(f.subfolder || '').replace(/^\/+|\/+$/g, ''); return s === p || s.startsWith(`${p}/`) })
}
/** A run narrowed to the files that are in a folder (or inside it): same run, `files` only those, and `totalFiles` the count it had before so a screen can say '12 of 26'. No folder (the root): the run as it is. */
export const narrowToFolder = (run, prefix) => {
  const p = String(prefix || '').replace(/^\/+|\/+$/g, '')
  if (!p || !run) return run
  const files = (run.files || []).filter((f) => { const s = String(f.subfolder || '').replace(/^\/+|\/+$/g, ''); return s === p || s.startsWith(`${p}/`) })
  return { ...run, files, totalFiles: run.totalFiles ?? (run.files || []).length }
}
/** A byte count for a run's title. */
export const sizeText = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)
