// The MCP servers hosted inside the app (electron/mcp-host.cjs) in a plain node process with a fake core: the
// factories (createPodManagerServer, createComfyBridgeServer) served over Streamable HTTP on 127.0.0.1, the
// shared sync runner (electron/sync-jobs.cjs) that the cards also use, DNS-rebinding protection, stopping,
// and a port that is taken. Run twice: from the .mjs sources (a checkout) and from the esbuild bundles
// (the packaged app). Run: npm run mcp:test, or node --test mcp/host.test.mjs after npm run mcp:bundle.
import assert from 'node:assert/strict'
import { request, createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { createMcpHost } = require('../electron/mcp-host.cjs')
const { createSyncJobs } = require('../electron/sync-jobs.cjs')

const POD = { id: 'pod-1', name: 'ComfyUI-Dev', status: 'running', gpu: 'rtx4090', web_ui_url: null, comfy_ready: false }

/** Just enough of the core for the pod manager's tools used here. */
function fakeCore(events) {
  return {
    governance: { SPEND_CAP_USD: 100, instructions: () => '# Governance (fake)', listing: () => [], read: () => null, uriToName: (u) => u, folder: () => null },
    pool: { GPU_TYPES: ['auto', 'rtx4090'], dryRun: () => false },
    gpus: { DEFAULT_GPU: 'rtx4090' },
    mounts: { load: () => ({ folders: {}, mcp_http: {} }), dryRun: () => false },
    shots: { lockedShots: () => ({ file: null, shots: new Set(), found: false }), lockedIn: () => null },
    volumes: { list: async () => [] },
    pods: {
      list: async () => [POD], config: () => null,
      get: async (id) => { if (id !== POD.id) throw Object.assign(new Error(`Pod not found: ${id}`), { status: 404 }); return POD },
    },
    syncrun: {
      planFor: (req) => [{ key: 'project' }, { key: 'comfy-shared' }],
      transportFor: async () => ({ kind: 'ssh', reason: 'fake' }),
      run: (req, send, signal) => new Promise((res) => {
        send({ kind: 'plan', steps: [{ key: 'project' }, { key: 'comfy-shared' }] })
        send({ kind: 'step', key: 'project' }); send({ kind: 'step-done', key: 'project', code: 0 })
        send({ kind: 'step', key: 'comfy-shared' })
        const finish = () => { send({ kind: 'step-done', key: 'comfy-shared', code: 0 }); send({ kind: 'done', text: 'fake done' }); res({ ok: true }) }
        if (events.hold) events.release = finish; else setTimeout(finish, 20)
      }),
    },
  }
}

const post = (url, body, headers = {}) => new Promise((resolveReq, reject) => {
  const u = new URL(url)
  const payload = JSON.stringify(body)
  const req = request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(payload), ...headers } }, (res) => {
    let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c }); res.on('end', () => resolveReq({ status: res.statusCode, body: b }))
  })
  req.on('error', reject); req.end(payload)
})
const rpc = async (url, method, params = {}) => {
  const r = await post(url, { jsonrpc: '2.0', id: 1, method, params })
  assert.equal(r.status, 200, r.body)
  return JSON.parse(r.body)
}
const callText = async (url, name, args = {}) => (await rpc(url, 'tools/call', { name, arguments: args })).result.content.map((c) => c.text).join('\n')
const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }

