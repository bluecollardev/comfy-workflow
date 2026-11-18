import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { autosyncAPI, DEFAULTS } from '../api/autosync'
import { isActive } from '../utils/autosync'
import { usePodsStore } from './pods'

/**
 * Auto sync (docs/ADR-046): every pod's settings and the controller's status. Polled every 2 s while any pod has
 * auto sync on or an item is active, every 10 s otherwise; never two requests at once; an error changes nothing
 * on screen (the next poll tries again). The core answers from memory: no request to RunPod is made for it.
 */
export const FAST_MS = 2000, SLOW_MS = 10000
export const useAutosyncStore = defineStore('autosync', () => {
  const settings = ref({})   // podId -> { enabled, pull, push, approved_by }
  const paused = ref(false)
  const items = ref([])
  const now = ref(Date.now())   // the clock the banner reads, ticked while mounted so a done item can leave by itself
  let timer = null, busy = false, running = false, clock = null

  const byPod = (id) => items.value.find((i) => i.pod_id === id) || null
  const enabled = (id) => !!settings.value[id]?.enabled
  const anyEnabled = computed(() => Object.values(settings.value).some((s) => s?.enabled))
  const anyActive = computed(() => items.value.some(isActive))

  async function loadSettings(id) {
    try { const g = await autosyncAPI.get(id); settings.value = { ...settings.value, [id]: g } } catch { /* keeps what it had */ }   // read settings.value after the await: parallel loads must not overwrite each other
  }
  async function refresh() {
    if (busy) return
    busy = true
    try {
      try { const s = await autosyncAPI.status(); paused.value = s.paused; items.value = s.items } catch { /* keeps what it had */ }
      const pods = usePodsStore().pods || []
      await Promise.all(pods.map((p) => loadSettings(p.id)))
    } finally { busy = false }
  }
  function schedule() {
    if (!running) return
    timer = setTimeout(async () => { await refresh(); schedule() }, anyEnabled.value || anyActive.value ? FAST_MS : SLOW_MS)
  }
  function start() {
    if (running) return
    running = true
    refresh().finally(schedule)
    clock = setInterval(() => { now.value = Date.now() }, 500)
  }
  function stop() { running = false; clearTimeout(timer); timer = null; clearInterval(clock); clock = null }

  async function save(podId, s) {
    const saved = await autosyncAPI.set(podId, s)
    settings.value = { ...settings.value, [podId]: saved }
    refresh()
    return saved
  }
  const act = async (fn, ...a) => { try { await fn(...a) } finally { refresh() } }
  const pause = (on) => act(autosyncAPI.pause, on)
  const syncNow = (id) => act(autosyncAPI.syncNow, id)
  const approve = (id, yes) => act(autosyncAPI.approve, id, yes)
  const dismiss = (id) => act(autosyncAPI.dismiss, id)

  return { settings, paused, items, now, anyEnabled, anyActive, byPod, enabled, loadSettings, refresh, start, stop, save, pause, syncNow, approve, dismiss, DEFAULTS }
})
