import { test, expect, modal, answerConfirm } from './fixtures'
import { t } from './i18n'

const openVolumes = async (page) => {
  await page.getByTestId('open-shared').click()
  await page.getByTestId('shared-volumes').click()
  const dialog = modal(page, t('volumes.title'))
  await expect(dialog).toBeVisible()
  return dialog
}
const volume = (dialog, id) => dialog.locator('[data-testid="volume"]', { has: dialog.page().locator(`[data-id="${id}"]`) }).first()

test.describe('volumes: clone', () => {
  test('Clone: into an existing volume or a new one in another datacenter; it says which way the files go and what it costs, then copies', async ({ page, api }) => {
    api.state.settings.s3_keys_set = true   // S3 keys: an S3 datacenter on one side means one pod
    await page.goto('/')
    const dialog = await openVolumes(page)
    await dialog.locator('[data-testid="volume"][data-id="vol2"]').getByTestId('volume-clone').click()   // scratch, CA-MTL-1: no S3 API
    const m = page.getByTestId('volume-clone-modal')
    await m.getByTestId('volume-clone-to').selectOption('vol1')   // comfy-workspace, EU-RO-1: has it
    await expect(m.getByTestId('volume-clone-way')).toContainText('pushes')   // a pod on the source pushes to the target's S3 API
    await expect(m.getByTestId('volume-clone-go')).toBeDisabled()   // nobody has said yes yet
    await m.getByTestId('volume-clone-by').fill('Lucas')
    await expect(m.getByTestId('volume-clone-go')).toBeEnabled()
    await m.getByTestId('volume-clone-kind-new').check()
    const groups = await m.getByTestId('volume-clone-dc').evaluate((el) => [...el.querySelectorAll('optgroup')].map((g) => ({ label: g.label, options: [...g.querySelectorAll('option')].map((o) => o.value) })))   // grouped by S3: the datacenters with the API, then those without
    expect(groups.map((g) => g.label)).toEqual(['S3 API: read and written without a pod'])   // from CA-MTL-1 the other datacenters on offer both have the API
    expect(groups[0].options).toEqual(['EU-RO-1', 'US-KS-2'])
    await m.getByTestId('volume-clone-dc').selectOption('US-KS-2')
    await m.getByTestId('volume-clone-name').fill('scratch-ks')
    await expect(m.getByTestId('volume-clone-cost')).toContainText('3.5')   // 50 GB at $0.07
    await m.getByTestId('volume-clone-go').click()
    await expect(m.getByTestId('volume-clone-job')).toContainText('12 file')
    expect(api.state.cloned).toMatchObject({ id: 'vol2', approved_by: 'Lucas', include_input: false, new_volume: { name: 'scratch-ks', size_gb: 50, datacenter: 'US-KS-2' } })
  })
  test('Clone from an S3 volume into a regular one: a pod on the target pulls; the Default button is an icon', async ({ page, api }) => {
    api.state.settings.s3_keys_set = true
    await page.goto('/')
    const dialog = await openVolumes(page)
    await expect(dialog.locator('[data-testid="volume"][data-id="vol2"]').getByTestId('volume-use-default')).toHaveAttribute('aria-label', 'Set as Default')   // an icon (a star) named Set as Default
    await dialog.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-clone').click()
    const m = page.getByTestId('volume-clone-modal')
    await m.getByTestId('volume-clone-to').selectOption('vol2')   // CA-MTL-1: no S3 API
    await expect(m.getByTestId('volume-clone-way')).toContainText('pulls')
    await m.getByTestId('volume-clone-kind-new').check()
    const groups = await m.getByTestId('volume-clone-dc').evaluate((el) => [...el.querySelectorAll('optgroup')].map((g) => ({ label: g.label, options: [...g.querySelectorAll('option')].map((o) => o.value) })))
    expect(groups).toEqual([{ label: 'S3 API: read and written without a pod', options: ['US-KS-2'] }, { label: 'No S3 API: a pod is needed', options: ['CA-MTL-1'] }])   // grouped: S3 first, then the rest
  })
})

test.describe('volumes: clone without S3', () => {
  test('without S3 keys a clone is RunPod to RunPod: a pod on each volume, over SSH; nothing is refused', async ({ page, api }) => {
    api.state.settings.s3_keys_set = false
    await page.goto('/')
    const dialog = await openVolumes(page)
    await dialog.locator('[data-testid="volume"][data-id="vol2"]').getByTestId('volume-clone').click()   // CA-MTL-1, no S3 API
    const m = page.getByTestId('volume-clone-modal')
    await m.getByTestId('volume-clone-to').selectOption('vol1')
    await expect(m.getByTestId('volume-clone-way')).toContainText('RunPod to RunPod')
    await expect(m.getByTestId('volume-clone-way')).toContainText('a short pod on each volume')
    await m.getByTestId('volume-clone-by').fill('Lucas')
    await expect(m.getByTestId('volume-clone-go')).toBeEnabled()   // it does not need S3
    await m.getByTestId('volume-clone-go').click()
    await expect(m.getByTestId('volume-clone-job')).toContainText('12 file')
  })
})

