import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { podsAPI } from '../api/pods'
import { t } from '../i18n'
import { usePodsStore } from './pods'
import { errorText, useToastStore } from './toast'

const EVERY_MIN = 2            // the default the core uses (every_s 120): the page offers no other
const POLL_MS = 6000
const RECENT_MS = 10 * 60_000   // a finished watch stays on screen this long, so the person sees what came of it

/** Retry Later (ADR-042 section 19): the watches that keep trying to resume a stopped pod or create a pod until RunPod has a card.
 *  Asked every 6 seconds from the core's own file: no request to RunPod is made for it. */
export const usePodWatchStore = defineStore('podwatch', () => {
  const toast = useToastStore()
  const watches = ref([])
  let timer = null

  const waiting = computed(() => watches.value.filter((w) => w.state === 'waiting'))
  const recent = computed(() => watches.value.filter((w) => w.state !== 'waiting' && w.finished_at && Date.now() - Date.parse(w.finished_at) < RECENT_MS))
  /** The waiting resume watch of a pod, if there is one. */
  const forPod = (podId) => waiting.value.find((w) => w.kind === 'resume' && w.pod_id === podId) || null

  async function refresh() {
    try {
      const before = new Set(waiting.value.map((w) => w.id))
      watches.value = (await podsAPI.watches()) || []
      // one that was waiting and is not any more: a pod came up (or the wait ended): the list on screen follows at once
      if ([...before].some((id) => !waiting.value.some((w) => w.id === id))) { try { await usePodsStore().load() } catch { /* the list refreshes by itself */ } }
    } catch { /* the list just stays as it was */ }
  }
  function watch() { if (!timer) { refresh(); timer = setInterval(refresh, POLL_MS) } }
  function stop() { if (timer) { clearInterval(timer); timer = null } }

  /** Keep trying to resume a stopped pod whose host has no free GPU. */
  async function retryResumeLater(podId) {
    const r = await toast.run(t('pod.retryLater'), () => podsAPI.resumeWhenFree(podId, {}), { ok: t('toast.retryLaterSet', { n: EVERY_MIN }) })
    if (r.ok) { usePodsStore().hostFull = null; await refresh() }
    return r
  }
  /** Keep trying to create the pod of this form when no card is free. */
  async function retryCreateLater(payload) {
    let text = null
    const r = await toast.run(t('form.retryLater'), () => podsAPI.createWhenFree(payload, {}), { ok: t('toast.retryLaterCreateSet', { n: EVERY_MIN }), onError: (m) => (text = m) })
    if (r.ok) await refresh()
    return { ...r, text: text || (r.error ? errorText(r.error) : null) }
  }
  async function cancel(id) {
    const r = await toast.run(t('podWatch.cancel'), () => podsAPI.cancelWatch(id), { ok: t('toast.watchCancelled') })
    await refresh()
    return r
  }
  return { watches, waiting, recent, forPod, refresh, watch, stop, retryResumeLater, retryCreateLater, cancel, EVERY_MIN }
})
