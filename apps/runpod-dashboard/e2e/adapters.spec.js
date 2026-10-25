import { test, expect, modal, cfgTab } from './fixtures'
import { t } from './i18n'

// Default Configuration > Import adapters (docs/ADR-008, ADR-009): every adapter listed with its code hash; Edit opens the Adapter Studio (the same
// modal as New adapter and Write an adapter with Claude), built-ins included. No approval step: nothing is a black box.
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
  test('lists the built-in and your adapters with their hash; every one can be edited, only yours deleted', async ({ page }) => {
    const cfg = await openManager(page)
    await expect(cfg.getByTestId('adapters-count')).toHaveText(t('adapters.count', { n: 3 }))
    for (const id of ['comfy-shared', 'panama-imax-redux']) {
      await expect(row(cfg, id).getByTestId('adapter-builtin')).toHaveText(t('import.builtIn'))
      await expect(row(cfg, id).getByTestId('adapter-edit')).toHaveText(t('adapters.edit'))   // called Edit, built-ins included
      await expect(row(cfg, id).getByTestId('adapter-delete')).toHaveCount(0)
      await expect(row(cfg, id).getByTestId('adapter-reset')).toHaveCount(0)   // nothing to reset until it is modified
      await expect(row(cfg, id).getByTestId('adapter-duplicate')).toBeVisible()
    }
    await expect(row(cfg, 'agent-made').getByTestId('adapter-yours')).toHaveText(t('import.yours'))
    await expect(row(cfg, 'agent-made').getByTestId('adapter-delete')).toBeVisible()
    await expect(row(cfg, 'agent-made')).toContainText('cccccccccccc…')   // the first characters of its sha256
    await expect(cfg.getByTestId('adapter-manager').getByRole('button', { name: /approve|inspect/i })).toHaveCount(0)   // no approval step, no Inspect
  })

  test('there is no Inspect: Edit opens the Studio with the adapter\'s code, its file and its hash', async ({ page }) => {
    const cfg = await openManager(page)
    await row(cfg, 'agent-made').getByTestId('adapter-edit').click()
    const studio = page.getByTestId('studio')
    await expect(studio).toBeVisible()
    await expect(studio.getByTestId('studio-code-content')).toContainText("id: 'agent-made'")
    await expect(studio.getByTestId('studio-path')).toHaveText('/home/me/.config/runpod-pod-manager/adapters/agent-made.mjs')
    await expect(studio.getByTestId('studio-sha')).toHaveText('cccccccccc')
  })

  test('New adapter opens the Studio on a new adapter', async ({ page }) => {
    const cfg = await openManager(page)
    await cfg.getByTestId('adapter-new').click()
    await expect(page.getByTestId('studio').getByTestId('studio-adapter-new')).toBeVisible()
  })

  test('Duplicate opens the Studio on a copy under a new id, which becomes yours when saved', async ({ page, api }) => {
    const cfg = await openManager(page)
    await row(cfg, 'panama-imax-redux').getByTestId('adapter-duplicate').click()
    const studio = page.getByTestId('studio')
    await expect(studio.getByTestId('studio-id')).toHaveValue('panama-imax-redux-copy')
    await expect(studio.getByTestId('studio-code-content')).toContainText("id: 'panama-imax-redux-copy'")
    await studio.getByTestId('studio-id').fill('panama-mine')
    await studio.getByTestId('studio-save').click()
    await expect(studio.locator('[data-testid="studio-adapter"][data-id="panama-mine"]')).toBeVisible()
    expect(Object.keys(api.state.imports.sources)).toContain('panama-mine')
    await studio.getByTestId('studio-close').click()
    await expect(row(cfg, 'panama-mine').getByTestId('adapter-yours')).toBeVisible()
  })

  test('a modified built-in says so and offers Reset', async ({ page, api }) => {
    api.state.imports.adapters.find((a) => a.id === 'comfy-shared').modified = true
    const cfg = await openManager(page)
    await expect(row(cfg, 'comfy-shared').getByTestId('adapter-builtin')).toHaveText(t('studio.builtinModified'))
    api.state.imports.originals = { 'comfy-shared': api.state.imports.sources['comfy-shared'] }
    page.once('dialog', (d) => d.accept())
    await row(cfg, 'comfy-shared').getByTestId('adapter-reset').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('studio.wasReset', { id: 'comfy-shared' }) })).toBeVisible()
    await expect(row(cfg, 'comfy-shared').getByTestId('adapter-builtin')).toHaveText(t('import.builtIn'))
  })

  test('Delete asks, removes yours, and is never offered for a built-in', async ({ page, api }) => {
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
