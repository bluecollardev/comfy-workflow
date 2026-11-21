<template>
  <div v-if="!fl.old && fl.loaded" class="mt-4" data-testid="queue-failures">
    <div class="d-flex align-items-center gap-2 flex-wrap mb-2">
      <h6 class="mb-0">{{ $t('queue.fail.title', { n: fl.count }) }}</h6>
      <span class="ms-auto d-inline-flex gap-2">
        <BButton v-if="fl.items.length" size="sm" variant="outline-light" :disabled="bulk" data-testid="failures-dismiss-all" @click="dismissAll">{{ $t('queue.fail.dismissAll') }}</BButton>
        <BButton v-if="fl.dismissedCount || fl.showDismissed" size="sm" variant="outline-secondary" :pressed="fl.showDismissed" data-testid="failures-show-dismissed" @click="fl.toggleDismissed()">{{ $t('queue.fail.showDismissed', { n: fl.dismissedCount }) }}</BButton>
      </span>
    </div>
    <div v-if="bulkError" class="text-danger small mb-2" data-testid="failures-bulk-error">{{ bulkError }}</div>
    <div v-if="!fl.items.length" class="text-body-secondary small" data-testid="failures-none">{{ $t('queue.fail.none') }}</div>
    <div v-for="f in pg.rows" :key="f.id" class="border rounded p-2 mb-2 small" :class="{ 'border-danger': focus === f.id }" data-testid="failure-row" :data-id="f.id" :data-stage="f.stage">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <span class="text-nowrap" data-testid="failure-time" :title="agoShort(f.time)">{{ whenText(f.time) }}</span>
        <strong data-testid="failure-shot">{{ f.shot }}</strong><span class="font-monospace text-truncate" style="max-width: 18rem" :title="f.graph" data-testid="failure-graph">{{ f.graph }}</span><span v-if="f.version !== ''" data-testid="failure-version">v{{ String(f.version).replace(/^v/i, '').padStart(3, '0') }}</span>
        <span class="badge text-bg-danger fw-normal" data-testid="failure-stage">{{ f.stage }}</span>
        <span v-if="f.node" class="font-monospace text-body-secondary" data-testid="failure-node">{{ $t('queue.fail.node', { id: f.node.id, type: f.node.type }) }}</span>
        <span class="ms-auto d-inline-flex gap-2">
          <BButton v-if="f.retryable" size="sm" variant="outline-warning" :disabled="busy[f.id]" data-testid="failure-retry" @click="retry(f)"><BSpinner v-if="busy[f.id]" small class="me-2" />{{ $t('queue.fail.retry') }}</BButton>
          <BButton size="sm" variant="outline-light" data-testid="failure-copy" @click="copy(f)">{{ copied === f.id ? $t('queue.fail.copied') : $t('queue.fail.copy') }}</BButton>
          <BButton size="sm" variant="outline-secondary" :disabled="busy[f.id]" data-testid="failure-dismiss" @click="dismiss(f)">{{ $t('queue.fail.dismiss') }}</BButton>
        </span>
      </div>
      <div class="text-danger mt-1" data-testid="failure-message">{{ first(f.message) }}</div>
      <details class="mt-1" :open="focus === f.id" data-testid="failure-more"><summary class="text-body-secondary">{{ $t('queue.fail.more') }}</summary>
        <pre class="mb-1 small bg-body-tertiary rounded p-2" style="white-space: pre-wrap" data-testid="failure-full">{{ f.message }}</pre>
        <pre v-if="f.log_text" class="mb-0 small bg-body-tertiary rounded p-2" style="white-space: pre-wrap; max-height: 10rem; overflow: auto" data-testid="failure-log">{{ f.log_text }}</pre></details>
      <div v-if="f.missing_models.length" class="mt-1" data-testid="failure-missing"><span class="fw-semibold">{{ $t('queue.fail.missing') }}:</span>
        <div v-for="m in f.missing_models" :key="m.name" class="font-monospace" data-testid="failure-missing-row">{{ m.name }}<span v-if="(m.where || []).length" class="text-body-secondary"> · {{ $t('queue.fail.existsOn', { where: m.where.join(', ') }) }}</span></div></div>
      <div v-if="f.recovery" class="text-body-secondary mt-1" data-testid="failure-recovery">{{ f.recovery }}</div>
      <div v-if="f.attempt > 1" class="text-body-secondary" data-testid="failure-attempt">{{ $t('queue.fail.attempt', { n: f.attempt }) }}</div>
      <div v-if="errors[f.id]" class="text-danger" data-testid="failure-error">{{ errors[f.id] }}</div>
    </div>
    <div v-if="fl.items.length > PAGE_SIZES[0]" class="d-flex align-items-center gap-2 flex-wrap" data-testid="failures-pager">
      <BButton size="sm" variant="outline-light" :disabled="pg.page === 0" data-testid="failures-page-prev" @click="page--"><i class="fa-solid fa-chevron-left me-1"></i>{{ $t('queue.fail.prev') }}</BButton>
      <span data-testid="failures-page-info">{{ pg.info }}</span>
      <BButton size="sm" variant="outline-light" :disabled="pg.page >= pg.count - 1" data-testid="failures-page-next" @click="page++">{{ $t('queue.fail.next') }}<i class="fa-solid fa-chevron-right ms-1"></i></BButton>
      <select v-model.number="pageSize" class="form-select form-select-sm ms-auto" style="width: auto" :aria-label="$t('queue.fail.pageSize')" data-testid="failures-page-size"><option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ $t('queue.fail.perPage', { n }) }}</option></select>
    </div>
    <div v-if="fl.showDismissed" class="mt-3" data-testid="failures-dismissed">
      <div class="d-flex align-items-center gap-2 mb-2"><h6 class="mb-0 text-body-secondary">{{ $t('queue.fail.dismissedTitle', { n: fl.dismissedItems.length }) }}</h6>
        <BButton v-if="fl.dismissedItems.length" size="sm" variant="outline-light" class="ms-auto" :disabled="bulk" data-testid="failures-restore-all" @click="restoreAll">{{ $t('queue.fail.restoreAll') }}</BButton></div>
      <div v-if="!fl.dismissedItems.length" class="text-body-secondary small" data-testid="failures-dismissed-none">{{ $t('queue.fail.dismissedNone') }}</div>
      <div v-for="f in fl.dismissedItems" :key="f.id" class="border rounded p-2 mb-2 small text-body-secondary" data-testid="failure-dismissed-row" :data-id="f.id">
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <span class="text-nowrap" :title="agoShort(f.time)">{{ whenText(f.time) }}</span><strong>{{ f.shot }}</strong><span class="font-monospace text-truncate" style="max-width: 18rem" :title="f.graph">{{ f.graph }}</span>
          <span class="badge text-bg-secondary fw-normal">{{ f.stage }}</span>
          <BButton size="sm" variant="outline-light" class="ms-auto" :disabled="busy[f.id]" data-testid="failure-restore" @click="restoreOne(f)">{{ $t('queue.fail.restore') }}</BButton>
        </div>
        <div class="mt-1">{{ first(f.message) }}</div>
        <div v-if="errors[f.id]" class="text-danger" data-testid="failure-error">{{ errors[f.id] }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
/** FailuresPane: the Queue's Failures list (Generations tab): one row per failed graph run, newest first, like the Finished lists; Retry only when the core says it is retryable; Copy puts the whole record on the clipboard as JSON. */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFailuresStore } from '../stores/failures'
import { useConfirmStore } from '../stores/confirm'
import { useUiStore } from '../stores/ui'
import { errorText } from '../stores/toast'
import { whenText, agoShort } from '../utils/when'
import { paged, PAGE_SIZES } from '../utils/generations'

