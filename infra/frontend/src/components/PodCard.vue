<template>
  <div class="pod-card">
    <div class="pod-header">
      <div class="pod-name">{{ pod.name }}</div>
      <span :class="['status-badge', `status-${pod.status}`]">
        {{ pod.status }}
      </span>
    </div>

    <div class="pod-detail">
      <strong>ID:</strong>
      <code>{{ pod.id.substring(0, 8) }}...</code>
    </div>

    <div class="pod-detail">
      <strong>GPU:</strong> {{ pod.gpu }}
    </div>

    <div class="pod-detail">
      <strong>VRAM:</strong> {{ pod.vram }}GB
    </div>

    <div v-if="pod.uptime_seconds" class="pod-detail">
      <strong>Uptime:</strong> {{ formatUptime(pod.uptime_seconds) }}
    </div>

    <div v-if="pod.web_ui_url" class="pod-detail">
      <strong>UI:</strong>
      <a :href="pod.web_ui_url" target="_blank">🌐 ComfyUI</a>
    </div>

    <div class="pod-detail">
      <strong>SSH:</strong>
      <code style="font-size: 11px;">{{ pod.ssh_command }}</code>
    </div>

    <div class="pod-actions">
      <button
        v-if="pod.status === 'running'"
        @click="$emit('stop')"
        class="btn btn-secondary"
      >
        ⏸ Stop
      </button>
      <button
        v-else
        @click="$emit('resume')"
        class="btn btn-primary"
      >
        ▶ Resume
      </button>
      <button
        @click="deleteConfirm"
        class="btn btn-danger"
      >
        🗑 Delete
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  pod: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['stop', 'resume', 'delete'])

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function deleteConfirm() {
  if (confirm(`⚠️ Permanently delete pod ${pod.name}? This cannot be undone.`)) {
    emit('delete')
  }
}
</script>

<style scoped>
.pod-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
  border-left: 5px solid #667eea;
}

.pod-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15);
}

.pod-header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  margin-bottom: 16px;
}

.pod-name {
  font-size: 20px;
  font-weight: 700;
  color: #333;
}

.status-badge {
  display: inline-block;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-running {
  background: #d4edda;
  color: #155724;
}

.status-stopped {
  background: #f8d7da;
  color: #721c24;
}

.status-starting {
  background: #fff3cd;
  color: #856404;
}

.pod-detail {
  font-size: 14px;
  color: #666;
  margin: 12px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pod-detail strong {
  color: #333;
  min-width: 70px;
}

.pod-detail a {
  color: #667eea;
  text-decoration: none;
  font-weight: 500;
}

.pod-detail a:hover {
  text-decoration: underline;
}

.pod-detail code {
  background: #f8f9fa;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Monaco', 'Courier', monospace;
}

.pod-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}

.btn {
  flex: 1;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.btn-primary {
  background: #667eea;
  color: white;
}

.btn-primary:hover {
  background: #764ba2;
}

.btn-secondary {
  background: #6c757d;
  color: white;
}

.btn-secondary:hover {
  background: #5a6268;
}

.btn-danger {
  background: #dc3545;
  color: white;
}

.btn-danger:hover {
  background: #c82333;
}
</style>
