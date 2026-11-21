import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { framePreviewsAPI } from '../api/framepreviews'
import { orderRows, isRunning, isFinished } from '../utils/previewjobs'

/**
 * The frame-previews jobs (frames, thumbnails, posters) for the Queue's Generations and its badge (Lucas, 2026-11-21: "i should see previews jobs in queue no?"). The same STORE-level poll as the
 * render runs (runjobs): every 2 seconds while a job runs or the Queue is open (`fast`), every 6 seconds otherwise, never two requests at once, a failed poll keeps what is shown, a core without
 * `framepreviews.jobs` stops it quietly. Remove hides a finished row for this session only (the previews on the pod stay; nothing is deleted).
 */
export const POLL_MS = 2000, IDLE_MS = 6000
export const usePreviewJobsStore = defineStore('previewjobs', () => {
  const jobs = ref([]), old = ref(false), error = ref(''), fast = ref(false), dismissed = ref([])
  /** job_id -> the core's `needs_pod` answer of a Relaunch with no pod running: { stopped: [{ id, name }], hint } */
  const needsPod = ref({})
  const note = ref({})   // job_id -> a line to show under the row (relaunch said nothing to do, an error)
  let timer = null, busy = false, loop = false
  const rows = computed(() => orderRows(jobs.value, dismissed.value))
  const active = computed(() => jobs.value.filter(isRunning))
  const activeCount = computed(() => active.value.length)
  const finished = computed(() => rows.value.filter(isFinished))
  const errText = (e) => e?.response?.data?.detail || e?.message || String(e)

  async function refresh() {
    if (busy || old.value) return
    busy = true
    try {
      const r = await framePreviewsAPI.jobs()
      jobs.value = Array.isArray(r) ? r : Array.isArray(r?.jobs) ? r.jobs : []; error.value = ''
    } catch (e) {
      if (e?.response?.status === 404 || /unknown (namespace|method|call)|no such handler|no core call/i.test(errText(e))) old.value = true
      error.value = errText(e)
    } finally { busy = false }
  }
  function schedule() {
    if (timer || old.value) return
    timer = setTimeout(async () => { timer = null; await refresh(); if (!old.value) schedule() }, activeCount.value || fast.value ? POLL_MS : IDLE_MS)
  }
  /** Look for jobs (the app or the Queue opening) and keep following them. */
  async function watch() { if (loop) return; await refresh(); loop = true; schedule() }
  const setFast = (v) => { fast.value = !!v; if (v && loop && timer) { clearTimeout(timer); timer = null; refresh().finally(schedule) } }
  const dismiss = (id) => { if (!dismissed.value.includes(id)) dismissed.value = [...dismissed.value, id] }
  const dismissFinished = () => { for (const j of finished.value) dismiss(j.job_id) }
  /** Stop a job (the same for this app's and another process's: its owner is asked through the shared record). */
  async function cancel(j) {
    try { await framePreviewsAPI.cancelAny({ job_id: j.job_id }) } catch (e) { note.value = { ...note.value, [j.job_id]: errText(e) } }
    await refresh(); schedule()
  }
  /** Run a stopped job again: its unfinished folders on a pod that runs (never a new pod: with none the core answers `needs_pod`). */
  async function relaunch(j) {
    const next = { ...needsPod.value }; delete next[j.job_id]; needsPod.value = next
    note.value = { ...note.value, [j.job_id]: '' }
    try {
      const r = await framePreviewsAPI.relaunch({ job_id: j.job_id })
      if (r?.needs_pod) needsPod.value = { ...needsPod.value, [j.job_id]: r.needs_pod }
      else if (r?.nothing_to_do) note.value = { ...note.value, [j.job_id]: 'nothing' }
    } catch (e) { note.value = { ...note.value, [j.job_id]: errText(e) } }
    await refresh(); schedule()
  }
  const clearNeedsPod = (id) => { const n = { ...needsPod.value }; delete n[id]; needsPod.value = n }
  return { jobs, rows, old, error, active, activeCount, finished, needsPod, note, dismissed, refresh, watch, setFast, dismiss, dismissFinished, cancel, relaunch, clearNeedsPod }
})
