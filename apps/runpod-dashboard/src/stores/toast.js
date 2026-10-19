import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * One place for every toast in the app. Components never render toasts themselves: they call
 * `toast.success(...)`, `toast.error(...)`, `toast.info(...)`, or wrap an action in `toast.run(...)`,
 * which reports the outcome either way. ToastHost.vue, mounted once in App.vue, renders the
 * list top right and removes each toast when its time is up. No library orchestrator: plain
 * Bootstrap toast markup, so what is in this list is what is on screen.
 */
export const HIDE_AFTER_MS = 4000

/** The one line an API error has for people: FastAPI's detail, else the HTTP/axios message. */
export const errorText = (e) => e?.response?.data?.detail || e?.message || String(e)

export const useToastStore = defineStore('toast', () => {
  const toasts = ref([])
  let nextId = 1

  function dismiss(id) {
    const i = toasts.value.findIndex((t) => t.id === id)
    if (i >= 0) toasts.value.splice(i, 1)
  }

  function show(variant, body, title) {
    const id = nextId++
    toasts.value.push({ id, variant, title, body, at: Date.now() })
    setTimeout(() => dismiss(id), HIDE_AFTER_MS)
    return id
  }

  const success = (body, title = 'Done') => show('success', body, title)
  const error = (body, title = 'Failed') => show('danger', body, title)
  const info = (body, title = 'Note') => show('info', body, title)

  /**
   * Run an action and toast its outcome. `label` names it for people ("Stop pod");
   * `ok` is the success line (default "<label> done"). Returns `{ ok: true, value }` or
   * `{ ok: false, error }`: a void action is still a success. The failure is toasted and
   * passed to `onError` if given, so a view can also show it inline.
   */
  async function run(label, action, { ok, onError } = {}) {
    try {
      const value = await action()
      success(ok || `${label} done`)
      return { ok: true, value }
    } catch (e) {
      const text = `${label} failed: ${errorText(e)}`
      error(text)
      onError?.(text, e)
      return { ok: false, error: e }
    }
  }

  return { toasts, show, dismiss, success, error, info, run }
})
