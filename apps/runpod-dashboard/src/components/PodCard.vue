<template>
  <BCard class="h-100" body-class="d-flex flex-column">
    <div class="d-flex align-items-start gap-2 mb-3">
      <span class="fw-semibold fs-5 text-truncate" :title="pod.name">{{ pod.name }}</span>
      <BBadge :variant="STATUS_VARIANT[pod.status] ?? 'secondary'" class="ms-auto text-uppercase">
        {{ pod.status }}
      </BBadge>
    </div>

    <dl class="row g-1 small mb-3 flex-grow-1">
      <dt class="col-4 text-body-secondary fw-normal">ID</dt>
      <dd class="col-8 mb-0"><code>{{ pod.id }}</code></dd>

      <dt class="col-4 text-body-secondary fw-normal">GPU</dt>
      <dd class="col-8 mb-0">{{ pod.gpu }}<span v-if="pod.vram" class="text-body-secondary"> · {{ pod.vram }} GB</span></dd>

      <template v-if="pod.uptime_seconds">
        <dt class="col-4 text-body-secondary fw-normal">Uptime</dt>
        <dd class="col-8 mb-0">{{ formatUptime(pod.uptime_seconds) }}</dd>
      </template>

      <template v-if="pod.web_ui_url">
        <dt class="col-4 text-body-secondary fw-normal">ComfyUI</dt>
        <dd class="col-8 mb-0">
          <a :href="pod.web_ui_url" target="_blank" rel="noopener">
            Open <i class="fa-solid fa-arrow-up-right-from-square fa-xs"></i>
          </a>
        </dd>
      </template>

      <template v-if="pod.status !== 'stopped'">
        <dt class="col-4 text-body-secondary fw-normal">Idle stop</dt>
        <dd class="col-8 mb-0">{{ pod.idle_stop_minutes ? `after ${pod.idle_stop_minutes} quiet min` : 'not watched' }}</dd>
      </template>

      <template v-if="pod.ssh_command">
        <dt class="col-4 text-body-secondary fw-normal">SSH</dt>
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
        @click="$emit('stop')"
      >
        <i class="fa-solid fa-stop me-1"></i>Stop
      </BButton>
      <BButton
        v-else
        variant="primary"
        size="sm"
        class="flex-fill"
        :disabled="busy"
        @click="$emit('resume')"
      >
        <i class="fa-solid fa-play me-1"></i>Resume
      </BButton>
      <BButton variant="outline-danger" size="sm" class="flex-fill" :disabled="busy" @click="confirmDelete">
        <i class="fa-solid fa-trash me-1"></i>Delete
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
  if (window.confirm(`Permanently delete pod "${props.pod.name}"? This cannot be undone.`)) {
    emit('delete')
  }
}
</script>
