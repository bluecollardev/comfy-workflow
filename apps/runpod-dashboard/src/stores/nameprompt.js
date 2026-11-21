import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * A small prompt for a NAME (a named yes), optionally with one tick to understand something, over the whole app (NamePromptHost.vue):
 * `await ask({ title, message, okLabel, checkbox, danger, submit })` -> { name, checked } or null on Cancel. The name is remembered like the other approvals.
 * `extra: { label, value, note(on), okLabel(on), danger(on) }` adds a second tick (inside the dialog) whose state is passed to `submit` and returned as `extra`; `note`, `okLabel` and `danger` may follow it.
 * `name` is the name offered when none is remembered yet (e.g. the standing approval's person).
 * `submit({ name, checked, extra })` may be given: it runs on OK and returns '' to close or an error text to show inline and keep the prompt open (the core's 400s).
 */
export const NAME_KEY = 'runpod-manager.approved-by'
export const useNamePromptStore = defineStore('nameprompt', () => {
  const open = ref(false), opts = ref({}), name = ref(''), checked = ref(false), extra = ref(false), error = ref(''), busy = ref(false)
  let resolver = null
  function ask(o = {}) {
    if (resolver) resolver(null)
    opts.value = o; checked.value = false; extra.value = !!o.extra?.value; error.value = ''; busy.value = false
    try { name.value = localStorage.getItem(NAME_KEY) || o.name || '' } catch { name.value = o.name || '' }
    if (o.fresh) name.value = ''   // going live asks for a fresh name: the remembered one is not offered
    open.value = true
    return new Promise((r) => { resolver = r })
  }
  async function ok() {
    const v = { name: name.value.trim(), checked: checked.value, extra: extra.value }
    if (!v.name || (opts.value.checkbox && !v.checked)) return
    if (opts.value.submit) {
      busy.value = true; error.value = ''
      try { const e = await opts.value.submit(v); if (e) { error.value = e; busy.value = false; return } } catch (e) { error.value = e?.message || String(e); busy.value = false; return }
      busy.value = false
    }
    try { localStorage.setItem(NAME_KEY, v.name) } catch { /* storage blocked */ }
    open.value = false; const r = resolver; resolver = null; if (r) r(v)
  }
  function cancel() { open.value = false; const r = resolver; resolver = null; if (r) r(null) }
  return { open, opts, name, checked, extra, error, busy, ask, ok, cancel }
})
