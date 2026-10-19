<template>
  <BCard class="h-100" body-class="d-flex flex-column" data-testid="pod-card" :data-name="pod.name">
    <div class="d-flex align-items-start gap-2 mb-3">
      <span class="fw-semibold fs-5 text-truncate" :title="pod.name">{{ pod.name }}</span>
      <BBadge :variant="STATUS_VARIANT[pod.status] ?? 'secondary'" class="ms-auto text-uppercase" data-testid="pod-status">
        {{ pod.status }}
      </BBadge>
    </div>

    <dl class="row g-1 small mb-3 flex-grow-1">
      <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.id') }}</dt>
      <dd class="col-8 mb-0">
        <code data-testid="pod-id">{{ pod.id }}</code>
        <a :href="pod.console_url || `https://www.runpod.io/console/pods/${pod.id}`" target="_blank" rel="noopener" class="ms-2 small" :title="$t('pod.console')" data-testid="pod-console">
          <i class="fa-solid fa-arrow-up-right-from-square fa-xs"></i> RunPod
        </a>
        <button type="button" class="btn btn-link btn-sm p-0 ms-2 align-baseline" :title="$t('pod.copyId')" data-testid="pod-copy-id" @click="copyId"><i class="fa-regular fa-copy fa-xs"></i></button>
      </dd>


      <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.gpu') }}</dt>
      <dd class="col-8 mb-0">{{ pod.gpu }}<span v-if="pod.vram" class="text-body-secondary"> · {{ pod.vram }} GB</span></dd>

      <template v-if="pod.uptime_seconds">
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.uptime') }}</dt>
        <dd class="col-8 mb-0">{{ formatUptime(pod.uptime_seconds) }}</dd>
      </template>

      <template v-if="pod.web_ui_url">
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.comfyui') }}</dt>
        <dd class="col-8 mb-0">
          <a :href="pod.web_ui_url" target="_blank" rel="noopener" data-testid="pod-open">
            {{ $t('pod.open') }} <i class="fa-solid fa-arrow-up-right-from-square fa-xs"></i>
          </a>
        </dd>
      </template>


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

      <template v-if="pod.ssh_command">
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.ssh') }}</dt>
        <dd class="col-8 mb-0"><code class="text-break">{{ pod.ssh_command }}</code></dd>
      </template>
    </dl>

    <div class="d-flex gap-2 mb-2 justify-content-end">
      <BButton variant="outline-light" size="sm" :pressed="showDetails" data-testid="pod-details-toggle" @click="toggleDetails">
        <i class="fa-solid fa-circle-info me-1"></i>{{ $t('pod.details') }}
      </BButton>
      <BButton variant="outline-light" size="sm" data-testid="pod-logs-toggle" @click="showLogs = true">
        <i class="fa-solid fa-scroll me-1"></i>{{ $t('pod.logs') }}
      </BButton>
    </div>
    <div v-if="showDetails" class="small mb-2" data-testid="pod-details">
      <div v-if="detailsError" class="text-danger">{{ detailsError }}</div>
      <div v-else-if="!details" class="text-body-secondary">{{ $t('pod.loadingDetails') }}</div>
      <dl v-else class="row g-1 mb-0">
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.statusText') }}</dt><dd class="col-8 mb-0" data-testid="pod-details-status">{{ details.status }}<span v-if="details.status_text" class="text-body-secondary"> · {{ details.status_text }}</span></dd>
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.cost') }}</dt><dd class="col-8 mb-0" data-testid="pod-details-cost">{{ details.cost_per_hr != null ? '$' + details.cost_per_hr + $t('pod.perHour') : '—' }}</dd>
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.place') }}</dt><dd class="col-8 mb-0">{{ details.cloud }}<span v-if="details.datacenter"> · {{ details.datacenter }}</span></dd>
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.gpu') }}</dt><dd class="col-8 mb-0">{{ details.gpu }} ×{{ details.gpu_count }}</dd>
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.image') }}</dt><dd class="col-8 mb-0 text-break"><code>{{ details.image }}</code></dd>
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.disk') }}</dt><dd class="col-8 mb-0">{{ $t('pod.diskValue', { disk: details.disk_gb, volume: details.volume_gb }) }}</dd>
      </dl>
    </div>
    <BModal v-model="showLogs" :title="$t('pod.logsTitle', { name: pod.name })" size="xl" scrollable hide-footer body-class="p-0" @hidden="showLogs = false">
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
import { ref } from 'vue'
import PodLogs from './PodLogs.vue'
import { usePodsStore } from '../stores/pods'
import { useToastStore } from '../stores/toast'
const props = defineProps({
  pod: { type: Object, required: true },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['stop', 'resume', 'delete'])

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
const toast = useToastStore()
const showDetails = ref(false)
const showLogs = ref(false)
const details = ref(null)
const detailsError = ref(null)

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

function confirmRecreate() {
  if (window.confirm(t('pod.confirmRecreate', { name: props.pod.name }))) pods.recreate(props.pod.id)
}

function confirmDelete() {
  if (window.confirm(t('pod.confirmDelete', { name: props.pod.name }))) {
    emit('delete')
  }
}
</script>
