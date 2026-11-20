<template>
  <div :class="modal ? 'p-3' : 'mt-2'" data-testid="pod-logs">
    <div class="d-flex align-items-center gap-2 mb-1">
      <small class="text-body-secondary">{{ $t('pod.logsHint') }}</small>
      <small v-if="state.error" class="text-danger" data-testid="pod-logs-error">{{ $t('pod.logsError', { error: state.error }) }}</small>
      <small v-else-if="state.ended" class="text-body-secondary">{{ $t('pod.logsEnded') }}</small>
    </div>
    <!-- the logs this pod left behind, kept when a run ends, when it stops and before it is deleted: still here after the pod has stopped -->
    <div class="d-flex align-items-center gap-2 flex-wrap mb-1" data-testid="pod-logs-saved">
      <small class="text-body-secondary">{{ $t('pod.savedLogs', { n: saved.length }) }}</small>
      <select v-if="saved.length" v-model="picked" class="form-select form-select-sm w-auto" data-testid="pod-logs-saved-pick" :aria-label="$t('pod.savedLogs', { n: saved.length })" @change="openSaved">
        <option value="">{{ $t('pod.savedLogsLive') }}</option>
        <option v-for="l in saved" :key="l.name" :value="l.name">{{ l.modified.slice(0, 19).replace('T', ' ') }} · {{ sizeText(l.bytes) }}</option>
      </select>
      <BButton size="sm" variant="outline-light" data-testid="pod-logs-save-now" :disabled="saving" @click="saveNow"><BSpinner v-if="saving" small class="me-1" />{{ $t('pod.saveLogsNow') }}</BButton>
      <BButton v-if="saved.length" size="sm" variant="outline-danger" data-testid="pod-logs-delete-pod" @click="purge(props.podId)">{{ $t('pod.deletePodLogs') }}</BButton>
      <BButton size="sm" variant="outline-danger" data-testid="pod-logs-purge-all" @click="purge('')">{{ $t('pod.purgeAllLogs') }}</BButton>
      <small v-if="savedError" class="text-danger" data-testid="pod-logs-saved-error">{{ savedError }}</small>
    </div>
    <pre v-if="picked" class="small bg-body-tertiary rounded p-2 mb-0 pod-logs" :class="{ 'pod-logs-modal': modal }" data-testid="pod-logs-saved-text">{{ savedText }}</pre>
    <pre v-show="!picked" ref="box" class="small bg-body-tertiary rounded p-2 mb-0 pod-logs" :class="{ 'pod-logs-modal': modal }" data-testid="pod-logs-lines"><template v-if="!state.lines.length">{{ $t('pod.noLogs') }}</template><template v-else><div v-for="(l, i) in state.lines" :key="i" :class="l.source === 'container' ? '' : 'text-body-secondary'"><span class="text-body-secondary">{{ l.ts ? l.ts.slice(11, 19) : '' }}</span> {{ l.line }}</div></template></pre>
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
import { podlogsAPI } from '../api/podlogs'
import { errorText } from '../stores/toast'
import { useConfirmStore } from '../stores/confirm'
import { useI18n } from 'vue-i18n'

const props = defineProps({ podId: { type: String, required: true }, modal: { type: Boolean, default: false } })
const MAX = 500
const state = reactive({ lines: [], ended: false, error: null })
const box = ref(null)
let stop = null
const confirm = useConfirmStore(), { t } = useI18n()
const saved = ref([]), picked = ref(''), savedText = ref(''), saving = ref(false), savedError = ref('')
const sizeText = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
async function loadSaved() { saved.value = (await podlogsAPI.list(props.podId)).logs }
async function openSaved() { savedError.value = ''; savedText.value = ''; if (!picked.value) return; try { savedText.value = (await podlogsAPI.read(picked.value)).text } catch (e) { savedError.value = errorText(e) } }
/** Delete saved logs: this pod's or everyone's, only after the person says yes. */
async function purge(podId) {
  const all = !podId, n = all ? (await podlogsAPI.list('')).logs.length : saved.value.length
  if (!(await confirm.ask(t(all ? 'pod.confirmPurgeAllLogs' : 'pod.confirmDeletePodLogs', { n }), { okLabel: t(all ? 'pod.purgeAllLogs' : 'pod.deletePodLogs') }))) return
  savedError.value = ''
  try { await podlogsAPI.purge(podId); picked.value = ''; savedText.value = ''; await loadSaved() } catch (e) { savedError.value = errorText(e) }
}
async function saveNow() { saving.value = true; savedError.value = ''; try { const r = await podlogsAPI.save(props.podId); await loadSaved(); picked.value = `${r.path.split('/').slice(-2).join('/')}`; await openSaved() } catch (e) { savedError.value = errorText(e) } finally { saving.value = false } }

onMounted(() => {
  loadSaved()
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
