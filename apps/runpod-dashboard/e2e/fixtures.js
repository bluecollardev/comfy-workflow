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
    failures: {},
  }
}

const stats = (pods) => ({
  total_pods: pods.length,
  running_pods: pods.filter((p) => p.status === 'running').length,
  stopped_pods: pods.filter((p) => p.status === 'stopped').length,
  total_vram: pods.reduce((sum, p) => sum + (p.vram || 0), 0),
})

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
    if (method === 'GET' && path === '/dashboard') return json({ stats: stats(state.pods), pods: state.pods })
    if (method === 'GET' && path === '/pods') return json(state.pods)
    if (method === 'POST' && path === '/pods') {
      const pod = { id: `pod-new-${state.pods.length + 1}`, name: body.name, status: 'starting', gpu: body.gpu, vram: 24,
        ssh_command: 'ssh root@new.proxy.runpod.io' }
      state.pods.push(pod)
      return json(pod, 201)
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

export const createPodToggle = (page) => page.locator('[aria-controls="create-pod-form"]')

export async function openCreatePod(page) {
  await createPodToggle(page).click()
  await expect(page.getByLabel('Name')).toBeVisible()
}

export async function expandSection(page, name) {
  await page.getByRole('button', { name, exact: true }).click()
}

export const podCard = (page, name) => page.locator('.card.h-100', { hasText: name })

export const modal = (page, text) => page.locator('.modal.show', { hasText: text })
