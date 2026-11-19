import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// "Use the system settings as defaults": the Generate window starts Sync, Publish, Post to Slack and Skip existing from the configuration, the Outputs window starts Hide empty folders from it; per-run changes are never saved.
const px = makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const frame = (n) => `s_proxy.${String(n).padStart(4, '0')}.dpx`
const calls = (api, method, path) => api.calls.filter((c) => c.method === method && c.path === path)
const PUBLISHED = { s3: { bucket: 'beinghuman-deliveries', prefix: 'returns/BKK/', region: 'eu-west-1', endpoint: '', credentials: 'app', access_key_hint: '••••1234', presign_hours: 72 }, slack: { workspace_name: 'Beinghuman', workspace_url: 'https://beinghuman-hq.slack.com', channel: '#deliveries', username: 'RunPod Manager', webhook_hint: '••••9f2k' }, defaults: { targets: ['s3'], message: '{shot}' } }
const BASE = { where: 'pod', kind: 'proxy', proxy_width: 'source', review_width: 'source', codecs: ['prores422hq'], fps: 'auto' }
async function open(page, api, { settings, mountsRender, outputs, noPlanSettings } = {}) {
  api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'sd000000-1111', workflow: 'x.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 5, cost_estimate: 0, outputs: [0, 1, 2].map((n) => ({ filename: frame(n), subfolder: 'seqs/a', type: 'output' })) })
  api.state.publish = { settings: JSON.parse(JSON.stringify(PUBLISHED)), tree: {}, there: [], heavy: [], jobs: [] }
  if (settings && !noPlanSettings) api.state.renders = { settings: { ...BASE, ...settings }, settingsSource: 'default' }
  if (mountsRender) api.state.mounts.config.render = mountsRender
  if (outputs) api.state.mounts.config.outputs = outputs
  await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }).catch(() => {}))
  await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal'); await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(1)
  return m
}
const openGen = async (page) => { await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Render Sequences' }).click(); const g = page.getByTestId('pod-outputs-previews-modal'); await expect(g.getByTestId('pod-outputs-render')).toBeVisible(); return g }

test.describe('the Generate window starts from the configuration', () => {
  test('Sync, S3 and Slack are unticked unless the configuration says so; Skip existing starts from skip_existing (previews and render share it); older keys fall back', async ({ page, api }) => {
    await open(page, api, { settings: { pull: false, publish: { s3: false, slack: false }, skip_existing: false } })
    const g = await openGen(page)
    await expect(g.getByTestId('pod-outputs-render-pull')).not.toBeChecked(); await expect(g.getByTestId('pod-outputs-render-publish-s3')).not.toBeChecked(); await expect(g.getByTestId('pod-outputs-render-publish-slack')).not.toBeChecked()
    await expect(g.getByTestId('pod-outputs-previews-skip-existing')).not.toBeChecked(); await expect(g.getByTestId('pod-outputs-render-skip-existing')).not.toBeChecked()
    await expect(g.getByTestId('pod-outputs-render-publish-needsync')).toHaveCount(0)   // publishing no longer waits for Sync: a render left on the pod is published from the volume
  })
  test('the shipped defaults: Review video, Publish to S3 ticked, Sync the renders to this PC unticked', async ({ page, api }) => {
    await open(page, api, { settings: { kind: 'review', pull: false, publish: { s3: true, slack: false }, codecs: ['prores422hq'], skip_existing: true } })
    const g = await openGen(page)
    await expect(g.getByTestId('pod-outputs-render-kind-review')).toBeChecked(); await expect(g.getByTestId('pod-outputs-render-kind-proxy')).not.toBeChecked()
    await expect(g.getByTestId('pod-outputs-render-publish-s3')).toBeChecked(); await expect(g.getByTestId('pod-outputs-render-pull')).not.toBeChecked(); await expect(g.getByTestId('pod-outputs-render-publish-slack')).not.toBeChecked()
  })
  test('skip_existing true starts ticked in both; per-run changes are never saved (no PUT anywhere)', async ({ page, api }) => {
    await open(page, api, { settings: { pull: false, publish: { s3: false, slack: false }, skip_existing: true } })
    const g = await openGen(page)
    await expect(g.getByTestId('pod-outputs-render-skip-existing')).toBeChecked(); await g.getByRole('tab', { name: 'Previews' }).click(); await expect(g.getByTestId('pod-outputs-previews-skip-existing')).toBeChecked()
    await g.getByRole('tab', { name: 'Render Sequences' }).click(); await g.getByTestId('pod-outputs-render-pull').check(); await g.getByTestId('pod-outputs-render-publish-s3').check()
    await g.getByRole('tab', { name: 'Previews' }).click(); await g.getByTestId('pod-outputs-previews-skip-existing').uncheck()
    await g.getByRole('tab', { name: 'Render Sequences' }).click(); await expect(g.getByTestId('pod-outputs-render-skip-existing')).not.toBeChecked()
    expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
    expect(calls(api, 'PUT', '/mounts')).toHaveLength(0)
  })
  test('before the plan arrives Skip existing comes from the Default Configuration; with neither it is ticked (as before)', async ({ page, api }) => {
    await open(page, api, { mountsRender: { ...BASE, pull: false, skip_existing: false } })   // no plan settings
    let g = await openGen(page)
    await expect(g.getByTestId('pod-outputs-previews-skip-existing')).not.toBeChecked()
  })
  test('with nothing configured: ticked, and an older core keeps Sync ticked and sends pull explicitly', async ({ page, api }) => {
    await open(page, api, { settings: { pull: true }, noPlanSettings: false })
    const g = await openGen(page)
    await expect(g.getByTestId('pod-outputs-previews-skip-existing')).toBeChecked()
    await expect(g.getByTestId('pod-outputs-render-pull')).toBeChecked()   // settings without the publish key: an older core
  })
  test('a configuration with publish.s3 true pre-ticks S3 (Sync ticked) and still needs the name before Start; the start carries pull, publish and the name', async ({ page, api }) => {
    await open(page, api, { settings: { pull: true, publish: { s3: true, slack: false }, skip_existing: true } })
    await page.addInitScript(() => { try { localStorage.removeItem('runpod-manager.approved-by') } catch { /* none */ } })
    const g = await openGen(page)
    await expect(g.getByTestId('pod-outputs-render-pull')).toBeChecked(); await expect(g.getByTestId('pod-outputs-render-publish-s3')).toBeChecked(); await expect(g.getByTestId('pod-outputs-render-publish-slack')).not.toBeChecked()
    await expect(g.getByTestId('pod-outputs-render-publish-approved-hint')).toHaveText('Publishing needs who says yes')
    await expect(g.getByTestId('pod-outputs-render-start')).toBeDisabled()
    await g.getByTestId('pod-outputs-render-approved-by').fill('Brynley')
    await expect(g.getByTestId('pod-outputs-render-start')).toBeEnabled()
    await g.getByTestId('pod-outputs-render-start').click()
    await expect.poll(() => api.state.renders.started.length).toBe(1)
    expect(api.state.renders.started[0]).toMatchObject({ pull: true, publish: { targets: ['s3'] }, approved_by: 'Brynley' })
  })
  test('a configured Slack needs S3: S3 and Slack both pre-ticked; unticking S3 takes Slack with it', async ({ page, api }) => {
    await open(page, api, { settings: { pull: true, publish: { s3: true, slack: true } } })
    const g = await openGen(page)
    await expect(g.getByTestId('pod-outputs-render-publish-slack')).toBeChecked()
    await g.getByTestId('pod-outputs-render-publish-s3').uncheck(); await expect(g.getByTestId('pod-outputs-render-publish-slack')).not.toBeChecked()
  })
  test('with Sync unticked a start sends no publish and pull false explicitly', async ({ page, api }) => {
    await open(page, api, { settings: { pull: false, publish: { s3: false, slack: false } } })
    const g = await openGen(page)
    await g.getByTestId('pod-outputs-render-start').click()
    await expect.poll(() => api.state.renders.started.length).toBe(1)
    const b = api.state.renders.started[0]; expect(b.pull).toBe(false); expect(b).not.toHaveProperty('publish')
  })
})

test.describe('the Outputs window starts Hide empty folders from the configuration', () => {
  const FILES = [{ key: 'a/x/x.png', bytes: 10, modified: '2026-11-15T08:00:00' }, { key: 'empty_one/e.png', bytes: 0, modified: '2026-11-15T08:00:00' }]
  async function openVol(page, api, outputs) {
    for (const p of api.state.pods) { p.status = 'stopped'; p.web_ui_url = null; p.uptime_seconds = null }
    api.state.history.runs = {}; api.state.s3Outputs = { files: FILES, folderInfo: { empty_one: { empty: true } } }
    if (outputs) api.state.mounts.config.outputs = outputs
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
    const m = page.getByTestId('pod-outputs-modal'); await expect(m.getByTestId('pod-outputs-volume')).toBeVisible(); return m
  }
  test('false: unticked and the empty folder is listed; true or missing (an older core): ticked and hidden; a change stays with the window and is not saved', async ({ page, api }) => {
    let m = await openVol(page, api, { hide_empty_folders: false })
    await expect(m.getByTestId('pod-outputs-hide-empty')).not.toBeChecked(); await expect(m.getByTestId('pod-outputs-folder')).toHaveCount(2)
    await m.getByTestId('pod-outputs-hide-empty').check(); await expect(m.getByTestId('pod-outputs-folder')).toHaveCount(1)
    expect(calls(api, 'PUT', '/mounts')).toHaveLength(0)
    await m.locator('.btn-close').click()
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()   // reopened: the configuration's value again
    m = page.getByTestId('pod-outputs-modal'); await expect(m.getByTestId('pod-outputs-hide-empty')).not.toBeChecked()
  })
  test('true and an older core without the key: ticked', async ({ page, api }) => {
    let m = await openVol(page, api, { hide_empty_folders: true })
    await expect(m.getByTestId('pod-outputs-hide-empty')).toBeChecked(); await expect(m.getByTestId('pod-outputs-folder')).toHaveCount(1)
    await page.goto('about:blank')
  })
  test('no outputs key at all: ticked', async ({ page, api }) => {
    const m = await openVol(page, api)
    await expect(m.getByTestId('pod-outputs-hide-empty')).toBeChecked()
  })
})
