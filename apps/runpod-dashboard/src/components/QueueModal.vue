<template>
  <BModal v-model="open" :title="$t('queue.title')" size="xl" scrollable no-footer data-testid="queue-modal" @hidden="open = false">
    <div v-if="error" class="alert alert-danger small py-2" data-testid="queue-error">{{ error }}</div>
    <div v-if="ui.queueStartError" class="alert alert-danger small py-2" data-testid="queue-start-error">{{ $t('queue.startFailed', { why: ui.queueStartError }) }}</div>
    <div v-if="ui.queueStarting.length" class="alert alert-info small py-2 d-flex align-items-center gap-2" data-testid="queue-starting"><BSpinner small />{{ $t('queue.starting', { rounds: ui.queueStarting.join(', ') }, ui.queueStarting.length) }}</div>
    <div v-if="!view.imports.length && !ui.queueStarting.length" class="text-body-secondary small" data-testid="queue-empty">{{ $t('queue.empty') }}</div>
    <div v-for="imp in newestFirst" :key="imp.id" class="mb-4" data-testid="queue-import" :data-import="imp.id">
      <div class="d-flex align-items-baseline gap-2 flex-wrap mb-1">
        <strong class="font-monospace">{{ imp.round }}</strong>
        <span class="badge" :class="imp.state === 'active' ? 'text-bg-primary' : 'text-bg-secondary'">{{ $t(`queue.import.${imp.state}`) }}</span>
        <span class="small text-body-secondary">{{ $t('queue.approvedBy', { who: imp.approved_by }) }} · {{ $t('queue.spent', { spent: imp.spent_usd, cap: imp.cap_enabled && imp.cost_cap_usd != null ? imp.cost_cap_usd : '∞' }) }} · {{ $t('queue.podLimit', { n: imp.max_pods ?? '∞' }) }}</span>
        <BButton v-if="imp.state === 'active'" size="sm" variant="outline-danger" class="ms-auto" data-testid="queue-cancel-import" @click="act(() => queueAPI.cancelImport(imp.id))">{{ $t('queue.cancelAll') }}</BButton>
      </div>
      <table class="table table-sm align-middle mb-0">
        <thead><tr><th>{{ $t('queue.task') }}</th><th>{{ $t('queue.state') }}</th><th>{{ $t('queue.pod') }}</th><th>{{ $t('queue.result') }}</th><th></th></tr></thead>
        <tbody>
          <template v-for="t in tasksOf(imp)" :key="t.id">
            <tr data-testid="queue-task" :data-state="t.state" :data-kind="t.kind">
              <td class="font-monospace small">{{ t.kind }}<span v-if="t.shot"> · {{ t.shot }}</span></td>
              <td>
                <span class="badge" :class="badge(t.state)" data-testid="queue-task-state">{{ $t(`queue.state_${t.state}`) }}</span>
                <div v-if="t.stage" class="small text-body-secondary" data-testid="queue-task-stage">{{ t.stage }}</div>
              </td>
              <td class="small">
                <template v-if="t.pod_id">{{ t.pod_name }}<div class="text-body-secondary font-monospace">{{ t.pod_id }}</div></template>
                <div v-else-if="t.pod_name" class="text-body-secondary">{{ $t('queue.podNotCreated') }}</div>
                <div v-if="t.card" class="text-body-secondary" data-testid="queue-task-card">{{ t.card }}</div>
                <div v-else-if="t.gpu" class="text-body-secondary" data-testid="queue-task-card">{{ $t('queue.cardWanted', { card: t.gpu }) }}</div>
              </td>
              <td class="small" :class="t.error ? 'text-danger' : 'text-body-secondary'">{{ t.error || t.held_reason || t.detail || '' }}<div v-if="t.started_at" class="text-body-secondary">{{ $t('queue.started', { at: clock(t.started_at) }) }}<template v-if="t.finished_at"> · {{ $t('queue.took', { min: mins(t) }) }}</template></div></td>
              <td class="text-end text-nowrap">
                <div class="d-inline-flex gap-2 justify-content-end" data-testid="queue-actions">
                  <BButton v-if="t.events?.length" size="sm" variant="outline-light" :aria-expanded="open_.has(t.id)" data-testid="queue-details" @click="toggleDetails(t.id)"><i class="fa-solid" :class="open_.has(t.id) ? 'fa-chevron-up' : 'fa-list'"></i></BButton>
                  <BButton v-if="['waiting', 'running', 'held'].includes(t.state)" size="sm" variant="outline-light" data-testid="queue-cancel" @click="act(() => queueAPI.cancelTask(t.id))">{{ $t('queue.cancel') }}</BButton>
                  <BButton v-if="['failed', 'held', 'interrupted', 'cancelled'].includes(t.state)" size="sm" variant="outline-light" data-testid="queue-retry" @click="act(() => queueAPI.retryTask(t.id))">{{ $t('queue.retry') }}</BButton>
                </div>
              </td>
            </tr>
            <tr v-if="open_.has(t.id)" data-testid="queue-task-events">
              <td colspan="5" class="small font-monospace bg-body-tertiary">
                <div v-for="(e, i) in t.events" :key="i"><span class="text-body-secondary">{{ clock(e.at) }}</span> {{ e.text }}</div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </BModal>
</template>

<script setup>
/** The Queue (ADR-038): every import's tasks with their state, pod and error; Cancel, Retry, Cancel all. Refreshes by itself while open. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { queueAPI } from '../api/queue'
import { errorText } from '../stores/toast'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()
const open = computed({ get: () => ui.queueOpen, set: (v) => { ui.queueOpen = v } })
const view = ref({ imports: [], tasks: [], active: 0 }), error = ref('')
let timer = null
/** The latest import at the top, the oldest at the bottom. */
const newestFirst = computed(() => [...view.value.imports].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))))
const open_ = ref(new Set())
const toggleDetails = (id) => { const n = new Set(open_.value); n.has(id) ? n.delete(id) : n.add(id); open_.value = n }
const clock = (iso) => new Date(iso).toLocaleTimeString()
const mins = (t) => Math.max(1, Math.round((new Date(t.finished_at) - new Date(t.started_at)) / 60000))
const tasksOf = (imp) => view.value.tasks.filter((t) => t.import_id === imp.id)
const badge = (s) => ({ done: 'text-bg-success', failed: 'text-bg-danger', running: 'text-bg-primary', waiting: 'text-bg-secondary', held: 'text-bg-warning', cancelled: 'text-bg-dark', interrupted: 'text-bg-warning' }[s] || 'text-bg-secondary')
async function refresh() { try { view.value = await queueAPI.list(); error.value = '' } catch (e) { error.value = errorText(e) } }
async function act(fn) { try { await fn() } catch (e) { error.value = errorText(e) } await refresh() }
watch(() => ui.queueVersion, refresh)   // an import was just queued: show it now, not at the next tick
onMounted(() => { refresh(); timer = setInterval(refresh, 2500) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped>
/* the list scrolls inside the window however many imports there are */
:deep(.modal-body) { overflow-y: auto; max-height: calc(100vh - 9rem); overscroll-behavior: contain; }
</style>
