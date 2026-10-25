import { test, expect, openCreatePod, podCard, modal, cfgTab } from './fixtures'
import { t } from './i18n'

// The Configuration panel (gear icon): the RunPod key, the pod volume, the three folders mapped on
// this PC with the folder picker, the required switches in dev mode, custom folders, the image and
// idle defaults, no-spend mode, and what saving does. Plus the features that read it: the pod form
// and the cards. Elements are found by test id; text is asserted through the language file.

const configModal = (page) => page.locator('.modal.show', { has: page.getByTestId('config-modal') })
const openConfig = async (page) => {
  await page.getByTestId('open-config').click()
  const dialog = configModal(page)
  await expect(dialog).toBeVisible()
  return dialog
}
const folderRow = (dialog, key) => dialog.getByTestId(`folder-row-${key}`)
const toast = (page) => page.getByTestId('toast')

test.describe('configuration', () => {
  test('shows RunPod, the pod volume, then the three folders with their pod paths and variables', async ({ page }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
    await expect(dialog.getByTestId('section-runpod')).toContainText(t('config.runpod'))
    await expect(dialog.getByTestId('section-volume')).toContainText(t('config.volume'))
    await expect(dialog.getByTestId('section-folders')).toContainText(t('config.folders'))
    await expect(dialog.getByTestId('cfg-volume')).toHaveValue('')
    await expect(dialog.getByTestId('cfg-mount')).toHaveValue('/workspace')
    await expect(dialog.getByTestId('cfg-image')).toHaveValue('ghcr.io/example/comfy-app:v26')
    await expect(dialog.getByTestId('cfg-idle')).toHaveValue('30')
    for (const [key, container, env] of [['project', '/workspace/project', 'PROJECT_ROOT'], ['plates', '/workspace/plates', 'PLATES_ROOT'], ['comfy-shared', '/workspace/comfy-shared', 'COMFY_SHARED']]) {
      const row = folderRow(dialog, key)
      await expect(row).toContainText(t(`config.folder.${key}`))
      await expect(row.getByTestId('folder-container')).toContainText(container)
      await expect(row.getByTestId('folder-env')).toHaveText(env)
      await expect(row.getByTestId('folder-local')).toHaveValue('')
    }
    await expect(dialog.getByTestId('config-mode')).toHaveText('dev')
  })

  test('in dev mode every folder is optional until its switch is on', async ({ page }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
    await cfgTab(dialog, 'folders')
    const row = folderRow(dialog, 'plates')
    await expect(row.getByTestId('folder-required-text')).toHaveText(t('config.optional'))
    await row.getByTestId('folder-required').check()   // the switch's input carries the test id
    await expect(row.getByTestId('folder-required-text')).toHaveText(t('config.required'))
  })

  test('the folder picker browses this PC and fills the row', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
    await cfgTab(dialog, 'folders')
    await folderRow(dialog, 'project').getByTestId('folder-browse').click()
    const picker = page.locator('.modal.show', { has: page.getByTestId('folder-picker') })
    await expect(picker).toBeVisible()
    await expect(picker).toContainText(t('picker.title', { name: t('config.folder.project').toLowerCase() }))
    const items = picker.getByTestId('picker-item')
    await expect(items).toHaveText(['ComfyUI-Shared', 'Projects'])
    await items.filter({ hasText: 'Projects' }).dblclick()
    await expect(items).toHaveText(['CANALV2', 'plates'])
    await items.filter({ hasText: 'CANALV2' }).click()
    await picker.getByTestId('picker-use').click()
    await expect(picker).toBeHidden()
    await expect(folderRow(dialog, 'project').getByTestId('folder-local')).toHaveValue('/Users/lucas/Projects/CANALV2')
    expect(api.calls.filter((c) => c.path === '/fs/dirs').map((c) => c.query.path ?? '')).toEqual(['', '/Users/lucas/Projects'])
  })

  test('saving sends the mapping, shows a toast, closes, and the pod form reflects it', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
    await cfgTab(dialog, 'folders')
    await folderRow(dialog, 'project').getByTestId('folder-local').fill('/Users/lucas/Projects/CANALV2')
    await cfgTab(dialog, 'volume')
    await dialog.getByTestId('cfg-volume').selectOption('vol2')   // a volume of the account; picking it sets its datacenter
    await expect(dialog.getByTestId('cfg-dc')).toHaveValue('CA-MTL-1')
    await cfgTab(dialog, 'volume')   // the idle default sits with the volume and the image
    await dialog.getByTestId('cfg-idle').fill('45')
    await dialog.getByTestId('config-save').click()
    await expect(toast(page).first()).toContainText(t('toast.configSaved'))
    await expect(dialog).toBeHidden()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/mounts')
    expect(put.body).toMatchObject({ folders: { project: '/Users/lucas/Projects/CANALV2' }, network_volume_id: 'vol2', data_center_id: 'CA-MTL-1', idle_stop_minutes: 45, sync_parallel: 4 })
    await openCreatePod(page)
    await expect(page.getByTestId('pod-mounts-group')).toContainText(t('form.summaryVolume', { id: 'vol2', path: '/workspace' }) + ', ' + t('form.summaryMapped', { mapped: 1, total: 3, links: 1 }))
    await expect(page.locator('#pod-idle')).toHaveAttribute('placeholder', '45')
  })

  test('a saved tree shows what it declares, without a machine path', async ({ page, api }) => {
    api.state.mounts.config.folders.project = '/Users/lucas/Projects/CANALV2'
    await page.goto('/')
    const dialog = await openConfig(page)
    await cfgTab(dialog, 'folders')
    const note = folderRow(dialog, 'project').getByTestId('folder-note')
    await expect(note).toHaveText(t('config.linkedFrom', { source: "the tree's job files" }))
    await expect(note).not.toContainText('/home/binc')
    await cfgTab(dialog, 'options')
    await dialog.getByTestId('preview-pod-toggle').click()
    await expect(dialog.getByTestId('preview-pod')).toContainText('COMFY_LINKS=/home/binc/CANALV2_r3/CANALV2=/workspace/project')
  })

  test('custom folders are added below the three and saved', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
    await cfgTab(dialog, 'folders')
    await dialog.getByTestId('add-folder').click()
    const custom = dialog.getByTestId('custom-row-0')
    await expect(custom).toBeVisible()
    await custom.getByTestId('custom-name').fill('legacy')
    await custom.getByTestId('custom-local').fill('/Users/lucas/old')
    await custom.getByTestId('custom-link').fill('/home/binc/Desktop/old')
    await expect(custom.getByTestId('custom-container')).toHaveAttribute('placeholder', '/workspace/legacy')
    await dialog.getByTestId('config-save').click()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/mounts')
    expect(put.body.custom).toEqual([{ name: 'legacy', local: '/Users/lucas/old', container: '', link: '/home/binc/Desktop/old', mode: 'rw' }])
  })

  test('a failed save stays open and reports inline and as a toast', async ({ page, api }) => {
    api.state.failures['PUT /mounts'] = 'plates: a folder is an absolute path on this PC'
    await page.goto('/')
    const dialog = await openConfig(page)
    await dialog.getByTestId('config-save').click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('config-error')).toContainText('absolute path')
    await expect(toast(page).first()).toContainText(t('toast.failedWith', { label: t('toast.saveConfig'), error: 'plates: a folder is an absolute path on this PC' }))
  })

  test('the datacenter is a menu from RunPod: S3 support and our cards at the secure-cloud price', async ({ page, api }) => {
    api.state.mounts.config.data_center_id = 'EU-RO-1'
    await page.goto('/')
    await page.getByTestId('open-config').click()
    await cfgTab(configModal(page), 'volume')
    const dc = page.getByTestId('cfg-dc')
    await expect(dc).toHaveValue('EU-RO-1')
    await expect(dc.locator('option')).toHaveText([t('config.datacenterAny'), 'CA-MTL-1 · A40 $0.35/h High', 'EU-RO-1 · RTX 4000 Ada $0.28/h Low, RTX 4090 $0.89/h High · S3', 'US-KS-2 · S3'])   // in-stock group first, then the S3 group, then none in stock
    expect(await dc.locator('optgroup').evaluateAll((els) => els.map((e) => e.label))).toEqual([t('dc.groupOther'), t('dc.groupS3'), t('dc.groupNone')])   // S3 with stock, others with stock, nothing in stock
    await dc.selectOption('EU-RO-1')
    await expect(page.getByTestId('cfg-dc-card')).toHaveText(['RTX 4000 Ada20 GB$0.28/hLow', 'RTX 409024 GB$0.89/hHigh'])   // the read-only card table under the menu
    await expect(page.getByTestId('cfg-dc-cards')).toContainText(t('config.cardsS3'))
    await dc.selectOption('CA-MTL-1')
    await expect(page.getByTestId('cfg-dc-card')).toHaveText(['A4048 GB$0.35/hHigh'])
    await page.getByTestId('config-save').click()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/mounts')
    expect(put.body.data_center_id).toBe('CA-MTL-1')
  })

  test('the volume line says what the volume is and costs a month, or that RunPod has none by that id', async ({ page, api }) => {
    api.state.mounts.config.network_volume_id = 'vol1'
    await page.goto('/')
    await page.getByTestId('open-config').click()
    await cfgTab(configModal(page), 'volume')
    await expect(page.getByTestId('cfg-volume-info')).toContainText(t('config.volumeInfo', { name: 'comfy-workspace', size: 120, dc: 'EU-RO-1', cost: 8.4 }))
    await expect(page.getByTestId('cfg-volume-info')).toContainText(t('config.volumeS3'))
    await expect(page.getByTestId('stat-storage')).toContainText('$8.40')   // the stats bar carries the monthly cost too
    await page.getByTestId('cfg-dc').selectOption('CA-MTL-1')   // the menu follows the datacenter
    await expect(page.getByTestId('cfg-volume').locator('option')).toHaveText([t('config.volumeNone'), 'scratch · 50 GB · vol2'])
    await page.getByTestId('cfg-volume').selectOption('vol2')
    await expect(page.getByTestId('cfg-volume-info')).toContainText(t('config.volumeInfo', { name: 'scratch', size: 50, dc: 'CA-MTL-1', cost: 3.5 }))
    await expect(page.getByTestId('stat-storage')).toContainText('$8.40')   // an unsaved edit in the panel does not touch the stats bar
  })

  test('with no volume yet the panel offers to create one in the Volumes modal, then lists it', async ({ page, api }) => {
    api.state.volumes = {}
    await page.goto('/')
    const dialog = await openConfig(page)
    await cfgTab(dialog, 'volume')
    await expect(dialog.getByTestId('cfg-volume-none')).toContainText(t('config.volumesNone'))
    await dialog.getByTestId('cfg-volume-add').click()
    const volumes = modal(page, t('volumes.title'))
    await expect(volumes).toBeVisible()
    await volumes.getByTestId('volume-new-name').fill('fresh')
    await volumes.getByTestId('volume-new-dc').selectOption('EU-RO-1')
    await volumes.getByTestId('volume-create').click()
    await expect(volumes.locator('[data-testid="volume"]', { hasText: 'fresh' })).toBeVisible()
    await volumes.getByRole('button', { name: t('volumes.done') }).click()
    await expect(volumes).toBeHidden()
    await expect(dialog.getByTestId('cfg-volume-none')).toHaveCount(0)
    await expect(dialog.getByTestId('cfg-volume').locator('option')).toContainText([t('config.volumeNone'), 'fresh · 100 GB'])
  })

  test('clear resets to nothing mapped', async ({ page, api }) => {
    api.state.mounts.config.folders.project = '/Users/lucas/Projects/CANALV2'; api.state.mounts.stored = true
    await page.goto('/')
    const dialog = await openConfig(page)
    await dialog.getByTestId('config-clear').click()
    await expect(toast(page).first()).toContainText(t('toast.configCleared'))
    await expect(folderRow(dialog, 'project').getByTestId('folder-local')).toHaveValue('')
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/mounts' }))
  })
})

