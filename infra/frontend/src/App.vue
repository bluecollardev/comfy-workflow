<template>
  <div class="min-h-screen flex flex-col">
    <!-- Navbar -->
    <nav class="bg-gradient-card border-b border-light sticky top-0 z-40">
      <div class="mx-auto px-4 py-4 flex justify-between items-center gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white">RunPod Pod Manager</h1>
          <p class="text-dark-300 text-xs">Real-time management of your GPU pods</p>
        </div>
        <button
          @click="refresh"
          :disabled="loading"
          class="btn-primary whitespace-nowrap flex items-center gap-2"
        >
          <i :class="['fas fa-sync', { 'animate-spin': loading }]"></i>
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </nav>

    <!-- Main Content -->
    <div class="flex-1 container-lg mx-auto px-4 py-5">
      <!-- Error Alert -->
      <transition name="fade">
        <div
          v-if="error"
          class="alert-error mb-4 flex items-center justify-between"
        >
          <div>
            <strong>Error:</strong> {{ error }}
          </div>
          <button @click="error = null" class="text-lg opacity-70 hover:opacity-100">
            ×
          </button>
        </div>
      </transition>

      <!-- Loading State -->
      <transition name="fade">
        <div v-if="loading" class="text-center py-20">
          <div class="spinner mb-4"></div>
          <p class="text-dark-300">Loading pod data...</p>
        </div>
      </transition>

      <!-- Dashboard (when loaded) -->
      <template v-if="!loading">
        <Stats :stats="dashboard.stats" class="mb-8" />
        <Dashboard :pods="dashboard.pods" @pods-updated="handlePodsUpdated" />
      </template>
    </div>
  </div>
</template>

<script setup>
/**
 * App.vue - Root Application Component
 *
 * Main entry point for the RunPod Pod Manager dashboard.
 *
 * RESPONSIBILITIES:
 * - Fetch and manage dashboard data (stats + pods)
 * - Handle manual and auto-refresh (every 30s)
 * - Display loading states and error alerts
 * - Render header with title and refresh button
 * - Orchestrate child components (Stats, Dashboard)
 *
 * DATA FLOW:
 * 1. On mount: loadDashboard() fetches initial data
 * 2. Auto-refresh: setInterval calls loadDashboard every 30s
 * 3. Manual refresh: User clicks button → refresh()
 * 4. Pod updates: Dashboard emits 'pods-updated' → handlePodsUpdated()
 *
 * PROPS PASSED TO CHILDREN:
 * - Stats: receives stats object with pod counts
 * - Dashboard: receives pods array, emits updates
 *
 * STATE VARIABLES:
 * - dashboard: { stats: {...}, pods: [...] }
 * - loading: boolean - true while fetching data
 * - error: string | null - error message if API fails
 */

import { ref, onMounted } from 'vue'
import { podsAPI } from './api/pods'
import Dashboard from './components/Dashboard.vue'
import Stats from './components/Stats.vue'

// ===== STATE =====

/**
 * Dashboard data structure
 * @type {Ref<{stats: Object, pods: Array}>}
 */
const dashboard = ref({ stats: {}, pods: [] })

/**
 * Loading indicator - true while fetching data from API
 * @type {Ref<boolean>}
 */
const loading = ref(false)

/**
 * Error message from last failed API call
 * @type {Ref<string|null>}
 */
const error = ref(null)

// ===== METHODS =====

/**
 * Fetch dashboard data from API
 * - Sets loading state before fetch
 * - Clears previous errors
 * - Updates dashboard ref on success
 * - Captures error message on failure
 *
 * @async
 * @throws {Error} API error details in error.response.data
 */
async function loadDashboard() {
  try {
    loading.value = true
    error.value = null
    const data = await podsAPI.getDashboard()
    dashboard.value = data
  } catch (e) {
    error.value = e.response?.data?.detail || e.message || 'Failed to load dashboard'
    console.error('Dashboard load error:', e)
  } finally {
    loading.value = false
  }
}

/**
 * Handle pods list update from Dashboard component
 * Called when a pod is created, stopped, resumed, or deleted
 *
 * @param {Array} pods - Updated pods array from Dashboard
 */
function handlePodsUpdated(pods) {
  dashboard.value.pods = pods
}

/**
 * Trigger manual refresh
 * User clicks the refresh button → this runs
 */
function refresh() {
  loadDashboard()
}

// ===== LIFECYCLE =====

/**
 * On component mount:
 * 1. Load initial dashboard data
 * 2. Set up auto-refresh every 30 seconds
 */
onMounted(() => {
  // Load data immediately
  loadDashboard()

  // Auto-refresh every 30 seconds
  const refreshInterval = setInterval(loadDashboard, 30000)

  // Cleanup interval on component unmount (optional, but good practice)
  // This happens when app unmounts (rare for root component)
})
</script>

<style scoped>
/* Component-specific styles handled by index.css and Tailwind */
</style>
