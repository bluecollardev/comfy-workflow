import { test, expect, openCreatePod, podCard, modal, cfgTab } from './fixtures'
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

test.describe('a pod\'s own Configuration › environment', () => {
  test('loads the env and the build args from the Dockerfile, as the Create Pod form does', async ({ page, api }) => {
    api.state.imageEnv = [{ key: 'COMFYUI_PORT', value: '8188' }]
    api.state.imageBuildArgs = [{ key: 'TORCH_VERSION', value: '2.6.0' }]
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click()
    const panel = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' }))
    await expect(panel.getByTestId('config-modal-pod')).toBeVisible()
    const tab = panel.getByTestId('cfg-tab-environment')
    if (await tab.count()) await tab.click()
    await panel.getByTestId('cfg-env-load-menu').click()
    await panel.getByTestId('cfg-env-load-dockerfile').click()
    await expect(panel.getByTestId('cfg-env-key')).toHaveCount(2)
    await expect(panel.getByTestId('cfg-env-arg')).toHaveCount(1)
    await expect(panel.getByTestId('cfg-env-summary')).toContainText('1 env and 1 build args')
    await panel.getByTestId('config-apply').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('toast.podConfigSet') })).toBeVisible()
    const put = api.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/config')).at(-1)
    expect(put.body.env).toEqual({ COMFYUI_PORT: '8188', TORCH_VERSION: '2.6.0' })
  })
})

test.describe('a pod\'s own Configuration › folders on this PC', () => {
  test('starts from the default\'s choice of ComfyUI-Shared folders to sync and keeps its own', async ({ page, api }) => {
    api.state.mounts.config.sync_shared = ['input', 'workflows']
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click()
    const panel = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' }))
    await cfgTab(panel, 'folders')
    await expect(panel.getByTestId('cfg-sync-shared')).toContainText(t('config.syncSharedPodHint'))   // says it is for this pod only
    await expect(panel.getByTestId('cfg-sync-shared-input')).toBeChecked()
    await expect(panel.getByTestId('cfg-sync-shared-models')).not.toBeChecked()
    await panel.getByTestId('cfg-sync-shared-models').check()
    await panel.getByTestId('cfg-sync-shared-input').uncheck()
    await panel.getByTestId('config-apply').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('toast.podConfigSet') })).toBeVisible()
    const put = api.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/config')).at(-1)
    expect(put.body.sync_shared).toEqual(['models', 'workflows'])
    expect(api.state.mounts.config.sync_shared).toEqual(['input', 'workflows'])   // the default is not changed
  })
})

test.describe('a named pod\'s configuration', () => {
  test('never says Default Pod Configuration, and the pod\'s title is edited above the tabs', async ({ page }) => {
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click()
    const panel = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' }))
    await expect(panel.getByTestId('section-volume')).toHaveText(t('config.volumePod'))
    await expect(panel).not.toContainText('Default Pod Configuration')
    await expect(panel.locator('[data-testid="cfg-tab-volume"]')).toHaveText(t('config.volumePod'))
    await panel.getByTestId('cfg-pod-name').fill('cgi-042 plates')
    await panel.getByTestId('cfg-pod-name-save').click()
    await expect(podCard(page, 'cgi-042 plates')).toBeVisible()
  })
})
