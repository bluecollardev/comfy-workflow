import { defineStore } from 'pinia'
import { ref } from 'vue'
import { podsAPI } from '../api/pods'
import { errorText, useToastStore } from './toast'
import { t } from '../i18n'

/**
 * The pods and their stats, and every action on them. One source of truth for the dashboard:
 * App loads it and keeps it fresh, Stats and Dashboard read it, PodForm and the cards act
 * through it. Each action reports through the toast store and refreshes the list after a
 * success; `actionError` holds the last failure for an inline alert.
 */
export const REFRESH_MS = 30_000
export const STARTING_REFRESH_MS = 5_000   // while a pod is coming up, poll fast so the card follows it

export const usePodsStore = defineStore('pods', () => {
  const toast = useToastStore()
  const stats = ref({})
  const pods = ref([])
  const initialLoading = ref(true)
  const refreshing = ref(false)
  const loadError = ref(null)
  const actionError = ref(null)
  const busyPodId = ref(null)
  const dryRun = ref(false)
  let timer = null

  /** GET /api/dashboard: stats and the list. The first load shows the page spinner; later ones only spin the button. */
  async function load() {
    refreshing.value = true
    try {
      const d = await podsAPI.getDashboard()
      stats.value = d.stats || {}
      pods.value = d.pods || []
      dryRun.value = d.dry_run === true
      loadError.value = null
    } catch (e) {
      loadError.value = errorText(e) || 'Failed to load dashboard'
    } finally {
      refreshing.value = false
      initialLoading.value = false
    }
  }

  async function refreshList() {
    pods.value = await podsAPI.listPods()
  }

  function startAutoRefresh() {
    stopAutoRefresh()
    const tick = async () => {
      await load()
      timer = setTimeout(tick, pods.value.some((p) => p.status === 'starting') ? STARTING_REFRESH_MS : REFRESH_MS)
    }
    timer = setTimeout(tick, REFRESH_MS)
  }
  function stopAutoRefresh() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  /** Create a pod from the form's payload; returns the toast outcome plus `text` for the form's
   *  own inline alert (the form shows a create failure, the dashboard alert does not repeat it).
   *  The list refreshes on success. */
  async function create(payload) {
    let text = null
    const r = await toast.run(t('toast.createPod'), () => podsAPI.createPod(payload), { ok: t('toast.podCreated', { name: payload.name }), onError: (msg) => (text = msg) })
    if (r.ok) await load()   // the list and the stats
    return { ...r, text }
  }

  const LABEL = { Stop: 'toast.stopPod', Resume: 'toast.resumePod', Delete: 'toast.deletePod' }
  const DONE = { Stop: 'toast.podStopped', Resume: 'toast.podResumed', Delete: 'toast.podDeleted' }
  async function act(podId, action, label) {
    busyPodId.value = podId
    actionError.value = null
    const r = await toast.run(t(LABEL[label]), () => action(podId), { ok: t(DONE[label]), onError: (msg) => (actionError.value = msg) })
    if (r.ok) await load()   // the list and the stats
    busyPodId.value = null
    return r
  }
  const stop = (id) => act(id, podsAPI.stopPod, 'Stop')

  /** Stop every running pod at once: the pause button. Nothing bills GPU time afterwards. */
  async function stopAll() {
    const running = pods.value.filter((p) => p.status === 'running' || p.status === 'starting')
    if (!running.length) { toast.info(t('toast.nothingRunning')); return { ok: true, value: 0 } }
    actionError.value = null
    const r = await toast.run(t('toast.pauseAll'), async () => { for (const p of running) await podsAPI.stopPod(p.id); return running.length }, { ok: t('toast.pausedAll', { n: running.length }), onError: (msg) => (actionError.value = msg) })
    await load()
    return r
  }
  const HOST_FULL = /not enough free GPUs on the host/i
  const resume = async (id) => {
    const r = await act(id, podsAPI.resumePod, 'Resume')
    if (r.ok) startAutoRefresh()
    else if (HOST_FULL.test(errorText(r.error))) { hostFull.value = id; toast.info(t('toast.hostFull')) }
    return r
  }
  const hostFull = ref(null)   // the stopped pod whose host has no free GPU: its card offers Recreate

  /** A fresh pod with the same settings on another host; the old one is terminated. */
  async function recreate(id) {
    busyPodId.value = id
    actionError.value = null
    const r = await toast.run(t('toast.recreatePod'), () => podsAPI.recreate(id), { ok: t('toast.podRecreated'), onError: (msg) => (actionError.value = msg) })
    if (r.ok) { hostFull.value = null; await load(); startAutoRefresh() }
    busyPodId.value = null
    return r
  }

  /** The pod as RunPod describes it, for the card's details panel. */
  const details = (id) => podsAPI.details(id)
  const remove = (id) => act(id, podsAPI.deletePod, 'Delete')

  return { stats, pods, dryRun, initialLoading, refreshing, loadError, actionError, busyPodId, load, refreshList, startAutoRefresh, stopAutoRefresh, create, stop, stopAll, resume, remove, details, recreate, hostFull }
})
