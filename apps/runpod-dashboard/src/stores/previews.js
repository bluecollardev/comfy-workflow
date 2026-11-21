import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { sharedThumbs } from '../utils/thumbs'
import { previewBus } from '../utils/thumbsBus'
import { FAILURES_CAP, failureRecord, historyNote, summaryNote, retrySelection } from '../utils/generations'
import { historyAPI } from '../api/history'

/**
 * The preview batch ("Generate all previews") as a job of the app, not of the Outputs window (docs/ADR-051): it works through the sequences one at a time (the thumbnail store's own queue),
 * keeps going when the window is closed, shows in the Queue's Generations, and Stop ends it. The tiles pick their results up from `results` when they are on screen (a finished preview is in the cache: no download).
 */
export const usePreviewsStore = defineStore('previews', () => {
  const batch = ref(null)           // { id, state: running|done|cancelled, label, total, done, failed, started_at, finished_at }
  const results = reactive({})      // thumb key -> { status, reason?, code? }: what the batch found for it
  const version = ref(0)            // bumped for each finished item, so tiles look again
  let stopFlag = false, current = '', seq = 0
  let heldItems = []                // the items of the last batch (key + job), kept so Retry Failed can ask again for exactly the failed ones
  const running = computed(() => batch.value?.state === 'running')

  /** `podId` is the pod the batch reads from (Retry Failed checks it is running); `retryOf` is the id of the batch a retry continues (the results of the ones that worked are kept then). */
  async function start(items, label = '', scope = '', refresh = false, podId = '', retryOf = 0) {
    if (running.value || !items.length) return
    if (!retryOf) for (const k of Object.keys(results)) delete results[k]
    stopFlag = false
    const id = ++seq
    heldItems = items
    batch.value = { id, state: 'running', label, scope, refresh, pod_id: podId || '', retry_of: retryOf || 0, total: items.length, done: 0, failed: 0, failures: [], failed_keys: [], started_at: new Date().toISOString(), finished_at: '' }
    const thumbs = sharedThumbs()
    for (const it of items) {
      if (stopFlag) break
      current = it.key
      let r
      try { r = await thumbs.request(it.key, it.job, { manual: true, refresh }) } catch (e) { r = { status: 'error', reason: e?.message || String(e) } }
      current = ''
      if (stopFlag || r.status === 'aborted') break
      if (batch.value.id !== id) return
      results[it.key] = r
      batch.value.done++
      if (r.status === 'error') {
        batch.value.failed_keys.push(it.key)   // every failed key is kept (the failures list is capped, this is what Retry Failed asks for)
        const f = failureRecord(it, r, label), index = batch.value.failed++   // the History gets the first 20 one by one, then one summary at the end
        if (batch.value.failures.length < FAILURES_CAP) batch.value.failures.push(f)
        const n = historyNote(f, index); if (n) writeNote(n)
      }
      if (r.status === 'ready') previewBus.cacheVer++
      version.value++
    }
    if (batch.value?.id === id) { const sum = summaryNote(batch.value); if (sum) writeNote(sum); batch.value.state = stopFlag ? 'cancelled' : 'done'; batch.value.finished_at = new Date().toISOString() }
  }
  const writeNote = (n) => { try { Promise.resolve(historyAPI.note(n)).catch(() => {}) } catch { /* the History is never in the way */ } }
  function stop() {
    if (!running.value) return
    stopFlag = true
    if (current) sharedThumbs().abort(current)
    batch.value.state = 'cancelled'; batch.value.finished_at = new Date().toISOString()
  }
  /** Ask again for exactly the items that failed, on the same pod and with the same Skip Existing, as a new batch linked to this one. Nothing while a batch runs or when nothing failed. */
  function retryFailed() {
    const b = batch.value
    if (running.value || !b || !b.failed_keys?.length) return false
    const items = retrySelection(heldItems, b.failed_keys)
    if (!items.length) return false
    start(items, b.label, b.scope, b.refresh === true, b.pod_id, b.id)
    return true
  }
  const clearResults = () => { for (const k of Object.keys(results)) delete results[k]; version.value++ }
  const dismiss = () => { if (!running.value) batch.value = null }
  return { batch, results, version, running, start, stop, retryFailed, clearResults, dismiss }
})
