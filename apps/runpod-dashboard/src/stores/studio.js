import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { importsAPI } from '../api/imports'
import { studioAPI } from '../api/studio'
import { useImportsStore } from './imports'
import { useToastStore, errorText } from './toast'
import { t } from '../i18n'

/**
 * The Adapter Studio (docs/ADR-009): one modal for Edit, New adapter and Write an adapter with Claude. The adapter's code and its
 * prompt are two buffers, saved only when the person presses Save (no autosave, no versions: a todo). Beside them: the attached
 * package (its tree and a viewer for its files), what the adapter does to it (Preview), and the chat with Claude, which builds the
 * prompt that builds the adapter. The chat runs one request per step so every tool call shows as it lands.
 */
export const MAX_STEPS = 10
const SLUG = /[^a-z0-9]+/g

/** The leading comment block of a module: what an adapter says about itself (same rule as the core's docHeader). */
export function docHeaderOf(text) {
  let i = 0
  for (;;) {
    const at = i + /^\s*/.exec(text.slice(i))[0].length
    if (text.startsWith('//', at)) { const nl = text.indexOf('\n', at); i = nl < 0 ? text.length : nl + 1; continue }
    if (text.startsWith('/*', at)) { const end = text.indexOf('*/', at + 2); if (end < 0) break; i = end + 2; continue }
    break
  }
  return text.slice(0, i).trim()
}
/** The words of a header, without the comment marks. */
export const headerText = (h) => h.replace(/\/\*+|\*+\//g, '').replace(/^\s*(\*|\/\/)\s?/gm, '').trim()
/** A string literal for a module: single quotes like the rest of the code, JSON's when the text needs escaping. */
const quote = (v) => (/^[^'\\\n\r]*$/.test(v) ? `'${v}'` : JSON.stringify(v))
/** Replace the first `field: '...'` of a module's source, as the name and id fields of the header do. */
export function patchField(code, field, value) {
  const re = new RegExp(`(\\b${field}\\s*:\\s*)(['"\`])[^'"\`\\n]*\\2`)
  return re.test(code) ? code.replace(re, (_m, pre) => `${pre}${quote(value)}`) : code
}

export const useStudioStore = defineStore('studio', () => {
  const imports = useImportsStore()
  const toast = useToastStore()

  const open = ref(false)
  const error = ref(null)
  // the adapter
  const isNew = ref(false)
  const row = ref(null)             // the adapter's row from the list (null while new)
  const id = ref('')
  const name = ref('')
  const code = ref(''); const savedCode = ref('')
  const baseline = ref('')          // what an unsaved new adapter started as (the template): editing it is what makes it modified
  const prompt = ref(''); const savedPrompt = ref('')
  const original = ref('')          // a modified built-in's shipped code
  const filePath = ref('')          // where the module is on disk
  const saving = ref(false)
  const problems = ref([])          // the structure check of the code buffer, live
  // what the editor shows
  const tab = ref('code')           // 'code' | 'prompt' | 'file'
  let storedView = 'split'
  try { storedView = localStorage.getItem('runpod-manager.studio-view') || 'split' } catch { /* storage blocked */ }
  const view = ref(['code', 'preview', 'split'].includes(storedView) ? storedView : 'split')
  watch(view, (v) => { try { localStorage.setItem('runpod-manager.studio-view', v) } catch { /* storage blocked */ } })
  let storedWrap = 'on'
  try { storedWrap = localStorage.getItem('runpod-manager.studio-wrap') || 'on' } catch { /* storage blocked */ }
  const wrap = ref(storedWrap !== 'off')   // line wrap in the editors; a per-viewer choice kept in this browser
  watch(wrap, (v) => { try { localStorage.setItem('runpod-manager.studio-wrap', v ? 'on' : 'off') } catch { /* storage blocked */ } })
  // the attached package
  const folder = ref('')
  const tree = ref(null)
  const treeError = ref(null)
  const viewing = ref(null)         // the package file open in the viewer
  const plan = ref(null)            // what the saved adapter does to the folder
  const planError = ref(null)
  const planning = ref(false)
  // the chat
  const messages = ref([])          // the API conversation (sent back on every step)
  const log = ref([])               // what the screen shows
  const calls = ref(0)
  const created = ref([])
  const running = ref(false)
  const consented = ref(false)
  const context = ref(null)         // what the first message would send
  const chatInput = ref('')
  let stopRequested = false

  const builtin = computed(() => !!row.value?.builtin)
  const modified = computed(() => !!row.value?.modified)
  const dirtyCode = computed(() => code.value !== (isNew.value ? baseline.value : savedCode.value))
  const dirtyPrompt = computed(() => prompt.value !== savedPrompt.value)
  const dirty = computed(() => dirtyCode.value || dirtyPrompt.value)
  const header = computed(() => docHeaderOf(code.value))
  const valid = computed(() => problems.value.length === 0 && !planError.value)

  let checkRun = 0
  async function check() {
    const mine = ++checkRun
    if (!open.value) return
    try { const r = await importsAPI.validate(code.value, id.value); if (mine === checkRun) problems.value = r || [] } catch { /* the save reports it */ }
  }
  watch([code, id], () => { if (open.value) check() })

  const say = (item) => log.value.push({ n: log.value.length + 1, ...item })
  const note = (text, level = 'info') => say({ kind: 'note', text, level })

  function reset() {
    error.value = null; viewing.value = null; plan.value = null; planError.value = null; problems.value = []
    messages.value = []; log.value = []; calls.value = 0; created.value = []; running.value = false; chatInput.value = ''; stopRequested = false
    tab.value = 'code'
  }

  async function loadTree() {
    tree.value = null; treeError.value = null
    if (!folder.value) return
    try { tree.value = await studioAPI.tree(folder.value) } catch (e) { treeError.value = errorText(e) }
  }
  async function loadContext() {
    context.value = null
    if (!folder.value) return
    try { context.value = await studioAPI.context(folder.value) } catch { context.value = null }
  }
  /** What the saved adapter does to the attached folder (a fenced run). */
  async function loadPlan() {
    plan.value = null; planError.value = null
    if (!folder.value || isNew.value || !id.value) return
    planning.value = true
    try { plan.value = await importsAPI.plan(folder.value, id.value) } catch (e) { planError.value = errorText(e) } finally { planning.value = false }
  }
  async function attach(path) {
    folder.value = path || ''
    viewing.value = null
    consented.value = false
    await Promise.all([loadTree(), loadContext()])
    await loadPlan()
  }

  async function openAdapter(adapterId, { folder: dir = '' } = {}) {
    reset(); error.value = null
    try {
      await imports.loadAdapters()
      const s = await importsAPI.source(adapterId)
      row.value = imports.adapters.find((a) => a.id === adapterId) || null
      id.value = adapterId; name.value = row.value?.name || adapterId
      code.value = savedCode.value = s.text; original.value = s.original || ''; filePath.value = s.file
      prompt.value = savedPrompt.value = await importsAPI.getPrompt(adapterId)
      isNew.value = false
      open.value = true
      await attach(dir)
      await check()
    } catch (e) { error.value = errorText(e); toast.error(error.value) }
  }

  /** A new adapter from the template, or a copy of another one (`copyOf`); with `folder`, the package is attached and the chat is where the person starts. */
  async function openNew({ folder: dir = '', copyOf = '' } = {}) {
    reset()
    await imports.loadAdapters()
    const base = (copyOf ? `${copyOf}-copy` : dir ? dir.split('/').filter(Boolean).pop() || 'my-adapter' : 'my-adapter').toLowerCase().replace(SLUG, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'my-adapter'
    let candidate = base, n = 2
    while (imports.adapters.some((a) => a.id === candidate)) candidate = `${base}-${n++}`
    id.value = candidate; name.value = candidate
    try {
      code.value = copyOf ? patchField(patchField((await importsAPI.duplicate(copyOf, candidate)), 'name', candidate), 'id', candidate) : await importsAPI.template(candidate, candidate)
    } catch (e) { error.value = errorText(e); toast.error(error.value); return }
    savedCode.value = ''; baseline.value = code.value; prompt.value = savedPrompt.value = ''; original.value = ''; row.value = null; filePath.value = ''
    isNew.value = true
    open.value = true
    await attach(dir)
    await check()
  }

  // the header's fields write into the code buffer, so what you see is what Save writes
  // (an unsaved new adapter that has only had its name or id typed is still the template: the chat's build may replace it)
  function patchHeader(field, v) {
    const pristine = isNew.value && code.value === baseline.value
    code.value = patchField(code.value, field, v)
    if (pristine) baseline.value = code.value
  }
  function setName(v) { name.value = v; patchHeader('name', v) }
  function setId(v) { id.value = v; patchHeader('id', v) }

  async function afterSave(r) {
    code.value = savedCode.value = r.text
    await imports.loadAdapters()
    row.value = imports.adapters.find((a) => a.id === id.value) || null
    name.value = row.value?.name || name.value
    filePath.value = row.value?.file || filePath.value
    isNew.value = false
    await loadPlan()
    await check()
  }

  /** Save: the code (with the agent's check), then the prompt. Explicit only: nothing is written until this is pressed. */
  async function save() {
    if (saving.value) return null
    saving.value = true; error.value = null
    try {
      if (!isNew.value && !builtin.value && row.value && (id.value !== row.value.id)) {
        const moved = await importsAPI.rename(row.value.id, { id: id.value, name: name.value })
        row.value = moved
      }
      const r = await studioAPI.saveChecked(id.value, code.value, folder.value)
      for (const round of r.rounds || []) say({ kind: 'round', round: round.round, errors: round.errors, fixed: round.fixed })
      if (dirtyPrompt.value || (isNew.value && prompt.value)) { await importsAPI.savePrompt(id.value, prompt.value); savedPrompt.value = prompt.value }
      await afterSave(r)
      if (r.valid) toast.success(t('studio.saved', { id: id.value }))
      else { note(t('studio.savedNotValid', { id: id.value, n: r.errors.length }), 'warn'); toast.info(t('studio.savedNotValid', { id: id.value, n: r.errors.length })) }
      return r
    } catch (e) { error.value = errorText(e); toast.error(error.value); return null } finally { saving.value = false }
  }

  async function savePromptOnly() {
    if (isNew.value && !id.value) return
    try { await importsAPI.savePrompt(id.value, prompt.value); savedPrompt.value = prompt.value; toast.success(t('studio.promptSaved')) } catch (e) { error.value = errorText(e) }
  }

  async function documentIt() {
    if (isNew.value) { error.value = t('studio.saveFirst'); return }
    try {
      note(t('studio.documenting'))
      const r = await studioAPI.document(id.value)
      const s = await importsAPI.source(id.value)
      code.value = savedCode.value = s.text
      say({ kind: 'note', text: t('studio.documented', { id: id.value }), level: 'ok' })
      return r
    } catch (e) { error.value = errorText(e) }
  }

  async function resetBuiltin() {
    if (!modified.value) return
    if (!window.confirm(t('studio.confirmReset', { id: id.value }))) return
    try { await importsAPI.remove(id.value); toast.success(t('studio.wasReset', { id: id.value })); await openAdapter(id.value, { folder: folder.value }) } catch (e) { error.value = errorText(e) }
  }

  async function openFile(path) {
    try { viewing.value = await studioAPI.file(folder.value, path); tab.value = 'file' } catch (e) { error.value = errorText(e) }
  }

  // ----- the chat -----

  const chatState = () => ({ messages: messages.value, adapter: id.value, folder: folder.value || null, created: created.value, calls: calls.value })

  /** The prompt is the person's too: what Claude changed on disk is brought into the buffers unless they hold unsaved edits of their own. */
  async function refresh(changed) {
    if (changed === 'list' || changed === 'name') await imports.loadAdapters()
    if (changed === 'prompt' && id.value) {
      const p = await importsAPI.getPrompt(id.value)
      if (!dirtyPrompt.value) prompt.value = savedPrompt.value = p
      else if (p !== savedPrompt.value) note(t('studio.promptKept'), 'warn')
    }
    if (changed === 'code' && id.value) {
      const s = await importsAPI.source(id.value).catch(() => null)
      if (s) {
        if (!dirtyCode.value) { code.value = savedCode.value = s.text; original.value = s.original || '' }
        else note(t('studio.codeKept'), 'warn')
        await imports.loadAdapters()
        row.value = imports.adapters.find((a) => a.id === id.value) || row.value
        if (row.value) { name.value = row.value.name; filePath.value = row.value.file }
        isNew.value = false
        await loadPlan()
      }
    }
  }

  async function send(text) {
    const said = (text ?? chatInput.value).trim()
    if (!said || running.value) return
    consented.value = true   // pressing Send is the start: the card above the box said what the first message carries
    chatInput.value = ''
    messages.value = [...messages.value, { role: 'user', content: said }]
    say({ kind: 'user', text: said })
    running.value = true; stopRequested = false; error.value = null
    try {
      for (let n = 0; n < MAX_STEPS; n++) {
        const r = await studioAPI.step(chatState())
        messages.value = r.state.messages; calls.value = r.state.calls; created.value = r.state.created
        if (r.state.adapter && r.state.adapter !== id.value) { id.value = r.state.adapter }
        for (const ev of r.events) {
          say(ev.kind === 'text' ? { kind: 'assistant', text: ev.text } : { kind: 'tool', name: ev.name, input: ev.input, ok: ev.ok, summary: ev.summary })
          if (ev.kind === 'tool' && ev.ok && ev.changed) await refresh(ev.changed)
        }
        if (r.done || stopRequested) { if (stopRequested && !r.done) note(t('studio.stopped'), 'warn'); break }
        if (n === MAX_STEPS - 1) note(t('studio.maxSteps', { n: MAX_STEPS }), 'warn')
      }
    } catch (e) { say({ kind: 'error', text: errorText(e) }) } finally { running.value = false }
  }
  const stop = () => { stopRequested = true }
  const consent = () => { consented.value = true }

  /** Close the Studio; unsaved edits ask first. */
  function close() {
    if (dirty.value && !window.confirm(t('studio.confirmClose'))) return false
    open.value = false
    imports.loadAdapters()
    return true
  }

  return {
    open, error, isNew, row, id, name, code, savedCode, prompt, savedPrompt, original, filePath, saving, problems, tab, view, wrap,
    folder, tree, treeError, viewing, plan, planError, planning, messages, log, calls, created, running, consented, context, chatInput,
    builtin, modified, dirtyCode, dirtyPrompt, dirty, header, valid,
    openAdapter, openNew, attach, loadPlan, setName, setId, save, savePromptOnly, documentIt, resetBuiltin, openFile, send, stop, consent, close, check, note,
  }
})
