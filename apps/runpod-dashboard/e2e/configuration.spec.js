import { test, expect, modal, openCreatePod, podCard } from './fixtures'

// The Configuration panel (gear icon): the pod volume, the three folders mapped on this PC with
// the folder picker, the required switches in dev mode, custom folders, the image and idle
// defaults, and what saving does. Plus the features that read it: the pod form and the cards.

const openConfig = async (page) => {
  await page.getByRole('button', { name: 'Configuration' }).click()
  const dialog = modal(page, 'Configuration')
  await expect(dialog).toBeVisible()
  return dialog
}
const folderRow = (dialog, label) => dialog.locator('tr', { hasText: label }).first()
const toast = (page) => page.locator('.toast-container .toast')

test.describe('configuration', () => {
  test('shows the pod volume first, then the three folders with their pod paths and variables', async ({ page }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
    const headings = dialog.locator('h6')
    await expect(headings.nth(0)).toContainText('RunPod')
    await expect(headings.nth(1)).toContainText('Pod volume')
    await expect(headings.nth(2)).toContainText('Folders on this PC')
    await expect(dialog.getByLabel('Network volume ID')).toHaveValue('')
    await expect(dialog.getByLabel('Mount path')).toHaveValue('/workspace')
    await expect(dialog.getByLabel('Image')).toHaveValue('ghcr.io/example/comfy-app:v26')
    await expect(dialog.getByLabel('Idle stop (minutes)')).toHaveValue('30')
    for (const [label, container, env] of [['Project tree', '/workspace/project', 'PROJECT_ROOT'], ['Plates', '/workspace/plates', 'PLATES_ROOT'], ['ComfyUI-Shared', '/workspace/comfy-shared', 'COMFY_SHARED']]) {
      const row = folderRow(dialog, label)
      await expect(row).toContainText(container)
      await expect(row).toContainText(env)
      await expect(row.getByPlaceholder('not mapped')).toHaveValue('')
    }
    await expect(dialog).toContainText('Mode dev')
  })

  test('in dev mode every folder is optional until its switch is on', async ({ page }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
    const row = folderRow(dialog, 'Plates')
    await expect(row).toContainText('optional')
    await row.getByRole('checkbox').check()
    await expect(row).toContainText('required')
  })

  test('the folder picker browses this PC and fills the row', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
    await folderRow(dialog, 'Project tree').getByRole('button', { name: 'Browse' }).click()
    const picker = modal(page, 'Choose the project tree folder')
    await expect(picker).toBeVisible()
    await expect(picker.locator('.folder-list button')).toHaveText(['ComfyUI-Shared', 'Projects'])
    await picker.locator('.folder-list button', { hasText: 'Projects' }).dblclick()
    await expect(picker.locator('.folder-list button')).toHaveText(['CANALV2', 'plates'])
    await picker.locator('.folder-list button', { hasText: 'CANALV2' }).click()
    await picker.getByRole('button', { name: 'Use this folder' }).click()
    await expect(picker).toBeHidden()
    await expect(folderRow(dialog, 'Project tree').getByPlaceholder('not mapped')).toHaveValue('/Users/lucas/Projects/CANALV2')
    expect(api.calls.filter((c) => c.path === '/fs/dirs').map((c) => c.query.path ?? '')).toEqual(['', '/Users/lucas/Projects'])
  })

  test('saving sends the mapping, shows a toast, closes, and the pod form reflects it', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
    await folderRow(dialog, 'Project tree').getByPlaceholder('not mapped').fill('/Users/lucas/Projects/CANALV2')
    await dialog.getByLabel('Network volume ID').fill('vol-9')
    await dialog.getByLabel('Idle stop (minutes)').fill('45')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(toast(page).first()).toContainText('Configuration saved')
    await expect(dialog).toBeHidden()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/mounts')
    expect(put.body).toMatchObject({ folders: { project: '/Users/lucas/Projects/CANALV2' }, network_volume_id: 'vol-9', idle_stop_minutes: 45 })
    await openCreatePod(page)
    await expect(page.locator('form')).toContainText('volume vol-9 at /workspace, 1/3 folder(s) mapped, 1 link(s)')
    await expect(page.locator('#pod-idle')).toHaveAttribute('placeholder', '45')
  })

  test('a saved tree shows what it declares, without a machine path', async ({ page, api }) => {
    api.state.mounts.config.folders.project = '/Users/lucas/Projects/CANALV2'
    await page.goto('/')
    const dialog = await openConfig(page)
    const row = folderRow(dialog, 'Project tree')
    await expect(row).toContainText("On a pod, linked from the tree's job files.")
    await expect(row).not.toContainText('/home/binc')
    await dialog.locator('details', { hasText: 'What a new pod receives' }).locator('summary').click()
    await expect(dialog).toContainText('COMFY_LINKS=/home/binc/CANALV2_r3/CANALV2=/workspace/project')
  })

  test('custom folders are added below the three and saved', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
    await dialog.getByRole('button', { name: 'Add folder' }).click()
    const rows = dialog.locator('tbody tr')
    await expect(rows).toHaveCount(4)
    const custom = rows.nth(3)
    await custom.getByPlaceholder('name', { exact: true }).fill('legacy')
    await custom.getByPlaceholder('not mapped').fill('/Users/lucas/old')
    await custom.getByPlaceholder('optional: a pod links it onto the pod path').fill('/home/binc/Desktop/old')
    await expect(custom.getByPlaceholder('/workspace/legacy')).toBeVisible()
    await dialog.getByRole('button', { name: 'Save' }).click()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/mounts')
    expect(put.body.custom).toEqual([{ name: 'legacy', local: '/Users/lucas/old', container: '', link: '/home/binc/Desktop/old', mode: 'rw' }])
  })

  test('a failed save stays open and reports inline and as a toast', async ({ page, api }) => {
    api.state.failures['PUT /mounts'] = 'plates: a folder is an absolute path on this PC'
    await page.goto('/')
    const dialog = await openConfig(page)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toContainText('absolute path')
    await expect(toast(page).first()).toContainText('Save configuration failed')
  })

  test('clear resets to nothing mapped', async ({ page, api }) => {
    api.state.mounts.config.folders.project = '/Users/lucas/Projects/CANALV2'; api.state.mounts.stored = true
    await page.goto('/')
    const dialog = await openConfig(page)
    await dialog.getByRole('button', { name: 'Clear' }).click()
    await expect(toast(page).first()).toContainText('Configuration cleared')
    await expect(folderRow(dialog, 'Project tree').getByPlaceholder('not mapped')).toHaveValue('')
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/mounts' }))
  })
})

