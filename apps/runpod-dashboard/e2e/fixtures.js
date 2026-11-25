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
        { prompt_id: 'abcdef12-3456-7890', workflow: 'rounds/r1/cgi-042/stereo.json', status: 'success', started_at: '2026-11-03T11:00:00Z', duration_s: 42.5, cost_estimate: 0.00814, outputs: [{ filename: 'plate_0001.png', type: 'output', subfolder: 'shots' }] },
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
    mounts: { config: { image: 'ghcr.io/example/comfy-app:v26', registry_auth_id: '', idle_stop_minutes: 30, sync_parallel: 8, sync_shared: ['input', 'models', 'workflows'], pull_shared: ['output'], network_volume_id: '', mount_path: '/workspace', apply_by_default: true, pull_any_card: true, default_gpu: 'auto', auto_cards: [], import_max_pods: 2, import_cost_cap_usd: 50, import_cap_enabled: true, dry_run: false, folders: { project: '', plates: '', 'comfy-shared': '' }, custom: [], env: {}, links: [], required: {} }, folders: [], links: [], mode: 'dev', require: [], require_source: 'config', stored: false, store: '', local_env: {}, preview: { env: {} }, catalog: {} },
    volumes: {
      vol1: { id: 'vol1', name: 'comfy-workspace', size_gb: 120, datacenter: 'EU-RO-1', cost_per_month: 8.4, s3: true, is_default: false, pods: [{ id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', status: 'running', via: 'runpod' }, { id: 'pod-cccccccc', name: 'ComfyUI-Test', status: 'starting', via: 'config' }] },
      vol2: { id: 'vol2', name: 'scratch', size_gb: 50, datacenter: 'CA-MTL-1', cost_per_month: 3.5, s3: false, is_default: false, pods: [] },
    },
    datacenters: { live: true, datacenters: [{ value: 'EU-RO-1', text: 'EU-RO-1 · RTX 4000 Ada $0.28/h Low, RTX 4090 $0.89/h High · S3', s3: true, cards: [{ key: 'rtx4000ada', name: 'RTX 4000 Ada', vram: 20, price: 0.28, stock: 'Low' }, { key: 'rtx4090', name: 'RTX 4090', vram: 24, price: 0.89, stock: 'High' }] }, { value: 'CA-MTL-1', text: 'CA-MTL-1 · A40 $0.35/h High', s3: false, cards: [{ key: 'a40', name: 'A40', vram: 48, price: 0.35, stock: 'High' }, { key: 'rtx5090', name: 'RTX 5090', vram: 32, price: 0.69, stock: 'Low', available: true, runs: true, cuda: 13 }] }, { value: 'US-KS-2', text: 'US-KS-2 · none of our cards in stock · S3', s3: true, cards: [] }] },
    gpus: { default: 'auto', live: true, gpus: [{ value: 'auto', text: 'Cheapest card in stock (16-24 GB)', in_stock: true }, { value: 'a4000', text: 'RTX A4000 (16 GB) · none in stock', in_stock: false }, { value: 'rtx4090', text: 'RTX 4090 (24 GB) · $0.34/h · Low stock', in_stock: true, price: 0.34, stock: 'Low' }, { value: 'rtxpro6000', auto: false, text: 'RTX PRO 6000 (96 GB) · $2.49/h · Low stock', in_stock: true, price: 2.49, stock: 'Low' }] },
    // The folder browser (GET /fs/dirs): a tiny disk.
    fs: { '/Users/lucas': ['ComfyUI-Shared', 'Projects'], '/Users/lucas/Projects': ['CANALV2', 'plates'], '/Users/lucas/Projects/CANALV2': ['00_POLICY', '04_TRACKER'] },
    settings: { runpod_api_key_set: true, runpod_api_key_hint: '••••AAAA', source: '/home/me/.config/runpod-pod-manager/.env', s3_keys_set: false, s3_access_key_hint: '', agent_named_yes_required: false, agent_spend_cap_usd: 0 },   // most specs start with a key; the gate spec clears it
    logs: {},   // pod id -> lines for GET /pods/:id/logs
    podlogs: [],   // the logs pods left behind: { name, pod_id, bytes, modified, text }
    podlogSaves: [],
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
        { id: 'comfy-shared', name: 'A ComfyUI-Shared folder', version: 1, kind: 'shot-pack', builtin: true, sha256: 'a'.repeat(64), file: '' },
        { id: 'panama-imax-redux', name: 'Panama Canal v2 delivery package', version: 1, kind: 'shot-pack', builtin: true, sha256: 'b'.repeat(64), file: '' },
        { id: 'agent-made', name: 'Agent made', version: 1, kind: 'round', builtin: false, sha256: 'c'.repeat(64), file: '/home/me/.config/runpod-pod-manager/adapters/agent-made.mjs' },
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
  const apDefault = { enabled: false, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false } }
  return { ...state.mounts, config: state.noAutoPublish ? c : { ...c, auto_publish: c.auto_publish || apDefault }, dry_run: !!c.dry_run || !!state.mounts.dryForced, dry_run_forced: !!state.mounts.dryForced, folders, links, require: Object.keys(required).filter((k) => required[k]),
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
      if (body.agent_named_yes_required !== undefined) state.settings = { ...state.settings, agent_named_yes_required: !!body.agent_named_yes_required }
      if (body.agent_spend_cap_usd !== undefined) state.settings = { ...state.settings, agent_spend_cap_usd: body.agent_spend_cap_usd || 0 }
      if (body.hf_token) state.settings = { ...state.settings, hf_token_set: true, hf_token_hint: '••••' + body.hf_token.slice(-4) }
      if (body.anthropic_api_key) state.settings = { ...state.settings, anthropic_key_set: true, anthropic_key_hint: '••••' + body.anthropic_api_key.slice(-4) }
      return json(state.settings)
    }
    if (method === 'GET' && path === '/mounts') return json(mountsPayload(state))
    const asBad = (b) => b && b.auto_sync && b.auto_sync.enabled && !String(b.auto_sync.approved_by || '').trim()   // the core's named yes for Auto sync
    const asNeedsName = () => json({ detail: 'Auto sync needs the name of who says yes' }, 400)
    // render settings of a configuration (docs/ADR-048): codecs non-empty and known, widths in the allowed sets
    const renderBad = (b) => { const r = b && b.render; if (!r) return false; const W = ['source', 960, 1280, 1920]; return !Array.isArray(r.codecs) || !r.codecs.length || r.codecs.some((c) => !['h264', 'prores422hq'].includes(c)) || !['auto', 'pod', 'local'].includes(r.where) || !['proxy', 'review'].includes(r.kind) || !W.includes(r.proxy_width) || !W.includes(r.review_width) }
    // folder_excludes (v1.5.0): { folderKey: [patterns] }, the same pattern rules as sync_exclude; the 400 names the folder and the pattern
    const feBad = (b) => { for (const [k, list] of Object.entries((b && b.folder_excludes) || {})) for (const p of list || []) { const s = String(p).trim(); if (!s || s.length > 200 || s.includes('..') || /[\0\n]/.test(s) || s.startsWith('~')) return `folder_excludes.${k}: bad pattern ${JSON.stringify(p)}` } return '' }
    if (((method === 'PUT' && path === '/mounts') || (method === 'POST' && path === '/mounts/preview') || ((m = path.match(/^\/pods\/([^/]+)\/config$/)) && method === 'PUT')) && feBad(body)) return json({ detail: feBad(body) }, 400)
    if ((method === 'PUT' && path === '/mounts') || (method === 'POST' && path === '/mounts/preview') || ((m = path.match(/^\/pods\/([^/]+)\/config$/)) && method === 'PUT')) if (renderBad(body)) return json({ detail: 'render: pick at least one codec and a size from the list' }, 400)
    if (method === 'PUT' && path === '/mounts' && asBad(body)) return asNeedsName()
    if (method === 'POST' && path === '/mounts/preview' && asBad(body)) return asNeedsName()
    if ((m = path.match(/^\/pods\/([^/]+)\/config$/)) && method === 'PUT' && asBad(body)) return asNeedsName()
    // Auto-publish is part of the Default Configuration (app-wide): a PUT keeps what the page did not send, refuses a Tunnel target and a Slack without S3 (state.noAutoPublish answers like a core without it)
    if (method === 'PUT' && path === '/mounts' && body?.auto_publish && !state.noAutoPublish) {
      const t = body.auto_publish.targets || {}
      if (t.tunnel) return json({ detail: 'Tunnel is not available yet' }, 400)
      if (t.slack && !t.s3) return json({ detail: 'Slack announces an upload: turn S3 on' }, 400)
      const dc = body.auto_publish.daily_cap; if (dc !== undefined && dc !== null && !(Number.isInteger(dc) && dc >= 1 && dc <= 50)) return json({ detail: 'daily_cap: a whole number from 1 to 50, or none' }, 400)
      if (body.auto_publish.enabled && t && !t.s3 && !t.slack) return json({ detail: 'At least one of S3 or Slack must be on' }, 400)
      const gn = body.auto_publish.generate; if (gn?.enabled && gn.where === 'pod' && !String(body.auto_publish.approved_by || '').trim()) return json({ detail: "Rendering on a pod spends money: put the approver's name" }, 400)
    }
    if (method === 'PUT' && path === '/mounts' && state.mountsFail) return json({ detail: state.mountsFail }, 500)   // a save the core refuses
    if (method === 'PUT' && path === '/mounts' && state.mountsIgnore) return json(mountsPayload(state))   // answers OK but keeps nothing
    if (method === 'PUT' && path === '/mounts') { const prev = state.mounts.config.auto_publish; (state.mountPuts ||= []).push(JSON.parse(JSON.stringify(body))); state.mounts.config = body; if (prev || body.auto_publish) state.mounts.config.auto_publish = { ...prev, ...(body.auto_publish || {}), ...(prev?.standing ? { standing: prev.standing } : {}) }; state.mounts.stored = true; return json(mountsPayload(state)) }
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
      const SEC = { auto_publish: ['Auto-publish', ['auto_publish'], {}], volume: ['Volume and datacenter', ['network_volume_id', 'mount_path', 'data_center_id'], { account: true }], image: ['Image and registry login', ['image', 'registry_auth_id'], { account: true }], env: ['Environment', ['env'], {}], pod_defaults: ['Pod defaults', ['idle_stop_minutes', 'sync_parallel', 'sync_shared', 'pull_shared', 'apply_by_default', 'pull_any_card', 'required', 'links'], {}], mcp: ['MCP servers', ['mcp_http'], {}], folders: ['Folders', ['folders', 'custom'], { machine: true }] }
      const DEF = { bucket: 'bh-panama-exchange-610140802195', region: 'us-west-2', profile: 'panama' }
      const panamaNow = () => ({ bucket: state.settings.panama_bucket || DEF.bucket, region: state.settings.panama_region || DEF.region, profile: state.settings.panama_profile || DEF.profile })
      const govNow = () => ({ require_named_yes: !!state.settings.agent_named_yes_required, spend_cap_usd: state.settings.agent_spend_cap_usd || 0, shell_guard: !!state.agentguard?.enabled })
      const pickF = (o, fs) => Object.fromEntries(fs.filter((f) => f in o).map((f) => [f, o[f]]))
      if (method === 'GET' && path === '/configio/export') {
        cio.exports++
        const withSecrets = query.secrets !== '0'
        cio.exportSecrets.push(withSecrets)
        const { dry_run, ...config } = state.mounts.config
        const env = Object.fromEntries(Object.entries(config.env || {}).filter(([k]) => withSecrets || !looksSecret(k)))
        const omitted = withSecrets ? [] : Object.keys(config.env || {}).filter(looksSecret)
        const pubEx = () => { const st = (state.publish ||= {}).settings || { s3: {}, slack: {} }; const { access_key_hint: _k, ...s3 } = st.s3 || {}; const { webhook_hint: _w, ...slack } = st.slack || {}; return { s3, slack } }
        return json({ format: 'runpod-pod-manager-config', version: 1, exported_at: '2026-11-03T05:00:00.000Z', app_version: '1.0.2', ...(state.configioNeeds ? { publish: pubEx(), needs: ['Slack webhook', 'S3 keys'] } : {}), config: { ...config, env }, panama: panamaNow(), governance: govNow(), secrets_included: withSecrets, ...(withSecrets ? { secrets: { settings: { ...cio.secrets }, git_accounts: cio.git.map((a) => ({ ...a })) } } : {}), secrets_set: [...Object.keys(cio.secrets), ...cio.git.map((a) => `git:${a.provider}/${a.username}`)], env_omitted: omitted, not_exported: ['the no-spend switch (dry_run)', 'per-pod configurations'] })
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
        if (f.publish) { const now = (state.publish?.settings ? { s3: { ...state.publish.settings.s3, access_key_hint: undefined }, slack: { ...state.publish.settings.slack, webhook_hint: undefined } } : {}), changed = JSON.stringify(now) !== JSON.stringify({ ...now, ...f.publish }); plan.sections.push({ key: 'publish', label: 'Publishing settings (S3 bucket, prefix, region, layout; Slack channel and options)', changed, current: now, incoming: { ...now, ...f.publish }, machine_specific: false, account_specific: false }) }
        if (Array.isArray(f.needs)) plan.needs = f.needs
        if (f.governance) { const now = govNow(), incoming = { ...now, ...f.governance }, changed = JSON.stringify(now) !== JSON.stringify(incoming); plan.sections.push({ key: 'governance', label: 'Agent rules and the shell guard (system-wide)', changed, current: now, incoming, machine_specific: false, account_specific: false, default_checked: changed, error: null, note: null }) }
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
          if (key === 'publish') { const p = body.file.publish || {}; const st = ((state.publish ||= {}).settings ||= { s3: {}, slack: {} }); Object.assign(st.s3, p.s3 || {}); Object.assign(st.slack, p.slack || {}); continue }
          if (key === 'governance') { const g = body.file.governance || {}; state.settings = { ...state.settings, agent_named_yes_required: !!g.require_named_yes, agent_spend_cap_usd: g.spend_cap_usd || 0 }; state.agentguard = { ...(state.agentguard || {}), enabled: !!g.shell_guard, installed: !!g.shell_guard }; continue }
          if (key === 'panama') { const p = body.file.panama || {}; state.settings = { ...state.settings, panama_bucket: p.bucket, panama_region: p.region, panama_profile: p.profile }; continue }
          if (key === 'auto_publish') { const a = body.file.config.auto_publish || {}; const { standing, ...rest } = a; state.mounts.config.auto_publish = { ...rest, enabled: false, dry_run: true, targets: { ...(rest.targets || { s3: true, slack: false }), tunnel: false } }; continue }   // an import never turns it on and drops the standing approval
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
      // v1.5.1: state.fsPermission = [paths the app may not read] (403 no_permission with state.fsHint), state.fsLinks = { path: { name: target } } (entries that are links), state.fsReal = { path: real } (a logical path that is a link)
      if ((state.fsPermission || []).includes(p)) return json({ detail: `Cannot read ${p}: operation not permitted`, code: 'no_permission', ...(state.fsHint === null ? {} : { hint: state.fsHint || 'macOS blocked access: allow RunPod Manager under System Settings > Privacy & Security > Files and Folders.' }) }, 403)
      // big and slow volumes (v1.5.1): state.fsTimeout = [paths that answer 504 timeout], state.fsDelay = { path: ms }, state.fsTruncated = { path: total } (the listing is capped: `truncated` says how many were left out), `filter` is a case-insensitive substring
      if (state.fsDelay?.[p]) await new Promise((r) => setTimeout(r, state.fsDelay[p]))
      if ((state.fsTimeout || []).includes(p)) return json({ detail: 'The folder did not answer within 15 seconds (a sleeping drive or an unavailable network mount). Try again, or pick another place.', code: 'timeout' }, 504)
      let names = state.fs[p]
      if (!names) return json({ detail: `not a folder: ${p}` }, 404)
      if (query.filter) names = names.filter((n) => n.toLowerCase().includes(String(query.filter).toLowerCase()))
      const bigTotal = state.fsTruncated?.[p], capped = bigTotal && !query.filter ? { total: bigTotal, truncated: bigTotal - names.length } : bigTotal ? { total: names.length, truncated: 0 } : {}
      const parent = p === '/' ? null : p.replace(/\/[^/]+$/, '') || '/'
      const links = (state.fsLinks || {})[p] || {}
      return json({ path: p, parent, home: '/Users/lucas', ...((state.fsReal || {})[p] ? { real: state.fsReal[p] } : {}), ...capped, dirs: names.map((n) => ({ name: n, path: `${p}/${n}`, ...(links[n] ? { link: true, target: links[n] } : {}) })) })
    }
    if (method === 'GET' && path === '/fs/volumes') {   // v1.5.1: state.volumes = [{ name, path, link, target?, size_bytes, free_bytes, readable, reason? }]; state.volumesOld answers like a core without the call
      if (state.volumesOld) return json({ detail: 'no core call mounts.volumes' }, 500)
      return json(state.volumes || [])
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
    if ((m = path.match(/^\/volumes\/([^/]+)$/)) && method === 'GET' && !['job', 'jobs', 'erasable'].includes(m[1])) { const v = state.volumes[m[1]]; return v ? json(v) : json({ detail: `no network volume ${m[1]}` }, 404) }
    if (method === 'POST' && path === '/queue/plan' && body.source === 'volume') {   // the core's volume plan: locked shots left out (refused when asked for), 2 graphs a shot, $0.06 a graph, the cap checked
      (state.planCalls ||= []).push(body)
      const all = { proxy_v005: ['archival-080', 'archival-084', 'cgi-042'], proxy_v004g: ['archival-080'] }[body.round] || []
      const lockedAll = all.filter((s) => s === 'cgi-042'), refused = (body.shots || []).filter((s) => lockedAll.includes(s))
      const shots = (body.shots?.length ? body.shots : all).filter((s) => !lockedAll.includes(s)), graphs = shots.length * 2, est = Math.round(graphs * 0.06 * 100) / 100 * (state.volumeLib?.priceFactor || 1)
      const cap = body.cost_cap_usd ?? 50
      return json({ round: body.round, source: 'volume', volume_id: body.volume_id, shots, graphs, graphs_by_shot: Object.fromEntries(shots.map((s) => [s, 2])), seconds_per_graph: 600, samples: 0, price_per_hour: 0.36, pull_hours: 0, est_total_usd: est, max_pods: 2, cost_cap_usd: cap, cap_enabled: true, over_cap: est > cap, locked: lockedAll, refused, remaining_usd: 94.5, assumption: `${graphs} graph(s) x 600 s (no run in the History: the default 600 s) x the pod's hourly price ($0.36/h).` })
    }
    if (method === 'POST' && path === '/queue/plan') {   // a shot's card is a key or an ordered list; the core validates each and prices the dearest (the plan says so)
      (state.planCalls ||= []).push(body)
      const several = Object.values(body.cards || {}).some((v) => Array.isArray(v) && v.length > 1)
      return json({ round: body.round, shots: ['cgi-042', 'cgi-043'], price_per_hour: 3.99, pull_hours: 0.5, est_total_usd: 6.98, max_pods: 2, cost_cap_usd: 50, cap_enabled: state.capEnabled !== false, over_cap: false, ...(several ? { assumption: 'Where a shot has several cards, the most expensive one is priced.' } : {}) })
    }
    if (method === 'POST' && path === '/queue/import-many' && body.source === 'volume') {   // guards (b) and (c) again, as the core answers them
      (state.volumeImportCalls ||= []).push(body)
      ;(state.importManyBodies ||= []).push(body)
      if (body.items.some((i) => (i.shots || []).includes('cgi-042'))) return json({ detail: 'Refused: cgi-042 is locked (client-approved, or under 04_GRAPH): listed for reference, never run (Binc\'s rules).' }, 403)
      const est = body.items.reduce((a, i) => a + (i.shots || []).length * 0.12, 0) * (state.volumeLib?.priceFactor || 1)
      if (body.cost_cap_usd != null && est > body.cost_cap_usd) return json({ detail: `Refused: the estimate $${est.toFixed(2)} passes the cap $${body.cost_cap_usd}.` }, 402)
      state.imported = { ...body, ...body.items[0] }; (state.importedAll ||= []).push(state.imported)
      state.queue = { imports: body.items.map((i, n) => ({ id: `imp${n + 1}`, round: i.round, source: 'volume', approved_by: body.approved_by, state: 'active', spent_usd: 0, cap_enabled: true, cost_cap_usd: body.cost_cap_usd, max_pods: i.max_pods, counts: {} })), tasks: body.items.flatMap((i, n) => i.shots.map((s, k) => ({ id: `t${n}-${k}`, import_id: `imp${n + 1}`, round: i.round, shot: s, kind: 'run', state: 'waiting', graphs: [`${i.round}/${s}/${s}__a__${i.round}.json`] }))), active: 1 }
      return json(state.queue.imports)
    }
    if (method === 'POST' && path === '/queue/import-many') { (state.importManyBodies ||= []).push(body); for (const i of body.items) { const one = { round: i.round, shots: i.shots, cards: i.cards, max_pods: i.max_pods, cost_cap_usd: body.cost_cap_usd == null ? undefined : Math.round(body.cost_cap_usd / body.items.length * 100) / 100, approved_by: body.approved_by, run_workflows: body.run_workflows, volume_id: body.volume_id }; state.imported = one; (state.importedAll ||= []).push(one) }
      state.queue = { imports: body.items.map((i, n) => ({ id: `imp${n + 1}`, round: i.round, approved_by: body.approved_by, state: 'active', spent_usd: 0, cap_enabled: true, cost_cap_usd: body.cost_cap_usd, max_pods: i.max_pods, counts: {} })), tasks: [{ id: 't1', import_id: 'imp1', round: body.items[0].round, shot: null, kind: 'pull', state: 'running', pod_name: 'pull' }, ...body.items[0].shots.map((s, k) => ({ id: `t${k + 2}`, import_id: 'imp1', round: body.items[0].round, shot: s, kind: 'run', state: k ? 'waiting' : 'failed', error: k ? undefined : 'boom (node 4, KSampler)' }))], active: 1 + body.items[0].shots.length }; return json(state.queue.imports) }
    if (method === 'POST' && path === '/queue/import') { state.imported = body; (state.importedAll ||= []).push(body); state.queue = { imports: [{ id: 'imp1', round: body.round, approved_by: body.approved_by, state: 'active', spent_usd: 0, cap_enabled: true, cost_cap_usd: body.cost_cap_usd, max_pods: body.max_pods, counts: {} }], tasks: [{ id: 't1', import_id: 'imp1', round: body.round, shot: null, kind: 'pull', state: 'running', pod_name: 'pull' }, ...body.shots.map((s, i) => ({ id: `t${i + 2}`, import_id: 'imp1', round: body.round, shot: s, kind: 'run', state: i ? 'waiting' : 'failed', error: i ? undefined : 'boom (node 4, KSampler)' }))], active: 1 + body.shots.length }; return json(state.queue.imports[0]) }
    if (method === 'POST' && path === '/queue/purge') { const q = state.queue || { imports: [], tasks: [] }; const live = new Set(q.tasks.filter((t) => ['waiting', 'running', 'held'].includes(t.state)).map((t) => t.import_id)); const gone = q.imports.filter((i) => !live.has(i.id)).map((i) => i.id); state.purged = body; q.imports = q.imports.filter((i) => !gone.includes(i.id)); q.tasks = q.tasks.filter((t) => !gone.includes(t.import_id)); return json({ removed_imports: gone.length }) }
    if (method === 'GET' && path === '/queue') { if (state.queueDelayMs) await new Promise((r) => setTimeout(r, state.queueDelayMs)); if (state.queueFail) return json({ detail: state.queueFail }, 500); return json(state.queue || { imports: [], tasks: [], active: 0 }) }   // queueDelayMs / queueFail: a slow or failing Queue
    // Auto sync (ADR-046): state.autosync = { settings: { podId: {...} }, status: { paused, items } }; a test sets progress and finished states there. state.autosyncOld = true answers like a core that predates it.
    if (path.startsWith('/autosync')) {
      const as = (state.autosync ||= { settings: {}, status: { paused: false, items: [] } })
      if (state.autosyncOld) return json({ detail: `no core call autosync.${path.slice(10) || 'get'}` }, 500)
      const DEF = { enabled: false, pull: true, push: false, approved_by: '' }
      if (method === 'GET' && path === '/autosync') return json({ ...DEF, ...(as.settings[query.pod_id] || {}) })
      if (method === 'PUT' && path === '/autosync') {
        if (body.enabled && !String(body.approved_by || '').trim()) return json({ detail: 'Auto sync needs the name of who says yes' }, 400)
        const { pod_id, ...rest } = body
        as.settings[pod_id] = { ...DEF, ...rest, ...(rest.enabled ? { approved_at: '2026-11-18T10:00:00Z' } : {}) }
        return json(as.settings[pod_id])
      }
      if (method === 'GET' && path === '/autosync/status') return json(as.status)
      if (method === 'POST' && path === '/autosync/pause') { as.status.paused = !!body.on; return json({ paused: as.status.paused }) }
      if (method === 'POST' && path === '/autosync/sync-now') return json({ ok: true })
      if (method === 'POST' && path === '/autosync/approve') { const it = as.status.items.find((i) => i.pod_id === body.pod_id); if (it && !as.keepApproval) it.state = body.yes ? 'syncing' : 'idle'; return json({ ok: true }) }
      if (method === 'POST' && path === '/autosync/dismiss') { as.status.items = as.status.items.filter((i) => i.pod_id !== body.pod_id); return json({ ok: true }) }
    }
    // Sync explorer and logs (ADR-046): state.syncs = { active: [...], recent: [...], logs: { runId: [lines] }, watch: {...} }; a test edits them between polls.
    // state.syncsOld = true answers like a core that predates them. A failing call: state.failures['GET /syncs/log'] = 'why'.
    if (path.startsWith('/syncs/')) {
      if (state.syncsOld) return json({ detail: `no core call syncs.${path.slice(7)}` }, 500)
      const sy = (state.syncs ||= {})
      if (method === 'GET' && path === '/syncs/active') return json({ items: sy.active || [] })
      if (method === 'GET' && path === '/syncs/recent') { const r = (sy.recent || []).filter((x) => !query.pod_id || x.pod_id === query.pod_id); return json(r.slice(0, Number(query.limit) || 50)) }
      if (method === 'GET' && path === '/syncs/log') {
        let ls = (sy.logs || {})[query.run_id] || []
        if (query.level === 'warn') ls = ls.filter((l) => l.level === 'warn' || l.level === 'error')
        if (query.level === 'error') ls = ls.filter((l) => l.level === 'error')
        const off = Number(query.offset) || 0, lim = Number(query.limit) || 500
        return json({ run_id: query.run_id, lines: ls.slice(off, off + lim), total: ls.length, truncated: false })
      }
      if (method === 'GET' && path === '/syncs/watch') return json({ paused: false, pull: [], push: [], events: [], ...(sy.watch || {}) })
    }
    // Graph failures (the core's failures.list): state.failures = [records]; state.noFailures answers like a core without it
    // state.failures records may carry `dismissed: true` (hidden from the Queue by id; the core keeps failures.jsonl as it is): list ?dismissed=hide|only|all, plan/dismiss/restore take { ids } or { all: true }
    if (path === '/failures' && method === 'GET') {
      if (state.noFailures) return json({ detail: 'no core call failures.list' }, 500)
      const all = Array.isArray(state.failures) ? state.failures : [], mode = query.dismissed || 'hide'   // the default state is {}
      return json({ failures: all.filter((f) => mode === 'all' || (mode === 'only') === !!f.dismissed), dismissed_count: all.filter((f) => f.dismissed).length })
    }
    if (path === '/failures/plan' && method === 'POST') { const all = Array.isArray(state.failures) ? state.failures : [], pick = body.all ? all.filter((f) => !!f.dismissed === !!body.restore) : all.filter((f) => (body.ids || []).includes(f.id)); (state.failurePlans ||= []).push(body); return json({ count: body.all ? pick.length : (body.ids || []).length, ids: pick.map((f) => f.id), all: !!body.all }) }
    if (path === '/failures/dismiss' && method === 'POST') { (state.failureDismisses ||= []).push(body); const all = Array.isArray(state.failures) ? state.failures : []; let n = 0; for (const f of all) if (!f.dismissed && (body.all || (body.ids || []).includes(f.id))) { f.dismissed = true; n++ } return json({ dismissed: n, total_dismissed: all.filter((f) => f.dismissed).length }) }
    if (path === '/failures/restore' && method === 'POST') { (state.failureRestores ||= []).push(body); const all = Array.isArray(state.failures) ? state.failures : []; let n = 0; for (const f of all) if (f.dismissed && (body.all || (body.ids || []).includes(f.id))) { f.dismissed = false; n++ } return json({ restored: n, total_dismissed: all.filter((f) => f.dismissed).length }) }
    if (path === '/failures/retry' && method === 'POST') { (state.failureRetries ||= []).push(body.id); const f = (state.failures || []).find((x) => x.id === body.id); if (f) f.attempt = (f.attempt || 1) + 1; return json({ ok: true }) }
    // The EDL (docs/ADR-050): state.edl = { loaded, source, sha256, events, elements: [{clip, shot, element, ...}], loaded_at, afterLoad: {...status after Load}, loadError }; state.noEdl answers like a core without it
    if (path.startsWith('/edl/')) {
      if (state.noEdl) return json({ detail: `no core call edl.${path.slice(5)}` }, 500)
      const ed = (state.edl ||= { loaded: false, elements: [] })
      const status = () => ({ loaded: !!ed.loaded, source: ed.source || '', sha256: ed.sha256 || '', events: ed.events ?? 0, elements: (ed.elements || []).length, loaded_at: ed.loaded_at || '', ...(ed.error ? { error: ed.error } : {}) })
      if (method === 'GET' && path === '/edl/status') return json(status())
      if (method === 'POST' && path === '/edl/load') {
        (ed.loads ||= []).push(body)
        if (ed.loadError) return json({ detail: ed.loadError }, 500)
        Object.assign(ed, { loaded: true, source: body.source || 'rounds/tunnel-v11-edl-2026-11-18/PANAMA 2026_2.0_v11_110426_COLOR_VFX1.edl', sha256: '7511c0ffee', events: 121, loaded_at: '2026-11-19T10:00:00Z', ...(ed.afterLoad || {}) })
        return json(status())
      }
      if (method === 'GET' && path === '/edl/elements') return json(ed.elements || [])
      if (method === 'POST' && path === '/edl/lookup') {
        (ed.lookups ||= []).push(body)
        const hits = (ed.elements || []).filter((e) => (!body.clip || e.clip === body.clip) && (!body.shot || e.shot === body.shot) && (!body.element || e.element === body.element))
        if (!hits.length && body.clip) { const sh = (/^([A-Za-z]+-\d+[a-z]?)/i.exec(body.clip) || [, ''])[1].toLowerCase(); hits.push(...(ed.elements || []).filter((e) => e.shot === sh)) }   // no exact clip: the shot's elements are the candidates
        return json(hits.length === 1 ? { match: body.clip ? 'exact' : 'unique', element: hits[0] } : hits.length ? { match: 'ambiguous', candidates: hits.map((h) => h.clip) } : { match: 'none' })
      }
    }
    // Publishing (S3 and Slack): state.publish = { settings, tree: { dir: [entries] }, sizes, there: [paths already on S3], heavy: [paths refused as weights], jobs, puts, tests, planned, runs, reposts }; state.publishOld answers like a core without it.
    // Frame previews (a pod job): start makes a job that is done on the second status call; list answers what the jobs wrote; state.fp = { jobs, written: { src_dir: [jpg names] }, starts, lists, fail: { src_dir: [frame numbers] } }
    if (method === 'POST' && path.startsWith('/framepreviews/')) {
      const fp = (state.fp ||= { jobs: {}, written: {}, starts: [], lists: [], fail: {} }), op = path.slice(15)
      if (op === 'start') {
        if (state.fpPodOff) return json({ detail: 'Start the pod: the previews are made on the pod' }, 409)
        fp.starts.push(body); const id = `framepreviews-${fp.starts.length}`, items = body.items || []
        fp.jobs[id] = { id, pod_id: body.pod_id, items, tone: body.tone || 'gamma26', skip_existing: body.skip_existing !== false, state: 'running', started_at: new Date().toISOString(), done: 0, skipped: 0, failed: [], total: items.reduce((n, i) => n + (i.frames || 0), 0), current: items[0]?.src_dir || '', polls: 0, done_dirs: [], ...(body.relaunch_of ? { relaunch_of: body.relaunch_of } : {}), willFail: !!state.fpFailFirst && fp.starts.length === 1 }
        return json(fp.jobs[id])
      }
      if (op === 'status') {
        const j = fp.jobs[body.job_id]; if (!j) return json(null)
        if (j.state === 'running' && j.willFail && j.polls >= 1 && !state.fpHold) { j.state = 'failed'; j.error = `the script ended with code 255 on ${j.items[0]?.src_dir}`; return json(j) }   // a pod that went away: nothing finished
        if (j.state === 'running' && ++j.polls >= 2 && !state.fpHold) {
          for (const it of j.items) {
            const bad = fp.fail[it.src_dir] || [], had = new Set(fp.written[it.src_dir] || []), names = []
            for (let n = 0; n < (it.frames || 0); n++) {
              const stem = `${it.stem || 'x'}.${String(n).padStart(4, '0')}`
              if (bad.includes(n)) { j.failed.push({ src_dir: it.src_dir, frame: `${stem}.jpg`, reason: 'not a DPX' }); continue }
              if (had.has(`${stem}.jpg`) && j.skip_existing) j.skipped++; else j.done++
              names.push(`${stem}.jpg`)
            }
            fp.written[it.src_dir] = names
            ;(fp.thumbs ||= {})[it.src_dir] = [...names]   // the script writes a thumbnail beside every preview, also for frames that already had their JPEG
          }
          j.state = 'done'; j.done_dirs = j.items.map((i) => i.src_dir)
        }
        return json(j)
      }
      if (op === 'relaunch') {
        const row = (state.fpJobRows || []).find((r) => r.job_id === body.job_id)   // a Queue row a test made up: its job is a one-folder job that did not finish
        const old = fp.jobs[body.job_id] || (row && { id: row.job_id, pod_id: row.pod_id, items: [{ src_dir: 'base_v008/photoreal-013/sunlight', frames: row.frames_total }], tone: 'gamma26', done_dirs: [] }); if (!old) return json({ detail: `No frame-previews job ${body.job_id}` }, 404)
        ;(fp.relaunches ||= []).push(body)
        if (state.fpNeedsPod) return json({ ok: false, needs_pod: { stopped: [{ id: 'pod-bbbbbbbb', name: 'ComfyUI-Landing' }], hint: 'No pod is running on this volume: resume one' } })
        const items = old.items.filter((i) => !(old.done_dirs || []).includes(i.src_dir)); if (!items.length) return json({ ok: true, nothing_to_do: true })
        const id = `framepreviews-${Object.keys(fp.jobs).length + 1}`
        fp.jobs[id] = { id, pod_id: old.pod_id, items, tone: old.tone, skip_existing: true, state: 'running', started_at: new Date().toISOString(), done: 0, skipped: 0, failed: [], total: items.reduce((n, i) => n + (i.frames || 0), 0), current: items[0]?.src_dir || '', polls: 0, done_dirs: [], relaunch_of: old.id }
        return json({ ok: true, job: fp.jobs[id] })
      }
      if (op === 'cancel') { const j = fp.jobs[body.job_id]; if (j) j.state = 'cancelled'; return json({ ok: !!j, state: j?.state }) }
      // the Queue's rows (libs/core framepreviews.jobsList): a test sets state.fpJobRows (the rows as the core sends them) or the rows are made from the jobs the fake has; state.fpJobsOld answers like a core without the call
      if (op === 'jobs') {
        if (state.fpJobsOld) return json({ detail: 'no core call framepreviews.jobs' }, 500)
        if (state.fpJobRows) return json({ jobs: state.fpJobRows })
        return json({ jobs: Object.values(fp.jobs).map((j) => ({ job_id: j.id, pod_id: j.pod_id, state: j.state, started_at: j.started_at, ...(j.finished_at ? { finished_at: j.finished_at } : {}), external: false, trigger: j.trigger || 'manual', items: j.items.length, current: j.current, ...(j.error ? { error: j.error } : {}), ...(j.relaunch_of ? { relaunch_of: j.relaunch_of } : {}), relaunchable: j.state !== 'running' && (j.state !== 'done' || (j.failed || []).length > 0 || j.items.some((i) => !(j.done_dirs || []).includes(i.src_dir))), frames_total: j.total, frames_done: j.done + j.skipped, frames_written: j.done, thumbs_done: j.state === 'done' ? j.done + j.skipped : 0, thumbs_made: j.state === 'done' ? j.done : 0, posters_total: 0, posters_done: 0, posters_failed: 0, failed: (j.failed || []).length })) })
      }
      if (op === 'cancelAny') {
        const row = (state.fpJobRows || []).find((r) => r.job_id === body.job_id)
        if (row) { row.state = 'cancelled'; (fp.cancelAny ||= []).push(body.job_id); return json({ ok: true, own: !row.external }) }
        const j = fp.jobs[body.job_id]; if (j) j.state = 'cancelled'
        return json({ ok: !!j, own: true, state: j?.state })
      }
      if (op === 'list') {
        if (state.fpPodOff) return json({ detail: 'Start the pod: the previews are made on the pod' }, 409)
        fp.lists.push(body); const previews = {}, subfolders = {}
        for (const it of body.items || []) { const names = fp.written[it.src_dir] || []; previews[it.src_dir] = { count: names.length, ...(body.names ? { names, thumbs: (fp.thumbs || {})[it.src_dir] || [], posters: (fp.posters || {})[it.src_dir] || [] } : {}) }; subfolders[it.src_dir] = `.previews/${it.src_dir}` }
        return json({ previews, subfolders })
      }
    }
    if (method === 'POST' && path === '/dpxfix/run') { (state.dpxfixRuns ||= []).push(body); return json({ out_root: '/workspace/comfy-shared/output/_delivery_v11', results: body.items.map((i) => ({ clip: i.clip, frames: 10, out_dir: `_delivery_v11/${i.clip}`, ok: !(state.dpxfixFail || []).includes(i.clip), ...((state.dpxfixFail || []).includes(i.clip) ? { error: 'ERR short file' } : {}) })) }) }
    if (path.startsWith('/publish/')) {
      if (state.publishOld) return json({ detail: `no core call publish.${path.slice(9)}` }, 500)
      const pb = (state.publish ||= {})
      pb.settings ||= { s3: { bucket: 'bh-panama-exchange-610140802195', prefix: 'returns/BKK/', region: 'us-west-2', endpoint: '', credentials: 'panama', access_key_hint: '', presign_hours: 72, transfer: 'auto', note: 'Lucas, 2026-11-19: Panama exchange bucket, returns/BKK/' }, slack: { workspace_name: 'Beinghuman', workspace_url: 'https://beinghuman-hq.slack.com', channel: '', username: 'RunPod Manager', webhook_hint: '' }, defaults: { targets: ['s3', 'slack'], message: '{shot} {version} is on S3: {links}' } }
      pb.tree ||= {}; pb.there ||= []; pb.heavy ||= []; pb.jobs ||= []
      for (const k of ['puts', 'tests', 'planned', 'runs', 'reposts', 'cancelled']) pb[k] ||= []
      const st = pb.settings
      if (pb.linksSupport && typeof st.slack.file_links !== 'boolean') Object.assign(st.slack, { file_links: true, folder_link: true, file_link_count: 10 })   // a core with the link settings (default ON, 10 files): state.publish.linksSupport = true
      const linksPlan = () => (pb.linksSupport ? { links: { folder: st.slack.folder_link !== false, files: st.slack.file_links === false ? 0 : Math.min(st.slack.file_link_count ?? 10, 25), expires_at: '2026-11-26T10:00:00Z' } } : {})
      if (pb.volumeSourceSupport && typeof st.slack.volume_source !== 'boolean') st.slack.volume_source = true   // a core with the volume source line: state.publish.volumeSourceSupport = true
      const volLine = (fromVolume) => (pb.volumeSourceSupport && st.slack.volume_source !== false && fromVolume ? ' Source on the volume: comfy-shared · output/archival-085 (and 1 more)' : '')
      if (pb.previewSupport && typeof st.slack.preview_frame !== 'boolean') st.slack.preview_frame = true   // a core with the first-frame preview: the setting exists (default on); state.publish.previewSupport = true
      // first frames of up to 3 shots (a video, or the first file of a DPX folder), for the plan of a core with the preview: { slack.preview_frames, previews[] }
      const previewPlan = (items, body) => {
        if (!pb.previewSupport) return {}
        const want = typeof body.preview_frame === 'boolean' ? body.preview_frame : st.slack.preview_frame !== false
        const seen = new Map()
        for (const i of items) { if (i.skip && !pb.previewSkipped) continue; const m = /\.(mov|mp4|dpx)$/i.exec(i.path); if (!m) continue; const dir = i.path.replace(/\/[^/]+$/, ''), key = /dpx/i.test(m[1]) ? dir : i.path; if (!seen.has(key)) seen.set(key, i) }
        const list = want ? [...seen.values()].slice(0, 3).map((i) => { const stem = i.path.split('/').pop().replace(/\.[^.]+$/, '').replace(/\.\d+$/, ''); return { name: `${stem}_preview.jpg`, s3_key: `${String(i.s3_key).replace(/\/[^/]+$/, '')}/${stem}_preview.jpg` } }) : []
        return { previews: list, preview_frames: list.length, ...(want && !list.length && pb.previewProblem ? { preview_problem: pb.previewProblem } : {}) }
      }
      // The BKK return layout (state.publish.layoutSupport = true): s3_key per item as <prefix><round>/<shot>/<clip>/<clip>.<frame>.dpx, <round>/<shot>/<clip>.<ext>, <round>/<shot>/<file>; clip_names renames a DPX stem
      const shotOf = (stem) => (/^([A-Za-z]+-\d+[a-z]?)/i.exec(stem) || [, 'shot'])[1].toLowerCase()
      const returnKeys = (items, body) => {
        for (const it of items) {
          const file = it.path.split('/').pop(), dpx = /^(.+)\.(\d+)\.dpx$/i.exec(file), pre = `${(st.s3.prefix || '').replace(/\/?$/, '/')}${body.round || '<round>'}/`
          if (dpx) { const stem = dpx[1], clip = (body.clip_names || {})[stem] || stem; it.s3_key = `${pre}${shotOf(clip)}/${clip}/${clip}.${dpx[2]}.dpx`; if (clip !== stem) it.renamed_from = stem }
          else if (/\.(mp4|mov)$/i.test(file)) it.s3_key = `${pre}${shotOf(file)}/${file}`
          else it.s3_key = `${pre}${shotOf(file)}/${file}`
        }
      }
      const view = () => {
        const s3 = { ...(pb.layoutSupport ? { layout: 'bkk-return' } : {}), ...st.s3, ready: !!st.s3.bucket && (st.s3.credentials === 'panama' ? pb.panamaKeys !== false : !!st.s3.access_key_hint) }
        if (!s3.ready) s3.problem = !st.s3.bucket ? 'Enter a bucket' : st.s3.credentials === 'panama' ? 'The Panama exchange keys are not set' : 'Enter the access keys'
        const slack = { ...st.slack, ready: !!st.slack.channel && !!st.slack.webhook_hint }
        if (!slack.ready) slack.problem = !st.slack.webhook_hint ? 'Enter the webhook' : 'Enter a channel'
        return { s3, slack, defaults: st.defaults }
      }
      // Scan and backfill: state.publish.inventory = { rows, by_shot, unreadable } (a test sets it), state.publish.scanSteps = how many polls answer 'scanning' first, state.publish.backfillOld answers like a core without it
      if (path.startsWith('/publish/backfill/')) {
        if (pb.backfillOld) return json({ detail: `no core call publish.backfill${path.slice(17)}` }, 500)
        pb.scans ||= []; pb.bfPlans ||= []; pb.bfRuns ||= []
        const inv = pb.inventory || { rows: [], by_shot: {}, unreadable: [] }
        if (path === '/publish/backfill/scan') { pb.scans.push(body); pb.scanPolls = 0; return json({ job_id: 'scan-1' }) }
        if (path === '/publish/backfill/inventory') { pb.scanPolls = (pb.scanPolls || 0) + 1; const busy = pb.scanPolls <= (pb.scanSteps || 0); return json({ state: busy ? 'scanning' : 'done', scanned: pb.scanPolls * 100, rows: busy ? [] : inv.rows, by_shot: inv.by_shot, unreadable: inv.unreadable || [] }) }
        if (path === '/publish/backfill/plan') {
          pb.bfPlans.push(body)
          const v = view(), blockers = [...(pb.blockers || [])]
          for (const tg of body.targets || []) if (!v[tg].ready) blockers.push(`${tg === 's3' ? 'S3' : 'Slack'} is not ready: ${v[tg].problem}`)
          const rows = inv.rows.filter((r) => (body.rows || []).includes(r.id)), items = rows.map((r) => ({ path: r.path, bytes: r.bytes, s3_key: pb.layoutSupport ? `${body.destination_prefix}${body.round || '<round>'}/${r.shot}/${(body.clip_names || {})[r.name] || r.name}${r.kind === 'dpx' ? '/' : ''}` : `${body.destination_prefix}${r.shot}/${r.name}`, skip: !!r.in_destination }))
          const total = items.filter((i) => !i.skip).reduce((n, i) => n + i.bytes, 0)
          return json({ ...(pb.layoutSupport ? { layout: 'bkk-return', round: body.round || '' } : {}), ok: !blockers.length && !!items.length, blockers, items, total_bytes: total, files: items.filter((i) => !i.skip).length, refused: [], s3: { dest: `s3://${st.s3.bucket}/${body.destination_prefix}`, count: items.length, new_bytes: total }, slack: (body.targets || []).includes('slack') ? { channel: st.slack.channel, preview: String(body.message || st.defaults.message).replace('{files}', String(items.length)) + volLine(rows.some((r) => !(r.where || []).includes('pc'))), ...(pb.previewSupport ? (({ previews, ...r }) => r)(previewPlan(items, body)) : {}), ...linksPlan() } : null, ...(pb.previewSupport ? { previews: previewPlan(items, body).previews } : {}) })
        }
        if (path === '/publish/backfill/run') {
          pb.bfRuns.push(body)
          if (!body.approved_by) return json({ detail: 'Publishing needs the name of who says yes (approved_by)' }, 400)
          if (pb.layoutSupport && !body.round) return json({ detail: 'Publishing to a return needs a round name' }, 400)
          const n = pb.bfRuns.length
          pb.jobs.push({ job_id: `bf-${n}`, state: 'uploading', phase: 'streaming', targets: body.targets, approved_by: body.approved_by, started_at: `2026-11-19T11:0${n}:00Z`, ...(pb.runWarnings ? { warnings: pb.runWarnings } : {}), files_total: (body.rows || []).length, files_done: 0, bytes_total: 5e9, bytes_done: 0, rate_bps: 0, current: '', skipped: 0, links: pb.runLinks || [], slack: { state: 'skipped' }, summary: '' })
          return json({ job_id: `bf-${n}` })
        }
      }
      // The volume's comfy-shared/output/ as a publish source: state.publish.vtree = { dir: [entries] } (entries as in the local tree, plus empty: true), vsizes = { path: { files, bytes } }, volumeOld answers like a core without it
      if (path === '/publish/volume' || path === '/publish/volume-size') {
        if (pb.volumeOld) return json({ detail: `no core call publish.${path === '/publish/volume' ? 'volume' : 'volumeSize'}` }, 500)
        pb.vtree ||= {}; pb.vsizes ||= {}
        if (path === '/publish/volume-size') { (pb.vsizeCalls ||= []).push(query.path); if (pb.vsizeMs) await new Promise((r) => setTimeout(r, pb.vsizeMs)); return json(pb.vsizes[query.path] || { files: 0, bytes: 0 }) }
        const dir = query.dir || ''
        return json({ dir, parent: dir ? dir.replace(/\/?[^/]+$/, '') : null, entries: pb.vtree[dir] || [] })
      }
      if (method === 'GET' && path === '/publish/settings') return json(view())
      if (method === 'PUT' && path === '/publish/settings') {
        pb.puts.push(body)
        if (body.s3 && body.s3.bucket !== undefined && body.s3.bucket !== '' && !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(body.s3.bucket)) return json({ detail: 's3.bucket: a bucket name is 3 to 63 lowercase letters, digits, dots or dashes' }, 400)
        if (body.slack && body.slack.channel && !/^[#@][\w-]+$/.test(body.slack.channel)) return json({ detail: 'slack.channel: a channel starts with # (for example #deliveries)' }, 400)
        if (body.slack && body.slack.webhook_url && !/^https:\/\/hooks\.slack\.com\//.test(body.slack.webhook_url)) return json({ detail: 'slack.webhook_url: an Incoming Webhook address starts with https://hooks.slack.com/' }, 400)
        if (body.s3) { const { access_key_id, secret_access_key, ...rest } = body.s3; Object.assign(st.s3, rest); if (access_key_id) st.s3.access_key_hint = '••••' + String(access_key_id).slice(-4) }
        if (body.slack) { const { webhook_url, ...rest } = body.slack; Object.assign(st.slack, rest); if (webhook_url) st.slack.webhook_hint = '••••' + String(webhook_url).slice(-4) }
        if (body.defaults) st.defaults = { ...st.defaults, ...body.defaults }
        for (const c of body.clear || []) { if (c === 's3_keys') st.s3.access_key_hint = ''; if (c === 'slack_webhook') st.slack.webhook_hint = '' }
        return json(view())
      }
      if (method === 'POST' && path === '/publish/test') { pb.tests.push(body); return json(pb.testResult?.[body.target] || { ok: true, detail: body.target === 's3' ? '3 objects listed' : 'posted to ' + st.slack.channel }) }
      if (method === 'GET' && path === '/publish/local') {
        const dir = query.dir || ''
        if (!pb.tree[dir]) return json({ dir, parent: dir ? dir.replace(/\/?[^/]+$/, '') : null, entries: [] })
        return json({ dir, parent: dir ? dir.replace(/\/?[^/]+$/, '') : null, entries: pb.tree[dir], ...(pb.truncated ? { truncated: pb.truncated } : {}) })
      }
      const vfiles = () => Object.values(pb.vtree || {}).flat().filter((e) => !e.dir)
      const files = () => Object.values(pb.tree).flat().filter((e) => !e.dir && !e.remote)   // remote: true is a file that is only on the volume (not on this PC)
      const expand = (p) => { const f = files(); const hit = f.filter((e) => e.path === p || e.path.startsWith(p.replace(/\/$/, '') + '/')); return hit }
      if (method === 'POST' && path === '/publish/plan') {
        pb.planned.push(body)
        const v = view(), blockers = []
        blockers.push(...(pb.blockers || []))
        for (const tg of body.targets || []) if (!v[tg].ready) blockers.push(`${tg === 's3' ? 'S3' : 'Slack'} is not ready: ${v[tg].problem}`)
        const items = [], refused = []
        let streamedFiles = 0, streamedBytes = 0
        for (const it of body.items || []) {
          if (typeof it === 'object' && it.where === 'volume') {
            const hit = vfiles().filter((e) => e.path === it.path || e.path.startsWith(it.path.replace(/\/$/, '') + '/'))
            if (!hit.length) { refused.push({ path: it.path, reason: 'Nothing found on the volume' }); continue }
            for (const e of hit) { items.push({ path: e.path, bytes: e.bytes, s3_key: [st.s3.prefix, e.path].filter(Boolean).join('/'), skip: pb.there.includes(e.path), source: 'volume' }); streamedFiles++; streamedBytes += e.bytes }
          }
        }
        for (const p of (body.items || []).filter((x) => typeof x === 'string')) { if ((pb.heavy || []).includes(p)) { refused.push({ path: p, reason: 'model weights are not published' }); continue } const hit = expand(p); if (!hit.length) { refused.push({ path: p, reason: 'Pull the renders to this PC first' }); continue } for (const e of hit) items.push({ path: e.path, bytes: e.bytes, s3_key: [st.s3.prefix, e.path].filter(Boolean).join('/'), skip: pb.there.includes(e.path) }) }
        if (pb.layoutSupport) returnKeys(items, body)
        const total = items.filter((i) => !i.skip).reduce((n, i) => n + i.bytes, 0)
        return json({ ...(pb.layoutSupport ? { layout: 'bkk-return', round: body.round || '' } : {}), ...(pb.planSequences ? { sequences: pb.planSequences.map((r) => ({ ...r, flags: (r.flags || []).filter((f) => !(f.code === 'frames-differ-from-edl' && (body.edl_override || {})[r.stem || r.name])) })) } : {}), streamed_files: streamedFiles, streamed_bytes: streamedBytes, ok: !blockers.length && !!items.length, blockers, items, total_bytes: total, files: items.filter((i) => !i.skip).length, refused,
          s3: (body.targets || []).includes('s3') ? { dest: `s3://${st.s3.bucket}/${st.s3.prefix ? st.s3.prefix + '/' : ''}`, count: items.length, new_bytes: total } : null,
          slack: (body.targets || []).includes('slack') ? { channel: st.slack.channel, preview: String(body.message || st.defaults.message).replace('{files}', String(items.length)).replace('{links}', '<link>').replace('{who}', 'you') + volLine(items.some((i) => i.source === 'volume')), ...(pb.previewSupport ? (({ previews, ...r }) => r)(previewPlan(items, body)) : {}), ...linksPlan() } : null, ...(pb.previewSupport ? { previews: previewPlan(items, body).previews } : {}) })
      }
      if (method === 'POST' && path === '/publish/run') {
        pb.runs.push(body)
        if (!body.approved_by) return json({ detail: 'Publishing needs the name of who says yes (approved_by)' }, 400)
        if (pb.runError) return json({ detail: pb.runError }, 400)
        if (pb.layoutSupport && !body.round) return json({ detail: 'Publishing to a return needs a round name' }, 400)
        if (pb.layoutSupport && !/^[A-Za-z0-9._-]{3,100}$/.test(body.round)) return json({ detail: 'round: 3 to 100 letters, digits, dots, dashes or underscores' }, 400)
        const n = pb.runs.length
        pb.jobs.push({ job_id: `pub-${n}`, state: 'uploading', targets: body.targets, approved_by: body.approved_by, started_at: `2026-11-19T10:0${n}:00Z`, ...(pb.runWarnings ? { warnings: pb.runWarnings } : {}), files_total: 3, files_done: 0, bytes_total: 3e9, bytes_done: 0, rate_bps: 0, current: '', skipped: 0, links: pb.runLinks || [], slack: { state: 'skipped' }, summary: '' })
        return json({ job_id: `pub-${n}` })
      }
      if (method === 'GET' && path === '/publish/status') return json({ jobs: pb.jobs.filter((j) => !query.job_id || j.job_id === query.job_id) })
      if (method === 'GET' && path === '/publish/rounds') { if (!pb.layoutSupport) return json({ detail: 'no core call publish.rounds' }, 500); return json({ rounds: pb.rounds || [] }) }
      if (method === 'POST' && path === '/publish/retry') { (pb.retries ||= []).push(body.child_id); for (const j of pb.jobs) for (const c of j.children || []) if (c.id === body.child_id) { c.state = 'queued'; c.error = '' } return json({ ok: true }) }
      if (method === 'POST' && path === '/publish/cancel') { pb.cancelled.push(body.job_id); const j = pb.jobs.find((x) => x.job_id === body.job_id); if (j) j.state = 'cancelled'; for (const p of pb.jobs) for (const c of p.children || []) if (c.id === body.job_id) c.state = 'cancelled'; return json(j || {}) }
      if (method === 'POST' && path === '/publish/slack') { pb.reposts.push(body.job_id); const j = pb.jobs.find((x) => x.job_id === body.job_id); if (j) j.slack = { state: 'sent' }; return json(j || {}) }
    }
    // Auto-publish (docs/ADR-050 amendment): the settings are the Default Configuration's auto_publish; state.autopublish = { pending, recent, reviews, today }; state.noAutoPublish answers like a core without it; every write is recorded in state.autopublish.calls
    if (path.startsWith('/autopublish/')) {
      if (state.noAutoPublish) return json({ detail: `no core call autopublish.${path.slice(13)}` }, 500)
      const ap = (state.autopublish ||= {})
      ap.pending ||= []; ap.recent ||= []; ap.reviews ||= []; ap.calls ||= []
      const cfg = (state.mounts.config.auto_publish ||= { enabled: false, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false } })
      const pubSt = (state.publish ||= {}).settings, slackOk = !!(pubSt?.slack?.channel && pubSt?.slack?.webhook_hint)
      const s3dest = () => `s3://${pubSt?.s3?.bucket || 'bh-panama-exchange-610140802195'}/${pubSt?.s3?.prefix || 'returns/BKK/'}`
      const view = () => ({ enabled: cfg.enabled, dry_run: cfg.dry_run, ...('dry_run_first' in cfg ? { dry_run_first: cfg.dry_run_first } : {}), window_minutes: cfg.window_minutes, daily_cap: cfg.daily_cap, targets: cfg.targets, standing: cfg.standing || null, destination: s3dest(), ready: true,
        target_state: { s3: { ready: true, label: 'S3' }, slack: { ready: slackOk, label: 'Slack', ...(slackOk ? {} : { problem: 'Slack is not connected' }) }, tunnel: { ready: false, problem: 'Tunnel is not available yet', label: 'Tunnel' } } })
      if (method === 'GET' && path === '/autopublish/status') return json({ enabled: cfg.enabled, dry_run: cfg.dry_run, standing: cfg.standing || null, window_minutes: cfg.window_minutes, daily_cap: cfg.daily_cap, targets: cfg.targets, today: ap.today || { count: 0, left: cfg.daily_cap ?? null }, destination: s3dest(), ...(ap.watching ? { watching: { ...ap.watching, ...(ap.dismissed ? { dismissed: ap.dismissed } : {}) } } : {}), ...(ap.generate ? { generate: ap.generate } : {}), ...(ap.requireApproval !== undefined ? { require_approval: ap.requireApproval } : {}), ...(ap.nothing_selected ? { nothing_selected: true } : {}), ...(ap.slack_dry_run ? { slack_dry_run: ap.slack_dry_run } : {}), pending: ap.pending, recent: ap.recent })
      if (method === 'GET' && path === '/autopublish/settings') return json(view())
      if (method === 'PUT' && path === '/autopublish/settings') {
        ap.calls.push({ call: 'setSettings', body })
        if (ap.failNext) { const d = ap.failNext; ap.failNext = null; return json({ detail: d }, 400) }
        const t = body.targets
        if (body.daily_cap !== undefined && body.daily_cap !== null && !(Number.isInteger(body.daily_cap) && body.daily_cap >= 1 && body.daily_cap <= 50)) return json({ detail: 'daily_cap: a whole number from 1 to 50, or none' }, 400)
        if (t?.tunnel) return json({ detail: 'targets.tunnel: Tunnel is not available yet' }, 400)
        if (body.enabled === true) {
          if (!String(body.approved_by || '').trim()) return json({ detail: 'approved_by: Auto-publish needs the name of who says yes' }, 400)
          if (body.understood !== true) return json({ detail: 'understood: tick that you understand what this allows' }, 400)
          if ('dry_run_first' in cfg && typeof body.dry_run_first === 'boolean') cfg.dry_run_first = body.dry_run_first
          cfg.enabled = true; cfg.dry_run = 'dry_run_first' in cfg ? cfg.dry_run_first !== false : true; cfg.standing = { approved_by: body.approved_by, at: '2026-11-19T10:00:00Z' }
        }
        if (body.dry_run === false) { if (!cfg.enabled || !cfg.standing) return json({ detail: 'Going live needs the standing approval: turn Auto-publish on first' }, 400); if (body.understood !== true) return json({ detail: 'Confirm that the next approved version will really be uploaded' }, 400); cfg.dry_run = false }
        if (body.dry_run === true) cfg.dry_run = true
        for (const k of ['window_minutes', 'daily_cap']) if (body[k] !== undefined) cfg[k] = body[k]
        if (t) cfg.targets = { ...cfg.targets, ...t }
        return json(view())
      }
      if (method === 'GET' && path === '/autopublish/dry-run-report') { if (ap.noDryReport) return json({ detail: 'no core call autopublish.dryRunReport' }, 500); return json({ text: ap.dryReportText || 'Dry run: would upload 1 review video' }) }
      if (method === 'POST' && path === '/autopublish/scan-volume') {
        ap.calls.push({ call: 'scanVolume' })
        if (ap.scanFail) return json({ detail: ap.scanFail }, 500)
        if (ap.watching?.volume) { ap.watching.volume.scanning = true; ap.watching.volume.scan_started_at = new Date().toISOString(); setTimeout(() => { Object.assign(ap.watching.volume, { scanning: false, scan_started_at: null, scanned_at: new Date().toISOString(), ...(ap.scanTo || {}) }) }, ap.scanMs ?? 1500) }
        return json({ ok: true })
      }
      // Holds (a core where every eligible review is published; state.autopublish.requireApproval defined): a hold keeps a shot version from ever going; Release lifts it
      if (method === 'GET' && path === '/autopublish/holds') { if (ap.requireApproval === undefined) return json({ detail: 'no core call autopublish.holds' }, 500); return json({ holds: ap.holds ||= [] }) }
      if (method === 'POST' && path === '/autopublish/hold') { ap.calls.push({ call: 'hold', body }); (ap.holds ||= []).push({ shot: body.shot, version: body.version }); const p = ap.pending.find((x) => x.shot === body.shot && x.version === body.version); if (p) { ap.pending = ap.pending.filter((x) => x !== p) } return json({ ok: true }) }
      if (method === 'POST' && path === '/autopublish/release') { ap.calls.push({ call: 'release', body }); ap.holds = (ap.holds || []).filter((h) => !(h.shot === body.shot && h.version === body.version)); return json({ ok: true }) }
      // Generate Outputs (state.autopublish.existing = the preview; existingError / existingNoPod / existingResult)
      if (method === 'POST' && path === '/autopublish/generate-existing') {
        ap.calls.push({ call: 'generateExisting', body })
        if (ap.existingError && body.dry_run) return json({ detail: ap.existingError }, 500)
        if (body.dry_run) return json(ap.existing || { sequences: [], skipped: [], totals: { sequences: 0, frames: 0, bytes: 0 }, where: 'local', preset: 'review', max_per_day: 20, today_started: 0, can_start_today: 0, remaining_after_today: 0, pod: null, notes: [] })
        const pv = ap.existing || {}
        if (pv.where === 'pod' && !body.approved_by) return json({ detail: "Rendering on a pod spends money: put the approver's name" }, 400)
        if (pv.where === 'pod' && !pv.pod?.running && body.where !== 'local') return json({ detail: 'No pod is running: it never starts one' }, 409)
        return json(ap.existingResult || { started: Math.min(body.limit ?? 99, (pv.sequences || []).length), deferred: Math.max(0, (pv.sequences || []).length - (body.limit ?? 99)) })
      }
      if (method === 'POST' && path === '/autopublish/off') { ap.calls.push({ call: 'off' }); const n = ap.pending.length; cfg.enabled = false; cfg.standing = null; ap.recent.unshift(...ap.pending.map((p) => ({ ...p, state: 'cancelled' }))); ap.pending = []; return json({ cancelled: n }) }
      if (method === 'GET' && path === '/autopublish/reviews') return json({ reviews: ap.reviews })
      if (method === 'GET' && path === '/autopublish/approvals') return json(ap.reviews.filter((r) => r.approved).map((r) => ({ shot: r.shot, version: r.version, ...r.approved })))
      if (method === 'POST' && path === '/autopublish/approve') {
        ap.calls.push({ call: 'approve', body })
        if (!String(body.approved_by || '').trim()) return json({ detail: 'Approving a shot version needs the name of who says yes' }, 400)
        const r = ap.reviews.find((x) => x.shot === body.shot && Number(x.version) === Number(body.version))
        if (!r) return json({ detail: 'That review does not exist' }, 404)
        r.approved = { approved_by: body.approved_by, at: '2026-11-19T10:30:00Z' }; r.state = 'waiting'
        return json({ ok: true })
      }
      if (method === 'POST' && path === '/autopublish/revoke') { ap.calls.push({ call: 'revoke', body }); const r = ap.reviews.find((x) => x.shot === body.shot && Number(x.version) === Number(body.version)); if (r) { r.approved = null; r.state = 'not approved' } return json({ ok: true }) }
      if (method === 'POST' && path === '/autopublish/cancel') { ap.calls.push({ call: 'cancel', body }); const p = ap.pending.find((x) => x.id === body.id); if (p) { ap.pending = ap.pending.filter((x) => x !== p); ap.recent.unshift({ ...p, state: 'cancelled' }) } return json({ ok: true }) }
      if (method === 'POST' && path === '/autopublish/publish-now') {
        ap.calls.push({ call: 'publishNow', body })
        if (!String(body.approved_by || '').trim()) return json({ detail: 'Publishing needs the name of who says yes (approved_by)' }, 400)
        const p = ap.pending.find((x) => x.id === body.id); if (p && p.state === 'would_upload' && ap.capSpent) return json({ detail: 'The daily cap is spent (5 a day): raise it in the settings or publish tomorrow' }, 400)
        if (p) { p.state = 'uploading'; p.job_id = 'pub-now' }
        return json({ job_id: 'pub-now' })
      }
      // Purge Dry Runs (plan without understood; a run with a name): only would_upload entries go; an entry with by_person (approved one by one) stays unless include_approved
      if (method === 'POST' && path === '/autopublish/purge-dry-runs') {
        ap.calls.push({ call: 'purgeDryRuns', body })
        const dry = ap.pending.filter((x) => x.state === 'would_upload'), go = dry.filter((x) => body.include_approved === true || !x.by_person), keep = dry.filter((x) => !go.includes(x)), brief = (x) => ({ id: x.id, shot: x.shot, version: x.version })
        const out = { entries: go.map(brief), kept_approved: keep.map(brief), note: 'Nothing is deleted from the volume, this PC or the bucket: only the dry-run list entries are dismissed.' }
        if (body.understood !== true) return json({ plan: true, purged: 0, would_purge: go.length, dismissed: ap.dismissed || 0, ...out })
        if (!String(body.approved_by || '').trim()) return json({ detail: 'Purging needs the name of who says yes (approved_by)' }, 400)
        ap.pending = ap.pending.filter((x) => !go.includes(x)); ap.dismissed = (ap.dismissed || 0) + go.length
        return json({ plan: false, purged: go.length, would_purge: go.length, dismissed: ap.dismissed, ...out })
      }
      if (method === 'POST' && path === '/autopublish/restore-dry-runs') { ap.calls.push({ call: 'restoreDryRuns' }); const n = ap.dismissed || 0; ap.dismissed = 0; return json({ restored: n }) }
      if (method === 'POST' && path === '/autopublish/publish-all-dry') {
        ap.calls.push({ call: 'publishAllDry', body })
        if (!String(body.approved_by || '').trim()) return json({ detail: 'Publishing needs the name of who says yes (approved_by)' }, 400)
        const list = ap.pending.filter((x) => x.state === 'would_upload'), started = [], refused = []
        for (const p of list) { if (ap.capSpent || (ap.allowOnly !== undefined && started.length >= ap.allowOnly)) refused.push({ id: p.id, shot: p.shot, version: p.version, reason: 'The daily cap is spent (5 a day): raise it in the settings or publish tomorrow' }); else { p.state = 'uploading'; p.job_id = 'pub-all'; started.push(p.id) } }
        return json({ started, refused })
      }
    }
    // Render sequences (docs/ADR-048): state.renders = { adapters: { pod: { ok, reason }, local: { ok, reason, code } }, jobs: [...], proxies: { 'dir/name': {...} }, deliverables: [...], remote: { 'dir/name': true }, local: {...}, missing: { 'dir/name': [{ from, to }] }, nextVersion, startError: { detail, code }, cleared: { removed, bytes } };
    // the fake records `planned`, `started`, `cancelled`, `proxyCalls`, `clearCalls`. A test edits jobs between polls. state.rendersOld = true answers like a core that predates it.
    if (path === '/podlogs') return json({ dir: '/home/me/.config/runpod-pod-manager/pod-logs', logs: state.podlogs.filter((l) => !query.pod_id || l.pod_id === query.pod_id).map(({ text, ...l }) => l) })
    if (path === '/podlogs/read') { const l = state.podlogs.find((x) => x.name === query.name); return l ? json({ name: l.name, text: l.text }) : json({ detail: 'No such saved log' }, 404) }
    if (path === '/podlogs/purge') { const n = state.podlogs.filter((l) => !body.pod_id || l.pod_id === body.pod_id).length; state.podlogs = state.podlogs.filter((l) => body.pod_id && l.pod_id !== body.pod_id); state.podlogPurges = [...(state.podlogPurges || []), body.pod_id || '*']; return json({ deleted: n, bytes: 0 }) }
  if (path === '/podlogs/save') { state.podlogSaves.push(body.pod_id); const l = { name: `2026-11-20/saved_${body.pod_id}_${state.podlogSaves.length}.log`, pod_id: body.pod_id, bytes: 2048, modified: '2026-11-20T15:48:12.000Z', text: 'pod saved now' }; state.podlogs.unshift(l); return json({ ...l, path: `/home/me/.config/runpod-pod-manager/pod-logs/${l.name}`, lines: 3 }) }
    if (path.startsWith('/renders/')) {
      if (state.rendersOld) return json({ detail: `no core call renders.${path.slice(9)}` }, 500)
      const rs = (state.renders ||= {})
      rs.adapters ||= { pod: { ok: true }, local: { ok: true } }
      rs.jobs ||= []; rs.proxies ||= {}; rs.deliverables ||= []; rs.remote ||= {}; rs.local ||= {}; rs.missing ||= {}
      for (const k of ['planned', 'started', 'cancelled', 'proxyCalls']) rs[k] ||= []
      rs.clearCalls ||= 0
      const key = (s) => `${s.dir || ''}/${s.name}`
      // Skip existing: a sequence that already has its proxy (remote or local) or, for a review, state.renders.reviewHas[key], is skipped unless the request says skip_existing: false
      const skipOf = (body, s) => (body.skip_existing === false ? null : body.kind === 'review' ? ((rs.reviewHas || {})[key(s)] ? 'already has review v003' : null) : rs.remote[key(s)] || rs.local[key(s)] ? 'already rendered' : null)
      const chosen = (where) => { const a = rs.adapters; return where === 'pod' ? (a.pod.ok ? 'pod' : null) : where === 'local' ? (a.local.ok ? 'local' : null) : a.pod.ok ? 'pod' : a.local.ok ? 'local' : null }
      const adapters = () => ['pod', 'local'].map((id) => ({ id, ok: !!rs.adapters[id].ok, ...(rs.adapters[id].reason ? { reason: rs.adapters[id].reason } : {}), ...(rs.adapters[id].code ? { code: rs.adapters[id].code } : {}), ...(rs.adapters[id].install_hint ? { install_hint: rs.adapters[id].install_hint } : {}) }))
      const badClip = (seqs) => (seqs || []).map((s) => s.clip_name).find((c) => c !== undefined && (!String(c).trim() || /[/\\]|\.\./.test(c) || !/^[A-Za-z0-9._\- ]+$/.test(c) || c.length > 200))
      if ((path === '/renders/plan' || path === '/renders/start') && badClip(body.sequences) !== undefined) return json({ detail: `clip_name is not a usable file name: ${badClip(body.sequences)}` }, 400)
      // colour read from the headers (state.renders.colours = { 'dir/name': {...fields} } overrides, refuse = { 'dir/name': 'reason' } marks a sequence refused for a Review, noColour / noSource answer like an older core)
      const colourOf = (s) => ({ transfer: 3, transfer_name: 'logarithmic', colorimetric: 0, colorimetric_name: 'unspecified video', descriptor: 50, descriptor_name: 'RGB', bits: 16, packing_name: 'packed', encoding: 0, endian: 'big', width: 3840, height: 2160, start_timecode: '01:00:00:00', frame_rate_hint: 23.976, conversion: 'none: a plain scale, no colour transform', verdict: (rs.refuse || {})[key(s)] ? 'refused' : 'ok', ...((rs.refuse || {})[key(s)] ? { refusal: rs.refuse[key(s)] } : {}), ...((rs.colours || {})[key(s)] || {}) })
      const summaries = (seqs) => {
        const by = new Map(), sby = new Map()
        for (const s of seqs) { const src = s.source; if (src) { const k = `${src.width}x${src.height}x${src.bits}`; sby.set(k, { width: src.width, height: src.height, bits: src.bits, count: (sby.get(k)?.count || 0) + 1 }) } const c = s.colour; if (c) { const k = [c.transfer_name, c.colorimetric_name, c.descriptor_name, c.bits, c.packing_name, c.width, c.height, c.verdict, c.refusal].join('|'); by.set(k, { key: k, count: (by.get(k)?.count || 0) + 1, transfer_name: c.transfer_name, colorimetric_name: c.colorimetric_name, descriptor_name: c.descriptor_name, bits: c.bits, packing_name: c.packing_name, endian: c.endian, width: c.width, height: c.height, verdict: c.verdict, ...(c.refusal ? { refusal: c.refusal } : {}) }) } }
        return { ...(sby.size ? { source_summary: { groups: [...sby.values()] } } : {}), ...(by.size ? { colour_summary: { groups: [...by.values()], uniform: by.size === 1 } } : {}) }
      }
      // The EDL's per-sequence answers (state.renders.rows = { 'dir/name': { flags, expected_frames, edl_element, timecode_source, start_timecode, suggested_colour } }): an override drops the frame-count flag, a typed timecode wins, requireColour adds colour-not-set to a Tunnel plan without a colour
      const edlRow = (body, s) => {
        const r = { ...((rs.rows || {})[key(s)] || {}) }
        if (!Object.keys(r).length && !rs.requireColour) return {}
        let flags = (r.flags || []).filter((f) => !(f.code === 'frames-differ-from-edl' && (body.edl_override || {})[s.name]))
        if (rs.requireColour && body.preset === 'tunnel' && !s.colour_in) flags = [...flags, { code: 'colour-not-set', level: 'block', message: 'Colour not set: choose the input colour' }]
        if (s.start_timecode) { r.start_timecode = s.start_timecode; r.timecode_source = 'sequence field' }
        return { ...r, flags }
      }
      if (path === '/renders/plan') {
        rs.planned.push(body)
        const w = chosen(body.where || 'auto'), seqs = body.sequences || []
        const shotOf = (n) => (/^([A-Za-z]+-\d+[a-z]?)/i.exec(n) || [, n])[1].toLowerCase()
        const out = ({ ...(rs.planWarnings ? { warnings: rs.planWarnings } : {}), ...(rs.podCpu ? { pod_cpu: rs.podCpu } : {}), ...(rs.notes ? { notes: rs.notes } : {}), ...(rs.settings ? { settings: rs.settings, settings_source: rs.settingsSource || 'default' } : {}), pod_ok: !!rs.adapters.pod.ok, ...(w ? {} : { reason: rs.adapters.pod.reason || rs.adapters.local.reason || 'Nothing can render' }), adapters: adapters(), total_frames: seqs.reduce((n, s) => n + s.frames, 0),
          sequences: seqs.map((s) => ({ ...s, ...(rs.timecodes ? { timecode_source: rs.timecodes[key(s)] || null } : {}), ...edlRow(body, s), out: `output/.proxies/${s.dir}/${s.name}_${body.width}.mp4`, ...(rs.noSource ? {} : { source: (rs.sources || {})[key(s)] || rs.source || { width: 3840, height: 2160, bits: 16 } }), ...(rs.noColour ? {} : { colour: colourOf(s) }), skip: skipOf(body, s), exists_remote: !!rs.remote[key(s)], exists_local: !!rs.local[key(s)], gaps: (rs.missing[key(s)] || []).reduce((n, r) => n + (r.to - r.from + 1), 0), complete: !(rs.missing[key(s)] || []).length, missing: rs.missing[key(s)] || [], where: w || 'pod', ...(body.kind === 'review' ? { shot: shotOf(s.name), next_version: rs.nextVersion || 1 } : {}), clip_name: s.clip_name || s.name, ...(body.kind === 'review' ? { estimate: { frames: s.frames, note: 'slow: expect minutes per 100 frames', ...(rs.outputGb ? { output_gb: rs.outputGb } : {}) } } : rs.outputGb ? { estimate: { frames: s.frames, output_gb: rs.outputGb } } : {}) })) })
        const nSkipped = out.sequences.filter((x) => x.skip).length
        return json({ ...out, ...(rs.noTotals ? {} : { totals: { to_render: out.sequences.length - nSkipped, skipped: nSkipped } }), ...(rs.noSummary ? {} : summaries(out.sequences)) })
      }
      if (path === '/renders/start') {
        rs.started.push(body)
        if (rs.startError) return json(rs.startError, 500)
        if ((body.sequences || []).length && body.sequences.every((s) => skipOf(body, s))) return json({ detail: 'Everything in this scope is already rendered: untick Skip existing to render again' }, 400)
        if (body.kind === 'review' && !body.approved_by) return json({ detail: 'A review video needs the name of who says yes' }, 400)
        if (body.publish && (body.publish.targets || []).includes('slack') && !(body.publish.targets || []).includes('s3')) return json({ detail: 'Slack announces an upload: turn S3 on' }, 400)
        if (body.publish && body.where !== 'local' && body.pull === false) return json({ detail: 'Publishing needs the renders on this PC: turn on Sync the renders to this PC' }, 400)
        const n = rs.started.length, w = chosen(body.where || 'auto')
        rs.jobs.push({ job_id: `job-${n}`, pod_id: w === 'local' ? '' : body.pod_id, pod_name: 'ComfyUI-Dev', kind: body.kind || 'proxy', codecs: body.codecs || [], state: 'rendering', started_at: `2026-11-18T10:0${n}:00Z`, finished_at: null, width: body.width, frames_done: 0, frames_total: body.sequences.reduce((a, s) => a + s.frames, 0), rate_fps: 0, current: '', pulled_files: 0, pulled_bytes: 0, error: '', summary: '',
          sequences: body.sequences.map((s) => ({ dir: s.dir, name: s.name, clip_name: s.clip_name || s.name, where: w || 'pod', state: skipOf(body, s) ? 'skipped' : 'waiting', ...(skipOf(body, s) ? { reason: skipOf(body, s) } : {}), frames_done: 0, frames_total: s.frames, out: '', bytes: 0, error: '' })) })
        return json({ job_id: `job-${n}` })
      }
      if (path === '/renders/status') return json({ jobs: rs.jobs.filter((j) => !query.job_id || j.job_id === query.job_id) })
      if (path === '/renders/retry') { const j = rs.jobs.find((x) => x.job_id === body.job_id); if (!j) return json({ detail: 'No such render job' }, 404); rs.retried = [...(rs.retried || []), body.job_id]; const n = rs.jobs.length + 1; rs.jobs.push({ ...j, job_id: `job-${n}`, state: 'rendering', error: '', finished_at: null }); return json({ job_id: `job-${n}` }) }
      if (path === '/renders/cancel') { rs.cancelled.push(body.job_id); const j = rs.jobs.find((x) => x.job_id === body.job_id); if (j) { j.state = 'cancelled'; j.finished_at = 'now' } return json(j || {}) }
      if (path === '/renders/proxies') {
        rs.proxyCalls.push(body)
        return json({ items: (body.items || []).map((s) => { const p = rs.proxies[key(s)]; return p ? { dir: s.dir, name: s.name, width: 1280, exists_remote: false, exists_local: false, local_url: '', remote_ready: true, bytes: 0, modified: '', ...p } : { dir: s.dir, name: s.name, width: body.width || 1280, exists_remote: false, exists_local: false, local_url: '', remote_ready: false, bytes: 0, modified: '' } }), deliverables: rs.deliverables })
      }
      if (method === 'DELETE' && path === '/renders/local') { rs.clearCalls++; return json(rs.cleared || { removed: 0, bytes: 0 }) }
    }
    if (method === 'GET' && path === '/runflows') return json({ pod_id: query.pod_id, pod_name: 'ComfyUI-Dev', count: 3, workflows: [{ path: 'rounds/r1/cgi-042/stereo.json', group: 'rounds/r1/cgi-042', name: 'stereo.json', size: 1, modified: 0 }, { path: 'rounds/r1/cgi-042/delivery.json', group: 'rounds/r1/cgi-042', name: 'delivery.json', size: 1, modified: 0 }, { path: 'rounds/r1/cgi-043/other.json', group: 'rounds/r1/cgi-043', name: 'other.json', size: 1, modified: 0 }] })
    if (method === 'POST' && path === '/runflows') { state.ranFlows = body.paths; return json({ id: 'run-1', pod_id: body.pod_id, pod_name: 'ComfyUI-Dev', state: 'running', started_at: 'now', ok: 0, failed: 0, results: body.paths.map((p) => ({ path: p, state: 'pending' })) }) }
    if (method === 'GET' && path === '/runflows/jobs') return json({ jobs: state.runJobs || [] })   // the render runs of the app and of other processes (a test sets state.runJobs)
    if (method === 'DELETE' && path.startsWith('/runflows/')) { const id = path.split('/').pop(); (state.cancelledRuns ||= []).push(id); state.runJobs = (state.runJobs || []).map((j) => (j.job_id === id ? { ...j, state: 'cancelled' } : j)); return json({ id, state: 'cancelled' }) }
    if (method === 'GET' && path === '/runflows/latest') return json(state.latestFlow || null)   // a test sets state.latestFlow to a run the window should find again
    if (method === 'GET' && path.startsWith('/runflows/')) return json({ id: 'run-1', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', state: 'done', started_at: 'now', ok: (state.ranFlows || []).length - 1, failed: 1, results: (state.ranFlows || []).map((p, i) => (i === 0 ? { path: p, state: 'failed', error: 'boom (node 4, KSampler)' } : { path: p, state: 'done', seconds: 4.2, outputs: 2, files: [{ filename: 'result_00001_.png', subfolder: 'r1', type: 'output', kind: 'image' }, { filename: 'clip.mp4', subfolder: '', type: 'output', kind: 'video' }, { filename: 'prev_00001_.png', subfolder: '', type: 'temp', kind: 'image' }] })), base_url: 'http://pod-a.test' })
    if (method === 'GET' && path === '/history') { const ev = state.history.events.filter((e) => !query.kind || e.kind === query.kind); return json(query.limit ? ev.slice(0, Number(query.limit)) : ev) }
    if (method === 'GET' && path === '/history/export') { const csv = query.format === 'csv'; return json({ name: `history-${query.what || 'all'}.${csv ? 'csv' : 'json'}`, mime: csv ? 'text/csv' : 'application/json', text: csv ? 'ts,kind\n2026-11-03T10:00:00Z,pod\n' : JSON.stringify({ events: state.history.events, spend: state.history.spend }) }) }
    // A window's own History line (history.note): whitelisted like the core's (change / outputs); kept in state.history.notes and listed as an event
    if (method === 'POST' && path === '/history/note') { if (body?.kind !== 'change' || body?.area !== 'outputs') return json({ ok: false }); const e = { ts: new Date().toISOString(), kind: 'change', area: body.area, action: String(body.action), what: String(body.what), ...(body.detail ? { detail: String(body.detail) } : {}) }; (state.history.notes ||= []).push(e); state.history.events.unshift(e); return json({ ok: true }) }
    if (method === 'GET' && path === '/history/spend') return json(state.history.spend)
    if (method === 'GET' && path === '/history/logs') {
      const l = state.history.logs?.[query.pod_id]
      if (!l) return json({ detail: `pod ${query.pod_id} is not running` }, 400)
      const keep = { all: ['info', 'warning', 'error'], warnings: ['warning', 'error'], errors: ['error'] }[query.level || 'all'] || ['info', 'warning', 'error']
      return json({ ...l, entries: l.entries.filter((e) => keep.includes(e.level)) })
    }
    if (method === 'GET' && path === '/history/saved') return json((state.history.saved || []).filter((r) => (!query.pod_id && !query.volume_id) || (query.pod_id && r.pod_id === query.pod_id) || (query.volume_id && r.volume_id === query.volume_id)))   // a test sets state.history.saved to the saved runs
    // Output sources (docs/ADR-045). `api.state.s3Outputs = { files: [{ key: 'proxy_v004/archival-080/seq/f.0000.dpx', bytes, modified }], keys: true }` is a volume's comfy-shared/output/ tree; absent = no S3 keys set. Calls are recorded in state.outputCalls.
    if (method === 'GET' && path === '/history/output-sources') return json([{ id: 'pod-history', name: 'Pod history', hint: '', ok: !!state.history.runs[query.pod_id], reason: '' }, { id: 'saved', name: 'Saved record', hint: '', ok: true, reason: '' }, { id: 'volume-s3', name: 'Network volume (S3)', hint: '', ok: !!state.s3Outputs, reason: state.s3Outputs ? '' : 'RUNPOD_S3_ACCESS_KEY and RUNPOD_S3_SECRET_KEY are not set (Default Configuration): without them only a pod could list this volume, and that costs money, so nothing was started.' }])
    if (method === 'GET' && path === '/history/outputs') {
      ;(state.outputCalls ||= []).push({ ...query })
      const s3 = state.s3Outputs
      if (s3?.fail) return json({ error: s3.fail }, 409)   // state.s3Outputs.fail: the listing is refused with this reason
      if (!s3) return json({ sources: [{ id: 'volume-s3', name: 'Network volume (S3)', hint: '', ok: false, reason: 'RUNPOD_S3_ACCESS_KEY and RUNPOD_S3_SECRET_KEY are not set (Default Configuration): without them only a pod could list this volume, and that costs money, so nothing was started.' }], runs: [], folders: [], prefix: '', capped: false, total: 0, volume_id: query.volume_id || '' })
      // The whole tree (all=1): state.s3Outputs.allJob answers { job_id } and /history/outputs/status steps through allSteps polls of progress (noProgress: none) then the result; allHang never ends, allFail fails, allCap caps the files
      if (query.all && !s3.noAll) {
        const files = s3.allCap ? s3.files.slice(0, s3.allCap) : s3.files
        const groups = new Map()
        for (const f of files) { const dir = f.key.includes('/') ? f.key.slice(0, f.key.lastIndexOf('/')) : ''; (groups.get(dir) || groups.set(dir, []).get(dir)).push({ filename: f.key.split('/').pop(), subfolder: dir, type: 'output', bytes: f.bytes, modified: f.modified }) }
        const runs = [...groups].map(([dir, fs]) => ({ prompt_id: `volume:${query.volume_id}:${dir || '.'}`, workflow: null, started_at: fs.map((f) => f.modified).sort().pop() || null, files: fs, source: 'volume-s3', folder: dir }))
        const result = { sources: [{ id: 'volume-s3', name: 'Network volume (S3)', hint: '', ok: true, reason: '' }], all: true, runs, folders: [...new Set(files.filter((f) => f.key.includes('/')).map((f) => f.key.split('/')[0]))].sort(), prefix: '', capped: !!s3.allCap && s3.files.length > s3.allCap, total: s3.allTotal ?? s3.files.length, volume_id: query.volume_id || '', ...(s3.folderInfo ? { folder_info: s3.folderInfo } : {}) }
        if (!s3.allJob) { if (s3.allDelayMs) await new Promise((r) => setTimeout(r, s3.allDelayMs)); return json(result) }
        state.allListing = { polls: 0, result }
        return json({ job_id: 'olist-1' })
      }
      let prefix = query.prefix, note
      if (prefix === undefined) {
        prefix = ''
        const sh = query.shot
        const hit = sh && [...new Set(s3.files.map((f) => f.key.split('/').slice(0, 2).join('/')))].find((p) => p.endsWith(`/${sh}`))
        if (hit) { prefix = hit; note = `Started in ${hit}, the pod's shot.` }
      }
      const under = s3.files.filter((f) => !prefix || f.key.startsWith(`${prefix}/`)), rel = (f) => (prefix ? f.key.slice(prefix.length + 1) : f.key)
      const folders = [...new Set(under.filter((f) => rel(f).includes('/')).map((f) => rel(f).split('/')[0]))].sort()
      const direct = prefix.split('/').filter(Boolean).length >= 2 ? under : under.filter((f) => !rel(f).includes('/'))
      const groups = new Map()
      for (const f of direct) { const dir = f.key.includes('/') ? f.key.slice(0, f.key.lastIndexOf('/')) : ''; (groups.get(dir) || groups.set(dir, []).get(dir)).push({ filename: f.key.split('/').pop(), subfolder: dir, type: 'output', bytes: f.bytes, modified: f.modified }) }
      const runs = [...groups].map(([dir, files]) => ({ prompt_id: `volume:${query.volume_id}:${dir || '.'}`, workflow: null, started_at: files.map((f) => f.modified).sort().pop() || null, files, source: 'volume-s3', folder: dir })).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))
      return json({ sources: [{ id: 'volume-s3', name: 'Network volume (S3)', hint: '', ok: true, reason: '' }], runs, folders, prefix, capped: !!s3.capped, total: s3.total ?? direct.length, volume_id: query.volume_id || '', ...(s3.folderInfo ? { folder_info: s3.folderInfo } : {}), ...(note ? { start_note: note } : {}) })
    }
    if (method === 'GET' && path === '/history/outputs/status') {
      const s3 = state.s3Outputs, l = state.allListing
      if (!l) return json({ detail: 'no such listing' }, 404)
      l.polls++
      if (s3.allFail) return json({ state: 'failed', error: 'S3 refused the listing (SlowDown)' })
      if (l.cancelled) return json({ state: 'cancelled' })
      if (s3.allHang || l.polls <= (s3.allSteps ?? 1)) return json(s3.noProgress ? { state: 'listing', progress_available: false } : { state: 'listing', files_seen: l.polls * 1234, folders_seen: l.polls * 17, elapsed_s: l.polls })
      return json({ state: 'done', files_seen: l.result.runs.reduce((n, r) => n + r.files.length, 0), folders_seen: l.result.folders.length, elapsed_s: l.polls, result: l.result })
    }
    if (method === 'POST' && path === '/history/outputs/cancel') { (state.allCancels ||= []).push(body.job_id); if (state.allListing) state.allListing.cancelled = true; return json({ ok: true }) }
    if (method === 'GET' && path === '/history/runs') { const r = state.history.runs[query.pod_id]; return r ? json(r) : json({ detail: `pod ${query.pod_id} is not running` }, 400) }
    if (method === 'GET' && path === '/credits') return state.credits === null ? json({ detail: 'RunPod did not report the account balance' }, 502) : json(state.credits ?? { balance: 36.42, spend_per_hr: 0.053, spend_limit: 80, hours_left: 687.2, level: 'ok' })
    // Retry Later (ADR-042 section 19): the watches the core keeps; `api.state.watches` is what GET /pod-watches answers, `resumeWhenFree` and `createWhenFree` record the asks
    if (method === 'GET' && path === '/pod-watches') return json(state.watches || [])
    if ((m = path.match(/^\/pods\/([^/]+)\/resume-when-free$/)) && method === 'POST') {
      const pod = state.pods.find((p) => p.id === m[1]); (state.resumeWhenFree ||= []).push({ id: m[1], ...body })
      const w = { id: `watch-${(state.watches || []).length + 1}`, kind: 'resume', state: 'waiting', pod_id: m[1], name: pod?.name || m[1], label: `Waiting for a free ${pod?.gpu || 'GPU'}: ${pod?.name || m[1]} is pinned to its host`, every_s: body.every_s || 120, attempts: 0, created_at: new Date().toISOString(), next_at: new Date(Date.now() + 120000).toISOString(), give_up_at: new Date(Date.now() + 12 * 3600000).toISOString() }
      ;(state.watches ||= []).push(w); return json(w)
    }
    if (method === 'POST' && path === '/pods/create-when-free') {
      ;(state.createWhenFree ||= []).push(body)
      const w = { id: `watch-${(state.watches || []).length + 1}`, kind: 'create', state: 'waiting', name: body.request.name, label: `Waiting for a free ${body.request.gpu} in EU-RO-1`, request: body.request, every_s: body.every_s || 120, attempts: 0, created_at: new Date().toISOString(), next_at: new Date(Date.now() + 120000).toISOString(), give_up_at: new Date(Date.now() + 12 * 3600000).toISOString() }
      ;(state.watches ||= []).push(w); return json(w)
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/create-like-when-free$/)) && method === 'POST') {
      // another GPU (ADR-042 section 19): a NEW pod like this one, same datacenter; the old pod is never touched
      const pod = state.pods.find((p) => p.id === m[1]); (state.createLikeWhenFree ||= []).push({ id: m[1], ...body })
      const keys = Array.isArray(body.gpu) ? body.gpu : [body.gpu]   // one card, or several in the order chosen (the first free one is used; one pod, named <old>-alt)
      const cardNames = keys.map((k) => state.datacenters.datacenters.flatMap((d) => d.cards).find((c) => c.key === k)?.name || k)
      const card = { name: cardNames.length > 1 ? `${cardNames.slice(0, -1).join(', ')} or ${cardNames[cardNames.length - 1]}` : cardNames[0] }
      const w = { id: `watch-${(state.watches || []).length + 1}`, kind: 'create', state: 'waiting', name: keys.length > 1 ? `${pod?.name || m[1]}-alt` : `${pod?.name || m[1]}-${cardNames[0].replace(/ /g, '-')}`, label: `Waiting for a free ${card.name} in ${pod?.datacenter || ''}`, every_s: body.every_s || 120, attempts: 0, created_at: new Date().toISOString(), next_at: new Date(Date.now() + 120000).toISOString(), give_up_at: new Date(Date.now() + 12 * 3600000).toISOString() }
      ;(state.watches ||= []).push(w); return json(w)
    }
    if ((m = path.match(/^\/pod-watches\/([^/]+)$/)) && method === 'DELETE') {
      const w = (state.watches || []).find((x) => x.id === m[1]); if (!w) return json({ detail: `No such watch: ${m[1]}` }, 404)
      w.state = 'cancelled'; w.finished_at = new Date().toISOString(); return json(w)
    }
    // RunPod's request limit (ADR-042 section 18): the core's local state, and a volume list RunPod refuses to give while it limits
    if (method === 'GET' && path === '/ratelimit') return json(state.ratelimit || { limited: false, window: null, retry_at: null, since: null, stale_age_s: null, message: null })
    if (method === 'GET' && path === '/volumes' && state.volumesFail) return json({ detail: 'RunPod answered 429 listing network volumes: rate limit exceeded for the hour window' }, 502)
    if (method === 'GET' && path === '/volumes') return json(Object.values(state.volumes).map((v) => ({ ...v, is_default: v.id === state.mounts.config.network_volume_id, is_shared: !!state.sharedVolume && v.id === state.sharedVolume })))
    // the Shared volume (ADR-042 section 9): the one the models live on; it cannot be deleted while it is Shared
    if (method === 'POST' && path === '/volumes/shared') { state.sharedVolume = body.id || ''; state.sharedCalls = (state.sharedCalls || []).concat(body.id || ''); return json(body.id ? { ...state.volumes[body.id], is_shared: true } : { shared: null }) }
    // one volume: browse (a listing by a pod) and erase
    if (method === 'GET' && path === '/volumes/erasable') return json([{ key: 'seedflows', label: 'Seed Graphs', path: '/workspace/comfy-shared/workflows' }, { key: 'rounds', label: 'Pulled rounds (temp/rounds)', path: '/workspace/comfy-shared/temp/rounds' }, { key: 'inputs', label: 'Inputs (input), including the files placed from rounds', path: '/workspace/comfy-shared/input' }, { key: 'workflows', label: 'Round graphs (workflows/rounds)', path: '/workspace/comfy-shared/workflows/rounds' }, { key: 'output', label: 'Outputs (output)', path: '/workspace/comfy-shared/output' }, { key: 'models', label: 'Models (models)', path: '/workspace/comfy-shared/models' }])
    if (method === 'GET' && (m = path.match(/^\/volumes\/([^/]+)\/plan$/))) return json(m[1] === 'vol2' ? { route: 's3', gpu: '', price_per_hour: 0, pod: null } : { route: 'temporary', gpu: 'RTX 2000 Ada', price_per_hour: 0.24, pod: null, s3_note: 'keys' })
    if (method === 'POST' && (m = path.match(/^\/volumes\/([^/]+)\/browse$/))) { state.browsed = (state.browsed || []).concat(body?.path || ''); state.volumeJob = state.browseFails ? (state.browseFails--, { id: 'vj1', kind: 'browse', state: 'failed', volume_id: m[1], error: "RunPod's S3 did not answer in 90 s (no answer for 90 s): the connection may have dropped; try again." }) : { id: 'vj1', kind: 'browse', state: 'done', pod_name: 'ComfyUI-Pull-vol', volume_id: m[1], listing: body?.path ? [{ path: body.path, bytes: 3e9 }, { path: `${body.path}/r1`, bytes: 3e9 }, { path: `${body.path}/r1/cgi-042`, bytes: 2e9 }, { path: `${body.path}/r1/cgi-043`, bytes: 1e9 }] : [{ path: '/workspace', bytes: 5e9 }, { path: '/workspace/comfy-shared', bytes: 4e9 }, { path: '/workspace/comfy-shared/temp', bytes: 3e9 }, { path: '/workspace/comfy-shared/temp/rounds', bytes: 3e9 }, { path: '/workspace/comfy-shared/output', bytes: 1e9 }, { path: '/workspace/comfy-shared/models', bytes: 6e8 }] }; return json({ ...state.volumeJob, state: 'creating' }) }
    if (method === 'POST' && (m = path.match(/^\/volumes\/([^/]+)\/clone$/))) { state.cloned = { id: m[1], ...body }; state.volumeJob = { id: 'vj3', kind: 'clone', state: 'done', volume_id: m[1], files: 12, bytes_done: 3e9, clone: { mode: 'push' } }; return json({ ...state.volumeJob, state: 'creating', files: 0 }) }
    if (method === 'POST' && (m = path.match(/^\/volumes\/([^/]+)\/erase$/))) { state.erased = { id: m[1], ...body }; state.volumeJob = { id: 'vj2', kind: 'erase', state: 'done', volume_id: m[1], freed: Object.fromEntries((body.keys || []).map((k) => [k, 1e9])) }; return json({ ...state.volumeJob, state: 'creating' }) }
    // Models (ADR-042 section 9): Hugging Face search, a repo's weight files, loading onto the volume by a pod job
    if (method === 'GET' && path === '/models/search') { (state.modelSearches ||= []).push(query.q); return json(/^zzz/.test(query.q) ? [] : [{ id: 'Comfy-Org/SeedVR2', downloads: 829248, likes: 120, updated: '2026-11-14', gated: false }, { id: 'numz/SeedVR2_comfyUI', downloads: 788853, likes: 80, updated: '2026-10-02', gated: false }, { id: 'someone/gated-model', downloads: 10, likes: 1, updated: null, gated: true }]) }
    if (method === 'GET' && path === '/models/files') { (state.modelFilesFor ||= []).push(query.repo); return json(query.repo === 'Comfy-Org/SeedVR2' ? [{ path: 'vae/seedvr2_ema_vae_fp16.safetensors', bytes: 501324814, sha256: 'a'.repeat(64), folder: 'vae' }, { path: 'diffusion_models/seedvr2_3b_fp8_e4m3fn.safetensors', bytes: 3392794232, sha256: 'b'.repeat(64), folder: 'diffusion_models' }, { path: 'diffusion_models/seedvr2_3b_fp16.safetensors', bytes: 6784268336, sha256: 'c'.repeat(64), folder: 'diffusion_models' }] : query.repo === 'someone/gated-model' ? [{ path: 'gated-model-fp8.safetensors', bytes: 9433061528, sha256: '', folder: 'diffusion_models', locked: true }] : []) }
    if (method === 'POST' && path === '/models/fetch') { state.modelFetch = { volume_id: body.volume_id, items: body.items }; state.volumeJob = { id: 'vjm1', kind: 'fetch', state: 'done', volume_id: body.volume_id, pod_name: 'ComfyUI-Pull-vol', fetched: body.items.map((i) => i.path.split('/').pop()), lines: ['Approved by a click in the app window.', ...body.items.map((i) => `FETCHED ${i.path.split('/').pop()} 1`), 'FETCH-DONE'] }; return json({ ...state.volumeJob, state: 'creating', fetched: undefined, lines: [] }) }
    if (method === 'POST' && path === '/models/delete') {   // ADR-042 section 15: only with confirmed: true, as the core does
      if (body.confirmed !== true) return json({ error: 'Deleting model files cannot be undone: confirm it (confirmed: true).' }, 400)
      ;(state.modelDeletes ||= []).push({ volume_id: body.volume_id, items: body.items })
      const gone = new Set((body.items || []).map((i) => `${i.folder}/${i.name}`)), at = (f) => f.path || [f.folder, f.name].filter(Boolean).join('/')
      const freed = (state.modelsOnVolume || []).filter((f) => gone.has(at(f))).reduce((n, f) => n + (f.bytes ?? f.size ?? 0), 0)
      state.modelsOnVolume = (state.modelsOnVolume || []).filter((f) => !gone.has(at(f)))
      state.volumeJob = { id: `vjd${state.modelDeletes.length}`, kind: 'delete-models', state: 'done', volume_id: body.volume_id, route: 's3', deleted: (body.items || []).map((i) => ({ ...i, bytes: 1 })), freed_bytes: freed, lines: [] }
      return json({ ...state.volumeJob, state: 'creating', deleted: undefined, lines: [] })
    }
    if (method === 'GET' && path === '/models/status') return json(state.modelsOnVolume === undefined ? null : state.modelsOnVolume)
    if (method === 'GET' && path === '/models/folders') return json(['diffusion_models', 'vae', 'checkpoints', 'loras', 'text_encoders', 'clip', 'clip_vision', 'controlnet', 'upscale_models', 'embeddings'])
    // The wanted-models list (ADR-042 section 12): names as Hugging Face coordinates, compared with state.wantedOnVolume (folder/name) when the volume can be listed
    if (path.startsWith('/wanted')) {
      const list = (state.wanted ||= [])
      const keyOf = (e) => `${e.repo}|${e.repo ? e.path : e.name}|${e.folder}`
      const clean = (e) => ({ folder: e.folder, name: e.name || String(e.path || '').split('/').pop(), repo: e.repo || '', path: e.path || '', bytes: e.bytes || 0, ...(e.note ? { note: e.note } : {}) })
      const addAll = (items) => { let added = 0, updated = 0; for (const e of items.map(clean)) { const i = list.findIndex((x) => keyOf(x) === keyOf(e)); if (i < 0) { list.push(e); added++ } else { list[i] = e; updated++ } } return { added, updated, models: list } }
      if (method === 'GET' && path === '/wanted') return json(list)
      if (method === 'GET' && path === '/wanted/status') {
        const on = state.wantedOnVolume
        const rows = list.map((e) => ({ ...e, key: keyOf(e), loadable: !!e.repo, state: on === undefined ? 'unknown' : on.includes(`${e.folder}/${e.name}`) ? 'present' : (state.wantedParts || {})[`${e.folder}/${e.name}`] !== undefined ? 'downloading' : 'missing', ...((state.wantedParts || {})[`${e.folder}/${e.name}`] !== undefined ? { downloaded: state.wantedParts[`${e.folder}/${e.name}`] } : {}) }))   // a <name>.part on the volume: Downloading
        const missing = rows.filter((r) => r.state === 'missing')
        return json({ volume_id: query.volume_id || 'vol1', volume_gb: state.wantedVolumeGb ?? 500, rows, present: rows.filter((r) => r.state === 'present').length, missing: missing.length, unknown: 0, missing_bytes: missing.reduce((n, r) => n + r.bytes, 0), present_bytes: 0, short_by_bytes: state.wantedShort || 0 })
      }
      if (method === 'POST' && path === '/wanted/add') { (state.wantedAdds ||= []).push(body.items); return json(addAll(body.items)) }
      if (method === 'POST' && path === '/wanted/add-list') {
        if (!body.csv && state.wantedCsvUnreadable) return json({ detail: 'The volume cannot be read over S3 from here (no S3 keys, or its datacenter has no S3 API): paste the CSV text instead.' }, 400)
        ;(state.wantedLists ||= []).push(body)
        return json({ ...addAll([{ folder: 'loras/ltx2', repo: 'Kijai/LTX2.3_comfy', path: 'loras/dyn.safetensors', bytes: 2600000000, note: 'ltx-2.3' }, { folder: 'vae', repo: 'Kijai/LTX2.3_comfy', path: 'vae/v.safetensors', bytes: 1500000000 }]), skipped: [{ file: 'd.pth', why: 'x' }] })
      }
      if (method === 'POST' && path === '/wanted/save-installed') { state.wantedSaved = body.volume_id; return json({ ...addAll([{ folder: 'diffusion_models', name: 'seedvr2_ema_3b_fp16.safetensors', bytes: 6780000000 }]), skipped: 0 }) }
      if (method === 'POST' && path === '/wanted/remove') { const before = list.length; if (body.all) list.length = 0; else for (const k of body.keys) { const i = list.findIndex((x) => keyOf(x) === k); if (i >= 0) list.splice(i, 1) } return json({ removed: before - list.length, models: list }) }
      if (method === 'POST' && path === '/wanted/load') {
        const on = state.wantedOnVolume || [], todo = list.filter((e) => e.repo && !on.includes(`${e.folder}/${e.name}`))
        state.wantedLoad = { volume_id: body.volume_id, files: todo.map((e) => `${e.folder}/${e.name}`) }
        state.volumeJob = { id: 'vjw1', kind: 'fetch', state: 'done', volume_id: body.volume_id, pod_name: 'ComfyUI-Pull-vol', fetched: todo.map((e) => e.name), lines: ['FETCH-DONE'] }
        return json({ job: { ...state.volumeJob, state: 'creating', fetched: undefined, lines: [] }, jobs: Math.ceil(todo.length / 20), files: todo.length, bytes: todo.reduce((n, e) => n + e.bytes, 0), volume_gb: state.wantedVolumeGb ?? 500, short_by_bytes: state.wantedShort || 0, warning: state.wantedShort ? 'The volume is 50 GB; the models alone need about 100 GB. Grow it first (Volumes > Resize).' : null })
      }
    }
    // The shell guard (a PreToolUse hook for Claude Code's Bash tool): a system-wide setting the core installs into ~/.claude/settings.json
    if (path === '/agentguard') {
      const g = (state.agentguard ||= { enabled: false, installed: false, settings_file: '', script_file: '' })
      if (method === 'POST') { (state.agentguardCalls ||= []).push(!!body.enabled); Object.assign(g, body.enabled ? { enabled: true, installed: true, settings_file: '/Users/me/.claude/settings.json', script_file: '/Users/me/.config/runpod-pod-manager/agent-shell-guard.sh' } : { enabled: false, installed: false, settings_file: '/Users/me/.claude/settings.json', script_file: '' }) }
      return json(g)
    }
    if (method === 'POST' && path === '/volumes/job/cancel') { state.volumeJob = { ...(state.volumeJob || {}), id: body.id, state: 'cancelled' }; state.volumeJobCancelled = body.id; return json(state.volumeJob) }
    if (method === 'GET' && path === '/volumes/jobs') {   // ADR-042 section 16: the volume jobs list the Models window, the Queue and the nav badge poll; `volumeSteps` advances one state per call, as a real job moves on
      if (state.volumeSteps?.length) { const now = Date.now(); if (state.volumeStepAt === undefined || now - state.volumeStepTs >= 1500) { const k = Math.min((state.volumeStepAt ?? -1) + 1, state.volumeSteps.length - 1); state.volumeStepAt = k; state.volumeStepTs = now; state.volumeJob = state.volumeSteps[k] } }   // one state per 1.5 s, whoever asks
      const list = state.volumeJob ? [state.volumeJob] : []
      return json({ jobs: list, interrupted: state.interrupted || [], running: list.filter((j) => !['done', 'failed', 'cancelled', 'interrupted'].includes(j.state)).length })
    }
    if (method === 'POST' && path === '/volumes/jobs/reattach') {   // ADR-042 section 17: follow an interrupted download again: the pod leaves the interrupted list and a running job takes its place
      state.reattached = body.name; state.interrupted = (state.interrupted || []).filter((p) => p.name !== body.name)
      state.volumeJob = { id: 'fetch-vol-a3upg9ey48-re', round: 'vol-a3upg9ey48', kind: 'fetch', route: 'temporary', pod_id: 'p9', pod_name: body.name, volume_id: 'a3upg9ey48', state: 'connecting', files: 0, lines: [`Following ${body.name} again.`], started_at: new Date().toISOString(), bytes_done: 0, bytes_total: null, rate: null, recent: [] }
      return json(state.volumeJob)
    }
    if (method === 'POST' && path === '/volumes/jobs/drop') { state.droppedPod = body.name; state.interrupted = (state.interrupted || []).filter((p) => p.name !== body.name); return json({ deleted: body.name }) }
    if (method === 'GET' && path === '/volumes/job') return json(state.volumeJob || { id: query.id, state: 'failed', error: 'no job' })
    if (method === 'POST' && path === '/volumes') {
      const v = { id: `vol-new-${Object.keys(state.volumes).length + 1}`, name: body.name, size_gb: body.size_gb, datacenter: body.datacenter, cost_per_month: Math.round(body.size_gb * 7) / 100, s3: body.datacenter === 'EU-RO-1', is_default: false, pods: [] }
      state.volumes[v.id] = v; return json(v)
    }
    if ((m = path.match(/^\/volumes\/([^/]+)$/)) && method === 'PATCH') { const v = state.volumes[m[1]]; v.size_gb = body.size_gb; v.cost_per_month = Math.round(body.size_gb * 7) / 100; return json(v) }
    if ((m = path.match(/^\/volumes\/([^/]+)$/)) && method === 'DELETE') {
      const v = state.volumes[m[1]]
      if (state.sharedVolume === m[1]) return json({ detail: `${v.name} is the Shared volume (it holds the models): choose another Shared volume, or none, before deleting it.` }, 400)
      if (v.pods.some((p) => p.via === 'runpod')) return json({ detail: `${v.name} is attached to ${v.pods.map((p) => p.name).join(', ')}: delete or recreate those pods first` }, 400)
      delete state.volumes[m[1]]; return json({ removed: m[1], was_default: false })
    }
    if ((m = path.match(/^\/volumes\/([^/]+)\/default$/)) && method === 'POST') { const v = state.volumes[m[1]]; state.mounts.config.network_volume_id = v.id; state.mounts.config.data_center_id = v.datacenter; return json({ ...v, is_default: true }) }
    if (method === 'GET' && path === '/dashboard') return json({ stats: stats(state.pods), pods: state.pods, dry_run: !!state.mounts.config.dry_run || !!state.mounts.dryForced })
    if (method === 'GET' && path === '/pods') return json(state.pods)
    if (method === 'POST' && path === '/pods') {
      const pod = { id: `pod-new-${state.pods.length + 1}`, name: body.name, status: 'starting', gpu: body.gpu, vram: 24,
        ssh_command: 'ssh root@new.proxy.runpod.io', custom_config: !!body.config, ...(body.round ? { round: body.round, round_label: (state.roundNames || {})[body.round] || body.round } : {}) }
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
      if (pod) { if (r) { pod.round = r; pod.round_label = (state.roundNames ||= {})[r] || r } else { delete pod.round; delete pod.round_label; delete pod.shot } }
      return json({ pod_id: m[1], round: r || null })
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/shot$/)) && method === 'PUT') {
      const pod = state.pods.find((p) => p.id === m[1]); const sh = String(body.shot || '').trim()
      if (!pod?.round) return json({ detail: 'Put the pod in a round first: the shot belongs to a round' }, 400)
      if (sh) pod.shot = sh; else delete pod.shot
      return json({ pod_id: m[1], round: pod.round, shot: sh || null })
    }
    if (path === '/rounds' && method === 'DELETE') {
      let n = 0; for (const p of state.pods) if (p.round === query.round) { delete p.round; delete p.round_label; n++ }
      return json({ round: query.round, pods_released: n })
    }
    if (path === '/rounds/name' && method === 'PUT') {
      const names = (state.roundNames ||= {}); if (body.name) names[body.round] = body.name; else delete names[body.round]
      for (const p of state.pods) if (p.round === body.round) p.round_label = names[body.round] || body.round
      return json({ round: body.round, label: names[body.round] || body.round })
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/config$/)) && method === 'GET') return json(state.podConfigs[m[1]] || null)
    if ((m = path.match(/^\/pods\/([^/]+)\/config$/)) && method === 'PUT') {
      if (body) { const { outputs: _o, auto_publish: _a, ...own } = body; state.podConfigs[m[1]] = own } else delete state.podConfigs[m[1]]   // app-wide settings are never a pod's own
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
    const panamaRoundList = () => { const pn = state.panama || {}; const base = pn.rounds || [{ name: 'brynley-comfy-2026-10-23', staged: false, state: 'none', present: 0, expected: null, missing: null, bytes: 0 }, { name: 'brynley-comfy-2026-10-20', staged: false, state: 'partial', present: 391, expected: 1283, missing: 892, bytes: 8100000000 }, { name: 'brynley-inbox-2026-10-28-v001', staged: true, state: 'complete', present: 378, expected: 378, missing: 0, bytes: 623848 }]; return base.map((r) => (pn.deleted || []).includes(r.name) ? { ...r, staged: false, state: 'none', present: 0, expected: null, missing: null, bytes: 0 } : r) }   // one list for /panama/rounds and the library's panama-s3 source
    if (method === 'GET' && path === '/panama/rounds') return json(panamaRoundList())
    // ADR-044: the library. Sources list; every item has the one shape (the BH rounds are the panama-s3 source).
    if (method === 'GET' && path === '/library/sources') return json([{ id: 'panama-s3', name: 'BH (Panama bucket)', hint: 'The rounds BH delivers to the exchange bucket, downloaded to this PC and checked against their manifest.', available: true, reason: '' }, { id: 'volume', name: 'Volume (rounds already on a network volume)', hint: 'Read-only listing over the S3 API.', available: !!state.volumeSourceReady, reason: state.volumeSourceReady ? '' : 'RUNPOD_S3_ACCESS_KEY and RUNPOD_S3_SECRET_KEY are not set', needs: 'volume' }])   // state.volumeSourceReady = the S3 keys are set: Import Round then starts on the Volume source
    // ADR-044 step 2: the volume source. state.volumeLib = { status, rounds } overrides what the fake volume holds.
    if (method === 'GET' && path === '/library/status') { (state.libraryCalls ||= []).push({ path, ...query }); return json(state.volumeLib?.status || { available: true, reason: '', volume_id: query.volume_id }) }
    if (method === 'GET' && path === '/library/round') return json({ kind: 'round', round: query.round, shots: ['archival-080', 'archival-084', 'cgi-042'], variants: ['a', 'b'], graphs: [], locked: ['cgi-042'], findings: [] })
    // A round of comfy-shared/workflows/ as a file tree (Browse Files): state.volumeLib.files = [{ path: '<round>/<shot>/<graph>', bytes }] (default below), .filesFail = a refusal reason, .filesTruncated. Calls in state.roundFilesCalls.
    if (method === 'GET' && path === '/library/round-files') {
      (state.roundFilesCalls ||= []).push({ ...query })
      const lib = state.volumeLib || {}
      if (lib.filesFail) return json({ error: lib.filesFail }, 502)
      const all = lib.files || [
        { path: 'proxy_v005/archival-080/archival-080__a__proxy_v005.json', bytes: 2048 }, { path: 'proxy_v005/archival-080/archival-080__b__proxy_v005.json', bytes: 2048 },
        { path: 'proxy_v005/archival-080/notes/old/readme.md', bytes: 1048576 }, { path: 'proxy_v005/archival-084/archival-084__main__proxy_v005.json', bytes: 500 }, { path: 'proxy_v005/README.md', bytes: 12 },
        { path: 'proxy_v004g/archival-080/archival-080__e__proxy_v004g.json', bytes: 1 },
      ]
      const pre = query.shot ? `${query.round}/${query.shot}/` : `${query.round}/`
      const files = all.filter((f) => f.path.startsWith(pre)).map((f) => ({ path: query.shot ? f.path.slice(query.round.length + 1) : f.path.slice(pre.length), bytes: f.bytes })).sort((a, b) => a.path.localeCompare(b.path))
      const dirs = new Map(), seen = new Set(), entries = []
      for (const f of files) { const p = f.path.split('/'); for (let i = 1; i < p.length; i++) { const d = p.slice(0, i).join('/'), c = dirs.get(d) || { files: 0, bytes: 0 }; c.files++; c.bytes += f.bytes; dirs.set(d, c) } }
      for (const f of files) { const p = f.path.split('/'); for (let i = 1; i < p.length; i++) { const d = p.slice(0, i).join('/'); if (!seen.has(d)) { seen.add(d); entries.push({ path: d, dir: true, ...dirs.get(d) }) } } entries.push({ path: f.path, dir: false, bytes: f.bytes }) }
      return json({ volume_id: query.volume_id, root: `comfy-shared/workflows/${query.round}${query.shot ? `/${query.shot}` : ''}`, entries, files: files.length, bytes: files.reduce((a, f) => a + f.bytes, 0), truncated: !!lib.filesTruncated })
    }
    if (method === 'POST' && path === '/library/preflight') { (state.libraryCalls ||= []).push({ path, ...body }); return json(state.volumeLib?.preflight || { round: body.round, volume_id: body.volume_id, checked: 4, total_graphs: 5, missing_total: 1, graphs: [{ graph: `${body.round}/archival-080/archival-080__a__${body.round}.json`, models: ['LTX23_audio_vae_bf16.safetensors'], missing: [{ name: 'LTX23_audio_vae_bf16.safetensors', node_type: 'LTXVAudioVAELoader', reads: ['models/checkpoints/'], elsewhere: ['models/vae/LTX23_audio_vae_bf16.safetensors'] }] }], note: 'read-only' }) }
    // Rounds listing faults: state.libraryItems = { fail: [true, false] } makes call N fail (502 with { error }) when fail[N] is truthy (a string is the reason); delay: [ms, ...] holds call N. Calls counted in state.libraryItems.n.
    if (method === 'GET' && path === '/library/items' && state.libraryItems) {
      const li = state.libraryItems, n = li.n = (li.n || 0) + 1, f = (li.fail || [])[n - 1], d = (li.delay || [])[n - 1]
      if (d) await new Promise((r) => setTimeout(r, d))
      if (f) return json({ error: typeof f === 'string' ? f : 'aws exited 255: Unable to locate credentials' }, 502)
    }
    if (method === 'GET' && path === '/library/items' && query.source === 'volume') {
      (state.libraryCalls ||= []).push({ path, ...query })
      return json(state.volumeLib?.rounds || [
        { source: 'volume', id: 'proxy_v005', name: 'proxy_v005', kind: 'round', volume_id: query.volume_id, shots: ['archival-080', 'archival-084', 'cgi-042'], graphs: 5, locked: ['cgi-042'], variants: ['a', 'b', 'main'], staged: true, verified: false, importable: true },
        { source: 'volume', id: 'proxy_v004g', name: 'proxy_v004g', kind: 'round', volume_id: query.volume_id, shots: ['archival-080'], graphs: 1, locked: [], variants: ['e'], staged: true, verified: false, importable: true },
        { source: 'volume', id: 'canalv2', name: 'canalv2', kind: 'round', volume_id: query.volume_id, shots: [], staged: true, verified: false, importable: false, note: 'no layout' },
      ])
    }
    if (method === 'GET' && path === '/library/items') {
      if (query.source && query.source !== 'panama-s3') return json({ detail: `No such source: ${query.source}` }, 404)
      return json(panamaRoundList().map((r) => ({ source: 'panama-s3', id: r.name, name: r.name, shots: [], staged: r.staged, verified: r.state === 'complete', importable: true, state: r.state, present: r.present, expected: r.expected, missing: r.missing, bytes: r.bytes })))
    }
    if (method === 'POST' && path === '/panama/stage') { state.staged = body.paths; const n = String(body.paths[0]).split('/').pop().replace(/\.zip$/i, ''); return json({ round: n, path: `/staging/${n}`, files: 12, bytes: 4096, extracted: /\.zip$/i.test(body.paths[0]) ? 1 : 0 }) }
    if (method === 'GET' && path === '/panama/browse') {   // one level of the BH bucket, read-only
      const T = { '': { f: ['rounds', 'returns'], k: [] }, 'rounds/': { f: ['brynley-comfy-2026-10-23'], k: [] }, 'returns/': { f: ['BKK'], k: [] }, 'returns/BKK/': { f: ['shot-001', 'shot-002'], k: Array.from({ length: 130 }, (_, i) => `take-${String(i).padStart(3, '0')}.mov`) }, 'returns/BKK/shot-001/': { f: [], k: ['v001.exr', 'notes.txt'] } }
      const dir = T[query.prefix || '']; if (!dir) return json({ detail: `Not a folder in the bucket: ${query.prefix}` }, 400)
      return json({ bucket: 'bh-panama-exchange-610140802195', prefix: query.prefix || '', folders: dir.f.map((n) => ({ name: n, prefix: `${query.prefix || ''}${n}/` })), files: dir.k.map((n, i) => ({ name: n, key: `${query.prefix || ''}${n}`, bytes: 1000 * (i + 1), modified: '2026-11-18T10:30:00' })), truncated: false })
    }
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
      await page.addInitScript(() => { try { localStorage.setItem('outputs.showStereo', 'false') } catch {} })   // the four-slot Outputs layout is narrow: only its own specs turn it on
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

/** The Shared button, then its Volumes card: what the Volumes button used to be. */
export async function openVolumes(page) {
  await page.getByTestId('open-shared').click()
  await page.getByTestId('shared-volumes').click()
}
/** The Shared button, then its Models card. */
export async function openModels(page) {
  await page.getByTestId('open-shared').click()
  await page.getByTestId('shared-models').click()
}

/** The in-app confirmation (stores/confirm.js): waits for it, reads what it asks, answers Yes (OK) or No (Cancel), and returns the question. */
export async function answerConfirm(page, yes = true) {
  const m = page.getByTestId('confirm-modal')
  await expect(m).toBeVisible()
  const msg = await m.getByTestId('confirm-message').innerText()
  await m.getByTestId(yes ? 'confirm-ok' : 'confirm-cancel').click()
  await expect(m).toBeHidden()
  return msg
}

/** Open the Queue window on one of its tabs (overview, imports, syncs, generations, publishing). */
export async function queueTab(page, tab) { await page.getByTestId('open-queue').click(); await page.getByTestId(`queue-tab-${tab}`).click() }

/** The files of the Outputs gallery as a test sees them: a DPX sequence is a tile, every other file is a row of its type group (docs: Outputs grouping). */
export const fileTiles = (scope) => scope.locator('[data-testid="outputs-tile"], [data-testid="outputs-group-row"]')
/** Expand every sequence and group of the gallery (the groups of more than four files start collapsed). */
export async function expandAll(scope) { const b = scope.getByTestId('outputs-expand-all'); if (await b.count()) await b.first().click() }
