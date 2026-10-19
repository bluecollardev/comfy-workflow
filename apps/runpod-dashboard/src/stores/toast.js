import { reactive } from 'vue'

/**
 * One place for every toast in the app. Components never render toasts themselves: they call
 * `toast.success(...)`, `toast.error(...)`, `toast.info(...)`, or wrap an action in `toast.run(...)`,
 * which reports the outcome either way. ToastHost.vue, mounted once in App.vue, renders the
 * list top right and removes each toast when its time is up. No library orchestrator: plain
 * Bootstrap toast markup, so what is in this list is what is on screen.
 */
export const HIDE_AFTER_MS = 4000
let nextId = 1

export const toasts = reactive([])

function show(variant, body, title) {
  const id = nextId++
  toasts.push({ id, variant, title, body, at: Date.now() })
  setTimeout(() => dismiss(id), HIDE_AFTER_MS)
  return id
}

export function dismiss(id) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}

/** The one line an API error has for people: FastAPI's detail, else the HTTP/axios message. */
export const errorText = (e) => e?.response?.data?.detail || e?.message || String(e)

export const toast = {
  success: (body, title = 'Done') => show('success', body, title),
  error: (body, title = 'Failed') => show('danger', body, title),
  info: (body, title = 'Note') => show('info', body, title),

  /**
   * Run an action and toast its outcome. `label` names it for people ("Stop pod");
   * `ok` is the success line (default "<label> done"). Returns `{ ok: true, value }` or
   * `{ ok: false, error }`: a void action is still a success. The failure is toasted and
   * passed to `onError` if given, so a modal can also show it inline.
   */
  async run(label, action, { ok, onError } = {}) {
    try {
      const value = await action()
      toast.success(ok || `${label} done`)
      return { ok: true, value }
    } catch (e) {
      const text = `${label} failed: ${errorText(e)}`
      toast.error(text)
      onError?.(text, e)
      return { ok: false, error: e }
    }
  },
}
