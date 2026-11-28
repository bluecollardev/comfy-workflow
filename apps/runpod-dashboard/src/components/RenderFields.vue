<template>
  <div class="border rounded p-2 mb-3" data-testid="config-render">
    <div class="fw-semibold mb-1">{{ $t('outputs.render.cfg.title') }}</div>
    <div class="d-flex gap-3 flex-wrap align-items-end small mb-2">
      <label class="mb-0">{{ $t('outputs.render.cfg.where') }}
        <select v-model="render.where" class="form-select form-select-sm" data-testid="config-render-where"><option value="auto">{{ $t('outputs.render.cfg.whereAuto') }}</option><option value="pod">{{ $t('outputs.render.cfg.wherePod') }}</option><option value="local">{{ $t('outputs.render.cfg.whereLocal') }}</option></select>
      </label>
      <div role="radiogroup" data-testid="config-render-kind"><div>{{ $t('outputs.render.cfg.kind') }}</div>
        <label class="me-3"><input v-model="render.kind" type="radio" value="proxy" class="form-check-input me-1" data-testid="config-render-kind-proxy" />{{ $t('outputs.render.cfg.kindProxy') }}</label>
        <label><input v-model="render.kind" type="radio" value="review" class="form-check-input me-1" data-testid="config-render-kind-review" />{{ $t('outputs.render.cfg.kindReview') }}</label>
      </div>
      <label class="mb-0" :title="$t('outputs.render.cfg.colourHelp')">{{ $t('outputs.render.cfg.colour') }}
        <select v-model="renderColour" class="form-select form-select-sm" data-testid="config-render-colour"><option value="">{{ $t('outputs.render.cfg.colourDefault') }}</option><option v-for="c in RENDER_COLOURS" :key="c" :value="c">{{ $t(`edl.colours.${c}`) }}</option></select>
      </label>
      <label class="mb-0">{{ $t('outputs.render.cfg.proxyWidth') }}
        <select v-model="render.proxy_width" class="form-select form-select-sm" data-testid="config-render-proxy-width"><option v-for="w in WIDTH_CHOICES" :key="w" :value="w">{{ w === 'source' ? $t('outputs.render.cfg.source') : `${w} px` }}</option></select>
      </label>
      <label class="mb-0">{{ $t('outputs.render.cfg.reviewWidth') }}
        <select v-model="render.review_width" class="form-select form-select-sm" data-testid="config-render-review-width"><option v-for="w in WIDTH_CHOICES" :key="w" :value="w">{{ w === 'source' ? $t('outputs.render.cfg.source') : `${w} px` }}</option></select>
      </label>
      <label class="mb-0">{{ $t('outputs.render.cfg.fps') }}
        <select v-model="render.fps" class="form-select form-select-sm" data-testid="config-render-fps"><option v-for="f in FPS_CHOICES" :key="f" :value="f">{{ f === 'auto' ? $t('outputs.render.cfg.fpsAuto') : `${f} fps` }}</option></select>
      </label>
    </div>
    <div class="d-flex gap-3 flex-wrap small mb-1" data-testid="config-render-codecs">
      <label><input v-model="render.codecs" type="checkbox" value="h264" class="form-check-input me-1" data-testid="config-render-codec-h264" />{{ $t('outputs.render.cfg.codecH264') }}</label>
      <label><input v-model="render.codecs" type="checkbox" value="prores422hq" class="form-check-input me-1" data-testid="config-render-codec-prores" />{{ $t('outputs.render.cfg.codecProres') }}</label>
      <template v-if="forPod">   <!-- a pod's own configuration has no Publishing tab: the three "when done" boxes stay here; the default configuration has them in Publishing > defaults -->
        <label><input v-model="render.pull" type="checkbox" class="form-check-input me-1" data-testid="config-render-pull" />{{ $t('outputs.render.cfg.pull') }}</label>
        <label><input v-model="render.publish.s3" type="checkbox" class="form-check-input me-1" data-testid="config-render-publish-s3" @change="renderDeps" />{{ $t('outputs.render.cfg.publishS3') }}</label>
        <label><input v-model="render.publish.slack" type="checkbox" class="form-check-input me-1" :disabled="!render.publish.s3" data-testid="config-render-publish-slack" />{{ $t('outputs.render.cfg.publishSlack') }}</label>
      </template>
      <label><input v-model="render.skip_existing" type="checkbox" class="form-check-input me-1" data-testid="config-render-skip-existing" />{{ $t('outputs.render.cfg.skipExisting') }}</label>
      <label :title="$t('outputs.render.cfg.convertRec709Tip')"><input v-model="render.rec709" type="checkbox" class="form-check-input me-1" data-testid="config-render-rec709" />{{ $t('outputs.render.cfg.convertRec709') }}</label>
    </div>
    <div class="d-flex gap-3 flex-wrap align-items-end small mt-2" data-testid="config-render-preset-row">
      <label class="mb-0">{{ $t('outputs.render.preset') }}
        <select v-model="render.preset" class="form-select form-select-sm" data-testid="config-render-preset" @change="renderPresetChanged"><option value="none">{{ $t('outputs.render.presetStandard') }}</option><option value="tunnel">{{ $t('outputs.render.presetTunnel') }}</option></select>
      </label>
    </div>
    <div class="form-text" data-testid="config-render-help">{{ $t('outputs.render.cfg.help') }}</div>
    <div v-if="forPod" class="form-text" data-testid="config-render-pre-help">{{ $t('outputs.render.cfg.preHelp') }}</div>
    <div v-if="forPod" class="form-text" data-testid="config-render-skip-help">{{ $t('outputs.render.cfg.skipHelp') }}</div>
    <div v-if="error" class="text-danger small mt-1" data-testid="config-render-error">{{ error }}</div>
  </div>
</template>

<script setup>
/** RenderFields: the Render sequences choices (docs/ADR-048), edited in place on `render`: a pod's own configuration, and Network Volumes > the BH exchange row > Publishing for every pod. */
import { computed } from 'vue'
import { WIDTH_CHOICES, FPS_CHOICES } from '../utils/renders'

const props = defineProps({ render: { type: Object, required: true }, forPod: { type: Boolean, default: false }, error: { type: String, default: '' } })
// The colour of the frames when nobody states one: empty is the project default (Gamma 2.6 P3-D65 for a header that says linear; log and printing density are still asked)
const RENDER_COLOURS = ['p3-d65-gamma26', 'p3-d65-srgb', 'p3-d65-gamma22', 'linear-p3-d65', 'linear-rec709', 'kodak-log']
const renderColour = computed({
  get: () => (props.render.colour?.mode === 'format' && props.render.colour.format ? props.render.colour.format : ''),
  set: (v) => { props.render.colour = v ? { mode: 'format', format: v, set_by: 'Default Configuration', set_at: new Date().toISOString() } : { mode: 'known' } },
})
function renderPresetChanged() { if (props.render.preset === 'tunnel') props.render.kind = 'proxy' }
/** Slack needs S3: switched off inline, before any call. */
function renderDeps() { const p = props.render.publish; if (!p.s3) p.slack = false }
</script>
