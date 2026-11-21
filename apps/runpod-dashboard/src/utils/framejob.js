import { reactive } from 'vue'
import { framePreviewsAPI } from '../api/framepreviews'
import { viewUrl } from './outputs'

// Frame previews are a JOB on the pod (libs/core/src/framepreviews.ts): one small JPEG per DPX frame under output/.previews/<the sequence's folder>/. This is the window's side of it: the mode
// choice (Sequence Previews, today's first-frame thumbnails read to this PC; Frame Previews, the pod job), the one running job, and what the pod says exists.
const KEY = 'pod-manager-preview-mode'
const readMode = () => { try { return sessionStorage.getItem(KEY) === 'frame' ? 'frame' : 'sequence' } catch { return 'sequence' } }
export const fpState = reactive({ mode: readMode(), job: null, /** src_dir -> { count, names: Set<string> | null } */ listing: {}, error: '', listed: 0 })
export const setMode = (m) => { fpState.mode = m === 'frame' ? 'frame' : 'sequence'; try { sessionStorage.setItem(KEY, fpState.mode) } catch { /* the choice lasts as long as the page */ } }

export const jpgName = (dpxName) => String(dpxName).replace(/\.dpx$/i, '') + '.jpg'
/** The folder of a sequence's previews under output/ (the core's rule: a mirror tree, never inside the frame folder). */
export const previewFolder = (srcDir) => `.previews/${String(srcDir || '').replace(/\/+$/, '')}`
/** The address of one frame's JPEG: the same /view address as any output file. */
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
    for (const d of dirs) { const p = r?.previews?.[d] || { count: 0 }; fpState.listing[d] = { count: p.count || 0, names: p.names ? new Set(p.names) : fpState.listing[d]?.names || null } }
    fpState.error = ''; fpState.listed++
  } catch (e) { fpState.error = message(e) }
}

async function poll() {
  timer = null
  const j = fpState.job; if (!j || j.state !== 'running') return
  try {
    const s = await framePreviewsAPI.status({ job_id: j.id })
    if (s) fpState.job = { ...j, ...s }
  } catch (e) { fpState.error = message(e) }
  if (fpState.job?.state === 'running') timer = setTimeout(poll, pollMs())
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
