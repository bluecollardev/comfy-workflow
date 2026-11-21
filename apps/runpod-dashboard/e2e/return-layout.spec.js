import { test, expect, podCard, modal, cfgTab, queueTab } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'
import { t } from './i18n'

// The BKK return layout, the manifest and the Tunnel proxy (docs/ADR-050, Kyle 2026-11-19, v1.6.2). The core is faked (state.publish.layoutSupport, state.renders.settings.preset); an older core has none of it.
const GB = 1e9
const CONFIGURED = { s3: { bucket: 'bh-panama-exchange-610140802195', prefix: 'returns/BKK/', region: 'us-west-2', endpoint: '', credentials: 'panama', access_key_hint: '', presign_hours: 72 }, slack: { workspace_name: 'Beinghuman', workspace_url: 'https://beinghuman-hq.slack.com', channel: '#deliveries', username: 'RunPod Manager', webhook_hint: '••••9f2k' }, defaults: { targets: ['s3'], message: '{shot}' } }
const f = (n, dir, b = GB) => ({ name: n, path: `${dir}/${n}`, dir: false, bytes: b })
const STEM = 'ARCHIVAL-077_A_FINAL_V03'
const TREE = {
  '': [{ name: 'deliver', path: 'deliver', dir: true }],
  deliver: [{ name: 'a', path: 'deliver/a', dir: true }],
  'deliver/a': [f(`${STEM}.0001.dpx`, 'deliver/a'), f(`${STEM}.0002.dpx`, 'deliver/a'), f(`${STEM}.mp4`, 'deliver/a'), f('notes.txt', 'deliver/a', 100)],
}
const setup = (api, o = {}) => { api.state.publish = { settings: JSON.parse(JSON.stringify(CONFIGURED)), tree: JSON.parse(JSON.stringify(TREE)), there: [], heavy: [], jobs: [], layoutSupport: true, rounds: [{ name: 'qc_2026-11-02_r01' }, { name: 'depth-105_h3_iterations_2026-11-03_r01' }], ...o } }
const openModal = async (page) => { await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); await page.getByTestId('pod-outputs-publish').click(); const m = page.getByTestId('publish-modal'); await expect(m).toBeVisible(); await m.getByTestId('publish-source-local').click(); await m.getByTestId('publish-quick-deliver').click(); await expect(m.getByTestId('publish-entry').first()).toBeVisible(); return m }
const tick = (m, p) => m.locator(`[data-testid="publish-entry-check"][data-path="${p}"]`)
const pickAll = async (m) => { await tick(m, 'deliver/a').check() }