test.describe('volumes: browse and erase', () => {
  test('a volume the S3 API can read says it needs no pod', async ({ page }) => {
    await page.goto('/')
    const dialog = await openVolumes(page)
    await dialog.locator('[data-testid="volume"][data-id="vol2"]').getByTestId('volume-browse').click()
    await expect(page.getByTestId('volume-files-plan')).toContainText('no pod')
    await expect(page.getByTestId('volume-s3-note')).toHaveCount(0)
  })

  test('every action is an icon button with a name (tooltip and label), all one size and on one row', async ({ page }) => {
    for (const w of [1100, 700]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto('/')
      const dialog = await openVolumes(page)
      const row = dialog.locator('[data-testid="volume"][data-id="vol1"]')
      for (const id of ['volume-browse', 'volume-clone', 'volume-resize', 'volume-erase', 'volume-delete', 'volume-use-default', 'volume-set-shared']) {
        const b = row.getByTestId(id)
        if (!(await b.count())) continue
        expect((await b.boundingBox()).height, `${id} at ${w}px`).toBeLessThan(36)
        await expect(b).toHaveAttribute('aria-label', /.+/)   // an icon alone says nothing: the name is its accessible label
        await b.locator('..').hover(); await expect(page.locator('.app-tip')).toBeVisible()   // and hovering shows it at once, as a tooltip
        await expect(page.locator('.app-tip')).toHaveText(await b.getAttribute('aria-label'))
        await expect(b.locator('svg, i').first()).toBeVisible()
      }
    }
  })

  test('a listing that fails says why and offers Try Again, which lists again; it is never an endless spinner', async ({ page, api }) => {
    api.state.browseFails = 1
    await page.goto('/')
    const dialog = await openVolumes(page)
    await dialog.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-browse').click()
    const files = page.getByTestId('volume-files-modal')
    await files.getByTestId('volume-files-start').click()
    await expect(files.getByTestId('volume-files-error')).toContainText("RunPod's S3 did not answer in 90 s")
    await expect(files.getByTestId('volume-files-working')).toHaveCount(0)   // nothing keeps spinning
    await files.getByTestId('volume-files-retry').click()
    await expect(files.getByTestId('volume-files-row').first()).toBeVisible()   // the second try lists
    await expect(files.getByTestId('volume-files-error')).toHaveCount(0)
  })

  test('Browse lists a volume\'s folders with sizes; Erase needs folders, your name and the volume\'s name typed back, then reports what it freed', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openVolumes(page)
    await dialog.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-browse').click()
    const files = page.getByTestId('volume-files-modal')
    await expect(files.getByTestId('volume-files-plan')).toContainText('RTX 2000 Ada')   // where it runs and the price, before anything starts
    await expect(files.getByTestId('volume-s3-keys-alert')).toContainText('S3')   // this volume could be read through S3: it says so, with the reason, before a pod is started
    await expect(files.getByTestId('volume-files-start')).toContainText('Short Pod')   // and the button says a pod is what it starts
    await files.getByTestId('volume-add-s3-keys').click()
    await expect(page.locator('#cfg-s3-access')).toBeVisible()   // Add S3 keys opens Default Configuration at the key fields
    await page.getByTestId('config-close').first().click()
    await expect(files.getByTestId('volume-files-start')).toBeVisible()   // and the Browse window is still there
    await files.getByTestId('volume-files-start').click()
    await expect(files.getByTestId('volume-files-row')).toHaveCount(1)   // folders start closed: the top level only
    await expect(files.getByTestId('volume-files-summary')).toContainText('5.0 GB')
    await files.locator('[data-testid="volume-files-row"][data-path="/workspace/comfy-shared"] [data-testid="volume-files-toggle"]').click()   // open a folder
    await expect(files.getByTestId('volume-files-row')).toHaveCount(4)   // temp, output, models inside
    await expect(files.locator('[data-testid="volume-files-row"][data-path="/workspace/comfy-shared/temp"]')).toHaveAttribute('data-depth', '1')
    await files.locator('[data-testid="volume-files-row"][data-path="/workspace/comfy-shared/temp"] [data-testid="volume-files-toggle"]').click()
    const rounds = files.locator('[data-testid="volume-files-row"][data-path="/workspace/comfy-shared/temp/rounds"]')
    await expect(rounds).toContainText('3.0 GB')
    await expect(rounds.getByTestId('volume-files-inside')).toBeVisible()   // at the edge of what was listed: List inside
    await rounds.getByTestId('volume-files-inside').click()
    await expect(files.locator('[data-testid="volume-files-row"][data-path="/workspace/comfy-shared/temp/rounds/r1"]')).toBeVisible()   // the folder opens with what is in it
    await expect(files.locator('[data-testid="volume-files-row"][data-path="/workspace/comfy-shared/temp/rounds"]').getByTestId('volume-files-inside')).toHaveCount(0)
    await files.getByTestId('volume-files-collapse').click()
    await expect(files.getByTestId('volume-files-row')).toHaveCount(1)
    await files.getByTestId('volume-files-expand').click()
    await expect(files.getByTestId('volume-files-row').first()).toBeVisible()
    await files.getByText('Close', { exact: true }).click()
    await dialog.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-erase').click()
    const er = page.getByTestId('volume-erase-modal')
    await expect(er.locator('[data-testid="volume-erase-option"] input:checked')).toHaveCount(0)   // nothing is ticked for you
    await expect(er.getByTestId('volume-erase-go')).toBeDisabled()
    for (const k of ['rounds', 'inputs', 'workflows', 'output']) await er.locator(`[data-testid="volume-erase-option"][data-key="${k}"] input`).check()
    await er.getByTestId('volume-erase-by').fill('Lucas')
    await er.getByTestId('volume-erase-name').fill('wrong')
    await expect(er.getByTestId('volume-erase-go')).toBeDisabled()   // the name has to match exactly
    await er.getByTestId('volume-erase-scan').click()
    await expect(er.locator('[data-testid="volume-erase-option"][data-key="output"]').getByTestId('volume-erase-size')).toContainText('1.0 GB')
    await er.getByTestId('volume-erase-name').fill('comfy-workspace')
    await expect(er.getByTestId('volume-erase-go')).toBeEnabled()
    await er.getByTestId('volume-erase-go').click()
    await expect(er.getByTestId('volume-erase-job')).toContainText('Erased')
    expect(api.state.erased).toMatchObject({ id: 'vol1', keys: ['rounds', 'inputs', 'workflows', 'output'], approved_by: 'Lucas', confirm_name: 'comfy-workspace' })
  })
})