for (const bundled of [false, true]) {
  test(`hosted in a process (${bundled ? 'esbuild bundles' : '.mjs sources'}): both endpoints, the shared sync runner, rebinding protection, stop`, async () => {
    const broadcast = []
    const events = {}
    const core = fakeCore(events)
    const syncJobs = createSyncJobs({ loadCore: async () => core, broadcast: (p) => broadcast.push(p), keepMs: 60_000 })
    const config = { 'pod-manager': { enabled: true, port: 0 }, 'comfy-bridge': { enabled: true, port: 0 } }
    const host = createMcpHost({ loadCore: async () => core, syncJobs, mcpDir: join(APP, 'mcp', 'dist'), preferBundle: bundled, log: () => {} })
    const st = await host.apply(config)
    try {
      assert.ok(st['pod-manager'].running && st['comfy-bridge'].running, JSON.stringify(st))
      const pm = st['pod-manager'].url
      assert.match(pm, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)

      // initialize + tools/list + a call, stateless: no session id kept
      const init = await rpc(pm, 'initialize', INIT)
      assert.equal(init.result.serverInfo.name, 'comfy-moe-server')
      assert.match(init.result.instructions, /Governance \(fake\)/)
      const names = (await rpc(pm, 'tools/list')).result.tools.map((t) => t.name)
      for (const n of ['list_pods', 'sync', 'sync_status']) assert.ok(names.includes(n), n)
      assert.match(await callText(pm, 'list_pods'), /ComfyUI-Dev/)

      // the sync runs in the app's runner: the cards' events are broadcast, and the SAME job is in syncJobs
      events.hold = true
      const started = JSON.parse(await callText(pm, 'sync', { pod_id: 'pod-1' }))
      assert.equal(started.follow, 'sync_status')
      assert.ok(syncJobs.get('pod-1') && !syncJobs.get('pod-1').done)
      assert.ok(broadcast.some((e) => e.id === 'pod-1' && e.kind === 'plan'), 'the plan reached the windows')
      assert.deepEqual(syncJobs.state('pod-1').running, true)
      let status = JSON.parse(await callText(pm, 'sync_status', { pod_id: 'pod-1' }))
      assert.equal(status.running, true); assert.equal(status.of, 2); assert.equal(status.folder, 2)
      assert.match(await callText(pm, 'sync', { pod_id: 'pod-1' }), /already running/)   // one per pod, whoever started it
      // a sync started by a card (IPC) is followed by sync_status too
      assert.equal((await syncJobs.start({ pod_id: 'pod-1', direction: 'push' })).ok, false)
      events.release()
      for (let i = 0; i < 50 && !syncJobs.get('pod-1')?.done; i++) await new Promise((r) => setTimeout(r, 10))
      status = JSON.parse(await callText(pm, 'sync_status', { pod_id: 'pod-1' }))
      assert.equal(status.done, true); assert.equal(status.percent, 100)
      assert.ok(broadcast.some((e) => e.kind === 'result'), 'the result reached the windows')

      // DNS rebinding: a Host that is not 127.0.0.1:<port> / localhost:<port> is refused
      const evil = await post(pm, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Host: 'evil.example:80' })
      assert.equal(evil.status, 403)
      assert.equal((await post(pm.replace('/mcp', '/other'), {})).status, 404)

      // the bridge
      const br = st['comfy-bridge'].url
      assert.equal((await rpc(br, 'initialize', INIT)).result.serverInfo.name, 'comfy-bridge')
      assert.equal((await rpc(br, 'tools/list')).result.tools.length, 37)

      // switching one off stops only it
      const after = await host.apply({ ...config, 'pod-manager': { enabled: false, port: 0 } })
      assert.equal(after['pod-manager'].running, false); assert.equal(after['comfy-bridge'].running, true)
      await assert.rejects(post(pm, {}), /ECONNREFUSED/)
    } finally {
      await host.stop()
    }
  })
}

test('a port that is taken is reported on that endpoint, not thrown, and the other endpoint still serves', async () => {
  const blocker = createServer((_req, res) => res.end('x'))
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r))
  const taken = blocker.address().port
  const core = fakeCore({})
  const host = createMcpHost({ loadCore: async () => core, syncJobs: createSyncJobs({ loadCore: async () => core }), mcpDir: join(APP, 'mcp', 'dist'), log: () => {} })
  try {
    const st = await host.apply({ 'pod-manager': { enabled: true, port: taken }, 'comfy-bridge': { enabled: true, port: 0 } })
    assert.equal(st['pod-manager'].running, false)
    assert.match(st['pod-manager'].error, new RegExp(`Port ${taken} is in use`))
    assert.equal(st['comfy-bridge'].running, true)
  } finally { await host.stop(); blocker.close() }
})
