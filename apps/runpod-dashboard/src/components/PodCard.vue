<template>
  <BCard class="h-100" body-class="d-flex flex-column" data-testid="pod-card" :data-name="pod.name">
    <div class="d-flex align-items-center gap-2 mb-3">
      <span v-if="handle" class="pod-handle text-body-secondary" draggable="true" role="button" :title="$t('pod.dragHandle')" :aria-label="$t('pod.dragHandle')" data-testid="pod-drag-handle" @dragstart="onHandleDragStart" @dragend="emit('dragend')"><i class="fa-solid fa-grip-vertical"></i></span>
      <template v-if="!renaming">
        <span class="fw-semibold fs-6 text-truncate flex-grow-1" style="min-width: 0" :title="pod.runpod_name ? $t('pod.runpodName', { name: pod.runpod_name }) : pod.name" data-testid="pod-name">{{ pod.name }}</span>
      </template>
      <div v-else class="input-group input-group-sm flex-grow-1" style="min-width: 0">
        <input v-model="draft" type="text" class="form-control" maxlength="80" :placeholder="pod.runpod_name || pod.name" :aria-label="$t('pod.editTitle')" data-testid="pod-rename-input" @keydown.enter="saveRename" @keydown.esc="renaming = false" />
        <button type="button" class="btn btn-primary" :title="$t('pod.renameSave')" data-testid="pod-rename-save" @click="saveRename"><i class="fa-solid fa-check"></i></button>
        <button type="button" class="btn btn-outline-light" :title="$t('pod.renameCancel')" data-testid="pod-rename-cancel" @click="renaming = false"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="d-flex align-items-center gap-2 ms-auto flex-shrink-0" data-testid="pod-head-actions">
        <BBadge v-if="pod.custom_config" variant="warning" text-indicator :title="$t('pod.ownConfigTitle')" data-testid="pod-config-badge">{{ $t('pod.ownConfig') }}</BBadge>
        <button v-if="!renaming" type="button" class="btn btn-outline-light edit-btn" :title="$t('pod.rename')" :aria-label="$t('pod.editTitle')" data-testid="pod-rename" @click="startRename"><i class="fa-solid fa-pencil"></i></button>
        <span class="status-dot" :class="`bg-${STATUS_VARIANT[pod.status] ?? 'secondary'}`" role="img" :title="$t(`pod.statuses.${pod.status}`)" :aria-label="$t(`pod.statuses.${pod.status}`)" data-testid="pod-status-dot" :data-status="pod.status"></span>
      </div>
    </div>

    <dl class="row g-1 small mb-3 flex-grow-1">
      <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.id') }}</dt>
      <dd class="col-8 mb-0">
        <code data-testid="pod-id">{{ pod.id }}</code>
        <a :href="pod.console_url || `https://console.runpod.io/pods?id=${pod.id}`" target="_blank" rel="noopener" class="ms-2 small" :title="$t('pod.console')" data-testid="pod-console">
          <i class="fa-solid fa-arrow-up-right-from-square fa-xs"></i> RunPod
        </a>
        <button type="button" class="btn btn-link btn-sm p-0 ms-2 align-baseline" :title="$t('pod.copyId')" data-testid="pod-copy-id" @click="copyId"><i class="fa-regular fa-copy fa-xs"></i></button>
      </dd>

      <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.statusLabel') }}</dt>
      <dd class="col-8 mb-0">
        <BBadge :variant="STATUS_VARIANT[pod.status] ?? 'secondary'" data-testid="pod-status" :data-status="pod.status">
          {{ $t(`pod.statuses.${pod.status}`) }}
        </BBadge>
      </dd>


      <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.gpu') }}</dt>
      <dd class="col-8 mb-0">{{ pod.gpu }}<span v-if="pod.vram" class="text-body-secondary"> · {{ pod.vram }} GB</span></dd>

      <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.round') }}</dt>
      <dd class="col-8 mb-0">
        <select class="form-select form-select-sm" :value="pod.round || ''" :disabled="busy" :aria-label="$t('pod.roundPick')" :title="$t('pod.roundTip')" data-testid="pod-round" @change="emit('round', $event.target.value)">
          <option value="">{{ $t('pod.roundNone') }}</option>
          <option v-for="r in roundOptions" :key="r.round" :value="r.round">{{ r.label }}</option>
        </select>
      </dd>

      <template v-if="pod.uptime_seconds">
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.uptime') }}</dt>
        <dd class="col-8 mb-0">{{ formatUptime(pod.uptime_seconds) }}</dd>
      </template>

      <template v-if="volume">   <!-- the network volume this pod is attached to (the Volumes list knows its pods, ADR-032) -->
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.volume') }}</dt>
        <dd class="col-8 mb-0" data-testid="pod-volume"><a href="#" :title="$t('pod.volumeOpen')" @click.prevent="ui.volumesOpen = true"><i class="fa-solid fa-hard-drive me-1"></i>{{ volume.name }}</a><div class="text-body-secondary" data-testid="pod-volume-facts">{{ volume.size_gb }} GB · {{ volume.datacenter }}</div></dd>
      </template>

      <template v-if="rate">   <!-- the price on the card itself, running or stopped (a stopped pod's is an estimate, ADR-031) -->
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.cost') }}</dt>
        <dd class="col-8 mb-0" data-testid="pod-price"><span class="badge text-bg-success fw-semibold" :title="rate.estimated ? $t('pod.costEstimate') : ''" :data-estimate="rate.estimated || null">{{ (rate.estimated ? '≈ ' : '') + '$' + rate.perHr + $t('pod.perHour') }}</span></dd>
      </template>

      <template v-if="pod.web_ui_url">
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.comfyui') }}</dt>
        <dd class="col-8 mb-0">
          <a v-if="pod.comfy_ready !== false" :href="pod.web_ui_url" target="_blank" rel="noopener" data-testid="pod-open">
            {{ $t('pod.open') }} <i class="fa-solid fa-arrow-up-right-from-square fa-xs"></i>
          </a>
          <span v-else-if="pod.port_mismatch" class="text-danger" data-testid="pod-port-mismatch">{{ $t('pod.portMismatch') }}</span>
          <span v-else class="text-warning" data-testid="pod-comfy-starting"><BSpinner small class="me-1" />{{ $t('pod.comfyStarting') }}</span>
        </dd>
      </template>


      <div v-if="loading" class="col-12 mt-1" :class="{ 'cursor-pointer': loading.sync }" :role="loading.sync ? 'button' : undefined" :title="loading.sync ? $t('pod.syncOpen') : undefined" data-testid="pod-progress" :data-step="loading.step" :data-indeterminate="loading.indeterminate ? 'true' : undefined" @click="loading.sync && (showSync = true)">
        <BProgress :value="loading.value" :max="100" height="6px" :variant="loading.sync ? 'warning' : 'info'" :striped="loading.indeterminate || !loading.sync || loading.value < 100" :animated="loading.indeterminate || !loading.sync || loading.value < 100" />
        <div class="small text-body-secondary mt-1" data-testid="pod-progress-label">{{ loading.sync ? '' : $t('pod.stepOf', { n: loading.step, of: 3 }) + ' · ' }}{{ loading.label }}</div>
      </div>
      <div v-if="pods.hostFull === pod.id" class="col-12 small text-warning" data-testid="pod-host-full">{{ $t('pod.hostFull') }}</div>

      <template v-if="pod.status_text">
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.statusText') }}</dt>
        <dd class="col-8 mb-0 small" data-testid="pod-status-text">{{ pod.status_text }}</dd>
      </template>

      <template v-if="pod.status !== 'stopped'">
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.idleStop') }}</dt>
        <dd class="col-8 mb-0" data-testid="pod-idle">
          <template v-if="!editingIdle">
            {{ pod.idle_stop_minutes ? $t('pod.idleAfter', { n: pod.idle_stop_minutes }) : $t('pod.notWatched') }}
            <button type="button" class="btn btn-link btn-sm p-0 ms-1 align-baseline" :title="$t('pod.idleEdit')" data-testid="pod-idle-edit" @click="startIdleEdit"><i class="fa-solid fa-pen fa-xs"></i></button>
          </template>
          <div v-else class="d-flex align-items-center gap-1">
            <BFormInput v-model.number="idleDraft" type="number" min="0" size="sm" style="width: 5rem" data-testid="pod-idle-input" @keydown.enter.prevent="saveIdle" @keydown.esc.prevent="editingIdle = false" />
            <span class="text-body-secondary">{{ $t('pod.idleMinutes') }}</span>
            <BButton size="sm" variant="primary" data-testid="pod-idle-save" @click="saveIdle">{{ $t('pod.idleSave') }}</BButton>
            <BButton size="sm" variant="outline-light" @click="editingIdle = false">{{ $t('picker.cancel') }}</BButton>
          </div>
        </dd>
      </template>
    </dl>

    <div class="d-flex mb-2 justify-content-evenly flex-nowrap card-actions">
      <BButton variant="outline-light" size="sm" class="text-nowrap px-2" :title="$t('pod.config') + ': ' + $t('pod.configTitle')" :aria-label="$t('pod.config')" data-testid="pod-config" @click="openConfig">
        <i class="fa-solid fa-sliders me-1"></i>{{ $t('pod.config') }}
      </BButton>
      <BButton variant="outline-light" size="sm" class="text-nowrap px-2" :title="$t('pod.sync') + ': ' + $t('pod.syncTitle')" :aria-label="$t('pod.sync')" data-testid="pod-sync" @click="showSync = true">
        <i class="fa-solid fa-arrows-rotate me-1"></i>{{ $t('pod.sync') }}
      </BButton>
      <BButton variant="outline-light" size="sm" class="text-nowrap px-2" :pressed="showDetails" :title="$t('pod.details') + ': ' + $t('pod.detailsTitle')" :aria-label="$t('pod.details')" data-testid="pod-details-toggle" @click="toggleDetails">
        <i class="fa-solid fa-circle-info me-1"></i>{{ $t('pod.details') }}
      </BButton>
      <BButton variant="outline-light" size="sm" class="text-nowrap px-2" :title="$t('pod.logs') + ': ' + $t('pod.logsTitle2')" :aria-label="$t('pod.logs')" data-testid="pod-logs-toggle" @click="showLogs = true">
        <i class="fa-solid fa-scroll me-1"></i>{{ $t('pod.logs') }}
      </BButton>
    </div>
    <div class="mb-2 d-flex gap-1">
      <BButton variant="primary" size="sm" class="flex-grow-1 text-nowrap" :title="$t('pod.importShotPackTitle')" data-testid="pod-import" @click="openImport">
        <i class="fa-solid fa-file-import me-1"></i>{{ $t('pod.importShotPack') }}
      </BButton>
      <BButton variant="success" size="sm" class="flex-grow-1 text-nowrap" :disabled="pod.status !== 'running'" :title="pod.status === 'running' ? $t('runflows.buttonTitle') : $t('runflows.needsRunning')" data-testid="pod-run-workflows" @click="showRunFlows = true">
        <i class="fa-solid fa-play me-1"></i>{{ $t('runflows.button') }}
      </BButton>
    </div>
    <div v-if="showDetails" class="small mb-2" data-testid="pod-details">
      <div v-if="detailsError" class="text-danger">{{ detailsError }}</div>
      <div v-else-if="!details" class="text-body-secondary">{{ $t('pod.loadingDetails') }}</div>
      <dl v-else class="row g-1 mb-0">
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.statusText') }}</dt><dd class="col-8 mb-0" data-testid="pod-details-status">{{ details.status }}<span v-if="details.status_text" class="text-body-secondary"> · {{ details.status_text }}</span></dd>
        <template v-if="details.cost_per_hr > 0">   <!-- RunPod reports 0 while a pod is stopped: the core then sends the listed price as an estimate; with none, no row, never $0 (ADR-031) -->
          <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.cost') }}</dt><dd class="col-8 mb-0" data-testid="pod-details-cost"><span :title="details.cost_estimated ? $t('pod.costEstimate') : ''" :data-estimate="details.cost_estimated || null">{{ (details.cost_estimated ? '≈ ' : '') + '$' + details.cost_per_hr + $t('pod.perHour') }}</span></dd>
        </template>
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.place') }}</dt><dd class="col-8 mb-0">{{ details.cloud }}<span v-if="details.datacenter"> · {{ details.datacenter }}</span></dd>
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.gpu') }}</dt><dd class="col-8 mb-0">{{ details.gpu }} ×{{ details.gpu_count }}</dd>
        <template v-if="pod.ssh_command">
          <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.ssh') }}</dt>
          <dd class="col-8 mb-0"><code class="text-break" data-testid="pod-ssh">{{ pod.ssh_command }}</code></dd>
        </template>
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.image') }}</dt>
        <dd class="col-8 mb-0 text-break">
          <a href="#" class="d-block text-break" :title="details.image || pod.image" data-testid="pod-dockerfile" @click.prevent="showDockerfile = true"><i class="fa-solid fa-file-code me-1"></i>{{ $t('dockerfile.button') }}</a>
          <code class="d-block small text-body-secondary text-break" data-testid="pod-image-ref">{{ shortImage(pod.image || details.image) }}</code>
          <DockerfileModal v-model="showDockerfile" :image="pod.image || details.image" this-pod />
        </dd>
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.disk') }}</dt><dd class="col-8 mb-0">{{ volume ? $t('pod.diskNetwork', { disk: details.disk_gb, name: volume.name, size: volume.size_gb }) : $t('pod.diskValue', { disk: details.disk_gb, volume: details.volume_gb }) }}</dd>
      </dl>
    </div>
    <ConfigModal v-if="configOpen" mode="pod" v-model="configOpen" :initial="ownConfig" :pod-name="pod.name" :pod-id="pod.id" :runpod-name="pod.runpod_name || ''" @apply="applyConfig" />
    <SyncModal v-model="showSync" :pod="pod" />
    <RunWorkflowsModal v-if="showRunFlows" v-model="showRunFlows" :pod="pod" />
    <BModal v-model="showLogs" :title="$t('pod.logsTitle', { name: pod.name })" size="xl" scrollable ok-only :ok-title="$t('pod.close')" ok-variant="outline-light" body-class="p-0" @hidden="showLogs = false">
      <PodLogs v-if="showLogs" :pod-id="pod.id" modal />
    </BModal>

    <div class="d-flex gap-2 pt-3 border-top">
      <BButton
        v-if="pod.status !== 'stopped'"
        variant="outline-light"
        size="sm"
        class="flex-fill"
        :disabled="busy"
        :title="$t('pod.stopTitle')"
        data-testid="pod-stop"
        @click="$emit('stop')"
      >
        <i class="fa-solid fa-stop me-1"></i>{{ $t('pod.stop') }}
      </BButton>
      <BButton
        v-else
        variant="primary"
        size="sm"
        class="flex-fill"
        :disabled="busy"
        data-testid="pod-resume"
        @click="$emit('resume')"
      >
        <i class="fa-solid fa-play me-1"></i>{{ $t('pod.resume') }}
      </BButton>
      <BButton
        v-if="pod.status === 'stopped'"
        :variant="pods.hostFull === pod.id ? 'warning' : 'outline-light'"
        size="sm"
        class="flex-fill"
        :disabled="busy"
        :title="$t('pod.recreateTitle')"
        data-testid="pod-recreate"
        @click="confirmRecreate"
      >
        <i class="fa-solid fa-rotate me-1"></i>{{ $t('pod.recreate') }}
      </BButton>
      <BButton variant="outline-danger" size="sm" class="flex-fill" :disabled="busy" data-testid="pod-delete" @click="confirmDelete">
        <i class="fa-solid fa-trash me-1"></i>{{ $t('pod.delete') }}
      </BButton>
    </div>
  </BCard>
</template>

<script setup>
/**
 * PodCard — one pod: name, status badge, details, and Stop/Resume + Delete.
 *
 * Props:
 *   pod   { id, name, status, gpu, vram?, uptime_seconds?, web_ui_url?, ssh_command? }
 *   busy  boolean — disables the buttons while the parent runs an action on this pod
 * Emits:
 *   stop, resume, delete  — delete only fires after the user confirms
 */
import { t } from '../i18n'
import { computed, onMounted, ref, watch } from 'vue'
import PodLogs from './PodLogs.vue'
import RunWorkflowsModal from './RunWorkflowsModal.vue'
import SyncModal from './SyncModal.vue'
import DockerfileModal from './DockerfileModal.vue'
import ConfigModal from './ConfigModal.vue'
import { usePodsStore } from '../stores/pods'
import { useToastStore } from '../stores/toast'
import { useUiStore } from '../stores/ui'
import { useVolumesStore } from '../stores/volumes'
import { barValue, detailParts, fresh } from '../sync-progress'
const props = defineProps({
  pod: { type: Object, required: true },
  busy: { type: Boolean, default: false },
  handle: { type: Boolean, default: false },   // show the grip a card is dragged by, to move it to another round (ADR-039)
  rounds: { type: Array, default: () => [] },   // the rounds a pod can be dropped into (ADR-039)
})
const emit = defineEmits(['stop', 'resume', 'delete', 'rename', 'round', 'dragstart', 'dragend'])
/** The grip starts the drag; the whole card is the picture that follows the pointer. */
const onHandleDragStart = (e) => { const card = e.target.closest('[data-testid="pod-card"]'); if (card && e.dataTransfer?.setDragImage) e.dataTransfer.setDragImage(card, 24, 24); emit('dragstart', e) }
/** The choices: the known rounds, plus the pod's own when it is not among them. */
const roundOptions = computed(() => (props.pod.round && !props.rounds.some((r) => r.round === props.pod.round) ? [{ round: props.pod.round, label: props.pod.round_label || props.pod.round }, ...props.rounds] : props.rounds))
/** The name is ours: a map on this app's side (RunPod keeps its own). Empty goes back to RunPod's name. */
const renaming = ref(false)
const draft = ref('')
const startRename = () => { draft.value = props.pod.name; renaming.value = true }
const saveRename = () => { const n = draft.value.trim(); renaming.value = false; if (n !== props.pod.name) emit('rename', n === (props.pod.runpod_name || '') ? '' : n) }

const STATUS_VARIANT = {
  running: 'success',
  stopped: 'danger',
  starting: 'warning',
  stopping: 'warning',
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

const pods = usePodsStore()

/** Where a pod is on its way to a usable ComfyUI: requested, container up, ready. The image pull itself has no
 *  progress RunPod exposes, so the bar moves by step; the Logs modal shows the pull lines. */
const loading = computed(() => {
  const action = pods.pending[props.pod.id]
  if (action === 'sync') {
    const p = pods.sync[props.pod.id] || fresh()
    const value = barValue(p)   // null: nothing known yet (listing, or a folder with no total): the bar runs striped, full
    const label = p.listing || !p.step ? t('pod.syncListing', { folder: p.key || '…' }) : t('pod.syncProgress', { folder: p.key, step: p.step, steps: p.steps, detail: detailParts(p, t).join(' · ') })
    return { sync: true, step: p.step, value: value ?? 100, indeterminate: value == null, label }
  }
  if (action) return { step: 1, value: 50, label: t(`pod.action_${action}`) }
  if (props.pod.status === 'starting') return { step: 1, value: 15, label: t('pod.stepRequested') }
  if (props.pod.status === 'running' && props.pod.comfy_ready === false && !props.pod.port_mismatch) return { step: 2, value: 60, label: t('pod.stepBooting') }
  return null
})
const toast = useToastStore()
const showDetails = ref(false)
const showLogs = ref(false)
const showSync = ref(false)
const showRunFlows = ref(false)
const ui = useUiStore()
/** Import Shot Pack: its own modal (a package folder into ComfyUI-Shared through an adapter; Sync then puts it on this pod, ADR-008). */
/** One button: the modal opens on the source picker (a folder or zip on this PC, or the Panama bucket). */
const openImport = () => { ui.importPod = { id: props.pod.id, name: props.pod.name }; ui.importOpen = true }
const showDockerfile = ref(false)
const shortImage = (ref) => ref.replace(/^registry\.gitlab\.com\/[^/]+\/[^/]+\//, '')
const details = ref(null)
const detailsError = ref(null)

const volumes = useVolumesStore()
const volume = computed(() => volumes.volumes.find((v) => v.pods?.some((x) => x.id === props.pod.id)) || null)
onMounted(() => { if (!volumes.volumes.length && !volumes.loading) volumes.load() })
/** The card's own price, asked once when it appears and again when the pod starts or stops; the details panel reads it fresh. Zero is never shown. */
const rate = ref(null)
async function loadRate() {
  try { const d = await pods.details(props.pod.id); rate.value = d.cost_per_hr > 0 ? { perHr: d.cost_per_hr, estimated: !!d.cost_estimated } : null } catch { rate.value = null }
}
onMounted(loadRate)
watch(() => props.pod.status, loadRate)

async function toggleDetails() {
  showDetails.value = !showDetails.value
  if (!showDetails.value) return
  details.value = null; detailsError.value = null
  try { details.value = await pods.details(props.pod.id) } catch (e) { detailsError.value = e.response?.data?.detail || e.message }
}

async function copyId() {
  try { await navigator.clipboard.writeText(props.pod.id); toast.info(t('pod.copied')) } catch { /* clipboard blocked: the id is still on screen */ }
}

const editingIdle = ref(false)
const idleDraft = ref(0)
function startIdleEdit() { idleDraft.value = props.pod.idle_stop_minutes || 0; editingIdle.value = true }
async function saveIdle() {
  const r = await pods.setIdle(props.pod.id, Number(idleDraft.value) || 0)
  if (r.ok) editingIdle.value = false
}

// This pod's own configuration: shown from the registry, saved there; it applies when the pod is recreated.
const configOpen = ref(false)
const ownConfig = ref(null)
async function openConfig() {
  try { ownConfig.value = await pods.config(props.pod.id) } catch { ownConfig.value = null }
  configOpen.value = true
}
async function applyConfig(cfg) {
  const r = await pods.setConfig(props.pod.id, cfg)
  if (r.ok) ownConfig.value = cfg
}

function confirmRecreate() {
  if (window.confirm(t('pod.confirmRecreate', { name: props.pod.name }))) pods.recreate(props.pod.id)
}

function confirmDelete() {
  if (window.confirm(t('pod.confirmDelete', { name: props.pod.name }))) {
    emit('delete')
  }
}
</script>

<style scoped>
.edit-btn { width: 2.2rem; height: 2.2rem; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 1rem; line-height: 1; }
.status-dot { width: 0.8rem; height: 0.8rem; border-radius: 50%; display: inline-block; flex: none; }
.pod-handle { cursor: grab; padding: 2px 4px; align-self: center; }
.pod-handle:active { cursor: grabbing; }
</style>