test.describe('Publish files: the return layout', () => {
  test('a Round is required and checked; the suggestions come from the bucket; the destination and the manifest line say where things go', async ({ page, api }) => {
    setup(api)
    const m = await openModal(page); await pickAll(m); await m.getByTestId('publish-approved-by').fill('Brynley')
    await expect(m.getByTestId('publish-round')).toBeVisible(); await expect(m.getByTestId('publish-round-hint')).toHaveText('Publishing to a return needs a round name')
    await expect(m.getByTestId('publish-run')).toBeDisabled()
    await expect(m.getByTestId('publish-round-suggestion')).toHaveCount(2); await expect(m.getByTestId('publish-round-suggestion').first()).toHaveAttribute('value', 'qc_2026-11-02_r01')
    await expect(m.getByTestId('publish-return-dest')).toHaveText('returns/BKK/<round>/<shot>/<clip>/…')
    await m.getByTestId('publish-round').fill('ab'); await expect(m.getByTestId('publish-round-error')).toHaveText('A round name is 3 to 100 letters, digits, dots, dashes or underscores.'); await expect(m.getByTestId('publish-run')).toBeDisabled()
    await m.getByTestId('publish-round').fill('has space'); await expect(m.getByTestId('publish-round-error')).toBeVisible()
    await m.getByTestId('publish-round').fill('qc_2026-11-19_r01')
    await expect(m.getByTestId('publish-round-error')).toHaveCount(0); await expect(m.getByTestId('publish-return-dest')).toHaveText('returns/BKK/qc_2026-11-19_r01/<shot>/<clip>/…')
    await expect(m.getByTestId('publish-manifest-line')).toHaveText('A RETURN-MANIFEST.json and an inventory CSV are added at the round root')
    await expect(m.getByTestId('publish-run')).toBeEnabled()
    await m.getByTestId('publish-run').click()
    await expect.poll(() => api.state.publish.runs.length).toBe(1)
    expect(api.state.publish.runs[0]).toMatchObject({ round: 'qc_2026-11-19_r01', approved_by: 'Brynley' }); expect(api.state.publish.runs[0]).not.toHaveProperty('clip_names')
    expect(api.state.publish.planned.at(-1).round).toBe('qc_2026-11-19_r01')
  })
  test('the plan table shows the s3_key per item', async ({ page, api }) => {
    setup(api)
    const m = await openModal(page); await pickAll(m); await m.getByTestId('publish-round').fill('qc_2026-11-19_r01')
    await expect(m.getByTestId('publish-plan-table')).toBeVisible(); await m.getByTestId('publish-plan-table').locator('summary').click()
    await expect(m.locator(`[data-testid="publish-plan-row"][data-path="deliver/a/${STEM}.0001.dpx"] [data-testid="publish-plan-key"]`)).toHaveText(`returns/BKK/qc_2026-11-19_r01/archival-077/${STEM}/${STEM}.0001.dpx`)
    await expect(m.locator(`[data-testid="publish-plan-row"][data-path="deliver/a/${STEM}.mp4"] [data-testid="publish-plan-key"]`)).toHaveText(`returns/BKK/qc_2026-11-19_r01/archival-077/${STEM}.mp4`)
    await expect(m.locator('[data-testid="publish-plan-row"][data-path="deliver/a/notes.txt"] [data-testid="publish-plan-key"]')).toHaveText('returns/BKK/qc_2026-11-19_r01/shot/notes.txt')
  })
  test('a clip name per DPX sequence (default the stem): renaming changes the keys, says the frames on disk are not renamed and rides the plan and the run; a bad name blocks', async ({ page, api }) => {
    setup(api)
    const m = await openModal(page); await pickAll(m); await m.getByTestId('publish-round').fill('qc_2026-11-19_r01'); await m.getByTestId('publish-approved-by').fill('B')
    const inp = m.getByTestId('publish-clip-name'); await expect(inp).toHaveCount(1); await expect(inp).toHaveValue(STEM); await expect(m.getByTestId('publish-clip-renamed')).toHaveCount(0)
    await inp.fill('ARCHIVAL-077_A_V11'); await expect(m.getByTestId('publish-clip-renamed')).toHaveText(`renamed from ${STEM}: frames on disk are not renamed`)
    await m.getByTestId('publish-plan-table').locator('summary').click()
    await expect(m.locator(`[data-testid="publish-plan-row"][data-path="deliver/a/${STEM}.0001.dpx"] [data-testid="publish-plan-key"]`)).toHaveText('returns/BKK/qc_2026-11-19_r01/archival-077/ARCHIVAL-077_A_V11/ARCHIVAL-077_A_V11.0001.dpx', { timeout: 6000 })
    await expect(m.locator(`[data-testid="publish-plan-row"][data-path="deliver/a/${STEM}.0001.dpx"] [data-testid="publish-plan-renamed"]`)).toContainText(`renamed from ${STEM}`)
    await inp.fill('bad/name'); await expect(m.getByTestId('publish-clip-name-error')).toBeVisible(); await expect(m.getByTestId('publish-run')).toBeDisabled()
    await inp.fill('ARCHIVAL-077_A_V11'); await expect(m.getByTestId('publish-run')).toBeEnabled()
    await m.getByTestId('publish-run').click(); await expect.poll(() => api.state.publish.runs.length).toBe(1)
    expect(api.state.publish.runs[0].clip_names).toEqual({ [STEM]: 'ARCHIVAL-077_A_V11' })
  })
  test('the core\'s 400 for a run is shown', async ({ page, api }) => {
    setup(api, { runError: 'Publishing to a return needs a round name' })
    const m = await openModal(page); await pickAll(m); await m.getByTestId('publish-round').fill('qc_2026-11-19_r01'); await m.getByTestId('publish-approved-by').fill('B'); await m.getByTestId('publish-run').click()
    await expect(m.getByTestId('publish-run-error')).toHaveText('Publishing to a return needs a round name')
  })
  test('an older core (no layout): no Round, no clip names, no manifest line, and no new keys on plan or run', async ({ page, api }) => {
    setup(api, { layoutSupport: false })
    const m = await openModal(page); await pickAll(m); await m.getByTestId('publish-approved-by').fill('B')
    await expect(m.getByTestId('publish-return')).toHaveCount(0); await expect(m.getByTestId('publish-run')).toBeEnabled()
    await m.getByTestId('publish-run').click(); await expect.poll(() => api.state.publish.runs.length).toBe(1)
    expect(api.state.publish.runs[0]).not.toHaveProperty('round'); expect(api.state.publish.planned.at(-1)).not.toHaveProperty('round')
  })
})

