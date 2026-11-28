<template>
  <CollapsibleSection :id="`sync-rules-vol-${volume.id}`" :title="$t('storage.syncRules')" icon="fa-solid fa-gear" testid="volume-sync-rules" :default-open="false" class="mt-2 mb-0">
    <template #badge><span class="badge text-bg-secondary fw-normal" data-testid="volume-rules-summary">{{ summary }}</span></template>
    <div v-if="error" class="text-danger small mb-2" data-testid="volume-events-error">{{ error }}</div>
    <div class="row g-3">
      <div class="col-12 col-xl-6" data-testid="sync-pull">
        <div class="fw-semibold">{{ $t('volumes.pull') }}</div>
        <div class="form-text mt-0 mb-2" data-testid="sync-pull-help">{{ $t('volumes.pullHelp') }}</div>
        <div class="mb-3" data-testid="sync-pull-on_change">
          <div class="fw-semibold small">{{ $t('volumes.onChange') }}</div>
          <div class="form-text mt-0 mb-1">{{ $t('volumes.onChangePullHelp') }}</div>
          <div class="d-flex align-items-center gap-2 small py-1">
            <input :id="`oc-push-${volume.id}`" type="checkbox" class="form-check-input mt-0" :checked="form.push" @change="setFlag(form, 'push', $event.target.checked)" data-testid="volume-autosync-push" />
            <label class="mb-0" :for="`oc-push-${volume.id}`">{{ $t('volumes.localTitle') }} ({{ $t('volumes.localId') }})</label>
          </div>
        </div>
        <div v-for="ev in PULL" :key="ev" class="mb-3" :data-testid="`sync-pull-${ev}`">
          <div class="fw-semibold small">{{ $t(`volumes.pullEvent.${ev}`) }}</div>
          <div v-for="s in storages" :key="s.id" class="d-flex align-items-center gap-2 small py-1 text-body-secondary" data-testid="volume-pull-notbuilt" data-kind="storage" :data-id="s.id" :data-event="ev">
            <input type="checkbox" class="form-check-input mt-0" disabled /><span>{{ s.name }}</span><span class="badge text-bg-secondary fw-normal">{{ $t('syncTargets.notBuilt') }}</span>
          </div>
          <div class="d-flex align-items-center gap-2 small py-1 text-body-secondary" data-testid="volume-pull-notbuilt" data-kind="local" :data-event="ev">
            <input type="checkbox" class="form-check-input mt-0" disabled /><span>{{ $t('volumes.localTitle') }} ({{ $t('volumes.localId') }})</span><span class="badge text-bg-secondary fw-normal">{{ $t('syncTargets.notBuilt') }}</span>
          </div>
          <div v-for="v in otherVolumes" :key="v.id" class="d-flex align-items-center gap-2 small py-1 text-body-secondary" data-testid="volume-pull-notbuilt" data-kind="volume" :data-id="v.id" :data-event="ev">
            <input type="checkbox" class="form-check-input mt-0" disabled /><span>{{ $t('volumes.rulesSendsVolume', { name: v.name || v.id }) }}</span><span class="badge text-bg-secondary fw-normal">{{ $t('syncTargets.notBuilt') }}</span>
          </div>
        </div>
      </div>
      <div class="col-12 col-xl-6" data-testid="sync-push">
        <div class="fw-semibold">{{ $t('volumes.push') }}</div>
        <div class="form-text mt-0 mb-2" data-testid="sync-push-help">{{ $t('volumes.pushHelp') }}</div>
        <div v-for="ev in PUSH" :key="ev" class="mb-3" :data-testid="`sync-push-${ev}`">
          <div class="fw-semibold small">{{ $t(`storage.event.${ev}`) }}</div>
          <div class="form-text mt-0 mb-1" data-testid="volume-event-help">{{ $t(`volumes.eventWhen.${ev}`) }}</div>
          <div v-if="inherited(ev)" class="form-text text-warning mt-0" data-testid="volume-event-inherited">{{ $t('volumes.eventInherited') }}</div>
          <div v-for="s in storages" :key="s.id" class="d-flex align-items-center gap-2 small py-1" data-testid="volume-event-dest" :data-id="s.id" :data-event="ev">
            <input :id="`ve-${volume.id}-${ev}-${s.id}`" type="checkbox" class="form-check-input mt-0" :checked="has(ev, s.id)" :disabled="busy" data-testid="volume-event-tick" :data-event="ev" :data-id="s.id" @change="tick(ev, s.id, $event.target)" />
            <label class="mb-0" :for="`ve-${volume.id}-${ev}-${s.id}`">{{ s.name }}</label>
            <code v-if="s.bucket" class="small text-body-secondary" data-testid="volume-event-bucket">{{ s.bucket }}</code>
            <BBadge v-if="s.default" variant="primary" class="fw-normal" data-testid="volume-event-default">{{ $t('storage.defaultBadge') }}</BBadge>
          </div>
          <div class="d-flex align-items-center gap-2 small py-1" data-testid="volume-event-local" :data-event="ev">
            <input :id="`ve-${volume.id}-${ev}-local`" type="checkbox" class="form-check-input mt-0" :checked="hasLocal(ev)" :disabled="busy" data-testid="volume-event-local-tick" :data-event="ev" @change="tickLocal(ev, $event.target)" />
            <label class="mb-0" :for="`ve-${volume.id}-${ev}-local`">{{ $t('volumes.localTitle') }} ({{ $t('volumes.localId') }})</label>
          </div>
          <div v-for="v in otherVolumes" :key="v.id" class="d-flex align-items-center gap-2 small py-1 text-body-secondary" data-testid="volume-event-notbuilt" data-kind="volume" :data-id="v.id" :data-event="ev">
            <input type="checkbox" class="form-check-input mt-0" disabled /><span>{{ $t('volumes.rulesSendsVolume', { name: v.name || v.id }) }}</span><span class="badge text-bg-secondary fw-normal">{{ $t('syncTargets.notBuilt') }}</span>
          </div>
        </div>
        <div class="mb-2" data-testid="sync-push-on_change">
          <div class="fw-semibold small">{{ $t('volumes.onChange') }}</div>
          <div class="form-text mt-0 mb-1">{{ $t('volumes.onChangePushHelp') }}</div>
          <div class="d-flex align-items-center gap-2 small py-1">
            <input :id="`oc-pull-${volume.id}`" type="checkbox" class="form-check-input mt-0" :checked="form.pull" @change="setFlag(form, 'pull', $event.target.checked)" data-testid="volume-autosync-pull" />
            <label class="mb-0" :for="`oc-pull-${volume.id}`">{{ $t('volumes.localTitle') }} ({{ $t('volumes.localId') }})</label>
          </div>
        </div>
      </div>
    </div>
    <div class="border-top pt-2 mt-1" data-testid="volume-autosync-block">
      <div class="form-text mb-1" data-testid="volume-autosync-help">{{ $t('volumes.rulesAutoHelp') }} {{ $t('autosync.help') }}</div>
      <div class="d-flex flex-wrap align-items-center gap-2">
        <label class="mb-0 small" :for="`va-by-${volume.id}`">{{ $t('autosync.approvedBy') }}</label>
        <BFormInput :id="`va-by-${volume.id}`" v-model.trim="form.approved_by" size="sm" style="max-width: 16rem" :placeholder="$t('autosync.approvedByPlaceholder')" data-testid="volume-autosync-approved-by" />
      </div>
      <div v-if="form.error" class="text-danger small mt-1" data-testid="volume-autosync-error">{{ form.error }}</div>
      <div v-if="newest" class="small text-body-secondary mt-1" data-testid="volume-autosync-status" :data-state="newest.state">{{ $t('volumes.rulesAutoLast', { state: newest.state }) }}<template v-if="newest.error || newest.summary"> · {{ newest.error || newest.summary }}</template></div>
    </div>
    <div class="mt-2" data-testid="volume-rules-planned">
    </div>
  </CollapsibleSection>
