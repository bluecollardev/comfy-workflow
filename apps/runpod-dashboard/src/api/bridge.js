// The core over IPC when the page runs inside Electron (preload.cjs exposes window.core), nothing
// otherwise: each api module falls back to HTTP against the pod manager API in a browser.
//
// Only plain data can cross the context bridge: a Vue reactive proxy (a store's config, a form)
// throws "An object could not be cloned" at the bridge, before any of our code runs. So every
// argument is copied to plain JSON here, on the page side.
const raw = typeof window !== 'undefined' && window.core ? window.core : null
export const core = raw && { invoke: (ns, fn, args = []) => raw.invoke(ns, fn, JSON.parse(JSON.stringify(args))), logs: raw.logs }
export const inElectron = () => !!core
