import { test, expect, podCard } from './fixtures'
import { t } from './i18n'

test.describe('dashboard', () => {
  test('shows stats and a card per pod', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('.stat-card', { hasText: 'Total pods' })).toContainText('3')
    await expect(page.locator('.stat-card', { hasText: 'Running' })).toContainText('1')
    await expect(page.locator('.stat-card', { hasText: 'Stopped' })).toContainText('1')
    await expect(page.locator('.card-header', { hasText: 'Pods' }).locator('.badge')).toHaveText('3')

    const dev = podCard(page, 'ComfyUI-Dev')
    await expect(dev.getByTestId('pod-status')).toHaveText(t('pod.statuses.running'))
    await expect(dev).toContainText('RTX 4090')
    await expect(dev).toContainText('24 GB')
    await expect(dev).toContainText('2h 2m')
    await expect(dev.getByRole('link', { name: /Open/ })).toHaveAttribute('href', 'https://pod-a.proxy.runpod.io:8188')
    await expect(dev).toContainText('ssh root@pod-a.proxy.runpod.io')
    await expect(dev.getByRole('button', { name: 'Stop' })).toBeVisible()

    await expect(podCard(page, 'ComfyUI-Batch').getByRole('button', { name: 'Resume' })).toBeVisible()
    await expect(podCard(page, 'ComfyUI-Test').getByTestId('pod-status')).toHaveText(t('pod.statuses.starting'))
  })

  test('stop, resume and delete hit the API and refresh the list', async ({ page, api }) => {
    page.on('dialog', (d) => d.accept())
    await page.goto('/')
    const dev = podCard(page, 'ComfyUI-Dev')

    await dev.getByRole('button', { name: 'Stop' }).click()
    await expect(dev.getByRole('button', { name: 'Resume' })).toBeVisible()
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/pods/pod-aaaaaaaa/stop' }))

    await dev.getByRole('button', { name: 'Resume' }).click()
    await expect(dev.getByRole('button', { name: 'Stop' })).toBeVisible()
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/pods/pod-aaaaaaaa/resume' }))

    await podCard(page, 'ComfyUI-Test').getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.card.h-100')).toHaveCount(2)
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/pods/pod-cccccccc' }))
  })

  test('delete does nothing when the confirm is dismissed', async ({ page, api }) => {
    page.on('dialog', (d) => d.dismiss())
    await page.goto('/')
    await podCard(page, 'ComfyUI-Test').getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.card.h-100')).toHaveCount(3)
    expect(api.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
  })

  test('shows the API error when an action fails', async ({ page, api }) => {
    api.state.failures['POST /pods/pod-aaaaaaaa/stop'] = 'RunPod says no'
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByRole('button', { name: 'Stop' }).click()
    await expect(page.getByRole('alert')).toContainText('Stop pod failed: RunPod says no')
    await expect(page.locator('.toast-container .toast').first()).toContainText('Stop pod failed: RunPod says no')
  })

  test('empty account shows zeros and the empty state', async ({ page, api }) => {
    api.state.pods = []
    await page.goto('/')
    await expect(page.locator('.stat-card', { hasText: 'Total pods' })).toContainText('0')
    await expect(page.getByText('No pods')).toBeVisible()
  })

  test('dashboard load failure is reported', async ({ page, api }) => {
    api.state.failures['GET /dashboard'] = 'RUNPOD_API_KEY not set'
    await page.goto('/')
    await expect(page.getByRole('alert')).toContainText('RUNPOD_API_KEY not set')
  })

  test('refresh button re-fetches the dashboard', async ({ page, api }) => {
    await page.goto('/')
    await expect(page.locator('.card.h-100')).toHaveCount(3)
    const before = api.calls.filter((c) => c.path === '/dashboard').length
    api.state.pods.pop()
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.locator('.card.h-100')).toHaveCount(2)
    expect(api.calls.filter((c) => c.path === '/dashboard').length).toBe(before + 1)
  })

  test('pause all stops every running pod and says so', async ({ page, api }) => {
    await page.goto('/')
    await page.getByTestId('pause-all').click()
    await expect(page.getByTestId('toast').first()).toContainText('2 pod(s) stopped')
    expect(api.calls.filter((c) => /\/pods\/[^/]+\/stop$/.test(c.path)).map((c) => c.path).sort()).toEqual(['/pods/pod-aaaaaaaa/stop', '/pods/pod-cccccccc/stop'])
    await expect(page.getByTestId('pause-all')).toBeDisabled()
  })
})

test.describe('Pod list grouped by datacenter', () => {
  test('a toggle groups the pods under their datacenter (off: the plain list); groups in name order, each with a count', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('pod-group')).toHaveCount(0)   // the plain list until the toggle is on
    await expect(page.locator('[data-testid="pod-card"]')).toHaveCount(3)
    await page.getByTestId('pods-group-toggle').check({ force: true })
    const groups = page.getByTestId('pod-group')
    await expect(groups).toHaveCount(2)
    await expect(groups.nth(0)).toHaveAttribute('data-dc', 'CA-MTL-1')
    await expect(groups.nth(1)).toHaveAttribute('data-dc', 'EU-RO-1')
    await expect(groups.nth(1).getByTestId('pod-group-title')).toContainText('2')
    await expect(groups.nth(1).locator('[data-testid="pod-card"]')).toHaveCount(2)
    await expect(groups.nth(0).locator('[data-testid="pod-card"]')).toHaveCount(1)
  })

  test('a Credits Remaining card shows the account balance and how long it lasts; it warns as it runs low and is left out when RunPod does not say', async ({ page, api }) => {
    await page.goto('/')
    const card = page.getByTestId('stat-credits')
    await expect(card).toContainText(t('stats.credits')); await expect(card.getByTestId('stat-value')).toHaveText('$36.42')
    await expect(card.getByTestId('stat-sub')).toContainText('about 29 days left'); await expect(card.getByTestId('stat-sub')).toContainText('$0.05/h')
    await expect(card.locator('.stat-card')).toHaveCSS('border-left-color', /./)
    api.state.credits = { balance: 12.5, spend_per_hr: 1.18, spend_limit: 80, hours_left: 10.6, level: 'low' }
    await page.reload()
    await expect(page.getByTestId('stat-credits').getByTestId('stat-sub')).toContainText('about 11 h left')
    api.state.credits = { balance: 3.1, spend_per_hr: 1.18, spend_limit: 80, hours_left: 2.6, level: 'critical' }
    await page.reload()
    await expect(page.getByTestId('stat-credits').getByTestId('stat-value')).toHaveText('$3.10')
    api.state.credits = null
    await page.reload()
    await expect(page.getByTestId('stat-credits')).toHaveCount(0)
    await expect(page.getByTestId('stat-total')).toBeVisible()
  })
})
