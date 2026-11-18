import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { syncsAPI } from '../api/syncs'

/**
 * The Sync explorer's data (docs/ADR-046): active syncs and the watch state every second, finished runs every 5 s,
 * only while something shows them (the Queue window's Syncs section asks with use() and lets go with release()).
 * Never two requests of one kind at once; a failed poll keeps what was on screen and notes the reason.
 */
export const FAST_MS = 1000, RECENT_MS = 5000
export const useSyncsStore = defineStore('syncs', () => {
  const active = ref([])
  const watch = ref({ paused: false, pull: [], push: [], events: [] })
  const recent = ref([])
  const old = ref(false)       // the core predates the explorer
  const error = ref('')
  const loaded = ref(false)
  const users = ref(0)
  let gen = 0, timer = null, fastBusy = false, recentBusy = false, lastRecent = 0
  const errText = (e) => e?.response?.data?.detail || e?.message || String(e)

  async function pollFast() {
    if (fastBusy) return
    fastBusy = true
    try {
      const [a, w] = await Promise.all([syncsAPI.active(), syncsAPI.watch()])
      active.value = a.items; watch.value = w; old.value = a.old || w.old; error.value = ''; loaded.value = true
    } catch (e) { error.value = errText(e) } finally { fastBusy = false }
  }
  async function pollRecent() {
    if (recentBusy) return
    recentBusy = true; lastRecent = Date.now()
    try { const r = await syncsAPI.recent(null, 10); recent.value = r.runs; if (r.old) old.value = true } catch (e) { error.value = errText(e) } finally { recentBusy = false }
  }
  async function tick(g) {
    if (!users.value || g !== gen) return
    const jobs = [pollFast()]
    if (Date.now() - lastRecent >= RECENT_MS) jobs.push(pollRecent())
    await Promise.all(jobs)
    if (users.value && g === gen) timer = setTimeout(() => tick(g), FAST_MS)
  }
  function use() { users.value++; if (users.value === 1) { gen++; lastRecent = 0; tick(gen) } }
  function release() { users.value = Math.max(0, users.value - 1); if (!users.value) { gen++; clearTimeout(timer); timer = null } }
  const count = computed(() => active.value.length)
  return { active, watch, recent, old, error, loaded, count, use, release, refresh: () => Promise.all([pollFast(), pollRecent()]) }
})
