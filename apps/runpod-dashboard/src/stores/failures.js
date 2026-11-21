import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { failuresAPI } from '../api/failures'

/**
 * The graph failures list: loaded when the Queue opens, refreshed every 5 s while it is open; `old` hides everything on a core without it.
 * `items` are the failures the Queue shows (not dismissed, at most 500); `count` counts only those. A dismissed failure is hidden by id (the core keeps failures.jsonl
 * as it is): `dismissedCount` says how many are hidden, `showDismissed` loads them into `dismissedItems` so each can be restored.
 */
export const useFailuresStore = defineStore('failures', () => {
  const items = ref([]), dismissedItems = ref([]), dismissedCount = ref(0), showDismissed = ref(false), old = ref(false), loaded = ref(false), error = ref('')
  let timer = null, busy = false
  async function refresh() {
    if (busy) return
    busy = true
    try {
      const r = await failuresAPI.list({ limit: 500 }); old.value = !!r.old; items.value = r.items; dismissedCount.value = r.dismissed_count || 0; error.value = ''
      if (showDismissed.value && !r.old) dismissedItems.value = (await failuresAPI.list({ limit: 500, dismissed: 'only' })).items; else dismissedItems.value = []
    } catch (e) { error.value = e?.response?.data?.detail || e?.message || String(e) } finally { busy = false; loaded.value = true }
  }
  function use(on) { clearInterval(timer); timer = null; if (on) { refresh(); timer = setInterval(refresh, 5000) } }
  async function retry(id) { await failuresAPI.retry(id); await refresh() }
  /** How many a Dismiss All (or Restore All) would cover: the confirm names it. */
  const planAll = (restore = false) => failuresAPI.plan({ all: true, restore })
  async function dismiss(ids) { const r = await failuresAPI.dismiss({ ids }); await refresh(); return r }
  async function dismissAll() { const r = await failuresAPI.dismiss({ all: true }); await refresh(); return r }
  async function restore(ids) { const r = await failuresAPI.restore({ ids }); await refresh(); return r }
  async function restoreAll() { const r = await failuresAPI.restore({ all: true }); await refresh(); return r }
  async function toggleDismissed(on) { showDismissed.value = on === undefined ? !showDismissed.value : !!on; await refresh() }
  return { items, dismissedItems, dismissedCount, showDismissed, old, loaded, error, count: computed(() => items.value.length), refresh, use, retry, planAll, dismiss, dismissAll, restore, restoreAll, toggleDismissed }
})
