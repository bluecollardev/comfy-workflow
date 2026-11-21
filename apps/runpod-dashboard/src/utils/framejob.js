import { reactive } from 'vue'
import { framePreviewsAPI } from '../api/framepreviews'
import { viewUrl } from './outputs'

// Frame previews are a JOB on the pod (libs/core/src/framepreviews.ts): one small JPEG per DPX frame under output/.previews/<the sequence's folder>/. This is the window's side of it: the mode
// choice (Sequence Previews, today's first-frame thumbnails read to this PC; Frame Previews, the pod job), the one running job, and what the pod says exists.
const KEY = 'pod-manager-preview-mode'
const readMode = () => { try { return sessionStorage.getItem(KEY) === 'frame' ? 'frame' : 'sequence' } catch { return 'sequence' } }
export const fpState = reactive({ mode: readMode(), job: null, /** the core's answer when no pod runs for a relaunch: { stopped: [{ id, name }], hint } */ needsPod: null, /** src_dir -> { count, names: Set<string> | null } */ listing: {}, error: '', listed: 0 })
export const setMode = (m) => { fpState.mode = m === 'frame' ? 'frame' : 'sequence'; try { sessionStorage.setItem(KEY, fpState.mode) } catch { /* the choice lasts as long as the page */ } }

export const jpgName = (dpxName) => String(dpxName).replace(/\.dpx$/i, '') + '.jpg'
/** The folder of a sequence's previews under output/ (the core's rule: a mirror tree, never inside the frame folder). */
export const previewFolder = (srcDir) => `.previews/${String(srcDir || '').replace(/\/+$/, '')}`
/** The address of one frame's JPEG: the same /view address as any output file. */
/** The address of one frame's THUMBNAIL (160 px, a few KB, under <previews>/thumbs/): what the strips and the frame grid load; the 320 px JPEG stays the fallback until the thumbnail exists. */
export const thumbUrl = (base, frame) => viewUrl(base, { filename: jpgName(frame.filename), subfolder: `${previewFolder(frame.subfolder)}/thumbs`, type: frame.type || 'output' })
/** The first-frame POSTER of a video file (320 px JPEG, `<video name>.jpg` under <previews>/posters/), made on the pod by the same job: what a video tile shows until play is clicked. */
export const posterUrl = (base, file) => viewUrl(base, { filename: `${file.filename}.jpg`, subfolder: `${previewFolder(file.subfolder)}/posters`, type: file.type || 'output' })
export const previewUrl = (base, frame) => viewUrl(base, { filename: jpgName(frame.filename), subfolder: previewFolder(frame.subfolder), type: frame.type || 'output' })

const pollMs = () => globalThis.__FP_POLL_MS__ ?? 1500
let timer = null
const message = (e) => e?.response?.data?.detail || e?.message || String(e)
export const jobRunning = () => fpState.job?.state === 'running'
/** How many frames the job has handled (written, skipped or failed) of the frames it knows about. */
export const jobDone = () => (fpState.job ? fpState.job.done + fpState.job.skipped + (fpState.job.failed?.length || 0) : 0)
/** Is this sequence folder in the running job? */
export const inJob = (srcDir) => jobRunning() && (fpState.job.items || []).some((i) => i.src_dir === srcDir)
/** Failed frames of the current/last job for one sequence folder: Set of JPEG names. */
export const failedOf = (srcDir) => new Set((fpState.job?.failed || []).filter((f) => f.src_dir === srcDir).map((f) => f.frame))
const failReason = (srcDir, jpg) => (fpState.job?.failed || []).find((f) => f.src_dir === srcDir && f.frame === jpg)?.reason || ''
export { failReason }

/** One batched listing: how many JPEGs each folder has (and their names when `names`). A pod that is not running says why in fpState.error and nothing is shown. */
export async function refreshListing(podId, srcDirs, names = false) {
  const dirs = [...new Set(srcDirs.filter(Boolean))]; if (!podId || !dirs.length) return
  try {
    const r = await framePreviewsAPI.list({ pod_id: podId, items: dirs.map((d) => ({ src_dir: d })), names })
    for (const d of dirs) { const p = r?.previews?.[d] || { count: 0 }; fpState.listing[d] = { count: p.count || 0, names: p.names ? new Set(p.names) : fpState.listing[d]?.names || null, thumbs: p.thumbs ? new Set(p.thumbs) : fpState.listing[d]?.thumbs || null, posters: p.posters ? new Set(p.posters) : fpState.listing[d]?.posters || null } }
    fpState.error = ''; fpState.listed++
  } catch (e) { fpState.error = message(e) }
}

