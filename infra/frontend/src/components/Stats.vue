<template>
  <div class="stats">
    <div class="stat-card">
      <div class="stat-label">Total Pods</div>
      <div class="stat-value">{{ stats.total_pods ?? 0 }}</div>
    </div>
    <div class="stat-card running">
      <div class="stat-label">Running</div>
      <div class="stat-value">{{ stats.running_pods ?? 0 }}</div>
    </div>
    <div class="stat-card stopped">
      <div class="stat-label">Stopped</div>
      <div class="stat-value">{{ stats.stopped_pods ?? 0 }}</div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  stats: {
    type: Object,
    required: true,
  },
})
</script>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
}

.stat-card {
  background: white;
  padding: 24px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-left: 5px solid #667eea;
}

.stat-card.running {
  border-left-color: #28a745;
}

.stat-card.stopped {
  border-left-color: #dc3545;
}

.stat-label {
  font-size: 13px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

.stat-value {
  font-size: 48px;
  font-weight: 700;
  color: #333;
}
</style>
