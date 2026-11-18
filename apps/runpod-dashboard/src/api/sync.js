import { core } from './bridge'

/** Sync runs in the app (the core spawns rsync in the main process); a plain browser build has no such thing. */
// `window.__e2eSync` is a seam for the browser tests (e2e/sync-capacity.spec.js): a stand-in for core.sync, since the page treats a present `window.core` as the whole app.
const impl = core?.sync || (typeof window !== 'undefined' ? window.__e2eSync : null)
export const syncAPI = impl
  ? { available: true, plan: (req) => impl.plan(req), count: (req) => impl.count(req), start: (req) => impl.start(req), cancel: (id) => impl.cancel(id), state: (id) => impl.state(id), onEvent: (cb) => impl.onEvent(cb),
      // a core older than v1.5.0 has no folders/measure: the Leave out section hides quietly
      folders: async (req) => { if (!impl.folders) return { old: true, steps: [] }; try { return (await impl.folders(req)) || { steps: [] } } catch (e) { if (/no core call/i.test(String(e?.message || e))) return { old: true, steps: [] }; throw e } },
      measure: (req) => impl.measure(req), measureCancel: (id) => (impl.measureCancel ? impl.measureCancel(id) : Promise.resolve()) }
  : { available: false, plan: async () => ({ steps: [], transport: { kind: 'none', reason: '' }, shared: null }), count: async () => ({ all: {} }), start: async () => ({ ok: false }), cancel: async () => ({ ok: true }), state: async () => ({ running: false, events: [] }), onEvent: () => () => {} }
