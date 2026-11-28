<template>
  <div class="border rounded p-2 mb-3" data-testid="sync-route">
    <BAlert v-if="loadError" :model-value="true" variant="warning" class="small py-2" data-testid="sync-route-error"><i class="fa-solid fa-triangle-exclamation me-2"></i>{{ loadError }}</BAlert>
    <div class="mb-2">
      <label class="form-label small fw-semibold mb-1" for="sync-from">{{ $t('syncTargets.from') }}</label>
      <select id="sync-from" class="form-select form-select-sm" :value="fromKey" :disabled="locked" data-testid="sync-from" @change="pickFrom($event.target.value)">
        <option v-if="volumeId" value="pod" :disabled="!pods.length" data-testid="sync-from-option" data-kind="pod">{{ $t('syncTargets.fromPod') }}</option>
        <option v-if="volumeId" :value="`volume:${volumeId}`" data-testid="sync-from-option" data-kind="volume" :data-id="volumeId">{{ $t('syncTargets.fromVolumeS3') }}</option>
        <optgroup v-if="otherVolumes.length" :label="$t('syncTargets.volumes')">
          <option v-for="v in otherVolumes" :key="v.id" :value="`volume:${v.id}`" data-testid="sync-from-option" data-kind="volume" :data-id="v.id">{{ volumeText(v) }}</option>
        </optgroup>
        <optgroup v-if="fromStorages.length" :label="$t('syncTargets.storages')">
          <option v-for="s in fromStorages" :key="s.id" :value="`storage:${s.id}`" data-testid="sync-from-option" data-kind="storage" :data-id="s.id">{{ s.kind === 'panama' ? $t('syncTargets.bhBucket') : s.name }}{{ s.default ? ` (${$t('storage.defaultBadge')})` : '' }}</option>
        </optgroup>
      </select>
      <div v-if="volumeId && !pods.length" class="form-text" data-testid="sync-from-pod-reason">{{ $t('syncTargets.noPodRunning') }}. {{ $t('syncTargets.pushNeedsPod') }}</div>
      <div v-if="from.type === 'pod' && pods.length" class="d-flex align-items-center gap-2 mt-2">
        <label class="small mb-0" for="sync-from-pod">{{ $t('syncTargets.podPick') }}</label>
        <select id="sync-from-pod" class="form-select form-select-sm" style="max-width: 18rem" :value="from.id" :disabled="locked" data-testid="sync-from-pod" @change="emit('update:from', { type: 'pod', id: $event.target.value })">
          <option v-for="p in pods" :key="p.id" :value="p.id" data-testid="sync-from-pod-option">{{ p.name }}</option>
        </select>
      </div>
    </div>
    <div class="small fw-semibold mb-1">{{ $t('syncTargets.to') }}</div>
    <div data-testid="sync-to">
      <div class="form-check" data-testid="sync-to-item" data-kind="pc">
        <input id="sync-to-pc" type="checkbox" class="form-check-input" :checked="to.pc" :disabled="locked" data-testid="sync-to-check" @change="setPc($event.target.checked)" />
        <label class="form-check-label" for="sync-to-pc">{{ $t('syncTargets.toPc') }}</label>
      </div>
      <div v-if="toStorages.length" class="small text-body-secondary mt-2" data-testid="sync-to-storages-title">{{ $t('syncTargets.storages') }}</div>
      <div v-for="s in toStorages" :key="`s-${s.id}`" class="form-check d-flex align-items-center gap-2" data-testid="sync-to-item" data-kind="storage" :data-id="s.id" :data-disabled="reason('storage', s.id) ? 'true' : undefined">
        <input :id="`sync-to-s-${s.id}`" type="checkbox" class="form-check-input mt-0" :checked="to.storages.includes(s.id)" :disabled="locked || !!reason('storage', s.id)" data-testid="sync-to-check" @change="toggle('storages', s.id, $event.target.checked)" />
        <label class="form-check-label" :for="`sync-to-s-${s.id}`">{{ s.name }}</label>
        <BBadge v-if="s.default" variant="primary" class="fw-normal" data-testid="sync-to-default">{{ $t('storage.defaultBadge') }}</BBadge>
        <span v-if="reason('storage', s.id)" class="small text-body-secondary" data-testid="sync-to-reason">{{ reason('storage', s.id) }}</span>
      </div>
      <div v-if="from.type === 'storage' && from.id === BH" class="form-text" data-testid="sync-to-bh-note"><i class="fa-solid fa-lock me-1"></i>{{ $t('syncTargets.bhNote') }}</div>
      <div v-if="from.type === 'storage' && from.id === BH" class="form-check d-flex align-items-center gap-2" data-testid="sync-to-item" data-kind="bh" data-disabled="true">
        <input type="checkbox" class="form-check-input mt-0" disabled data-testid="sync-to-check" />
        <label class="form-check-label text-body-secondary">{{ $t('syncTargets.bhPublishOnly') }}</label>
      </div>
      <div v-if="volumes.length" class="small text-body-secondary mt-2" data-testid="sync-to-volumes-title">{{ $t('syncTargets.volumes') }}</div>
      <div v-for="v in volumes" :key="`v-${v.id}`" class="form-check d-flex align-items-center gap-2" data-testid="sync-to-item" data-kind="volume" :data-id="v.id" :data-disabled="reason('volume', v.id) ? 'true' : undefined">
        <input :id="`sync-to-v-${v.id}`" type="checkbox" class="form-check-input mt-0" :checked="to.volumes.includes(v.id)" :disabled="locked || !!reason('volume', v.id)" data-testid="sync-to-check" @change="toggle('volumes', v.id, $event.target.checked)" />
        <label class="form-check-label" :for="`sync-to-v-${v.id}`">{{ volumeText(v) }}</label>
        <span v-if="reason('volume', v.id)" class="small text-body-secondary" data-testid="sync-to-reason">{{ reason('volume', v.id) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * SyncRoute: the top of the Sync window (docs/ADR-067). One From (a pod on the volume, the volume over S3, another volume, a storage) and the To tick boxes (this PC, storages, volumes).
 * Pairs that are not built are listed disabled with "Not built yet"; the source itself can never be its own target. The default storage is first everywhere.
 */
import { computed, onMounted, ref } from 'vue'
import { storageAPI } from '../api/storage'
import { errorText } from '../stores/toast'
import { t } from '../i18n'

const props = defineProps({ from: { type: Object, required: true }, to: { type: Object, required: true }, locked: Boolean, volumeId: { type: String, default: '' }, volumes: { type: Array, default: () => [] }, pods: { type: Array, default: () => [] }, carryPods: { type: Array, default: () => [] } })
const emit = defineEmits(['update:from', 'update:to', 'loaded'])
const storages = ref([]), loadError = ref('')
const BH = 'panama-s3'   // the BH exchange bucket: a source only (docs/ADR-067 amendment)
const otherVolumes = computed(() => props.volumes.filter((v) => v.id !== props.volumeId))
const fromKey = computed(() => (props.from.type === 'pod' ? 'pod' : `${props.from.type}:${props.from.id}`))
// the built pairs (phase 1): a pod to a storage, a pod, a volume or a storage to this PC
const toStorages = computed(() => storages.value.filter((s) => s.kind !== 'publish' && s.kind !== 'panama'))   // the publish destination and the Panama exchange are never a target
// From: the ready storages (the default first) and the BH exchange bucket last, when it is on
const fromStorages = computed(() => [...storages.value.filter((s) => s.kind !== 'panama'), ...storages.value.filter((s) => s.kind === 'panama' && s.enabled !== false)])
const volumeText = (v) => t('syncTargets.volumeFacts', { name: v.name || v.id, size: v.size_gb ?? '?', dc: v.datacenter || '?' })
function reason(kind, id) {
  const f = props.from
  if (kind === 'storage') return f.type === 'storage' && f.id === id ? t('syncTargets.sameSource') : f.type === 'pod' || props.carryPods.length ? '' : t('syncTargets.needsPod')   // bucket to bucket needs a running pod to carry it
  return (f.type === 'volume' && f.id === id) || (f.type === 'pod' && id === props.volumeId) ? t('syncTargets.sameSource') : t('syncTargets.notBuilt')
}
const keep = (to, from) => ({ pc: to.pc, storages: to.storages.filter((id) => !(from.type === 'storage' && from.id === id) && (from.type === 'pod' || props.carryPods.length)), volumes: [] })
function pickFrom(v) {
  const from = v === 'pod' ? { type: 'pod', id: props.pods[0]?.id || '' } : { type: v.slice(0, v.indexOf(':')), id: v.slice(v.indexOf(':') + 1) }
  emit('update:from', from); emit('update:to', keep(props.to, from))
}
const setPc = (on) => emit('update:to', { ...props.to, pc: on })
const toggle = (k, id, on) => emit('update:to', { ...props.to, [k]: on ? [...props.to[k].filter((x) => x !== id), id] : props.to[k].filter((x) => x !== id) })

onMounted(async () => {
  try {
    // the default storage first (Lucas: "this bucket should be default bucket"), then the list's own order; only storages that are ready
    const r = await storageAPI.list()
    storages.value = r.adapters.filter((a) => a.ready && !a.problem).map((a, i) => ({ a, i })).sort((x, y) => (y.a.default ? 1 : 0) - (x.a.default ? 1 : 0) || x.i - y.i).map((x) => x.a)
  } catch (e) { loadError.value = errorText(e) }
  emit('loaded', { storages: storages.value })
})
</script>
