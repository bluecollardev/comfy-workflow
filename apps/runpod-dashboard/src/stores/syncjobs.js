import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { volumesyncAPI } from '../api/volumesync'
import { sourcesyncAPI } from '../api/sourcesync'
import { bucketsyncAPI } from '../api/bucketsync'
import { storageAPI } from '../api/storage'

/**
 * The jobs of the Sync window's new pairs (docs/ADR-066, ADR-067): a volume's copy to a storage (kind 'volume-sync') and a download to this PC (kind 'source-sync') and a bucket to bucket copy through a pod (kind 'bucket-sync').
 * `watch()` polls both every 2 s while the Queue shows; quiet on a core without them (the call answers old).
 */
export const useSyncJobsStore = defineStore('syncjobs', () => {
  const jobs = ref([])
  let watchers = 0, timer = null, busy = false
  const live = computed(() => jobs.value.filter((j) => ['uploading', 'downloading'].includes(j.state)))
  // `storage-upload`: the Upload On events (Generated, Approved, ...) copying to a storage (docs/ADR-064)
  async function refresh() {
    if (busy) return
    busy = true
    try {
      const [a, b, c, d] = await Promise.allSettled([volumesyncAPI.status(), sourcesyncAPI.status(), storageAPI.uploads(), bucketsyncAPI.status()])
      jobs.value = [...(a.status === 'fulfilled' ? a.value.jobs : []), ...(b.status === 'fulfilled' ? b.value.jobs : []), ...(c.status === 'fulfilled' ? c.value.jobs : []), ...(d.status === 'fulfilled' ? d.value.jobs : [])]
    } finally { busy = false }
  }
  function watch() { watchers++; refresh(); if (!timer) timer = setInterval(refresh, 2000) }
  function unwatch() { watchers = Math.max(0, watchers - 1); if (!watchers && timer) { clearInterval(timer); timer = null } }
  async function cancel(j) { if (j.kind === 'storage-upload') await storageAPI.cancelUpload(j.job_id); else await (j.kind === 'source-sync' ? sourcesyncAPI : j.kind === 'bucket-sync' ? bucketsyncAPI : volumesyncAPI).cancel(j.job_id); await refresh() }
  return { jobs, live, refresh, watch, unwatch, cancel }
})
