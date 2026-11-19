import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { rendersAPI } from '../api/renders'
import { DEFAULT_WIDTH, isActive, jobFor, seqKey, latestReview } from '../utils/renders'

/**
 * Render sequences (docs/ADR-048): the render jobs and where each sequence's proxy is. A STORE-level job: it is polled every second while one is active
 * (never two requests at once; a failed poll keeps what is shown and tries again), so closing the Previews window or the Outputs window loses nothing and reopening shows it.
 * The proxy list is one batched call per window open (loadProxies), asked again when a job finishes.
 */
export const POLL_MS = 1000, IDLE_MS = 5000
export const useRendersStore = defineStore('renders', () => {
  const jobs = ref([])
  const old = ref(false)          // the core predates Render sequences
  const error = ref('')
  const proxies = ref({})         // `${dir}/${name}` -> { width, exists_local, exists_remote, local_url, remote_ready, bytes, modified }
  const deliverables = ref([])    // the review videos the core found (per shot and version)
  const play = ref(null)          // { dir, name, review } a window asks the gallery to open in the viewer
  const finished = ref(0)         // counts jobs that ended while the app watched
  const prefs = reactive({ width: DEFAULT_WIDTH, fps: 'auto', where: 'auto', preset: 'none', pull: true, allowPartial: false, kind: 'proxy', h264: false, prores: true })
  let timer = null, busy = false, activeIds = new Set(), ctx = null, polls = 0
  const errText = (e) => e?.response?.data?.detail || e?.message || String(e)

  const active = computed(() => jobs.value.some(isActive))
  const jobForPod = (podId) => jobFor(jobs.value, podId)

  async function refresh() {
    if (busy) return
    busy = true; polls++
    try {
      const r = await rendersAPI.status()
      jobs.value = r.jobs; old.value = r.old; error.value = ''
      const now = new Set(r.jobs.filter(isActive).map((j) => j.job_id))
      const ended = [...activeIds].some((id) => !now.has(id))
      activeIds = now
      if (ended) { finished.value++; reloadProxies() }
    } catch (e) { error.value = errText(e) } finally { busy = false }
  }
  // One loop, never two requests at once and tolerant of errors: every second while a job runs or the Queue window is open (`fast`), every 5 seconds otherwise (the Queue's badge and the windows follow it).
  // A core without the calls (old) stops it: the Generations section is hidden quietly.
  const fast = ref(false), dismissed = ref([]), scopes = ref({})   // scopes: job_id -> the Generate scope it started with (this window's own note: 'in output/…' or 'all outputs')
  let loop = false
  function schedule() {
    if (timer || old.value) return
    timer = setTimeout(async () => { timer = null; await refresh(); if (!old.value) schedule() }, active.value || fast.value ? POLL_MS : IDLE_MS)
  }
  /** Look for jobs (a window opening) and keep following them. */
  async function watch() { await refresh(); loop = true; schedule() }
  const setFast = (v) => { fast.value = !!v; if (v && loop && timer) { clearTimeout(timer); timer = null; refresh().finally(schedule) } }
  const dismiss = (id) => { if (!dismissed.value.includes(id)) dismissed.value = [...dismissed.value, id] }
  const activeCount = computed(() => jobs.value.filter(isActive).length)

  async function start(o) {
    const r = await rendersAPI.start(o)
    await refresh(); schedule()
    return r
  }
  async function cancel(jobId) { await rendersAPI.cancel(jobId); await refresh(); schedule() }

  /** One batched call for the tiles of a window; what the core does not list is forgotten. */
  async function loadProxies(o) {
    ctx = o
    if (!o?.items?.length) return
    try {
      const r = await rendersAPI.proxies(o)
      old.value = old.value || r.old
      const next = { ...proxies.value }
      for (const it of o.items) delete next[seqKey(it)]
      for (const p of r.items) if (p.exists_local || p.exists_remote) next[seqKey(p)] = p
      proxies.value = next; deliverables.value = r.deliverables
    } catch (e) { error.value = errText(e) }
  }
  const reloadProxies = () => (ctx ? loadProxies(ctx) : undefined)
  const proxyFor = (s) => proxies.value[seqKey(s)] || null
  const reviewFor = (s) => latestReview(deliverables.value, s)

  async function clearLocal() {
    const r = await rendersAPI.clearLocal()
    await reloadProxies()
    return r
  }
  return { scopes, fast, setFast, dismissed, dismiss, activeCount, jobs, old, error, proxies, finished, prefs, active, jobForPod, refresh, watch, start, cancel, loadProxies, reloadProxies, proxyFor, reviewFor, deliverables, play, clearLocal, polls: () => polls }
})
