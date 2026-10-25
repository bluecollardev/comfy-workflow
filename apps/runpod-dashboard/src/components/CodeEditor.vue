<template>
  <div ref="host" class="studio-cm" :data-testid="testid" :data-language="language" :data-readonly="readOnly ? 'true' : 'false'"></div>
</template>

<script setup>
/**
 * CodeEditor — a CodeMirror 6 editor for one text: line numbers, highlighting (JavaScript, Markdown, JSON), the one-dark theme, undo. The
 * text is the parent's (v-model); nothing here writes to disk.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup, EditorView } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

const props = defineProps({ modelValue: { type: String, default: '' }, language: { type: String, default: 'js' }, readOnly: Boolean, testid: { type: String, default: 'studio-code' } })
const emit = defineEmits(['update:modelValue', 'cursor'])
const host = ref(null)
let view = null

const languageExt = () => (props.language === 'md' ? markdown() : props.language === 'text' ? [] : javascript({ typescript: false }))
const sizing = EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } })

onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup, languageExt(), oneDark, sizing, EditorView.lineWrapping, EditorState.readOnly.of(props.readOnly), EditorView.contentAttributes.of({ 'aria-label': 'code', 'data-testid': `${props.testid}-content` }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString())
          if (u.selectionSet || u.docChanged) { const head = u.state.selection.main.head; const line = u.state.doc.lineAt(head); emit('cursor', { line: line.number, col: head - line.from + 1 }) }
        }),
      ],
    }),
  })
})
watch(() => props.modelValue, (v) => {
  if (view && v !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
})
onBeforeUnmount(() => view?.destroy())
defineExpose({ focus: () => view?.focus() })
</script>

<style scoped>
.studio-cm { height: 100%; min-height: 0; overflow: hidden; }
.studio-cm :deep(.cm-editor) { height: 100%; }
</style>
