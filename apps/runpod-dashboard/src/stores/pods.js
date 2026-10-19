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
    timer = setInterval(load, REFRESH_MS)
  }
  function stopAutoRefresh() {
    if (timer) clearInterval(timer)
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
  const resume = (id) => act(id, podsAPI.resumePod, 'Resume')
  const remove = (id) => act(id, podsAPI.deletePod, 'Delete')

  return { stats, pods, dryRun, initialLoading, refreshing, loadError, actionError, busyPodId, load, refreshList, startAutoRefresh, stopAutoRefresh, create, stop, resume, remove }
})
