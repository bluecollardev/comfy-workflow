// Groups by file type and the hidden temp files in the Outputs gallery (Lucas, 2026-11-21: "if multiple videos group them too", "i see all these temp files", "what is the main video", "maybe group by file type with a preview").
// Pure functions, no state: the view state (collapsed or open, pages, the temp toggle) lives in dpxcollapse.js next to the DPX collapse mode it shares.
// Within one folder, files of one type (Videos, Images, Audio, Data, Other) that number more than GROUP_MAX become ONE group; DPX sequences stay sequences; ComfyUI's temp previews are display-hidden (never deleted).

export const GROUP_MAX = 4   // 4 files of a type or fewer stay individual tiles; more become one group

/** ComfyUI's preview files: output type `temp`, anything in a `temp` folder, and the `ComfyUI_temp_<random>_NNNNN_.png` names. Display only: nothing is ever deleted. */
export const isTemp = (f) => !!f && (f.type === 'temp' || /(^|[\\/])temp([\\/]|$)/i.test(String(f.subfolder || '')) || /^ComfyUI_temp_.*\.(png|jpe?g|webp)$/i.test(String(f.filename || '')))

const VERSION_RE = /(?:^|[_.\-])v(\d{1,4})(?=[_.\-]|$)/gi
/** The version number a name carries (`..._FINAL_V02_...`, `..._v015_...`): the last `v<digits>` token, or null. */
export function versionOf(name) {
  let v = null
  for (const m of String(name || '').matchAll(VERSION_RE)) v = Number(m[1])
  return v
}
/** A delivered clip name has the EDL shape `<SHOT>_<ELEMENT>_FINAL|STILL|ALT_Vnn_...` and a .mov or .mp4 container. `isEdlName(stem)` (optional) lets a caller that has the EDL answer say so directly. */
export const isDeliveredName = (filename, isEdlName) => {
  const name = String(filename || '')
  if (!/\.(mov|mp4)$/i.test(name)) return false
  const stem = name.replace(/\.(mov|mp4)$/i, '')
  return !!(isEdlName && isEdlName(stem)) || /_(FINAL|STILL|ALT)_V\d+_/i.test(name)
}
const modifiedOf = (f) => { const t = Date.parse(f?.modified || ''); return Number.isFinite(t) ? t : 0 }

/**
 * The main video of a group: (1) a video whose name is an EDL element's delivered clip name, the highest version first; else (2) the newest by version number (vNNN); else (3) the newest by modified time.
 * Ties fall to the newer modified time, then the name; a .mov wins a .mp4 of the same stem. `rest` lists the others, best first (the older versions).
 */
export function mainVideoOf(videos, isEdlName) {
  const list = (videos || []).filter(Boolean)
  const rank = (f) => [isDeliveredName(f.filename, isEdlName) ? 1 : 0, versionOf(f.filename) ?? -1, modifiedOf(f), /\.mov$/i.test(f.filename) ? 1 : 0]
  const cmp = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return String(a.filename).localeCompare(String(b.filename)) }
  const sorted = [...list].sort(cmp)
  return { main: sorted[0] || null, rest: sorted.slice(1), how: !sorted[0] ? '' : isDeliveredName(sorted[0].filename, isEdlName) ? 'delivered' : versionOf(sorted[0].filename) != null ? 'version' : 'modified' }
}

const DATA_EXT = /\.(json|md|csv|txt|log|yaml|yml|xml)$/i
/** The group a file belongs to: videos, images, audio, data (json, md, csv, txt, log ...) or other. DPX frames are not here: they are sequences. */
export const catOf = (t) => (t.kind === 'video' ? 'video' : t.kind === 'image' ? 'image' : t.kind === 'audio' ? 'audio' : DATA_EXT.test(String(t.file?.filename || '')) ? 'data' : 'other')

