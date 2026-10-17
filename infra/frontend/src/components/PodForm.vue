<template>
  <form @submit.prevent="submit" class="space-y-4">
    <!-- Basic Configuration Section -->
    <fieldset class="space-y-3">
      <legend class="text-sm font-semibold text-dark-200 uppercase tracking-wider">Basic Configuration</legend>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <!-- Pod Name -->
        <div>
          <label for="pod-name" class="block text-xs font-semibold text-dark-300 mb-1">Pod Name</label>
          <input
            id="pod-name"
            v-model="form.name"
            type="text"
            placeholder="e.g., ComfyUI-Dev"
            required
            class="w-full px-3 py-2 bg-black/20 text-white border border-dark-400 rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <!-- GPU Type -->
        <div>
          <label for="gpu-type" class="block text-xs font-semibold text-dark-300 mb-1">GPU Type</label>
          <select
            id="gpu-type"
            v-model="form.gpu"
            class="w-full px-3 py-2 bg-black/20 text-white border border-dark-400 rounded text-sm focus:outline-none focus:border-primary"
          >
            <option value="rtx4090">RTX 4090</option>
            <option value="a100">A100</option>
            <option value="h100">H100</option>
            <option value="l40s">L40S</option>
          </select>
        </div>

        <!-- GPU Count -->
        <div>
          <label for="gpu-count" class="block text-xs font-semibold text-dark-300 mb-1">GPU Count</label>
          <select
            id="gpu-count"
            v-model.number="form.gpuCount"
            class="w-full px-3 py-2 bg-black/20 text-white border border-dark-400 rounded text-sm focus:outline-none focus:border-primary"
          >
            <option v-for="i in 8" :key="i" :value="i">{{ i }}</option>
          </select>
        </div>

        <!-- Instance Type -->
        <div>
          <label for="instance-type" class="block text-xs font-semibold text-dark-300 mb-1">Instance Type</label>
          <select
            id="instance-type"
            v-model="form.instanceType"
            class="w-full px-3 py-2 bg-black/20 text-white border border-dark-400 rounded text-sm focus:outline-none focus:border-primary"
          >
            <option value="on-demand">On-Demand</option>
            <option value="spot">Spot</option>
          </select>
        </div>

        <!-- Volume Size -->
        <div>
          <label for="volume-gb" class="block text-xs font-semibold text-dark-300 mb-1">Volume (GB)</label>
          <input
            id="volume-gb"
            v-model.number="form.volumeGb"
            type="number"
            min="10"
            max="500"
            class="w-full px-3 py-2 bg-black/20 text-white border border-dark-400 rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <!-- Disk Size -->
        <div>
          <label for="disk-gb" class="block text-xs font-semibold text-dark-300 mb-1">Disk (GB)</label>
          <input
            id="disk-gb"
            v-model.number="form.diskGb"
            type="number"
            min="5"
            max="100"
            class="w-full px-3 py-2 bg-black/20 text-white border border-dark-400 rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <!-- Docker Image -->
        <div class="sm:col-span-2 lg:col-span-1">
          <label for="image" class="block text-xs font-semibold text-dark-300 mb-1">Docker Image</label>
          <select
            id="image"
            v-model="form.image"
            class="w-full px-3 py-2 bg-black/20 text-white border border-dark-400 rounded text-sm focus:outline-none focus:border-primary"
          >
            <option value="prebuilt">ComfyUI (ashleykza)</option>
            <option value="custom">Custom Docker URI</option>
          </select>
        </div>

        <!-- Custom Image URI (conditional) -->
        <div v-if="form.image === 'custom'" class="sm:col-span-2 lg:col-span-1">
          <label for="image-uri" class="block text-xs font-semibold text-dark-300 mb-1">Docker URI</label>
          <input
            id="image-uri"
            v-model="form.customImageUri"
            type="text"
            placeholder="docker.io/repo/image:tag"
            class="w-full px-3 py-2 bg-black/20 text-white border border-dark-400 rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>
      </div>
    </fieldset>

    <!-- Advanced Sections (Collapsible) -->
    <div class="space-y-2">
      <!-- Environment Variables -->
      <button
        type="button"
        @click="expanded.envVars = !expanded.envVars"
        class="w-full text-left px-3 py-2 text-primary hover:text-info font-semibold flex items-center gap-2"
      >
        <span>{{ expanded.envVars ? '▼' : '▶' }}</span>
        Environment Variables
      </button>
      <transition name="expand">
        <fieldset v-if="expanded.envVars" class="space-y-2 p-4 bg-black/10 rounded">
          <legend class="text-xs font-semibold text-dark-300 uppercase">Env Variables</legend>
          <textarea
            v-model="form.envVars"
            rows="3"
            placeholder="KEY=value&#10;ANOTHER=value"
            class="w-full px-3 py-2 bg-black/20 text-white border border-dark-400 rounded text-xs font-mono focus:outline-none focus:border-primary"
          />
          <small class="text-dark-400">One per line, KEY=value format</small>
        </fieldset>
      </transition>

      <!-- Pip Requirements -->
      <button
        type="button"
        @click="expanded.pipReqs = !expanded.pipReqs"
        class="w-full text-left px-3 py-2 text-primary hover:text-info font-semibold flex items-center gap-2"
      >
        <span>{{ expanded.pipReqs ? '▼' : '▶' }}</span>
        Custom Pip Requirements
      </button>
      <transition name="expand">
        <fieldset v-if="expanded.pipReqs" class="space-y-2 p-4 bg-black/10 rounded">
          <legend class="text-xs font-semibold text-dark-300 uppercase">Pip Packages</legend>
          <textarea
            v-model="form.pipRequirements"
            rows="3"
            placeholder="torch==2.0.0&#10;torchaudio==2.0.0"
            class="w-full px-3 py-2 bg-black/20 text-white border border-dark-400 rounded text-xs font-mono focus:outline-none focus:border-primary"
          />
          <small class="text-dark-400">One per line, supports version pinning (package==version)</small>
        </fieldset>
      </transition>

      <!-- Custom Nodes -->
      <button
        type="button"
        @click="expanded.customNodes = !expanded.customNodes"
        class="w-full text-left px-3 py-2 text-primary hover:text-info font-semibold flex items-center gap-2"
      >
        <span>{{ expanded.customNodes ? '▼' : '▶' }}</span>
        Custom ComfyUI Nodes
      </button>
      <transition name="expand">
        <fieldset v-if="expanded.customNodes" class="space-y-2 p-4 bg-black/10 rounded">
          <legend class="text-xs font-semibold text-dark-300 uppercase">Node Git Repos</legend>
          <textarea
            v-model="form.customNodes"
            rows="3"
            placeholder="https://github.com/user/comfy-node-pack&#10;https://github.com/another/pack"
            class="w-full px-3 py-2 bg-black/20 text-white border border-dark-400 rounded text-xs font-mono focus:outline-none focus:border-primary"
          />
          <small class="text-dark-400">One Git repo URL per line</small>
        </fieldset>
      </transition>
    </div>

    <!-- Form Actions -->
    <div class="flex gap-2 pt-4 border-t border-light">
      <button type="submit" :disabled="loading" class="btn-primary flex-1">
        <span v-if="!loading">🚀 Create Pod</span>
        <span v-else>Creating...</span>
      </button>
      <button type="reset" class="btn-secondary flex-1">
        Clear Form
      </button>
    </div>

    <!-- Error Display -->
    <transition name="fade">
      <div v-if="error" class="alert-error flex items-center justify-between">
        <span>{{ error }}</span>
        <button @click="error = null" class="text-lg opacity-70 hover:opacity-100">
          ×
        </button>
      </div>
    </transition>
  </form>
