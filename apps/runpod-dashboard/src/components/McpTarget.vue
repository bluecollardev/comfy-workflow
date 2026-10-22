<template>
  <template v-if="ep.id === 'comfy-bridge'">
    <BBadge v-if="kind === 'none'" variant="warning" class="fw-normal" :title="$t('mcp.noTargetHint')" data-testid="mcp-no-target"><i class="fa-solid fa-bullseye me-1"></i>{{ $t('mcp.noTarget') }}</BBadge>
    <BBadge v-else-if="kind === 'pod'" variant="info" class="fw-normal" :title="url" data-testid="mcp-target-pod" :data-pod="pod.pod_id"><i class="fa-solid fa-cloud me-1"></i>{{ $t('mcp.targetPod', { name: pod.name }) }}</BBadge>
    <BBadge v-else-if="kind === 'local'" variant="info" class="fw-normal" :title="url" data-testid="mcp-target-local"><i class="fa-solid fa-laptop me-1"></i>{{ $t('mcp.targetLocal') }}</BBadge>
    <BBadge v-else variant="secondary" class="fw-normal" :title="url" data-testid="mcp-target-url-badge"><i class="fa-solid fa-link me-1"></i>{{ $t('mcp.targetCustomBadge') }}</BBadge>
  </template>
</template>

<script setup>
/**
 * McpTarget: where the bridge works. No target when there is nothing to point at, locally or remote (no running pod
 * whose ComfyUI answers, no ComfyUI on this Mac, no typed URL); a pod badge with the pod's name for a remote ComfyUI;
 * Local for this Mac's own; a plain link badge for a typed URL. Only the bridge has a target.
 */
import { computed } from 'vue'
import { useMcpStore } from '../stores/mcp'

const props = defineProps({ ep: { type: Object, required: true } })
const store = useMcpStore()
// What the bridge will use: the chosen URL, else the first target on offer (the bridge picks the first running pod itself).
const url = computed(() => store.target || props.ep.target || store.targets[0]?.url || '')
const match = computed(() => store.targets.find((x) => x.url === url.value) || null)
const pod = computed(() => (match.value && match.value.pod_id ? match.value : null))
const kind = computed(() => (!url.value ? 'none' : pod.value ? 'pod' : match.value ? 'local' : /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url.value) ? 'local' : 'url'))
</script>
