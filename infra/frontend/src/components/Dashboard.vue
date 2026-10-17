<template>
  <div class="d-flex flex-column gap-4">
    <!-- Create pod: the card header is the collapse trigger -->
    <BCard no-body>
      <button
        type="button"
        class="card-header card-header-toggle d-flex align-items-center"
        :aria-expanded="showCreateForm"
        aria-controls="create-pod-form"
        @click="showCreateForm = !showCreateForm"
      >
        <span class="fw-semibold">Create pod</span>
        <i class="fa-solid fa-chevron-right ms-auto"></i>
      </button>
      <BCollapse id="create-pod-form" v-model="showCreateForm">
        <BCardBody>
          <PodForm @pod-created="handlePodCreated" />
        </BCardBody>
      </BCollapse>
    </BCard>

    <!-- Pod list -->
    <BCard no-body>
      <BCardHeader class="d-flex align-items-center">
        <span class="fw-semibold">Pods</span>
        <BBadge variant="secondary" pill class="ms-auto">{{ pods.length }}</BBadge>
      </BCardHeader>
      <BCardBody>
        <div v-if="pods.length === 0" class="text-center text-body-secondary py-4">
          No pods
        </div>
        <BRow v-else class="g-3">
          <BCol v-for="pod in pods" :key="pod.id" md="6" xl="4">
            <PodCard
              :pod="pod"
              :busy="busyPodId === pod.id"
              @stop="runAction(pod.id, podsAPI.stopPod, 'Stop')"
              @resume="runAction(pod.id, podsAPI.resumePod, 'Resume')"
              @delete="runAction(pod.id, podsAPI.deletePod, 'Delete')"
            />
          </BCol>
        </BRow>
      </BCardBody>
    </BCard>

    <BAlert
      v-if="error"
      :model-value="true"
      variant="danger"
      dismissible
      @update:model-value="error = null"
    >
      {{ error }}
    </BAlert>
  </div>
</template>

<script setup>
/**
 * Dashboard — the create-pod card and the pod list.
 *
 * Props:
 *   pods  Array<Pod>
 * Emits:
 *   pods-updated (Array<Pod>)  — after a create / stop / resume / delete, with a fresh GET /api/pods
 *
 * Mutations run one pod at a time; the affected card shows a busy state while
 * the request is in flight. Errors from the API surface in the alert at the bottom.
 */
import { ref } from 'vue'
import PodCard from './PodCard.vue'
import PodForm from './PodForm.vue'
import { podsAPI } from '../api/pods'

defineProps({
  pods: { type: Array, required: true },
})
const emit = defineEmits(['pods-updated'])

const showCreateForm = ref(false)
const busyPodId = ref(null)
const error = ref(null)

async function refreshPods() {
  emit('pods-updated', await podsAPI.listPods())
}

async function handlePodCreated() {
  showCreateForm.value = false
  try {
    await refreshPods()
  } catch (e) {
    error.value = `Pod created, but the list failed to refresh: ${e.message}`
  }
}

async function runAction(podId, action, label) {
  busyPodId.value = podId
  error.value = null
  try {
    await action(podId)
    await refreshPods()
  } catch (e) {
    error.value = `${label} failed: ${e.response?.data?.detail || e.message}`
  } finally {
    busyPodId.value = null
  }
}
</script>
