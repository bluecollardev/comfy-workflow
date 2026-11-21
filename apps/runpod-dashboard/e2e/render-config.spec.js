import { readFileSync } from 'node:fs'
import { test, expect, podCard, modal, cfgTab } from './fixtures'
import { t } from './i18n'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// Render sequences settings in the configuration (docs/ADR-048): the Default Configuration and a pod's own configuration carry an optional `render`; the Render option of the Previews window starts from plan().settings.
const calls = (api, method, path) => api.calls.filter((c) => c.method === method && c.path === path)
const DEFAULTS = { where: 'auto', kind: 'proxy', proxy_width: 'source', review_width: 'source', codecs: ['prores422hq'], fps: 'auto', pull: true }
const openDefault = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'options'); return d }
const openPod = async (page) => { await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click(); const d = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' })); await cfgTab(d, 'options'); return d }

test.describe('Default Configuration', () => {
  test('the section loads with the defaults and its help line', async ({ page }) => {
    const d = await openDefault(page)
    const s = d.getByTestId('config-render')
    await s.scrollIntoViewIfNeeded()
    await expect(s.getByTestId('config-render-where')).toHaveValue('auto')
    await expect(s.getByTestId('config-render-kind-review')).toBeChecked(); await expect(s.getByTestId('config-render-kind-proxy')).not.toBeChecked()   // Review video is the default
    await expect(s.getByTestId('config-render-colour')).toHaveValue(''); await expect(s.getByTestId('config-render-colour').locator('option').first()).toHaveText('Project default: Gamma 2.6 P3-D65')   // nobody has to set the colour
    await expect(s.getByTestId('config-render-proxy-width')).toHaveValue('source')
    await expect(s.getByTestId('config-render-review-width')).toHaveValue('source')
    await expect(s.getByTestId('config-render-codec-prores')).toBeChecked(); await expect(s.getByTestId('config-render-codec-h264')).not.toBeChecked()   // ProRes is the default
    await expect(s.getByTestId('config-render-fps')).toHaveValue('auto')
    await expect(s.getByTestId('config-render-pull')).not.toBeChecked()   // Sync the renders to this PC: unticked by default
    await expect(s.getByTestId('config-render-publish-s3')).toBeChecked(); await expect(s.getByTestId('config-render-publish-slack')).not.toBeChecked(); await expect(s.getByTestId('config-render-skip-existing')).toBeChecked()   // Publish to S3 is pre-ticked (the core default)
    await expect(s.getByTestId('config-render-pre-help')).toHaveText('These only pre-tick the boxes in the Generate window. Every publish still asks who says yes.'); await expect(s.getByTestId('config-render-skip-help')).toHaveText('Starting values of the Generate window')
    await expect(s.getByTestId('config-render-help')).toHaveText(t('outputs.render.cfg.help'))
    await expect(s.getByTestId('config-render-help')).toContainText('A review video always asks who says yes.')
    await expect(s.getByTestId('config-render-fps').locator('option')).toHaveText(['Auto (from the file name)', '23.976 fps', '24 fps', '25 fps', '30 fps'])
    await expect(s.getByTestId('config-render-proxy-width').locator('option')).toHaveText(['Source resolution', '1920 px', '1280 px', '960 px'])
  })
  test('an untouched Default Configuration saves with no render key', async ({ page, api }) => {
    const d = await openDefault(page)
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body).not.toHaveProperty('render')
  })
  test('a change saves as render, reloads, is in the export, and survives a second save', async ({ page, api }) => {
    let d = await openDefault(page)
    await d.getByTestId('config-render-where').selectOption('local')
    await d.getByTestId('config-render-kind-review').check()
    await d.getByTestId('config-render-proxy-width').selectOption('1280')
    await d.getByTestId('config-render-review-width').selectOption('1920')
    await d.getByTestId('config-render-codec-h264').check()
    await d.getByTestId('config-render-fps').selectOption('23.976')
    await d.getByTestId('config-render-pull').check()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    const want = { where: 'local', kind: 'review', proxy_width: 1280, review_width: 1920, codecs: ['prores422hq', 'h264'], fps: 23.976, pull: true }   // publish and skip_existing were not touched: not sent
    expect(calls(api, 'PUT', '/mounts')[0].body.render).toEqual(want)
    expect(api.state.mounts.config.render).toEqual(want)
    await page.reload(); await page.getByTestId('open-config').click()
    d = modal(page, t('config.title')); await cfgTab(d, 'options')
    await expect(d.getByTestId('config-render-where')).toHaveValue('local'); await expect(d.getByTestId('config-render-kind-review')).toBeChecked()
    await expect(d.getByTestId('config-render-proxy-width')).toHaveValue('1280'); await expect(d.getByTestId('config-render-review-width')).toHaveValue('1920')
    await expect(d.getByTestId('config-render-codec-h264')).toBeChecked(); await expect(d.getByTestId('config-render-fps')).toHaveValue('23.976'); await expect(d.getByTestId('config-render-pull')).toBeChecked()
    const [download] = await Promise.all([page.waitForEvent('download'), d.getByTestId('cfg-io-export').click()])
    expect(JSON.parse(readFileSync(await download.path(), 'utf8')).config.render).toEqual(want)
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts').at(-1).body.render).toEqual(want)   // loaded with it: saved with it
  })
  test('no codec ticked is refused inline before any call', async ({ page, api }) => {
    const d = await openDefault(page)
    await d.getByTestId('config-render-codec-prores').uncheck()
    await d.getByTestId('config-save').click()
    await expect(d.getByTestId('config-render-error')).toHaveText(t('outputs.render.cfg.needCodec'))
    expect(calls(api, 'PUT', '/mounts')).toHaveLength(0)
    await d.getByTestId('config-render-codec-h264').check()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body.render.codecs).toEqual(['h264'])
  })
  test('the core\'s 400 for a bad value is shown', async ({ page, api }) => {
    const d = await openDefault(page)
    await d.getByTestId('config-render-fps').selectOption('25')
    await page.route('**/mounts', (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 400, json: { detail: 'render: pick at least one codec and a size from the list' } }) : r.fallback()))
    await d.getByTestId('config-save').click()
    await expect(d.getByTestId('config-error')).toContainText('render: pick at least one codec')
  })
})

