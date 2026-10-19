// Preload: the one bridge between the page and the core in the main process. The page calls
// window.core.invoke('pods', 'create', [request]) and gets the core's return value, or an Error
// carrying the core's status and message. Nothing else of Node reaches the page.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('core', {
  async invoke(ns, fn, args = []) {
    // Plain data only crosses the bridge: Vue's reactive proxies cannot be structured-cloned.
    let plain
    try { plain = JSON.parse(JSON.stringify(args)) } catch (e) { throw new Error(`${ns}.${fn}: arguments are not plain data: ${e.message}`) }
    let r
    try { r = await ipcRenderer.invoke('core', ns, fn, plain) } catch (e) { console.error(`[bridge] ${ns}.${fn} failed in transit: ${e.message}; args=${JSON.stringify(plain).slice(0, 400)}`); throw e }
    if (r.ok) return r.value
    const e = new Error(r.error.message)
    e.status = r.error.status
    e.response = { status: r.error.status, data: { detail: r.error.message } }   // what the HTTP client shape gives the stores
    throw e
  },
})
