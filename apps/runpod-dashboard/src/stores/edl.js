import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { edlAPI } from '../api/edl'

/**
 * The EDL (docs/ADR-050): what the core has loaded and its elements (clip, shot, element, frames in the cut, speeds), for the pickers and the flags.
 * `old` says the core predates it: everything that depends on it hides. Loaded once; asked again after Load.
 */
export const shotOfClip = (name) => (/^([A-Za-z]+-\d+[a-z]?)/i.exec(String(name || '')) || [, ''])[1].toLowerCase()
export const useEdlStore = defineStore('edl', () => {
  const status = ref({ old: false, loaded: false }), elements = ref([]), seen = ref(false), loading = ref(false), error = ref('')
  const old = computed(() => !!status.value.old), loaded = computed(() => !!status.value.loaded)
  const clipSet = computed(() => new Set(elements.value.map((e) => e.clip)))
  async function refresh() {
    try { status.value = await edlAPI.status(); if (status.value.loaded) elements.value = await edlAPI.elements(); else elements.value = [] } catch { /* keep what is shown */ } finally { seen.value = true }
  }
  async function load(opts) {
    loading.value = true; error.value = ''
    try { status.value = await edlAPI.load(opts); if (status.value.error) error.value = status.value.error; elements.value = status.value.loaded ? await edlAPI.elements() : [] } catch (e) { error.value = e?.response?.data?.detail || e?.message || String(e) } finally { loading.value = false; seen.value = true }
  }
  /** The elements of one shot (the clip-name picker's suggestions). */
  const forShot = (shot) => elements.value.filter((e) => !shot || e.shot === shot)
  /** 'match' | 'none' | '' (unknown: no EDL loaded). */
  const matchOf = (clip) => (!loaded.value ? '' : clipSet.value.has(clip) ? 'match' : 'none')
  let asked = false
  const ensure = () => { if (!asked) { asked = true; return refresh() } return Promise.resolve() }
  return { status, elements, seen, loading, error, old, loaded, refresh, load, forShot, matchOf, ensure }
})
