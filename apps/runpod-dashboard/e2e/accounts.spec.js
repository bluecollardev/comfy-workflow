import { test, expect, modal } from './fixtures'

const openAccounts = async (page) => {
  await page.getByRole('button', { name: 'Accounts' }).click()
  const dialog = modal(page, 'Connect GitHub or GitLab')
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('accounts', () => {
  test('providers are disabled until the API server is configured', async ({ page }) => {
    await page.goto('/')
    const dialog = await openAccounts(page)
    await expect(dialog).toContainText('No accounts connected')
    await expect(dialog.getByRole('button', { name: 'Connect GitHub' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Connect GitLab' })).toBeDisabled()
    await expect(dialog).toContainText('register an OAuth app')
  })

  test('a configured provider links to the OAuth start route', async ({ page, api }) => {
    api.state.providers[0].configured = true
    await page.goto('/')
    const dialog = await openAccounts(page)
    // bootstrap-vue-next renders an href button as <a role="button">, so match by text rather than role=link
    await expect(dialog.locator('a, button', { hasText: 'Connect GitHub' }))
      .toHaveAttribute('href', 'http://localhost:8000/api/auth/github/start')
    await expect(dialog.getByRole('button', { name: 'Connect GitLab' })).toBeDisabled()
  })

  test('lists connected accounts and disconnects after confirming', async ({ page, api }) => {
    api.state.accounts = [
      { id: 'a1', provider: 'github', host: 'github.com', username: 'lucas', name: 'Lucas', avatar_url: '' },
      { id: 'a2', provider: 'gitlab', host: 'gitlab.com', username: 'lucas.g' },
    ]
    page.on('dialog', (d) => d.accept())
    await page.goto('/')
    const dialog = await openAccounts(page)
    const github = dialog.locator('.list-group-item', { hasText: 'lucas' }).first()
    await expect(github).toContainText('github.com')
    await expect(github).toContainText('Lucas')

    await github.getByRole('button', { name: 'Disconnect' }).click()
    await expect(dialog.locator('.list-group-item')).toHaveCount(1)
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/git-accounts/a1' }))
  })

  test('OAuth success redirect shows a notice, opens Accounts and cleans the URL', async ({ page }) => {
    await page.goto('/?provider=github&connected=lucas')
    await expect(page.locator('.toast-container .toast').first()).toContainText('Connected GitHub account lucas')
    await expect(modal(page, 'Connect GitHub or GitLab')).toBeVisible()
    await expect(page).toHaveURL('http://localhost:5173/')
  })

  test('OAuth failure redirect shows the provider error', async ({ page }) => {
    await page.goto('/?provider=gitlab&error=access_denied')
    await expect(page.locator('.toast-container .toast').first()).toContainText('GitLab connection failed: access_denied')
    await expect(page.locator('.modal.show')).toHaveCount(0)
  })
})
