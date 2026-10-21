// One transport helper for both MCP servers (server.mjs, comfy-bridge.mjs): stdio by default, what Claude
// Code launches; or, with `--http <port>` (or MCP_HTTP_PORT), the SDK's Streamable HTTP transport on
// 127.0.0.1:<port> at /mcp, for clients that only take remote MCP (ChatGPT, through a tunnel to this
// machine). Loopback only: the Host header must be 127.0.0.1:<port> or localhost:<port>, so a page in a
// browser cannot reach it by another name. Port 0 takes a free one (the tests), and the banner names it.
//
// Over HTTP every request gets its own SDK server and transport, the SDK's stateless mode: no session is
// kept between calls, any client can connect at any time, and the state that matters (the pod manager's
// sync jobs, the bridge's target) lives in the module, not in the session.
import { createServer } from 'node:http'
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
      console.error(`HTTP transport: ${e?.message || e}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: e?.message || String(e) }, id: null }))
      }
    }
  })
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', resolve) })
  const bound = http.address().port
  hosts.push(`127.0.0.1:${bound}`, `localhost:${bound}`)
  const url = `http://127.0.0.1:${bound}${MCP_PATH}`
  return { kind: 'http', port: bound, url, text: `${url} (Streamable HTTP, loopback only)`, close: () => new Promise((r) => http.close(r)) }
}
