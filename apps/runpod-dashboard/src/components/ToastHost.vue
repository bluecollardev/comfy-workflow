<template>
  <Teleport to="body">
    <div class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1090" aria-live="polite" aria-atomic="true">
      <TransitionGroup name="toast-slide">
        <div v-for="t in toasts" :key="t.id" class="toast show align-items-center border-0 mb-2" :class="'text-bg-' + t.variant" role="status">
          <div class="d-flex">
            <div class="toast-body">
              <strong v-if="t.title" class="me-1">{{ t.title }}.</strong>{{ t.body }}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" aria-label="Close" @click="dismiss(t.id)"></button>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
/**
 * ToastHost — renders the global toast list (stores/toast.js) top right, above everything,
 * teleported to <body> so no layout or modal can hide it. Mounted once in App.vue.
 */
import { toasts, dismiss } from '../stores/toast'
</script>

<style scoped>
.toast-slide-enter-active, .toast-slide-leave-active { transition: all 0.2s ease; }
.toast-slide-enter-from, .toast-slide-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
