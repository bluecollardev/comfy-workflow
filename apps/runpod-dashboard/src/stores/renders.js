import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { rendersAPI } from '../api/renders'
import { DEFAULT_WIDTH, isActive, jobFor, seqKey, latestReview } from '../utils/renders'

/**
 * Render sequences (docs/ADR-048): the render jobs and where each sequence's proxy is. A STORE-level job: it is polled every second while one is active
 * (never two requests at once; a failed poll keeps what is shown and tries again), so closing the Previews window or the Outputs window loses nothing and reopening shows it.
 * The proxy list is one batched call per window open (loadProxies), asked again when a job finishes.
 */
export const POLL_MS = 1000
export const useRendersStore = defineStore('renders', () => {
  const jobs = ref([])
  const old = ref(false)          // the core predates Render sequences
  const error = ref('')
  const proxies = ref({})         // `${dir}/${name}` -> { width, exists_local, exists_remote, local_url, remote_ready, bytes, modified }
  const deliverables = ref([])    // the review videos the core found (per shot and version)
  const play = ref(null)          // { dir, name, review } a window asks the gallery to open in the viewer
  const finished = ref(0)         // counts jobs that ended while the app watched
  const prefs = reactive({ width: DEFAULT_WIDTH, fps: 'auto', where: 'auto', pull: true, allowPartial: false, kind: 'proxy', h264: false, prores: true })
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
  function schedule() {
    if (timer || !active.value) return
    timer = setTimeout(async () => { timer = null; await refresh(); schedule() }, POLL_MS)
  }
  /** Look for jobs (a window opening) and keep polling while one runs. */
  async function watch() { await refresh(); schedule() }

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
  return { jobs, old, error, proxies, finished, prefs, active, jobForPod, refresh, watch, start, cancel, loadProxies, reloadProxies, proxyFor, reviewFor, deliverables, play, clearLocal, polls: () => polls }
})
