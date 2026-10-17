<template>
  <div class="card-dark p-6">
    <!-- Pod Header: Name + Status Badge -->
    <div class="flex justify-between items-start gap-3 mb-4">
      <h3 class="text-lg font-bold text-white flex-1">{{ pod.name }}</h3>
      <span :class="['px-2 py-1 rounded text-xs font-semibold whitespace-nowrap', statusClass(pod.status)]">
        {{ pod.status }}
      </span>
    </div>

    <!-- Pod Details -->
    <div class="space-y-2 text-sm mb-6">
      <!-- ID -->
      <div class="flex items-center gap-2">
        <span class="font-semibold text-dark-200 min-w-fit">ID:</span>
        <code class="bg-black/20 px-2 py-1 rounded text-info text-xs font-mono">
          {{ pod.id.substring(0, 8) }}...
        </code>
      </div>

      <!-- GPU -->
      <div class="flex items-center gap-2">
        <span class="font-semibold text-dark-200 min-w-fit">GPU:</span>
        <span class="text-dark-100">{{ pod.gpu }}</span>
      </div>

      <!-- VRAM -->
      <div class="flex items-center gap-2">
        <span class="font-semibold text-dark-200 min-w-fit">VRAM:</span>
        <span class="text-dark-100">{{ pod.vram }}GB</span>
      </div>

      <!-- Uptime (if available) -->
      <div v-if="pod.uptime_seconds" class="flex items-center gap-2">
        <span class="font-semibold text-dark-200 min-w-fit">Uptime:</span>
        <span class="text-dark-100">{{ formatUptime(pod.uptime_seconds) }}</span>
      </div>

      <!-- Web UI Link (if available) -->
      <div v-if="pod.web_ui_url" class="flex items-center gap-2">
        <span class="font-semibold text-dark-200 min-w-fit">UI:</span>
        <a :href="pod.web_ui_url" target="_blank" class="text-primary hover:text-info underline">
          🌐 ComfyUI
        </a>
      </div>

      <!-- SSH Command -->
      <div class="flex items-start gap-2 pt-2">
        <span class="font-semibold text-dark-200 min-w-fit">SSH:</span>
        <code class="bg-black/20 px-2 py-1 rounded text-info text-xs font-mono break-all">
          {{ pod.ssh_command }}
        </code>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="flex gap-2 pt-4 border-t border-light">
      <!-- Stop/Resume Button -->
      <button
        v-if="pod.status === 'running'"
        @click="$emit('stop')"
        class="btn-secondary flex-1 text-sm flex items-center justify-center gap-2"
      >
        <i class="fas fa-pause"></i>
        Stop
      </button>
      <button
        v-else
        @click="$emit('resume')"
        class="btn-primary flex-1 text-sm flex items-center justify-center gap-2"
      >
        <i class="fas fa-play"></i>
        Resume
      </button>

      <!-- Delete Button -->
      <button
        @click="deleteConfirm"
        class="btn-danger flex-1 text-sm flex items-center justify-center gap-2"
      >
        <i class="fas fa-trash"></i>
        Delete
      </button>
    </div>
  </div>
</template>

<script setup>
/**
 * PodCard.vue - Individual pod display card
 *
 * Displays detailed information about a single pod and provides
 * quick-action buttons for common operations.
 *
 * Props:
 * - pod: Pod object with details
 *
 * Events:
 * - stop: Emitted when user clicks stop button
 * - resume: Emitted when user clicks resume button
 * - delete: Emitted when user confirms deletion
 *
 * Features:
 * - Responsive card layout
 * - Status badge with color coding
 * - Pod details: ID, GPU, VRAM, uptime, web UI link, SSH command
 * - Conditional action buttons based on pod status
 * - Deletion confirmation dialog
 *
 * @component
 */

const props = defineProps({
  /**
   * Pod object with all details
   * @type {Object}
   * @property {string} id - Pod ID
   * @property {string} name - Pod name
   * @property {string} status - Pod status (running, stopped, starting, etc.)
   * @property {string} gpu - GPU type (e.g., "RTX4090")
   * @property {number} vram - VRAM in GB
   * @property {number} uptime_seconds - Uptime in seconds (optional)
   * @property {string} web_ui_url - URL to web UI (optional)
   * @property {string} ssh_command - SSH command to connect (optional)
   */
  pod: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits({
  /**
   * Emitted when user clicks stop button
   */
  'stop': null,

  /**
   * Emitted when user clicks resume button
   */
  'resume': null,

  /**
   * Emitted when user confirms deletion
   */
  'delete': null,
})

// ===== METHODS =====

/**
 * Format seconds into human-readable uptime string
 * e.g., 7263 seconds → "2h 1m"
 *
 * @param {number} seconds - Total uptime seconds
 * @returns {string} Formatted uptime string
 */
function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

/**
 * Get CSS classes for status badge
 * - running: green
 * - stopped: red
 * - starting: yellow
 * - default: gray
 *
 * @param {string} status - Pod status
 * @returns {string} CSS class string
 */
function statusClass(status) {
  const classes = {
    'running': 'bg-success/20 text-success border border-success/30',
    'stopped': 'bg-danger/20 text-danger border border-danger/30',
    'starting': 'bg-warning/20 text-warning border border-warning/30',
  }
  return classes[status] || 'bg-dark-700/50 text-dark-300 border border-dark-400'
}

/**
 * Show confirmation dialog before deletion
 * Only emits delete event if user confirms
 */
function deleteConfirm() {
  if (confirm(`⚠️ Permanently delete pod "${props.pod.name}"? This cannot be undone.`)) {
    emit('delete')
  }
}
</script>

<style scoped>
/* All styling handled by index.css and Tailwind */
</style>
