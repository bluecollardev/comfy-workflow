<template>
  <div class="app">
    <header class="header">
      <div class="container">
        <h1>🚀 RunPod Pod Manager</h1>
        <p>Real-time management of your GPU pods</p>
        <button @click="refresh" class="refresh-btn">🔄 Refresh</button>
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
        <Dashboard :pods="dashboard.pods" @action="handleAction" />
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { podAPI } from './api/pods'
import Dashboard from './components/Dashboard.vue'
import Stats from './components/Stats.vue'

const dashboard = ref({ stats: {}, pods: [] })
const loading = ref(false)
const error = ref(null)

async function loadDashboard() {
  try {
    loading.value = true
    error.value = null
    const data = await podAPI.getDashboard()
    dashboard.value = data
  } catch (e) {
    error.value = e.message || 'Failed to load dashboard'
    console.error(e)
  } finally {
    loading.value = false
  }
}

async function handleAction(action) {
  try {
    loading.value = true
    if (action.type === 'stop') {
      await podAPI.stopPod(action.podId)
    } else if (action.type === 'resume') {
      await podAPI.resumePod(action.podId)
    } else if (action.type === 'delete') {
      await podAPI.deletePod(action.podId)
    }
    await loadDashboard()
  } catch (e) {
    error.value = e.message || 'Action failed'
    console.error(e)
  } finally {
    loading.value = false
  }
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
.app {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  padding: 20px;
}

.container {
  max-width: 1400px;
  margin: 0 auto;
}

.header {
  background: rgba(255, 255, 255, 0.95);
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  margin-bottom: 30px;
}

.header h1 {
  font-size: 32px;
  color: #333;
  margin-bottom: 5px;
}

.header p {
  color: #666;
  font-size: 16px;
  margin-bottom: 15px;
}

.refresh-btn {
  background: #667eea;
  color: white;
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.2s;
}

.refresh-btn:hover {
  background: #764ba2;
}

.error-message {
  background: white;
  border-left: 5px solid #dc3545;
  color: #721c24;
  padding: 20px;
  border-radius: 12px;
  margin-bottom: 20px;
}

.loading {
  text-align: center;
  color: white;
  padding: 60px 20px;
}

.spinner {
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top: 4px solid white;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin: 20px auto;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
