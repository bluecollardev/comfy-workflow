<template>
  <div class="card mb-3" data-testid="mcp-shell-guard-block">
    <div class="card-body">
      <div class="d-flex align-items-start gap-3">
        <i class="fa-solid fa-shield-halved fs-5 text-body-secondary mt-1"></i>
        <div class="flex-grow-1 lh-sm">
          <div class="fw-semibold">{{ $t('mcp.guardTitle') }}</div>
          <p class="small text-body-secondary mb-2 mt-1" data-testid="mcp-shell-guard-help">{{ $t('mcp.guardHelp') }}</p>
          <BFormCheckbox :key="rev" :model-value="!!status.enabled" switch :disabled="busy" data-testid="mcp-shell-guard" @update:model-value="toggle">{{ $t('mcp.guardSwitch') }}</BFormCheckbox>
          <div class="small mt-2" data-testid="mcp-shell-guard-status" :data-installed="status.installed ? 'yes' : 'no'">
            <template v-if="status.installed"><i class="fa-solid fa-circle-check text-success me-1"></i>{{ $t('mcp.guardInstalled') }}</template>
            <template v-else><i class="fa-regular fa-circle me-1 text-body-secondary"></i>{{ $t('mcp.guardNotInstalled') }}</template>
            <BSpinner v-if="busy" small class="ms-2" />
          </div>
          <div v-if="status.settings_file || status.script_file" class="small text-body-secondary font-monospace mt-1" data-testid="mcp-shell-guard-files">
            <div v-if="status.settings_file">{{ $t('mcp.guardSettingsFile') }} {{ status.settings_file }}</div>
            <div v-if="status.script_file">{{ $t('mcp.guardScriptFile') }} {{ status.script_file }}</div>
          </div>
          <div v-if="error || status.error" class="small text-danger mt-2" data-testid="mcp-shell-guard-error"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ error || status.error }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * The shell guard (a system-wide setting, with the agent rules): a PreToolUse hook for Claude Code's Bash tool in the current user's
 * ~/.claude/settings.json that refuses shell routes around this app's MCP tools. The core installs and removes it (agentguardAPI); this block
 * shows whether it is installed, where it wrote, and why a change failed.
 */
import { onMounted, ref } from 'vue'
import { agentguardAPI } from '../api/agentguard'
import { errorText } from '../stores/toast'

const status = ref({ enabled: false, installed: false, settings_file: '', script_file: '' })
const busy = ref(false), error = ref(''), rev = ref(0)   // rev: a failed change re-draws the switch from the real status

async function load() { try { status.value = (await agentguardAPI.status()) || status.value } catch (e) { error.value = errorText(e) } }
async function toggle(on) {
  busy.value = true; error.value = ''
  try { status.value = await agentguardAPI.set(!!on) } catch (e) { error.value = errorText(e); await load(); rev.value++ } finally { busy.value = false }
}
onMounted(load)
</script>