</template>

<script setup>
/**
 * PodForm.vue - Pod creation form component
 *
 * Comprehensive form for configuring and creating a new RunPod pod.
 *
 * Features:
 * - Basic configuration: name, GPU, count, instance type, storage
 * - Collapsible advanced sections:
 *   - Environment variables
 *   - Custom pip requirements
 *   - Custom ComfyUI node packs
 * - Form validation
 * - Error handling and display
 * - Loading state during submission
 *
 * Events:
 * - pod-created: Emitted on successful creation
 */

import { ref } from 'vue'
import { podsAPI } from '../api/pods'

// ===== FORM STATE =====

/**
 * Form data object
 * All values tied to form inputs
 */
const form = ref({
  name: '',
  gpu: 'rtx4090',
  gpuCount: 1,
  instanceType: 'on-demand',
  volumeGb: 50,
  diskGb: 20,
  image: 'prebuilt',
  customImageUri: '',
  envVars: '',
  pipRequirements: '',
  customNodes: '',
})

/**
 * Which sections are expanded
 */
const expanded = ref({
  envVars: false,
  pipReqs: false,
  customNodes: false,
})

/**
 * Form submission loading state
 */
const loading = ref(false)

/**
 * Error message from last failed submission
 */
const error = ref(null)

// ===== METHODS =====

/**
 * Submit form and create pod
 * - Validates required fields
 * - Calls podsAPI.createPod()
 * - Emits 'pod-created' event on success
 * - Displays error message on failure
 *
 * @async
 */
async function submit() {
  // Validation
  if (!form.value.name.trim()) {
    error.value = 'Pod name is required'
    return
  }

  if (form.value.image === 'custom' && !form.value.customImageUri.trim()) {
    error.value = 'Custom image URI is required when "Custom Docker URI" is selected'
    return
  }

  loading.value = true
  error.value = null

  try {
    // Prepare payload
    const payload = {
      name: form.value.name.trim(),
      gpu: form.value.gpu,
      gpu_count: form.value.gpuCount,
      instance_type: form.value.instanceType,
      volume_gb: form.value.volumeGb,
      disk_gb: form.value.diskGb,
      image_uri: form.value.image === 'custom'
        ? form.value.customImageUri.trim()
        : 'ashleykza/comfyui:latest',
      environment_variables: parseLines(form.value.envVars),
      pip_requirements: parseLines(form.value.pipRequirements),
      custom_nodes: parseLines(form.value.customNodes),
    }

    // Call API
    await podsAPI.createPod(payload)

    // Reset form
    form.value = {
      name: '',
      gpu: 'rtx4090',
      gpuCount: 1,
      instanceType: 'on-demand',
      volumeGb: 50,
      diskGb: 20,
      image: 'prebuilt',
      customImageUri: '',
      envVars: '',
      pipRequirements: '',
      customNodes: '',
    }

    // Emit success event
    defineEmits(['pod-created'])()
  } catch (e) {
    error.value = e.response?.data?.detail || e.message || 'Failed to create pod'
    console.error('Pod creation error:', e)
  } finally {
    loading.value = false
  }
}

/**
 * Parse newline-separated text into array of non-empty lines
 *
 * @param {string} text - Newline-separated text
 * @returns {Array<string>} Array of non-empty lines
 */
function parseLines(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

// ===== EMIT =====

defineEmits({
  'pod-created': null,
})
</script>

<style scoped>
/* All styling handled by index.css and Tailwind */
</style>
