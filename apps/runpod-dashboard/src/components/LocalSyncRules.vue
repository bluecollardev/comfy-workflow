<template>
  <CollapsibleSection id="sync-rules-local" :title="$t('storage.syncRules')" icon="fa-solid fa-gear" testid="local-sync-rules" :default-open="false" class="mt-2 mb-0">
    <template #badge><span class="badge text-bg-secondary fw-normal" data-testid="local-rules-summary">{{ summary }}</span></template>
    <div v-if="error" class="text-danger small mb-2" data-testid="local-rules-error">{{ error }}</div>
    <div class="row g-3">
      <div class="col-12 col-xl-6" data-testid="sync-pull">
        <div class="fw-semibold">{{ $t('volumes.pull') }}</div>
        <div class="form-text mt-0 mb-2" data-testid="sync-pull-help">{{ $t('volumes.localPullHelp') }}</div>
        <div v-if="!volumes.length" class="small text-body-secondary" data-testid="local-receives-none">{{ $t('volumes.none') }}</div>
        <div v-for="v in volumes" :key="v.id" class="border rounded p-2 mb-2" data-testid="local-receives" :data-id="v.id">
          <div class="fw-semibold small">{{ v.name || v.id }}</div>
          <div class="d-flex flex-wrap gap-3 small">
            <label v-for="ev in EVENTS" :key="ev" class="d-flex align-items-center gap-1 mb-0" :title="$t(`volumes.eventWhen.${ev}`)">
              <input type="checkbox" class="form-check-input mt-0" :checked="has(v.id, ev)" :disabled="busy" data-testid="local-event-tick" :data-event="ev" @change="tick(v.id, ev, $event.target)" />{{ $t(`storage.event.${ev}`) }}
            </label>
          </div>
          <div v-if="forms[v.id]" class="d-flex flex-wrap align-items-center gap-2 small mt-1" data-testid="local-onchange-pull">
            <input :id="`lp-${v.id}`" type="checkbox" class="form-check-input mt-0" :checked="forms[v.id].pull" data-testid="volume-autosync-pull" @change="setFlag(forms[v.id], 'pull', $event.target.checked)" />
            <label class="mb-0" :for="`lp-${v.id}`">{{ $t('volumes.onChangeFrom', { name: v.name || v.id }) }}</label>
            <span class="text-body-secondary">({{ $t('volumes.saveInPush') }})</span>
          </div>
        </div>
        <div v-for="s in storages" :key="s.id" class="border rounded p-2 mb-2" data-testid="local-pull-storage" :data-id="s.id">
          <div class="d-flex align-items-center gap-2">
            <div class="flex-grow-1 small overflow-hidden"><span class="fw-semibold">{{ s.name }}</span> <code v-if="s.bucket" class="text-body-secondary">{{ s.bucket }}</code></div>
            <BButton size="sm" variant="outline-light" class="text-nowrap" :disabled="!!storageReason(s)" data-testid="local-pull-now" @click="emit('pull', s)">{{ $t('volumes.pullNow') }}</BButton>
          </div>
          <div class="d-flex flex-wrap gap-3 small">
            <label v-for="ev in EVENTS" :key="ev" class="d-flex align-items-center gap-1 mb-0">
              <input type="checkbox" class="form-check-input mt-0" :checked="storageHas(s.id, ev)" :disabled="busy" data-testid="local-storage-tick" :data-event="ev" @change="tickStorage(s.id, ev, $event.target)" />{{ $t(`storage.event.${ev}`) }}
            </label>
          </div>
          <div class="small text-body-secondary">{{ storageReason(s) || $t('volumes.localPullStorageHelp') }}</div>
        </div>
      </div>
      <div class="col-12 col-xl-6" data-testid="sync-push">
        <div class="fw-semibold">{{ $t('volumes.push') }}</div>
        <div class="form-text mt-0 mb-2" data-testid="sync-push-help">{{ $t('volumes.localPushHelp') }}</div>
        <div class="fw-semibold small">{{ $t('volumes.onChange') }}</div>
        <div v-for="v in volumes" :key="v.id" class="border rounded p-2 mb-2" data-testid="local-sends" :data-id="v.id">
          <template v-if="forms[v.id]">
            <div class="d-flex align-items-center gap-2 small">
              <input :id="`lu-${v.id}`" type="checkbox" class="form-check-input mt-0" :checked="forms[v.id].push" data-testid="volume-autosync-push" @change="setFlag(forms[v.id], 'push', $event.target.checked)" />
              <label class="mb-0" :for="`lu-${v.id}`">{{ $t('volumes.onChangeTo', { name: v.name || v.id }) }}</label>
            </div>
            <div class="d-flex flex-wrap align-items-center gap-2 mt-1">
              <label class="mb-0 small" :for="`lp-by-${v.id}`">{{ $t('autosync.approvedBy') }}</label>
              <BFormInput :id="`lp-by-${v.id}`" v-model.trim="forms[v.id].approved_by" size="sm" style="max-width: 14rem" :placeholder="$t('autosync.approvedByPlaceholder')" data-testid="volume-autosync-approved-by" />
            </div>
            <div v-if="forms[v.id].error" class="text-danger small mt-1" data-testid="volume-autosync-error">{{ forms[v.id].error }}</div>
          </template>
        </div>
      </div>
    </div>
  </CollapsibleSection>
