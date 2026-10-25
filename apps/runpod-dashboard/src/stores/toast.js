import { defineStore } from 'pinia'
import { ref } from 'vue'
import { t } from '../i18n'

/**
 * One place for every toast in the app. Components never render toasts themselves: they call
 * `toast.success(...)`, `toast.error(...)`, `toast.info(...)`, or wrap an action in `toast.run(...)`,
 * which reports the outcome either way. ToastHost.vue, mounted once in App.vue, renders the
 * list top right and removes each toast when its time is up. No library orchestrator: plain
 * Bootstrap toast markup, so what is in this list is what is on screen.
 */
export const HIDE_AFTER_MS = 4000
export const ACTION_HIDE_AFTER_MS = 12000

/** The one line an API error has for people: FastAPI's detail, else the HTTP/axios message. */
export const errorText = (e) => e?.response?.data?.detail || e?.message || String(e)

export const useToastStore = defineStore('toast', () => {
  const toasts = ref([])
  let nextId = 1

  function dismiss(id) {
    const i = toasts.value.findIndex((t) => t.id === id)
    if (i >= 0) toasts.value.splice(i, 1)
  }

  /** `action` ({ label, run }) makes the toast clickable ("click here to configure"): it stays up longer, and running it dismisses it. */
  function show(variant, body, title, action = null) {
    const id = nextId++
    toasts.value.push({ id, variant, title, body, action, at: Date.now() })
    setTimeout(() => dismiss(id), action ? ACTION_HIDE_AFTER_MS : HIDE_AFTER_MS)
    return id
  }

  const success = (body, title = t('toast.done')) => show('success', body, title)
  const error = (body, title = t('toast.failed')) => show('danger', body, title)
  const info = (body, title = t('toast.note'), action = null) => show('info', body, title, action)
  const warn = (body, title = t('toast.note'), action = null) => show('warning', body, title, action)

  /**
   * Run an action and toast its outcome. `label` names it for people ("Stop pod");
   * `ok` is the success line (default "<label> done"). Returns `{ ok: true, value }` or
   * `{ ok: false, error }`: a void action is still a success. The failure is toasted and
   * passed to `onError` if given, so a view can also show it inline.
   */
  async function run(label, action, { ok, onError } = {}) {
    try {
      const value = await action()
      success(ok || t('toast.doneDefault', { label }))
      return { ok: true, value }
    } catch (e) {
      const text = t('toast.failedWith', { label, error: errorText(e) })
      error(text)
      onError?.(text, e)
      return { ok: false, error: e }
    }
  }

  return { toasts, show, dismiss, success, error, info, warn, run }
})
