import { test, expect, modal, podCard } from './fixtures'
import { t } from './i18n'

// The Import Shot Pack modal (opened by the pod card's primary button) against the fake API: pick a folder, read the plan an adapter made, Dry run, Import,
// conflicts, and reading the adapters (docs/ADR-008).
const PKG = '/Users/lucas/Projects/package'

const openImport = async (page, api, { mapped = true } = {}) => {
  if (mapped) api.state.mounts.config.folders['comfy-shared'] = '/Users/lucas/ComfyUI-Shared'
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
  const dialog = modal(page, t('import.title'))
  await expect(dialog.getByTestId('import-pane')).toBeVisible()
  return dialog
}

test.describe('Import Shot Pack', () => {
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
    await expect(page.getByTestId('toast').filter({ hasText: t('import.toastDone', { n: 32 }) })).toBeVisible()
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

  test('every adapter is listed with Inspect: its code is open to read, yours are marked, and all can be chosen', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    const row = dialog.locator('[data-testid="import-adapter-row"][data-id="agent-made"]')
    await expect(row.getByTestId('import-adapter-kind')).toHaveText(t('import.yours'))
    await expect(dialog.getByTestId('import-adapter').locator('option')).toHaveCount(4)   // best match + the three adapters: nothing waits for approval
    await row.getByTestId('import-adapter-read').click()
    const reading = modal(page, 'agent-made')
    await expect(reading.getByTestId('import-source')).toContainText('export default')
    await expect(reading.getByTestId('import-approve')).toHaveCount(0)   // there is no approval step
    await reading.getByTestId('import-source-close').click()
    await dialog.locator('[data-testid="import-adapter-row"][data-id="comfy-shared"]').getByTestId('import-adapter-read').click()   // built-ins can be read too
    await expect(modal(page, 'comfy-shared').getByTestId('import-source')).toContainText("id: 'comfy-shared'")
  })

  test('Manage adapters is a link to Default Configuration, scrolled to Import adapters', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-manage-adapters').click()
    const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await expect(cfg).toBeVisible()
    await expect(cfg.getByTestId('adapter-manager')).toBeInViewport()
    await expect(page.getByTestId('import-modal')).toBeHidden()
  })

  test('the two built-in adapters are listed as built-in', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    for (const id of ['comfy-shared', 'panama-imax-redux']) await expect(dialog.locator(`[data-testid="import-adapter-row"][data-id="${id}"]`).getByTestId('import-adapter-kind')).toHaveText(t('import.builtIn'))
  })
})

