import { test, expect, modal, BRIDGE_DEFS } from './fixtures'
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
const snippet = async (card, client) => { await card.getByTestId('mcp-client-select').selectOption(client); return card.locator(`[data-testid="mcp-client"][data-client="${client}"]`).getByTestId('mcp-snippet') }

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
    for (const c of ['claude_code', 'claude_desktop', 'codex', 'chatgpt']) await expect(await snippet(pm, c)).toContainText(`${DIR}/server.mjs`)
    await expect(await snippet(pm, 'claude_code')).toHaveText(`claude mcp add pod-manager -- node ${DIR}/server.mjs`)
    await expect(await snippet(pm, 'claude_desktop')).toContainText('"mcpServers"')
    await expect(await snippet(pm, 'codex')).toContainText('[mcp_servers.pod-manager]')
    await expect(await snippet(pm, 'chatgpt')).toContainText('http://127.0.0.1:8765/mcp')
    await pm.getByTestId('mcp-client-select').selectOption('chatgpt')
    await expect(pm.locator('[data-testid="mcp-client"][data-client="chatgpt"]')).toContainText(t('mcp.chatgptNote'))
    await expect(pm.getByTestId('mcp-client-select').locator('option')).toHaveText([t('mcp.claudeCode'), t('mcp.claudeDesktop'), t('mcp.codex'), t('mcp.chatgpt')])   // one client at a time, from a menu
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
    for (const c of ['claude_code', 'claude_desktop', 'codex', 'chatgpt']) await expect(await snippet(br, c)).toContainText(POD_URL)
    await expect(await snippet(br, 'claude_code')).toHaveText(`claude mcp add comfy-bridge -- node ${DIR}/comfy-bridge.mjs --comfy ${POD_URL}`)
    await expect(await snippet(br, 'codex')).toContainText(`args = ["${DIR}/comfy-bridge.mjs", "--comfy", "${POD_URL}"]`)

    await select.selectOption('http://127.0.0.1:8188')
    await expect(br.getByTestId('mcp-command')).toHaveText(`node ${DIR}/comfy-bridge.mjs --comfy http://127.0.0.1:8188`)
    await expect(await snippet(br, 'claude_desktop')).toContainText('"http://127.0.0.1:8188"')
    expect(api.calls.some((c) => c.path === '/mcp/endpoints' && c.query.comfy === 'http://127.0.0.1:8188')).toBe(true)

    await select.selectOption('__custom__')
    await br.getByTestId('mcp-target-url').fill('http://10.0.0.5:8188')
    await br.getByTestId('mcp-target-apply').click()
    await expect(br.getByTestId('mcp-command')).toHaveText(`node ${DIR}/comfy-bridge.mjs --comfy http://10.0.0.5:8188`)
    await expect(await snippet(br, 'chatgpt')).toContainText('--comfy http://10.0.0.5:8188 --http 8766')

    await select.selectOption('')   // let the bridge pick
    await expect(br.getByTestId('mcp-command')).toHaveText(`node ${DIR}/comfy-bridge.mjs`)
    await expect(await snippet(br, 'claude_code')).toHaveText(`claude mcp add comfy-bridge -- node ${DIR}/comfy-bridge.mjs`)
  })

  test('Copy puts the snippet or the command on the clipboard and says so', async ({ page }) => {
    await page.goto('/')
    const dialog = await openMcp(page)
    const pm = endpoint(dialog, 'pod-manager')
    await pm.getByTestId('mcp-client-select').selectOption('codex')
    await pm.locator('[data-testid="mcp-client"][data-client="codex"]').getByTestId('mcp-copy').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('mcp.copied', { what: t('mcp.whatSnippet', { name: 'Pod manager', client: t('mcp.codex') }) }))
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`[mcp_servers.pod-manager]\ncommand = "node"\nargs = ["${DIR}/server.mjs"]`)
    await pm.getByTestId('mcp-copy-command').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('mcp.copied', { what: t('mcp.whatCommand', { name: 'Pod manager' }) }))
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`node ${DIR}/server.mjs`)
  })

  test('the header badge: probing -> connected for the pod manager, not connected for a failed probe', async ({ page, api }) => {
    api.state.mcp.delay = 600
    await page.goto('/')
    const dialog = await openMcp(page)
    const pm = endpoint(dialog, 'pod-manager')
    const br = endpoint(dialog, 'comfy-bridge')
    await expect(pm.getByTestId('mcp-probing')).toBeVisible()   // the tab probes both endpoints when it is first shown
    await expect(pm.getByTestId('mcp-connected')).toHaveText(t('mcp.connected'))
    await expect(pm.getByTestId('mcp-connected')).toHaveClass(/bg-success/)
    await expect(br.getByTestId('mcp-disconnected')).toHaveText(t('mcp.disconnected'))
    await expect(br.getByTestId('mcp-disconnected')).toHaveClass(/bg-danger/)
    await expect(br.getByTestId('mcp-disconnected')).toHaveAttribute('title', /No ComfyUI answers at/)
    expect(api.calls.filter((c) => c.path === '/mcp/probe').map((c) => c.body.id).sort()).toEqual(['comfy-bridge', 'pod-manager'])
  })

  test('the bridge without a target shows No target instead of a failure; picking one probes it again', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openMcp(page)
    const br = endpoint(dialog, 'comfy-bridge')
    await expect(br.getByTestId('mcp-disconnected')).toBeVisible()
    api.state.mcp.probe['comfy-bridge'] = { ok: true, tools: BRIDGE_DEFS.map((d) => d.name), definitions: BRIDGE_DEFS, error: null, ms: 80 }
    await br.getByTestId('mcp-target-select').selectOption('')
    await expect(br.getByTestId('mcp-no-target')).toHaveText(t('mcp.noTarget'))
    await expect(br.getByTestId('mcp-no-target')).toHaveClass(/bg-warning/)
    await expect(br.getByTestId('mcp-no-target')).toHaveAttribute('title', t('mcp.noTargetHint'))
    await expect(br.getByTestId('mcp-disconnected')).toHaveCount(0)
    const before = api.calls.filter((c) => c.path === '/mcp/probe').length
    await br.getByTestId('mcp-target-select').selectOption('http://127.0.0.1:8188')   // a target again: probed again, now connected
    await expect(br.getByTestId('mcp-connected')).toBeVisible()
    expect(api.calls.filter((c) => c.path === '/mcp/probe').length).toBe(before + 1)
    expect(api.calls.filter((c) => c.path === '/mcp/probe').at(-1).body).toEqual({ id: 'comfy-bridge', comfy: 'http://127.0.0.1:8188' })
  })

  test('Check re-runs the probe: the facts line, no chips, a toast; a failure shows the error in red', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openMcp(page)
    const pm = endpoint(dialog, 'pod-manager')
    await expect(pm.getByTestId('mcp-connected')).toBeVisible()
    await pm.getByTestId('mcp-check').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.mcpChecked', { name: 'Pod manager' }))
    await expect(pm.getByTestId('mcp-result')).toHaveAttribute('data-ok', 'true')
    await expect(pm.getByTestId('mcp-result-facts')).toHaveText(t('mcp.tools', { n: 6, ms: 120 }))
    await expect(pm.getByTestId('mcp-tool')).toHaveCount(0)   // the chips are gone; the Docs button has the tools
    expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/mcp/probe').at(-1).body).toEqual({ id: 'pod-manager', comfy: POD_URL })

    const br = endpoint(dialog, 'comfy-bridge')
    await br.getByTestId('mcp-check').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.failedWith', { label: t('toast.mcpCheck', { name: 'ComfyUI bridge' }), error: 'The server exited (code 2) before answering' }))
    await expect(br.getByTestId('mcp-result')).toHaveAttribute('data-ok', 'false')
    await expect(br.getByTestId('mcp-result-error')).toContainText('No ComfyUI answers at')
    await expect(br.getByTestId('mcp-result-error')).toHaveClass(/bg-danger/)
    expect(api.calls.filter((c) => c.path === '/mcp/probe').at(-1).body).toEqual({ id: 'comfy-bridge', comfy: POD_URL })
  })
})

