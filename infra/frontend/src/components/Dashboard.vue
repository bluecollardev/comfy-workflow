<template>
  <div class="pods-section">
    <h2>Your Pods</h2>

    <div v-if="pods.length === 0" class="empty-state">
      <p>📭 No pods found</p>
      <code>python3 create_pod.py create --name ComfyUI-Dev --gpu rtx4090</code>
    </div>

    <div v-else class="pods-grid">
      <PodCard
        v-for="pod in pods"
        :key="pod.id"
        :pod="pod"
        @stop="$emit('action', { type: 'stop', podId: pod.id })"
        @resume="$emit('action', { type: 'resume', podId: pod.id })"
        @delete="$emit('action', { type: 'delete', podId: pod.id })"
      />
    </div>
  </div>
</template>

<script setup>
import PodCard from './PodCard.vue'

defineProps({
  pods: {
    type: Array,
    required: true,
  },
})

defineEmits(['action'])
</script>

<style scoped>
.pods-section {
  margin-bottom: 40px;
}

.pods-section h2 {
  color: white;
  font-size: 28px;
  margin-bottom: 20px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.pods-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 20px;
}

.empty-state {
  background: white;
  border-left: 5px solid #ffc107;
  padding: 30px;
  border-radius: 12px;
  text-align: center;
  color: #666;
}

.empty-state p {
  margin-bottom: 15px;
  font-size: 18px;
}

.empty-state code {
  background: #f8f9fa;
  padding: 10px 15px;
  border-radius: 6px;
  display: block;
  margin-top: 10px;
  font-size: 12px;
}
</style>