test.describe('the RunPod key', () => {
  test('is entered in the panel, stored through the API, and only its hint is shown', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openConfig(page)
    await expect(dialog.locator('h6').first()).toContainText('RunPod')
    await expect(dialog).toContainText('Not set')
    await dialog.getByLabel('API key').fill('rpa_0123456789ABCDEFXYZ9')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/settings')
    expect(put.body).toEqual({ runpod_api_key: 'rpa_0123456789ABCDEFXYZ9' })
    await openConfig(page)
    await expect(page.locator('.modal.show')).toContainText('Stored (••••XYZ9)')
    await expect(page.getByLabel('API key')).toHaveValue('')
  })
})

test.describe('no-spend mode', () => {
  test('the switch is saved and the navbar says so', async ({ page, api }) => {
    await page.goto('/')
    await expect(page.locator('.navbar')).not.toContainText('no-spend mode')
    const dialog = await openConfig(page)
    await dialog.getByLabel(/No-spend mode/).check()
    await dialog.getByRole('button', { name: 'Save' }).click()
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === '/mounts')
    expect(put.body.dry_run).toBe(true)
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.locator('.navbar')).toContainText('no-spend mode')
  })
})

test.describe('features that read the configuration', () => {
  test('the GPU menu comes from the API and the stock image is a choice', async ({ page }) => {
    await page.goto('/')
    await openCreatePod(page)
    await expect(page.getByLabel('GPU', { exact: true }).locator('option')).toHaveText(['RTX A4000 (16 GB)', 'RTX 4090 (24 GB)'])
    await expect(page.getByLabel('Image', { exact: true }).locator('option')).toHaveText(['Configured image (ours, with the packs)', 'ComfyUI (ashleykza): no packs, no links', 'Custom image'])
  })

  test('a running card shows its idle stop, a stopped one does not', async ({ page, api }) => {
    api.state.pods[0].idle_stop_minutes = 30
    await page.goto('/')
    await expect(podCard(page, 'ComfyUI-Dev')).toContainText('after 30 quiet min')
    await expect(podCard(page, 'ComfyUI-Batch')).not.toContainText('Idle stop')
  })

  test('every pod action toasts its outcome', async ({ page, api }) => {
    page.on('dialog', (d) => d.accept())
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByRole('button', { name: 'Stop' }).click()
    await expect(toast(page).first()).toContainText('Pod stopped')
    await podCard(page, 'ComfyUI-Batch').getByRole('button', { name: 'Resume' }).click()
    await expect(toast(page).last()).toContainText('Pod resumed')
    await podCard(page, 'ComfyUI-Test').getByRole('button', { name: 'Delete' }).click()
    await expect(toast(page).last()).toContainText('Pod deleted')
    await expect(toast(page)).toHaveCount(3)
    await toast(page).first().getByRole('button', { name: 'Close' }).click()
    await expect(toast(page)).toHaveCount(2)
  })
})
