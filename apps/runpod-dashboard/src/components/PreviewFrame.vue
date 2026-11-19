<template>
  <div v-if="slackOn && (supported || volumeBadge || linksLine)" class="mt-1" data-testid="publish-preview">
    <div v-if="linksLine" class="small text-body-secondary" data-testid="publish-links-line">{{ linksLine }}</div>
    <span v-if="volumeBadge" class="badge text-bg-info fw-normal" data-testid="publish-volume-source-badge">{{ $t('publish.volumeSource.badge') }}</span>
    <label v-if="supported" class="d-flex align-items-center gap-2 small mb-0"><input :checked="modelValue" type="checkbox" class="form-check-input mt-0" data-testid="publish-preview-frame" @change="$emit('update:modelValue', $event.target.checked)" />{{ $t('publish.preview.include') }}</label>
    <template v-if="supported && modelValue && plan?.slack && typeof plan.slack.preview_frames === 'number'">
      <div v-if="plan.slack.preview_frames > 0" class="small text-body-secondary" data-testid="publish-preview-line">
        <span class="fw-semibold">{{ $t('publish.preview.line', { clip }) }}</span><span v-if="more > 0" data-testid="publish-preview-more"> {{ $t('publish.preview.more', { n: more }) }}</span>
        <details v-if="plan.previews?.length" class="d-inline-block ms-2" data-testid="publish-preview-list"><summary>{{ $t('publish.preview.list') }}</summary>
          <div v-for="p in plan.previews" :key="p.s3_key" class="font-monospace" data-testid="publish-preview-item">{{ p.name }} <span class="text-body-secondary">{{ p.s3_key }}</span></div></details>
      </div>
      <div v-else-if="plan.files > 0 || plan.items?.length" class="small text-warning" data-testid="publish-preview-none">{{ $t('publish.preview.none', { reason }) }}</div>
    </template>
  </div>
</template>

<script setup>
/**
 * PreviewFrame: under the Slack message preview (Publish files and Backfill): the first-frame preview image the Slack post carries (up to 3 shots), what it is called and where it lands,
 * an amber line when none will be included, and the per-run tick (`preview_frame`, this run only; its start is the Slack setting). Hidden on a core that predates it (`supported` false).
 */
import { computed } from 'vue'
import { t } from '../i18n'
import { expiryText } from '../utils/publish'
const props = defineProps({ plan: { type: Object, default: null }, modelValue: { type: Boolean, default: true }, supported: { type: Boolean, default: false }, volumeSource: { type: Boolean, default: false }, slackOn: { type: Boolean, default: false } })
defineEmits(['update:modelValue'])
/** The Slack setting is on and the files came from the volume (the core's preview says so, or the plan streamed from it): the post carries where they were. */
const volumeBadge = computed(() => props.volumeSource && !!props.plan?.slack && (/Source on the volume/i.test(props.plan.slack.preview || '') || !!props.plan.slack.volume_source || (props.plan.streamed_files || 0) > 0))
/** 'Links: the folder and the first 10 files, expiring <date>' from the core's plan.slack.links; 'No links' when both are off; nothing from a core without it. Backfill and Auto-publish say the same. */
const linksLine = computed(() => {
  const l = props.plan?.slack?.links
  if (!l || typeof l !== 'object') return ''
  const when = l.expires_at ? expiryText(l.expires_at) : ''
  if (!l.folder && !l.files) return t('publish.links.none')
  const what = l.folder && l.files ? t('publish.links.both', { n: l.files }) : l.files ? t('publish.links.filesOnly', { n: l.files }) : t('publish.links.folderOnly')
  return what + (when && l.files ? t('publish.links.expiring', { when }) : '')
})
const clip = computed(() => props.plan?.previews?.[0]?.name || '')
const more = computed(() => Math.max(0, (props.plan?.slack?.preview_frames || 0) - 1))
const reason = computed(() => props.plan?.slack?.preview_problem || (props.plan?.warnings || []).find((w) => /preview/i.test(w)) || t('publish.preview.noneReason'))
</script>
