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
    id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', status: 'running', gpu: 'RTX 4090', vram: 24, image: 'ghcr.io/example/comfy-app:v26',
    uptime_seconds: 7320, web_ui_url: 'https://pod-a.proxy.runpod.io:8188',
    ssh_command: 'ssh root@pod-a.proxy.runpod.io',
  },
  { id: 'pod-bbbbbbbb', name: 'ComfyUI-Batch', status: 'stopped', gpu: 'A100', vram: 80, ssh_command: 'ssh root@pod-b.proxy.runpod.io' },
  { id: 'pod-cccccccc', name: 'ComfyUI-Test', status: 'starting', gpu: 'L40S', vram: 48, ssh_command: 'ssh root@pod-c.proxy.runpod.io' },
]

export const sampleRepository = () => ({
  id: 'r1', url: 'https://github.com/me/comfy-nodes', branch: 'main', name: 'me/comfy-nodes', host: 'github.com',
})

export function defaultState() {
  return {
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
    mounts: { config: { image: 'ghcr.io/example/comfy-app:v26', registry_auth_id: '', idle_stop_minutes: 30, sync_parallel: 4, network_volume_id: '', mount_path: '/workspace', apply_by_default: true, dry_run: false, folders: { project: '', plates: '', 'comfy-shared': '' }, custom: [], env: {}, links: [], required: {} }, folders: [], links: [], mode: 'dev', require: [], require_source: 'config', stored: false, store: '', local_env: {}, preview: { env: {} }, catalog: {} },
    volumes: {
      vol1: { id: 'vol1', name: 'comfy-workspace', size_gb: 120, datacenter: 'EU-RO-1', cost_per_month: 8.4, s3: true, is_default: false, pods: [{ id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', status: 'running', via: 'runpod' }, { id: 'pod-cccccccc', name: 'ComfyUI-Test', status: 'starting', via: 'config' }] },
      vol2: { id: 'vol2', name: 'scratch', size_gb: 50, datacenter: 'CA-MTL-1', cost_per_month: 3.5, s3: false, is_default: false, pods: [] },
    },
    datacenters: { live: true, datacenters: [{ value: 'EU-RO-1', text: 'EU-RO-1 · RTX 4000 Ada $0.28/h Low, RTX 4090 $0.89/h High · S3', s3: true, cards: [{ key: 'rtx4000ada', name: 'RTX 4000 Ada', vram: 20, price: 0.28, stock: 'Low' }, { key: 'rtx4090', name: 'RTX 4090', vram: 24, price: 0.89, stock: 'High' }] }, { value: 'CA-MTL-1', text: 'CA-MTL-1 · A40 $0.35/h High', s3: false, cards: [{ key: 'a40', name: 'A40', vram: 48, price: 0.35, stock: 'High' }] }, { value: 'US-KS-2', text: 'US-KS-2 · none of our cards in stock · S3', s3: true, cards: [] }] },
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
        { id: 'comfy-shared', name: 'A ComfyUI-Shared folder', version: 1, builtin: true, approved: true, sha256: 'a'.repeat(64), file: '' },
        { id: 'panama-imax-redux', name: 'Panama Canal v2 delivery package', version: 1, builtin: true, approved: true, sha256: 'b'.repeat(64), file: '' },
        { id: 'agent-made', name: 'Agent made', version: 1, builtin: false, approved: false, sha256: 'c'.repeat(64), file: '' },
      ],
      sources: { 'agent-made': 'export default { id: "agent-made", name: "Agent made" /* ... */ }' },
      plans: {
        '/Users/lucas/Projects/package': {
          adapter: { id: 'panama-imax-redux', name: 'Panama Canal v2 delivery package', version: 1, builtin: true }, source: '/Users/lucas/Projects/package', fenced: true,
          ops: [{ op: 'copy', kind: 'input', from: 'a', to: 'input/a', bytes: 1000 }],
          findings: [{ level: 'info', text: 'built on ComfyUI 0.39.2' }, { level: 'warn', text: '3 FalAPI_* node types are used and no fal pack came with this folder' }],
          summary: { copies: 32, links: 0, notes: 3, bytes: 267700000, by_kind: { input: { files: 30, bytes: 267600000 }, workflow: { files: 2, bytes: 123000 } } },
        },
      },
      conflicts: 0,   // how many files the next real apply reports as conflicts
      lastApply: null,
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
  return { ...state.mounts, config: c, folders, links, require: Object.keys(required).filter((k) => required[k]),
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
      if (body.anthropic_api_key) state.settings = { ...state.settings, anthropic_key_set: true, anthropic_key_hint: '••••' + body.anthropic_api_key.slice(-4) }
      return json(state.settings)
    }
    if (method === 'GET' && path === '/mounts') return json(mountsPayload(state))
    if (method === 'PUT' && path === '/mounts') { state.mounts.config = body; state.mounts.stored = true; return json(mountsPayload(state)) }
    if (method === 'POST' && path === '/mounts/preview') return json(mountsPayload({ ...state, mounts: { ...state.mounts, config: { ...state.mounts.config, ...body } } }))
    if (method === 'DELETE' && path === '/mounts') { state.mounts.config = defaultState().mounts.config; state.mounts.stored = false; return json(mountsPayload(state)) }
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
    if (method === 'GET' && path === '/dashboard') return json({ stats: stats(state.pods), pods: state.pods, dry_run: !!state.mounts.config.dry_run })
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
        cost_per_hr: 0.28, cloud: 'SECURE', datacenter: 'EUR-IS-1', gpu: 'NVIDIA RTX 4000 Ada Generation', gpu_count: 1, image: 'ashleykza/comfyui:latest', disk_gb: 20, volume_gb: 0,
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
    // Import (the Import Shot Pack modal)
    if (method === 'GET' && path === '/imports/adapters') return json(state.imports.adapters)
    if (method === 'GET' && path === '/imports/source') { const a = state.imports.adapters.find((x) => x.id === query.id); return a ? json({ id: a.id, sha256: a.sha256, text: state.imports.sources[a.id] || '' }) : json({ detail: `no adapter ${query.id}` }, 400) }
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
      if (!a) { a = { id, name: id, version: 1, builtin: false, approved: false, sha256: 'd'.repeat(64), file: '' }; state.imports.adapters.push(a) }
      a.approved = false   // a rewrite takes the approval away
      state.imports.sources[id] = `export default { id: "${id}" } // version ${(state.imports.drafts?.length || 0) + 1}`
      state.imports.drafts = [...(state.imports.drafts || []), body]
      state.imports.draftPlanError = null
      const step = (state.imports.draftScript || [{ valid: true, errors: [] }])[Math.min(state.imports.drafts.length, (state.imports.draftScript || [1]).length) - 1]
      return json({ adapter: a, model: 'claude-sonnet-5-5', valid: step.valid, errors: step.errors })
    }
    if (method === 'POST' && path === '/imports/sync-after') {
      state.imports.syncAfterCalls = [...(state.imports.syncAfterCalls || []), body.pod_id]
      if (!body.pod_id) return json({ action: 'skip', why: 'no-pod', configure: false })
      if (!state.mounts.config.network_volume_id) return json({ action: 'skip', why: 'no-volume', configure: true })
      if (body.pod_id.startsWith('dry-')) return json({ action: 'skip', why: 'simulated', configure: false })
      return json({ action: 'sync', request: { pod_id: body.pod_id, direction: 'push', only: ['comfy-shared'], skip_renders: true } })
    }
    if (method === 'POST' && path === '/imports/approve') { const a = state.imports.adapters.find((x) => x.id === body.id); if (!a) return json({ detail: `no adapter ${body.id}` }, 400); a.approved = true; return json(a) }
    if (method === 'POST' && path === '/imports/plan') {
      const a = body.adapter && state.imports.adapters.find((x) => x.id === body.adapter)
      if (a && !a.approved) return json({ detail: `${a.id} has not been approved (or has changed since): read its source and approve it first` }, 400)
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

export const modal = (page, text) => page.locator('.modal.show', { hasText: text })
