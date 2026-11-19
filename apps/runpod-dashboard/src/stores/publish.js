import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { publishAPI } from '../api/publish'
import { publishActive } from '../utils/publish'

/**
 * Publishing: the app-wide settings (secrets never come back, only hints) and the publish jobs, polled every second while one is active
 * (never two requests at once), so closing the Publish window loses nothing. `old` says the core predates Publishing.
 */
export const POLL_MS = 1000
export const usePublishStore = defineStore('publish', () => {
  const settings = ref({ s3: { ready: false }, slack: { ready: false }, defaults: { targets: [], message: '' } })
  const loaded = ref(false), old = ref(false), error = ref('')
  const jobs = ref([])
  let timer = null, busy = false
  const errText = (e) => e?.response?.data?.detail || e?.message || String(e)
  async function loadSettings() {
    try { const r = await publishAPI.settings(); old.value = !!r.old; settings.value = { s3: r.s3, slack: r.slack, defaults: r.defaults }; error.value = '' } catch (e) { error.value = errText(e) } finally { loaded.value = true }
    return settings.value
  }
  async function save(body) { const r = await publishAPI.setSettings(body); settings.value = { s3: r.s3, slack: r.slack, defaults: r.defaults }; old.value = false; return settings.value }
  async function refresh() {
    if (busy) return
    busy = true
    try { const r = await publishAPI.status(); jobs.value = r.jobs; if (r.old) old.value = true; error.value = '' } catch (e) { error.value = errText(e) } finally { busy = false }
  }
  const active = computed(() => jobs.value.some(publishActive))
  function schedule() { if (timer || !active.value) return; timer = setTimeout(async () => { timer = null; await refresh(); schedule() }, POLL_MS) }
  async function watch() { await refresh(); schedule() }
  async function runBackfill(o) { const r = await publishAPI.backfill.run(o); await refresh(); schedule(); return r }
  async function run(o) { const r = await publishAPI.run(o); await refresh(); schedule(); return r }
  async function cancel(id) { await publishAPI.cancel(id); await refresh(); schedule() }
  async function repost(id) { await publishAPI.slack({ job_id: id }); await refresh(); schedule() }
  const job = (id) => jobs.value.find((j) => j.job_id === id) || null
  const latest = computed(() => [...jobs.value].sort((a, b) => String(b.started_at || b.job_id).localeCompare(String(a.started_at || a.job_id)))[0] || null)
  return { runBackfill, settings, loaded, old, error, jobs, active, latest, job, loadSettings, save, refresh, watch, run, cancel, repost }
})
