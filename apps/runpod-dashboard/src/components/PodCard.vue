<template>
  <BCard class="h-100" body-class="d-flex flex-column" data-testid="pod-card" :data-name="pod.name">
    <div class="d-flex align-items-start gap-2 mb-3">
      <span class="fw-semibold fs-5 text-truncate" :title="pod.name">{{ pod.name }}</span>
      <BBadge :variant="STATUS_VARIANT[pod.status] ?? 'secondary'" class="ms-auto text-uppercase" data-testid="pod-status">
        {{ pod.status }}
      </BBadge>
    </div>

    <dl class="row g-1 small mb-3 flex-grow-1">
      <dt class="col-4 text-body-secondary fw-normal">ID</dt>
      <dd class="col-8 mb-0"><code>{{ pod.id }}</code></dd>

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

      <template v-if="pod.status !== 'stopped'">
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.idleStop') }}</dt>
        <dd class="col-8 mb-0" data-testid="pod-idle">{{ pod.idle_stop_minutes ? $t('pod.idleAfter', { n: pod.idle_stop_minutes }) : $t('pod.notWatched') }}</dd>
      </template>

      <template v-if="pod.ssh_command">
        <dt class="col-4 text-body-secondary fw-normal">{{ $t('pod.ssh') }}</dt>
        <dd class="col-8 mb-0"><code class="text-break">{{ pod.ssh_command }}</code></dd>
      </template>
    </dl>

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

function confirmDelete() {
  if (window.confirm(t('pod.confirmDelete', { name: props.pod.name }))) {
    emit('delete')
  }
}
</script>