test.describe('the RunPod key', () => {
  test('is entered in the panel, stored through the API, and only its hint is shown', async ({ page, api }) => {
    api.state.settings = { runpod_api_key_set: false, runpod_api_key_hint: '', source: 'none' }
    await page.goto('/')
    const dialog = modal(page, t('config.title'))   // with no key the panel opens on its own, gated to the key field
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('cfg-key-gate')).toContainText(t('config.keyGate'))
    await expect(dialog.getByTestId('section-volume')).toHaveCount(0)     // the other settings are out of reach
    await expect(dialog.getByTestId('config-close')).toHaveCount(0)       // and the panel cannot be dismissed
    await expect(page.getByTestId('key-required')).toContainText(t('dashboard.keyRequired'))
    await expect(page.getByTestId('open-volumes')).toBeDisabled()
    await expect(dialog.getByTestId('cfg-key-group')).toContainText(t('config.apiKeyUnset'))
    await expect(dialog.getByTestId('config-save')).toBeDisabled()        // nothing to save until a key is typed
    await dialog.getByTestId('cfg-key').fill('rpa_0123456789ABCDEFXYZ9')
    await dialog.getByTestId('config-save').click()
    await cfgTab(dialog, 'volume')
    await expect(dialog.getByTestId('section-volume')).toBeVisible()      // the key is in: the rest appears, the panel stays open
    await expect(dialog.getByTestId('cfg-key-gate')).toHaveCount(0)
    await expect(page.getByTestId('open-volumes')).toBeEnabled()
    await dialog.getByTestId('config-close').click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('key-required')).toHaveCount(0)
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/settings')
    expect(put.body).toEqual({ runpod_api_key: 'rpa_0123456789ABCDEFXYZ9' })
    const again = await openConfig(page)
    await expect(again.getByTestId('cfg-key-group')).toContainText(t('config.apiKeyStored', { hint: '••••XYZ9', source: '/home/me/.config/runpod-pod-manager/.env' }))
    await expect(again.getByTestId('cfg-key')).toHaveValue('')
  })
})