test.describe('Connect › MCP › Docs', () => {
  const openDocs = async (page, id = 'pod-manager') => {
    const dialog = await openMcp(page)
    await endpoint(dialog, id).getByTestId('mcp-docs').click()
    const docs = page.getByTestId('mcp-docs-modal')
    await expect(docs).toBeVisible()
    return docs
  }
  const tool = (docs, name) => docs.locator(`[data-testid="mcp-docs-tool"][data-name="${name}"]`)
  const group = (docs, g) => docs.locator(`[data-testid="mcp-docs-group"][data-group="${g}"]`)
  const open = async (docs, g) => { const s = group(docs, g); if (!(await s.getByTestId('mcp-docs-tool').count())) await s.getByTestId('mcp-docs-group-toggle').click() }
  const param = (docs, tl, name) => tool(docs, tl).locator(`[data-testid="mcp-docs-param"][data-name="${name}"]`)

  test('opens with the title, the status badge and the tools grouped by name with counts', async ({ page }) => {
    await page.goto('/')
    const docs = await openDocs(page)
    await expect(docs.getByTestId('mcp-docs-title')).toHaveText(t('mcp.docsTitle', { name: 'Pod manager' }))
    await expect(docs.getByTestId('mcp-connected')).toBeVisible()
    await expect(docs.getByTestId('mcp-docs-group')).toHaveCount(3)
    await expect(group(docs, 'pool').getByTestId('mcp-docs-group-count')).toHaveText('3')
    await expect(group(docs, 'pods').getByTestId('mcp-docs-group-count')).toHaveText('2')
    await expect(group(docs, 'other').getByTestId('mcp-docs-group-count')).toHaveText('1')
    await expect(group(docs, 'pool').getByTestId('mcp-docs-group-toggle')).toContainText(t('mcp.group.pool'))
  })

  test('groups collapse and expand', async ({ page }) => {
    await page.goto('/')
    const docs = await openDocs(page)
    await expect(docs.getByTestId('mcp-docs-tool')).toHaveCount(0)   // several groups start collapsed
    await group(docs, 'pool').getByTestId('mcp-docs-group-toggle').click()
    await expect(group(docs, 'pool').getByTestId('mcp-docs-tool')).toHaveCount(3)
    await expect(docs.getByTestId('mcp-docs-tool')).toHaveCount(3)
    await group(docs, 'pool').getByTestId('mcp-docs-group-toggle').click()
    await expect(docs.getByTestId('mcp-docs-tool')).toHaveCount(0)
  })

  test('search filters by name and description, and opens the groups it finds', async ({ page }) => {
    await page.goto('/')
    const docs = await openDocs(page)
    await docs.getByTestId('mcp-docs-search').fill('delete')
    await expect(docs.getByTestId('mcp-docs-tool')).toHaveCount(1)
    await expect(tool(docs, 'delete_pod')).toBeVisible()
    await docs.getByTestId('mcp-docs-search').fill('per hour')   // a description match
    await expect(docs.getByTestId('mcp-docs-tool')).toHaveText([/cost_now/])
    await docs.getByTestId('mcp-docs-search').fill('zzz')
    await expect(docs.getByTestId('mcp-docs-empty')).toHaveText(t('mcp.docsNoMatch'))
    await docs.getByTestId('mcp-docs-search').fill('')
    await expect(docs.getByTestId('mcp-docs-tool')).toHaveCount(0)
  })

  test('the params table: type, required, default, options, nested properties; no params says so', async ({ page }) => {
    await page.goto('/')
    const docs = await openDocs(page)
    await open(docs, 'pool')
    await expect(tool(docs, 'list_agents').getByTestId('mcp-docs-no-params')).toHaveText(t('mcp.docsNoParams'))
    await expect(tool(docs, 'list_agents').getByTestId('mcp-docs-param')).toHaveCount(0)
    const gpu = param(docs, 'create_agent', 'gpu_type')
    await expect(gpu.locator('[data-col="type"]')).toHaveText('string')
    await expect(gpu.locator('[data-col="options"] .badge')).toHaveText(['auto', 'rtx4090', 'a40'])
    await expect(gpu.locator('[data-col="required"] i')).toHaveCount(0)
    const storage = param(docs, 'create_agent', 'storage_gb')
    await expect(storage.locator('[data-col="type"]')).toHaveText('integer')
    await expect(storage.locator('[data-col="default"]')).toHaveText('100')
    await expect(storage.locator('[data-col="options"]')).toHaveText('0–500')
    await expect(param(docs, 'create_agent', 'approved_by').locator('[data-col="required"] i')).toHaveCount(1)
    await expect(param(docs, 'create_agent', 'tags').locator('[data-col="type"]')).toHaveText('array of string')
    await expect(param(docs, 'create_agent', 'env').locator('[data-col="type"]')).toHaveText('object')
    await expect(param(docs, 'create_agent', 'env.key')).toHaveCount(0)   // the sub-table is collapsed
    await tool(docs, 'create_agent').getByTestId('mcp-docs-nested-toggle').click()
    await expect(param(docs, 'create_agent', 'env.key').locator('[data-col="type"]')).toHaveText('string')
  })

  test('destructive tools (confirm required) carry the needs confirm badge', async ({ page }) => {
    await page.goto('/')
    const docs = await openDocs(page)
    await open(docs, 'pods')
    await expect(tool(docs, 'delete_pod').getByTestId('mcp-docs-confirm')).toHaveText(t('mcp.needsConfirm'))
    await expect(tool(docs, 'list_pods').getByTestId('mcp-docs-confirm')).toHaveCount(0)
  })

  test('the bridge: [group] tags, the text without tag and ComfyUI line, one call row per call', async ({ page, api }) => {
    api.state.mcp.probe['comfy-bridge'] = { ok: true, tools: BRIDGE_DEFS.map((d) => d.name), definitions: BRIDGE_DEFS, error: null, ms: 80 }
    await page.goto('/')
    const docs = await openDocs(page, 'comfy-bridge')
    await expect(docs.getByTestId('mcp-docs-group')).toHaveCount(2)
    await open(docs, 'queue')
    await expect(group(docs, 'queue').getByTestId('mcp-docs-group-toggle')).toContainText(t('mcp.group.queue'))
    const clear = tool(docs, 'clear_queue')
    await expect(clear.getByTestId('mcp-docs-text')).toHaveText('Clear queue or interrupt.')
    await expect(clear.getByTestId('mcp-docs-call')).toHaveCount(2)
    await expect(clear.getByTestId('mcp-docs-method')).toHaveText(['POST', 'POST'])
    await expect(clear.getByTestId('mcp-docs-path')).toHaveText(['/queue', '/interrupt'])
    await expect(tool(docs, 'get_queue').getByTestId('mcp-docs-method')).toHaveClass(/bg-success/)
    await expect(clear.getByTestId('mcp-docs-confirm')).toBeVisible()
    await open(docs, 'nodes')
    await expect(tool(docs, 'node_info').getByTestId('mcp-docs-path')).toHaveText('/object_info/{class}')
  })

  test('a failed probe shows its error in the modal', async ({ page }) => {
    await page.goto('/')
    const docs = await openDocs(page, 'comfy-bridge')
    await expect(docs.getByTestId('mcp-docs-error')).toContainText('No ComfyUI answers at')
    await expect(docs.getByTestId('mcp-disconnected')).toBeVisible()
    await expect(docs.getByTestId('mcp-docs-search')).toHaveCount(0)
  })

  test('Docs waits for the tab\'s own probe, with a spinner, instead of probing twice', async ({ page, api }) => {
    api.state.mcp.delay = 800
    await page.goto('/')
    const dialog = await openMcp(page)
    await endpoint(dialog, 'pod-manager').getByTestId('mcp-docs').click()
    const docs = page.getByTestId('mcp-docs-modal')
    await expect(docs.getByTestId('mcp-docs-probing')).toBeVisible()
    await expect(docs.getByTestId('mcp-docs-group')).toHaveCount(3)
    expect(api.calls.filter((c) => c.path === '/mcp/probe' && c.body.id === 'pod-manager').length).toBe(1)
  })

  test('Docs runs the probe itself when none ran yet (the bridge without a target)', async ({ page, api }) => {
    api.state.mcp.probe['comfy-bridge'] = { ok: true, tools: BRIDGE_DEFS.map((d) => d.name), definitions: BRIDGE_DEFS, error: null, ms: 80 }
    api.state.mcp.delay = 500
    await page.goto('/')
    const dialog = await openMcp(page)
    const br = endpoint(dialog, 'comfy-bridge')
    await br.getByTestId('mcp-target-select').selectOption('')   // no target: no automatic probe
    await expect(br.getByTestId('mcp-no-target')).toBeVisible()
    const before = api.calls.filter((c) => c.path === '/mcp/probe' && c.body.id === 'comfy-bridge').length
    await br.getByTestId('mcp-docs').click()
    const docs = page.getByTestId('mcp-docs-modal')
    await expect(docs.getByTestId('mcp-docs-probing')).toBeVisible()
    await expect(docs.getByTestId('mcp-docs-group')).toHaveCount(2)
    expect(api.calls.filter((c) => c.path === '/mcp/probe' && c.body.id === 'comfy-bridge').length).toBe(before + 1)
  })
})
