// One transport helper for both MCP servers (server.mjs, comfy-bridge.mjs): stdio by default, what Claude
// Code launches; or, with `--http <port>` (or MCP_HTTP_PORT), the SDK's Streamable HTTP transport on
// 127.0.0.1:<port> at /mcp, for clients that only take remote MCP (ChatGPT, through a tunnel to this
// machine). Loopback only: the Host header must be 127.0.0.1:<port> or localhost:<port>, so a page in a
// browser cannot reach it by another name. Port 0 takes a free one (the tests), and the banner names it.
//
// Over HTTP every request gets its own SDK server and transport, the SDK's stateless mode: no session is
// kept between calls, any client can connect at any time, and the state that matters (the pod manager's
// sync jobs, the bridge's target) lives in the module, not in the session.
import { existsSync, realpathSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

export const MCP_PATH = '/mcp'

/** `--http <port>` from argv, else MCP_HTTP_PORT; null means stdio. */
export function httpPort(argv = process.argv.slice(2), env = process.env) {
  const i = argv.indexOf('--http')
  const raw = i >= 0 ? argv[i + 1] : env.MCP_HTTP_PORT
  if (raw == null || raw === '') return null
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--http takes a port number, not ${JSON.stringify(raw)}`)
  return port
}

/** Serve `makeServer()` (a fresh SDK Server per call) over stdio, or over HTTP when a port is given.
 *  Resolves with what to print in the banner (`text`) and, over HTTP, the bound port, the URL and `close()`. */
export async function serve(makeServer, { port = httpPort() } = {}) {
  if (port == null) {
    await makeServer().connect(new StdioServerTransport())
    return { kind: 'stdio', text: 'stdio' }
  }
  const h = await startHttp(makeServer, { port })
  return { kind: 'http', ...h, text: `${h.url} (Streamable HTTP, loopback only)` }
}

/** The HTTP side alone, for a host that is not a command line (the app serves both endpoints from its main
 *  process, electron/mcp-host.cjs): 127.0.0.1:<port>/mcp, stateless, DNS-rebinding protection on. Resolves
 *  with { port, url, close() }; a busy port rejects with the listen error (EADDRINUSE). */
export async function startHttp(makeServer, { port = 0, onError = (m) => console.error(m) } = {}) {
  const hosts = []
  const http = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end(`MCP is served at ${MCP_PATH}\n`)
      return
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, enableDnsRebindingProtection: true, allowedHosts: hosts })
    const server = makeServer()
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}) })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (e) {
      onError(`HTTP transport: ${e?.message || e}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: e?.message || String(e) }, id: null }))
      }
    }
  })
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', resolve) })
  const bound = http.address().port
  hosts.push(`127.0.0.1:${bound}`, `localhost:${bound}`)
  return { port: bound, url: `http://127.0.0.1:${bound}${MCP_PATH}`, close: () => new Promise((r) => { http.close(r); http.closeAllConnections?.() }) }
}

/** Is this module the program being run (stdio / --http), rather than imported for its factory? From source,
 *  the entry compares its import.meta.url with argv[1]; in the esbuild bundle (define __MCP_BUNDLE__) it is
 *  `require.main === module`. */
export function isMain(metaUrl) {
  // eslint-disable-next-line no-undef
  if (typeof __MCP_BUNDLE__ !== 'undefined') return typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module
  try { return !!process.argv[1] && metaUrl === pathToFileURL(realpathSync(process.argv[1])).href } catch { return false }
}

/** The core, loaded by absolute path at run time (it is ESM and lives outside the bundle). CORE_DIR wins;
 *  else, relative to the running file: the app's resources (`../core`, packaged), a checkout's
 *  libs/core/dist (`../libs/core/dist` from mcp/, `../../libs/core/dist` from mcp/dist/). */
export async function loadCore() {
  const entry = process.argv[1] ? dirname(realpathSync(process.argv[1])) : process.cwd()
  const candidates = [process.env.CORE_DIR, join(entry, '..', 'core'), join(entry, '..', 'libs', 'core', 'dist'), join(entry, '..', '..', 'libs', 'core', 'dist')].filter(Boolean)
  const dir = candidates.find((d) => existsSync(join(d, 'index.js')))
  if (!dir) {
    console.error(`The core is not built (looked in ${candidates.join(', ')}). Run: cd apps/runpod-dashboard && npm run core:build`)
    process.exit(2)
  }
  return import(pathToFileURL(join(dir, 'index.js')).href)
}