test.describe('Backfill: the return layout', () => {
  const INV = { rows: [{ id: 'r1', shot: 'archival-077', name: STEM, kind: 'dpx', frames: 240, bytes: 12 * GB, where: ['pc'], in_destination: false, source: 'pc:output/', path: 'archival-077/dpx', weight: false }, { id: 'r2', shot: 'archival-077', name: `${STEM}.mp4`, kind: 'proxy', frames: 0, bytes: GB, where: ['pc'], in_destination: false, source: 'pc:output/', path: 'a/p.mp4', weight: false }], by_shot: { 'archival-077': 2 }, unreadable: [] }
  test('the Round and a clip name per selected DPX sequence ride the plan and the run; the Publish button waits for the round', async ({ page, api }) => {
    setup(api, { inventory: INV })
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); await page.getByTestId('pod-outputs-publish').click()
    const m = page.getByTestId('publish-modal'); await m.getByTestId('publish-tab-backfill').click(); await m.getByTestId('publish-backfill-scan').click(); await expect(m.getByTestId('publish-backfill-table')).toBeVisible()
    await m.locator('[data-testid="publish-backfill-row-check"][data-id="r1"]').check(); await m.getByTestId('publish-backfill-approved-by').fill('B')
    await expect(m.getByTestId('publish-round')).toBeVisible(); await expect(m.getByTestId('publish-backfill-run')).toBeDisabled()
    await m.getByTestId('publish-round').fill('qc_2026-11-19_r01'); await m.getByTestId('publish-clip-name').fill('ARCHIVAL-077_A_V11')
    await expect(m.getByTestId('publish-backfill-run')).toBeEnabled()
    await m.getByTestId('publish-backfill-run').click(); await expect.poll(() => api.state.publish.bfRuns.length).toBe(1)
    expect(api.state.publish.bfRuns[0]).toMatchObject({ round: 'qc_2026-11-19_r01', clip_names: { [STEM]: 'ARCHIVAL-077_A_V11' } })
  })
})

