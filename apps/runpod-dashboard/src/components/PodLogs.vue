<template>
  <div :class="modal ? 'p-3' : 'mt-2'" data-testid="pod-logs">
    <div class="d-flex align-items-center gap-2 mb-1">
      <small class="text-body-secondary">{{ $t('pod.logsHint') }}</small>
      <small v-if="state.error" class="text-danger" data-testid="pod-logs-error">{{ $t('pod.logsError', { error: state.error }) }}</small>
      <small v-else-if="state.ended" class="text-body-secondary">{{ $t('pod.logsEnded') }}</small>
    </div>
    <pre ref="box" class="small bg-body-tertiary rounded p-2 mb-0 pod-logs" :class="{ 'pod-logs-modal': modal }" data-testid="pod-logs-lines"><template v-if="!state.lines.length">{{ $t('pod.noLogs') }}</template><template v-else><div v-for="(l, i) in state.lines" :key="i" :class="l.source === 'container' ? '' : 'text-body-secondary'"><span class="text-body-secondary">{{ l.ts ? l.ts.slice(11, 19) : '' }}</span> {{ l.line }}</div></template></pre>
  </div>
</template>

<script setup>
/**
 * PodLogs — the pod's log stream from RunPod (container stdout/stderr and the host's lifecycle
 * lines: pulling the image, starting, stopping), with a backfill then live, through api/logs.js.
 * Keeps the last 500 lines and follows the bottom. Stops the stream when unmounted.
 */
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { subscribe } from '../api/logs'

const props = defineProps({ podId: { type: String, required: true }, modal: { type: Boolean, default: false } })
const MAX = 500
const state = reactive({ lines: [], ended: false, error: null })
const box = ref(null)
let stop = null

onMounted(() => {
  stop = subscribe(props.podId, { tail: 100 }, (p) => {
    if (p.event) { state.lines.push(p.event); if (state.lines.length > MAX) state.lines.splice(0, state.lines.length - MAX) }
    if (p.end) state.ended = true
    if (p.error) state.error = p.error
  })
})
onBeforeUnmount(() => { if (stop) stop() })
watch(() => state.lines.length, () => nextTick(() => { if (box.value) box.value.scrollTop = box.value.scrollHeight }))
</script>

<style scoped>
.pod-logs { max-height: 16rem; overflow: auto; white-space: pre-wrap; word-break: break-all; }
.pod-logs-modal { max-height: 70vh; }
</style>