test.describe('volumes', () => {
  test('lists the account\'s volumes with cost, datacenter, S3 and the pods on each', async ({ page }) => {
    await page.goto('/')
    const dialog = await openVolumes(page)
    const v1 = dialog.locator('[data-testid="volume"][data-id="vol1"]')
    await expect(v1.getByTestId('volume-name')).toHaveText('comfy-workspace')
    await expect(v1.getByTestId('volume-facts')).toHaveText(t('volumes.facts', { size: 120, dc: 'EU-RO-1', cost: '8.40' }))
    await expect(v1.getByTestId('volume-s3')).toBeVisible()
    await expect(v1.getByTestId('volume-pod')).toHaveCount(2)
    await expect(v1.locator('[data-testid="volume-pod"][data-pod="pod-aaaaaaaa"]')).toContainText('ComfyUI-Dev · running')
    await expect(v1.locator('[data-testid="volume-pod"][data-pod="pod-cccccccc"]')).toContainText(t('volumes.configOnly'))
    await expect(v1.getByTestId('volume-delete')).toBeDisabled()   // a pod is attached
    const v2 = dialog.locator('[data-testid="volume"][data-id="vol2"]')
    await expect(v2.getByTestId('volume-pods')).toContainText(t('volumes.noPods'))
    await expect(v2.getByTestId('volume-s3')).toHaveCount(0)
  })

  test('use as default writes the volume and its datacenter into the Default Configuration', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openVolumes(page)
    await dialog.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-use-default').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.volumeDefault', { name: 'comfy-workspace', dc: 'EU-RO-1' }))
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/volumes/vol1/default')).toBe(true)
    await expect(dialog.locator('[data-testid="volume"][data-id="vol1"]').getByTestId('volume-default')).toBeVisible()
    expect(api.state.mounts.config.network_volume_id).toBe('vol1'); expect(api.state.mounts.config.data_center_id).toBe('EU-RO-1')
  })

  test('creates, grows and deletes a volume; deleting one with a pod is refused', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await openVolumes(page)
    await dialog.getByTestId('volume-new-name').fill('plates')
    await dialog.getByTestId('volume-new-size').fill('200')
    await dialog.getByTestId('volume-new-dc').selectOption('EU-RO-1')
    await dialog.getByTestId('volume-create').click()
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '/volumes').body).toEqual({ name: 'plates', size_gb: 200, datacenter: 'EU-RO-1' })
    const created = dialog.locator('[data-testid="volume"]').filter({ has: page.getByTestId('volume-name').filter({ hasText: 'plates' }) })
    await expect(created.getByTestId('volume-facts')).toContainText('200 GB in EU-RO-1')
    await created.getByTestId('volume-resize').click()
    await created.getByTestId('volume-resize-input').fill('300')
    await created.getByTestId('volume-resize-save').click()
    await expect(created.getByTestId('volume-facts')).toContainText('300 GB')
    await dialog.locator('[data-testid="volume"][data-id="vol2"]').getByTestId('volume-delete').click()
    await answerConfirm(page, true)
    await expect(dialog.locator('[data-testid="volume"][data-id="vol2"]')).toHaveCount(0)
    expect(api.calls.some((c) => c.method === 'DELETE' && c.path === '/volumes/vol2')).toBe(true)
  })
})
