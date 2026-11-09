// Playwright fixtures: an in-memory fake of the pod-manager API, mounted with
// page.route() so specs run without a backend or a RunPod key.
//
//   test('…', async ({ page, api }) => {
//     api.state.pods = []            // shape the world before page.goto()
//     …
//     expect(api.calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/pods' }))
//   })
//
// `api.state.failures['POST /pods']` = 'message' makes that call answer 500 {detail}.

import { test as base, expect } from '@playwright/test'
const POD_VOLUME = { id: 'kceera10qh', name: 'comfy-workspace', datacenter: 'EUR-IS-2' }

// What the pod manager's tools/list answers in the fake: untagged tools grouped by name, an enum, a default,
// a required field, a nested property and a destructive tool (confirm is required).
export const POD_MANAGER_DEFS = [
  { name: 'list_agents', description: 'List all agents in the MOE pool with their status', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_pool_status', description: 'Get detailed status of the entire agent pool', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_agent', description: 'Create a new GPU pod agent for the pool', inputSchema: { type: 'object', properties: {
    agent_name: { type: 'string', description: 'Agent type' },
    gpu_type: { type: 'string', enum: ['auto', 'rtx4090', 'a40'], description: 'GPU type for this agent' },
    storage_gb: { type: 'integer', minimum: 0, maximum: 500, default: 100, description: 'Storage size in GB' },
    approved_by: { type: 'string', description: 'Who said yes to this spend' },
    env: { type: 'object', description: 'Environment', properties: { key: { type: 'string', description: 'Variable name' } } },
    tags: { type: 'array', items: { type: 'string' }, description: 'Labels' },
  }, required: ['agent_name', 'approved_by'] } },
  { name: 'list_pods', description: 'List the pods', inputSchema: { type: 'object', properties: {} } },
  { name: 'delete_pod', description: 'Delete a pod for good', inputSchema: { type: 'object', properties: { pod_id: { type: 'string', description: 'Pod ID' }, confirm: { type: 'boolean', description: 'Must be true' } }, required: ['pod_id', 'confirm'] } },
  { name: 'cost_now', description: 'What the running pods cost per hour', inputSchema: { type: 'object', properties: {} } },
]
export const BRIDGE_DEFS = [
  { name: 'get_queue', description: '[queue] What is running and pending.\nComfyUI: GET /queue', inputSchema: { type: 'object', properties: {} } },
  { name: 'clear_queue', description: '[queue] Clear queue or interrupt.\nComfyUI: POST /queue, POST /interrupt', inputSchema: { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] } },
  { name: 'node_info', description: '[nodes] One node class.\nComfyUI: GET /object_info/{class}', inputSchema: { type: 'object', properties: { class: { type: 'string' } }, required: ['class'] } },
]

export const samplePods = () => [
  {
    id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', status: 'running', datacenter: 'EU-RO-1', gpu: 'RTX 4090', vram: 24, image: 'ghcr.io/example/comfy-app:v26',
    uptime_seconds: 7320, web_ui_url: 'https://pod-a.proxy.runpod.io:8188',
    ssh_command: 'ssh root@pod-a.proxy.runpod.io',
  },
  { id: 'pod-bbbbbbbb', name: 'ComfyUI-Batch', status: 'stopped', datacenter: 'EU-RO-1', gpu: 'A100', vram: 80, ssh_command: 'ssh root@pod-b.proxy.runpod.io' },
  { id: 'pod-cccccccc', name: 'ComfyUI-Test', status: 'starting', datacenter: 'CA-MTL-1', gpu: 'L40S', vram: 48, ssh_command: 'ssh root@pod-c.proxy.runpod.io' },
]

export const sampleRepository = () => ({
  id: 'r1', url: 'https://github.com/me/comfy-nodes', branch: 'main', name: 'me/comfy-nodes', host: 'github.com',
})

