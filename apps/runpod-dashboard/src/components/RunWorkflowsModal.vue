<template>
  <BModal v-model="open" :title="$t('runflows.title', { name: pod.name })" size="lg" scrollable no-footer data-testid="runflows-modal" @hidden="onHidden">
    <div v-if="loading" class="text-body-secondary small" data-testid="runflows-loading">{{ $t('runflows.loading') }}</div>
    <div v-else-if="error" class="alert alert-danger small py-2" data-testid="runflows-error">{{ error }}</div>
    <div v-else-if="!files.length" class="text-body-secondary small" data-testid="runflows-empty">{{ $t('runflows.empty') }}</div>
    <template v-else>
      <div class="d-flex align-items-center gap-2 mb-2 flex-wrap small">
        <button type="button" class="btn btn-sm btn-outline-light" data-testid="runflows-all" @click="setAll(true)">{{ $t('runflows.selectAll') }}</button>
        <button type="button" class="btn btn-sm btn-outline-light" data-testid="runflows-none" @click="setAll(false)">{{ $t('runflows.selectNone') }}</button>
        <span class="text-body-secondary" data-testid="runflows-count">{{ $t('runflows.selected', { n: picked.size, of: files.length }) }}</span>
      </div>
      <div v-for="g in groups" :key="g.group" class="mb-3" data-testid="runflows-group" :data-group="g.group">
        <label class="d-flex align-items-center gap-2 fw-semibold small mb-1">
          <input type="checkbox" class="form-check-input mt-0" :checked="g.files.every((f) => picked.has(f.path))" :indeterminate.prop="g.files.some((f) => picked.has(f.path)) && !g.files.every((f) => picked.has(f.path))" data-testid="runflows-group-toggle" @change="toggleGroup(g, $event.target.checked)" />
          <span class="font-monospace">{{ g.group || $t('runflows.top') }}</span>
          <span class="text-body-secondary fw-normal">{{ g.files.length }}</span>
        </label>
        <div v-for="f in g.files" :key="f.path" class="d-flex align-items-center gap-2 ms-4 small" data-testid="runflows-file" :data-path="f.path">
          <input :id="`rf-${f.path}`" type="checkbox" class="form-check-input mt-0" :checked="picked.has(f.path)" :disabled="running" @change="toggle(f.path, $event.target.checked)" />
          <label :for="`rf-${f.path}`" class="font-monospace flex-grow-1 mb-0 text-truncate" :title="f.path">{{ f.name }}</label>
          <span v-if="result(f.path)" class="badge" :class="badgeClass(result(f.path).state)" :title="result(f.path).error || ''" data-testid="runflows-result" :data-state="result(f.path).state">{{ $t(`runflows.state.${result(f.path).state}`) }}</span>
        </div>
        <div v-for="f in g.files.filter((x) => result(x.path)?.error)" :key="`e-${f.path}`" class="ms-5 small text-danger font-monospace" data-testid="runflows-error-line">{{ f.name }}: {{ result(f.path).error }}</div>
      </div>
      <div v-if="job?.error" class="alert alert-danger small py-2" data-testid="runflows-job-error">{{ job.error }}</div>
      <div v-if="job && job.state !== 'running'" class="small text-body-secondary" data-testid="runflows-summary">{{ $t('runflows.summary', { ok: job.ok, failed: job.failed, total: job.results.length }) }} · {{ $t('runflows.logged') }}</div>
    </template>
    <template v-if="!loading && !error && files.length">
      <hr />
      <div class="d-flex gap-2 justify-content-end">
        <BButton variant="outline-light" size="sm" data-testid="runflows-close" @click="open = false">{{ $t('pod.close') }}</BButton>
        <BButton v-if="running" variant="outline-danger" size="sm" data-testid="runflows-cancel" @click="cancel">{{ $t('runflows.cancel') }}</BButton>
        <BButton variant="primary" size="sm" :disabled="running || !picked.size" data-testid="runflows-run" @click="run"><i class="fa-solid fa-play me-1"></i>{{ $t('runflows.run', { n: picked.size }) }}</BButton>
      </div>
    </template>
  </BModal>
</template>

<script setup>
/**
 * Run workflows (ADR-037): a pod card's button opens this. It lists the graphs in the pod's Workflows panel grouped by folder (a shot or a round), all ticked, so the user picks which to run;
 * running converts each to an API graph, queues it on the pod, waits, and shows each one's result. Every error is also written to the History (see the core).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { runflowsAPI } from '../api/runflows'
import { errorText } from '../stores/toast'

const props = defineProps({ modelValue: { type: Boolean, default: false }, pod: { type: Object, required: true }, round: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const open = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })
const files = ref([]), picked = ref(new Set()), loading = ref(false), error = ref(''), job = ref(null)
const running = computed(() => job.value?.state === 'running')
let timer = null

const groups = computed(() => {
  const m = new Map()
  for (const f of files.value) { if (!m.has(f.group)) m.set(f.group, []); m.get(f.group).push(f) }
  return [...m.entries()].map(([group, fs]) => ({ group, files: fs }))
})
const result = (path) => job.value?.results.find((r) => r.path === path) || null
const badgeClass = (s) => ({ done: 'text-bg-success', failed: 'text-bg-danger', running: 'text-bg-primary', pending: 'text-bg-secondary', skipped: 'text-bg-warning' }[s] || 'text-bg-secondary')

async function load() {
  loading.value = true; error.value = ''; job.value = null
  try { files.value = (await runflowsAPI.list(props.pod.id)).workflows; picked.value = new Set(files.value.map((f) => f.path)); if (props.round) { const mine = files.value.filter((f) => `/${f.path}`.includes(`/${props.round}/`)); if (mine.length) picked.value = new Set(mine.map((f) => f.path)) } }   // every graph ticked, or every graph of the round it was opened from: "run all workflows in the shot"
  catch (e) { error.value = errorText(e); files.value = [] }
  finally { loading.value = false }
}
const toggle = (path, on) => { const s = new Set(picked.value); on ? s.add(path) : s.delete(path); picked.value = s }
const toggleGroup = (g, on) => { const s = new Set(picked.value); for (const f of g.files) on ? s.add(f.path) : s.delete(f.path); picked.value = s }
const setAll = (on) => { picked.value = on ? new Set(files.value.map((f) => f.path)) : new Set() }

async function run() {
  error.value = ''
  try { job.value = await runflowsAPI.run(props.pod.id, [...picked.value]); poll() } catch (e) { error.value = errorText(e) }
}
function poll() {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    try { job.value = await runflowsAPI.job(job.value.id) } catch (e) { error.value = errorText(e); return }
    if (job.value.state === 'running') poll()
  }, 1500)
}
async function cancel() { try { job.value = await runflowsAPI.cancel(job.value.id) } catch (e) { error.value = errorText(e) } }
function onHidden() { clearTimeout(timer); emit('update:modelValue', false) }
onMounted(load)   // the card mounts this only when the button is pressed
onBeforeUnmount(() => clearTimeout(timer))
</script>
