import { test, expect } from '@playwright/test'
import { launchApp, podCard, openCreatePod, toast } from './app.js'
import { createServer } from 'node:net'
import { t } from '../e2e/i18n.js'

// Connect › MCP in the real app, no-spend mode: the probe really spawns mcp/server.mjs from the main process
// (Electron run as node), performs initialize and tools/list, and Docs lists the server's tools.
test.describe('Connect › MCP over IPC', () => {
  let ctx
  test.beforeAll(async () => { ctx = await launchApp({ dry: true }) })
  test.afterAll(async () => { await ctx.app.close() })

  test('Check on the pod manager lists its tools, starting with list_agents', async () => {
    const { page } = ctx
    await page.getByTestId('open-connect').click()
    const dialog = page.locator('.modal.show', { hasText: t('connect.title') })
    await dialog.getByRole('tab', { name: t('connect.mcp') }).click()
    await expect(dialog.getByTestId('connect-mcp')).toBeVisible()
    const pm = dialog.locator('[data-testid="mcp-endpoint"][data-id="pod-manager"]')
    await expect(pm.getByTestId('mcp-command')).toContainText(/ELECTRON_RUN_AS_NODE=1 .*\/mcp\/dist\/server\.cjs$/)   // mcp.endpoints: the app's own executable and the bundle's absolute path from the core
    await expect(pm.getByTestId('mcp-not-built')).toHaveCount(0)
    // The tab probes the endpoints itself (mcp.probe): the badge turns Connected without pressing Check.
    await expect(pm.getByTestId('mcp-connected')).toBeVisible({ timeout: 30_000 })
    await pm.getByTestId('mcp-check').click()                                             // Check re-runs it
    await expect(pm.getByTestId('mcp-result')).toHaveAttribute('data-ok', 'true', { timeout: 30_000 })
    await expect(pm.getByTestId('mcp-result-facts')).toContainText(/\d+ tools/)
    await expect(pm.getByTestId('mcp-tool')).toHaveCount(0)                               // no chips
    await expect(toast(page).last()).toContainText(t('toast.mcpChecked', { name: 'Pod manager' }))
    // Docs lists the server's tools with their params (the real mcp/server.mjs, tools/list definitions).
    await pm.getByTestId('mcp-docs').click()
    const docs = page.getByTestId('mcp-docs-modal')
    await expect(docs.getByTestId('mcp-docs-search')).toBeVisible()
    await docs.getByTestId('mcp-docs-search').fill('list_agents')
    const tool = docs.locator('[data-testid="mcp-docs-tool"][data-name="list_agents"]')
    await expect(tool).toBeVisible()
    await expect(tool.getByTestId('mcp-docs-no-params')).toHaveText(t('mcp.docsNoParams'))
    await docs.getByTestId('mcp-docs-search').fill('create_agent')
    const create = docs.locator('[data-testid="mcp-docs-tool"][data-name="create_agent"]')
    await expect(create.locator('[data-testid="mcp-docs-param"][data-name="agent_name"]')).toBeVisible()
    await expect(create.locator('[data-testid="mcp-docs-param"][data-name="gpu_type"] [data-col="required"] i')).toHaveCount(1)
    await expect(create.locator('[data-testid="mcp-docs-param"][data-name="gpu_type"] [data-col="options"] .badge').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(docs).toBeHidden()
    // The bridge card is there with its target menu (mcp.targets answered; no pod runs, so "let the bridge pick" or a typed URL).
    const br = dialog.locator('[data-testid="mcp-endpoint"][data-id="comfy-bridge"]')
    await expect(br.getByTestId('mcp-target-select')).toBeVisible()
  })
})

const freePort = () => new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const mcpCall = async (url, method, params = {}, id = 1) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
  expect(r.status).toBe(200)
  return r.json()
}
const toolText = async (url, name, args = {}) => (await mcpCall(url, 'tools/call', { name, arguments: args })).result.content.map((c) => c.text).join('\n')
const NOTE = '\n\n(no-spend'
const toolJson = async (url, name, args = {}) => JSON.parse((await toolText(url, name, args)).split(NOTE)[0])

