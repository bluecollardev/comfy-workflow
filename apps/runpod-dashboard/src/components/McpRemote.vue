<template>
  <div class="card mb-3" data-testid="mcp-remote">
    <div class="card-body">
      <div class="d-flex align-items-start gap-3">
        <i class="fa-solid fa-cloud fs-5 text-body-secondary mt-1"></i>
        <div class="flex-grow-1 lh-sm">
          <div class="fw-semibold">{{ $t('remoteMcp.title') }}</div>
          <small class="text-body-secondary d-block">{{ $t('remoteMcp.intro') }}</small>
        </div>
      </div>

      <BAlert v-if="store.error" :model-value="true" variant="danger" dismissible class="mt-2 mb-0" data-testid="remote-error" @update:model-value="store.error = null">{{ store.error }}</BAlert>

      <div v-if="store.status" class="mt-3" data-testid="remote-bh">
        <div class="fw-semibold">{{ store.status.name }} <code class="small text-body-secondary" data-testid="remote-url">{{ store.status.url }}</code></div>
        <div class="small mt-1" data-testid="remote-key-state">
          <i class="fa-solid fa-key me-1" :class="store.status.key_set ? 'text-success' : 'text-warning'"></i>
          <span v-if="store.status.key_set">{{ $t('remoteMcp.keyStored', { hint: store.status.key_hint }) }}</span>
          <span v-else>{{ $t('remoteMcp.keyUnset') }}</span>
        </div>
        <div class="d-flex gap-1 mt-2">
          <BFormInput v-model.trim="typed" type="password" size="sm" autocomplete="off" :placeholder="$t('remoteMcp.keyPlaceholder')" data-testid="remote-key-input" @keydown.enter.prevent="save" />
          <BButton size="sm" variant="primary" class="text-nowrap" :disabled="!typed || store.saving" data-testid="remote-key-save" @click="save">{{ $t('remoteMcp.save') }}</BButton>
          <BButton v-if="store.status.key_set" size="sm" variant="outline-light" class="text-nowrap" :disabled="store.saving" data-testid="remote-key-remove" @click="store.saveKey(null)">{{ $t('remoteMcp.remove') }}</BButton>
          <BButton size="sm" variant="outline-light" class="text-nowrap" :disabled="store.checking" data-testid="remote-check" @click="store.check()">
            <BSpinner v-if="store.checking" small class="me-1" /><i v-else class="fa-solid fa-stethoscope me-1"></i>{{ store.checking ? $t('mcp.checking') : $t('mcp.check') }}
          </BButton>
        </div>
        <div class="form-text">{{ $t('remoteMcp.keyHelp') }}</div>

        <div v-if="store.result" class="mt-2" data-testid="remote-result" :data-ok="store.result.ok ? 'true' : 'false'">
          <template v-if="store.result.ok">
            <small class="text-body-secondary d-block" data-testid="remote-result-facts"><i class="fa-solid fa-circle-check text-success me-1"></i>{{ $t('remoteMcp.connected', { n: store.result.tools.length, ms: store.result.ms }) }}<span v-if="store.result.who" data-testid="remote-who"> · {{ $t('remoteMcp.who', { who: store.result.who, role: store.result.role || '?' }) }}</span></small>
            <div class="d-flex flex-wrap gap-1 mt-1" data-testid="remote-tools"><BBadge v-for="n in store.result.tools" :key="n" variant="secondary" class="fw-normal font-monospace">{{ n }}</BBadge></div>
            <small v-if="!store.result.tools.some((n) => /export/.test(n))" class="text-body-secondary d-block mt-1" data-testid="remote-no-exports">{{ $t('remoteMcp.noExports') }}</small>
          </template>
          <BBadge v-else variant="danger" class="fw-normal text-wrap text-start" data-testid="remote-result-error"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t(`remoteMcp.hint.${store.result.hint || 'unreachable'}`) }} <span class="text-body-secondary">{{ store.result.error }}</span></BBadge>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * McpRemote — Connect › MCP › Remote servers (docs/ADR-019): MCP servers this app uses, starting with BH's Panama console. The key is saved
 * to the settings file and shown by its last four characters; Check lists the tools the key's role may call and who the key is.
 */
import { onMounted, ref } from 'vue'
import { useRemoteStore } from '../stores/remote'

const store = useRemoteStore()
const typed = ref('')
const save = async () => { if (!typed.value) return; await store.saveKey(typed.value); typed.value = '' }
onMounted(async () => { await store.load(); if (store.status?.key_set) store.check() })
</script>
