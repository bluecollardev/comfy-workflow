import { test, expect } from '@playwright/test'
import { launchApp, toast } from './app.js'
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
    await expect(pm.getByTestId('mcp-command')).toContainText(/\/mcp\/server\.mjs$/)   // mcp.endpoints: the absolute path from the core
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
