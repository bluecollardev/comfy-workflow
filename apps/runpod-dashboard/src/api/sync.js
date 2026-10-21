import { core } from './bridge'

/** Sync runs in the app (the core spawns rsync in the main process); a plain browser build has no such thing. */
export const syncAPI = core?.sync
  ? { available: true, plan: (req) => core.sync.plan(req), start: (req) => core.sync.start(req), cancel: (id) => core.sync.cancel(id), state: (id) => core.sync.state(id), onEvent: (cb) => core.sync.onEvent(cb) }
  : { available: false, plan: async () => ({ steps: [], transport: { kind: 'none', reason: '' } }), start: async () => ({ ok: false }), cancel: async () => ({ ok: true }), state: async () => ({ running: false, events: [] }), onEvent: () => () => {} }
