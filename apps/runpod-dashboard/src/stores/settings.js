import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { settingsAPI } from '../api/settings'
import { usePodsStore } from './pods'

/** The app-wide settings: whether a RunPod key is stored. Nothing that reaches RunPod works without one,
 *  so the app is "ready" only with a key (or in no-spend mode, where nothing reaches RunPod). */
export const useSettingsStore = defineStore('settings', () => {
  const pods = usePodsStore()
  const keyInfo = ref({ runpod_api_key_set: false, runpod_api_key_hint: '', source: 'none' })
  const loaded = ref(false)
  async function load() {
    try { keyInfo.value = await settingsAPI.get() } catch { /* no settings endpoint: the key may come from the environment */ }
    loaded.value = true
    return keyInfo.value
  }
  const keySet = computed(() => !!keyInfo.value.runpod_api_key_set)
  const ready = computed(() => keySet.value || pods.dryRun)
  return { keyInfo, loaded, keySet, ready, load }
})
