<template>
  <Teleport to="body">
    <div class="toast-container position-fixed end-0 p-3" style="z-index: 1090; top: var(--app-top-height, 3.75rem)" aria-live="polite" aria-atomic="true">
      <TransitionGroup name="toast-slide">
        <div v-for="t in toasts" :key="t.id" class="toast show align-items-center border-0 mb-2" :class="'text-bg-' + t.variant" role="status" data-testid="toast" :data-variant="t.variant">
          <div class="d-flex">
            <div class="toast-body">
              <strong v-if="t.title" class="me-1">{{ t.title }}.</strong>{{ t.body }}
              <a v-if="t.action" href="#" class="ms-1 text-reset fw-semibold" data-testid="toast-action" @click.prevent="t.action.run(); dismiss(t.id)">{{ t.action.label }}</a>
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" :aria-label="$t('toast.close')" data-testid="toast-close" @click="dismiss(t.id)"></button>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
/**
 * ToastHost — renders the global toast list (stores/toast.js) top right, just under the sticky nav bar and above everything,
 * teleported to <body> so no layout or modal can hide it. Mounted once in App.vue.
 */
import { storeToRefs } from 'pinia'
import { useToastStore } from '../stores/toast'

const toast = useToastStore()
const { toasts } = storeToRefs(toast)
const dismiss = toast.dismiss
</script>

<style scoped>
.toast-slide-enter-active, .toast-slide-leave-active { transition: all 0.2s ease; }
.toast-slide-enter-from, .toast-slide-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
