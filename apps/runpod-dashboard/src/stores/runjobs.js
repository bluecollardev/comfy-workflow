import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { runflowsAPI } from '../api/runflows'

/**
 * The render runs (graph runs through the app's endpoint, window, queue, or another process) for the Queue's Generations and its badge. A STORE-level poll like the renders store:
 * every 2 seconds while a run is active or the Queue is open (`fast`), every 6 seconds otherwise; never two requests at once; a failed poll keeps what is shown.
 * A core without `runflows.jobs` (old) stops it quietly.
 */
export const POLL_MS = 2000, IDLE_MS = 6000
export const useRunJobsStore = defineStore('runjobs', () => {
  const jobs = ref([]), old = ref(false), error = ref(''), fast = ref(false)
  let timer = null, busy = false, loop = false
  const active = computed(() => jobs.value.filter((j) => j.state === 'running'))
  const activeCount = computed(() => active.value.length)
  const errText = (e) => e?.response?.data?.detail || e?.message || String(e)

  async function refresh() {
    if (busy || old.value) return
    busy = true
    try {
      const r = await runflowsAPI.jobs()
      jobs.value = Array.isArray(r?.jobs) ? r.jobs : []; error.value = ''
    } catch (e) {
      if (e?.response?.status === 404 || /unknown (namespace|method|call)|no such handler/i.test(errText(e))) old.value = true
      error.value = errText(e)
    } finally { busy = false }
  }
  function schedule() {
    if (timer || old.value) return
    timer = setTimeout(async () => { timer = null; await refresh(); if (!old.value) schedule() }, activeCount.value || fast.value ? POLL_MS : IDLE_MS)
  }
  /** Look for runs (the app or the Queue opening) and keep following them. */
  async function watch() { if (loop) return; await refresh(); loop = true; schedule() }
  const setFast = (v) => { fast.value = !!v; if (v && loop && timer) { clearTimeout(timer); timer = null; refresh().finally(schedule) } }
  /** Cancel a run (the same cancel the Run Workflows window uses; another process's run is asked through the registry). */
  async function cancel(j) { await runflowsAPI.cancel(j.job_id); await refresh(); schedule() }
  return { jobs, old, error, active, activeCount, refresh, watch, setFast, cancel }
})
