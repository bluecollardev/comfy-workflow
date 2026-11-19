import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { publishAPI } from '../api/publish'
import { publishActive } from '../utils/publish'

/**
 * Publishing: the app-wide settings (secrets never come back, only hints) and the publish jobs, polled every second while one is active
 * (never two requests at once), so closing the Publish window loses nothing. `old` says the core predates Publishing.
 */
export const POLL_MS = 1000
export const IDLE_MS = 10000
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
  // One non-overlapping loop: 1 s while a job runs or the Queue is open, 10 s otherwise once the app asked for it (watchAlways); without that it polls only while a job is active, as the Publish window needs.
  let always = false, fast = false
  let timerFast = false
  function schedule() {
    if (old.value || (!active.value && !always)) return
    const wantFast = active.value || fast
    if (timer && (timerFast || !wantFast)) return
    clearTimeout(timer)   // an idle wait is cut short when a job starts or the Queue opens
    timerFast = wantFast
    timer = setTimeout(async () => { timer = null; await refresh(); schedule() }, wantFast ? POLL_MS : IDLE_MS)
  }
  async function watch() { await refresh(); schedule() }
  async function watchAlways() { always = true; await watch() }
  function setFast(on) { fast = !!on; if (on) { clearTimeout(timer); timer = null; refresh().then(schedule) } }
  // The Queue's Publishing section: manual publishes and backfill uploads (Auto-publish has its own section; a scan is not a publish). Running first, then the last 20 finished; Dismiss is local to this app.
  const dismissed = ref(new Set((() => { try { return JSON.parse(localStorage.getItem('runpod-manager.publish-dismissed') || '[]') } catch { return [] } })()))
  const dismiss = (id) => { dismissed.value = new Set([...dismissed.value, id]); try { localStorage.setItem('runpod-manager.publish-dismissed', JSON.stringify([...dismissed.value].slice(-200))) } catch { /* storage blocked */ } }
  const queueJobs = computed(() => {
    const own = jobs.value.filter((j) => j.trigger !== 'auto-publish' && j.kind !== 'scan' && !dismissed.value.has(j.job_id))
    const when = (j) => String(j.started_at || j.job_id)
    const running = own.filter(publishActive).sort((a, b) => when(b).localeCompare(when(a)))
    return [...running, ...own.filter((j) => !publishActive(j)).sort((a, b) => when(b).localeCompare(when(a))).slice(0, 20)]
  })
  const runningCount = computed(() => jobs.value.filter((j) => j.trigger !== 'auto-publish' && j.kind !== 'scan' && publishActive(j)).length)
  async function runBackfill(o) { const r = await publishAPI.backfill.run(o); await refresh(); schedule(); return r }
  async function run(o) { const r = await publishAPI.run(o); await refresh(); schedule(); return r }
  async function cancel(id) { await publishAPI.cancel(id); await refresh(); schedule() }
  async function retry(id) { await publishAPI.retry(id); await refresh(); schedule() }
  async function repost(id) { await publishAPI.slack({ job_id: id }); await refresh(); schedule() }
  const job = (id) => jobs.value.find((j) => j.job_id === id) || null
  const latest = computed(() => [...jobs.value].sort((a, b) => String(b.started_at || b.job_id).localeCompare(String(a.started_at || a.job_id)))[0] || null)
  return { retry, watchAlways, setFast, queueJobs, runningCount, dismiss, runBackfill, settings, loaded, old, error, jobs, active, latest, job, loadSettings, save, refresh, watch, run, cancel, repost }
})
