<template>
  <BModal v-model="open" :title="$t('queue.title')" size="xl" scrollable no-footer data-testid="queue-modal" @hidden="open = false">
    <div v-if="error" class="alert alert-danger small py-2" data-testid="queue-error">{{ error }}</div>
    <div v-if="!view.imports.length" class="text-body-secondary small" data-testid="queue-empty">{{ $t('queue.empty') }}</div>
    <div v-for="imp in view.imports" :key="imp.id" class="mb-4" data-testid="queue-import" :data-import="imp.id">
      <div class="d-flex align-items-baseline gap-2 flex-wrap mb-1">
        <strong class="font-monospace">{{ imp.round }}</strong>
        <span class="badge" :class="imp.state === 'active' ? 'text-bg-primary' : 'text-bg-secondary'">{{ $t(`queue.import.${imp.state}`) }}</span>
        <span class="small text-body-secondary">{{ $t('queue.approvedBy', { who: imp.approved_by }) }} · {{ $t('queue.spent', { spent: imp.spent_usd, cap: imp.cap_enabled && imp.cost_cap_usd != null ? imp.cost_cap_usd : '∞' }) }} · {{ $t('queue.podLimit', { n: imp.max_pods ?? '∞' }) }}</span>
        <BButton v-if="imp.state === 'active'" size="sm" variant="outline-danger" class="ms-auto" data-testid="queue-cancel-import" @click="act(() => queueAPI.cancelImport(imp.id))">{{ $t('queue.cancelAll') }}</BButton>
      </div>
      <table class="table table-sm align-middle mb-0">
        <thead><tr><th>{{ $t('queue.task') }}</th><th>{{ $t('queue.state') }}</th><th>{{ $t('queue.pod') }}</th><th>{{ $t('queue.result') }}</th><th></th></tr></thead>
        <tbody>
          <tr v-for="t in tasksOf(imp)" :key="t.id" data-testid="queue-task" :data-state="t.state" :data-kind="t.kind">
            <td class="font-monospace small">{{ t.kind }}<span v-if="t.shot"> · {{ t.shot }}</span></td>
            <td><span class="badge" :class="badge(t.state)" data-testid="queue-task-state">{{ $t(`queue.state_${t.state}`) }}</span></td>
            <td class="small">{{ t.pod_name || '' }}</td>
            <td class="small" :class="t.error ? 'text-danger' : 'text-body-secondary'">{{ t.error || t.held_reason || t.detail || '' }}</td>
            <td class="text-end text-nowrap">
              <BButton v-if="['waiting', 'running', 'held'].includes(t.state)" size="sm" variant="outline-light" data-testid="queue-cancel" @click="act(() => queueAPI.cancelTask(t.id))">{{ $t('queue.cancel') }}</BButton>
              <BButton v-if="['failed', 'held', 'interrupted', 'cancelled'].includes(t.state)" size="sm" variant="outline-light" data-testid="queue-retry" @click="act(() => queueAPI.retryTask(t.id))">{{ $t('queue.retry') }}</BButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </BModal>
</template>

<script setup>
/** The Queue (ADR-038): every import's tasks with their state, pod and error; Cancel, Retry, Cancel all. Refreshes by itself while open. */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { queueAPI } from '../api/queue'
import { errorText } from '../stores/toast'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()
const open = computed({ get: () => ui.queueOpen, set: (v) => { ui.queueOpen = v } })
const view = ref({ imports: [], tasks: [], active: 0 }), error = ref('')
let timer = null
const tasksOf = (imp) => view.value.tasks.filter((t) => t.import_id === imp.id)
const badge = (s) => ({ done: 'text-bg-success', failed: 'text-bg-danger', running: 'text-bg-primary', waiting: 'text-bg-secondary', held: 'text-bg-warning', cancelled: 'text-bg-dark', interrupted: 'text-bg-warning' }[s] || 'text-bg-secondary')
async function refresh() { try { view.value = await queueAPI.list(); error.value = '' } catch (e) { error.value = errorText(e) } }
async function act(fn) { try { await fn() } catch (e) { error.value = errorText(e) } await refresh() }
onMounted(() => { refresh(); timer = setInterval(refresh, 2500) })
onBeforeUnmount(() => clearInterval(timer))
</script>
