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

export const samplePods = () => [
  {
    id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', status: 'running', gpu: 'RTX 4090', vram: 24,
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
    mounts: { config: { image: 'ghcr.io/example/comfy-app:v26', registry_auth_id: '', idle_stop_minutes: 30, network_volume_id: '', mount_path: '/workspace', apply_by_default: true, dry_run: false, folders: { project: '', plates: '', 'comfy-shared': '' }, custom: [], env: {}, links: [], required: {} }, folders: [], links: [], mode: 'dev', require: [], require_source: 'config', stored: false, store: '', local_env: {}, preview: { env: {} }, catalog: {} },
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
    failures: {},
  }
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
    if (method === 'PUT' && path === '/settings') { if (body.runpod_api_key) state.settings = { runpod_api_key_set: true, runpod_api_key_hint: '••••' + body.runpod_api_key.slice(-4), source: '/home/me/.config/runpod-pod-manager/.env' }; return json(state.settings) }
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
