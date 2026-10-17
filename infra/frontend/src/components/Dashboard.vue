<template>
  <div class="dashboard">
    <!-- Create Pod Section -->
    <div class="create-section">
      <button
        type="button"
        @click="showCreateForm = !showCreateForm"
        class="section-header"
      >
        <h2>Create Pod</h2>
        <span class="toggle-icon">{{ showCreateForm ? '⌄' : '›' }}</span>
      </button>

      <transition name="expand">
        <PodForm v-if="showCreateForm" @pod-created="handlePodCreated" />
      </transition>
    </div>

    <!-- Pods List Section -->
    <div class="pods-section">
      <div class="section-header">
        <h2>Pods</h2>
        <span class="pod-count">{{ pods.length }}</span>
      </div>

      <div v-if="pods.length === 0" class="empty-state">
        <p>📭 No pods running</p>
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
import { ref } from 'vue'
import PodCard from './PodCard.vue'
import PodForm from './PodForm.vue'
import { podsAPI } from '../api/pods'

const props = defineProps({
  pods: { type: Array, required: true },
})

const emit = defineEmits(['pods-updated'])

const loading = ref(false)
const error = ref(null)
const showCreateForm = ref(false)

async function handlePodCreated() {
  loading.value = true
  error.value = null
  showCreateForm.value = false
  try {
    await refreshPods()
  } catch (err) {
    error.value = 'Failed to refresh pods'
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
    error.value = `Stop failed: ${err.response?.data?.detail || err.message}`
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
    error.value = `Resume failed: ${err.response?.data?.detail || err.message}`
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
    error.value = `Delete failed: ${err.response?.data?.detail || err.message}`
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

.create-section {
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 0;
  padding: 12px;
  margin-bottom: 32px;
}

.pods-section {
  margin-bottom: 40px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 0;
  margin-bottom: 16px;
  background: none;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: inherit;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.create-section .section-header {
  cursor: pointer;
  border-bottom: none;
  padding: 12px;
  margin-bottom: 0;
}

.create-section .section-header:hover {
  background: rgba(255, 255, 255, 0.02);
}

.pods-section .section-header {
  cursor: default;
  padding: 0;
  margin-bottom: 12px;
  border-bottom: none;
}

.toggle-icon {
  display: inline-block;
  margin-left: auto;
  font-size: 1.8rem;
  color: #e0e0f0;
  transition: all 0.2s;
}

.section-header h2 {
  color: #d0d0e0;
  font-size: 0.95rem;
  margin: 0;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex: 1;
}

.pod-count {
  background: rgba(74, 158, 255, 0.15);
  color: #4a9eff;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.2s ease;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.pods-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.empty-state {
  color: #8080a0;
  font-size: 0.9rem;
  padding: 20px 0;
  text-align: center;
}

.empty-state p {
  margin: 0;
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
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #4a9eff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.alert {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 12px 14px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 360px;
  z-index: 40;
  animation: slideIn 0.3s ease-out;
  font-size: 0.8rem;
}

.alert-error {
  background: rgba(255, 68, 68, 0.1);
  color: #ff6b6b;
  border: 1px solid rgba(255, 68, 68, 0.3);
}

@keyframes slideIn {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

.close-btn {
  background: none;
  border: none;
  color: inherit;
  font-size: 16px;
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
