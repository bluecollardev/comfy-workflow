import { defineStore } from 'pinia'
import { ref } from 'vue'

const KEY = 'runflows.picked.v1'

/** Run workflows (ADR-037): what the person ticked, kept per pod so closing the window (or the app) does not lose it.
 *  The run itself is not kept here: it lives in the core, and the window finds it again by asking for the pod's latest. */
export const useRunflowsStore = defineStore('runflows', () => {
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} } }
  const picked = ref(read())   // { [podId]: string[] }
  const pickedFor = (podId) => (Array.isArray(picked.value[podId]) ? picked.value[podId] : null)
  function setPicked(podId, paths) {
    picked.value = { ...picked.value, [podId]: [...paths] }
    try { localStorage.setItem(KEY, JSON.stringify(picked.value)) } catch { /* private window or blocked storage: the selection just lasts this session */ }
  }
  return { picked, pickedFor, setPicked }
})
