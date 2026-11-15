import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { volumesAPI } from '../api/volumes'
import { errorText } from './toast'

/**
 * The jobs that work on a volume (ADR-042 section 16): downloads, deletes, erases, clones, browses; and the pods of jobs lost at a restart.
 * One list for the Models window, the Queue and the nav badge. `watch()` starts a poll every 1.5 s while a window shows them (the same
 * `unwatch()` stops it), so a state change reaches the screen within a second or two, and a window opened later shows the running job.
 */
export const useVolumeJobsStore = defineStore('volumejobs', () => {
  const jobs = ref([]), interrupted = ref([]), running = ref(0), error = ref('')
  let watchers = 0, timer = null, busy = false
  const TERMINAL = ['done', 'failed', 'cancelled']
  const live = computed(() => jobs.value.filter((j) => !TERMINAL.includes(j.state)))

  async function refresh() {
    if (busy) return
    busy = true
    try { const r = await volumesAPI.jobs(); jobs.value = r.jobs || []; interrupted.value = r.interrupted || []; running.value = r.running ?? live.value.length; error.value = '' }
    catch (e) { error.value = errorText(e) }
    finally { busy = false }
  }
  function watch() { watchers++; refresh(); if (!timer) timer = setInterval(refresh, 1500) }
  function unwatch() { watchers = Math.max(0, watchers - 1); if (!watchers && timer) { clearInterval(timer); timer = null } }
  async function cancel(id) { await volumesAPI.cancel(id); await refresh() }
  async function dropInterrupted(name) { await volumesAPI.dropInterrupted(name); await refresh() }
  /** The job to show for a volume: the one running on it, else the newest of that volume (its result stays on screen). */
  const forVolume = (volumeId) => jobs.value.find((j) => j.volume_id === volumeId && !TERMINAL.includes(j.state)) || jobs.value.find((j) => j.volume_id === volumeId) || null
  return { jobs, interrupted, running, error, live, refresh, watch, unwatch, cancel, dropInterrupted, forVolume }
})
