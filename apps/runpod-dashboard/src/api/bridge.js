// The core over IPC when the page runs inside Electron (preload.cjs exposes window.core), nothing
// otherwise: each api module falls back to HTTP against the pod manager API in a browser.
export const core = typeof window !== 'undefined' && window.core ? window.core : null
export const inElectron = () => !!core
