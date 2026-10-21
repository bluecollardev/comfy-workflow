import { test, expect } from '@playwright/test'
import { launchApp, toast } from './app.js'
import { t } from '../e2e/i18n.js'

// Connect › MCP in the real app, no-spend mode: Check really spawns mcp/server.mjs from the main process
// (Electron run as node), performs initialize and tools/list, and the badges are the server's tools.
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
    await pm.getByTestId('mcp-check').click()                                             // mcp.probe
    await expect(pm.getByTestId('mcp-result')).toHaveAttribute('data-ok', 'true', { timeout: 30_000 })
    const tools = await pm.getByTestId('mcp-tool').allTextContents()
    expect(tools).toContain('list_agents')
    expect(tools).toContain('get_pool_status')
    expect(tools).toContain('governance')
    await expect(toast(page).last()).toContainText(t('toast.mcpChecked', { name: 'Pod manager' }))
    // The bridge card is there with its target menu (mcp.targets answered; no pod runs, so "let the bridge pick" or a typed URL).
    const br = dialog.locator('[data-testid="mcp-endpoint"][data-id="comfy-bridge"]')
    await expect(br.getByTestId('mcp-target-select')).toBeVisible()
  })
})
