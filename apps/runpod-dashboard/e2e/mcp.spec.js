import { test, expect, modal } from './fixtures'
import { t } from './i18n'

// The Connect › MCP tab against the fake API: the two endpoints, the client snippets with the bridge's
// target in them, Copy, and Check (green badges or the red error).
const DIR = '/Users/lucas/Workspaces/comfy_workflow/apps/runpod-dashboard/mcp'
const POD_URL = 'https://pod-aaaaaaaa-8188.proxy.runpod.net'

const openMcp = async (page) => {
  await page.getByTestId('open-connect').click()
  const dialog = modal(page, t('connect.title'))
  await dialog.getByRole('tab', { name: t('connect.mcp') }).click()
  await expect(dialog.getByTestId('connect-mcp')).toBeVisible()
  return dialog
}
const endpoint = (dialog, id) => dialog.locator(`[data-testid="mcp-endpoint"][data-id="${id}"]`)
const snippet = (card, client) => card.locator(`[data-testid="mcp-client"][data-client="${client}"]`).getByTestId('mcp-snippet')

test.describe('Connect › MCP', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  test('lists both endpoints with their purpose, command and the four client snippets', async ({ page }) => {
    await page.goto('/')
    const dialog = await openMcp(page)
    await expect(dialog.getByTestId('mcp-endpoint')).toHaveCount(2)
    const pm = endpoint(dialog, 'pod-manager')
    await expect(pm.getByTestId('mcp-title')).toContainText('Pod manager')
    await expect(pm.getByTestId('mcp-purpose')).toContainText('orchestrates RunPod')
    await expect(pm.getByTestId('mcp-command')).toHaveText(`node ${DIR}/server.mjs`)
    await expect(pm.getByTestId('mcp-not-built')).toHaveCount(0)
    for (const c of ['claude_code', 'claude_desktop', 'codex', 'chatgpt']) await expect(snippet(pm, c)).toContainText(`${DIR}/server.mjs`)
    await expect(snippet(pm, 'claude_code')).toHaveText(`claude mcp add pod-manager -- node ${DIR}/server.mjs`)
    await expect(snippet(pm, 'claude_desktop')).toContainText('"mcpServers"')
    await expect(snippet(pm, 'codex')).toContainText('[mcp_servers.pod-manager]')
    await expect(snippet(pm, 'chatgpt')).toContainText('http://127.0.0.1:8765/mcp')
    await expect(pm.locator('[data-testid="mcp-client"][data-client="chatgpt"]')).toContainText(t('mcp.chatgptNote'))
    await expect(pm.getByTestId('mcp-client-name')).toHaveText([t('mcp.claudeCode'), t('mcp.claudeDesktop'), t('mcp.codex'), t('mcp.chatgpt')])
    const br = endpoint(dialog, 'comfy-bridge')
    await expect(br.getByTestId('mcp-title')).toContainText('ComfyUI bridge')
    await expect(br.getByTestId('mcp-not-built')).toHaveText(t('mcp.notBuilt'))
    await expect(pm.getByTestId('mcp-target')).toHaveCount(0)   // only the bridge has a target
  })

  test('the bridge\'s target (a running pod, the Mac, or a typed URL) flows into its command and every snippet', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openMcp(page)
    const br = endpoint(dialog, 'comfy-bridge')
    const select = br.getByTestId('mcp-target-select')
    await expect(select).toHaveValue(POD_URL)   // the first running pod with ComfyUI is the default
    await expect(select.locator('option')).toHaveText([t('mcp.targetAuto'), `ComfyUI-Dev · ${POD_URL}`, 'This Mac · http://127.0.0.1:8188', t('mcp.targetCustom')])
    await expect(br.getByTestId('mcp-command')).toHaveText(`node ${DIR}/comfy-bridge.mjs --comfy ${POD_URL}`)
    for (const c of ['claude_code', 'claude_desktop', 'codex', 'chatgpt']) await expect(snippet(br, c)).toContainText(POD_URL)
    await expect(snippet(br, 'claude_code')).toHaveText(`claude mcp add comfy-bridge -- node ${DIR}/comfy-bridge.mjs --comfy ${POD_URL}`)
    await expect(snippet(br, 'codex')).toContainText(`args = ["${DIR}/comfy-bridge.mjs", "--comfy", "${POD_URL}"]`)

    await select.selectOption('http://127.0.0.1:8188')
    await expect(br.getByTestId('mcp-command')).toHaveText(`node ${DIR}/comfy-bridge.mjs --comfy http://127.0.0.1:8188`)
    await expect(snippet(br, 'claude_desktop')).toContainText('"http://127.0.0.1:8188"')
    expect(api.calls.some((c) => c.path === '/mcp/endpoints' && c.query.comfy === 'http://127.0.0.1:8188')).toBe(true)

    await select.selectOption('__custom__')
    await br.getByTestId('mcp-target-url').fill('http://10.0.0.5:8188')
    await br.getByTestId('mcp-target-apply').click()
    await expect(br.getByTestId('mcp-command')).toHaveText(`node ${DIR}/comfy-bridge.mjs --comfy http://10.0.0.5:8188`)
    await expect(snippet(br, 'chatgpt')).toContainText('--comfy http://10.0.0.5:8188 --http 8766')

    await select.selectOption('')   // let the bridge pick
    await expect(br.getByTestId('mcp-command')).toHaveText(`node ${DIR}/comfy-bridge.mjs`)
    await expect(snippet(br, 'claude_code')).toHaveText(`claude mcp add comfy-bridge -- node ${DIR}/comfy-bridge.mjs`)
  })

  test('Copy puts the snippet or the command on the clipboard and says so', async ({ page }) => {
    await page.goto('/')
    const dialog = await openMcp(page)
    const pm = endpoint(dialog, 'pod-manager')
    await pm.locator('[data-testid="mcp-client"][data-client="codex"]').getByTestId('mcp-copy').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('mcp.copied', { what: t('mcp.whatSnippet', { name: 'Pod manager', client: t('mcp.codex') }) }))
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`[mcp_servers.pod-manager]\ncommand = "node"\nargs = ["${DIR}/server.mjs"]`)
    await pm.getByTestId('mcp-copy-command').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('mcp.copied', { what: t('mcp.whatCommand', { name: 'Pod manager' }) }))
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`node ${DIR}/server.mjs`)
  })

  test('Check shows the tools in green, or the error in red', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openMcp(page)
    const pm = endpoint(dialog, 'pod-manager')
    await pm.getByTestId('mcp-check').click()
    await expect(pm.getByTestId('mcp-result')).toHaveAttribute('data-ok', 'true')
    await expect(pm.getByTestId('mcp-tool')).toHaveText(['list_agents', 'get_pool_status', 'governance', 'list_pods'])
    await expect(pm.getByTestId('mcp-tool').first()).toHaveClass(/bg-success/)
    await expect(pm.getByTestId('mcp-result-facts')).toHaveText(t('mcp.tools', { n: 4, ms: 120 }))
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.mcpChecked', { name: 'Pod manager' }))
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '/mcp/probe').body).toEqual({ id: 'pod-manager', comfy: POD_URL })

    const br = endpoint(dialog, 'comfy-bridge')
    await br.getByTestId('mcp-check').click()
    await expect(br.getByTestId('mcp-result')).toHaveAttribute('data-ok', 'false')
    await expect(br.getByTestId('mcp-result-error')).toContainText('No ComfyUI answers at')
    await expect(br.getByTestId('mcp-result-error')).toHaveClass(/bg-danger/)
    await expect(br.getByTestId('mcp-tool')).toHaveCount(0)
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.failedWith', { label: t('toast.mcpCheck', { name: 'ComfyUI bridge' }), error: 'The server exited (code 2) before answering' }))
    expect(api.calls.filter((c) => c.path === '/mcp/probe').at(-1).body).toEqual({ id: 'comfy-bridge', comfy: POD_URL })

    // A new target makes the bridge's last Check stale; the pod manager's stays.
    await br.getByTestId('mcp-target-select').selectOption('http://127.0.0.1:8188')
    await expect(br.getByTestId('mcp-result')).toHaveCount(0)
    await expect(pm.getByTestId('mcp-result')).toHaveCount(1)
  })
})
