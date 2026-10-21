import { test, expect, sampleRepository, modal } from './fixtures'

const openRepositories = async (page) => {
  await page.getByTestId('open-connect').click()
  await modal(page, 'Connect').getByRole('tab', { name: 'Repositories' }).click()
  const dialog = modal(page, 'Repositories attached here')
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('repositories', () => {
  test('attaches a repository by URL, with branch suggestions from the real branch list', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openRepositories(page)
    await expect(dialog).toContainText('No repositories attached yet')

    await dialog.getByLabel('Repository').fill('https://github.com/me/comfy-nodes')
    await expect(dialog.locator('#branch-suggestions option')).toHaveCount(2)
    await expect(dialog.getByLabel('Branch')).toHaveAttribute('placeholder', 'main')
    expect(api.calls).toContainEqual(expect.objectContaining({
      path: '/repos/branches', query: { url: 'https://github.com/me/comfy-nodes' },
    }))

    await dialog.getByRole('button', { name: 'Attach', exact: true }).click()
    await expect(dialog.locator('.list-group-item', { hasText: 'me/comfy-nodes' })).toContainText('main')
    expect(api.calls).toContainEqual(expect.objectContaining({
      method: 'POST', path: '/repositories', body: { url: 'https://github.com/me/comfy-nodes', branch: 'main' },
    }))
    await expect(dialog.getByLabel('Repository')).toHaveValue('')
  })

  test('a typed branch is sent as-is', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openRepositories(page)
    await dialog.getByLabel('Repository').fill('https://gitlab.com/team/nodes')
    await dialog.getByLabel('Branch').fill('release/1.0')
    await dialog.getByRole('button', { name: 'Attach', exact: true }).click()
    await expect(dialog.locator('.list-group-item', { hasText: 'team/nodes' })).toContainText('release/1.0')
    expect(api.calls).toContainEqual(expect.objectContaining({
      method: 'POST', path: '/repositories', body: { url: 'https://gitlab.com/team/nodes', branch: 'release/1.0' },
    }))
  })

  test('suggests repositories from connected accounts', async ({ page, api }) => {
    api.state.accounts = [{ id: 'a1', provider: 'github', host: 'github.com', username: 'lucas' }]
    api.state.accountRepos = [
      { name: 'lucas/comfy-nodes', url: 'https://github.com/lucas/comfy-nodes', default_branch: 'main', private: true, account: 'lucas' },
      { name: 'lucas/dotfiles', url: 'https://github.com/lucas/dotfiles', default_branch: 'main', private: false, account: 'lucas' },
    ]
    await page.goto('/')
    const dialog = await openRepositories(page)
    await expect(dialog).not.toContainText('Connect a GitHub or GitLab account')

    await dialog.getByLabel('Repository').fill('comfy')
    await expect(dialog.locator('#repo-suggestions option')).toHaveCount(1)
    await expect(dialog.locator('#repo-suggestions option')).toHaveAttribute('value', 'https://github.com/lucas/comfy-nodes')
    expect(api.calls).toContainEqual(expect.objectContaining({ path: '/repos/search', query: { q: 'comfy' } }))
  })

  test('without accounts, links to the Accounts modal', async ({ page }) => {
    await page.goto('/')
    const dialog = await openRepositories(page)
    await dialog.getByRole('link', { name: 'Accounts' }).click()
    await expect(modal(page, 'Connect GitHub or GitLab')).toBeVisible()
  })

  test('removes an attached repository after confirming', async ({ page, api }) => {
    api.state.repositories = [sampleRepository()]
    page.on('dialog', (d) => d.accept())
    await page.goto('/')
    const dialog = await openRepositories(page)
    await expect(dialog).toContainText('me/comfy-nodes')
    await dialog.getByRole('button', { name: 'Remove' }).click()
    await expect(dialog).toContainText('No repositories attached yet')
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/repositories/r1' }))
  })

  test('shows the API error when attaching fails', async ({ page, api }) => {
    api.state.failures['POST /repositories'] = 'Not a git repository URL'
    await page.goto('/')
    const dialog = await openRepositories(page)
    await dialog.getByLabel('Repository').fill('nonsense')
    await dialog.getByRole('button', { name: 'Attach', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Not a git repository URL')
  })
})
