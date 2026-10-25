<template>
  <div class="chat" data-testid="studio-chat">
    <div class="chat-head">
      <i class="fa-solid fa-wand-magic-sparkles me-2"></i><strong>{{ $t('studio.claude') }}</strong>
      <small class="ms-auto text-body-secondary" data-testid="studio-calls">{{ $t('studio.calls', { n: studio.calls }) }}</small>
    </div>

    <div ref="scroller" class="chat-log" data-testid="studio-log">
      <!-- What the first message will carry, said before it is sent; nothing leaves until Send. -->
      <div v-if="!studio.consented" class="ctx card" data-testid="studio-context">
        <div class="card-body small">
          <div class="fw-semibold mb-1"><i class="fa-solid fa-lock me-1"></i>{{ $t('studio.contextTitle') }}</div>
          <p class="mb-1">{{ $t('studio.contextRule') }}</p>
          <template v-if="studio.context">
            <p class="mb-1" data-testid="studio-context-counts">{{ $t('studio.contextSends', { dirs: studio.context.dirs.length, files: studio.context.total_files, texts: studio.context.texts.length }) }}</p>
            <div v-for="x in studio.context.texts" :key="x.path" class="font-monospace" data-testid="studio-context-text">{{ x.path }} <span class="text-body-secondary">({{ $t('import.claudeBytes', { sent: x.sent_bytes, bytes: x.bytes }) }})</span></div>
          </template>
          <p v-else class="mb-1 text-body-secondary" data-testid="studio-context-nofolder">{{ $t('studio.contextNoFolder') }}</p>
          <p class="mb-0 text-body-secondary" data-testid="studio-context-send">{{ $t('studio.contextSendStarts') }}</p>
        </div>
      </div>

      <template v-for="m in studio.log" :key="m.n">
        <div v-if="m.kind === 'user'" class="msg user" data-testid="studio-msg-user">{{ m.text }}</div>
        <div v-else-if="m.kind === 'assistant'" class="msg assistant" data-testid="studio-msg-assistant">{{ m.text }}</div>
        <div v-else-if="m.kind === 'tool'" class="tool" :class="m.ok ? 'ok' : 'bad'" data-testid="studio-tool" :data-name="m.name" :data-ok="m.ok ? 'true' : 'false'">
          <i class="fa-solid me-1" :class="m.ok ? 'fa-check' : 'fa-xmark'"></i><code>{{ m.name }}</code> <span class="text-body-secondary">{{ m.summary }}</span>
        </div>
        <div v-else-if="m.kind === 'round'" class="tool" :class="m.fixed ? 'ok' : 'bad'" data-testid="studio-round">
          <i class="fa-solid me-1" :class="m.fixed ? 'fa-screwdriver-wrench' : 'fa-triangle-exclamation'"></i>{{ $t(m.fixed ? 'studio.roundFixed' : 'studio.roundFailed', { n: m.round, errors: m.errors.length }) }}
        </div>
        <div v-else-if="m.kind === 'error'" class="msg err" data-testid="studio-msg-error"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ m.text }}</div>
        <div v-else class="note" :class="m.level" data-testid="studio-note">{{ m.text }}</div>
      </template>
      <div v-if="studio.running" class="note" data-testid="studio-working"><BSpinner small class="me-2" />{{ $t('studio.working') }}</div>
    </div>

    <form class="chat-in" @submit.prevent="send">
      <BAlert v-if="!claudeSet" :model-value="true" variant="warning" class="small py-1 mb-1" data-testid="studio-context-nokey"><i class="fa-solid fa-key me-1"></i>{{ $t('studio.noKey') }} <a href="#" class="fw-semibold" data-testid="studio-setkey" @click.prevent="openKey">{{ $t('import.claudeSetKey') }}</a></BAlert>
      <BFormTextarea v-model="studio.chatInput" rows="3" no-resize :placeholder="$t('studio.chatPlaceholder')" data-testid="studio-input" @keydown.enter.exact.prevent="send" />
      <div class="d-flex gap-2 mt-1">
        <BButton v-if="studio.running" size="sm" variant="outline-danger" type="button" :aria-label="$t('studio.stop')" :title="$t('studio.stop')" data-testid="studio-stop" @click="studio.stop()"><i class="fa-solid fa-stop"></i><span class="btn-label ms-1">{{ $t('studio.stop') }}</span></BButton>
        <BButton v-else size="sm" variant="primary" type="submit" :disabled="!claudeSet || !studio.chatInput.trim()" :title="claudeSet ? $t('studio.send') : $t('studio.noKey')" :aria-label="$t('studio.send')" data-testid="studio-send"><i class="fa-solid fa-paper-plane"></i><span class="btn-label ms-1">{{ $t('studio.send') }}</span></BButton>
        <small class="text-body-secondary ms-auto align-self-center">{{ $t('studio.chatHint') }}</small>
      </div>
    </form>
  </div>
</template>

<script setup>
/** StudioChat — the conversation with Claude: it builds the adapter's prompt, builds the adapter from it, and shows every tool call as it lands. Nothing is sent before the person starts it (ADR-009, decision 13). */
import { computed, nextTick, ref, watch } from 'vue'
import { useStudioStore } from '../stores/studio'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const studio = useStudioStore()
const settings = useSettingsStore()
const ui = useUiStore()
const scroller = ref(null)
const claudeSet = computed(() => !!settings.keyInfo.anthropic_key_set)
const send = () => studio.send()
/** No key: the way to the key field, as everywhere else. The Studio stays; Default Configuration opens over it. */
const openKey = () => { ui.configFocus = 'claude'; ui.configOpen = true }
watch(() => [studio.log.length, studio.running], async () => { await nextTick(); if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight })
</script>

<style scoped>
.chat { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #1b1d22; }
.chat-head { display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); font-size: 13px; }
.chat-log { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.chat-in { padding: 8px 12px 10px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.msg { padding: 6px 10px; border-radius: 8px; font-size: 13px; white-space: pre-wrap; max-width: 92%; }
.msg.user { align-self: flex-end; background: #2b5fd9; color: #fff; }
.msg.assistant { align-self: flex-start; background: #2a2d34; }
.msg.err { background: rgba(235, 87, 87, 0.18); color: #f19b9b; }
.tool { font-size: 12px; padding: 2px 8px; border-left: 2px solid #4a4f5a; color: #b6bdc8; }
.tool.ok { border-color: #6fcf97; }
.tool.bad { border-color: #f2994a; }
.note { font-size: 12px; color: #9aa4b2; }
.note.warn { color: #f2c94c; }
.note.ok { color: #6fcf97; }
.ctx { background: #22252b; border-color: rgba(255, 255, 255, 0.1); }
</style>
