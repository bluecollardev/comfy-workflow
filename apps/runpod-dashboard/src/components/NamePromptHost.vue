<template>
  <BModal :model-value="p.open" :title="p.opts.title" size="md" centered no-footer data-testid="name-prompt" @update:model-value="(v) => !v && p.cancel()">
    <p v-if="p.opts.message" class="small mb-2" data-testid="name-prompt-message">{{ p.opts.message }}</p>
    <label class="small mb-0" for="name-prompt-input">{{ p.opts.nameLabel || $t('autopublish.approvedBy') }}</label>
    <BFormInput id="name-prompt-input" v-model="p.name" size="sm" autocomplete="off" autofocus data-testid="name-prompt-input" @keydown.enter.prevent="p.ok()" />
    <div v-if="!p.name.trim()" class="small text-warning" data-testid="name-prompt-hint">{{ $t('autopublish.needName') }}</div>
    <label v-if="p.opts.checkbox" class="d-flex align-items-start gap-2 small mt-2"><input v-model="p.checked" type="checkbox" class="form-check-input mt-1" data-testid="autopublish-understood" /><span>{{ p.opts.checkbox }}</span></label>
    <label v-if="p.opts.extra" class="d-flex align-items-start gap-2 small mt-2"><input v-model="p.extra" type="checkbox" class="form-check-input mt-1" data-testid="name-prompt-extra" /><span>{{ p.opts.extra.label }}</span></label>
    <div v-if="p.opts.extra?.note" class="small mt-2" data-testid="name-prompt-extra-note">{{ p.opts.extra.note(p.extra) }}</div>
    <div v-if="p.error" class="alert alert-danger py-1 px-2 small mt-2 mb-0" data-testid="name-prompt-error">{{ p.error }}</div>
    <div class="d-flex justify-content-end gap-2 mt-3">
      <BButton variant="outline-light" size="sm" data-testid="name-prompt-cancel" @click="p.cancel()">{{ $t('picker.cancel') }}</BButton>
      <BButton :variant="(p.opts.extra?.danger ? p.opts.extra.danger(p.extra) : p.opts.danger) ? 'danger' : 'primary'" size="sm" :disabled="!p.name.trim() || (p.opts.checkbox && !p.checked) || p.busy" data-testid="name-prompt-ok" @click="p.ok()"><BSpinner v-if="p.busy" small class="me-1" />{{ (p.opts.extra?.okLabel ? p.opts.extra.okLabel(p.extra) : p.opts.okLabel) || 'OK' }}</BButton>
    </div>
  </BModal>
</template>

<script setup>
/** NamePromptHost: the one prompt for a name (and a tick) the app asks with stores/nameprompt.js: approving a shot version, Publish now, turning Auto-publish on, going live. */
import { useNamePromptStore } from '../stores/nameprompt'
const p = useNamePromptStore()
</script>