test.describe('no-spend mode', () => {
  test('the switch is saved and the header follows at once, no refresh: on shows the badge, off takes it away', async ({ page, api }) => {
    await page.goto('/')
    await expect(page.getByTestId('no-spend-badge')).toHaveCount(0)
    let dialog = await openConfig(page)
    await cfgTab(dialog, 'options')
    await dialog.getByTestId('cfg-dry-run').check()
    await dialog.getByTestId('config-save').click()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/mounts')
    expect(put.body.dry_run).toBe(true)
    await expect(page.getByTestId('no-spend-badge')).toHaveText(t('app.noSpend'))   // without pressing Refresh
    // the pod list was asked for again: with the mode changed, the pods shown are another set
    const dashboards = api.calls.filter((c) => c.path === '/dashboard').length
    expect(dashboards).toBeGreaterThanOrEqual(2)
    dialog = await openConfig(page)
    await cfgTab(dialog, 'options')
    await expect(dialog.getByTestId('cfg-dry-run')).toBeChecked()
    await dialog.getByTestId('cfg-dry-run').uncheck()
    await dialog.getByTestId('config-save').click()
    await expect(page.getByTestId('no-spend-badge')).toHaveCount(0)
  })

  test('Clear resets the mode too, and the header follows', async ({ page, api }) => {
    api.state.mounts.config.dry_run = true; api.state.mounts.stored = true
    await page.goto('/')
    await expect(page.getByTestId('no-spend-badge')).toBeVisible()
    const dialog = await openConfig(page)
    await dialog.getByTestId('config-clear').click()
    await expect(page.getByTestId('no-spend-badge')).toHaveCount(0)
  })

  test('when the environment forces it (RUNPOD_DRY_RUN=1) the switch says so and cannot be turned off; the header stays on', async ({ page, api }) => {
    api.state.mounts.dryForced = true
    await page.goto('/')
    await expect(page.getByTestId('no-spend-badge')).toBeVisible()
    const dialog = await openConfig(page)
    await cfgTab(dialog, 'options')
    await expect(dialog.getByTestId('cfg-dry-run')).toBeDisabled()
    await expect(dialog.getByTestId('cfg-dry-forced')).toContainText('RUNPOD_DRY_RUN=1')
    await dialog.getByTestId('config-save').click()
    await expect(page.getByTestId('no-spend-badge')).toBeVisible()
  })

  test('a pod\'s own configuration has no no-spend switch: it is app-wide', async ({ page }) => {
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click()
    const panel = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' }))
    await expect(panel.getByTestId('cfg-dry-run')).toHaveCount(0)
    await expect(panel.getByTestId('cfg-dry-forced')).toHaveCount(0)
  })
})

