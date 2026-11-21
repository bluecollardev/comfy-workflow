<template>
  <span class="d-inline-block" :title="target.ok ? $t('autopublish.pane.viewOutputsTitle', { folder: target.folder }) : reasonText" data-testid="autopublish-outputs-wrap">
    <BButton variant="link" size="sm" class="p-0 text-nowrap" :disabled="!target.ok" :data-reason="target.ok ? '' : target.reason" data-testid="autopublish-view-outputs" @click="open">{{ $t('autopublish.pane.viewOutputs') }}</BButton>
  </span>
</template>

<script setup>
/** AutoPublishOutputsLink: "View In Outputs" on an Auto-publish row (pending, would upload in a dry run, held, recent). It opens the Outputs window of a pod on the volume in the row's review folder (deliver/<shot>/<vNNN>, folder scope). Disabled, with the reason as its tooltip, when the review has no files (not generated yet), the row names no folder, or no pod is attached to the volume. */
import { computed } from 'vue'
import { useAutopublishStore } from '../stores/autopublish'
import { usePodsStore } from '../stores/pods'
import { useUiStore } from '../stores/ui'
import { t } from '../i18n'
import { outputsTarget } from '../utils/autopublish'

const props = defineProps({ row: { type: Object, required: true } })
const ap = useAutopublishStore(), pods = usePodsStore(), ui = useUiStore()
const target = computed(() => outputsTarget(props.row, { review: ap.reviewFor?.(props.row.shot, props.row.version) || null, pods: pods.pods, volumeId: ap.status?.watching?.volume?.id || '' }))
const reasonText = computed(() => t(target.value.reason === 'nopod' ? 'autopublish.pane.outputsNoPod' : target.value.reason === 'nofolder' ? 'autopublish.pane.outputsNoFolder' : 'autopublish.pane.outputsNothing'))
function open() {
  if (!target.value.ok) return
  ui.queueOpen = false
  ui.openFolder = target.value.folder
  ui.outputsFor = { pod_id: target.value.pod_id }
}
</script>
