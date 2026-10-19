import { useToast } from 'bootstrap-vue-next'

/**
 * One place for every toast in the app. Components never call bootstrap-vue-next's toast
 * directly: they call `toast.success(...)`, `toast.error(...)`, `toast.info(...)`, or wrap an
 * action in `toast.run(...)`, which reports the outcome either way.
 *
 * bootstrap-vue-next's composable needs a component context and a mounted
 * <BOrchestrator>, so App.vue calls `installToasts()` once in its setup; until then calls
 * are dropped silently (a toast is never worth an exception).
 */
let api = null
export function installToasts() { api = useToast() }

const POSITION = 'top-end'      // top right, under the navbar; never the bottom of the screen
const HIDE_AFTER_MS = 4000

function show(variant, body, title) {
  api?.create({ position: POSITION, modelValue: HIDE_AFTER_MS, variant, title, body })
}

/** The one line an API error has for people: FastAPI's detail, else the HTTP/axios message. */
export const errorText = (e) => e?.response?.data?.detail || e?.message || String(e)

export const toast = {
  success: (body, title = 'Done') => show('success', body, title),
  error: (body, title = 'Failed') => show('danger', body, title),
  info: (body, title = 'Note') => show('info', body, title),

  /**
   * Run an action and toast its outcome. `label` names it for people ("Stop pod");
   * `ok` is the success line (default "<label> done"). Returns the action's value, or
   * `undefined` when it failed; the failure is toasted and passed to `onError` if given,
   * so a modal can also show it inline.
   */
  async run(label, action, { ok, onError } = {}) {
    try {
      const value = await action()
      toast.success(ok || `${label} done`)
      return value
    } catch (e) {
      const text = `${label} failed: ${errorText(e)}`
      toast.error(text)
      onError?.(text, e)
      return undefined
    }
  },
}