test.describe('features that read the configuration', () => {
  test('the GPU menu comes from the API and the stock image is a choice', async ({ page }) => {
    await page.goto('/')
    await openCreatePod(page)
    await expect(page.locator('#pod-gpu option')).toHaveText(['Cheapest card in stock (16-24 GB)', 'RTX A4000 (16 GB) · none in stock', 'RTX 4090 (24 GB) · $0.34/h · Low stock'])
    await expect(page.getByTestId('pod-gpu-group')).toContainText(t('form.gpuStock'))
    await expect(page.locator('#pod-image option')).toHaveText([t('form.imageConfigured'), t('form.imagePrebuilt'), t('form.imageCustom')])
  })

  test('a running card shows its idle stop, a stopped one does not', async ({ page, api }) => {
    api.state.pods[0].idle_stop_minutes = 30
    await page.goto('/')
    await expect(podCard(page, 'ComfyUI-Dev').getByTestId('pod-idle')).toHaveText(t('pod.idleAfter', { n: 30 }))
    await expect(podCard(page, 'ComfyUI-Batch').getByTestId('pod-idle')).toHaveCount(0)
  })

  test('every pod action toasts its outcome', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-stop').click()
    await expect(toast(page).first()).toContainText(t('toast.podStopped'))
    await podCard(page, 'ComfyUI-Batch').getByTestId('pod-resume').click()
    await expect(toast(page).last()).toContainText(t('toast.podResumed'))
    await podCard(page, 'ComfyUI-Test').getByTestId('pod-delete').click()
    await expect(toast(page).last()).toContainText(t('toast.podDeleted'))
    await expect(toast(page)).toHaveCount(3)
    await toast(page).first().getByTestId('toast-close').click()
    await expect(toast(page)).toHaveCount(2)
  })

  test('the Anthropic key tests itself: no button; a typed key a moment after typing stops (not stored), the stored key when the panel opens', async ({ page, api }) => {
    await page.goto('/')
    await page.getByTestId('open-config').click()
    const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await expect(cfg.getByTestId('cfg-claude-group')).toContainText(t('config.claudeUnset'))
    await expect(cfg.getByTestId('cfg-claude-test')).toHaveCount(0)   // there is no Test key button
    await expect(cfg.getByTestId('cfg-claude-result')).toHaveCount(0) // and nothing is asked with no key
    await cfg.getByTestId('cfg-claude-key').fill('sk-ant-short')
    await page.waitForTimeout(900)
    await expect(cfg.getByTestId('cfg-claude-result')).toHaveCount(0) // not a key yet: nothing is sent
    expect(api.state.settings.anthropicChecks || []).toEqual([])
    await cfg.getByTestId('cfg-claude-key').fill('sk-ant-api03-0123456789ABCDWXYZ')
    await expect(cfg.getByTestId('cfg-claude-result')).toHaveAttribute('data-ok', 'true')   // asked on its own
    await expect(cfg.getByTestId('cfg-claude-result')).toContainText(t('config.claudeWorksTyped'))
    expect(api.state.settings.anthropicChecks).toEqual(['sk-ant-api03-0123456789ABCDWXYZ'])   // the typed key was what was asked about
    expect(api.state.settings.anthropic_key_set).toBeFalsy()   // and it is not stored until Save
    await cfg.getByTestId('cfg-claude-key').fill('sk-ant-api03-BADBADBADBADBADBADBAD')
    await expect(cfg.getByTestId('cfg-claude-result')).toHaveAttribute('data-ok', 'false')
    await expect(cfg.getByTestId('cfg-claude-result')).toContainText('invalid x-api-key')
    await cfg.getByTestId('cfg-claude-key').fill('sk-ant-api03-0123456789ABCDWXYZ')
    await expect(cfg.getByTestId('cfg-claude-result')).toHaveAttribute('data-ok', 'true')
    await cfg.getByTestId('config-save').click()
    await expect(page.locator('.modal.show', { has: page.getByTestId('config-modal') })).toHaveCount(0)
    expect(api.state.settings.anthropic_key_set).toBe(true)
    // reopened: the stored key is checked as the panel opens, with nothing typed
    api.state.settings.anthropicChecks = []
    await page.getByTestId('open-config').click()
    const again = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await expect(again.getByTestId('cfg-claude-result')).toHaveAttribute('data-ok', 'true')
    await expect(again.getByTestId('cfg-claude-result')).toContainText(t('config.claudeWorks'))
    expect(api.state.settings.anthropicChecks).toEqual([null])   // no key in the request: the stored one
    api.state.settings.anthropicRejects = true   // revoked meanwhile
    await again.getByTestId('config-close').click()
    await page.getByTestId('open-config').click()
    await expect(page.locator('.modal.show', { has: page.getByTestId('config-modal') }).getByTestId('cfg-claude-result')).toContainText('invalid x-api-key')
  })
})

