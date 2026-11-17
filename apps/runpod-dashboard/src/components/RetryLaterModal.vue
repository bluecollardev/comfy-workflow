<template>
  <BModal :model-value="modelValue" :title="$t('pod.rlTitle')" size="lg" scrollable lazy data-testid="retry-later-modal" @update:model-value="(v) => !v && close()">
    <p class="small mb-2" data-testid="retry-later-intro">{{ $t('pod.rlIntro', { name: pod.name, dc: pod.datacenter || '?' }) }}</p>
    <p class="small text-body-secondary mb-3" data-testid="retry-later-schedule">{{ $t('pod.rlSchedule', { n: watches.EVERY_MIN, h: watches.GIVE_UP_H }) }}</p>

    <div class="border rounded p-2 mb-2" :class="{ 'border-warning': choice === 'same' }">
      <label class="d-flex align-items-start gap-2">
        <input v-model="choice" type="radio" value="same" class="form-check-input mt-1" :disabled="busy" data-testid="retry-later-same" />
        <span><span class="fw-semibold" data-testid="retry-later-same-text">{{ $t('pod.rlSame', { gpu: pod.gpu }) }}</span>
          <span class="d-block small text-body-secondary">{{ $t('pod.rlSameHelp') }}</span></span>
      </label>
    </div>

    <div class="border rounded p-2 mb-2" :class="{ 'border-warning': choice === 'other' }">
      <label class="d-flex align-items-start gap-2">
        <input v-model="choice" type="radio" value="other" class="form-check-input mt-1" :disabled="busy" data-testid="retry-later-other" />
        <span><span class="fw-semibold" data-testid="retry-later-other-text">{{ $t('pod.rlOther', { dc: pod.datacenter || '?' }) }}</span>
          <span class="d-block small text-body-secondary" data-testid="retry-later-other-note">{{ $t('pod.rlOtherNote') }}</span>
          <span v-if="volume" class="d-block small text-body-secondary" data-testid="retry-later-volume">{{ $t('pod.rlVolume', { name: volume.name, dc: volume.datacenter }) }}</span></span>
      </label>
      <div v-if="choice === 'other'" class="mt-2 ms-4">
        <div v-if="loading" class="small text-body-secondary"><BSpinner small class="me-1" />{{ $t('pod.rlLoading') }}</div>
        <div v-else-if="!cards.length" class="small text-warning" data-testid="retry-later-none">{{ $t('pod.rlNone', { dc: pod.datacenter || '?' }) }}</div>
        <BFormSelect v-else v-model="gpu" :options="options" size="sm" :disabled="busy" data-testid="retry-later-gpu" />
      </div>
    </div>
    <BAlert v-if="error" :model-value="true" variant="danger" class="small py-2 mt-2 mb-0" data-testid="retry-later-error">{{ error }}</BAlert>

    <template #footer>
      <BButton size="sm" variant="outline-light" :disabled="busy" data-testid="retry-later-cancel" @click="close">{{ $t('podWatch.cancel') }}</BButton>
      <BButton size="sm" variant="warning" :disabled="!ready || busy" data-testid="retry-later-start" @click="start"><i class="fa-solid fa-hourglass-half me-1"></i>{{ $t('pod.rlStart') }}</BButton>
    </template>
  </BModal>
</template>

<script setup>
/** Retry Later's choice (ADR-042 section 19, 2026-11-17): before a watch starts, say WHAT it waits for. The same card: a resume watch on this pod. Another card in
 *  this pod's datacenter: a create watch for a NEW pod like this one. The old pod is never deleted by either; deleting stays a separate action on the card. */
import { computed, ref, watch } from 'vue'
import { podsAPI } from '../api/pods'
import { usePodWatchStore } from '../stores/podwatch'
import { t } from '../i18n'

const props = defineProps({ modelValue: { type: Boolean, default: false }, pod: { type: Object, required: true }, volume: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue'])
const watches = usePodWatchStore()
const choice = ref('same'), gpu = ref(''), loading = ref(false), busy = ref(false), error = ref(''), dcCards = ref([])

/** The cards this datacenter runs that the app can start (a card outside its table is listed by the core as `runs: false`): the free ones first, then by price. An out of stock card stays choosable, because the create watch retries until it is free. */
const cards = computed(() => dcCards.value.filter((c) => c.runs !== false).slice().sort((a, b) => Number(b.available !== false) - Number(a.available !== false) || (a.price ?? 9e9) - (b.price ?? 9e9)))
const options = computed(() => cards.value.map((c) => ({ value: c.key, text: [c.name, c.vram ? `${c.vram} GB` : '', c.price != null ? `$${c.price}${t('pod.perHour')}` : '', c.available === false ? t('pod.rlNoStock') : c.stock || ''].filter(Boolean).join(' · ') })))
const ready = computed(() => choice.value === 'same' || (choice.value === 'other' && !!gpu.value && !loading.value))

async function loadCards() {
  loading.value = true
  try { dcCards.value = ((await podsAPI.datacenters()).datacenters || []).find((d) => d.value === props.pod.datacenter)?.cards || [] } catch { dcCards.value = [] } finally { loading.value = false }
  if (!cards.value.some((c) => c.key === gpu.value)) gpu.value = cards.value[0]?.key || ''
}
watch(() => props.modelValue, (open) => { if (open) { choice.value = 'same'; gpu.value = ''; error.value = ''; loadCards() } }, { immediate: true })

function close() { emit('update:modelValue', false) }
async function start() {
  busy.value = true; error.value = ''
  const r = choice.value === 'same' ? await watches.retryResumeLater(props.pod.id) : await watches.retryLikeLater(props.pod.id, gpu.value, cards.value.find((c) => c.key === gpu.value)?.name || gpu.value, props.pod.datacenter)
  busy.value = false
  if (r.ok) close(); else error.value = r.text || ''
}
</script>