/** The order of the groups in a run, after its DPX sequences: Videos, Images, Audio, Data, Other (Lucas, 2026-11-21). */
export const GROUP_ORDER = ['video', 'image', 'audio', 'other']
const sizeOf = (list) => list.reduce((n, f) => n + (Number(f.bytes) || 0), 0)
/** The one representative of a group: the Main video for Videos, the newest image (else the first) for Images, the first audio file; none for Data and Other (an icon). */
function representative(cat, files, isEdlName) {
  if (cat === 'video') return mainVideoOf(files, isEdlName)
  if (cat === 'image') { const sorted = [...files].sort((a, b) => modifiedOf(b) - modifiedOf(a)); return { main: sorted[0] || null, rest: files.filter((f) => f !== sorted[0]), how: modifiedOf(sorted[0]) ? 'modified' : 'first' } }
  if (cat === 'audio') return { main: files[0] || null, rest: files.slice(1), how: 'first' }
  return { main: null, rest: files, how: '' }
}
/**
 * Group the tiles of one folder by file type: `tiles` are the gallery tiles (galleryTiles); within a folder (type + subfolder) the files of one type become ONE `fgroup` tile at the place of the first of them,
 * whatever their number (every group can be expanded and collapsed; Lucas, 2026-11-21: "all can be expanded"). A group of GROUP_MAX files or fewer starts expanded, a bigger one collapsed (dpxcollapse.js).
 * DPX sequences stay sequences. `files` of a group list the representative first (the Main video), then the rest.
 */
export function groupTiles(tiles, isEdlName) {
  // Videos, Images, Audio and Other are grouped per folder (type + subfolder). DATA files are NOT a group: they are a `Data File` button in the run's main row and a popup (Lucas, 2026-11-21: "it's always 1 data
  // file so have this be a modal popup"); `dataFilesOf` lists them. The order does not depend on where a file sits in the listing: the DPX sequences first (their own order), then Videos, Images, Audio, Other.
  const keyOf = (t) => `${t.file.type}/${t.file.subfolder || ''}/${catOf(t)}`
  const byKey = new Map()
  for (const t of tiles) {
    if (t.kind === 'dpx' || catOf(t) === 'data') continue
    const cat = catOf(t), k = keyOf(t)
    if (!byKey.has(k)) byKey.set(k, { cat, tiles: [] })
    byKey.get(k).tiles.push(t)
  }
  const seqs = [], groups = [], done = new Set()
  for (const t of tiles) {
    if (t.kind === 'dpx') { seqs.push(t); continue }
    if (catOf(t) === 'data') continue
    const k = keyOf(t)
    if (done.has(k)) continue
    done.add(k)
    const { cat, tiles: ts } = byKey.get(k)
    const files = ts.map((x) => x.file)
    const { main, rest, how } = representative(cat, files, isEdlName)
    const versions = cat === 'video' ? files.map((f) => versionOf(f.filename)).filter((v) => v != null) : []
    groups.push({ key: `fgroup:${k}`, kind: 'fgroup', cat, file: main || files[0], main, how, files: main ? [main, ...rest] : rest, bytes: sizeOf(files), count: files.length, versions: versions.length ? [Math.min(...versions), Math.max(...versions)] : null })
  }
  const rank = (g) => { const i = GROUP_ORDER.indexOf(g.cat); return i < 0 ? GROUP_ORDER.length : i }
  return [...seqs, ...groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g)]
}

/** The data files of a run (json, md, csv, txt, log ...), in listing order: the files behind the `Data File` button. DPX frames and media are not here. */
export const dataFilesOf = (tiles) => tiles.filter((t) => t.kind !== 'dpx' && catOf(t) === 'data').map((t) => t.file)

/** A file name shortened in the MIDDLE (Lucas, 2026-11-21: every tile read `ARCHIVAL-071_ASSEMBLY_…`): the start and the distinguishing end are kept, e.g. `ARCHIVAL-071_ASSE…rt09c02_v003.png`; the full name goes in the title tooltip. */
export function shortName(name, max = 34, tail = 16) {
  const s = String(name || '')
  if (s.length <= max) return s
  const t = Math.min(tail, max - 2)
  return `${s.slice(0, max - t - 1)}…${s.slice(s.length - t)}`
}

/** The temp files as one group tile (collapsed by default), or null when there are none. */
export const tempGroup = (files) => (files && files.length ? { key: 'tempgroup', kind: 'tempgroup', files, count: files.length, bytes: sizeOf(files) } : null)
