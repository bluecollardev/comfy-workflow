import { test, expect, podCard } from './fixtures'
import { t } from './i18n'

// Saved outputs (docs/ADR-037 amendment 2026-11-17): a pod's runs outlive the pod. The core keeps a record of the files each run wrote
// (output-runs.json); the card's Outputs button and the gallery merge it with the running pod's own history.
const saved = (id, extra = {}) => ({ prompt_id: id, workflow: 'rounds/r1/archival-080/stereo.json', started_at: '2026-11-16T09:00:00Z', duration_s: 120, pod_id: 'pod-bbbbbbbb', pod_name: 'ComfyUI-Batch', volume_id: 'vol1', datacenter: 'EU-RO-1', recorded_at: '2026-11-16T09:02:00Z',
  files: [{ filename: `${id}_00001_.png`, subfolder: 'archival-080', type: 'output' }, { filename: `${id}_00002_.png`, subfolder: 'archival-080', type: 'output' }], ...extra })
const stopDev = (api) => { const dev = api.state.pods.find((p) => p.id === 'pod-aaaaaaaa'); dev.status = 'stopped'; dev.web_ui_url = null; dev.uptime_seconds = null }
const onVolume = (api) => { api.state.volumes.vol1.pods = [{ id: 'pod-bbbbbbbb', name: 'ComfyUI-Batch', status: 'stopped', via: 'config' }, { id: 'pod-aaaaaaaa', name: 'ComfyUI-Dev', status: api.state.pods[0].status, via: 'config' }, { id: 'pod-cccccccc', name: 'ComfyUI-Test', status: 'starting', via: 'config' }] }

test('a stopped pod with saved runs has an enabled Outputs button; with no running pod on the volume the gallery lists the runs, marks them saved and says to start a pod', async ({ page, api }) => {
  stopDev(api); onVolume(api)
  api.state.history.saved = [saved('aaaa1111-0000'), saved('bbbb2222-0000', { started_at: '2026-11-16T10:00:00Z' })]
  await page.goto('/')
  const batch = podCard(page, 'ComfyUI-Batch')
  await expect(batch.getByTestId('pod-outputs')).toBeEnabled()
  await batch.getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(2)
  await expect(m.getByTestId('pod-outputs-run').first()).toHaveAttribute('data-prompt', 'bbbb2222-0000')   // newest first
  await expect(m.getByTestId('pod-outputs-saved')).toHaveCount(2)
  await expect(m.getByTestId('pod-outputs-workflow').first()).toHaveText('stereo')
  await expect(m.getByTestId('pod-outputs-offline')).toContainText(t('outputs.startPod', { volume: 'comfy-workspace' }))
  await expect(m.getByTestId('pod-outputs-offline')).toContainText('comfy-workspace')
  await expect(m.getByTestId('outputs-tile')).toHaveCount(4)
  await expect(m.getByTestId('outputs-tile').first()).toBeDisabled()   // no preview, open or download
  await expect(m.getByTestId('outputs-zip').first()).toBeDisabled()
  await expect(m.locator('img')).toHaveCount(0)   // nothing asked a pod for a file
  await m.getByTestId('outputs-tile').first().click({ force: true })
  await expect(page.getByTestId('output-viewer')).toHaveCount(0)
})

test('a pod on the same volume lists the volume\'s saved runs (by volume, not only by pod)', async ({ page, api }) => {
  onVolume(api)
  api.state.history.saved = [saved('cccc3333-0000', { pod_id: 'pod-gone', pod_name: 'Deleted-pod' })]   // made by a pod that no longer exists
  api.state.history.runs['pod-aaaaaaaa'] = []
  await page.goto('/')
  await expect(podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs')).toBeEnabled()
  await expect(podCard(page, 'ComfyUI-Test').getByTestId('pod-outputs')).toBeEnabled()   // on vol1 too, though it is still starting
})

test('a stopped pod uses another running pod on the same volume as the address of its files', async ({ page, api }) => {
  onVolume(api)   // ComfyUI-Dev runs on the volume with the stopped ComfyUI-Batch
  api.state.history.saved = [saved('dddd4444-0000')]
  await page.goto('/')
  await podCard(page, 'ComfyUI-Batch').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('pod-outputs-offline')).toHaveCount(0)
  await expect(m.getByTestId('pod-outputs-saved')).toHaveCount(1)
  const img = m.locator('img').first()
  await expect(img).toHaveAttribute('src', /^https:\/\/pod-a\.proxy\.runpod\.io:8188\/view\?filename=dddd4444-0000_00001_\.png&subfolder=archival-080&type=output/)
  await expect(m.getByTestId('outputs-tile').first()).toBeEnabled()
})

test('a live run replaces its saved copy (same prompt_id) and loses the saved badge', async ({ page, api }) => {
  api.state.history.saved = [saved('abcdef12-3456-7890', { pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev' }), saved('eeee5555-0000', { pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', started_at: '2026-11-02T09:00:00Z' })]
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(2)
  await expect(m.locator('[data-prompt="abcdef12-3456-7890"]').getByTestId('pod-outputs-saved')).toHaveCount(0)   // live wins
  await expect(m.locator('[data-prompt="abcdef12-3456-7890"]').getByTestId('outputs-tile')).toHaveCount(1)   // the live run's own file list, not the two saved ones
  await expect(m.locator('[data-prompt="eeee5555-0000"]').getByTestId('pod-outputs-saved')).toHaveCount(1)
})