test.describe('a pod\'s own configuration', () => {
  test('starts from the Default\'s values, saves its own change, and keeps it when reopened', async ({ page, api }) => {
    api.state.mounts.config.render = { ...DEFAULTS, where: 'pod', fps: 25 }
    let p = await openPod(page)
    await expect(p.getByTestId('config-render-where')).toHaveValue('pod'); await expect(p.getByTestId('config-render-fps')).toHaveValue('25')   // started from the default, like every field
    await p.getByTestId('config-render-kind-review').check()
    await p.getByTestId('config-apply').click(); await expect(p).toBeHidden()
    expect(api.state.podConfigs['pod-aaaaaaaa'].render).toMatchObject({ where: 'pod', kind: 'review', fps: 25 })
    await page.reload(); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click()
    p = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' })); await cfgTab(p, 'options')
    await expect(p.getByTestId('config-render-kind-review')).toBeChecked()
  })
  test('an untouched pod configuration adds no render key; no codec is refused inline', async ({ page, api }) => {
    const p = await openPod(page)
    await expect(p.getByTestId('config-render')).toBeVisible()
    await p.getByTestId('config-render-codec-prores').uncheck(); await p.getByTestId('config-apply').click()
    await expect(p.getByTestId('config-render-error')).toBeVisible()
    await p.getByTestId('config-render-codec-prores').check(); await p.getByTestId('config-apply').click(); await expect(p).toBeHidden()
    expect(calls(api, 'POST', '/mounts/preview').at(-1).body).not.toHaveProperty('render')
  })
})

