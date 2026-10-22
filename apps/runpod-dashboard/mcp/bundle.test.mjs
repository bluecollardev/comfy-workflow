// The esbuild bundles (mcp/dist/server.cjs, comfy-bridge.cjs; `npm run mcp:bundle`) run alone: copied into a
// scratch folder laid out like the packaged app's resources/ (mcp/, core/, backend/) with no node_modules
// anywhere near, started with plain node (the app's executable does the same with ELECTRON_RUN_AS_NODE=1),
// and driven over stdio: initialize + tools/list. The SDK is inlined; the core is found beside them (../core).
// Run: npm run mcp:test (bundles first) or node --test mcp/bundle.test.mjs after npm run mcp:bundle.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(APP, '..', '..')
const root = mkdtempSync(join(tmpdir(), 'runpod-mcp-bundle-'))
const resources = join(root, 'resources')

before(() => {
  for (const f of ['server.cjs', 'comfy-bridge.cjs']) assert.ok(existsSync(join(APP, 'mcp', 'dist', f)), `${f} is not built: npm run mcp:bundle`)
  mkdirSync(join(resources, 'mcp'), { recursive: true })
  cpSync(join(APP, 'mcp', 'dist'), join(resources, 'mcp'), { recursive: true })
  cpSync(join(APP, 'libs', 'core', 'dist'), join(resources, 'core'), { recursive: true })
  mkdirSync(join(resources, 'backend'), { recursive: true })
  cpSync(join(REPO, 'shared', 'shapes', 'mount-points.json'), join(resources, 'backend', 'mount-points.json'))
  cpSync(join(REPO, 'shared', 'governance'), join(resources, 'backend', 'governance'), { recursive: true })
})
after(() => rmSync(root, { recursive: true, force: true }))

/** initialize + tools/list against a bundle over stdio. */
function ask(file, args = []) {
  return new Promise((resolveAnswer, reject) => {
    const env = { ...process.env, RUNPOD_DRY_RUN: '1', POD_MANAGER_CONFIG_DIR: join(root, 'config'), RUNPOD_API_KEY: '', NODE_PATH: '' }
    delete env.CORE_DIR; delete env.GOVERNANCE_DIR; delete env.MOUNT_POINTS_FILE
    const child = spawn(process.execPath, [join(resources, 'mcp', file), ...args], { env, cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
    const stderr = []
    const pending = new Map()
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no answer from ${file}: ${stderr.join('\n')}`)) }, 20_000)
    createInterface({ input: child.stderr }).on('line', (l) => stderr.push(l))
    createInterface({ input: child.stdout }).on('line', (line) => { const m = JSON.parse(line); if (m.id != null) pending.get(m.id)?.(m) })
    const rpc = (id, method, params = {}) => new Promise((r) => { pending.set(id, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
    ;(async () => {
      const init = await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n')
      const list = await rpc(2, 'tools/list')
      clearTimeout(timer); child.kill()
      resolveAnswer({ init, list, stderr })
    })().catch(reject)
  })
}

test('server.cjs: alone, with the SDK inlined, lists the pod manager\'s tools and hands over the governance', async () => {
  const { init, list } = await ask('server.cjs')
  assert.equal(init.result.serverInfo.name, 'comfy-moe-server')
  assert.match(init.result.instructions, /^# Governance \(applied to this session\)/)   // the governance copy was found at ../backend
  const names = list.result.tools.map((t) => t.name)
  for (const n of ['list_agents', 'list_pods', 'create_pod', 'sync', 'sync_status', 'cost_now']) assert.ok(names.includes(n), n)
  assert.ok(names.length >= 29, `${names.length} tools`)
})

test('comfy-bridge.cjs: alone, lists the bridge\'s tools', async () => {
  const { init, list } = await ask('comfy-bridge.cjs', ['--comfy', 'http://127.0.0.1:9'])
  assert.equal(init.result.serverInfo.name, 'comfy-bridge')
  const names = list.result.tools.map((t) => t.name)
  for (const n of ['comfy_status', 'queue_prompt', 'get_queue']) assert.ok(names.includes(n), n)
  assert.equal(names.length, 37)
})
