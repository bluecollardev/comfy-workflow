import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ratelimitAPI } from '../api/ratelimit'

/** Whether RunPod is limiting the app's requests (ADR-042 section 18). Asked every 5 seconds from the core's own memory: no request to RunPod is made for it. */
export const useRateLimitStore = defineStore('ratelimit', () => {
  const status = ref({ limited: false, window: null, retry_at: null, since: null, stale_age_s: null, message: null })
  let timer = null
  async function refresh() { try { status.value = (await ratelimitAPI.status()) || status.value } catch { /* the banner just stays as it was */ } }
  function watch() { if (!timer) { refresh(); timer = setInterval(refresh, 5000) } }
  function stop() { if (timer) { clearInterval(timer); timer = null } }
  const limited = computed(() => !!status.value.limited)
  /** "HH:MM" of the next try. */
  const retryAt = computed(() => (status.value.retry_at ? new Date(status.value.retry_at).toTimeString().slice(0, 5) : ''))
  /** Whole minutes the lists on screen are old, or null when nothing was served from the cache. */
  const ageMin = computed(() => (status.value.stale_age_s == null ? null : Math.max(0, Math.round(status.value.stale_age_s / 60))))
  return { status, limited, retryAt, ageMin, refresh, watch, stop }
})