test.describe('the Render option starts from plan().settings', () => {
  const px = makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
  async function open(page, api, renders) {
    api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'rrrrrrrr-1111-2222', workflow: 'rounds/r1/render.json', status: 'success', started_at: '2026-11-18T10:00:00Z', duration_s: 5, cost_estimate: 0, outputs: [0, 1].map((n) => ({ filename: `s1_proxy.${String(n).padStart(4, '0')}.dpx`, subfolder: 'seqs/s1', type: 'output' })) })
    api.state.renders = renders
    await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }))
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
    await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Render Sequences' }).click()
    return page.getByTestId('pod-outputs-previews-modal')
  }
  test('a pod\'s own settings prefill every choice, say so, and the run\'s changes are sent but never saved', async ({ page, api }) => {
    const p = await open(page, api, { settings: { where: 'pod', kind: 'review', proxy_width: 1280, review_width: 1920, codecs: ['h264', 'prores422hq'], fps: 25, pull: false }, settingsSource: 'pod' })
    await expect(p.getByTestId('pod-outputs-render-settings')).toHaveText('Using this pod\'s settings')
    await expect(p.getByTestId('pod-outputs-render-where')).toHaveValue('pod'); await expect(p.getByTestId('pod-outputs-render-kind-review')).toBeChecked()
    await expect(p.getByTestId('pod-outputs-render-width')).toHaveValue('1920'); await expect(p.getByTestId('pod-outputs-render-fps')).toHaveValue('25')
    await expect(p.getByTestId('pod-outputs-render-codec-prores')).toBeChecked(); await expect(p.getByTestId('pod-outputs-render-pull')).not.toBeChecked()
    await p.getByTestId('pod-outputs-render-approved-by').fill('Brynley'); await p.getByTestId('pod-outputs-render-fps').selectOption('30')
    await p.getByTestId('pod-outputs-render-start').click()
    await expect.poll(() => api.state.renders.started.length).toBe(1)
    expect(api.state.renders.started[0]).toMatchObject({ where: 'pod', kind: 'review', width: 1920, fps: 30, pull: false, codecs: ['h264', 'prores422hq'] })
    expect(calls(api, 'PUT', '/mounts')).toHaveLength(0); expect(calls(api, 'PUT', '/pods/pod-aaaaaaaa/config')).toHaveLength(0)   // per run only
  })
  test('the default settings prefill a quick proxy and say so', async ({ page, api }) => {
    const p = await open(page, api, { settings: { ...DEFAULTS, proxy_width: 960, fps: 24 }, settingsSource: 'default' })
    await expect(p.getByTestId('pod-outputs-render-settings')).toHaveText('Using the default settings')
    await expect(p.getByTestId('pod-outputs-render-width')).toHaveValue('960'); await expect(p.getByTestId('pod-outputs-render-fps')).toHaveValue('24')
    await expect(p.getByTestId('pod-outputs-render-downscale-hint')).toBeVisible()
  })
})

