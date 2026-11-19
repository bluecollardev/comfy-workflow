import { test, expect, podCard } from './fixtures'

// Outputs window: a text filter by file name (Lucas, 2026-11-19: 'to filter by filename'), and the Generate button (was Previews) opening a wider modal.
const run = (id, files, extra = {}) => ({ prompt_id: id, workflow: 'rounds/r1/archival-080/stereo.json', started_at: '2026-11-16T09:00:00Z', duration_s: 120, pod_id: 'pod-bbbbbbbb', pod_name: 'ComfyUI-Batch', volume_id: 'vol1', datacenter: 'EU-RO-1', recorded_at: '2026-11-16T09:02:00Z', files, ...extra })
const png = (filename, subfolder = '') => ({ filename, subfolder, type: 'output' })
const stopDev = (api) => { const dev = api.state.pods.find((p) => p.id === 'pod-aaaaaaaa'); dev.status = 'stopped'; dev.web_ui_url = null; dev.uptime_seconds = null }
const onVolume = (api) => { api.state.volumes.vol1.pods = [{ id: 'pod-bbbbbbbb', name: 'ComfyUI-Batch', status: 'stopped', via: 'config' }, { id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', status: api.state.pods[0].status, via: 'config' }] }

// saved runs (a pod's records outlive it), shown in the Batch pod's Outputs window
async function open(page, api, runs) {
  stopDev(api); onVolume(api)
  api.state.history.saved = runs
  await page.goto('/')
  await podCard(page, 'ComfyUI-Batch').getByTestId('pod-outputs').click()
  return page.getByTestId('pod-outputs-modal')
}

test('typing a file name narrows every run to the files that match, drops runs with none, counts, and Clear brings everything back', async ({ page, api }) => {
  const m = await open(page, api, [
    run('r1', [png('archival-080_a_00001_.png'), png('archival-080_b_00001_.png'), png('cgi-042_main_00001_.png')]),
    run('r2', [png('enhance-141_00001_.png')], { started_at: '2026-11-16T10:00:00Z' }),
  ])
  await expect(m.getByTestId('outputs-tile')).toHaveCount(4)
  const f = m.getByTestId('pod-outputs-name-filter')
  await f.fill('ARCHIVAL')                                               // case-insensitive
  await expect(m.getByTestId('outputs-tile')).toHaveCount(2)
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1)          // r2 has no match: its run is dropped
  await expect(m.getByTestId('pod-outputs-name-filter-count')).toContainText('2')
  await f.fill('archival b')                                             // every word must match
  await expect(m.getByTestId('outputs-tile')).toHaveCount(1)
  await f.fill('zzz-nothing')
  await expect(m.getByTestId('outputs-tile')).toHaveCount(0)
  await expect(m.getByTestId('pod-outputs-name-filter-count')).toContainText('0')
  await m.getByTestId('pod-outputs-name-filter-clear').click()
  await expect(f).toHaveValue('')
  await expect(m.getByTestId('outputs-tile')).toHaveCount(4)
  await expect(m.getByTestId('pod-outputs-name-filter-count')).toHaveCount(0)
})

test('the top-bar button is labelled Generate and opens a wide modal', async ({ page, api }) => {
  const m = await open(page, api, [run('r1', [png('a_00001_.png')])])
  const b = m.getByTestId('pod-outputs-previews')
  await expect(b).toContainText('Generate')
  await expect(b).not.toContainText('Previews')
  await b.click()
  const dlg = page.getByTestId('pod-outputs-previews-modal')
  await expect(dlg).toBeVisible()
  await expect(dlg.locator('.modal-dialog')).toHaveClass(/modal-xl/)
})
