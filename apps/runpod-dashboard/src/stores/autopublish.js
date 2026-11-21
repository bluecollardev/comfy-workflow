import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { autopublishAPI } from '../api/autopublish'

/**
 * Auto-publish (docs/ADR-050 amendment): the rule's status (pending uploads with their countdown), the settings and the shot versions marked approved.
 * One loop, never two requests at once: every second while something waits or uploads or a window that shows it is open (`fast`), every 10 seconds otherwise.
 * `old` says the core predates it: every control hides quietly.
 */
export const FAST_MS = 1000, IDLE_MS = 10000
const LIVE = ['waiting', 'uploading']
export const useAutopublishStore = defineStore('autopublish', () => {
  const status = ref(null), settings = ref(null), reviews = ref([]), old = ref(false), error = ref('')
  const fast = ref(false)
  let timer = null, busy = false, loop = false
  const errText = (e) => e?.response?.data?.detail || e?.message || String(e)
  const enabled = computed(() => !!status.value?.enabled)
  const pending = computed(() => status.value?.pending || [])
  const recent = computed(() => status.value?.recent || [])
  const activeCount = computed(() => pending.value.filter((p) => LIVE.includes(p.state)).length)

  async function refresh() {
    if (busy) return
    busy = true
    try { const s = await autopublishAPI.status(); if (s.old) { old.value = true; status.value = null } else { old.value = false; status.value = s; const hc = s.watching?.held; if (s.require_approval !== undefined && (hc === undefined ? !holdsLoaded : hc !== holds.value.length)) loadHolds() } error.value = '' } catch (e) { error.value = errText(e) } finally { busy = false }
  }
  function schedule() {
    if (timer || old.value) return
    timer = setTimeout(async () => { timer = null; await refresh(); if (!old.value) schedule() }, activeCount.value || fast.value ? FAST_MS : IDLE_MS)
  }
  async function watch() { await refresh(); loop = true; schedule() }
  const setFast = (v) => { fast.value = !!v; if (v && loop && timer) { clearTimeout(timer); timer = null; refresh().finally(schedule) } }
  async function loadSettings() { try { const s = await autopublishAPI.settings(); if (s.old) old.value = true; else settings.value = s } catch (e) { error.value = errText(e) } return settings.value }
  async function loadReviews() { try { const r = await autopublishAPI.reviews(); if (r.old) old.value = true; else reviews.value = r.reviews } catch (e) { error.value = errText(e) } }
  const reviewFor = (shot, version) => reviews.value.find((r) => String(r.shot).toLowerCase() === String(shot).toLowerCase() && Number(r.version) === Number(version)) || null
  async function afterChange() { await Promise.all([refresh(), loadSettings(), loadReviews()]); schedule() }
  async function setSettings(o) { const r = await autopublishAPI.setSettings(o); await afterChange(); return r }
  async function off() { const r = await autopublishAPI.off(); await afterChange(); return r }
  async function approve(shot, version, approved_by) { await autopublishAPI.approve({ shot, version, approved_by }); await Promise.all([loadReviews(), refresh()]); schedule() }
  async function revoke(shot, version) { await autopublishAPI.revoke({ shot, version }); await Promise.all([loadReviews(), refresh()]); schedule() }
  async function cancel(id) { await autopublishAPI.cancel({ id }); await refresh(); schedule() }
  async function generateExisting(o) { const r = await autopublishAPI.generateExisting(o); if (!o?.dry_run) { await refresh(); schedule() } return r }
  // Holds replace the approval as the safety valve (a core with `require_approval`): listed, kept from publishing, released here
  const holds = ref([])
  const hasHolds = computed(() => status.value?.require_approval !== undefined)
  let holdsLoaded = false
  async function loadHolds() { if (!hasHolds.value) return; holdsLoaded = true; try { const r = await autopublishAPI.holds(); if (!r.old) holds.value = r.holds } catch { /* keep the list */ } }
  async function hold(shot, version) { await autopublishAPI.hold({ shot, version }); await Promise.all([refresh(), loadHolds()]); schedule() }
  async function release(shot, version) { await autopublishAPI.release({ shot, version }); await Promise.all([refresh(), loadHolds()]); schedule() }
  const requireApproval = computed(() => status.value?.require_approval !== false)   // off only when the core says so: an older core is approval-first
  const dryRunReport = () => autopublishAPI.dryRunReport()
  async function scanVolume() { const r = await autopublishAPI.scanVolume(); await refresh(); schedule(); return r }
  async function publishNow(id, approved_by) { await autopublishAPI.publishNow({ id, approved_by }); await refresh(); schedule() }
  async function publishAllDry(approved_by) { const r = await autopublishAPI.publishAllDry({ approved_by }); await refresh(); schedule(); return r }
  return { dryRunReport, holds, hasHolds, loadHolds, hold, release, requireApproval, generateExisting, scanVolume, status, settings, reviews, old, error, fast, enabled, pending, recent, activeCount, refresh, watch, setFast, loadSettings, loadReviews, reviewFor, setSettings, off, approve, revoke, cancel, publishNow, publishAllDry }
})