test.describe('configuration layout', () => {
  test('desktop: sections are tabs, one at a time, and the tab bar names them', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const dialog = await openConfig(page)
    await expect(dialog.getByTestId('cfg-tabs')).toBeVisible()
    await expect(dialog.locator('[data-testid^="cfg-tab-"]')).toHaveText([t('config.runpod'), t('config.volume'), t('config.folders'), t('config.environment'), t('adapters.section'), t('config.options')])
    await expect(dialog.getByTestId('section-runpod')).toBeVisible()
    await expect(dialog.getByTestId('section-volume')).toBeHidden()
    await dialog.getByTestId('cfg-tab-folders').click()
    await expect(dialog.getByTestId('section-folders')).toBeVisible()
    await expect(dialog.getByTestId('section-runpod')).toBeHidden()
  })

  test('landscape tablet (1024 wide): tabs too', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    const dialog = await openConfig(page)
    await expect(dialog.getByTestId('cfg-tabs')).toBeVisible()
  })

  test('phone and portrait tablet: no tabs, every section flows down the page', async ({ page }) => {
    for (const width of [390, 820]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      const dialog = await openConfig(page)
      await expect(dialog.getByTestId('cfg-tabs')).toHaveCount(0)
      for (const id of ['section-runpod', 'section-volume', 'section-folders']) await expect(dialog.getByTestId(id)).toBeVisible()
      await dialog.getByTestId('config-close').click()
    }
  })

  test('resizing across the breakpoint switches between tabs and the flow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const dialog = await openConfig(page)
    await expect(dialog.getByTestId('cfg-tabs')).toBeVisible()
    await page.setViewportSize({ width: 600, height: 800 })
    await expect(dialog.getByTestId('cfg-tabs')).toHaveCount(0)
    await expect(dialog.getByTestId('section-volume')).toBeVisible()
  })
})

