import { test, expect, modal, cfgTab } from './fixtures'
import { t } from './i18n'

// Default Configuration › Import adapters (docs/ADR-008): every adapter listed with its code open to read; yours
// created, edited, duplicated and deleted. No approval step: nothing is a black box.
const openManager = async (page) => {
  await page.goto('/')
  await page.getByTestId('open-config').click()
  const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
  await cfgTab(cfg, 'adapters')
  await expect(cfg.getByTestId('adapter-manager')).toBeVisible()
  return cfg
}
const row = (cfg, id) => cfg.locator(`[data-testid="adapter-row"][data-id="${id}"]`)

test.describe('Default Configuration › Import adapters', () => {
  test('lists the built-in and your adapters with their hash; only yours can be edited or deleted', async ({ page }) => {
    const cfg = await openManager(page)
    await expect(cfg.getByTestId('adapters-count')).toHaveText(t('adapters.count', { n: 3 }))
    for (const id of ['comfy-shared', 'panama-imax-redux']) {
      await expect(row(cfg, id).getByTestId('adapter-builtin')).toHaveText(t('import.builtIn'))
      await expect(row(cfg, id).getByTestId('adapter-edit')).toHaveCount(0)
      await expect(row(cfg, id).getByTestId('adapter-delete')).toHaveCount(0)
      await expect(row(cfg, id).getByTestId('adapter-duplicate')).toBeVisible()
    }
    await expect(row(cfg, 'agent-made').getByTestId('adapter-yours')).toHaveText(t('import.yours'))
    await expect(row(cfg, 'agent-made').getByTestId('adapter-edit')).toBeVisible()
    await expect(row(cfg, 'agent-made')).toContainText('cccccccccccc…')   // the first characters of its sha256
    await expect(cfg.getByTestId('adapter-manager').getByRole('button', { name: /approve/i })).toHaveCount(0)   // there is no approval step
  })

  test('Inspect shows the code, the file it is on disk and its hash; a built-in says it is read-only', async ({ page }) => {
    const cfg = await openManager(page)
    await row(cfg, 'panama-imax-redux').getByTestId('adapter-inspect').click()
    const view = modal(page, t('adapters.inspectTitle', { id: 'panama-imax-redux' }))
    await expect(view.getByTestId('adapter-view-code')).toContainText("id: 'panama-imax-redux'")
    await expect(view.getByTestId('adapter-view-builtin')).toContainText(t('adapters.builtinNote'))
    await expect(view.getByTestId('adapter-view-sha')).toContainText('bbbbbbbb')
    await expect(view.getByTestId('adapter-view-edit')).toHaveCount(0)
    await view.getByTestId('adapter-view-close').click()
    await row(cfg, 'agent-made').getByTestId('adapter-inspect').click()
    const mine = modal(page, t('adapters.inspectTitle', { id: 'agent-made' }))
    await expect(mine.getByTestId('adapter-view-file')).toHaveText('/home/me/.config/runpod-pod-manager/adapters/agent-made.mjs')
    await mine.getByTestId('adapter-view-edit').click()   // from reading straight into editing
    await expect(modal(page, t('adapters.editTitle', { id: 'agent-made' })).getByTestId('adapter-code')).toHaveValue(/id: 'agent-made'/)
  })

  test('New adapter starts from a template that passes the structure check; Save lists it', async ({ page, api }) => {
    const cfg = await openManager(page)
    await cfg.getByTestId('adapter-new').click()
    const ed = modal(page, t('adapters.newTitle'))
    await expect(ed.getByTestId('adapter-code')).toHaveValue(/export default/)
    await expect(ed.getByTestId('adapter-structure')).toHaveAttribute('data-ok', 'true')
    await ed.getByTestId('adapter-id').fill('shots-v2')
    await ed.getByTestId('adapter-save').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('adapters.saved', { id: 'shots-v2' }) })).toBeVisible()
    await expect(row(cfg, 'shots-v2').getByTestId('adapter-yours')).toBeVisible()
    expect(api.state.imports.sources['shots-v2']).toContain("name: 'my-adapter'")   // the template's body was saved under the id typed
    await expect(cfg.getByTestId('adapters-count')).toHaveText(t('adapters.count', { n: 4 }))
  })

  test('editing checks the structure as you type and saves the new code', async ({ page, api }) => {
    const cfg = await openManager(page)
    await row(cfg, 'agent-made').getByTestId('adapter-edit').click()
    const ed = modal(page, t('adapters.editTitle', { id: 'agent-made' }))
    await expect(ed.getByTestId('adapter-id')).toHaveAttribute('readonly', '')
    await ed.getByTestId('adapter-code').fill("export default { id: 'agent-made', name: 'Agent made' }")
    await expect(ed.getByTestId('adapter-structure')).toHaveAttribute('data-ok', 'false')
    await expect(ed.getByTestId('adapter-problem')).toHaveCount(2)
    await expect(ed.getByTestId('adapter-problem').first()).toContainText('detect')
    const fixed = "export default { id: 'agent-made', name: 'Edited', async detect() { return { match: 0 } }, async plan() { return { ops: [] } } }"
    await ed.getByTestId('adapter-code').fill(fixed)
    await expect(ed.getByTestId('adapter-structure')).toHaveAttribute('data-ok', 'true')
    await ed.getByTestId('adapter-save').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('adapters.saved', { id: 'agent-made' }) })).toBeVisible()
    expect(api.state.imports.sources['agent-made']).toBe(fixed)
    await row(cfg, 'agent-made').getByTestId('adapter-inspect').click()
    await expect(modal(page, t('adapters.inspectTitle', { id: 'agent-made' })).getByTestId('adapter-view-code')).toHaveText(fixed)
  })

  test('a save the app refuses stays open and says why', async ({ page }) => {
    const cfg = await openManager(page)
    await row(cfg, 'agent-made').getByTestId('adapter-edit').click()
    const ed = modal(page, t('adapters.editTitle', { id: 'agent-made' }))
    await ed.getByTestId('adapter-code').fill('const nothing = 1')
    await ed.getByTestId('adapter-save').click()
    await expect(ed.getByTestId('adapter-save-error')).toContainText('does not parse')
    await expect(ed).toBeVisible()
  })

  test('Duplicate copies a built-in under a new id into the editor; saving makes it yours', async ({ page, api }) => {
    const cfg = await openManager(page)
    await row(cfg, 'panama-imax-redux').getByTestId('adapter-duplicate').click()
    const ed = modal(page, t('adapters.duplicateTitle', { id: 'panama-imax-redux' }))
    await expect(ed.getByTestId('adapter-id')).toHaveValue('panama-imax-redux-copy')
    await expect(ed.getByTestId('adapter-code')).toHaveValue(/id: 'panama-imax-redux-copy'/)
    await ed.getByTestId('adapter-id').fill('panama-mine')
    await ed.getByTestId('adapter-save').click()
    await expect(row(cfg, 'panama-mine').getByTestId('adapter-yours')).toBeVisible()
    expect(Object.keys(api.state.imports.sources)).toContain('panama-mine')
  })

  test('Delete asks, removes yours, and never offers it for a built-in', async ({ page, api }) => {
    const cfg = await openManager(page)
    let asked = ''
    page.once('dialog', (d) => { asked = d.message(); d.dismiss() })
    await row(cfg, 'agent-made').getByTestId('adapter-delete').click()
    await expect.poll(() => asked).toBe(t('adapters.confirmDelete', { id: 'agent-made' }))
    await expect(row(cfg, 'agent-made')).toBeVisible()   // dismissed: still there
    page.once('dialog', (d) => d.accept())
    await row(cfg, 'agent-made').getByTestId('adapter-delete').click()
    await expect(row(cfg, 'agent-made')).toHaveCount(0)
    await expect(page.getByTestId('toast').filter({ hasText: t('adapters.deleted', { id: 'agent-made' }) })).toBeVisible()
    expect(api.state.imports.sources['agent-made']).toBeUndefined()
    await expect(cfg.getByTestId('adapters-none')).toBeVisible()
  })
})
