import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { panamaAPI } from '../api/panama'
import { errorText } from './toast'

/**
 * The Panama exchange bucket as an Import Shot Pack source (docs/ADR-015, ADR-016): is it configured, the rounds in it, a round's
 * size, and the download of one round, either to the staging folder on this PC (Local) or onto the network volume by a pod (Pod,
 * docs/ADR-022). A download is a job in the core, polled here. The rows have one shape for both targets.
 */
const KEY = 'runpod-manager.panama-target'
const POD_DONE = ['done', 'failed', 'cancelled']
export const usePanamaStore = defineStore('panama', () => {
  const status = ref(null)       // { configured, profile, bucket, region, staging, reason, pod: { available, reason, volume } }
  const rounds = ref([])         // Local: what is on this PC
  const podView = ref({ as_of: null, volume: null, rounds: [] })   // Pod: what was last seen on the volume
  const sizes = ref({})          // round -> { files, bytes }
  const job = ref(null)          // the running or last download or delete (a Pod job carries `route`)
  const loading = ref(false)
  const error = ref(null)
  let timer = null

  // Local | Pod, a per-viewer choice kept in this browser. Pod only counts while the core says it is available.
  const wanted = ref('local')
  try { wanted.value = localStorage.getItem(KEY) === 'pod' ? 'pod' : 'local' } catch { /* storage blocked: local */ }
  const podAvailable = computed(() => !!status.value?.pod?.available)
  const target = computed(() => (wanted.value === 'pod' && podAvailable.value ? 'pod' : 'local'))
  const rows = computed(() => (target.value === 'pod' ? podView.value.rounds : rounds.value))
  const isPodJob = (j) => !!j && j.route !== undefined
  const jobActive = computed(() => !!job.value && (isPodJob(job.value) ? !POD_DONE.includes(job.value.state) : ['running', 'verifying'].includes(job.value.state)))

  async function loadStatus() {
    try { status.value = await panamaAPI.status() } catch (e) { status.value = { configured: false, reason: errorText(e) } }
    return status.value
  }
  async function loadRounds() {
    loading.value = true; error.value = null
    try { rounds.value = await panamaAPI.rounds() } catch (e) { error.value = errorText(e) } finally { loading.value = false }
  }
  async function loadPod() {
    loading.value = true; error.value = null
    try { podView.value = await panamaAPI.podRounds() } catch (e) { error.value = errorText(e) } finally { loading.value = false }
  }
  const reload = () => (target.value === 'pod' ? loadPod() : loadRounds())
  function setTarget(t) {
    wanted.value = t === 'pod' ? 'pod' : 'local'
    try { localStorage.setItem(KEY, wanted.value) } catch { /* storage blocked */ }
    confirming.value = null; removing.value = null; removePlan.value = null
    return reload()
  }
  async function loadSize(round) {
    try { sizes.value = { ...sizes.value, [round]: await panamaAPI.size(round) } } catch (e) { error.value = errorText(e) }
  }

  // ---- start a download. Local starts at once; Pod asks first (it starts or uses a pod, which costs), from the plan the core makes.
  const confirming = ref(null)   // { round, plan } waiting for Start / Cancel
  async function pull(round) {
    error.value = null
    if (target.value === 'pod') {
      try { confirming.value = { round, plan: await panamaAPI.podPlan(round) } } catch (e) { error.value = errorText(e) }
      return
    }
    try { job.value = await panamaAPI.pull(round); poll() } catch (e) { error.value = errorText(e) }
  }
  async function confirmStart(route) {
    const c = confirming.value; if (!c) return
    confirming.value = null; error.value = null
    try { job.value = await panamaAPI.podPull(c.round, route); poll() } catch (e) { error.value = errorText(e) }
  }
  const cancelConfirm = () => { confirming.value = null }

  // ---- delete the staged copy: on this PC, or on the volume (a pod job, so it is planned and confirmed too)
  const removing = ref(null)     // the round whose Delete is awaiting its confirmation
  const removePlan = ref(null)   // Pod: what the delete would start
  async function askRemove(round) {
    error.value = null
    if (target.value === 'pod') {
      try { removePlan.value = await panamaAPI.podPlan(round) } catch (e) { error.value = errorText(e); return }
    }
    removing.value = round
  }
  const cancelRemove = () => { removing.value = null; removePlan.value = null }
  async function remove(round) {
    error.value = null
    try {
      if (target.value === 'pod') { job.value = await panamaAPI.podRemove(round); poll() }
      else { await panamaAPI.remove(round); if (job.value?.round === round && !isPodJob(job.value)) job.value = null }
      cancelRemove()
    } catch (e) { error.value = errorText(e) }
    await reload()
  }
  async function cancel() {
    if (!job.value) return
    try { job.value = isPodJob(job.value) ? await panamaAPI.podCancel(job.value.id) : await panamaAPI.cancel(job.value.id) } catch (e) { error.value = errorText(e) }
    reload()
  }
  function poll() {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      if (!job.value) return
      const pod = isPodJob(job.value)
      try { job.value = pod ? await panamaAPI.podJob(job.value.id) : await panamaAPI.job(job.value.id) } catch (e) { error.value = errorText(e); return }
      if (jobActive.value) poll()
      else reload()
    }, 1000)
  }
  return { status, rounds, podView, sizes, job, loading, error, wanted, target, podAvailable, rows, jobActive, loadStatus, loadRounds, loadPod, reload, setTarget, loadSize, pull, confirming, confirmStart, cancelConfirm, cancel, remove, askRemove, cancelRemove, removing, removePlan }
})
