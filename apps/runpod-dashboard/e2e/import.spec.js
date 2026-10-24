import { test, expect, modal } from './fixtures'
import { t } from './i18n'

// The Connect › Import tab against the fake API: pick a folder, read the plan an adapter made, Dry run, Import,
// conflicts, and approving one of your own adapters (docs/ADR-008).
const PKG = '/Users/lucas/Projects/package'

const openImport = async (page, api, { mapped = true } = {}) => {
  if (mapped) api.state.mounts.config.folders['comfy-shared'] = '/Users/lucas/ComfyUI-Shared'
  await page.goto('/')
  await page.getByTestId('open-connect').click()
  const dialog = modal(page, t('connect.title'))
  await dialog.getByRole('tab', { name: t('connect.import') }).click()
  await expect(dialog.getByTestId('connect-import')).toBeVisible()
  return dialog
}

test.describe('Connect › Import', () => {
  test('shows where imports land, and says so when ComfyUI-Shared is not mapped', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    await expect(dialog.getByTestId('import-target-path')).toHaveText('/Users/lucas/ComfyUI-Shared')
    await page.reload()
    api.state.mounts.config.folders['comfy-shared'] = ''
    const d2 = await openImport(page, api, { mapped: false })
    await expect(d2.getByTestId('import-target-unmapped')).toContainText(t('import.targetUnmapped'))
  })

  test('plans a folder: the adapter, what goes where by kind, and the findings', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-plan-title')).toContainText('Panama Canal v2 delivery package')
    await expect(dialog.getByTestId('import-plan-adapter')).toHaveText('panama-imax-redux')
    await expect(dialog.getByTestId('import-fenced')).toHaveText(t('import.fenced'))
    await expect(dialog.locator('[data-testid="import-kind"][data-kind="input"]')).toContainText('30')
    await expect(dialog.locator('[data-testid="import-kind"][data-kind="workflow"]')).toContainText('2')
    await expect(dialog.getByTestId('import-summary')).toContainText('32')
    await expect(dialog.locator('[data-testid="import-finding"][data-level="warn"]')).toContainText('FalAPI_*')
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/imports/plan' }))
  })

  test('a folder no adapter recognises says so', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill('/Users/lucas/Projects/other')
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-error')).toContainText('no adapter recognises')
    await expect(dialog.getByTestId('import-plan-card')).toHaveCount(0)
  })

  test('Dry run writes nothing; Import copies and shows the record', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-plan').click()
    await dialog.getByTestId('import-dry').click()
    await expect(dialog.getByTestId('import-result')).toHaveAttribute('data-dry', 'true')
    await expect(dialog.getByTestId('import-count-would-copy')).toContainText('32')
    await expect(dialog.getByTestId('import-record')).toHaveCount(0)
    await dialog.getByTestId('import-run').click()
    await expect(dialog.getByTestId('import-result')).toHaveAttribute('data-dry', 'false')
    await expect(dialog.getByTestId('import-count-copied')).toContainText('32')
    await expect(dialog.getByTestId('import-record')).toContainText('imports/2026-10-24-panama-imax-redux.json')
    await expect(page.getByTestId('toast').last()).toContainText(t('import.toastDone', { n: 32 }))
    expect(api.state.imports.lastApply).toMatchObject({ dryRun: false, overwrite: false })
  })

  test('a conflict is reported, and Replace is a switch that is off by default', async ({ page, api }) => {
    api.state.imports.conflicts = 1
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-overwrite')).not.toBeChecked()
    await dialog.getByTestId('import-run').click()
    await expect(dialog.getByTestId('import-result')).toHaveAttribute('data-ok', 'false')
    await expect(dialog.getByTestId('import-count-conflict')).toContainText('1')
    await expect(dialog.getByTestId('import-problem')).toContainText('exists and differs')
    await dialog.getByTestId('import-overwrite').check()
    await dialog.getByTestId('import-run').click()
    await expect.poll(() => api.state.imports.lastApply?.overwrite).toBe(true)
  })

  test('your own adapter is listed unapproved; reading its source and approving it makes it usable', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    const row = dialog.locator('[data-testid="import-adapter-row"][data-id="agent-made"]')
    await expect(row.getByTestId('import-adapter-state')).toHaveText(t('import.notApproved'))
    await expect(dialog.getByTestId('import-adapter').locator('option')).toHaveCount(3)   // best match + the two built-ins; not the unapproved one
    await row.getByTestId('import-adapter-read').click()
    const reading = modal(page, 'agent-made')
    await expect(reading.getByTestId('import-source')).toContainText('export default')
    await reading.getByTestId('import-approve').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('import.toastApproved', { id: 'agent-made' }))
    await expect(row.getByTestId('import-adapter-state')).toHaveText(t('import.approved'))
    await expect(dialog.getByTestId('import-adapter').locator('option')).toHaveCount(4)
  })

  test('the two built-in adapters are listed as built-in', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    for (const id of ['comfy-shared', 'panama-imax-redux']) await expect(dialog.locator(`[data-testid="import-adapter-row"][data-id="${id}"]`).getByTestId('import-adapter-builtin')).toHaveText(t('import.builtIn'))
  })
})

test.describe('Connect › Import › Write an adapter with Claude', () => {
  test('is off until an Anthropic key is set, and says why', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await expect(dialog.getByTestId('import-claude')).toBeDisabled()
    await expect(dialog.getByTestId('import-claude')).toHaveAttribute('title', t('import.claudeNoKey'))
  })

  test('shows exactly what would be sent, sends nothing until confirmed, then opens the draft for reading', async ({ page, api }) => {
    api.state.settings = { ...api.state.settings, anthropic_key_set: true, anthropic_key_hint: '••••WXYZ' }
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-claude').click()
    const ask = modal(page, t('import.claudeTitle'))
    await expect(ask.getByTestId('import-claude-counts')).toContainText('120')
    await expect(ask.getByTestId('import-claude-text')).toHaveCount(2)
    await expect(ask.getByTestId('import-claude-text').nth(1)).toContainText(t('import.claudeBytes', { sent: 12288, bytes: 40000 }))
    await expect(ask.getByTestId('import-claude-dirs')).toContainText('shotA/comfy/  40')
    expect(api.calls.some((c) => c.path === '/imports/draft')).toBe(false)   // nothing sent yet
    await ask.getByTestId('import-claude-send').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('import.toastDrafted', { id: 'draft-package' }))
    const reading = modal(page, 'draft-package')
    await expect(reading.getByTestId('import-source')).toContainText('draft-package')   // opens for reading, unapproved
    expect(api.state.imports.drafted).toBe(PKG)
    await reading.getByTestId('import-approve').click()
    await expect(dialog.locator('[data-testid="import-adapter-row"][data-id="draft-package"]').getByTestId('import-adapter-state')).toHaveText(t('import.approved'))
  })

  test('an API error shows in the tab and nothing is saved', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    api.state.settings = { ...api.state.settings, anthropic_key_set: true }
    await page.reload()
    const d2 = await openImport(page, api)
    api.state.settings.anthropic_key_set = false   // the key is gone by the time Send is pressed
    await d2.getByTestId('import-folder').fill(PKG)
    await d2.getByTestId('import-claude').click()
    await modal(page, t('import.claudeTitle')).getByTestId('import-claude-send').click()
    await expect(d2.getByTestId('import-error')).toContainText('No Anthropic API key')
    await expect(d2.locator('[data-testid="import-adapter-row"][data-id="draft-package"]')).toHaveCount(0)
  })
})