const REFRESH_MS = () => globalThis.__FP_REFRESH_MS__ ?? 3000
let lastRefresh = 0
// One SSH listing for every gallery that asks within a moment (a page of runs mounts many galleries at once); a folder already listed with its names is not asked again.
const asked = new Map()   // podId -> Set<src_dir>
let flushTimer = null
export function queueListing(podId, srcDirs) {
  if (!podId) return
  const set = asked.get(podId) || new Set()
  for (const d of srcDirs) if (d && !fpState.listing[d]?.names) set.add(d)
  if (!set.size) return
  asked.set(podId, set)
  if (!flushTimer) flushTimer = setTimeout(flush, 200)
}
async function flush() {
  flushTimer = null
  const todo = [...asked.entries()]; asked.clear()
  for (const [podId, set] of todo) { const dirs = [...set]; for (let i = 0; i < dirs.length; i += 40) await refreshListing(podId, dirs.slice(i, i + 40), true) }
}

async function poll() {
  timer = null
  const j = fpState.job; if (!j || j.state !== 'running') return
  try {
    const s = await framePreviewsAPI.status({ job_id: j.id })
    if (s) fpState.job = { ...j, ...s }
  } catch (e) { fpState.error = message(e) }
  if (fpState.job?.state === 'running') {
    if (Date.now() - lastRefresh >= REFRESH_MS()) { lastRefresh = Date.now(); await refreshListing(fpState.job.pod_id, (fpState.job.items || []).map((i) => i.src_dir), true) }   // the strips fill in while the job runs
    timer = setTimeout(poll, pollMs())
  }
  else if (fpState.job) await refreshListing(fpState.job.pod_id, (fpState.job.items || []).map((i) => i.src_dir), true)   // the pod says what it wrote
}
/** Start the job: `items` are { src_dir, frames } for every sequence it covers. One job at a time. */
export async function startJob({ podId, items, skipExisting = true, tone }) {
  if (jobRunning()) return fpState.job
  fpState.error = ''
  try {
    const j = await framePreviewsAPI.start({ pod_id: podId, items, skip_existing: skipExisting, ...(tone ? { tone } : {}) })
    fpState.job = j
    if (timer) clearTimeout(timer)
    timer = setTimeout(poll, pollMs())
    return j
  } catch (e) { fpState.error = message(e); return null }
}
export async function stopJob() {
  const j = fpState.job; if (!j || j.state !== 'running') return
  try { await framePreviewsAPI.cancel({ job_id: j.id }); fpState.job = { ...j, state: 'cancelled' } } catch (e) { fpState.error = message(e) }
  if (timer) { clearTimeout(timer); timer = null }
  await refreshListing(j.pod_id, (j.items || []).map((i) => i.src_dir), true)
}

/** A job that stopped (failed, cancelled, or done with folders that did not finish or frames that failed) can be run again. */
export const canRelaunch = () => {
  const j = fpState.job; if (!j || j.state === 'running') return false
  return j.state !== 'done' || (j.failed?.length || 0) > 0 || (j.items || []).some((i) => !(j.done_dirs || []).includes(i.src_dir))
}
/** Run the stopped job again: the same folders minus the finished ones, finished frames skipped, no pod is started (the core answers `needs_pod` and the window offers Resume Pod). */
export async function relaunchJob() {
  const j = fpState.job; if (!j || j.state === 'running') return null
  fpState.error = ''; fpState.needsPod = null
  try {
    const r = await framePreviewsAPI.relaunch({ job_id: j.id })
    if (r?.needs_pod) { fpState.needsPod = r.needs_pod; return null }
    if (r?.nothing_to_do) { fpState.error = ''; await refreshListing(j.pod_id, (j.items || []).map((i) => i.src_dir), true); return null }
    fpState.job = r.job
    if (timer) clearTimeout(timer)
    timer = setTimeout(poll, pollMs())
    return r.job
  } catch (e) { fpState.error = message(e); return null }
}
/** Remove the finished or failed job from the window (the window's own record; the JPEGs on the pod stay). */
export function removeJob() { const j = fpState.job; if (!j || j.state === 'running') return; fpState.job = null; fpState.needsPod = null; fpState.error = '' }
