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
const props = defineProps({
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
  if (confirm(`⚠️ Permanently delete pod ${props.pod.name}? This cannot be undone.`)) {
    emit('delete')
  }
}
</script>

<style scoped>
.pod-card {
  background: linear-gradient(135deg, #2a2a3e 0%, #1e1e2e 100%);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  transition: all 0.3s ease;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: 4px solid #4a9eff;
}

.pod-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(74, 158, 255, 0.2);
  border-left-color: #00d9ff;
}

.pod-header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  margin-bottom: 16px;
  gap: 12px;
}

.pod-name {
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
  flex: 1;
}

.status-badge {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.status-running {
  background: rgba(76, 175, 80, 0.2);
  color: #4caf50;
  border: 1px solid rgba(76, 175, 80, 0.3);
}

.status-stopped {
  background: rgba(244, 67, 54, 0.2);
  color: #f44336;
  border: 1px solid rgba(244, 67, 54, 0.3);
}

.status-starting {
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
  border: 1px solid rgba(255, 193, 7, 0.3);
}

.pod-detail {
  font-size: 13px;
  color: #b0b0c0;
  margin: 10px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pod-detail strong {
  color: #e0e0f0;
  min-width: 70px;
  font-weight: 600;
}

.pod-detail a {
  color: #4a9eff;
  text-decoration: none;
  font-weight: 500;
  transition: all 0.2s;
}

.pod-detail a:hover {
  color: #00d9ff;
  text-decoration: underline;
}

.pod-detail code {
  background: rgba(255, 255, 255, 0.05);
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: 'Monaco', 'Courier', monospace;
  color: #00d9ff;
  font-size: 11px;
}

.pod-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.btn {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.btn-primary {
  background: linear-gradient(135deg, #4a9eff 0%, #357abd 100%);
  color: white;
}

.btn-primary:hover {
  background: linear-gradient(135deg, #357abd 0%, #2a5a99 100%);
  box-shadow: 0 4px 12px rgba(74, 158, 255, 0.3);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.1);
  color: #e0e0f0;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
}

.btn-danger {
  background: rgba(244, 67, 54, 0.2);
  color: #ff6b6b;
  border: 1px solid rgba(244, 67, 54, 0.3);
}

.btn-danger:hover {
  background: rgba(244, 67, 54, 0.4);
  border-color: rgba(244, 67, 54, 0.5);
}
</style>