// "Serve from the app": the same servers inside the running app, one process, one state.
test.describe('Connect › MCP › served from the app', () => {
  let ctx
  test.beforeAll(async () => { ctx = await launchApp({ dry: true, env: { SYNC_SIM_MS: '400' } }) })
  test.afterAll(async () => { await ctx.app.close() })

  test('the switch serves the pod manager over HTTP; list_pods sees a pod made in the UI; sync over MCP shows on the card', async () => {
    const { page } = ctx
    const port = await freePort()
    await page.getByTestId('open-connect').click()
    const dialog = page.locator('.modal.show', { hasText: t('connect.title') })
    await dialog.getByRole('tab', { name: t('connect.mcp') }).click()
    const pm = dialog.locator('[data-testid="mcp-endpoint"][data-id="pod-manager"]')
    await expect(pm.getByTestId('mcp-serving')).toHaveCount(0)                     // off by default
    await pm.getByTestId('mcp-port-pod-manager').fill(String(port))
    await pm.getByTestId('mcp-port-pod-manager').press('Enter')
    await pm.getByTestId('mcp-serve-pod-manager').check()
    await expect(pm.getByTestId('mcp-serving')).toHaveText(t('mcp.serving', { port }))
    const url = `http://127.0.0.1:${port}/mcp`

    // The tab's probe asks the in-app endpoint over HTTP; Check lists its tools.
    await pm.getByTestId('mcp-check').click()
    await expect(pm.getByTestId('mcp-result')).toHaveAttribute('data-ok', 'true', { timeout: 30_000 })
    await pm.getByTestId('mcp-client-select').selectOption('remote')
    await expect(pm.locator('[data-testid="mcp-client"][data-client="remote"]').getByTestId('mcp-snippet')).toHaveText(url)

    // From this test process: initialize + list_pods over the Streamable HTTP endpoint.
    const init = await mcpCall(url, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })
    expect(init.result.serverInfo.name).toBe('comfy-moe-server')
    expect(await toolText(url, 'list_pods')).not.toContain('Sim-Mcp')
    await dialog.getByRole('button', { name: t('connect.done') }).click()
    await expect(dialog).toBeHidden()

    // A simulated pod created through the app UI is in list_pods: the server uses the app's state.
    await openCreatePod(page)
    await page.locator('#pod-name').fill('Sim-Mcp')
    await page.locator('#pod-image').selectOption('prebuilt')
    await page.getByTestId('pod-submit').click()
    await expect(podCard(page, 'Sim-Mcp')).toBeVisible()
    const pod = (await toolJson(url, 'list_pods')).find((p) => p.name === 'Sim-Mcp')
    expect(pod).toBeTruthy()

    // A sync started over MCP is the card's sync: its bar fills and the Sync modal follows the same job.
    const card = podCard(page, 'Sim-Mcp')
    const started = await toolJson(url, 'sync', { pod_id: pod.id, only: ['workflows'] })
    expect(started.follow).toBe('sync_status')
    await expect(card.getByTestId('pod-progress')).toBeVisible()
    expect((await toolJson(url, 'sync_status', { pod_id: pod.id })).running).toBe(true)
    expect(await toolText(url, 'sync', { pod_id: pod.id, only: ['workflows'] })).toContain('already running')
    await card.getByTestId('pod-progress').click()                                 // the bar opens the Sync modal on the running job
    const sync = page.locator('.modal.show', { hasText: t('sync.title', { name: 'Sim-Mcp' }) })
    await expect(sync.getByTestId('sync-status')).toContainText(t('sync.finished', { steps: 1 }), { timeout: 30_000 })
    await expect.poll(async () => (await toolJson(url, 'sync_status', { pod_id: pod.id })).done).toBe(true)
    await expect(card.getByTestId('pod-sync')).toBeEnabled()                       // the run ended

    // Switching it off closes the port and keeps the setting.
    await sync.getByRole('button', { name: t('sync.close') }).first().click()
    await expect(sync).toBeHidden()
    await page.getByTestId('open-connect').click()
    const again = page.locator('.modal.show', { hasText: t('connect.title') })
    await again.getByRole('tab', { name: t('connect.mcp') }).click()
    const pm2 = again.locator('[data-testid="mcp-endpoint"][data-id="pod-manager"]')
    await expect(pm2.getByTestId('mcp-serve-pod-manager')).toBeChecked()
    await pm2.getByTestId('mcp-serve-pod-manager').uncheck()
    await expect(pm2.getByTestId('mcp-serving')).toHaveCount(0)
    await expect(fetch(url, { method: 'POST' })).rejects.toThrow()
    await expect(pm2.getByTestId('mcp-port-pod-manager')).toHaveValue(String(port))
    await again.getByRole('button', { name: t('connect.done') }).click()
    await expect(again).toBeHidden()
  })

  test('a port that is in use is refused and the switch stays off', async () => {
    const { page } = ctx
    const taken = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => resolve(s)) })
    try {
      const port = taken.address().port
      await page.getByTestId('open-connect').click()
      const dialog = page.locator('.modal.show', { hasText: t('connect.title') })
      await dialog.getByRole('tab', { name: t('connect.mcp') }).click()
      const br = dialog.locator('[data-testid="mcp-endpoint"][data-id="comfy-bridge"]')
      await br.getByTestId('mcp-port-comfy-bridge').fill(String(port))
      await br.getByTestId('mcp-port-comfy-bridge').press('Enter')
      await br.getByTestId('mcp-serve-comfy-bridge').click()   // click, not check(): the app refuses it and the switch goes back
      await expect(toast(page).last()).toContainText(`Port ${port} is in use`)
      await expect(br.getByTestId('mcp-serving')).toHaveCount(0)
      await expect(br.getByTestId('mcp-serve-comfy-bridge')).not.toBeChecked()
      expect(await toast(page).count()).toBeLessThanOrEqual(2)   // one refusal, not a stack of them
    } finally { taken.close() }
  })
})
