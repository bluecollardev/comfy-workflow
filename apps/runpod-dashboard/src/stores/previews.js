import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { sharedThumbs } from '../utils/thumbs'
import { previewBus } from '../utils/thumbsBus'
import { FAILURES_CAP, failureRecord, historyNote, summaryNote } from '../utils/generations'
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
  const running = computed(() => batch.value?.state === 'running')

  async function start(items, label = '', scope = '', refresh = false) {
    if (running.value || !items.length) return
    for (const k of Object.keys(results)) delete results[k]
    stopFlag = false
    const id = ++seq
    batch.value = { id, state: 'running', label, scope, total: items.length, done: 0, failed: 0, failures: [], started_at: new Date().toISOString(), finished_at: '' }
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
  const clearResults = () => { for (const k of Object.keys(results)) delete results[k]; version.value++ }
  const dismiss = () => { if (!running.value) batch.value = null }
  return { batch, results, version, running, start, stop, clearResults, dismiss }
})