const fl = useFailuresStore(), ui = useUiStore(), confirm = useConfirmStore(), { t } = useI18n()
const busy = reactive({}), errors = reactive({}), copied = ref(''), bulk = ref(false), bulkError = ref('')
/** Dismiss hides a failure from the Queue by id (failures.jsonl is not changed); Dismiss All asks first and says how many; Restore brings them back. */
async function dismiss(f) { busy[f.id] = true; errors[f.id] = ''; try { await fl.dismiss([f.id]) } catch (e) { errors[f.id] = errorText(e) } finally { busy[f.id] = false } }
async function restoreOne(f) { busy[f.id] = true; errors[f.id] = ''; try { await fl.restore([f.id]) } catch (e) { errors[f.id] = errorText(e) } finally { busy[f.id] = false } }
async function dismissAll() {
  bulk.value = true; bulkError.value = ''
  try {
    const plan = await fl.planAll(false)
    if (!plan?.count) return
    if (!(await confirm.ask(t('queue.fail.dismissAllMessage', { n: plan.count }), { title: t('queue.fail.dismissAllTitle'), okLabel: t('queue.fail.dismissAll'), danger: false }))) return
    await fl.dismissAll()
  } catch (e) { bulkError.value = errorText(e) } finally { bulk.value = false }
}
async function restoreAll() { bulk.value = true; bulkError.value = ''; try { await fl.restoreAll() } catch (e) { bulkError.value = errorText(e) } finally { bulk.value = false } }
// Paging (5, 10 or 25; 10 by default): newest first as the store gives them; a new size starts at page 1; a page that empties moves back
const page = ref(0), pageSize = ref(10)
const pg = computed(() => paged(fl.items, page.value, pageSize.value))
watch(pageSize, () => { page.value = 0 })
watch(() => pg.value.page, (p) => { if (p !== page.value) page.value = p })
// Opening a failure from a job (Queue link) shows the page it is on
watch(() => ui.failureFocus, (id) => { const i = fl.items.findIndex((x) => x.id === id); if (i >= 0) page.value = Math.floor(i / pageSize.value) }, { immediate: true })
const focus = computed(() => ui.failureFocus)
const first = (m) => String(m || '').split('\n')[0]
async function retry(f) { busy[f.id] = true; errors[f.id] = ''; try { await fl.retry(f.id) } catch (e) { errors[f.id] = errorText(e) } finally { busy[f.id] = false } }
async function copy(f) { try { await navigator.clipboard.writeText(JSON.stringify(f, null, 2)); copied.value = f.id; setTimeout(() => (copied.value = ''), 2000) } catch { copied.value = '' } }
watch(focus, (id) => { if (id) setTimeout(() => document.querySelector(`[data-testid="failure-row"][data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }), 100) }, { immediate: true })
</script>
