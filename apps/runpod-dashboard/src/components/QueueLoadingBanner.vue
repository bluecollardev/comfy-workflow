<template>
  <!-- inside the Queue window, above its tabs (no floating layer over the modal): its data is on its way, slow, or failed -->
  <BAlert v-if="queueBanner" :model-value="true" :variant="queueBanner.error ? 'danger' : 'info'" class="mb-2 py-2 px-3 small d-flex align-items-center flex-wrap gap-2" data-testid="queue-loading-banner" :data-state="queueBanner.error ? 'error' : queueBanner.slow ? 'slow' : 'loading'">
    <template v-if="queueBanner.error"><i class="fa-solid fa-circle-exclamation me-2"></i><span data-testid="queue-loading-text">{{ $t('queue.banner.error', { reason: queueBanner.error }) }}</span><BButton size="sm" variant="outline-light" class="py-0 ms-2" data-testid="queue-loading-retry" @click="retry">{{ $t('queue.banner.retry') }}</BButton></template>
    <template v-else><BSpinner small class="me-2 flex-shrink-0" data-testid="queue-loading-spinner" /><span data-testid="queue-loading-text">{{ $t(queueBanner.slow ? 'queue.banner.slow' : 'queue.banner.loading') }}</span></template>
  </BAlert>
</template>

<script setup>
/** QueueLoadingBanner: 'Loading the queue…' (after 5 s: the volume is slow to answer) while the Queue window's data loads; a failure says why with Retry. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiStore } from '../stores/ui'
import { useAutopublishStore } from '../stores/autopublish'
import { usePublishStore } from '../stores/publish'

const ui = useUiStore(), ap = useAutopublishStore(), pub = usePublishStore()
const slow = ref(false)
let slowTimer = null
onMounted(() => { if (!pub.loaded) pub.loadSettings() })   // the Publishing tab may not be open: the banner asks for what it waits on
onBeforeUnmount(() => clearTimeout(slowTimer))
const error = computed(() => ui.queueListError || (!ap.old && ap.error) || (!pub.old && pub.error) || '')
const loading = computed(() => !error.value && (!ui.queueListLoaded || (!ap.old && !ap.status) || (!pub.old && !pub.loaded)))   // only the data the Queue needs: never the background volume scan (it made the banner spin for ever, 2026-11-21)
watch(loading, (l) => { clearTimeout(slowTimer); slow.value = false; if (l) slowTimer = setTimeout(() => { slow.value = true }, 5000) }, { immediate: true })
const queueBanner = computed(() => (error.value ? { error: error.value } : loading.value ? { slow: slow.value } : null))
function retry() { ui.queueListError = ''; ui.queueRetry++; ap.error = ''; pub.error = ''; ap.refresh(); pub.loadSettings(); pub.refresh() }
</script>
