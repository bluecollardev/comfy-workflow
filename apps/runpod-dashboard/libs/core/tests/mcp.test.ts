import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as mcp from '../src/mcp.js'
import * as mounts from '../src/mounts.js'
import { APP_DIR } from '../src/paths.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); delete process.env.MCP_DIR; delete process.env.MCP_EXEC })

const SERVER = join(APP_DIR, 'mcp', 'dist', 'server.cjs')
const BRIDGE = join(APP_DIR, 'mcp', 'dist', 'comfy-bridge.cjs')
const EXE = '/Applications/RunPod Manager.app/Contents/MacOS/RunPod Manager'   // the packaged app's executable
const QEXE = `'${EXE}'`
const RUN_AS_NODE = { ELECTRON_RUN_AS_NODE: '1' }

describe('the two endpoints', () => {
  beforeEach(() => { process.env.MCP_EXEC = EXE })

  it('are the pod manager and the ComfyUI bridge, with absolute bundle paths under the app and the app\'s executable as Node', () => {
    const [pm, br] = mcp.endpoints()
    expect(pm).toMatchObject({ id: 'pod-manager', name: 'pod-manager', title: 'Pod manager', program: SERVER, exists: existsSync(SERVER), bundle_command: 'npm run mcp:bundle', executable: EXE, args: [], command: [EXE, SERVER], env: RUN_AS_NODE, command_line: `ELECTRON_RUN_AS_NODE=1 ${QEXE} ${SERVER}`, target: null, http_port: 8765, http_url: 'http://127.0.0.1:8765/mcp' })
    expect(br).toMatchObject({ id: 'comfy-bridge', name: 'comfy-bridge', title: 'ComfyUI bridge', program: BRIDGE, args: [], target: null, http_port: 8766, http_url: 'http://127.0.0.1:8766/mcp' })
    expect(pm.purpose).toMatch(/RunPod/); expect(br.purpose).toMatch(/ComfyUI/)
    expect(Object.keys(pm.clients).sort()).toEqual(['chatgpt', 'claude_code', 'claude_desktop', 'codex', 'remote'])
    expect(pm.http).toEqual({ enabled: false, port: 8765, running: false, error: null, url: 'http://127.0.0.1:8765/mcp' })
  })

  it('the pod manager\'s client snippets run the app\'s executable as Node: no Node install', () => {
    const { clients } = mcp.endpoints()[0]
    expect(clients.claude_code).toBe(`claude mcp add pod-manager -e ELECTRON_RUN_AS_NODE=1 -- ${QEXE} ${SERVER}`)
    expect(JSON.parse(clients.claude_desktop)).toEqual({ mcpServers: { 'pod-manager': { command: EXE, args: [SERVER], env: RUN_AS_NODE } } })
    expect(clients.codex).toBe(`[mcp_servers.pod-manager]\ncommand = ${JSON.stringify(EXE)}\nargs = ["${SERVER}"]\n\n[mcp_servers.pod-manager.env]\nELECTRON_RUN_AS_NODE = "1"`)
    expect(JSON.stringify(clients)).not.toMatch(/\bnode\b/)
  })

  it('Remote and ChatGPT show the in-app URL when its switch is on, and nothing when it is off', () => {
    expect(mcp.endpoints()[0].clients).toMatchObject({ remote: '', chatgpt: '' })
    mcp.setServe('pod-manager', true, 9100)
    const [pm, br] = mcp.endpoints({ served: { 'pod-manager': { running: true } } })
    expect(pm.clients.remote).toBe('http://127.0.0.1:9100/mcp'); expect(pm.clients.chatgpt).toBe('http://127.0.0.1:9100/mcp')
    expect(pm).toMatchObject({ http_port: 9100, http_url: 'http://127.0.0.1:9100/mcp', http: { enabled: true, port: 9100, running: true, error: null } })
    expect(br.clients.remote).toBe(''); expect(br.http.enabled).toBe(false)
    expect(mounts.load().mcp_http['pod-manager']).toEqual({ enabled: true, port: 9100 })
    mcp.setServe('pod-manager', false)
    expect(mcp.endpoints()[0].clients.remote).toBe(''); expect(mcp.endpoints()[0].http_port).toBe(9100)   // the port is kept
    expect(() => mcp.setServe('pod-manager', true, 80)).toThrow(/port/)
    expect(() => mcp.setServe('nope' as never, true)).toThrow(/No MCP endpoint/)
  })

  it('the bridge carries the target URL into its command and every snippet', () => {
    const br = mcp.endpoints({ comfy: ' https://pod1-8188.proxy.runpod.net ' })[1]
    expect(br.target).toBe('https://pod1-8188.proxy.runpod.net')
    expect(br.args).toEqual(['--comfy', 'https://pod1-8188.proxy.runpod.net'])
    expect(br.command_line).toBe(`ELECTRON_RUN_AS_NODE=1 ${QEXE} ${BRIDGE} --comfy https://pod1-8188.proxy.runpod.net`)
    expect(br.clients.claude_code).toBe(`claude mcp add comfy-bridge -e ELECTRON_RUN_AS_NODE=1 -- ${QEXE} ${BRIDGE} --comfy https://pod1-8188.proxy.runpod.net`)
    expect(JSON.parse(br.clients.claude_desktop)).toEqual({ mcpServers: { 'comfy-bridge': { command: EXE, args: [BRIDGE, '--comfy', 'https://pod1-8188.proxy.runpod.net'], env: RUN_AS_NODE } } })
    expect(br.clients.codex).toContain(`args = ["${BRIDGE}", "--comfy", "https://pod1-8188.proxy.runpod.net"]`)
    expect(mcp.endpoints({ comfy: '' })[1].args).toEqual([])   // no target: the bridge picks the first running pod itself
  })

  it('quotes a program path with spaces on the shell lines only; MCP_EXEC and MCP_DIR move the pieces', () => {
    process.env.MCP_DIR = join(dir, 'my app', 'mcp'); process.env.MCP_EXEC = '/usr/local/bin/electron'
    const pm = mcp.endpoints()[0]
    const program = join(process.env.MCP_DIR, 'server.cjs')
    expect(pm.command_line).toBe(`ELECTRON_RUN_AS_NODE=1 /usr/local/bin/electron '${program}'`)
    expect(pm.clients.claude_code).toBe(`claude mcp add pod-manager -e ELECTRON_RUN_AS_NODE=1 -- /usr/local/bin/electron '${program}'`)
    expect(JSON.parse(pm.clients.claude_desktop).mcpServers['pod-manager'].args).toEqual([program])
    expect(pm.exists).toBe(false)
  })
})

