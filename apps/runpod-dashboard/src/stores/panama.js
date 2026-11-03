import { defineStore } from 'pinia'
import { ref } from 'vue'
import { panamaAPI } from '../api/panama'
import { errorText } from './toast'

/**
 * The Panama exchange bucket as an Import Shot Pack source (docs/ADR-015): is it configured, the rounds in it, a round's
 * size, and the download of one round to the staging folder (a job in the core, polled here).
 */
export const usePanamaStore = defineStore('panama', () => {
  const status = ref(null)       // { configured, profile, bucket, region, staging, reason }
  const rounds = ref([])
  const sizes = ref({})          // round -> { files, bytes }
  const job = ref(null)          // the running or last download
  const loading = ref(false)
  const error = ref(null)
  let timer = null

  async function loadStatus() {
    try { status.value = await panamaAPI.status() } catch (e) { status.value = { configured: false, reason: errorText(e) } }
    return status.value
  }
  async function loadRounds() {
    loading.value = true; error.value = null
    try { rounds.value = await panamaAPI.rounds() } catch (e) { error.value = errorText(e) } finally { loading.value = false }
  }
  async function loadSize(round) {
    try { sizes.value = { ...sizes.value, [round]: await panamaAPI.size(round) } } catch (e) { error.value = errorText(e) }
  }
  async function pull(round) {
    error.value = null
    try { job.value = await panamaAPI.pull(round); poll() } catch (e) { error.value = errorText(e) }
  }
  const removing = ref(null)   // the round whose Delete is awaiting its confirmation
  async function remove(round) {
    error.value = null
    try { await panamaAPI.remove(round); if (job.value?.round === round) job.value = null; removing.value = null } catch (e) { error.value = errorText(e) }
    await loadRounds()
  }
  async function cancel() {
    if (!job.value) return
    try { job.value = await panamaAPI.cancel(job.value.id) } catch (e) { error.value = errorText(e) }
    loadRounds()
  }
  function poll() {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      if (!job.value) return
      try { job.value = await panamaAPI.job(job.value.id) } catch (e) { error.value = errorText(e); return }
      if (['running', 'verifying'].includes(job.value?.state)) poll()
      else loadRounds()
    }, 1000)
  }
  return { status, rounds, sizes, job, loading, error, loadStatus, loadRounds, loadSize, pull, cancel, remove, removing }
})
