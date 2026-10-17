<template>
  <div class="app">
    <header class="header">
      <div class="container">
        <div class="header-content">
          <div>
            <h1>🚀 RunPod Pod Manager</h1>
            <p>Real-time management of your GPU pods</p>
          </div>
          <button @click="refresh" class="refresh-btn">🔄 Refresh</button>
        </div>
      </div>
    </header>

    <div class="container">
      <div v-if="error" class="error-message">
        <strong>❌ Error:</strong> {{ error }}
      </div>

      <div v-if="loading" class="loading">
        <div class="spinner"></div>
        <p>Loading pod data...</p>
      </div>

      <template v-else>
        <Stats :stats="dashboard.stats" />
        <Dashboard :pods="dashboard.pods" @pods-updated="handlePodsUpdated" />
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { podsAPI } from './api/pods'
import Dashboard from './components/Dashboard.vue'
import Stats from './components/Stats.vue'

const dashboard = ref({ stats: {}, pods: [] })
const loading = ref(false)
const error = ref(null)

async function loadDashboard() {
  try {
    loading.value = true
    error.value = null
    const data = await podsAPI.getDashboard()
    dashboard.value = data
  } catch (e) {
    error.value = e.response?.data?.detail || e.message || 'Failed to load dashboard'
    console.error(e)
  } finally {
    loading.value = false
  }
}

function handlePodsUpdated(pods) {
  dashboard.value.pods = pods
}

function refresh() {
  loadDashboard()
}

onMounted(() => {
  loadDashboard()
  // Auto-refresh every 30 seconds
  setInterval(loadDashboard, 30000)
})
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.app {
  background: linear-gradient(135deg, #0f0f1e 0%, #1a1a2e 100%);
  min-height: 100vh;
  padding: 20px;
}

.container {
  max-width: 1400px;
  margin: 0 auto;
}

.header {
  background: linear-gradient(135deg, #2a2a3e 0%, #1e1e2e 100%);
  padding: 32px 30px;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  margin-bottom: 32px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}

.header h1 {
  font-size: 32px;
  color: #ffffff;
  margin-bottom: 8px;
  font-weight: 700;
}

.header p {
  color: #b0b0c0;
  font-size: 14px;
  margin-bottom: 0;
}

.refresh-btn {
  background: linear-gradient(135deg, #4a9eff 0%, #357abd 100%);
  color: white;
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s;
  white-space: nowrap;
}

.refresh-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(74, 158, 255, 0.3);
}

.refresh-btn:active {
  transform: translateY(0);
}

.error-message {
  background: rgba(244, 67, 54, 0.1);
  border-left: 4px solid #f44336;
  color: #ff6b6b;
  padding: 16px 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  border: 1px solid rgba(244, 67, 54, 0.3);
  font-size: 14px;
}

.error-message strong {
  display: block;
  margin-bottom: 4px;
}

.loading {
  text-align: center;
  color: #b0b0c0;
  padding: 80px 20px;
}

.spinner {
  border: 4px solid rgba(74, 158, 255, 0.2);
  border-top: 4px solid #4a9eff;
  border-radius: 50%;
  width: 50px;
  height: 50px;
  animation: spin 0.8s linear infinite;
  margin: 20px auto;
}

.loading p {
  margin-top: 20px;
  font-size: 14px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
