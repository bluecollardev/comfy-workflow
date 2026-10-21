import { test, expect, openCreatePod, podCard } from './fixtures'
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
    const row = folderRow(dialog, 'plates')
    await expect(row.getByTestId('folder-required-text')).toHaveText(t('config.optional'))
    await row.getByTestId('folder-required').check()   // the switch's input carries the test id
    await expect(row.getByTestId('folder-required-text')).toHaveText(t('config.required'))
  })

  test('the folder picker browses this PC and fills the row', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
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
    await folderRow(dialog, 'project').getByTestId('folder-local').fill('/Users/lucas/Projects/CANALV2')
    await dialog.getByTestId('cfg-volume').selectOption('vol2')   // a volume of the account; picking it sets its datacenter
    await expect(dialog.getByTestId('cfg-dc')).toHaveValue('CA-MTL-1')
    await dialog.getByTestId('cfg-idle').fill('45')
    await dialog.getByTestId('config-save').click()
    await expect(toast(page).first()).toContainText(t('toast.configSaved'))
    await expect(dialog).toBeHidden()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/mounts')
    expect(put.body).toMatchObject({ folders: { project: '/Users/lucas/Projects/CANALV2' }, network_volume_id: 'vol2', data_center_id: 'CA-MTL-1', idle_stop_minutes: 45 })
    await openCreatePod(page)
    await expect(page.getByTestId('pod-mounts-group')).toContainText(t('form.summaryVolume', { id: 'vol2', path: '/workspace' }) + ', ' + t('form.summaryMapped', { mapped: 1, total: 3, links: 1 }))
    await expect(page.locator('#pod-idle')).toHaveAttribute('placeholder', '45')
  })

  test('a saved tree shows what it declares, without a machine path', async ({ page, api }) => {
    api.state.mounts.config.folders.project = '/Users/lucas/Projects/CANALV2'
    await page.goto('/')
    const dialog = await openConfig(page)
    const note = folderRow(dialog, 'project').getByTestId('folder-note')
    await expect(note).toHaveText(t('config.linkedFrom', { source: "the tree's job files" }))
    await expect(note).not.toContainText('/home/binc')
    await dialog.getByTestId('preview-pod-toggle').click()
    await expect(dialog.getByTestId('preview-pod')).toContainText('COMFY_LINKS=/home/binc/CANALV2_r3/CANALV2=/workspace/project')
  })

  test('custom folders are added below the three and saved', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
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
    await expect(page.getByTestId('cfg-volume-info')).toContainText(t('config.volumeInfo', { name: 'comfy-workspace', size: 120, dc: 'EU-RO-1', cost: 8.4 }))
    await expect(page.getByTestId('cfg-volume-info')).toContainText(t('config.volumeS3'))
    await expect(page.getByTestId('stat-storage')).toContainText('$8.40')   // the stats bar carries the monthly cost too
    await page.getByTestId('cfg-dc').selectOption('CA-MTL-1')   // the menu follows the datacenter
    await expect(page.getByTestId('cfg-volume').locator('option')).toHaveText([t('config.volumeNone'), 'scratch · 50 GB · vol2'])
    await page.getByTestId('cfg-volume').selectOption('vol2')
    await expect(page.getByTestId('cfg-volume-info')).toContainText(t('config.volumeInfo', { name: 'scratch', size: 50, dc: 'CA-MTL-1', cost: 3.5 }))
    await expect(page.getByTestId('stat-storage')).toContainText('$8.40')   // an unsaved edit in the panel does not touch the stats bar
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
    await page.goto('/')
    const dialog = await openConfig(page)
    await expect(dialog.getByTestId('cfg-key-group')).toContainText(t('config.apiKeyUnset'))
    await dialog.getByTestId('cfg-key').fill('rpa_0123456789ABCDEFXYZ9')
    await dialog.getByTestId('config-save').click()
    await expect(dialog).toBeHidden()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/settings')
    expect(put.body).toEqual({ runpod_api_key: 'rpa_0123456789ABCDEFXYZ9' })
    const again = await openConfig(page)
    await expect(again.getByTestId('cfg-key-group')).toContainText(t('config.apiKeyStored', { hint: '••••XYZ9', source: '/home/me/.config/runpod-pod-manager/.env' }))
    await expect(again.getByTestId('cfg-key')).toHaveValue('')
  })
})

test.describe('no-spend mode', () => {
  test('the switch is saved and the navbar says so', async ({ page, api }) => {
    await page.goto('/')
    await expect(page.getByTestId('no-spend-badge')).toHaveCount(0)
    const dialog = await openConfig(page)
    await dialog.getByTestId('cfg-dry-run').check()
    await dialog.getByTestId('config-save').click()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/mounts')
    expect(put.body.dry_run).toBe(true)
    await page.getByTestId('refresh').click()
    await expect(page.getByTestId('no-spend-badge')).toHaveText(t('app.noSpend'))
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
})
