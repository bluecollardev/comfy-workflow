<template>
  <BBadge v-if="probing" variant="secondary" class="fw-normal" data-testid="mcp-probing"><BSpinner small class="me-1" />{{ $t('mcp.probing') }}</BBadge>
  <BBadge v-else-if="noTarget" variant="warning" class="fw-normal" :title="$t('mcp.noTargetHint')" data-testid="mcp-no-target"><i class="fa-solid fa-bullseye me-1"></i>{{ $t('mcp.noTarget') }}</BBadge>
  <BBadge v-else-if="!result" variant="secondary" class="fw-normal" :title="$t('mcp.uncheckedHint')" data-testid="mcp-unchecked">{{ $t('mcp.unchecked') }}</BBadge>
  <BBadge v-else-if="result.ok" variant="success" class="fw-normal" :title="$t('mcp.connectedHint')" data-testid="mcp-connected"><i class="fa-solid fa-circle-check me-1"></i>{{ $t('mcp.connected') }}</BBadge>
  <BBadge v-else variant="danger" class="fw-normal" :title="result.error || $t('mcp.noAnswer')" data-testid="mcp-disconnected"><i class="fa-solid fa-circle-xmark me-1"></i>{{ $t('mcp.disconnected') }}</BBadge>
</template>

<script setup>
/** McpStatus: the connection badge of an endpoint (card header and Docs header): probing, no target, not checked, connected, not connected. */
import { computed } from 'vue'
import { useMcpStore } from '../stores/mcp'

const props = defineProps({ ep: { type: Object, required: true } })
const store = useMcpStore()
const probing = computed(() => !!store.probing[props.ep.id])
const result = computed(() => store.results[props.ep.id])
// The bridge with nothing to point at (no running pod, no URL) is not a failure; it waits for a target.
const noTarget = computed(() => props.ep.id === 'comfy-bridge' && !props.ep.target)
</script>