</template>

<script setup>
/**
 * VolumeSyncRules: a RunPod volume's Configure Sync in two blocks (docs/ADR-069 amendment). Push (leaves this volume): Generated, Approved, Published -> storages (syncrules, built), and On Change -> This PC
 * (Auto Sync's pull flag). Pull (arrives at this volume): On Change from This PC (Auto Sync's push flag); Generated, Approved, Pod Started from storages, volumes, This PC: not built, disabled.
 */
import { computed, onMounted, ref } from 'vue'
import CollapsibleSection from './CollapsibleSection.vue'
import { syncrulesAPI } from '../api/syncrules'
import { autosyncAPI } from '../api/autosync'
import { setFlag } from '../utils/volumeautosync'
import { errorText } from '../stores/toast'
import { t } from '../i18n'

const props = defineProps({ volume: { type: Object, required: true }, volumes: { type: Array, default: () => [] }, storages: { type: Array, default: () => [] }, settings: { type: Object, default: null }, /** this volume's Auto Sync form, owned by the window (its one Save writes it) */ form: { type: Object, required: true }, rules: { type: Object, default: () => ({}) } })
const emit = defineEmits(['changed'])
const PUSH = ['generated', 'approved', 'published'], PULL = ['generated', 'approved', 'pod_started']
const busy = ref(false), error = ref(''), newest = ref(null)
const own = computed(() => props.rules[props.volume.id] || null)
const list = (ev) => (own.value?.[ev] || []).filter((d) => d.type === 'storage')
// This PC (docs/ADR-072). A volume's first rule for an event starts from the All Volumes list it was following, so ticking This PC never drops a storage.
const effective = (ev) => own.value?.[ev] ?? props.rules['*']?.[ev] ?? []
const hasLocal = (ev) => effective(ev).some((d) => d.type === 'local')
async function tickLocal(ev, box) {
  const on = box.checked
  busy.value = true; error.value = ''
  const next = [...effective(ev).filter((d) => d.type !== 'local'), ...(on ? [{ type: 'local' }] : [])]
  try { await syncrulesAPI.set(props.volume.id, ev, next); emit('changed') } catch (e) { box.checked = !on; error.value = errorText(e); emit('changed') } finally { busy.value = false }
}
const has = (ev, id) => list(ev).some((d) => d.id === id)
// no rule of its own for an event: the All Volumes rules (volume '*') apply, said once
const inherited = (ev) => !(own.value?.[ev] || []).length && (props.rules['*']?.[ev] || []).length > 0
const otherVolumes = computed(() => props.volumes.filter((v) => v.id !== props.volume.id))
const count = computed(() => PUSH.reduce((n, ev) => n + list(ev).length + (hasLocal(ev) ? 1 : 0), 0))
const summary = computed(() => `${t(props.settings?.enabled ? 'volumes.rulesAutoOn' : 'volumes.rulesAutoOff')}${newest.value ? ` (${newest.value.state})` : ''} · ${t('volumes.rulesRulesCount', { n: count.value })}`)
async function tick(ev, id, box) {
  const on = box.checked
  busy.value = true; error.value = ''
  const next = [...list(ev).filter((d) => d.id !== id), ...(on ? [{ type: 'storage', id }] : []), ...effective(ev).filter((d) => d.type === 'local')]
  try { await syncrulesAPI.set(props.volume.id, ev, next); emit('changed') } catch (e) { box.checked = !on; error.value = errorText(e); emit('changed') } finally { busy.value = false }
}
onMounted(async () => { try { const r = await autosyncAPI.volumeStatus(props.volume.id); newest.value = r.items[r.items.length - 1] || null } catch { /* a hint only */ } })
</script>
