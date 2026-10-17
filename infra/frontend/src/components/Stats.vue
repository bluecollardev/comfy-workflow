<template>
  <div class="grid grid-cols-1 gap-3 mb-8 sm:grid-cols-2 lg:grid-cols-3">
    <!-- Total Pods Card -->
    <div class="card-dark p-5 border-l-4 border-primary hover:shadow-xl transition-all">
      <div class="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">
        Total Pods
      </div>
      <div class="text-5xl font-bold text-white">
        {{ stats.total_pods ?? 0 }}
      </div>
    </div>

    <!-- Running Pods Card -->
    <div class="card-dark p-5 border-l-4 border-success hover:shadow-xl transition-all">
      <div class="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">
        Running
      </div>
      <div class="text-5xl font-bold text-white">
        {{ stats.running_pods ?? 0 }}
      </div>
    </div>

    <!-- Stopped Pods Card -->
    <div class="card-dark p-5 border-l-4 border-danger hover:shadow-xl transition-all">
      <div class="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">
        Stopped
      </div>
      <div class="text-5xl font-bold text-white">
        {{ stats.stopped_pods ?? 0 }}
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * Stats.vue - Pod statistics display component
 *
 * Displays three key metrics in a responsive grid:
 * - Total Pods: All pods in the account
 * - Running Pods: Currently active pods (green indicator)
 * - Stopped Pods: Inactive pods (red indicator)
 *
 * Props:
 * - stats: Object containing statistics
 *   - total_pods: number
 *   - running_pods: number
 *   - stopped_pods: number
 *
 * Each stat card features:
 * - Card styling with dark gradient background
 * - Colored left border (blue/green/red)
 * - Large bold number display
 * - Hover effect (shadow lift)
 * - Responsive column layout (1 col mobile, 2 cols tablet, 3 cols desktop)
 *
 * @component
 */

defineProps({
  /**
   * Statistics object from dashboard
   * @type {Object}
   * @property {number} total_pods - Total pods in account
   * @property {number} running_pods - Currently running pods
   * @property {number} stopped_pods - Currently stopped pods
   */
  stats: {
    type: Object,
    required: true,
  },
})
</script>

<style scoped>
/* All styling handled by index.css and Tailwind */
</style>
