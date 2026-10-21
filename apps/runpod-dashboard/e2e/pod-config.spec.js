import { test, expect, openCreatePod, podCard, modal } from './fixtures'
import { t } from './i18n'

// Each pod can carry its own configuration: the Default Configuration's panel, started from the
// default, sent with the create request, kept for Recreate, shown and changed from the card.
test.describe('a pod with its own configuration', () => {
  test('the navbar panel is the Default Configuration', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('open-config').click()
    await expect(modal(page, t('config.title'))).toBeVisible()
    await expect(modal(page, t('config.title')).getByTestId('config-modal')).toBeVisible()
    await expect(modal(page, t('config.title')).getByTestId('section-runpod')).toBeVisible()
  })

  test('the form overrides it for the new pod and sends it with the request', async ({ page, api }) => {
    await page.goto('/')
    await openCreatePod(page)
    await page.getByLabel('Name').fill('Own-Config')
    await expect(page.getByTestId('pod-config-custom')).toBeHidden()
    await page.getByTestId('pod-config-override').click()

    const panel = modal(page, t('config.podTitle', { name: 'Own-Config' }))
    await expect(panel.getByTestId('config-modal-pod')).toBeVisible()
    await expect(panel.getByTestId('section-runpod')).toBeHidden()         // the key is app-wide
    await expect(panel.getByTestId('cfg-dry-run')).toBeHidden()            // so is no-spend mode
    await expect(panel.getByTestId('cfg-image')).toHaveValue('ghcr.io/example/comfy-app:v26')   // started from the default
    await panel.getByTestId('cfg-image').fill('ghcr.io/example/comfy-app:experiment')
    await panel.getByTestId('cfg-volume').selectOption('vol2')
    await panel.getByTestId('cfg-idle').fill('5')
    await panel.getByTestId('config-apply').click()
    await expect(panel).toBeHidden()
    await expect(page.getByTestId('pod-config-custom')).toBeVisible()
    await expect(page.getByTestId('pod-image-group')).toContainText('ghcr.io/example/comfy-app:experiment')

    await page.getByTestId('pod-submit').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('toast.podCreated', { name: 'Own-Config' }) })).toBeVisible()
    const post = api.calls.find((c) => c.method === 'POST' && c.path === '/pods')
    expect(post.body.config).toMatchObject({ image: 'ghcr.io/example/comfy-app:experiment', network_volume_id: 'vol2', idle_stop_minutes: 5 })
    await expect(podCard(page, 'Own-Config').getByTestId('pod-config-badge')).toBeVisible()
    // the default is untouched
    expect(api.calls.some((c) => c.method === 'PUT' && c.path === '/mounts')).toBe(false)
  })

  test('use defaults drops the override before creating', async ({ page, api }) => {
    await page.goto('/')
    await openCreatePod(page)
    await page.getByLabel('Name').fill('Plain')
    await page.getByTestId('pod-config-override').click()
    const panel = modal(page, t('config.podTitle', { name: 'Plain' }))
    await panel.getByTestId('cfg-idle').fill('7')
    await panel.getByTestId('config-apply').click()
    await expect(page.getByTestId('pod-config-custom')).toBeVisible()
    await page.getByTestId('pod-config-reset').click()
    await expect(page.getByTestId('pod-config-custom')).toBeHidden()
    await page.getByTestId('pod-submit').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('toast.podCreated', { name: 'Plain' }) })).toBeVisible()
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '/pods').body.config).toBeNull()
  })

  test('the card shows, changes and clears a pod\'s own configuration', async ({ page, api }) => {
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    await expect(card.getByTestId('pod-config-badge')).toBeHidden()
    await card.getByTestId('pod-config').click()
    const panel = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' }))
    await expect(panel.getByTestId('config-modal-pod')).toBeVisible()
    await panel.getByTestId('cfg-image').fill('ghcr.io/example/comfy-app:next')
    await panel.getByTestId('config-apply').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('toast.podConfigSet') })).toBeVisible()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/config'))
    expect(put.path).toMatch(/\/pods\/.+\/config$/); expect(put.body.image).toBe('ghcr.io/example/comfy-app:next')
    await expect(card.getByTestId('pod-config-badge')).toBeVisible()

    await card.getByTestId('pod-config').click()
    await expect(panel.getByTestId('cfg-image')).toHaveValue('ghcr.io/example/comfy-app:next')   // read back from the registry
    await panel.getByTestId('config-use-defaults').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('toast.podConfigDefault') })).toBeVisible()
    await expect(card.getByTestId('pod-config-badge')).toBeHidden()
  })
})
