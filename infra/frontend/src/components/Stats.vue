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
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.stat-card {
  background: linear-gradient(135deg, #2a2a3e 0%, #1e1e2e 100%);
  padding: 20px 24px;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: 4px solid #4a9eff;
  transition: all 0.3s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(74, 158, 255, 0.15);
}

.stat-card.running {
  border-left-color: #4caf50;
}

.stat-card.running:hover {
  box-shadow: 0 12px 40px rgba(76, 175, 80, 0.15);
}

.stat-card.stopped {
  border-left-color: #f44336;
}

.stat-card.stopped:hover {
  box-shadow: 0 12px 40px rgba(244, 67, 54, 0.15);
}

.stat-label {
  font-size: 11px;
  color: #8080a0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
  font-weight: 600;
}

.stat-value {
  font-size: 42px;
  font-weight: 700;
  color: #ffffff;
}
</style>