export function defaultState() {
  return {
    history: {
      events: [
        { ts: '2026-11-03T10:00:00Z', kind: 'pod', action: 'created', pod_id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', gpu: 'RTX 4090', datacenter: 'EU-RO-1', cost_per_hr: 0.69 },
        { ts: '2026-11-03T12:30:00Z', kind: 'pod', action: 'stopped', pod_id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', gpu: 'RTX 4090', datacenter: 'EU-RO-1', source: 'mcp', tool: 'create_pod', approved_by: 'Lucas' },
        { ts: '2026-11-03T13:00:00Z', kind: 'job', job: 'pull', state: 'done', what: 'round-3', pod_name: 'ComfyUI-Dev', files: 12, bytes: 3145728 },
        { ts: '2026-11-03T13:30:00Z', kind: 'job', job: 'sync', state: 'failed', what: 'ComfyUI-Shared', pod_name: 'ComfyUI-Dev', error: 'rsync: connection reset' },
        { ts: '2026-11-03T14:30:00Z', kind: 'change', area: 'configuration', action: 'saved', what: 'Default Configuration' },
        { ts: '2026-11-03T14:00:00Z', kind: 'change', area: 'volume', action: 'resized', what: 'comfy-workspace', detail: '120 GB to 200 GB', source: 'mcp', tool: 'resize_volume', approved_by: 'Lucas' },
      ],
      spend: { total: 1.73, running_now: 1, sessions: [{ pod_id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', gpu: 'RTX 4090', datacenter: 'EU-RO-1', cost_per_hr: 0.69, from: '2026-11-03T10:00:00Z', to: '2026-11-03T12:30:00Z', hours: 2.5, cost: 1.73 }], by_day: [{ day: '2026-11-03', cost: 1.73, hours: 2.5 }], note: 'Worked out from recorded events; RunPod bills the truth.' },
      runs: { 'pod-aaaaaaaa': [
        { prompt_id: 'abcdef12-3456-7890', status: 'success', started_at: '2026-11-03T11:00:00Z', duration_s: 42.5, cost_estimate: 0.00814, outputs: [{ filename: 'plate_0001.png', type: 'output', subfolder: 'shots' }] },
        { prompt_id: 'fedcba98-7654-3210', status: 'error', started_at: '2026-11-03T11:10:00Z', duration_s: null, cost_estimate: null, outputs: [], error: 'CUDA out of memory',
          messages: [{ type: 'execution_start', ts: '2026-11-03T11:10:00Z', data: { prompt_id: 'fedcba98' } }, { type: 'execution_error', ts: '2026-11-03T11:10:07Z', data: { node_id: '12' } }],
          error_detail: { message: 'CUDA out of memory', node_id: '12', node_type: 'KSampler', exception_type: 'torch.OutOfMemoryError', traceback: ['Traceback (most recent call last):', '  File "execution.py", line 300, in execute', 'torch.OutOfMemoryError: CUDA out of memory'] } },
      ] },
      logs: { 'pod-aaaaaaaa': { truncated: false, entries: [
        { ts: '2026-11-03T11:00:00Z', level: 'info', text: 'Starting server' },
        { ts: '2026-11-03T11:05:00Z', level: 'warning', text: 'xformers not found, falling back' },
        { ts: '2026-11-03T11:10:07Z', level: 'error', text: 'Failed to validate prompt: CUDA out of memory' },
      ] } },
    },
    podConfigs: {},   // per-pod configurations (GET/PUT /pods/:id/config)
    pods: samplePods(),
    accounts: [],
    providers: [
      { id: 'github', label: 'GitHub', host: 'github.com', configured: false },
      { id: 'gitlab', label: 'GitLab', host: 'gitlab.com', configured: false },
    ],
    accountRepos: [],
    repositories: [],
    branches: { default: 'main', branches: ['main', 'dev'] },
    folders: ['pack_a', 'pack_b', 'pack_c', 'shared'],
    imageEnv: [{ key: 'COMFYUI_PORT', value: '8188' }, { key: 'HF_TOKEN', value: '' }],
    imageBuildArgs: [],
    imageEnvSkipped: 0,
    // The mount configuration (GET /mounts): the image every pod boots and the idle default.
    mounts: { config: { image: 'ghcr.io/example/comfy-app:v26', registry_auth_id: '', idle_stop_minutes: 30, sync_parallel: 8, sync_shared: ['input', 'models', 'workflows'], pull_shared: ['output'], network_volume_id: '', mount_path: '/workspace', apply_by_default: true, pull_any_card: true, dry_run: false, folders: { project: '', plates: '', 'comfy-shared': '' }, custom: [], env: {}, links: [], required: {} }, folders: [], links: [], mode: 'dev', require: [], require_source: 'config', stored: false, store: '', local_env: {}, preview: { env: {} }, catalog: {} },
    volumes: {
      vol1: { id: 'vol1', name: 'comfy-workspace', size_gb: 120, datacenter: 'EU-RO-1', cost_per_month: 8.4, s3: true, is_default: false, pods: [{ id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', status: 'running', via: 'runpod' }, { id: 'pod-cccccccc', name: 'ComfyUI-Test', status: 'starting', via: 'config' }] },
      vol2: { id: 'vol2', name: 'scratch', size_gb: 50, datacenter: 'CA-MTL-1', cost_per_month: 3.5, s3: false, is_default: false, pods: [] },
    },
    datacenters: { live: true, datacenters: [{ value: 'EU-RO-1', text: 'EU-RO-1 · RTX 4000 Ada $0.28/h Low, RTX 4090 $0.89/h High · S3', s3: true, cards: [{ key: 'rtx4000ada', name: 'RTX 4000 Ada', vram: 20, price: 0.28, stock: 'Low' }, { key: 'rtx4090', name: 'RTX 4090', vram: 24, price: 0.89, stock: 'High' }] }, { value: 'CA-MTL-1', text: 'CA-MTL-1 · A40 $0.35/h High', s3: false, cards: [{ key: 'a40', name: 'A40', vram: 48, price: 0.35, stock: 'High' }, { key: 'rtx5090', name: 'RTX 5090', vram: 32, price: 0.69, stock: 'Low', available: true, runs: true, cuda: 13 }] }, { value: 'US-KS-2', text: 'US-KS-2 · none of our cards in stock · S3', s3: true, cards: [] }] },
    gpus: { default: 'auto', live: true, gpus: [{ value: 'auto', text: 'Cheapest card in stock (16-24 GB)', in_stock: true }, { value: 'a4000', text: 'RTX A4000 (16 GB) · none in stock', in_stock: false }, { value: 'rtx4090', text: 'RTX 4090 (24 GB) · $0.34/h · Low stock', in_stock: true, price: 0.34, stock: 'Low' }] },
    // The folder browser (GET /fs/dirs): a tiny disk.
    fs: { '/Users/lucas': ['ComfyUI-Shared', 'Projects'], '/Users/lucas/Projects': ['CANALV2', 'plates'], '/Users/lucas/Projects/CANALV2': ['00_POLICY', '04_TRACKER'] },
    settings: { runpod_api_key_set: true, runpod_api_key_hint: '••••AAAA', source: '/home/me/.config/runpod-pod-manager/.env', s3_keys_set: false, s3_access_key_hint: '' },   // most specs start with a key; the gate spec clears it
    logs: {},   // pod id -> lines for GET /pods/:id/logs
    // The Connect › MCP tab: where the two programs live, what the bridge can point at, and what Check answers per endpoint.
    mcp: {
      dir: '/Users/lucas/Workspaces/comfy_workflow/apps/runpod-dashboard/mcp/dist',
      exe: '/Applications/RunPod Manager.app/Contents/MacOS/RunPod Manager',   // the app's own executable: the program of every snippet
      http: { 'pod-manager': { enabled: false, port: 8765 }, 'comfy-bridge': { enabled: false, port: 8766 } },   // mcp_http in the Default Configuration; the fake host listens whenever it is enabled
      failServe: null,   // an error message the next switch-on is refused with (a port in use)
      targets: [{ pod_id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', url: 'https://pod-aaaaaaaa-8188.proxy.runpod.net' }, { pod_id: null, name: 'This Mac', url: 'http://127.0.0.1:8188' }],
      delay: 0,   // ms the fake probe waits before it answers (to see the probing state)
      probe: {
        'pod-manager': { ok: true, tools: POD_MANAGER_DEFS.map((d) => d.name), definitions: POD_MANAGER_DEFS, error: null, ms: 120 },
        'comfy-bridge': { ok: false, tools: [], definitions: [], error: 'The server exited (code 2) before answering\nNo ComfyUI answers at https://pod-aaaaaaaa-8188.proxy.runpod.net', ms: 340 },
      },
    },
    // The Import Shot Pack modal (docs/ADR-008): the adapters, the plan each known folder gets, and what applying says.
    imports: {
      adapters: [
        { id: 'comfy-shared', name: 'A ComfyUI-Shared folder', version: 1, builtin: true, sha256: 'a'.repeat(64), file: '' },
        { id: 'panama-imax-redux', name: 'Panama Canal v2 delivery package', version: 1, builtin: true, sha256: 'b'.repeat(64), file: '' },
        { id: 'agent-made', name: 'Agent made', version: 1, builtin: false, sha256: 'c'.repeat(64), file: '/home/me/.config/runpod-pod-manager/adapters/agent-made.mjs' },
      ],
      sources: {
        'comfy-shared': "/**\n * What it does: maps a package folder onto ComfyUI-Shared. Detects: its telltale files. Maps: input to input, workflows to workflows.\n * Leaves in place: everything else. Needs / assumes: nothing special. Limits: a test double.\n */\nexport default { id: 'comfy-shared', name: 'A ComfyUI-Shared folder', async detect() {}, async plan() {} }",
        'panama-imax-redux': "/**\n * What it does: maps a package folder onto ComfyUI-Shared. Detects: its telltale files. Maps: input to input, workflows to workflows.\n * Leaves in place: everything else. Needs / assumes: nothing special. Limits: a test double.\n */\nexport default { id: 'panama-imax-redux', name: 'Panama Canal v2 delivery package', async detect() {}, async plan() {} }",
        'agent-made': "/**\n * What it does: maps a package folder onto ComfyUI-Shared. Detects: its telltale files. Maps: input to input, workflows to workflows.\n * Leaves in place: everything else. Needs / assumes: nothing special. Limits: a test double.\n */\nexport default { id: 'agent-made', name: 'Agent made', async detect() {}, async plan() {} }",
      },
      plans: {
        '/Users/lucas/Projects/package': {
          adapter: { id: 'panama-imax-redux', name: 'Panama Canal v2 delivery package', version: 1, builtin: true }, source: '/Users/lucas/Projects/package', fenced: true,
          ops: [{ op: 'copy', kind: 'input', from: 'shotA/comfy/input/ref.png', to: 'input/shots/shotA/ref.png', bytes: 715929 }, { op: 'copy', kind: 'workflow', from: 'shotA/comfy/workflows/shotA-v01.json', to: 'workflows/panama-imax-redux/round/shotA-v01.json', bytes: 170502 }, { op: 'note', kind: 'reference', from: 'shotA/final', note: 'shotA/final: 1 files left in place' }],
          findings: [{ level: 'info', text: 'built on ComfyUI 0.39.2' }, { level: 'warn', text: '3 FalAPI_* node types are used and no fal pack came with this folder' }],
          summary: { copies: 32, links: 0, notes: 3, bytes: 267700000, by_kind: { input: { files: 30, bytes: 267600000 }, workflow: { files: 2, bytes: 123000 } } },
        },
      },
      prompts: {},   // adapter id -> its prompt text
      conflicts: 0,   // how many files the next real apply reports as conflicts
      lastApply: null,
    },
    // The Adapter Studio (docs/ADR-009): the package's tree and files, the chat's scripted turns, what a Save answers.
    studio: {
      tree: {
        entries: [
          { path: 'shotA', dir: true, bytes: 0, files: 4 }, { path: 'shotA/comfy', dir: true, bytes: 0, files: 2 }, { path: 'shotA/comfy/input', dir: true, bytes: 0, files: 1 },
          { path: 'shotA/comfy/input/ref.png', dir: false, bytes: 715929 }, { path: 'shotA/comfy/workflows', dir: true, bytes: 0, files: 1 }, { path: 'shotA/comfy/workflows/shotA-v01.json', dir: false, bytes: 170502 },
          { path: 'shotA/final', dir: true, bytes: 0, files: 1 }, { path: 'shotA/final/shotA.mov', dir: false, bytes: 6300000000 }, { path: 'shotA/notes.txt', dir: false, bytes: 120 },
          { path: 'MANIFEST.json', dir: false, bytes: 2048 }, { path: 'README.md', dir: false, bytes: 900 },
        ], truncated: false, total: 11,
      },
      files: { 'README.md': { kind: 'text', text: '# Delivery\nThe graphs are in shotA/comfy/workflows.', bytes: 900 }, 'MANIFEST.json': { kind: 'json', text: '{\n  "for": "Brynley"\n}', bytes: 2048 } },
      turns: [],        // functions (chatState, fixtureState) => { events, done?, created? } the next /studio/step calls take, in order
      nextSave: null,   // what the next /studio/save-checked answers instead of the default (valid, no rounds)
      steps: 0, saves: [], documented: [], sent: [],
    },
    failures: {},
  }
}

// The two MCP endpoints as the core describes them (libs/core/src/mcp.ts), with the bridge's target in every snippet.
export function mcpEndpoints(state, comfy) {
  const exe = state.mcp.exe
  const q = (w) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(w) ? w : `'${w}'`)
  const env = { ELECTRON_RUN_AS_NODE: '1' }
  const make = (id, name, title, purpose, file, args) => {
    const program = `${state.mcp.dir}/${file}`
    const stdio = [program, ...args]
    const h = state.mcp.http[id]
    const url = `http://127.0.0.1:${h.port}/mcp`
    return {
      id, name, title, purpose, program, exists: id === 'pod-manager', bundle_command: 'npm run mcp:bundle', executable: exe, args, command: [exe, ...stdio], env,
      command_line: `ELECTRON_RUN_AS_NODE=1 ${[exe, ...stdio].map(q).join(' ')}`,
      target: args[1] || null, http_port: h.port, http_url: url, http: { enabled: h.enabled, port: h.port, running: h.enabled, error: null, url },
      clients: {
        claude_code: `claude mcp add ${name} -e ELECTRON_RUN_AS_NODE=1 -- ${[exe, ...stdio].map(q).join(' ')}`,
        claude_desktop: JSON.stringify({ mcpServers: { [name]: { command: exe, args: stdio, env } } }, null, 2),
        codex: `[mcp_servers.${name}]\ncommand = ${JSON.stringify(exe)}\nargs = [${stdio.map((x) => JSON.stringify(x)).join(', ')}]\n\n[mcp_servers.${name}.env]\nELECTRON_RUN_AS_NODE = "1"`,
        chatgpt: h.enabled ? url : '',
        remote: h.enabled ? url : '',
      },
    }
  }
  return [
    make('pod-manager', 'pod-manager', 'Pod manager', 'An agent orchestrates RunPod the way the app does.', 'server.cjs', []),
    make('comfy-bridge', 'comfy-bridge', 'ComfyUI bridge', 'An agent works inside one ComfyUI.', 'comfy-bridge.cjs', comfy ? ['--comfy', comfy] : []),
  ]
}

const stats = (pods) => ({
  total_pods: pods.length,
  running_pods: pods.filter((p) => p.status === 'running').length,
  stopped_pods: pods.filter((p) => p.status === 'stopped').length,
  total_vram: pods.reduce((sum, p) => sum + (p.vram || 0), 0),
})

const FOLDER_WHAT = { project: 'the project tree: scripts, graphs, shot folders, tracker, policies', plates: 'the served plates: one folder per shot, left and right eye', 'comfy-shared': "ComfyUI's input, output, models and workflows, shared by every install" }
const CONTAINERS = { project: '/workspace/project', plates: '/workspace/plates', 'comfy-shared': '/workspace/comfy-shared' }
const ENV_KEYS = { project: 'PROJECT_ROOT', plates: 'PLATES_ROOT', 'comfy-shared': 'COMFY_SHARED' }

// What the API derives from a saved configuration, enough for the panel: rows, required flags, links.
function mountsPayload(state) {
  const c = state.mounts.config
  const required = state.mounts.mode === 'prod' ? { project: true, plates: true, 'comfy-shared': true } : c.required || {}
  const folders = Object.keys(CONTAINERS).map((key) => ({
    key, what: FOLDER_WHAT[key], mode: 'rw', required: !!required[key], local: c.folders?.[key] || '', exists: !!c.folders?.[key],
    mirror: false, container: CONTAINERS[key], env_key: ENV_KEYS[key], env_keys: [ENV_KEYS[key]],
    declared: key === 'project' && c.folders?.project ? { path: '/home/binc/CANALV2_r3/CANALV2', source: "the tree's job files", count: 17 } : null,
  }))
  for (const cf of c.custom || []) folders.push({ key: cf.name, what: '', mode: cf.mode, required: false, custom: true, local: cf.local, exists: !!cf.local, mirror: false,
    container: cf.container || `${c.mount_path}/${cf.name}`, env_key: '', env_keys: [], declared: cf.link ? { path: cf.link, source: 'the path typed here', count: 1 } : null })
  const links = folders.filter((f) => f.declared).map((f) => ({ path: f.declared.path, target: f.container, required: f.required, mode: f.mode, what: f.what, folder: f.key }))
  const env = Object.fromEntries(folders.filter((f) => f.env_key).map((f) => [f.env_key, f.container]))
  if (links.length) env.COMFY_LINKS = links.map((l) => `${l.path}=${l.target}`).join(';')
  return { ...state.mounts, config: c, dry_run: !!c.dry_run || !!state.mounts.dryForced, dry_run_forced: !!state.mounts.dryForced, folders, links, require: Object.keys(required).filter((k) => required[k]),
    local_env: Object.fromEntries(folders.filter((f) => f.env_key && f.local).map((f) => [f.env_key, f.local])),
    preview: { env, ...(c.network_volume_id ? { network_volume_id: c.network_volume_id, volume_mount_path: c.mount_path } : {}) } }
}

const filterRepos = (repos, q) => (q ? repos.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : repos)

export async function mockApi(page, state) {
  const calls = []
  // Origin-scoped: a bare "**/api/**" would also swallow Vite's /src/api/*.js module requests.
  await page.route('http://localhost:8000/api/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^\/api/, '')
    const method = req.method()
    const query = Object.fromEntries(url.searchParams)
    let body = null
    try {
      body = req.postDataJSON()
    } catch {
      /* no JSON body */
    }
    calls.push({ method, path, query, body })

    const json = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data ?? {}) })
    const noContent = () => route.fulfill({ status: 204 })

    const failure = state.failures[`${method} ${path}`]
    if (failure) return json({ detail: failure }, 500)

    let m
    // pods
    if (method === 'GET' && path === '/settings') return json(state.settings)
    if (method === 'PUT' && path === '/settings') {
      if (body.runpod_api_key) state.settings = { ...state.settings, runpod_api_key_set: true, runpod_api_key_hint: '••••' + body.runpod_api_key.slice(-4), source: '/home/me/.config/runpod-pod-manager/.env' }
      if (body.panama_aws_access_key || body.panama_aws_secret_key) { state.settings = { ...state.settings, panama_aws_keys_set: true, panama_aws_access_key_hint: '••••' + String(body.panama_aws_access_key || 'xxxx').slice(-4) }; (state.panama ||= {}).configured = true }
      for (const [f, k, d] of [['panama_bucket', 'bucket', 'bh-panama-exchange-610140802195'], ['panama_region', 'region', 'us-west-2'], ['panama_profile', 'profile', 'panama']]) {
        if (body[f] !== undefined) state.settings = { ...state.settings, [f]: body[f] === d || !body[f] ? d : body[f], panama_defaults: { bucket: 'bh-panama-exchange-610140802195', region: 'us-west-2', profile: 'panama' } }
      }
      if (body.anthropic_api_key) state.settings = { ...state.settings, anthropic_key_set: true, anthropic_key_hint: '••••' + body.anthropic_api_key.slice(-4) }
      return json(state.settings)
    }
    if (method === 'GET' && path === '/mounts') return json(mountsPayload(state))
    if (method === 'PUT' && path === '/mounts') { state.mounts.config = body; state.mounts.stored = true; return json(mountsPayload(state)) }
    if (method === 'POST' && path === '/mounts/preview') return json(mountsPayload({ ...state, mounts: { ...state.mounts, config: { ...state.mounts.config, ...body } } }))
    if (method === 'DELETE' && path === '/mounts') { state.mounts.config = defaultState().mounts.config; state.mounts.stored = false; return json(mountsPayload(state)) }
    // Export and import of the Default Configuration (docs/ADR-023): the same sections as the core, simply computed.
    if (path.startsWith('/configio/')) {
      // `secrets`/`git` are the keys and tokens this fake PC holds; a backup keeps them, an Undo puts them back (docs/ADR-023)
      const cio = (state.configio ||= { backups: [], applied: [], plans: 0, exports: 0, undone: 0, exportSecrets: [], secrets: { RUNPOD_API_KEY: 'rpa_CURRENT_PC_KEY_VALUE_0000', ANTHROPIC_API_KEY: 'sk-ant-CURRENT-PC-KEY-0000000000' }, git: [{ id: 'gh-1', provider: 'github', host: 'github.com', username: 'octo', token: 'ghp_CURRENT_PC_TOKEN_0000' }], secretsApplied: [], skipped: [] })
      const MIN = { RUNPOD_API_KEY: 16, ANTHROPIC_API_KEY: 20, PANAMA_CONSOLE_KEY: 8 }
      const last4 = (v) => (v.length >= 8 ? `••••${v.slice(-4)}` : '••••')
      const looksSecret = (n) => /(SECRET|TOKEN|PASSW|CREDENTIAL|PRIVATE|AUTH|API[_-]?KEY|ACCESS[_-]?KEY|(^|_)KEY($|_))/i.test(n)
      const maskEnv = (e) => Object.fromEntries(Object.entries(e || {}).map(([k, v]) => [k, looksSecret(k) ? last4(String(v)) : v]))
      const SEC = { volume: ['Volume and datacenter', ['network_volume_id', 'mount_path', 'data_center_id'], { account: true }], image: ['Image and registry login', ['image', 'registry_auth_id'], { account: true }], env: ['Environment', ['env'], {}], pod_defaults: ['Pod defaults', ['idle_stop_minutes', 'sync_parallel', 'sync_shared', 'pull_shared', 'apply_by_default', 'pull_any_card', 'required', 'links'], {}], mcp: ['MCP servers', ['mcp_http'], {}], folders: ['Folders', ['folders', 'custom'], { machine: true }] }
      const DEF = { bucket: 'bh-panama-exchange-610140802195', region: 'us-west-2', profile: 'panama' }
      const panamaNow = () => ({ bucket: state.settings.panama_bucket || DEF.bucket, region: state.settings.panama_region || DEF.region, profile: state.settings.panama_profile || DEF.profile })
      const pickF = (o, fs) => Object.fromEntries(fs.filter((f) => f in o).map((f) => [f, o[f]]))
      if (method === 'GET' && path === '/configio/export') {
        cio.exports++
        const withSecrets = query.secrets !== '0'
        cio.exportSecrets.push(withSecrets)
        const { dry_run, ...config } = state.mounts.config
        const env = Object.fromEntries(Object.entries(config.env || {}).filter(([k]) => withSecrets || !looksSecret(k)))
        const omitted = withSecrets ? [] : Object.keys(config.env || {}).filter(looksSecret)
        return json({ format: 'runpod-pod-manager-config', version: 1, exported_at: '2026-11-03T05:00:00.000Z', app_version: '1.0.2', config: { ...config, env }, panama: panamaNow(), secrets_included: withSecrets, ...(withSecrets ? { secrets: { settings: { ...cio.secrets }, git_accounts: cio.git.map((a) => ({ ...a })) } } : {}), secrets_set: [...Object.keys(cio.secrets), ...cio.git.map((a) => `git:${a.provider}/${a.username}`)], env_omitted: omitted, not_exported: ['the no-spend switch (dry_run)', 'per-pod configurations'] })
      }
      if (method === 'POST' && path === '/configio/plan') {
        cio.plans++
        const f = body.file, plan = { ok: false, errors: [], warnings: [], sections: [], source: { app_version: f?.app_version ?? null, exported_at: f?.exported_at ?? null, secrets_included: f?.secrets !== undefined && f?.secrets_included !== false, secrets_set: f?.secrets_set ?? [], env_omitted: f?.env_omitted ?? [] } }
        if (!f || typeof f !== 'object' || f.format !== 'runpod-pod-manager-config') { plan.errors.push(`That is not a pod manager configuration file (its "format" is ${JSON.stringify(f?.format ?? null)}, not "runpod-pod-manager-config").`); return json(plan) }
        if (f.version > 1) { plan.errors.push(`That file is version ${f.version}; this app reads up to version 1. Update the app, then import it.`); return json(plan) }
        for (const k of Object.keys(f.config || {})) if (k === 'dry_run') plan.warnings.push('Ignored "dry_run": the no-spend switch is never imported.')
        for (const [key, [label, fields, flags]] of Object.entries(SEC)) {
          const inc = pickF(f.config || {}, fields); if (!Object.keys(inc).length) continue
          const cur = pickF(state.mounts.config, fields), incoming = { ...cur, ...inc }, changed = JSON.stringify(cur) !== JSON.stringify(incoming)
          plan.sections.push({ key, label, changed, current: key === 'env' ? { env: maskEnv(cur.env) } : cur, incoming: key === 'env' ? { env: maskEnv(incoming.env) } : incoming, machine_specific: !!flags.machine, account_specific: !!flags.account, default_checked: changed && !flags.machine, error: null, note: flags.machine ? 'Paths from another machine.' : flags.account ? 'Ids that belong to the exporting RunPod account; they may not exist in yours.' : null })
        }
        if (f.panama) { const now = panamaNow(), incoming = { ...now, ...f.panama }, changed = JSON.stringify(now) !== JSON.stringify(incoming); plan.sections.push({ key: 'panama', label: 'Panama bucket, region and profile', changed, current: now, incoming, machine_specific: false, account_specific: false, default_checked: changed, error: null, note: null }) }
        if (f.secrets) {   // the keys and tokens: each named with its last four characters, never the value; a malformed one is named and flagged
          const items = []
          for (const [name, value] of Object.entries(f.secrets.settings || {})) {
            if (typeof value !== 'string' || !value || /\s/.test(value) || value.length < (MIN[name] || 1)) items.push({ name, hint: '', changed: false, error: `${name} is too short or malformed` })
            else items.push({ name, hint: last4(value), changed: cio.secrets[name] !== value, error: null })
          }
          for (const a of f.secrets.git_accounts || []) {
            const nm = `git:${a.provider}/${a.username}`
            if (!a.token || a.token.length < 8) items.push({ name: nm, hint: '', changed: false, error: `${nm}: the token is malformed (no spaces, at least 8 characters)` })
            else items.push({ name: nm, hint: last4(a.token), changed: !cio.git.some((g) => g.id === a.id && g.token === a.token), error: null })
          }
          const ok = items.filter((i) => !i.error), changed = ok.some((i) => i.changed)
          plan.sections.push({ key: 'secrets', label: 'Keys and tokens', changed, current: Object.fromEntries(Object.entries(cio.secrets).map(([n, v]) => [n, last4(v)])), incoming: Object.fromEntries(ok.map((i) => [i.name, i.hint])), machine_specific: false, account_specific: false, default_checked: changed && !!ok.length, error: ok.length ? null : 'None of the keys and tokens in the file can be imported.', note: items.length > ok.length && ok.length ? `Not imported, malformed: ${items.filter((i) => i.error).map((i) => i.name).join(', ')}.` : null, items })
        }
        plan.ok = true
        return json(plan)
      }
      if (method === 'POST' && path === '/configio/apply') {
        const wanted = body.sections || []
        if (!wanted.length) return json({ detail: 'No section selected, or none of the selected ones is in the file.' }, 400)
        cio.backups.push({ name: `mounts-2026-11-03T05-00-0${cio.backups.length}-000Z.json`, config: JSON.parse(JSON.stringify(state.mounts.config)), panama: panamaNow(), secrets: { ...cio.secrets }, git: cio.git.map((a) => ({ ...a })) })
        cio.applied.push(wanted)
        for (const key of wanted) {
          if (key === 'secrets') {
            const names = []
            for (const [n, v] of Object.entries(body.file.secrets?.settings || {})) if (typeof v === 'string' && v.length >= (MIN[n] || 1) && !/\s/.test(v)) { cio.secrets[n] = v; names.push(n) } else cio.skipped.push(n)
            for (const a of body.file.secrets?.git_accounts || []) if (a.token && a.token.length >= 8) { cio.git = [...cio.git.filter((g) => g.id !== a.id), a]; names.push(`git:${a.provider}/${a.username}`) } else cio.skipped.push(`git:${a.provider}/${a.username}`)
            cio.secretsApplied.push(names); continue
          }
          if (key === 'panama') { const p = body.file.panama || {}; state.settings = { ...state.settings, panama_bucket: p.bucket, panama_region: p.region, panama_profile: p.profile }; continue }
          Object.assign(state.mounts.config, pickF(body.file.config || {}, SEC[key][1]))
        }
        state.mounts.stored = true
        return json({ payload: mountsPayload(state), backup: `/home/me/.config/runpod-pod-manager/backups/${cio.backups.at(-1).name}`, applied: wanted, skipped: cio.skipped.splice(0), settings: state.settings })
      }
      if (method === 'POST' && path === '/configio/undo') {
        const b = cio.backups.pop(); if (!b) return json({ detail: 'Nothing to undo: there is no backup.' }, 400)
        cio.undone++; cio.secrets = b.secrets; cio.git = b.git; state.mounts.config = b.config; state.settings = { ...state.settings, panama_bucket: b.panama.bucket, panama_region: b.panama.region, panama_profile: b.panama.profile }
        return json({ payload: mountsPayload(state), restored: b.name, settings: state.settings })
      }
      if (method === 'GET' && path === '/configio/backups') return json(cio.backups.map((b) => ({ name: b.name, file: `/home/me/.config/runpod-pod-manager/backups/${b.name}`, at: b.name.slice(7, -5) })).reverse())
    }
    if (method === 'GET' && path === '/fs/dirs') {
      const p = query.path || '/Users/lucas'
      const names = state.fs[p]
      if (!names) return json({ detail: `not a folder: ${p}` }, 404)
      const parent = p === '/' ? null : p.replace(/\/[^/]+$/, '') || '/'
      return json({ path: p, parent, home: '/Users/lucas', dirs: names.map((n) => ({ name: n, path: `${p}/${n}` })) })
    }
    if (method === 'GET' && path === '/gpus') return json(state.gpus)
    if (method === 'GET' && path === '/datacenters') return json(state.datacenters)
    if (method === 'GET' && path === '/images/dockerfile') {
      const image = query.image
      const base = { image, created: '2026-10-20T08:39:42Z', labels: { 'dev.bluecollar.shotpipe': 'contract-v26' }, env: ['COMFY_PORT=8188'], ports: ['8188/tcp'], entrypoint: ['/opt/comfy-app/entrypoint.sh'], cmd: [], workdir: '/opt/ComfyUI', source: 'FROM pytorch/pytorch\n# the repo Dockerfile', source_path: '/repo/apps/comfy-app/Dockerfile', source_kind: 'repo', source_url: null, source_note: null, error: null }
      if (image === 'ashleykza/comfyui:latest') return json({ ...base, built: '# Reconstructed from the stock image\nRUN stock-install', env: ['WEB_PORT=3001'], ports: ['3001/tcp'], labels: {}, source: 'FROM nvidia/cuda\n# upstream comfyui-docker', source_kind: 'github', source_path: 'https://github.com/ashleykleynhans/comfyui-docker/blob/HEAD/Dockerfile', source_url: 'https://github.com/ashleykleynhans/comfyui-docker' })
      if (image.includes('missing')) return json({ ...base, built: null, error: 'manifest unknown', env: [], ports: [], entrypoint: [], labels: {}, created: null, source: null, source_path: null, source_kind: null, source_note: 'No source repository is known for this image: it has no org.opencontainers.image.source label and is not in the known list.' })
      return json({ ...base, built: '# Reconstructed from ' + image + '\nRUN git clone comfy\nCOPY packs /opt/ComfyUI/custom_nodes/' })
    }
    if ((m = path.match(/^\/volumes\/([^/]+)$/)) && method === 'GET') { const v = state.volumes[m[1]]; return v ? json(v) : json({ detail: `no network volume ${m[1]}` }, 404) }
    if (method === 'GET' && path === '/history') { const ev = state.history.events.filter((e) => !query.kind || e.kind === query.kind); return json(query.limit ? ev.slice(0, Number(query.limit)) : ev) }
    if (method === 'GET' && path === '/history/export') { const csv = query.format === 'csv'; return json({ name: `history-${query.what || 'all'}.${csv ? 'csv' : 'json'}`, mime: csv ? 'text/csv' : 'application/json', text: csv ? 'ts,kind\n2026-11-03T10:00:00Z,pod\n' : JSON.stringify({ events: state.history.events, spend: state.history.spend }) }) }
    if (method === 'GET' && path === '/history/spend') return json(state.history.spend)
    if (method === 'GET' && path === '/history/logs') {
      const l = state.history.logs?.[query.pod_id]
      if (!l) return json({ detail: `pod ${query.pod_id} is not running` }, 400)
      const keep = { all: ['info', 'warning', 'error'], warnings: ['warning', 'error'], errors: ['error'] }[query.level || 'all'] || ['info', 'warning', 'error']
      return json({ ...l, entries: l.entries.filter((e) => keep.includes(e.level)) })
    }
    if (method === 'GET' && path === '/history/runs') { const r = state.history.runs[query.pod_id]; return r ? json(r) : json({ detail: `pod ${query.pod_id} is not running` }, 400) }
    if (method === 'GET' && path === '/credits') return state.credits === null ? json({ detail: 'RunPod did not report the account balance' }, 502) : json(state.credits ?? { balance: 36.42, spend_per_hr: 0.053, spend_limit: 80, hours_left: 687.2, level: 'ok' })
    if (method === 'GET' && path === '/volumes') return json(Object.values(state.volumes).map((v) => ({ ...v, is_default: v.id === state.mounts.config.network_volume_id })))
    if (method === 'POST' && path === '/volumes') {
      const v = { id: `vol-new-${Object.keys(state.volumes).length + 1}`, name: body.name, size_gb: body.size_gb, datacenter: body.datacenter, cost_per_month: Math.round(body.size_gb * 7) / 100, s3: body.datacenter === 'EU-RO-1', is_default: false, pods: [] }
      state.volumes[v.id] = v; return json(v)
    }
    if ((m = path.match(/^\/volumes\/([^/]+)$/)) && method === 'PATCH') { const v = state.volumes[m[1]]; v.size_gb = body.size_gb; v.cost_per_month = Math.round(body.size_gb * 7) / 100; return json(v) }
    if ((m = path.match(/^\/volumes\/([^/]+)$/)) && method === 'DELETE') {
      const v = state.volumes[m[1]]
      if (v.pods.some((p) => p.via === 'runpod')) return json({ detail: `${v.name} is attached to ${v.pods.map((p) => p.name).join(', ')}: delete or recreate those pods first` }, 400)
      delete state.volumes[m[1]]; return json({ removed: m[1], was_default: false })
    }
    if ((m = path.match(/^\/volumes\/([^/]+)\/default$/)) && method === 'POST') { const v = state.volumes[m[1]]; state.mounts.config.network_volume_id = v.id; state.mounts.config.data_center_id = v.datacenter; return json({ ...v, is_default: true }) }
    if (method === 'GET' && path === '/dashboard') return json({ stats: stats(state.pods), pods: state.pods, dry_run: !!state.mounts.config.dry_run || !!state.mounts.dryForced })
    if (method === 'GET' && path === '/pods') return json(state.pods)
    if (method === 'POST' && path === '/pods') {
      const pod = { id: `pod-new-${state.pods.length + 1}`, name: body.name, status: 'starting', gpu: body.gpu, vram: 24,
        ssh_command: 'ssh root@new.proxy.runpod.io', custom_config: !!body.config }
      if (body.config) state.podConfigs[pod.id] = body.config
      state.pods.push(pod)
      return json(pod, 201)
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/details$/)) && method === 'GET') {
      const pod = state.pods.find((p) => p.id === m[1])
      if (!pod) return json({ detail: `RunPod has no such pod (${m[1]})` }, 404)
      return json({ id: pod.id, name: pod.name, status: pod.status === 'stopped' ? 'EXITED' : 'RUNNING', status_text: pod.status === 'stopped' ? 'Exited by user: Mon Oct 19 2026' : 'Rented by user: Mon Oct 19 2026',
        cost_per_hr: 0.28, cost_estimated: pod.status === 'stopped', cloud: 'SECURE', datacenter: 'EUR-IS-1', gpu: 'NVIDIA RTX 4000 Ada Generation', gpu_count: 1, image: 'ashleykza/comfyui:latest', disk_gb: 20, volume_gb: 0,
        created_at: '2026-10-19T11:00:19Z', actions: ['start', 'terminate'], console_url: `https://console.runpod.io/pods?id=${pod.id}`, web_ui_url: pod.web_ui_url || null, ssh_command: pod.ssh_command })
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/logs$/)) && method === 'GET') {
      const lines = state.logs[m[1]] || ['create container ashleykza/comfyui:latest', 'start container for ashleykza/comfyui:latest: begin']
      const body = lines.map((line, i) => `id: 2026-10-19T11:02:2${i}Z\ndata: ${JSON.stringify({ source: 'system', line, ts: `2026-10-19T11:02:2${i}Z` })}\n\n`).join('')
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body })
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/idle$/)) && method === 'PUT') {
      const pod = state.pods.find((p) => p.id === m[1])
      if (pod) pod.idle_stop_minutes = Number(query.minutes)
      return json({ pod_id: m[1], idle_stop_minutes: Number(query.minutes) })
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/name$/)) && method === 'PUT') {
      const pod = state.pods.find((p) => p.id === m[1])
      if (pod) { if (!pod.runpod_name) pod.runpod_name = pod.name; pod.name = String(body.name || '').trim() || pod.runpod_name; if (pod.name === pod.runpod_name) delete pod.runpod_name }
      return json({ pod_id: m[1], name: pod?.name, runpod_name: pod?.runpod_name ?? null })
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/round$/)) && method === 'PUT') {
      const pod = state.pods.find((p) => p.id === m[1]); const r = String(body.round || '').trim()
      if (pod) { if (r) { pod.round = r; pod.round_label = (state.roundNames ||= {})[r] || r } else { delete pod.round; delete pod.round_label } }
      return json({ pod_id: m[1], round: r || null })
    }
    if (path === '/rounds/name' && method === 'PUT') {
      const names = (state.roundNames ||= {}); if (body.name) names[body.round] = body.name; else delete names[body.round]
      for (const p of state.pods) if (p.round === body.round) p.round_label = names[body.round] || body.round
      return json({ round: body.round, label: names[body.round] || body.round })
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/config$/)) && method === 'GET') return json(state.podConfigs[m[1]] || null)
    if ((m = path.match(/^\/pods\/([^/]+)\/config$/)) && method === 'PUT') {
      if (body) state.podConfigs[m[1]] = body; else delete state.podConfigs[m[1]]
      const pod = state.pods.find((p) => p.id === m[1]); if (pod) pod.custom_config = !!body
      return json({ pod_id: m[1], custom_config: !!body, config: body || null })
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/recreate$/)) && method === 'POST') {
      const i = state.pods.findIndex((p) => p.id === m[1])
      if (i < 0) return json({ detail: 'not found' }, 404)
      const old = state.pods.splice(i, 1)[0]
      const pod = { ...old, id: `pod-re-${old.id.slice(-4)}`, status: 'starting' }
      state.pods.push(pod)
      return json(pod)
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/(stop|resume)$/)) && method === 'POST') {
      if (state.slow?.[m[2]]) await new Promise((r) => setTimeout(r, state.slow[m[2]]))   // `api.state.slow = { stop: 800 }`: answer late, to see the card's bar
      const pod = state.pods.find((p) => p.id === m[1])
      pod.status = m[2] === 'stop' ? 'stopped' : 'running'
      return json(pod)
    }
    if ((m = path.match(/^\/pods\/([^/]+)$/)) && method === 'DELETE') {
      state.pods = state.pods.filter((p) => p.id !== m[1])
      return json({ ok: true })
    }
    // accounts
    if (method === 'GET' && path === '/git-accounts') return json({ accounts: state.accounts, providers: state.providers })
    if ((m = path.match(/^\/git-accounts\/([^/]+)$/)) && method === 'DELETE') {
      state.accounts = state.accounts.filter((a) => a.id !== m[1])
      return noContent()
    }
    if (path.match(/^\/git-accounts\/[^/]+\/repos$/)) return json({ repos: filterRepos(state.accountRepos, query.q) })
    // repositories
    if (method === 'GET' && path === '/repositories') return json({ repositories: state.repositories })
    if (method === 'POST' && path === '/repositories') {
      const repoUrl = body.url.replace(/\/+$/, '').replace(/\.git$/, '')
      const repo = { id: `repo-${state.repositories.length + 1}`, url: repoUrl, branch: body.branch || state.branches.default,
        name: repoUrl.replace(/^https?:\/\/[^/]+\//, ''), host: new URL(repoUrl).host }
      state.repositories.push(repo)
      return json(repo, 201)
    }
    if ((m = path.match(/^\/repositories\/([^/]+)$/)) && method === 'DELETE') {
      state.repositories = state.repositories.filter((r) => r.id !== m[1])
      return noContent()
    }
    // git lookups
    if (method === 'GET' && path === '/repos/search') return json({ repos: filterRepos(state.accountRepos, query.q) })
    if (method === 'GET' && path === '/repos/branches') return json(state.branches)
    if (method === 'GET' && path === '/repos/folders') return json({ url: query.url, branch: query.branch, folders: state.folders })
    if (method === 'POST' && path === '/settings/anthropic/check') { state.settings.anthropicChecks = [...(state.settings.anthropicChecks || []), body.key || null]; return json((body.key || state.settings.anthropic_key_set) ? ((state.settings.anthropicRejects || (body.key && body.key.includes('BAD'))) ? { ok: false, error: 'Anthropic answered 401: invalid x-api-key' } : { ok: true }) : { ok: false, error: 'No Anthropic API key is set' }) }
    // The Adapter Studio
    if (method === 'GET' && path === '/studio/tree') return json(state.studio.tree)
    if (method === 'GET' && path === '/studio/file') { const f = state.studio.files[query.path]; return f ? json({ path: query.path, ...f }) : json({ path: query.path, kind: 'text', text: `contents of ${query.path}`, bytes: 40 }) }
    if (method === 'GET' && path === '/studio/context') return json({ source: query.folder, total_files: 11, dirs: [{ path: 'shotA', files: 4 }], sample: ['README.md'], texts: [{ path: 'MANIFEST.json', bytes: 2048, sent_bytes: 2048 }, { path: 'README.md', bytes: 900, sent_bytes: 900 }], spec_bytes: 9000 })
    if (method === 'POST' && path === '/studio/step') {
      const st = body.state
      state.studio.steps++; state.studio.sent.push(st)
      if (state.studio.delay) await new Promise((r) => setTimeout(r, state.studio.delay))
      const turn = state.studio.turns.shift() || (() => ({ events: [{ kind: 'text', text: 'Noted.' }], done: true }))
      const out = turn(st, state)
      const next = { ...st, calls: st.calls + 1, created: out.created || st.created, adapter: out.adapter || st.adapter, messages: [...st.messages, { role: 'assistant', content: out.events.filter((e) => e.kind === 'text').map((e) => ({ type: 'text', text: e.text })) }] }
      return json({ state: next, events: out.events, done: out.done !== false })
    }
    if (method === 'POST' && path === '/studio/save-checked') {
      if (state.studio.saveFails) return json({ detail: state.studio.saveFails }, 400)
      const scripted = state.studio.nextSave; state.studio.nextSave = null
      let a = state.imports.adapters.find((x) => x.id === body.id)
      if (!a) { a = { id: body.id, name: body.id, version: 1, builtin: false, sha256: 'e'.repeat(64), file: `/home/me/.config/runpod-pod-manager/adapters/${body.id}.mjs` }; state.imports.adapters.push(a) }
      else if (a.builtin) { (state.imports.originals ||= {})[body.id] ??= state.imports.sources[body.id]; a.modified = true; a.file = `/home/me/.config/runpod-pod-manager/adapters/${body.id}.mjs` }
      const text = scripted?.text ?? body.text
      state.imports.sources[body.id] = text
      const nm = /name:\s*"([^"]*)"|name:\s*'([^']*)'/.exec(text); if (nm) a.name = nm[1] ?? nm[2]
      a.sha256 = String((state.imports.saves = (state.imports.saves || 0) + 1)).padStart(64, '0')
      state.studio.saves.push({ id: body.id, text: body.text, folder: body.folder })
      return json({ adapter: a, valid: scripted ? scripted.valid : true, errors: scripted?.errors || [], rounds: scripted?.rounds || [], text, tested: !!body.folder })
    }
    if (method === 'POST' && path === '/studio/document') {
      const code = state.imports.sources[body.id] || ''
      state.imports.sources[body.id] = `/**\n * Documented by Claude. What it does: maps a package onto ComfyUI-Shared. Detects: its manifest. Maps: inputs to input/, workflows to workflows/.\n * Leaves in place: finals and provenance. Needs / assumes: a MANIFEST.json. Limits: none known.\n */\n${code.slice(code.search(/export default/))}`
      state.studio.documented.push(body.id)
      return json({ header: '/** ... */', before: '' })
    }
    if (method === 'GET' && path === '/imports/prompt') return json(state.imports.prompts[query.id] || '')
    if (method === 'PUT' && path === '/imports/prompt') { state.imports.prompts[body.id] = body.text; return json({ id: body.id, bytes: body.text.length }) }
    if (method === 'POST' && path === '/imports/rename') {
      const a = state.imports.adapters.find((x) => x.id === body.id)
      if (!a) return json({ detail: `no adapter ${body.id}` }, 400)
      if (a.builtin) return json({ detail: `${a.id} is a built-in adapter` }, 400)
      if (body.name) a.name = body.name
      if (body.id !== undefined && body.new_id) { /* not used */ }
      return json(a)
    }
    // Import (the Import Shot Pack modal)
    if (method === 'GET' && path === '/imports/adapters') return json(state.imports.adapters)
    if (method === 'GET' && path === '/imports/source') { const a = state.imports.adapters.find((x) => x.id === query.id); return a ? json({ id: a.id, sha256: a.sha256, text: state.imports.sources[a.id] || '', builtin: a.builtin, file: a.file || `/builtin/${a.id}.mjs` }) : json({ detail: `no adapter ${query.id}` }, 400) }
    if (method === 'GET' && path === '/imports/draft-preview') return json({ source: query.source, total_files: 120, dirs: [{ path: 'shotA', files: 100 }, { path: 'shotA/comfy', files: 40 }], sample: ['shotA/comfy/input/a.png'], texts: [{ path: 'MANIFEST.json', bytes: 2048, sent_bytes: 2048 }, { path: '00_READ_ME.md', bytes: 40000, sent_bytes: 12288 }], spec_bytes: 9000 })
    if (method === 'POST' && path === '/imports/describe') {
      state.imports.described = (state.imports.described || 0) + 1
      if (state.imports.describeFails) return json({ detail: state.imports.describeFails }, 400)
      if (!state.settings.anthropic_key_set) return json({ detail: 'No Anthropic API key: set it in Default Configuration' }, 400)
      return json({ description: 'A first test round for the finishing artist: three shots (a CGI plate, an archival shot and a creature shot) with their graphs, the files the graphs load, and the approved renders. Built on ComfyUI 0.39.2; the graphs need the fal node pack, which is not in the folder.', model: 'claude-sonnet-5-5', sent: { files: 120, dirs: 8, texts: ['MANIFEST.json', '00_READ_ME.md'] } })
    }
    if (method === 'POST' && path === '/imports/draft') {
      if (!state.settings.anthropic_key_set) return json({ detail: 'No Anthropic API key: set it in Default Configuration' }, 400)
      const id = body.id || 'draft-package'
      let a = state.imports.adapters.find((x) => x.id === id)
      if (!a) { a = { id, name: id, version: 1, builtin: false, sha256: 'd'.repeat(64), file: `/home/me/.config/runpod-pod-manager/adapters/${id}.mjs` }; state.imports.adapters.push(a) }
      state.imports.sources[id] = `export default { id: "${id}" } // version ${(state.imports.drafts?.length || 0) + 1}`
      state.imports.drafts = [...(state.imports.drafts || []), body]
      state.imports.draftPlanError = null
      const step = (state.imports.draftScript || [{ valid: true, errors: [] }])[Math.min(state.imports.drafts.length, (state.imports.draftScript || [1]).length) - 1]
      return json({ adapter: a, model: 'claude-sonnet-5-5', valid: step.valid, errors: step.errors, ignored: step.ignored || 0 })
    }
    if (method === 'POST' && path === '/imports/sync-after') {
      state.imports.syncAfterCalls = [...(state.imports.syncAfterCalls || []), body.pod_id]
      if (!body.pod_id) return json({ action: 'skip', why: 'no-pod', configure: false })
      if (!state.mounts.config.network_volume_id) return json({ action: 'skip', why: 'no-volume', configure: true })
      if (body.pod_id.startsWith('dry-')) return json({ action: 'skip', why: 'simulated', configure: false })
      return json({ action: 'sync', request: { pod_id: body.pod_id, direction: 'push', only: ['comfy-shared'], skip_renders: true } })
    }
    if (method === 'POST' && path === '/imports/save') {
      if (!/export\s+default/.test(body.text)) return json({ detail: 'the adapter does not parse:\nUnexpected end of input' }, 400)
      let a = state.imports.adapters.find((x) => x.id === body.id)
      if (a && a.builtin) return json({ detail: `${body.id} is a built-in adapter` }, 400)
      if (!a) { a = { id: body.id, name: body.id, version: 1, builtin: false, sha256: 'e'.repeat(64), file: `/home/me/.config/runpod-pod-manager/adapters/${body.id}.mjs` }; state.imports.adapters.push(a) }
      state.imports.sources[body.id] = body.text; a.sha256 = String((state.imports.saves = (state.imports.saves || 0) + 1)).padStart(64, '0')
      return json(a)
    }
    if (method === 'DELETE' && (m = path.match(/^\/imports\/adapters\/([^/]+)$/))) {
      const a = state.imports.adapters.find((x) => x.id === decodeURIComponent(m[1]))
      if (!a) return json({ detail: `no adapter ${m[1]}` }, 400)
      if (a.builtin && !a.modified) return json({ detail: `${a.id} is a built-in adapter and has not been modified; there is nothing to delete or reset` }, 400)
      if (a.builtin) { a.modified = false; state.imports.sources[a.id] = state.imports.originals[a.id]; a.file = ''; return json({ id: a.id, reset: true }) }
      state.imports.adapters = state.imports.adapters.filter((x) => x !== a); delete state.imports.sources[a.id]
      return json({ id: a.id })
    }
    if (method === 'GET' && path === '/imports/template') return json(`/**
 * ${query.name || query.id}: an import adapter. What it does: (say). Detects: (say). Maps: (say). Leaves in place: (say).
 * Needs / assumes: (say). Limits: (say).
 */
export default {
  id: '${query.id}',
  name: '${query.name || query.id}',
  async detect(root, ctx) { return { match: 0, evidence: [] } },
  async plan(root, ctx) { return { ops: [], findings: [] } },
}
`)
    if (method === 'GET' && path === '/imports/duplicate') return json((state.imports.sources[query.from] || '').replace(/id:\s*'[^']+'/, `id: '${query.id}'`))
    if (method === 'POST' && path === '/imports/validate') {
      const errs = []
      if (!/export\s+default/.test(body.text)) errs.push('there is no `export default { ... }`')
      if (!/detect\s*[(:]/.test(body.text)) errs.push('there is no detect(root, ctx) function')
      if (!/plan\s*[(:]/.test(body.text)) errs.push('there is no plan(root, ctx) function')
      const head = (/^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))+/.exec(body.text) || [''])[0]
      if (head.replace(/[\/*\s]+/g, ' ').trim().length < 100) errs.push('there is no documentation header: a comment block before `export default` saying what it does, what it detects, what it maps where, what it leaves in place, what it assumes and its limits')
      return json(errs)
    }
    if (method === 'POST' && path === '/imports/plan') {
      const a = body.adapter && state.imports.adapters.find((x) => x.id === body.adapter)
      if (a && a.id.startsWith('draft-') && state.imports.draftPlanError) return json({ detail: state.imports.draftPlanError }, 400)
      const plan = a && a.id.startsWith('draft-') && state.imports.plans[body.source] ? { ...state.imports.plans[body.source], adapter: { id: a.id, name: a.name, version: 1, builtin: false } } : state.imports.plans[body.source]
      return plan ? json(plan) : json({ detail: `no adapter recognises ${body.source}; write one (docs/IMPORT-ADAPTERS.md) or pick one with --adapter` }, 400)
    }
    if (method === 'POST' && path === '/imports/apply') {
      state.imports.lastApply = body
      const sm = body.plan.summary, dry = !!body.dryRun, conflict = dry ? 0 : state.imports.conflicts
      const counts = dry ? { 'would-copy': sm.copies, noted: sm.notes } : { copied: sm.copies - conflict, ...(conflict ? { conflict } : {}), noted: sm.notes }
      return json({ dry_run: dry, ok: !conflict, counts, results: conflict ? [{ i: 0, status: 'conflict', detail: 'input/a exists and differs' }] : [], record: dry ? null : '/home/me/.config/runpod-pod-manager/imports/2026-10-24-panama-imax-redux.json' })
    }
    // MCP (the Connect › MCP tab)
    if (method === 'GET' && path === '/panama/status') { const pn = (state.panama ||= { configured: false }); return json({ configured: pn.configured, profile: 'panama', bucket: 'bh-panama-exchange-610140802195', region: 'us-west-2', staging: '/Users/lucas/panama-rounds', reason: pn.configured ? '' : 'No AWS profile named "panama"', pod: { available: !!pn.pod?.available, reason: pn.pod?.reason || 'Pod mode is not available in this build yet.', volume: pn.pod?.volume || POD_VOLUME } }) }
    if (method === 'GET' && path === '/panama/rounds') { const pn = state.panama || {}; const base = pn.rounds || [{ name: 'brynley-comfy-2026-10-23', staged: false, state: 'none', present: 0, expected: null, missing: null, bytes: 0 }, { name: 'brynley-comfy-2026-10-20', staged: false, state: 'partial', present: 391, expected: 1283, missing: 892, bytes: 8100000000 }, { name: 'brynley-inbox-2026-10-28-v001', staged: true, state: 'complete', present: 378, expected: 378, missing: 0, bytes: 623848 }]; return json(base.map((r) => (pn.deleted || []).includes(r.name) ? { ...r, staged: false, state: 'none', present: 0, expected: null, missing: null, bytes: 0 } : r)) }
    if (method === 'GET' && path === '/panama/files') return json({ round: query.round, files: 4, bytes: 3200, entries: [{ path: '03_INBOX', dir: true, bytes: 3000, files: 2 }, { path: '03_INBOX/ENTRY.md', dir: false, bytes: 1000, local: true }, { path: '03_INBOX/shot-001.exr', dir: false, bytes: 2000, local: false }, { path: 'MANIFEST.json', dir: false, bytes: 200 }, { path: 'README.md', dir: false, bytes: 0 }] })
    if (method === 'GET' && path === '/panama/size') return json({ round: query.round, files: 5701, bytes: 29117613170 })
    if (method === 'DELETE' && path === '/panama/staged') { const pn = (state.panama ||= {}); (pn.deleted ||= []).push(query.round); return json({ round: query.round, freed: 1234567890 }) }
    if (method === 'POST' && path === '/panama/cancel') { (state.panama ||= {}).cancelled = body.id; return json({ id: body.id, round: String(body.id).replace(/-1$/, ''), dest: '/x', state: 'cancelled', files: 258, lines: [] }) }
    if (method === 'POST' && path === '/panama/pull') { (state.panama ||= {}).pulled = body.round; return json({ id: `${body.round}-1`, round: body.round, dest: `/Users/lucas/panama-rounds/${body.round}`, state: state.panama.slow ? 'running' : 'done', files: 7, lines: ['download: a'], bytes_done: 3100000000, bytes_total: 9500000000, rate: 47400000, remaining: 12, recent: ['cgi-042/final/cgi-042_main_final_v01.mp4', 'cgi-042/comfy/workflows/cgi-042-v13.json', 'archival-071/comfy/input/shots/archival-071/ref-a.png'], verify: { listed: 7, bad: [], extra: 0, ok: true } }) }
    if (method === 'GET' && path === '/panama/job') return json({ id: query.id, round: String(query.id).replace(/-1$/, ''), dest: '/x', state: state.panama?.cancelled ? 'cancelled' : state.panama?.slow ? 'running' : 'done', files: 7, lines: [], bytes_done: 3100000000, bytes_total: 9500000000, rate: 47400000, remaining: 12, recent: ['cgi-042/final/cgi-042_main_final_v01.mp4', 'cgi-042/comfy/workflows/cgi-042-v13.json', 'archival-071/comfy/input/shots/archival-071/ref-a.png'], verify: { listed: 7, bad: [], extra: 0, ok: true } })
    // Pod mode (docs/ADR-022): the contract the core fork implements, in the shape the pane reads
    if (path.startsWith('/panama/pod/')) {
      const pod = ((state.panama ||= {}).pod ||= {})
      const route = pod.route || 'temporary'
      const podJob = (round, st, extra = {}) => ({ id: `${round}-pod-1`, round, kind: 'pull', route: pod.chosen || route, pod_id: (pod.chosen || route) === 'active' ? 'activepod1' : 'temppod1', pod_name: (pod.chosen || route) === 'active' ? 'ComfyUI-Dev' : `ComfyUI-Pull-${round}-1103`, state: st, files: 7, lines: ['s3 pull: …'], error: null, verify: null, bytes_done: 3100000000, bytes_total: 9500000000, rate: 47400000, remaining: 12, recent: ['cgi-042/final/cgi-042_main_final_v01.mp4', 'cgi-042/comfy/workflows/cgi-042-v13.json', 'archival-071/comfy/input/shots/archival-071/ref-a.png'], ...(st === 'done' && pod.placeReport ? { place: { round, dry_run: false, ok: true, mode: 'hardlink', linked: 12, already_there: 0, conflicts: [], graphs: [{ shot: 'cgi-042', name: 'g.json', path: `workflows/rounds/${round}/g.json`, rewritten: 28, unresolved: [] }], rewritten: 28, unresolved: [], missing: [] } } : {}), ...extra })
      if (method === 'GET' && path === '/panama/pod/rounds') {
        const gone = pod.removed || []
        const base = pod.rounds || [{ name: 'brynley-comfy-2026-10-23', staged: false, state: 'none', present: 0, expected: null, missing: null, bytes: 0 }, { name: 'brynley-comfy-2026-10-22', staged: true, state: 'complete', present: 1402, expected: 1402, missing: 0, bytes: 15170551969 }, { name: 'brynley-inbox-2026-10-28-v001', staged: false, state: 'partial', present: 100, expected: 378, missing: 278, bytes: 200000 }]
        return json({ as_of: 'as_of' in pod ? pod.as_of : '2026-11-03T05:54:10Z', volume: pod.volume || POD_VOLUME, rounds: base.map((r) => (gone.includes(r.name) ? { ...r, staged: false, state: 'none', present: 0, expected: null, missing: null, bytes: 0 } : r)) })
      }
      if (method === 'GET' && path === '/panama/pod/plan') return json({ round: query.round, route, pod: route === 'active' ? { id: 'activepod1', name: 'ComfyUI-Dev', price_per_hour: 0.59 } : null, gpu: route === 'active' ? null : 'L4', price_per_hour: route === 'active' ? null : 0.59, bytes: 15170551969, idle_stop_minutes: 15, volume: pod.volume || POD_VOLUME, choices: { current: pod.noCurrent ? null : { id: 'activepod1', name: 'ComfyUI-Dev', running: !pod.currentOff, price_per_hour: pod.currentOff ? null : 0.59, gpu: 'L4' }, temporary: { gpu: 'L4', price_per_hour: 0.59, gpu_type_id: 'NVIDIA L4' } } })
      if (method === 'POST' && path === '/panama/pod/pull') { (pod.pulled ||= []).push(body.round); pod.chosen = body.route === 'current' ? 'active' : body.route === 'temporary' ? 'temporary' : undefined; (pod.routes ||= []).push(body.route); return json(podJob(body.round, pod.slow ? 'creating' : 'done')) }
      if (method === 'GET' && path === '/panama/pod/job') { const r = String(query.id).replace(/-pod-1$/, ''); return json(podJob(r, pod.cancelled ? 'cancelled' : pod.slow ? 'pulling' : 'done', pod.removeKind ? { kind: 'remove' } : {})) }
      if (method === 'POST' && path === '/panama/pod/cancel') { pod.cancelled = body.id; return json(podJob(String(body.id).replace(/-pod-1$/, ''), 'cancelled')) }
      if (method === 'POST' && path === '/panama/pod/place') { (pod.placed ||= []).push({ round: body.round, dry_run: body.dry_run }); return json(pod.placeFails ? { round: body.round, dry_run: false, ok: false, mode: 'none', linked: 0, already_there: 0, conflicts: [], graphs: [], rewritten: 0, unresolved: [], missing: [], error: 'No running pod of yours is on this volume.' } : { round: body.round, dry_run: !!body.dry_run, ok: true, mode: 'hardlink', linked: 56, already_there: 2, conflicts: [{ path: 'shots/cgi-042/a.png', where: 'shipped' }], graphs: [{ shot: 'cgi-042', name: 'cgi-042-graph.json', path: `workflows/rounds/${body.round}/cgi-042-graph.json`, rewritten: 28, unresolved: [] }], rewritten: 28, unresolved: [], missing: [] }) }
      if (method === 'DELETE' && path === '/panama/pod/staged') { (pod.removed ||= []).push(query.round); pod.removeKind = true; return json(podJob(query.round, 'deleting', { kind: 'remove' })) }
    }
    if (method === 'GET' && path === '/remote/status') { const r = (state.remote ||= { key: '' }); return json({ name: 'Panama console', url: 'https://panama-console.beinghuman.studio/api/mcp', key_set: !!r.key, key_hint: r.key ? `••••${r.key.slice(-4)}` : '' }) }
    if (method === 'PUT' && path === '/remote/key') { const r = (state.remote ||= { key: '' }); r.key = body.key || ''; return json({ name: 'Panama console', url: 'https://panama-console.beinghuman.studio/api/mcp', key_set: !!r.key, key_hint: r.key ? `••••${r.key.slice(-4)}` : '' }) }
    if (method === 'POST' && path === '/remote/check') {
      const r = (state.remote ||= { key: '' })
      if (!r.key) return json({ ok: false, tools: [], definitions: [], error: 'No console key yet', ms: 0, who: null, role: null, hint: 'no-key' })
      if (r.key.startsWith('bad')) return json({ ok: false, tools: [], definitions: [], error: 'HTTP 401: missing bearer key', ms: 5, who: null, role: null, hint: 'bad-key' })
      return json({ ok: true, tools: ['whoami', 'list_shots', 'get_shot'], definitions: [], error: null, ms: 42, who: 'Lucas', role: 'partner', hint: null })
    }
    if (method === 'GET' && path === '/mcp/endpoints') return json(mcpEndpoints(state, query.comfy || ''))
    if (method === 'GET' && path === '/mcp/targets') return json(state.mcp.targets)
    if (method === 'PUT' && path === '/mcp/serve') {
      const h = state.mcp.http[body.id]
      if (body.enabled && state.mcp.failServe) return json({ detail: state.mcp.failServe }, 409)
      state.mcp.http[body.id] = { enabled: !!body.enabled, port: body.port ?? h.port }
      return json(mcpEndpoints(state, '').find((e) => e.id === body.id))
    }
    if (method === 'POST' && path === '/mcp/probe') { if (state.mcp.delay) await new Promise((r) => setTimeout(r, state.mcp.delay)); const r = state.mcp.probe[body.id]; return r ? json(r) : json({ detail: `No MCP endpoint ${body.id}` }, 400) }
    // images
    if (method === 'GET' && path === '/images/env') {
      const image = query.source === 'dockerfile' ? '/repo/apps/comfy-app/Dockerfile'
        : query.image === 'prebuilt' ? 'ashleykza/comfyui:latest' : query.image
      return json({ source: query.source, image, env: state.imageEnv, build_args: state.imageBuildArgs,
        skipped: state.imageEnvSkipped, build_source: null })
    }

    return json({ detail: `unmocked ${method} ${path}` }, 404)
  })
  return calls
}

export const test = base.extend({
  // auto: every test is mocked, even ones that never touch `api`, so no spec can reach the real backend.
  api: [
    async ({ page }, use) => {
      const state = defaultState()
      const calls = await mockApi(page, state)
      await use({ state, calls })
    },
    { auto: true },
  ],
})

export { expect }

// ----- shared UI helpers -----

export const createPodToggle = (page) => page.getByTestId('create-pod-toggle')

export async function openCreatePod(page) {
  await createPodToggle(page).click()
  await expect(page.locator('#pod-name')).toBeVisible()
}

export async function expandSection(page, name) {
  await page.getByRole('button', { name, exact: true }).click()
}

export const podCard = (page, name) => page.locator(`[data-testid="pod-card"][data-name="${name}"]`)

/** Default Configuration shows its sections as tabs on a wide screen and flows them on a narrow one: open the tab when there are tabs. */
export const cfgTab = async (root, key) => {
  await root.getByTestId('cfg-tabs').waitFor({ timeout: 4000 }).catch(() => {})   // the bar appears once the panel has loaded; on a narrow screen there is none
  const tab = root.getByTestId(`cfg-tab-${key}`)
  if (await tab.count()) await tab.click()
}
export const modal = (page, text) => page.locator('.modal.show', { hasText: text })
