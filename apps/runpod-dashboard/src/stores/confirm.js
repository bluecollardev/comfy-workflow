import { defineStore } from 'pinia'
import { ref } from 'vue'

/** An in-app confirmation (a modal) instead of the browser's own dialog: `await confirm.ask(message, { title, okLabel, danger })` is true on OK, false on Cancel, Esc or the X. One at a time; a new question answers the one open with No. */
export const useConfirmStore = defineStore('confirm', () => {
  const open = ref(false), message = ref(''), title = ref(''), okLabel = ref(''), danger = ref(true)
  let resolver = null
  function ask(msg, o = {}) {
    if (resolver) resolver(false)
    message.value = msg; title.value = o.title || ''; okLabel.value = o.okLabel || ''; danger.value = o.danger !== false
    open.value = true
    return new Promise((r) => { resolver = r })
  }
  function answer(yes) { open.value = false; const r = resolver; resolver = null; if (r) r(!!yes) }
  return { open, message, title, okLabel, danger, ask, answer }
})