</template>

<script setup>
/**
 * LocalSyncRules: This PC's Configure Sync (docs/ADR-072). Pull: for each volume, which events bring its files down (This PC as a destination of the (volume, event) rule).
 * Each storage has Pull Now (the Sync window, from that bucket to this PC). Push: On Change to each volume (that volume's Auto Sync push flag). On Change from each volume is that volume's Auto Sync pull flag.
 */
import { computed, ref } from 'vue'
import CollapsibleSection from './CollapsibleSection.vue'
import { setFlag } from '../utils/volumeautosync'
import { syncrulesAPI, EVENTS } from '../api/syncrules'
import { errorText } from '../stores/toast'
import { t } from '../i18n'

const props = defineProps({ volumes: { type: Array, default: () => [] }, auto: { type: Object, default: () => ({}) }, /** volume id -> its Auto Sync form, owned by the window */ forms: { type: Object, default: () => ({}) }, rules: { type: Object, default: () => ({}) }, /** the S3 storages (Wasabi, your own): pulled from on demand */ storages: { type: Array, default: () => [] }, storageReason: { type: Function, default: () => '' } })
const emit = defineEmits(['changed', 'pull'])
const busy = ref(false), error = ref('')
// a volume with no list of its own for an event follows All Volumes: its first change starts from that list, so no storage is dropped
const effective = (vol, ev) => props.rules[vol]?.[ev] ?? props.rules['*']?.[ev] ?? []
const has = (vol, ev) => effective(vol, ev).some((d) => d.type === 'local')
async function tick(vol, ev, box) {
  const on = box.checked
  busy.value = true; error.value = ''
  const next = [...effective(vol, ev).filter((d) => d.type !== 'local'), ...(on ? [{ type: 'local' }] : [])]
  try { await syncrulesAPI.set(vol, ev, next) } catch (e) { box.checked = !on; error.value = errorText(e) } finally { busy.value = false; emit('changed') }
}
// a storage has only its own entry: the All Volumes rules are volumes'
const storageHas = (id, ev) => (props.rules[id]?.[ev] || []).some((d) => d.type === 'local')
async function tickStorage(id, ev, box) {
  const on = box.checked
  busy.value = true; error.value = ''
  try { await syncrulesAPI.set(id, ev, on ? [{ type: 'local' }] : []) } catch (e) { box.checked = !on; error.value = errorText(e) } finally { busy.value = false; emit('changed') }
}
const count = computed(() => props.volumes.reduce((n, v) => n + EVENTS.filter((ev) => has(v.id, ev)).length, 0) + props.storages.reduce((n, s) => n + EVENTS.filter((ev) => storageHas(s.id, ev)).length, 0))
const summary = computed(() => (count.value ? t('volumes.rulesRulesCount', { n: count.value }) : t('volumes.rulesNoneOn')))
</script>