test.describe('configuration › environment: load defaults from the image or the Dockerfile', () => {
  const dockerState = (api) => {
    api.state.imageEnv = [{ key: 'COMFYUI_PORT', value: '8188' }, { key: 'HF_TOKEN', value: 'from-dockerfile' }]
    api.state.imageBuildArgs = [{ key: 'TORCH_VERSION', value: '2.6.0' }, { key: 'CUDA_VERSION', value: '12.4.1' }]
    api.state.imageEnvSkipped = 0
  }

  test('Default Configuration loads the env and the build args from the Dockerfile as rows; ARGs are marked and saved with the env', async ({ page, api }) => {
    dockerState(api)
    await page.goto('/')
    const dialog = await openConfig(page)
    await cfgTab(dialog, 'environment')
    await expect(dialog.getByTestId('cfg-env-load-menu')).toBeVisible()
    await dialog.getByTestId('cfg-env-load-menu').click()
    await expect(dialog.getByTestId('cfg-env-load-image')).toContainText('ghcr.io/example/comfy-app:v26')   // names the image it would read
    await dialog.getByTestId('cfg-env-load-dockerfile').click()
    const keys = dialog.getByTestId('cfg-env-key')
    await expect(keys).toHaveCount(4)
    expect(await keys.evaluateAll((els) => els.map((e) => e.value))).toEqual(['COMFYUI_PORT', 'HF_TOKEN', 'TORCH_VERSION', 'CUDA_VERSION'])
    await expect(dialog.getByTestId('cfg-env-arg')).toHaveCount(2)        // the two build ARGs say so
    await expect(dialog.getByTestId('cfg-env-summary')).toHaveText(t('config.envLoaded', { env: 2, args: 2, image: '/repo/apps/comfy-app/Dockerfile', added: 4, replaced: 0 }))
    expect(api.calls).toContainEqual(expect.objectContaining({ path: '/images/env', query: { source: 'dockerfile', image: 'ghcr.io/example/comfy-app:v26' } }))
    await dialog.getByTestId('config-save').click()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/mounts')
    expect(put.body.env).toEqual({ COMFYUI_PORT: '8188', HF_TOKEN: 'from-dockerfile', TORCH_VERSION: '2.6.0', CUDA_VERSION: '12.4.1' })
  })

  test('your values are kept unless Replace existing values is on, and loading twice adds nothing', async ({ page, api }) => {
    dockerState(api)
    await page.goto('/')
    const dialog = await openConfig(page)
    await cfgTab(dialog, 'environment')
    await dialog.getByRole('button', { name: 'Add variable' }).click()
    await dialog.getByTestId('cfg-env-key').first().fill('HF_TOKEN')
    await dialog.getByTestId('cfg-env-value').first().fill('mine')
    const load = async () => { await dialog.getByTestId('cfg-env-load-menu').click(); await dialog.getByTestId('cfg-env-load-dockerfile').click() }
    await load()
    await expect(dialog.getByTestId('cfg-env-key')).toHaveCount(4)
    await expect(dialog.getByTestId('cfg-env-value').first()).toHaveValue('mine')   // kept
    await expect(dialog.getByTestId('cfg-env-summary')).toContainText('3 added, 0 replaced')
    await load()
    await expect(dialog.getByTestId('cfg-env-key')).toHaveCount(4)                  // nothing doubled
    await expect(dialog.getByTestId('cfg-env-summary')).toContainText('0 added, 0 replaced')
    await dialog.getByTestId('cfg-env-replace').check()
    await load()
    await expect(dialog.getByTestId('cfg-env-value').first()).toHaveValue('from-dockerfile')
    await expect(dialog.getByTestId('cfg-env-summary')).toContainText('0 added, 1 replaced')
  })

  test('from the image reads the configured image, and the system vars it skipped are counted', async ({ page, api }) => {
    dockerState(api); api.state.imageEnvSkipped = 41
    await page.goto('/')
    const dialog = await openConfig(page)
    await cfgTab(dialog, 'environment')
    await dialog.getByTestId('cfg-env-load-menu').click()
    await dialog.getByTestId('cfg-env-load-image').click()
    await expect(dialog.getByTestId('cfg-env-summary')).toContainText('ghcr.io/example/comfy-app:v26')
    await expect(dialog.getByTestId('cfg-env-summary')).toContainText(t('config.envSkipped', { n: 41 }))
    expect(api.calls).toContainEqual(expect.objectContaining({ path: '/images/env', query: { source: 'image', image: 'ghcr.io/example/comfy-app:v26' } }))
  })

  test('a failure says why and changes nothing', async ({ page, api }) => {
    api.state.failures['GET /images/env'] = 'Could not read the image'
    await page.goto('/')
    const dialog = await openConfig(page)
    await cfgTab(dialog, 'environment')
    await dialog.getByTestId('cfg-env-load-menu').click()
    await dialog.getByTestId('cfg-env-load-dockerfile').click()
    await expect(dialog.getByTestId('cfg-env-error')).toContainText('Could not read the image')
    await expect(dialog.getByTestId('cfg-env-key')).toHaveCount(0)
  })
})
