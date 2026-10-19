<template>
  <div class="d-flex flex-column gap-4">
    <!-- Create pod: the card header is the collapse trigger -->
    <BCard no-body>
      <button
        type="button"
        class="card-header card-header-toggle d-flex align-items-center"
        :aria-expanded="showCreateForm"
        aria-controls="create-pod-form"
        data-testid="create-pod-toggle"
        @click="toggleCreateForm"
      >
        <span class="fw-semibold">{{ $t('dashboard.createPod') }}</span>
        <i class="fa-solid fa-chevron-right ms-auto"></i>
      </button>
      <BCollapse id="create-pod-form" v-model="showCreateForm">
        <BCardBody>
          <PodForm ref="podForm" @pod-created="handlePodCreated" />
        </BCardBody>
      </BCollapse>
    </BCard>

    <!-- Pod list -->
    <BCard no-body>
      <BCardHeader class="d-flex align-items-center">
        <span class="fw-semibold">{{ $t('dashboard.pods') }}</span>
        <BBadge variant="secondary" pill class="ms-auto">{{ pods.pods.length }}</BBadge>
      </BCardHeader>
      <BCardBody>
        <div v-if="pods.pods.length === 0" class="text-center text-body-secondary py-4" data-testid="pods-empty">
          {{ $t('dashboard.noPods') }}
        </div>
        <BRow v-else class="g-3" data-testid="pod-list">
          <BCol v-for="pod in pods.pods" :key="pod.id" md="6" xl="4">
            <PodCard
              :pod="pod"
              :busy="pods.busyPodId === pod.id"
              @stop="pods.stop(pod.id)"
              @resume="pods.resume(pod.id)"
              @delete="pods.remove(pod.id)"
            />
          </BCol>
        </BRow>
      </BCardBody>
    </BCard>

    <BAlert
      v-if="pods.actionError"
      :model-value="true"
      variant="danger"
      dismissible
      data-testid="action-error"
      @update:model-value="pods.actionError = null"
    >
      {{ pods.actionError }}
    </BAlert>
  </div>
</template>

<script setup>
/**
 * Dashboard — the create-pod card and the pod list. The list, the busy state and every
 * action live in the pods store; this component only lays them out and collapses the
 * create form when a pod has been created.
 */
import { ref } from 'vue'
import PodCard from './PodCard.vue'
import PodForm from './PodForm.vue'
import { usePodsStore } from '../stores/pods'

const pods = usePodsStore()
const showCreateForm = ref(false)
const podForm = ref(null)

// Opening the form re-reads RunPod's stock so the card menu is current.
function toggleCreateForm() {
  showCreateForm.value = !showCreateForm.value
  if (showCreateForm.value) podForm.value?.loadGpus()
}

function handlePodCreated() {
  showCreateForm.value = false
}
</script>
