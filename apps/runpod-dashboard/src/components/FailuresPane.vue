<template>
  <div v-if="!fl.old && fl.loaded" class="mt-4" data-testid="queue-failures">
    <h6 class="mb-2">{{ $t('queue.fail.title', { n: fl.count }) }}</h6>
    <div v-if="!fl.items.length" class="text-body-secondary small" data-testid="failures-none">{{ $t('queue.fail.none') }}</div>
    <div v-for="f in fl.items" :key="f.id" class="border rounded p-2 mb-2 small" :class="{ 'border-danger': focus === f.id }" data-testid="failure-row" :data-id="f.id" :data-stage="f.stage">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <span class="text-nowrap" data-testid="failure-time" :title="agoShort(f.time)">{{ whenText(f.time) }}</span>
        <strong data-testid="failure-shot">{{ f.shot }}</strong><span class="font-monospace text-truncate" style="max-width: 18rem" :title="f.graph" data-testid="failure-graph">{{ f.graph }}</span><span v-if="f.version !== ''" data-testid="failure-version">v{{ String(f.version).replace(/^v/i, '').padStart(3, '0') }}</span>
        <span class="badge text-bg-danger fw-normal" data-testid="failure-stage">{{ f.stage }}</span>
        <span v-if="f.node" class="font-monospace text-body-secondary" data-testid="failure-node">{{ $t('queue.fail.node', { id: f.node.id, type: f.node.type }) }}</span>
        <span class="ms-auto d-inline-flex gap-2">
          <BButton v-if="f.retryable" size="sm" variant="outline-warning" :disabled="busy[f.id]" data-testid="failure-retry" @click="retry(f)"><BSpinner v-if="busy[f.id]" small class="me-2" />{{ $t('queue.fail.retry') }}</BButton>
          <BButton size="sm" variant="outline-light" data-testid="failure-copy" @click="copy(f)">{{ copied === f.id ? $t('queue.fail.copied') : $t('queue.fail.copy') }}</BButton>
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
  </div>
</template>

<script setup>
/** FailuresPane: the Queue's Failures list (Generations tab): one row per failed graph run, newest first, like the Finished lists; Retry only when the core says it is retryable; Copy puts the whole record on the clipboard as JSON. */
import { computed, reactive, ref, watch } from 'vue'
import { useFailuresStore } from '../stores/failures'
import { useUiStore } from '../stores/ui'
import { errorText } from '../stores/toast'
import { whenText, agoShort } from '../utils/when'

const fl = useFailuresStore(), ui = useUiStore()
const busy = reactive({}), errors = reactive({}), copied = ref('')
const focus = computed(() => ui.failureFocus)
const first = (m) => String(m || '').split('\n')[0]
async function retry(f) { busy[f.id] = true; errors[f.id] = ''; try { await fl.retry(f.id) } catch (e) { errors[f.id] = errorText(e) } finally { busy[f.id] = false } }
async function copy(f) { try { await navigator.clipboard.writeText(JSON.stringify(f, null, 2)); copied.value = f.id; setTimeout(() => (copied.value = ''), 2000) } catch { copied.value = '' } }
watch(focus, (id) => { if (id) setTimeout(() => document.querySelector(`[data-testid="failure-row"][data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }), 100) }, { immediate: true })
</script>