test.describe('Generate: the Tunnel proxy preset', () => {
  const px = makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
  const BASE = { where: 'pod', kind: 'proxy', proxy_width: 'source', review_width: 'source', codecs: ['prores422hq'], fps: 'auto', pull: false, publish: { s3: false, slack: false }, skip_existing: true }
  async function open(page, api, settings, extra = {}) {
    api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'tp000000-1111', workflow: 'x.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 5, cost_estimate: 0, outputs: [0, 1, 2].map((n) => ({ filename: `s_proxy.${String(n).padStart(4, '0')}.dpx`, subfolder: 'seqs/a', type: 'output' })) })
    api.state.publish = { settings: JSON.parse(JSON.stringify(CONFIGURED)), tree: {}, there: [], heavy: [], jobs: [] }
    api.state.renders = { settings: { ...BASE, ...settings }, settingsSource: 'default', ...extra }
    await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }).catch(() => {}))
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
    await expect(page.getByTestId('pod-outputs-modal').locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(1)
    await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Render Sequences' }).click(); const g = page.getByTestId('pod-outputs-previews-modal'); await expect(g.getByTestId('pod-outputs-render')).toBeVisible(); return g
  }
  test('Preset Standard / Tunnel proxy (default from the configuration); Tunnel locks the kind, shows the fixed settings and the clip name as the file name, with a start timecode per sequence and where it came from', async ({ page, api }) => {
    const g = await open(page, api, { preset: 'none' }, { rows: { 'seqs/a/s_proxy': { timecode_source: 'DPX header', start_timecode: '01:00:00:00' } } })
    await expect(g.getByTestId('pod-outputs-render-preset')).toHaveValue('none'); await expect(g.getByTestId('pod-outputs-render-preset').locator('option')).toHaveText(['Standard', 'Tunnel proxy (H.264 1920x1080, Rec.709 tagged, no burn-ins)'])
    await expect(g.getByTestId('pod-outputs-render-width')).toBeVisible(); await expect(g.getByTestId('pod-outputs-render-start-timecode')).toHaveCount(0)
    await g.getByTestId('pod-outputs-render-preset').selectOption('tunnel')
    await expect(g.getByTestId('pod-outputs-render-kind-review')).toBeDisabled(); await expect(g.getByTestId('pod-outputs-render-kind-proxy')).toBeChecked()
    await expect(g.getByTestId('pod-outputs-render-tunnel-fixed')).toContainText('H.264, 1920 x 1080'); await expect(g.getByTestId('pod-outputs-render-width')).toHaveCount(0); await expect(g.getByTestId('pod-outputs-render-fps')).toHaveCount(0)
    await expect(g.getByTestId('pod-outputs-render-sequences-title')).toHaveText(/^Sequences \(\d+\)$/)
    const tc = g.getByTestId('pod-outputs-render-start-timecode'); await expect(tc).toHaveValue('01:00:00:00', { timeout: 6000 }); await expect(g.getByTestId('pod-outputs-render-timecode-source')).toHaveText('from the DPX header: 01:00:00:00')
    await expect.poll(() => api.state.renders.planned.at(-1).preset).toBe('tunnel')
  })
  test('the preset from the configuration starts selected; a bad timecode blocks Start; an edited one rides the start with the preset; the resolved source is shown; nothing typed sends no timecode', async ({ page, api }) => {
    const g = await open(page, api, { preset: 'tunnel' }, { rows: { 'seqs/a/s_proxy': { timecode_source: 'EDL', start_timecode: '01:00:00:00' } } })
    await expect(g.getByTestId('pod-outputs-render-preset')).toHaveValue('tunnel')
    await expect(g.getByTestId('pod-outputs-render-timecode-source')).toHaveText('from the EDL: 01:00:00:00', { timeout: 6000 })
    const tc = g.getByTestId('pod-outputs-render-start-timecode')
    await tc.fill('1:00:00'); await expect(g.getByTestId('pod-outputs-render-timecode-error')).toHaveText('A timecode looks like HH:MM:SS:FF, for example 00:00:00:00.'); await expect(g.getByTestId('pod-outputs-render-start')).toBeDisabled()
    await tc.fill('02:00:00:00'); await expect(g.getByTestId('pod-outputs-render-timecode-error')).toHaveCount(0); await expect(g.getByTestId('pod-outputs-render-timecode-source')).toHaveText('set here'); await expect(g.getByTestId('pod-outputs-render-start')).toBeEnabled()
    await g.getByTestId('pod-outputs-render-start').click(); await expect.poll(() => api.state.renders.started.length).toBe(1)
    const b = api.state.renders.started[0]; expect(b.preset).toBe('tunnel'); expect(b.kind).toBe('proxy'); expect(b.sequences[0].start_timecode).toBe('02:00:00:00')
  })
  test('plan warnings (a log or linear source) are shown as a visible alert', async ({ page, api }) => {
    const g = await open(page, api, { preset: 'tunnel' }, { planWarnings: ['seqs/a/s_proxy: the source is log: tagged Rec.709, not converted'] })
    await expect(g.getByTestId('pod-outputs-render-preset-warning')).toHaveText('seqs/a/s_proxy: the source is log: tagged Rec.709, not converted'); await expect(g.getByTestId('pod-outputs-render-preset-warning')).toHaveClass(/alert-warning/)
  })
  test('an older core (no preset in the settings) shows no Preset and no timecode, and sends neither', async ({ page, api }) => {
    const g = await open(page, api, {})
    await expect(g.getByTestId('pod-outputs-render-preset')).toHaveCount(0)
    await g.getByTestId('pod-outputs-render-start').click(); await expect.poll(() => api.state.renders.started.length).toBe(1)
    expect(api.state.renders.started[0]).not.toHaveProperty('preset'); expect(api.state.renders.started[0].sequences[0]).not.toHaveProperty('start_timecode')
  })
})