test.describe('Import Shot Pack › Write an adapter with Claude', () => {
  test('without a key the button is there, says why, and takes you to the key field', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    await expect(dialog.getByTestId('import-claude')).toBeVisible()
    await expect(dialog.getByTestId('import-claude')).toBeEnabled()
    await expect(dialog.getByTestId('import-claude-nokey')).toContainText(t('import.claudeNoKeyLine'))
    await dialog.getByTestId('import-claude').click()
    const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await expect(cfg).toBeVisible()
    await expect(cfg.getByTestId('cfg-claude-key')).toBeVisible()
    await expect(page.getByTestId('import-modal')).toBeHidden()
  })

  test('with a key it asks for a folder first, then opens the preview', async ({ page, api }) => {
    api.state.settings = { ...api.state.settings, anthropic_key_set: true, anthropic_key_hint: '••••WXYZ' }
    const dialog = await openImport(page, api)
    await expect(dialog.getByTestId('import-claude-nokey')).toHaveCount(0)
    await expect(dialog.getByTestId('import-claude-ready')).toContainText(t('import.claudeKeyOk', { hint: '••••WXYZ' }))
    await expect(dialog.getByTestId('import-claude-ready')).toContainText(t('import.claudeNeedFolder'))
    await expect(dialog.getByTestId('import-claude')).toBeEnabled()
    await dialog.getByTestId('import-claude').click()   // no folder: it answers, it does not sit there
    await expect(dialog.getByTestId('import-error')).toHaveText(t('import.claudeNeedFolderError'))
    await expect(dialog.getByTestId('import-folder')).toBeFocused()
    await dialog.getByTestId('import-folder').fill(PKG)
    await expect(dialog.getByTestId('import-claude-ready')).not.toContainText(t('import.claudeNeedFolder'))
    await dialog.getByTestId('import-claude').click()
    await expect(modal(page, t('import.claudeTitle'))).toBeVisible()
  })

  test('shows exactly what would be sent, sends nothing until confirmed, then shows the draft to read', async ({ page, api }) => {
    api.state.settings = { ...api.state.settings, anthropic_key_set: true, anthropic_key_hint: '••••WXYZ' }
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-claude').click()
    const ask = modal(page, t('import.claudeTitle'))
    await expect(ask.getByTestId('import-claude-rule')).toContainText(t('import.claudeRule'))
    await expect(ask.getByTestId('import-claude-counts')).toContainText('120')
    await expect(ask.getByTestId('import-claude-text')).toHaveCount(2)
    await expect(ask.getByTestId('import-claude-text').nth(1)).toContainText(t('import.claudeBytes', { sent: 12288, bytes: 40000 }))
    await expect(ask.getByTestId('import-claude-dirs')).toContainText('shotA/comfy/  40')
    expect(api.calls.some((c) => c.path === '/imports/draft')).toBe(false)   // nothing sent yet
    await ask.getByTestId('import-claude-instruction').fill('the graphs are under comfy/workflows')
    await ask.getByTestId('import-claude-send').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('import.toastDrafted', { id: 'draft-package' }))
    expect(api.state.imports.drafts[0]).toMatchObject({ source: PKG, instruction: 'the graphs are under comfy/workflows' })
    await expect(dialog.getByTestId('import-draft-id')).toHaveText('draft-package')
    await expect(dialog.getByTestId('import-draft-structure')).toHaveText(t('import.draftStructureOk'))
    await expect(dialog.getByTestId('import-draft-ignored')).toHaveCount(0)
    await expect(dialog.getByTestId('import-draft-tested')).toHaveText(t('import.draftNotTested'))
    await expect(dialog.getByTestId('import-draft-test')).toBeEnabled()   // no approval step: it can be tested on the folder straight away
  })

  test('the loop: prompt, fails the structure, prompt again with the errors, test fails the plan, prompt again, valid, use it', async ({ page, api }) => {
    api.state.settings = { ...api.state.settings, anthropic_key_set: true, anthropic_key_hint: '••••WXYZ' }
    api.state.imports.draftScript = [
      { valid: false, errors: ['the id is "wrong" but it must be "draft-package"', 'there is no detect(root, ctx) function'] },
      { valid: true, errors: [] },
      { valid: true, errors: [] },
    ]
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-claude').click()
    await modal(page, t('import.claudeTitle')).getByTestId('import-claude-send').click()
    // 1. the structure fails: the errors are shown and the person prompts again
    await expect(dialog.getByTestId('import-draft-structure')).toHaveText(t('import.draftStructureBad'))
    await expect(dialog.getByTestId('import-draft-error')).toHaveCount(2)
    await expect(dialog.getByTestId('import-draft-valid')).toHaveCount(0)
    await dialog.getByTestId('import-draft-instruction').fill('name it draft-package and add detect')
    await dialog.getByTestId('import-draft-rewrite').click()
    await expect(dialog.getByTestId('import-draft-structure')).toHaveText(t('import.draftStructureOk'))
    await expect(dialog.getByTestId('import-draft')).toContainText(t('import.draftRound', { n: 2 }))
    const second = api.state.imports.drafts[1]
    expect(second).toMatchObject({ id: 'draft-package', instruction: 'name it draft-package and add detect' })
    expect(second.errors).toEqual(['the id is "wrong" but it must be "draft-package"', 'there is no detect(root, ctx) function'])   // the errors went back with the prompt
    // 2. read it, then test on the folder: the plan fails the required structure
    await dialog.getByTestId('import-draft-read').click()
    await expect(modal(page, 'draft-package').getByTestId('import-source')).toContainText('version 2')
    await modal(page, 'draft-package').getByTestId('import-source-close').click()
    api.state.imports.draftPlanError = 'op 0: ../escape leaves its folder'
    await dialog.getByTestId('import-draft-test').click()
    await expect(dialog.getByTestId('import-draft-tested')).toHaveText(t('import.draftTestedBad'))
    await expect(dialog.getByTestId('import-draft-error')).toContainText('leaves its folder')
    // 3. prompt again with the plan error, then test again
    await dialog.getByTestId('import-draft-instruction').fill('keep every destination inside input/')
    await dialog.getByTestId('import-draft-rewrite').click()
    expect(api.state.imports.drafts[2].errors).toEqual(['op 0: ../escape leaves its folder'])
    await dialog.getByTestId('import-draft-test').click()
    await expect(dialog.getByTestId('import-draft-tested')).toHaveText(t('import.draftTestedOk'))
    await expect(dialog.getByTestId('import-draft-valid')).toBeVisible()
    await expect(dialog.getByTestId('import-draft')).toHaveAttribute('data-valid', 'true')
    await dialog.getByTestId('import-draft-use').click()
    await expect(dialog.getByTestId('import-draft')).toHaveCount(0)
    await expect(dialog.getByTestId('import-adapter')).toHaveValue('draft-package')
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

test.describe('Import Shot Pack › the description', () => {
  const withKey = (api) => { api.state.settings = { ...api.state.settings, anthropic_key_set: true, anthropic_key_hint: '••••WXYZ' } }

  test('attaching a folder has Claude describe the shot pack, says what was sent, and the plan still shows', async ({ page, api }) => {
    withKey(api)
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-about-text')).toContainText('three shots')
    await expect(dialog.getByTestId('import-about-sent')).toContainText(t('import.describeSent', { files: 120, dirs: 8, texts: 2, model: 'claude-sonnet-5-5' }))
    await expect(dialog.getByTestId('import-about')).toContainText(t('import.aboutBadge'))
    await expect(dialog.getByTestId('import-plan-card')).toBeVisible()
    expect(api.state.imports.described).toBe(1)
  })

  test('choosing the folder with Browse attaches it: plan and description without pressing Plan', async ({ page, api }) => {
    withKey(api)
    api.state.fs['/Users/lucas/Projects'] = ['package']; api.state.imports.plans['/Users/lucas/Projects/package'] = api.state.imports.plans[PKG]
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-browse').click()
    const picker = modal(page, t('import.pickTitle'))
    await picker.locator('[data-testid="picker-item"][data-name="Projects"]').dblclick()   // into the folder
    await picker.locator('[data-testid="picker-item"][data-name="package"]').click()      // select it
    await picker.getByTestId('picker-use').click()
    await expect(dialog.getByTestId('import-folder')).toHaveValue('/Users/lucas/Projects/package')
    await expect(dialog.getByTestId('import-plan-card')).toBeVisible()
    await expect(dialog.getByTestId('import-about-text')).toBeVisible()
  })

  test('no key: no description and no call; the switch says why', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-plan-card')).toBeVisible()
    await expect(dialog.getByTestId('import-about')).toHaveCount(0)
    await expect(dialog.getByTestId('import-describe-on')).toBeDisabled()
    expect(api.state.imports.described || 0).toBe(0)
  })

  test('the switch turns it off for new folders (remembered); Describe again asks on demand', async ({ page, api }) => {
    withKey(api)
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-describe-on').uncheck()
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-plan-card')).toBeVisible()
    await expect(dialog.getByTestId('import-about')).toHaveCount(0)
    expect(api.state.imports.described || 0).toBe(0)
    await page.reload()
    const d2 = await openImport(page, api)
    await expect(d2.getByTestId('import-describe-on')).not.toBeChecked()   // remembered in this browser
    await d2.getByTestId('import-folder').fill(PKG)
    await d2.getByTestId('import-plan').click()
    await expect(d2.getByTestId('import-plan-card')).toBeVisible()
    await d2.getByTestId('import-describe-on').check()
    await d2.getByTestId('import-plan').click()
    await expect(d2.getByTestId('import-about-text')).toBeVisible()
    await d2.getByTestId('import-describe-again').click()
    await expect.poll(() => api.state.imports.described).toBe(2)
  })

  test('a failed description says so and never blocks the import', async ({ page, api }) => {
    withKey(api); api.state.imports.describeFails = 'Anthropic answered 529: Overloaded'
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-about-error')).toContainText('Overloaded')
    await expect(dialog.getByTestId('import-run')).toBeEnabled()
    await dialog.getByTestId('import-run').click()
    await expect(dialog.getByTestId('import-result')).toHaveAttribute('data-ok', 'true')
  })
})

test.describe('Import Shot Pack › sync after the import', () => {
  const runImport = async (dialog) => {
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-plan-card')).toBeVisible()
    await dialog.getByTestId('import-run').click()
    await expect(dialog.getByTestId('import-result')).toHaveAttribute('data-dry', 'false')
  }

  test('says which pod it will sync to', async ({ page, api }) => {
    const dialog = await openImport(page, api)
    await expect(dialog.getByTestId('import-sync-note')).toContainText(t('import.syncNote', { name: 'ComfyUI-Dev' }))
  })

  test('no network volume: "Sync not configured", and clicking the toast opens Default Configuration', async ({ page, api }) => {
    api.state.mounts.config.network_volume_id = ''
    const dialog = await openImport(page, api)
    await runImport(dialog)
    const toast = page.getByTestId('toast').filter({ hasText: t('import.syncNotConfigured') })
    await expect(toast).toContainText(t('import.syncNoVolume'))
    await expect(toast.getByTestId('toast-action')).toHaveText(t('import.syncConfigure'))
    expect(api.state.imports.syncAfterCalls).toEqual(['pod-aaaaaaaa'])
    await toast.getByTestId('toast-action').click()
    await expect(page.locator('.modal.show', { has: page.getByTestId('config-modal') })).toBeVisible()
    await expect(page.getByTestId('import-modal')).toBeHidden()
    await expect(toast).toHaveCount(0)   // clicking it dismisses it
  })

  test('a simulated pod is imported to and not synced, with a plain toast (nothing to configure)', async ({ page, api }) => {
    api.state.mounts.config.network_volume_id = 'vol1'
    api.state.pods[0].id = 'dry-000140s1'
    const dialog = await openImport(page, api)
    await runImport(dialog)
    const toast = page.getByTestId('toast').filter({ hasText: t('import.syncSimulated', { name: 'ComfyUI-Dev' }) })
    await expect(toast).toBeVisible()
    await expect(toast.getByTestId('toast-action')).toHaveCount(0)
  })

  test('a real pod with a volume: the sync is asked for (in a plain browser it says sync runs in the app)', async ({ page, api }) => {
    api.state.mounts.config.network_volume_id = 'vol1'
    const dialog = await openImport(page, api)
    await runImport(dialog)
    await expect(page.getByTestId('toast').filter({ hasText: t('import.syncInApp') })).toBeVisible()
    expect(api.state.imports.syncAfterCalls).toEqual(['pod-aaaaaaaa'])
  })

  test('an import with conflicts syncs nothing', async ({ page, api }) => {
    api.state.mounts.config.network_volume_id = 'vol1'; api.state.imports.conflicts = 1
    const dialog = await openImport(page, api)
    await runImport(dialog)
    await expect(page.getByTestId('toast').filter({ hasText: t('import.toastProblems') })).toBeVisible()
    expect(api.state.imports.syncAfterCalls || []).toEqual([])
  })

  test('a dry run syncs nothing', async ({ page, api }) => {
    api.state.mounts.config.network_volume_id = 'vol1'
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-plan').click()
    await dialog.getByTestId('import-dry').click()
    await expect(dialog.getByTestId('import-result')).toHaveAttribute('data-dry', 'true')
    expect(api.state.imports.syncAfterCalls || []).toEqual([])
  })
})

test.describe('Import Shot Pack › Claude writes adapters only', () => {
  test('extra blocks in Claude\'s reply are dropped and the draft says so', async ({ page, api }) => {
    api.state.settings = { ...api.state.settings, anthropic_key_set: true, anthropic_key_hint: '••••WXYZ' }
    api.state.imports.draftScript = [{ valid: true, errors: [], ignored: 2 }]
    const dialog = await openImport(page, api)
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-claude').click()
    await modal(page, t('import.claudeTitle')).getByTestId('import-claude-send').click()
    await expect(dialog.getByTestId('import-draft-ignored')).toHaveText(t('import.draftIgnored', { n: 2 }))
  })
})
