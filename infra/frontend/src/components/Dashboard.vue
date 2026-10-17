<template>
  <div class="dashboard">
    <PodForm @pod-created="handlePodCreated" />

    <div class="pods-section">
      <div class="section-header">
        <h2>Active Pods</h2>
        <span class="pod-count">{{ pods.length }} pod{{ pods.length !== 1 ? 's' : '' }}</span>
      </div>

      <div v-if="pods.length === 0" class="empty-state">
        <p>📭 No pods running</p>
        <p class="hint">Create your first pod using the form above</p>
      </div>

      <div v-else class="pods-grid">
        <PodCard
          v-for="pod in pods"
          :key="pod.id"
          :pod="pod"
          @stop="handleStop(pod.id)"
          @resume="handleResume(pod.id)"
          @delete="handleDelete(pod.id)"
        />
      </div>
    </div>

    <div v-if="loading" class="loading-overlay">
      <div class="spinner">Loading...</div>
    </div>

    <div v-if="error" class="alert alert-error">
      {{ error }}
      <button class="close-btn" @click="error = null">×</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import PodCard from './PodCard.vue'
import PodForm from './PodForm.vue'
import { podsAPI } from '../api/pods'

const props = defineProps({
  pods: {
    type: Array,
    required: true,
  },
})

const emit = defineEmits(['pods-updated'])

const loading = ref(false)
const error = ref(null)

async function handlePodCreated(pod) {
  loading.value = true
  error.value = null
  try {
    // Refresh pod list after creation
    await refreshPods()
  } catch (err) {
    error.value = 'Failed to refresh pods after creation'
  } finally {
    loading.value = false
  }
}

async function handleStop(podId) {
  loading.value = true
  error.value = null
  try {
    await podsAPI.stopPod(podId)
    await refreshPods()
  } catch (err) {
    error.value = `Failed to stop pod: ${err.response?.data?.detail || err.message}`
  } finally {
    loading.value = false
  }
}

async function handleResume(podId) {
  loading.value = true
  error.value = null
  try {
    await podsAPI.resumePod(podId)
    await refreshPods()
  } catch (err) {
    error.value = `Failed to resume pod: ${err.response?.data?.detail || err.message}`
  } finally {
    loading.value = false
  }
}

async function handleDelete(podId) {
  loading.value = true
  error.value = null
  try {
    await podsAPI.deletePod(podId)
    await refreshPods()
  } catch (err) {
    error.value = `Failed to delete pod: ${err.response?.data?.detail || err.message}`
  } finally {
    loading.value = false
  }
}

async function refreshPods() {
  const updatedPods = await podsAPI.listPods()
  emit('pods-updated', updatedPods)
}
</script>

<style scoped>
.dashboard {
  position: relative;
}

.pods-section {
  margin-bottom: 40px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px solid rgba(255, 255, 255, 0.1);
}

.pods-section h2 {
  color: #ffffff;
  font-size: 24px;
  margin: 0;
  font-weight: 600;
}

.pod-count {
  background: rgba(74, 158, 255, 0.2);
  color: #4a9eff;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid rgba(74, 158, 255, 0.3);
}

.pods-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 20px;
}

.empty-state {
  background: linear-gradient(135deg, #2a2a3e 0%, #1e1e2e 100%);
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  padding: 40px 30px;
  text-align: center;
  color: #b0b0c0;
}

.empty-state p {
  margin: 0 0 8px 0;
  font-size: 16px;
}

.empty-state .hint {
  font-size: 13px;
  color: #8080a0;
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.spinner {
  width: 50px;
  height: 50px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #4a9eff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  color: #4a9eff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.alert {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 16px 20px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 400px;
  z-index: 40;
  animation: slideIn 0.3s ease-out;
}

.alert-error {
  background: rgba(244, 67, 54, 0.2);
  color: #ff6b6b;
  border: 1px solid rgba(244, 67, 54, 0.3);
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.close-btn {
  background: none;
  border: none;
  color: inherit;
  font-size: 20px;
  cursor: pointer;
  padding: 0;
  margin-left: auto;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.close-btn:hover {
  opacity: 1;
}
</style>
