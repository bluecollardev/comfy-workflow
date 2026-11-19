import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { failuresAPI } from '../api/failures'

/** The graph failures list: loaded when the Queue opens, refreshed every 5 s while it is open; `old` hides everything on a core without it. */
export const useFailuresStore = defineStore('failures', () => {
  const items = ref([]), old = ref(false), loaded = ref(false), error = ref('')
  let timer = null, busy = false
  async function refresh() {
    if (busy) return
    busy = true
    try { const r = await failuresAPI.list(); old.value = !!r.old; items.value = r.items; error.value = '' } catch (e) { error.value = e?.response?.data?.detail || e?.message || String(e) } finally { busy = false; loaded.value = true }
  }
  function use(on) { clearInterval(timer); timer = null; if (on) { refresh(); timer = setInterval(refresh, 5000) } }
  async function retry(id) { await failuresAPI.retry(id); await refresh() }
  return { items, old, loaded, error, count: computed(() => items.value.length), refresh, use, retry }
})