describe('targets', () => {
  const fetchFn = (local: boolean, podsAnswer: Record<string, boolean>) => (async (url: string) => {
    if (url.startsWith('http://127.0.0.1:8188')) return new Response(local ? '{}' : 'nope', { status: local ? 200 : 502 })
    for (const [id, ok] of Object.entries(podsAnswer)) if (url.startsWith(`https://${id}-8188.proxy.runpod.net`)) return new Response('', { status: ok ? 200 : 502 })
    if (url.includes('/graphql')) return new Response(JSON.stringify({ data: { myself: { pods: [
      { id: 'p1', name: 'Dev', desiredStatus: 'RUNNING', runtime: { uptimeInSeconds: 100 }, ports: '8188/http,22/tcp' },
      { id: 'p2', name: 'Booting', desiredStatus: 'RUNNING', runtime: { uptimeInSeconds: 5 }, ports: '8188/http,22/tcp' },
      { id: 'p3', name: 'Off', desiredStatus: 'EXITED', runtime: null },
    ] } } }))
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch

  it('are the running pods whose ComfyUI answers, and the Mac\'s own install when it does', async () => {
    mounts.save(mounts.defaults())
    expect(await mcp.targets({ fetchFn: fetchFn(true, { p1: true, p2: false }), apiKey: 'k' })).toEqual([
      { pod_id: 'p1', name: 'Dev', url: 'https://p1-8188.proxy.runpod.net' },
      { pod_id: null, name: 'This Mac', url: 'http://127.0.0.1:8188' },
    ])
    expect(await mcp.targets({ fetchFn: fetchFn(false, { p1: false, p2: false }), apiKey: 'k' })).toEqual([])
  })

  it('still answers the Mac\'s own install when RunPod cannot be asked', async () => {
    mounts.save(mounts.defaults())
    const f = (async (url: string) => (url.startsWith('http://127.0.0.1:8188') ? new Response('{}') : Promise.reject(new Error('offline')))) as unknown as typeof fetch
    expect(await mcp.targets({ fetchFn: f })).toEqual([{ pod_id: null, name: 'This Mac', url: 'http://127.0.0.1:8188' }])
  })
})

describe('probe (Check)', () => {
  const FAKE = `
const { createInterface } = require('node:readline')
const rl = createInterface({ input: process.stdin })
const mode = process.argv.includes('--comfy') ? process.argv[process.argv.indexOf('--comfy') + 1] : 'ok'
if (mode === 'crash') { console.error('boom: no ComfyUI at that URL; RUNPOD_DRY_RUN=' + (process.env.RUNPOD_DRY_RUN || '')); process.exit(2) }
rl.on('line', (line) => {
  const m = JSON.parse(line)
  if (m.id == null) return
  if (mode === 'hang') return
  if (m.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } } }) + '\\n')
  else if (m.method === 'tools/list') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'alpha', description: '[g] Alpha.', inputSchema: { type: 'object', properties: { n: { type: 'integer', default: 3 } }, required: ['n'] } }, { name: 'beta' }] } }) + '\\n')
  else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no ' + m.method } }) + '\\n')
})
console.error('fake server up; RUNPOD_DRY_RUN=' + (process.env.RUNPOD_DRY_RUN || ''))
`
  beforeEach(() => {
    delete process.env.RUNPOD_DRY_RUN
    process.env.MCP_DIR = join(dir, 'mcp')
    mkdirSync(process.env.MCP_DIR, { recursive: true })
    writeFileSync(join(process.env.MCP_DIR, 'server.cjs'), FAKE)
    writeFileSync(join(process.env.MCP_DIR, 'comfy-bridge.cjs'), FAKE)
  })

  it('initializes, lists the tools and reports the time', async () => {
    mounts.save(mounts.defaults())
    const r = await mcp.probe('pod-manager')
    expect(r).toMatchObject({ ok: true, tools: ['alpha', 'beta'], error: null })
    expect(r.ms).toBeGreaterThanOrEqual(0)
    expect(r.definitions).toEqual([
      { name: 'alpha', description: '[g] Alpha.', inputSchema: { type: 'object', properties: { n: { type: 'integer', default: 3 } }, required: ['n'] } },
      { name: 'beta', description: '', inputSchema: {} },
    ])
  })

  it('passes the bridge its target, and reports a server that dies with its last words', async () => {
    mounts.save(mounts.defaults())
    expect(await mcp.probe('comfy-bridge', { comfy: 'ok' })).toMatchObject({ ok: true, tools: ['alpha', 'beta'] })
    const r = await mcp.probe('comfy-bridge', { comfy: 'crash' })
    expect(r.ok).toBe(false); expect(r.tools).toEqual([]); expect(r.definitions).toEqual([])
    expect(r.error).toMatch(/exited \(code 2\)/); expect(r.error).toMatch(/boom: no ComfyUI/)
  })

  it('gives up after the timeout, and says when the program is not built', async () => {
    mounts.save(mounts.defaults())
    const r = await mcp.probe('comfy-bridge', { comfy: 'hang', timeoutMs: 300 })
    expect(r.ok).toBe(false); expect(r.error).toMatch(/No answer in 0 s/)
    process.env.MCP_DIR = join(dir, 'nowhere')
    expect(await mcp.probe('pod-manager')).toMatchObject({ ok: false, tools: [], error: `Not built yet: ${join(dir, 'nowhere', 'server.cjs')} (npm run mcp:bundle)`, ms: 0 })
    await expect(mcp.probe('nope' as never)).rejects.toThrow(/No MCP endpoint nope/)
  })

  it('tells the server it is no-spend mode when the configuration says so, and only then', async () => {
    mounts.save(mounts.defaults())
    expect((await mcp.probe('comfy-bridge', { comfy: 'crash' })).error).toMatch(/RUNPOD_DRY_RUN=$/m)
    const cfg = mounts.defaults(); cfg.dry_run = true; mounts.save(cfg)
    expect((await mcp.probe('comfy-bridge', { comfy: 'crash' })).error).toMatch(/RUNPOD_DRY_RUN=1$/m)
  })
})

describe('probeHttp (Check on an endpoint the app serves)', () => {
  const serve = (handler: (body: { id: number; method: string }) => unknown) => new Promise<{ url: string; close: () => void }>((resolve) => {
    const srv = createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => {
        const out = handler(JSON.parse(b))
        res.writeHead(typeof out === 'number' ? out : 200, { 'Content-Type': 'application/json' }); res.end(typeof out === 'number' ? 'nope' : JSON.stringify(out))
      })
    }).listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/mcp`, close: () => srv.close() }))
  })

  it('does initialize and tools/list over HTTP and reports the tools', async () => {
    const s = await serve((m) => (m.method === 'initialize' ? { jsonrpc: '2.0', id: m.id, result: { serverInfo: { name: 'x' } } } : { jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'alpha', description: 'A' }] } }))
    try {
      expect(await mcp.probeHttp(s.url)).toMatchObject({ ok: true, tools: ['alpha'], definitions: [{ name: 'alpha', description: 'A', inputSchema: {} }], error: null })
      mounts.save(mounts.defaults())
      expect(await mcp.probe('pod-manager', { http: s.url })).toMatchObject({ ok: true, tools: ['alpha'] })   // an in-app endpoint is asked over HTTP, no program needed
    } finally { s.close() }
  })

  it('reports an HTTP error or a refused connection', async () => {
    const s = await serve(() => 403)
    try { expect(await mcp.probeHttp(s.url)).toMatchObject({ ok: false, error: expect.stringMatching(/HTTP 403/) }) } finally { s.close() }
    expect((await mcp.probeHttp('http://127.0.0.1:9/mcp', 2000)).ok).toBe(false)
  })
})
