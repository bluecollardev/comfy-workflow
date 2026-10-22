// The MCP servers served from inside the running app (Connect › MCP, "Serve from the app"): one process, one
// state. Each endpoint the Default Configuration switches on (mcp_http: { <id>: { enabled, port } }) listens on
// 127.0.0.1:<port>/mcp with the SDK's Streamable HTTP transport (stateless per request, DNS-rebinding
// protection with allowedHosts: mcp/transport.mjs startHttp). The servers are the same factories the stdio
// programs use (mcp/server.mjs createPodManagerServer, mcp/comfy-bridge.mjs createComfyBridgeServer), handed
// the app's own core and, for the pod manager, the app's sync jobs (sync-jobs.cjs): a sync started over MCP is
// the card's sync, and the idle watch, the dry-run pods and the configuration are the ones the window shows.
//
// Free of Electron so a plain node process can run it with a fake core (mcp/host.test.mjs).
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const FILES = { 'pod-manager': 'server', 'comfy-bridge': 'comfy-bridge' }
const IDS = Object.keys(FILES)

/**
 * @param {object} o
 * @param {() => Promise<object>} o.loadCore   the core module (the app's own)
 * @param {object} o.syncJobs                  createSyncJobs(): { get, start }
 * @param {string} [o.mcpDir]                  where the bundled .cjs files are (packaged: resources/mcp)
 * @param {boolean} [o.preferBundle]           use the bundles (packaged) rather than the .mjs sources (a checkout)
 * @param {(msg: string) => void} [o.log]
 */
function createMcpHost({ loadCore, syncJobs, mcpDir, preferBundle = false, log = (m) => console.error(m) }) {
  const running = new Map()       // id -> { port, url, close }
  const errors = new Map()        // id -> message of the last failed start
  const bridgeState = {}          // the bridge's discovered target, kept between requests
  let chain = Promise.resolve()   // apply() calls run one after another

  async function loadModule(id) {
    const bundle = mcpDir ? path.join(mcpDir, `${FILES[id]}.cjs`) : null
    if (preferBundle && bundle && fs.existsSync(bundle)) return require(bundle)
    return import(pathToFileURL(path.join(__dirname, '..', 'mcp', `${FILES[id]}.mjs`)).href)
  }

  async function open(id, port) {
    const [core, mod] = await Promise.all([loadCore(), loadModule(id)])
    const make = id === 'pod-manager'
      ? () => mod.createPodManagerServer({ core, syncHost: syncJobs })
      : () => mod.createComfyBridgeServer({ core, target: process.env.COMFY_URL || '', targetFrom: 'COMFY_URL', project: process.env.PROJECT_ROOT || '', state: bridgeState })
    return mod.startHttp(make, { port, onError: log })
  }

  /** Make what is listening match the configuration; resolves with status(). A port that cannot be bound is reported, not thrown. */
  function apply(config) {
    const run = chain.then(async () => {
      const core = await loadCore()
      const want = config || core.mounts.load().mcp_http
      for (const id of IDS) {
        const w = want[id] || { enabled: false, port: 0 }
        const have = running.get(id)
        if (have && (!w.enabled || have.requested !== w.port)) { await have.close().catch(() => {}); running.delete(id); log(`MCP ${id}: stopped serving ${have.url}`) }
        if (w.enabled && !running.has(id)) {
          try {
            const h = await open(id, w.port)
            running.set(id, { ...h, requested: w.port })
            errors.delete(id)
            log(`MCP ${id}: served from the app at ${h.url}`)
          } catch (e) {
            errors.set(id, e?.code === 'EADDRINUSE' ? `Port ${w.port} is in use` : e?.message || String(e))
            log(`MCP ${id}: not served: ${errors.get(id)}`)
          }
        } else if (!w.enabled) errors.delete(id)
      }
      return status()
    })
    chain = run.catch(() => {})
    return run
  }

  /** id -> { running, url, port, error } */
  function status() {
    return Object.fromEntries(IDS.map((id) => {
      const r = running.get(id)
      return [id, { running: !!r, url: r ? r.url : null, port: r ? r.port : null, error: errors.get(id) || null }]
    }))
  }

  async function stop() {
    await chain
    for (const [id, r] of running) { await r.close().catch(() => {}); running.delete(id) }
  }

  return { apply, status, stop }
}

module.exports = { createMcpHost }
