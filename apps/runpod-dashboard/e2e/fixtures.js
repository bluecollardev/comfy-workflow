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
    mounts: { config: { image: 'ghcr.io/example/comfy-app:v26', idle_stop_minutes: 30, network_volume_id: '', mount_path: '/workspace', apply_by_default: true, dry_run: false, folders: { project: '', plates: '', 'comfy-shared': '' }, custom: [], env: {}, links: [], required: {} }, folders: [], links: [], mode: 'dev', require: [], require_source: 'config', stored: false, store: '', local_env: {}, preview: { env: {} }, catalog: {} },
    gpus: { default: 'auto', gpus: [{ value: 'auto', text: 'Cheapest card in stock (16-24 GB)' }, { value: 'a4000', text: 'RTX A4000 (16 GB)' }, { value: 'rtx4090', text: 'RTX 4090 (24 GB)' }] },
    // The folder browser (GET /fs/dirs): a tiny disk.
    fs: { '/Users/lucas': ['ComfyUI-Shared', 'Projects'], '/Users/lucas/Projects': ['CANALV2', 'plates'], '/Users/lucas/Projects/CANALV2': ['00_POLICY', '04_TRACKER'] },
    settings: { runpod_api_key_set: false, runpod_api_key_hint: '', source: 'none' },
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
  await page.route('http://localhost:8000/api/**', (route) => {
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
    if (method === 'DELETE' && path === '/mounts') { state.mounts.config = defaultState().mounts.config; state.mounts.stored = false; return json(mountsPayload(state)) }
    if (method === 'GET' && path === '/fs/dirs') {
      const p = query.path || '/Users/lucas'
      const names = state.fs[p]
      if (!names) return json({ detail: `not a folder: ${p}` }, 404)
      const parent = p === '/' ? null : p.replace(/\/[^/]+$/, '') || '/'
      return json({ path: p, parent, home: '/Users/lucas', dirs: names.map((n) => ({ name: n, path: `${p}/${n}` })) })
    }
    if (method === 'GET' && path === '/gpus') return json(state.gpus)
    if (method === 'GET' && path === '/dashboard') return json({ stats: stats(state.pods), pods: state.pods, dry_run: !!state.mounts.config.dry_run })
    if (method === 'GET' && path === '/pods') return json(state.pods)
    if (method === 'POST' && path === '/pods') {
      const pod = { id: `pod-new-${state.pods.length + 1}`, name: body.name, status: 'starting', gpu: body.gpu, vram: 24,
        ssh_command: 'ssh root@new.proxy.runpod.io' }
      state.pods.push(pod)
      return json(pod, 201)
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/details$/)) && method === 'GET') {
      const pod = state.pods.find((p) => p.id === m[1])
      if (!pod) return json({ detail: `RunPod has no such pod (${m[1]})` }, 404)
      return json({ id: pod.id, name: pod.name, status: pod.status === 'stopped' ? 'EXITED' : 'RUNNING', status_text: pod.status === 'stopped' ? 'Exited by user: Mon Oct 19 2026' : 'Rented by user: Mon Oct 19 2026',
        cost_per_hr: 0.28, cloud: 'SECURE', datacenter: 'EUR-IS-1', gpu: 'NVIDIA RTX 4000 Ada Generation', gpu_count: 1, image: 'ashleykza/comfyui:latest', disk_gb: 20, volume_gb: 0,
        created_at: '2026-10-19T11:00:19Z', actions: ['start', 'terminate'], console_url: `https://www.runpod.io/console/pods/${pod.id}`, web_ui_url: pod.web_ui_url || null, ssh_command: pod.ssh_command })
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/logs$/)) && method === 'GET') {
      const lines = state.logs[m[1]] || ['create container ashleykza/comfyui:latest', 'start container for ashleykza/comfyui:latest: begin']
      const body = lines.map((line, i) => `id: 2026-10-19T11:02:2${i}Z\ndata: ${JSON.stringify({ source: 'system', line, ts: `2026-10-19T11:02:2${i}Z` })}\n\n`).join('')
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body })
    }
    if ((m = path.match(/^\/pods\/([^/]+)\/(stop|resume)$/)) && method === 'POST') {
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