test.describe('Render: Sync, Publish and Skip existing as starting values; Outputs window', () => {
  test('the dependencies are enforced inline: Slack needs S3; publishing does NOT need Sync (a render left on the pod is published from the volume)', async ({ page }) => {
    const d = await openDefault(page)
    const s = d.getByTestId('config-render'); await s.scrollIntoViewIfNeeded()
    await expect(s.getByTestId('config-render-needsync')).toHaveCount(0)
    await expect(s.getByTestId('config-render-publish-s3')).toBeChecked(); await expect(s.getByTestId('config-render-publish-slack')).toBeEnabled()   // S3 is pre-ticked, so Slack can be
    await s.getByTestId('config-render-publish-s3').uncheck(); await expect(s.getByTestId('config-render-publish-slack')).toBeDisabled()   // Slack needs S3
    await s.getByTestId('config-render-pull').uncheck()
    await s.getByTestId('config-render-publish-s3').check(); await expect(s.getByTestId('config-render-publish-slack')).toBeEnabled(); await s.getByTestId('config-render-publish-slack').check()
    await s.getByTestId('config-render-publish-s3').uncheck(); await expect(s.getByTestId('config-render-publish-slack')).not.toBeChecked()   // S3 off takes Slack with it
    await s.getByTestId('config-render-publish-s3').check(); await expect(s.getByTestId('config-render-pull')).not.toBeChecked(); await expect(s.getByTestId('config-render-publish-s3')).toBeChecked()   // S3 on with Sync off stays on
  })
  test('the colour field: the project default untouched sends nothing; a colour saves as render.colour (format) and the project default goes back to known', async ({ page, api }) => {
    let d = await openDefault(page)
    const s = d.getByTestId('config-render'); await s.scrollIntoViewIfNeeded()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body).not.toHaveProperty('render')   // untouched: no render key at all
    d = await openDefault(page); const s2 = d.getByTestId('config-render'); await s2.scrollIntoViewIfNeeded()
    await s2.getByTestId('config-render-colour').selectOption('p3-d65-srgb')
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[1].body.render.colour).toMatchObject({ mode: 'format', format: 'p3-d65-srgb' })
    d = await openDefault(page); const s3 = d.getByTestId('config-render'); await s3.scrollIntoViewIfNeeded()
    await expect(s3.getByTestId('config-render-colour')).toHaveValue('p3-d65-srgb')   // it reloads
    await s3.getByTestId('config-render-colour').selectOption('')   // back to the project default
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[2].body.render.colour).toEqual({ mode: 'known' })
  })
  test('Save carries pull, publish and skip_existing as render keys; an untouched config sends no render key', async ({ page, api }) => {
    const d = await openDefault(page)
    const s = d.getByTestId('config-render'); await s.scrollIntoViewIfNeeded()
    await s.getByTestId('config-render-pull').check(); await s.getByTestId('config-render-publish-s3').check(); await s.getByTestId('config-render-publish-slack').check(); await s.getByTestId('config-render-skip-existing').uncheck()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body.render).toMatchObject({ pull: true, publish: { s3: true, slack: true }, skip_existing: false })
    expect(api.state.mounts.config.render.publish).toEqual({ s3: true, slack: true })
  })
  test('a configuration with older render keys saves without the new keys until they change', async ({ page, api }) => {
    api.state.mounts.config.render = { where: 'pod', kind: 'proxy', proxy_width: 'source', review_width: 'source', codecs: ['prores422hq'], fps: 'auto' }
    const d = await openDefault(page)
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    const r = calls(api, 'PUT', '/mounts')[0].body.render
    expect(r).not.toHaveProperty('pull'); expect(r).not.toHaveProperty('publish'); expect(r).not.toHaveProperty('skip_existing'); expect(r.where).toBe('pod')
  })
  test('Default Configuration: the Outputs window section (Hide empty folders by default, ticked, with its help); untouched sends no outputs key; unticking saves it and it loads again', async ({ page, api }) => {
    let d = await openDefault(page)
    const o = d.getByTestId('config-outputs'); await o.scrollIntoViewIfNeeded()
    await expect(o.getByTestId('config-outputs-hide-empty')).toBeChecked(); await expect(o.getByTestId('config-outputs-help')).toHaveText('Starting value of the Outputs window')
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body).not.toHaveProperty('outputs')
    d = await openDefault(page)
    await d.getByTestId('config-outputs-hide-empty').uncheck(); await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts').at(-1).body.outputs).toEqual({ hide_empty_folders: false })
    d = await openDefault(page)
    await expect(d.getByTestId('config-outputs-hide-empty')).not.toBeChecked()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts').at(-1).body.outputs).toEqual({ hide_empty_folders: false })   // loaded with it: saved with it
  })
  test('Default Configuration: the Prepare For Delivery section (ADR-055 section 12): the defaults show, untouched sends no delivery_prepare key, a change saves the whole block and loads again; a pod\'s own configuration has none', async ({ page, api }) => {
    let d = await openDefault(page)
    const b = d.getByTestId('config-delivery'); await b.scrollIntoViewIfNeeded()
    await expect(b.getByTestId('config-delivery-out-dir')).toHaveValue('_delivery_v11'); await expect(b.getByTestId('config-delivery-gamma')).toHaveValue('2.6')
    await expect(b.getByTestId('config-delivery-colour-code')).toHaveValue('user-defined'); await expect(b.getByTestId('config-delivery-tc-source')).toHaveValue('edl'); await expect(b.getByTestId('config-delivery-skip-existing')).not.toBeChecked()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body).not.toHaveProperty('delivery_prepare')
    d = await openDefault(page)
    await d.getByTestId('config-delivery-gamma').fill('2.4'); await d.getByTestId('config-delivery-out-dir').fill('handover_a'); await d.getByTestId('config-delivery-skip-existing').check()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts').at(-1).body.delivery_prepare).toEqual({ out_dir: 'handover_a', colour_code: 'user-defined', gamma: 2.4, fps_source: 'clip-name', fps: 23.976, timecode_source: 'edl', frame_position: 'set', skip_existing: true })
    d = await openDefault(page)
    await expect(d.getByTestId('config-delivery-gamma')).toHaveValue('2.4'); await expect(d.getByTestId('config-delivery-out-dir')).toHaveValue('handover_a'); await expect(d.getByTestId('config-delivery-skip-existing')).toBeChecked()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts').at(-1).body.delivery_prepare.gamma).toBe(2.4)   // loaded with it: saved with it
    const p = await openPod(page); await expect(p.getByTestId('config-delivery')).toHaveCount(0)
  })
  test('a pod\'s own configuration has the render checkboxes (including Skip existing) but no Outputs section', async ({ page }) => {
    const d = await openPod(page)
    await expect(d.getByTestId('config-render-skip-existing')).toBeVisible(); await expect(d.getByTestId('config-render-publish-s3')).toBeVisible()
    await expect(d.getByTestId('config-outputs')).toHaveCount(0)
  })
})
