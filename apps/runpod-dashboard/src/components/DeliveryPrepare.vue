<template>
  <BModal :model-value="true" :title="$t('delivery.title')" size="xl" scrollable lazy no-footer data-testid="delivery-modal" @update:model-value="(v) => !v && $emit('close')">
    <p class="small text-body-secondary">{{ $t('delivery.intro') }}</p>
    <div v-if="planning" class="small d-flex align-items-center gap-2" data-testid="delivery-planning"><BSpinner small />{{ $t('delivery.planning') }}</div>
    <div v-else-if="error" class="alert alert-danger small py-2" data-testid="delivery-error">{{ error }}</div>
    <div v-else-if="!rows.length" class="text-body-secondary small" data-testid="delivery-none">{{ $t('delivery.none') }}</div>
    <table v-else class="table table-sm align-middle small" data-testid="delivery-table">
      <thead><tr><th></th><th>{{ $t('delivery.clip') }}</th><th>{{ $t('delivery.frames') }}</th><th>{{ $t('delivery.timecode') }}</th><th>{{ $t('delivery.fps') }}</th><th>{{ $t('delivery.state') }}</th></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r.dir" data-testid="delivery-row" :data-state="r.state">
          <td><input v-model="r.on" type="checkbox" class="form-check-input" :disabled="!r.clip || running" data-testid="delivery-pick" /></td>
          <td class="font-monospace text-break">{{ r.clip || r.name }}<div v-if="!r.clip" class="text-warning" data-testid="delivery-not-in-edl">{{ r.why || $t('delivery.notInEdl') }}</div></td>
          <td>{{ r.frames }}<span v-if="r.expected != null && r.expected !== r.frames" class="text-danger"> / {{ r.expected }}</span></td>
          <td class="font-monospace">{{ r.tc }}</td>
          <td><select v-model="r.fps" class="form-select form-select-sm w-auto" :disabled="!r.clip || running" data-testid="delivery-fps"><option v-for="f in FPS" :key="f" :value="f">{{ f }}</option></select></td>
          <td data-testid="delivery-state"><BSpinner v-if="r.state === 'running'" small /><span v-else :class="r.state === 'ok' ? 'text-success' : r.state === 'failed' ? 'text-danger' : 'text-body-secondary'">{{ $t(`delivery.state_${r.state}`) }}</span><div v-if="r.error" class="text-danger">{{ r.error }}</div></td>
        </tr>
      </tbody>
    </table>
    <div v-if="rows.length" class="d-flex align-items-end gap-3 flex-wrap">
      <label class="small mb-0">{{ $t('outputs.render.approvedBy') }}
        <input v-model="approvedBy" type="text" class="form-control form-control-sm" :placeholder="$t('outputs.render.approvedPlaceholder')" data-testid="delivery-approved-by" autocomplete="off" />
      </label>
      <BButton variant="primary" size="sm" :disabled="!canRun" data-testid="delivery-run" @click="run"><BSpinner v-if="running" small class="me-1" />{{ $t('delivery.run', { n: picked.length }) }}</BButton>
      <span v-if="pod.status !== 'running'" class="small text-warning" data-testid="delivery-pod-off">{{ $t('delivery.podOff') }}</span>
      <BButton v-if="done" variant="outline-light" size="sm" class="ms-auto" data-testid="delivery-open-publish" @click="$emit('publish')"><i class="fa-solid fa-cloud-arrow-up me-1"></i>{{ $t('delivery.openPublish') }}</BButton>
    </div>
    <div v-if="done" class="small text-body-secondary mt-2" data-testid="delivery-where">{{ $t('delivery.where', { dir: outRoot }) }}</div>
  </BModal>
</template>

<script setup>
/**
 * Prepare For Delivery (ADR-055): the DPX sequences of the Outputs window, each with the clip name and start timecode the EDL gives it, written as corrected COPIES on the pod
 * (colour code user-defined instead of linear, the timecode, the frame rate, gamma 2.6) under output/_delivery_v11/<clip>/; the originals are never touched. Then the Publish window sends them.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { publishAPI } from '../api/publish'
import { dpxfixAPI } from '../api/dpxfix'
import { errorText } from '../stores/toast'

const FPS = [23.976, 24, 25, 30]
const props = defineProps({ items: { type: Array, default: () => [] }, pod: { type: Object, required: true } })
defineEmits(['close', 'publish'])
const KEY = 'pod-manager:approved_by'
const approvedBy = ref((() => { try { return localStorage.getItem(KEY) || localStorage.getItem('pod-manager.render.approved') || '' } catch { return '' } })())
const rows = reactive([]), planning = ref(true), error = ref(''), running = ref(false), done = ref(false), outRoot = ref('')
const picked = computed(() => rows.filter((r) => r.on && r.clip))
const canRun = computed(() => picked.value.length > 0 && approvedBy.value.trim() && !running.value && props.pod.status === 'running')
const fpsOf = (clip) => (/_24_/.test(clip) ? 24 : 23.976)

onMounted(async () => {
  try {
    const p = await publishAPI.plan({ items: props.items.map((i) => ({ where: 'volume', path: i.dir, stem: i.name })), targets: ['s3'], round: '_TEST_prepare' })
    const by = new Map(p.sequences.map((s) => [s.stem, s]))
    for (const i of props.items) {
      const s = by.get(i.name), clip = s?.edl_element?.clip || ''
      rows.push({ dir: i.dir, name: i.name, clip, frames: s?.frames ?? i.frames, expected: s?.expected_frames ?? null, tc: s?.start_timecode || '00:00:00:00', fps: clip ? fpsOf(clip) : 23.976, on: !!clip && !s?.blocked, state: 'idle', why: s?.reason || (s?.blocked ? 'held by the EDL check' : ''), error: '' })
    }
  } catch (e) { error.value = errorText(e) } finally { planning.value = false }
})
async function run() {
  try { localStorage.setItem(KEY, approvedBy.value.trim()) } catch { /* storage blocked: it lasts this window */ }
  running.value = true; done.value = false; error.value = ''
  for (const r of picked.value) { r.state = 'running'; r.error = '' }
  try {
    const out = await dpxfixAPI.run({ pod_id: props.pod.id, approved_by: approvedBy.value.trim(), items: picked.value.map((r) => ({ src_dir: r.dir, clip: r.clip, start_timecode: r.tc, fps: Number(r.fps) })) })
    outRoot.value = out.out_root
    for (const r of picked.value) { const x = out.results.find((y) => y.clip === r.clip); r.state = x?.ok ? 'ok' : 'failed'; r.error = x && !x.ok ? x.error || '' : '' }
    done.value = picked.value.some((r) => r.state === 'ok')
  } catch (e) { error.value = errorText(e); for (const r of picked.value) r.state = 'failed' } finally { running.value = false }
}
</script>
