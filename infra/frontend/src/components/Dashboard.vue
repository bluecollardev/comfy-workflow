<template>
  <div class="space-y-6">
    <!-- Create Pod Section -->
    <section class="card-dark p-3">
      <button
        type="button"
        @click="showCreateForm = !showCreateForm"
        class="section-header"
      >
        <h2>Create Pod</h2>
        <span class="toggle-icon" :class="{ rotated: showCreateForm }">›</span>
      </button>

      <!-- Collapsible Form -->
      <transition name="expand">
        <div v-if="showCreateForm" class="mt-4">
          <PodForm @pod-created="handlePodCreated" />
        </div>
      </transition>
    </section>

    <!-- Pods List Section -->
    <section class="card-dark p-3">
      <div class="section-header pointer-events-none">
        <h2>Pods</h2>
        <span class="inline-block bg-primary/20 text-primary px-2 py-1 rounded-full text-xs font-semibold ms-auto">
          {{ pods.length }}
        </span>
      </div>

      <div class="mt-4">
        <!-- Empty State -->
        <div v-if="pods.length === 0" class="text-center py-12">
          <p class="text-dark-300 text-sm">No pods running</p>
        </div>

        <!-- Pods Grid -->
        <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
    </section>

    <!-- Loading Overlay -->
    <div v-if="loading" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div class="text-center">
        <div class="spinner mb-4"></div>
        <p class="text-dark-200">Loading...</p>
      </div>
    </div>

    <!-- Error Alert -->
    <transition name="slide">
      <div
        v-if="error"
        class="fixed bottom-5 right-5 max-w-md z-40 alert-error flex items-center justify-between"
      >
        <span>{{ error }}</span>
        <button @click="error = null" class="text-lg opacity-70 hover:opacity-100 ms-4">
          ×
        </button>
      </div>
    </transition>
  </div>
</template>

<script setup>
/**
 * Dashboard.vue - Main dashboard container component
 *
 * Responsibilities:
 * - Manage pod creation form visibility (collapsible)
 * - Render pod list in responsive grid
 * - Handle pod lifecycle actions (stop, resume, delete)
 * - Display loading states and error messages
 * - Emit 'pods-updated' event to parent after actions
 *
 * Props:
 * - pods: Array of pod objects to display
 *
 * Events:
 * - pods-updated: Emitted with updated pods array after any action
 *
 * Child Components:
 * - PodForm: Form for creating new pods (shown when expanded)
 * - PodCard: Individual pod display card (shown for each pod)
 */

import { ref } from 'vue'
import PodCard from './PodCard.vue'
import PodForm from './PodForm.vue'
import { podsAPI } from '../api/pods'

// ===== PROPS & EMITS =====

const props = defineProps({
  /**
   * Array of pod objects to display
   * @type {Array<Object>}
   */
  pods: {
    type: Array,
    required: true,
  },
})

const emit = defineEmits({
  /**
   * Emitted when pods list changes (create, stop, resume, delete)
   * @param {Array} pods - Updated pods array
   */
  'pods-updated': null,
})

// ===== STATE =====

/**
 * Whether the create form is visible
   * @type {Ref<boolean>}
 */
const showCreateForm = ref(false)

/**
 * Loading state during pod actions
 * @type {Ref<boolean>}
 */
const loading = ref(false)

/**
 * Error message from last failed action
 * @type {Ref<string|null>}
 */
const error = ref(null)

// ===== METHODS =====

/**
 * Refresh pods list from API and emit update event
 * @async
 * @private
 */
async function refreshPods() {
  const updatedPods = await podsAPI.listPods()
  emit('pods-updated', updatedPods)
}

/**
 * Handle new pod creation
 * - Hides form
 * - Refreshes pods list
 * - Clears any previous errors
 *
 * @async
 */
async function handlePodCreated() {
  loading.value = true
  error.value = null
  showCreateForm.value = false

  try {
    await refreshPods()
  } catch (err) {
    error.value = 'Failed to load pods after creation'
    console.error('Pod refresh error:', err)
  } finally {
    loading.value = false
  }
}

/**
 * Stop a running pod
 * - Calls API to stop pod by ID
 * - Refreshes pods list
 * - Displays error on failure
 *
 * @async
 * @param {string} podId - Pod ID to stop
 */
async function handleStop(podId) {
  loading.value = true
  error.value = null

  try {
    await podsAPI.stopPod(podId)
    await refreshPods()
  } catch (err) {
    error.value = `Stop failed: ${err.response?.data?.detail || err.message}`
    console.error('Stop pod error:', err)
  } finally {
    loading.value = false
  }
}

/**
 * Resume a stopped pod
 * - Calls API to resume pod by ID
 * - Refreshes pods list
 * - Displays error on failure
 *
 * @async
 * @param {string} podId - Pod ID to resume
 */
async function handleResume(podId) {
  loading.value = true
  error.value = null

  try {
    await podsAPI.resumePod(podId)
    await refreshPods()
  } catch (err) {
    error.value = `Resume failed: ${err.response?.data?.detail || err.message}`
    console.error('Resume pod error:', err)
  } finally {
    loading.value = false
  }
}

/**
 * Delete a pod
 * - Calls API to delete pod by ID
 * - Refreshes pods list
 * - Displays error on failure
 *
 * @async
 * @param {string} podId - Pod ID to delete
 */
async function handleDelete(podId) {
  loading.value = true
  error.value = null

  try {
    await podsAPI.deletePod(podId)
    await refreshPods()
  } catch (err) {
    error.value = `Delete failed: ${err.response?.data?.detail || err.message}`
    console.error('Delete pod error:', err)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
/* Tailwind handles all styling */
</style>