test.describe('the configuration editors', () => {
  const openDefault = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'options'); return d }
  test('Render: Preset; there is no default start timecode field; Save carries the preset, an untouched config sends none; a stored start_timecode_default is dropped', async ({ page, api }) => {
    let d = await openDefault(page)
    const s = d.getByTestId('config-render'); await s.scrollIntoViewIfNeeded()
    await expect(s.getByTestId('config-render-preset')).toHaveValue('none'); await expect(s.getByTestId('config-render-start-timecode')).toHaveCount(0)
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(api.calls.filter((c) => c.method === 'PUT' && c.path === '/mounts')[0].body).not.toHaveProperty('render')
    api.state.mounts.config.render = { where: 'pod', kind: 'proxy', proxy_width: 'source', review_width: 'source', codecs: ['prores422hq'], fps: 'auto', start_timecode_default: '00:00:00:00' }
    d = await openDefault(page); await d.getByTestId('config-render-preset').selectOption('tunnel')
    await expect(d.getByTestId('config-render-kind-proxy')).toBeChecked()
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(api.state.mounts.config.render).toMatchObject({ preset: 'tunnel', kind: 'proxy' }); expect(api.state.mounts.config.render).not.toHaveProperty('start_timecode_default')
    d = await openDefault(page); await expect(d.getByTestId('config-render-preset')).toHaveValue('tunnel')
  })
  test('Auto-publish: the Round name template (with today\'s example) and Include the source DPX frames; saved with the rest; an older core without them shows neither', async ({ page, api }) => {
    api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, round: 'tunnel-v11_{date}_r01', include_dpx: false, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' } }
    await page.goto('/'); await page.getByTestId('open-config').click(); let d = modal(page, t('config.title')); await cfgTab(d, 'publishing')
    const today = new Date().toISOString().slice(0, 10)
    await expect(d.getByTestId('config-autopublish-round')).toHaveValue('tunnel-v11_{date}_r01'); await expect(d.getByTestId('config-autopublish-round-example')).toHaveText(`For example today: tunnel-v11_${today}_r01`)
    await expect(d.getByTestId('config-autopublish-include-dpx')).not.toBeChecked()
    await d.getByTestId('config-autopublish-round').fill('bad name {date}'); await d.getByTestId('config-save').click(); await expect(d.getByTestId('autopublish-error')).toContainText('round name template')
    await d.getByTestId('config-autopublish-round').fill('qc_{date}_r02'); await d.getByTestId('config-autopublish-include-dpx').check(); await expect(d.getByTestId('config-autopublish-fix-dpx')).toBeChecked(); await expect(d.getByTestId('config-autopublish-fix-dpx-note')).toContainText('corrected copy'); await d.getByTestId('config-autopublish-fix-dpx').uncheck(); await expect(d.getByTestId('config-autopublish-fix-dpx-note')).toContainText('no DPX frames are uploaded'); await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(api.state.mounts.config.auto_publish).toMatchObject({ round: 'qc_{date}_r02', include_dpx: true, fix_dpx: false })   // ADR-057 decision 7: Fix DPX Before Upload is on until a person turns it off
  })
  test('older Auto-publish settings (no round) show no template', async ({ page, api }) => {
    api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' } }
    await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'publishing')
    await expect(d.getByTestId('autopublish-window')).toBeVisible(); await expect(d.getByTestId('config-autopublish-round')).toHaveCount(0); await expect(d.getByTestId('config-autopublish-include-dpx')).toHaveCount(0)
  })
  test('Slack: One message per shot (ticked by default with the core), saved with the pane; an older core shows none', async ({ page, api }) => {
    setup(api); api.state.publish.settings.slack.per_shot = true
    await page.goto('/'); await page.getByTestId('open-connect').click(); const d = modal(page, t('connect.title')); await d.getByRole('tab', { name: t('connect.slack') }).click()
    await expect(d.getByTestId('slack-per-shot')).toBeChecked(); await d.getByTestId('slack-per-shot').uncheck(); await d.getByTestId('publish-slack-save').click()
    await expect.poll(() => api.state.publish.puts.at(-1).slack.per_shot).toBe(false)
  })
  test('an older core: no per-shot checkbox', async ({ page, api }) => {
    setup(api, { layoutSupport: false })
    await page.goto('/'); await page.getByTestId('open-connect').click(); const d = modal(page, t('connect.title')); await d.getByRole('tab', { name: t('connect.slack') }).click()
    await expect(d.getByTestId('slack-pane')).toBeVisible(); await expect(d.getByTestId('slack-per-shot')).toHaveCount(0)
  })
})

