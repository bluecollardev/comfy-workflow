<template>
  <CollapsibleSection ref="section" id="bh-publishing" :title="$t('publish.tab')" icon="fa-solid fa-paper-plane" testid="bh-publishing" :default-open="false" class="mt-2 mb-0">
    <template v-if="render">
      <div class="border rounded p-2 mb-3" data-testid="config-delivery">
        <div class="fw-semibold mb-1">{{ $t('config.delivery.title') }}</div>
        <div class="form-text mb-2" data-testid="config-delivery-help">{{ $t('config.delivery.help') }}</div>
        <div class="row g-2 small">
          <label class="col-sm-6">{{ $t('config.delivery.outDir') }}<input v-model="delivery.out_dir" type="text" class="form-control form-control-sm font-monospace" autocomplete="off" data-testid="config-delivery-out-dir" /></label>
          <label class="col-sm-3">{{ $t('config.delivery.colourCode') }}<select v-model="delivery.colour_code" class="form-select form-select-sm" data-testid="config-delivery-colour-code"><option v-for="c in COLOUR_CODES" :key="c" :value="c">{{ $t(`config.delivery.colour_${c}`) }}</option></select></label>
          <label class="col-sm-3">{{ $t('config.delivery.gamma') }}<input v-model.number="delivery.gamma" type="number" min="0.1" max="10" step="0.1" class="form-control form-control-sm" data-testid="config-delivery-gamma" /></label>
          <label class="col-sm-3">{{ $t('config.delivery.fpsSource') }}<select v-model="delivery.fps_source" class="form-select form-select-sm" data-testid="config-delivery-fps-source"><option v-for="c in FPS_SOURCES" :key="c" :value="c">{{ $t(`config.delivery.fps_${c}`) }}</option></select></label>
          <label class="col-sm-3">{{ $t('config.delivery.fps') }}<input v-model.number="delivery.fps" type="number" min="1" max="120" step="0.001" class="form-control form-control-sm" data-testid="config-delivery-fps" /></label>
          <label class="col-sm-3">{{ $t('config.delivery.tcSource') }}<select v-model="delivery.timecode_source" class="form-select form-select-sm" data-testid="config-delivery-tc-source"><option v-for="c in TC_SOURCES" :key="c" :value="c">{{ $t(`config.delivery.tc_${c}`) }}</option></select></label>
          <label class="col-sm-3">{{ $t('config.delivery.framePosition') }}<select v-model="delivery.frame_position" class="form-select form-select-sm" data-testid="config-delivery-frame-position"><option v-for="c in FRAME_POSITIONS" :key="c" :value="c">{{ $t(`config.delivery.pos_${c}`) }}</option></select></label>
        </div>
        <label class="small mt-2"><input v-model="delivery.skip_existing" type="checkbox" class="form-check-input me-1" data-testid="config-delivery-skip-existing" />{{ $t('config.delivery.skipExisting') }}</label>
      </div>
      <RenderFields :render="render" :error="renderError" />
    </template>
    <BhAutoPublish />
    <PublishSettings ref="pubRef" part="rest" :render="render || undefined" />
    <EdlStatus />
    <div v-if="error" class="text-danger small mt-1" data-testid="bh-publishing-error">{{ error }}</div>
  </CollapsibleSection>
</template>

<script setup>
/**
 * BhPublishing: everything about publishing, on the BH exchange bucket's row in Network Volumes (it was Default Configuration > Publishing): Auto-publish (with what it is watching), the publish
 * defaults, Prepare For Delivery, Render sequences and the EDL. The window's one Save writes the publish settings and the configuration's `render` and `delivery_prepare`.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import CollapsibleSection from './CollapsibleSection.vue'
import PublishSettings from './PublishSettings.vue'
import BhAutoPublish from './BhAutoPublish.vue'
import RenderFields from './RenderFields.vue'
import EdlStatus from './EdlStatus.vue'
import { mountsAPI } from '../api/mounts'
import { useMountsStore } from '../stores/mounts'
import { useAutopublishStore } from '../stores/autopublish'
import { useUiStore } from '../stores/ui'
import { errorText } from '../stores/toast'
import { RENDER_DEFAULTS, renderProblem, renderIsDefault, renderBody, renderPublishProblem } from '../utils/renders'
import { COLOUR_CODES, FPS_SOURCES, TC_SOURCES, FRAME_POSITIONS, deliveryFill, deliveryIsDefault, deliveryBody } from '../utils/deliveryprepare'
import { t } from '../i18n'
import { useWindowSave } from '../utils/windowsave'

const ui = useUiStore(), apStore = useAutopublishStore(), mounts = useMountsStore()
const section = ref(null), pubRef = ref(null)
const render = ref(null), delivery = ref(null)
const error = ref(''), renderError = ref('')
let snapshot = '', renderStored = false, renderKeys = [], deliveryStored = false

const current = () => JSON.stringify([render.value, delivery.value])
const configDirty = computed(() => !!render.value && current() !== snapshot)
const dirty = computed(() => configDirty.value || !!pubRef.value?.dirty)

function fill(config) {
  renderStored = !!config.render   // an untouched render object is not added to what is saved
  renderKeys = Object.keys(config.render || {})
  const r = config.render || {}, p = r.publish ?? RENDER_DEFAULTS.publish
  render.value = { ...RENDER_DEFAULTS, ...r, codecs: [...(r.codecs || RENDER_DEFAULTS.codecs)], publish: { s3: !!p.s3, slack: !!p.slack } }
  deliveryStored = config.delivery_prepare !== undefined
  delivery.value = deliveryFill(config.delivery_prepare)
  snapshot = current()
}
async function load() {
  try { const p = await mountsAPI.get(); if (p?.config) fill(p.config) } catch (e) { error.value = errorText(e) }
}

async function save() {
  error.value = ''; renderError.value = ''
  const p = renderProblem(render.value), q = renderPublishProblem(render.value)
  if (p || q === 'slackNeedsS3') { renderError.value = p ? t('outputs.render.cfg.needCodec') : t('autopublish.block.slackNeedsS3'); return false }
  if (pubRef.value?.validate()) return false
  try {
    if (configDirty.value) {
      const cur = (await mountsAPI.get())?.config || {}   // never a partial put: the full loaded configuration with only these two changed
      await mountsAPI.save({ ...cur,
        ...(renderStored || !renderIsDefault(render.value) ? { render: renderBody(render.value, renderKeys) } : {}),
        ...(deliveryStored || !deliveryIsDefault(delivery.value) ? { delivery_prepare: deliveryBody(delivery.value) } : {}) })
    }
    if (pubRef.value?.dirty) { const r = await pubRef.value.save(); if (!r.ok) { error.value = r.error; return false } }
    await load(); mounts.load(); return true
  } catch (e) { error.value = errorText(e); return false }
}

/** A link to the publish settings (the Queue, the Publish window, Render sequences): open this section and bring it into view. */
async function focus() {
  if (!ui.publishingFocus) return
  ui.publishingFocus = false
  section.value?.show()
  await nextTick()
  section.value?.$el?.scrollIntoView({ block: 'start' })
}
watch(() => ui.publishingFocus, focus)
useWindowSave(() => dirty.value, save)
onMounted(async () => { apStore.refresh?.(); await load(); focus() })
</script>
