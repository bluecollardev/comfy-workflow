import { test, expect, openCreatePod, sampleRepository, modal } from './fixtures'

const textarea = (page) => page.locator('#adv-customNodes textarea')

test.describe('custom nodes', () => {
  test('help popover explains monorepo entries', async ({ page }) => {
    await page.goto('/')
    await openCreatePod(page)
    await page.getByRole('button', { name: 'Help' }).click()
    await expect(page.getByText('Monorepo or one repo per pack')).toBeVisible()
    await expect(page.getByText('→ custom_nodes/pack_a')).toBeVisible()
  })

  test('attach node picks folders from an attached repository', async ({ page, api }) => {
    api.state.repositories = [sampleRepository()]
    await page.goto('/')
    await openCreatePod(page)
    await page.getByRole('button', { name: 'Attach node' }).click()

    const dialog = modal(page, 'Attach node')
    await expect(dialog.getByLabel('Repository')).toHaveValue('r1')
    await expect(dialog.getByLabel('Branch')).toHaveValue('main')
    await expect(dialog.getByRole('checkbox', { name: 'pack_a' })).toBeVisible()
    await expect(dialog).toContainText('0 selected · 4 folders')
    expect(api.calls).toContainEqual(expect.objectContaining({
      path: '/repos/folders', query: { url: 'https://github.com/me/comfy-nodes', branch: 'main' },
    }))
    expect(api.calls).toContainEqual(expect.objectContaining({ path: '/repos/branches' }))

    await dialog.getByPlaceholder('Filter folders').fill('pack')
    await expect(dialog.getByRole('checkbox', { name: 'shared' })).toBeHidden()
    await dialog.getByRole('button', { name: 'Select shown' }).click()
    await expect(dialog).toContainText('3 selected · 4 folders')
    await dialog.getByRole('checkbox', { name: 'pack_c' }).uncheck()
    await dialog.getByRole('button', { name: 'Add selected' }).click()

    await expect(dialog).toBeHidden()
    await expect(textarea(page)).toHaveValue(
      'https://github.com/me/comfy-nodes#pack_a\nhttps://github.com/me/comfy-nodes#pack_b',
    )
  })

  test('non-main branch uses tree syntax, re-adding dedupes, whole repo adds the bare entry', async ({ page, api }) => {
    api.state.repositories = [{ ...sampleRepository(), branch: 'dev' }]
    await page.goto('/')
    await openCreatePod(page)

    await page.getByRole('button', { name: 'Attach node' }).click()
    let dialog = modal(page, 'Attach node')
    await dialog.getByRole('checkbox', { name: 'pack_a' }).check()
    await dialog.getByRole('button', { name: 'Add selected' }).click()
    await expect(textarea(page)).toHaveValue('https://github.com/me/comfy-nodes/tree/dev/pack_a')

    await page.getByRole('button', { name: 'Attach node' }).click()
    dialog = modal(page, 'Attach node')
    await dialog.getByRole('checkbox', { name: 'pack_a' }).check()
    await dialog.getByRole('button', { name: 'Add selected' }).click()
    await expect(textarea(page)).toHaveValue('https://github.com/me/comfy-nodes/tree/dev/pack_a')

    await page.getByRole('button', { name: 'Attach node' }).click()
    dialog = modal(page, 'Attach node')
    await dialog.getByRole('link', { name: /whole repository/ }).click()
    await expect(dialog).toBeHidden()
    await expect(textarea(page)).toHaveValue(
      'https://github.com/me/comfy-nodes/tree/dev/pack_a\nhttps://github.com/me/comfy-nodes/tree/dev',
    )
  })

  test('changing the branch reloads the folders', async ({ page, api }) => {
    api.state.repositories = [sampleRepository()]
    await page.goto('/')
    await openCreatePod(page)
    await page.getByRole('button', { name: 'Attach node' }).click()
    const dialog = modal(page, 'Attach node')
    await expect(dialog.getByRole('checkbox', { name: 'pack_a' })).toBeVisible()

    api.state.folders = ['experimental']
    await dialog.getByLabel('Branch').fill('dev')
    await dialog.getByLabel('Branch').press('Enter')
    await expect(dialog.getByRole('checkbox', { name: 'experimental' })).toBeVisible()
    expect(api.calls).toContainEqual(expect.objectContaining({
      path: '/repos/folders', query: { url: 'https://github.com/me/comfy-nodes', branch: 'dev' },
    }))
  })

  test('with nothing attached it points to the Repositories modal', async ({ page }) => {
    await page.goto('/')
    await openCreatePod(page)
    await page.getByRole('button', { name: 'Attach node' }).click()
    const dialog = modal(page, 'Attach node')
    await expect(dialog).toContainText('No repositories attached yet')
    await expect(dialog.getByRole('button', { name: 'Add selected' })).toBeDisabled()
    await dialog.getByRole('link', { name: 'Manage repositories' }).click()
    await expect(modal(page, 'Repositories attached here')).toBeVisible()
  })

  test('surfaces git errors from the folder lookup', async ({ page, api }) => {
    api.state.repositories = [sampleRepository()]
    api.state.failures['GET /repos/folders'] = "fatal: Remote branch main not found"
    await page.goto('/')
    await openCreatePod(page)
    await page.getByRole('button', { name: 'Attach node' }).click()
    await expect(modal(page, 'Attach node').getByRole('alert')).toContainText('Remote branch main not found')
  })
})