test.describe('Queue > Publishing: a publish of several shots', () => {
  const child = (id, shot, state, o = {}) => ({ id, shot, clip: `${shot.toUpperCase()}_A_V11`, state, files: 12, bytes: 3 * GB, rate: 40e6, ...o })
  const parent = (o = {}) => ({ job_id: 'pub-1', state: 'uploading', targets: ['s3'], approved_by: 'Brynley', started_at: '2026-11-19T10:00:00Z', files_total: 36, files_done: 12, bytes_total: 9 * GB, bytes_done: 3 * GB, rate_bps: 40e6, current: '', skipped: 0, links: [], slack: { state: 'skipped' }, summary: '', ...o })
  const openQ = async (page) => { await queueTab(page, 'publishing'); const q = page.getByTestId('queue-modal'); await expect(q.getByTestId('queue-publishing')).toBeVisible(); return q }
  test('failed shots: a long error opens whole; Retry failed tries each failed shot again', async ({ page, api }) => {
    const long = `upload failed: ${'y'.repeat(300)} TAIL`
    setup(api, { jobs: [parent({ state: 'failed', children: [child('c1', 'archival-077', 'done'), child('c2', 'archival-084', 'failed', { error: long, rate: 0 }), child('c3', 'cgi-042', 'failed', { error: 'Access Denied', rate: 0 })] })] })
    await page.goto('/'); const q = await openQ(page)
    const r2 = q.locator('[data-testid="publish-child"][data-id="c2"]')
    await expect(r2.getByTestId('error-text-short')).not.toContainText('TAIL')
    await r2.getByTestId('error-text-open').click(); await expect(page.getByTestId('error-text-full')).toContainText('TAIL'); await page.getByTestId('error-text-modal').getByRole('button', { name: 'Close', exact: true }).last().click()
    await expect(q.getByTestId('publish-retry-all')).toContainText('Retry')
    await q.getByTestId('publish-retry-all').click()
    await expect.poll(() => (api.state.publish.retries || []).length).toBe(2)
    await expect(page.getByText('Retrying archival-084, cgi-042')).toBeVisible()   // feedback: a toast says what was started
  })
  test('Retry failed on a card with failed files and failed shots tries those shots again (it does something)', async ({ page, api }) => {
    setup(api, { jobs: [parent({ state: 'failed', failed: [{ path: 'a.dpx', error: 'RequestTimeout' }], children: [child('c1', 'archival-123', 'failed', { error: 'x', rate: 0 })] })] })
    await page.goto('/'); const q = await openQ(page)
    await q.getByTestId('publish-retry-failed').click()
    await expect.poll(() => (api.state.publish.retries || []).length).toBe(1)
  })
  test('File links are collapsible: a long list starts closed, the folder links open', async ({ page, api }) => {
    const links = [{ path: 'archival-080', url: 'https://console.aws.amazon.com/s3/buckets/b?prefix=x/', kind: 'folder' }, ...Array.from({ length: 8 }, (_, i) => ({ path: `f${i}.dpx`, url: `https://s3/f${i}`, kind: 'file' }))]
    setup(api, { jobs: [parent({ state: 'done', links })] })
    api.state.publish.settings.slack.file_links = true
    await page.goto('/'); const q = await openQ(page)
    await expect(q.locator('[data-testid="publish-link"][data-kind="folder"]')).toHaveCount(1)
    await expect(q.locator('[data-testid="publish-link"][data-kind="file"]')).toHaveCount(0)
    await q.getByTestId('publish-links-file-toggle').click()
    await expect(q.locator('[data-testid="publish-link"][data-kind="file"]')).toHaveCount(8)
    await q.getByTestId('publish-links-file-toggle').click()
    await expect(q.locator('[data-testid="publish-link"][data-kind="file"]')).toHaveCount(0)
  })
  test('a job from an older version cannot be sent again: its Retry buttons stay, disabled, with the reason', async ({ page, api }) => {
    setup(api, { jobs: [parent({ state: 'failed', retryable: false, failed: [{ path: 'a.dpx', error: 'RequestTimeout' }], children: [child('c1', 'archival-080', 'failed', { error: 'no data for 300 s', rate: 0 })] })] })
    await page.goto('/'); const q = await openQ(page)
    for (const id of ['publish-retry-failed', 'publish-child-retry']) { await expect(q.getByTestId(id)).toBeVisible(); await expect(q.getByTestId(id)).toBeDisabled(); await expect(q.getByTestId(id)).toHaveAttribute('title', /older version of the app/) }
    expect(api.state.publish.retries || []).toHaveLength(0)
  })
  test('a parent card shows its children as rows with state, files, bytes and rate; Retry only on a failed one; Cancel on a running one; Cancel all on the parent', async ({ page, api }) => {
    setup(api, { jobs: [parent({ children: [child('c1', 'archival-077', 'done'), child('c2', 'archival-084', 'uploading'), child('c3', 'cgi-042', 'failed', { error: 'Access Denied', rate: 0 })], manifest: { state: 'pending' } })] })
    await page.goto('/'); const q = await openQ(page)
    const rows = q.getByTestId('publish-child'); await expect(rows).toHaveCount(3)
    const r2 = q.locator('[data-testid="publish-child"][data-id="c2"]'), r3 = q.locator('[data-testid="publish-child"][data-id="c3"]'), r1 = q.locator('[data-testid="publish-child"][data-id="c1"]')
    await expect(r1.getByTestId('publish-child-shot')).toHaveText('archival-077'); await expect(r1.getByTestId('publish-child-clip')).toHaveText('ARCHIVAL-077_A_V11'); await expect(r1.getByTestId('publish-child-state')).toHaveText('Published'); await expect(r1.getByTestId('publish-child-files')).toHaveText('12 files')
    await expect(r1.getByTestId('publish-child-retry')).toHaveCount(0); await expect(r1.getByTestId('publish-child-cancel')).toHaveCount(0)
    await expect(r2.getByTestId('publish-child-cancel')).toBeVisible(); await expect(r2.getByTestId('publish-child-retry')).toHaveCount(0); await expect(r2.getByTestId('publish-child-rate')).toBeVisible()
    await expect(r3.getByTestId('publish-child-error')).toHaveText('Access Denied'); await r3.getByTestId('publish-child-retry').click(); await expect(page.getByTestId('toast').first()).toContainText('Retrying cgi-042')
    await expect.poll(() => api.state.publish.retries).toEqual(['c3'])
    await r2.getByTestId('publish-child-cancel').click(); await expect.poll(() => api.state.publish.cancelled).toContain('c2')
    await expect(q.locator('[data-testid="publishing-job"][data-job="pub-1"]').getByTestId('publish-cancel')).toHaveText('Cancel All')
    await expect(q.getByTestId('publish-progress')).toHaveAttribute('data-percent', '33')   // the parent's overall progress
  })
  test('more than 5 children start collapsed; the toggle opens them', async ({ page, api }) => {
    setup(api, { jobs: [parent({ children: Array.from({ length: 7 }, (_, i) => child(`c${i}`, `shot-${i}00`, i < 3 ? 'done' : 'queued')) })] })
    await page.goto('/'); const q = await openQ(page)
    await expect(q.getByTestId('publish-children')).toHaveAttribute('data-open', 'false'); await expect(q.getByTestId('publish-child')).toHaveCount(0)
    await expect(q.getByTestId('publish-children-toggle')).toContainText('Shots (7)')
    await q.getByTestId('publish-children-toggle').click(); await expect(q.getByTestId('publish-child')).toHaveCount(7)
  })
  test('the manifest line, the SHA-256 count and Copy for the manifest URL', async ({ page, api }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    setup(api, { jobs: [parent({ state: 'done', files_done: 36, bytes_done: 9 * GB, rate_bps: 0, summary: '36 files uploaded', sha256_count: 36, children: [child('c1', 'archival-077', 'done')], manifest: { state: 'updated', shots: 3, url: 'https://s3.example/RETURN-MANIFEST.json?sig=1' } })] })
    await page.goto('/'); const q = await openQ(page)
    await expect(q.getByTestId('publish-manifest-state')).toContainText('RETURN-MANIFEST.json updated: 3 shots'); await expect(q.getByTestId('publish-verified')).toHaveText('36 files verified with SHA-256')
    await q.getByTestId('publish-manifest-copy').click(); await expect(q.getByTestId('publish-manifest-copy')).toHaveText('Copied')
  })
  test('a job with none of it (an older core) shows no children, manifest or verified line', async ({ page, api }) => {
    setup(api, { jobs: [parent({ state: 'done', files_done: 36 })], layoutSupport: false })
    await page.goto('/'); const q = await openQ(page)
    await expect(q.getByTestId('publish-children')).toHaveCount(0); await expect(q.getByTestId('publish-manifest-state')).toHaveCount(0); await expect(q.getByTestId('publish-verified')).toHaveCount(0)
  })
  test('a render that syncs and publishes: each sequence row shows Pulling, then Publishing', async ({ page, api }) => {
    api.state.renders = { jobs: [{ job_id: 'job-r', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', kind: 'proxy', state: 'pulling', started_at: '2026-11-19T10:00:00Z', finished_at: null, frames_done: 5, frames_total: 10, rate_fps: 0, current: '', pulled_files: 0, pulled_bytes: 0, error: '', summary: '', publish: { state: 'queued' },
      sequences: [{ dir: 'a', name: 'A', where: 'pod', state: 'pulling', frames_done: 5, frames_total: 5 }, { dir: 'b', name: 'B', where: 'pod', state: 'publishing', frames_done: 5, frames_total: 5 }] }] }
    await page.goto('/'); await queueTab(page, 'generations')
    await page.locator('[data-testid="generations-job"][data-job="job-r"]').getByTestId('generations-job-rows-toggle').click()
    await expect(page.locator('[data-testid="generations-seq"][data-name="A"]').getByTestId('generations-seq-state')).toHaveText('Pulling'); await expect(page.locator('[data-testid="generations-seq"][data-name="B"]').getByTestId('generations-seq-state')).toHaveText('Publishing')
  })
})
