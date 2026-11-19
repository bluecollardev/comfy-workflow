<template>
  <div v-if="w" class="small" data-testid="autopublish-watching" :data-mode="mode">
    <div v-if="mode === 'off'" class="d-flex align-items-center gap-2 flex-wrap" data-testid="autopublish-watching-mode"><span>{{ $t('autopublish.watch.off') }}</span><BButton variant="link" size="sm" class="p-0" data-testid="autopublish-watching-settings" @click="openSettings">{{ $t('autopublish.watch.openSettings') }}</BButton></div>
    <div v-else class="d-flex align-items-center gap-2 flex-wrap" data-testid="autopublish-watching-mode">
      <span class="badge fw-normal" :class="mode === 'live' ? 'text-bg-success' : 'text-bg-warning'" data-testid="autopublish-watching-chip">{{ mode === 'live' ? $t('autopublish.watch.live', { targets: targetsText(status.targets), n: status.window_minutes }) : $t('autopublish.watch.dry') }}</span>
    </div>
    <template v-if="places">
      <div class="d-flex align-items-center gap-2 flex-wrap" data-testid="autopublish-watching-local" :data-enabled="w.local.enabled === false ? 'false' : 'true'">
        <span class="badge text-bg-secondary fw-normal" data-testid="autopublish-place-local">{{ $t('autopublish.sources.badgeLocal') }}</span>
        <span v-if="w.local.enabled === false" class="text-body-secondary">{{ $t('autopublish.watch.localOff', { root: rootLabel }) }}</span><span v-else>{{ $t('autopublish.watch.local', { root: rootLabel, n: w.local.reviews ?? 0 }) }}</span>
        <span v-if="rootMissing" class="text-warning" data-testid="autopublish-watching-root-missing">({{ $t('autopublish.watch.missing') }})</span>
      </div>
      <div class="d-flex align-items-center gap-2 flex-wrap" data-testid="autopublish-watching-volume" :data-enabled="w.volume.enabled === false ? 'false' : 'true'">
        <span class="badge text-bg-info fw-normal" data-testid="autopublish-place-volume">{{ $t('autopublish.sources.badgeVolume') }}</span>
        <span v-if="w.volume.enabled === false" class="text-body-secondary">{{ $t('autopublish.watch.volumeOff', { name: volumeName }) }}</span>
        <span v-else>{{ $t('autopublish.watch.volume', { name: volumeName, n: w.volume.reviews ?? 0 }) }}<template v-if="w.volume.scanned_at"> · {{ $t('autopublish.watch.scanned', { when: ago(w.volume.scanned_at) }) }}</template></span>
        <BSpinner v-if="scanning" small data-testid="autopublish-scanning" />
        <BButton size="sm" variant="outline-light" class="py-0" :disabled="scanning || w.volume.enabled === false" data-testid="autopublish-scan-now" @click="scan">{{ $t('autopublish.watch.scanNow') }}</BButton>
      </div>
      <div v-if="w.volume.error || scanError" class="text-danger" data-testid="autopublish-volume-error">{{ w.volume.error || scanError }}</div>
    </template>
    <div v-if="status.require_approval !== undefined" class="text-body-secondary" data-testid="autopublish-publishing-line">{{ $t(status.require_approval ? 'autopublish.pipe.statusApproved' : 'autopublish.pipe.statusAll') }}</div>
    <div v-if="w.summary" data-testid="autopublish-watching-summary">{{ w.summary }}</div>
    <div class="text-body-secondary" data-testid="autopublish-watching-counts">{{ placeLabel ? `${placeLabel}: ` : '' }}{{ countsLine }}</div>
    <div v-if="rootPath && !places" class="text-body-secondary text-break" data-testid="autopublish-watching-root-line">{{ $t('autopublish.watch.thisPcFolder') }} <span class="font-monospace" data-testid="autopublish-watching-root">{{ rootPath }}</span><span v-if="rootMissing" class="text-warning"> ({{ $t('autopublish.watch.missing') }})</span></div>
    <details v-if="skipped && (w.skipped || []).length" class="mt-1" data-testid="autopublish-skipped"><summary>{{ $t('autopublish.watch.skipped', { n: w.skipped.length }) }}</summary>
      <div v-for="(s, i) in w.skipped" :key="i" data-testid="autopublish-skipped-row">{{ s.shot }} {{ versionTag(s.version) }}: {{ s.reason }}<span v-if="triedText(s)" class="text-body-secondary" data-testid="autopublish-last-tried"> · {{ $t('autopublish.list.lastTried', { when: triedText(s) }) }}</span></div></details>
  </div>
</template>

<script setup>
/** AutoPublishWatching: what Auto-publish is looking at (the core's `watching`): the state line, the counts and the folder it watches, so an empty Queue still says why; the settings block adds the skipped list. Hidden on a core without `watching`. */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useAutopublishStore } from '../stores/autopublish'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import { useUiStore } from '../stores/ui'
import { targetsText, agoText, versionTag } from '../utils/autopublish'
import { whenText } from '../utils/when'

const props = defineProps({ status: { type: Object, default: null }, skipped: { type: Boolean, default: false } })
const ui = useUiStore(), ap = useAutopublishStore()
const w = computed(() => props.status?.watching || null)
/** Which place the counts belong to: both places say 'In total', one place names itself. */
const placeLabel = computed(() => (!places.value ? '' : w.value.local.enabled !== false && w.value.volume.enabled !== false ? t('autopublish.watch.inTotal') : w.value.volume.enabled === false ? t('autopublish.sources.badgeLocal') : t('autopublish.sources.badgeVolume')))
const volumeName = computed(() => w.value?.volume?.name || w.value?.volume?.id || '')
const rootLabel = computed(() => rootPath.value || '')
const countsLine = computed(() => {
  const x = w.value, base = { place: placeLabel.value, reviews: totalReviews.value, approved: x.approved ?? 0, queued: x.queued ?? 0, today: x.uploaded_today ?? 0 }
  return props.status?.require_approval === false ? t('autopublish.watch.countsEligible', { ...base, eligible: x.eligible ?? 0, held: x.held ?? 0 }) : t('autopublish.watch.counts', base)
})
const triedText = (s) => whenText(s.last_tried_at || s.at || s.tried_at)
const places = computed(() => (w.value?.local && typeof w.value.local === 'object' && w.value?.volume && typeof w.value.volume === 'object' ? w.value : null))   // a core with the two places; an older one has the single root
const totalReviews = computed(() => (places.value ? (w.value.local.reviews ?? 0) + (w.value.volume.reviews ?? 0) : w.value?.reviews ?? 0))
const rootPath = computed(() => (places.value ? w.value.local.root : w.value?.root) || '')
const rootMissing = computed(() => (places.value ? w.value.local.root_exists === false && w.value.local.enabled !== false : w.value?.root_exists === false))
const now = ref(Date.now())
const ago = (iso) => agoText(iso, t, now.value)
const scanning = computed(() => localScanning.value || !!w.value?.volume?.scanning)
const localScanning = ref(false), scanError = ref('')
async function scan() { scanError.value = ''; localScanning.value = true; try { await ap.scanVolume() } catch (e) { scanError.value = errorText(e) } finally { localScanning.value = false } }
const timer = setInterval(() => { now.value = Date.now() }, 30000)
onBeforeUnmount(() => clearInterval(timer))
const mode = computed(() => (!props.status?.enabled ? 'off' : props.status.dry_run ? 'dry' : 'live'))
const openSettings = () => { ui.queueOpen = false; ui.configFocus = 'publishing'; ui.configOpen = true }
</script>
