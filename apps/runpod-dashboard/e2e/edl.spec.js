import { test, expect, podCard, modal, cfgTab, queueTab, openAutopublish, openPublishing } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'
import { t } from './i18n'

// The EDL decides timecode, frame count and what may be delivered (docs/ADR-050, Kyle 2026-11-19): the EDL status, per-sequence flags, the colour choice, the clip-name picker. The core is faked (state.edl, state.renders.rows).
const px = makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const ELEMENTS = [
  { clip: 'ARCHIVAL-077_A_FINAL_V03', shot: 'archival-077', element: 'a', kind: 'dpx', version: 'v03', raster: '3840x2160', first_source_in: '01:00:00:00', frames_in_cut: 120, speeds: [], effects: [] },
  { clip: 'CGI-042_A', shot: 'cgi-042', element: 'a', kind: 'dpx', version: 'v11', raster: '3840x2160', first_source_in: '00:00:00:00', frames_in_cut: 3, speeds: [], effects: [] },
  { clip: 'CGI-042_B', shot: 'cgi-042', element: 'b', kind: 'dpx', version: 'v11', raster: '3840x2160', first_source_in: '00:00:00:00', frames_in_cut: 3, speeds: [], effects: [] },
  ...Array.from({ length: 60 }, (_, i) => ({ clip: `ELEM-${100 + i}_A`, shot: `elem-${100 + i}`, element: 'a', kind: 'dpx', version: 'v11', raster: '3840x2160', first_source_in: '00:00:00:00', frames_in_cut: 24, speeds: [], effects: [] })),
]
const BASE = { where: 'pod', kind: 'proxy', proxy_width: 'source', review_width: 'source', codecs: ['prores422hq'], fps: 'auto', pull: false, publish: { s3: false, slack: false }, skip_existing: true, preset: 'tunnel' }
const A = 'seqs/a/cgi-042_a', B = 'seqs/b/cgi-043_b'
const frames = (name, sub) => [0, 1, 2].map((n) => ({ filename: `${name}.${String(n).padStart(4, '0')}.dpx`, subfolder: sub, type: 'output' }))
async function open(page, api, { rows = {}, edl = { loaded: true, elements: ELEMENTS, events: 121, sha256: '7511c0ffee', loaded_at: '2026-11-19T10:00:00Z' }, noEdl = false, requireColour = false, preset = 'tunnel' } = {}) {
  api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'ed000000-1111', workflow: 'x.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 5, cost_estimate: 0, outputs: [...frames('cgi-042_a', 'seqs/a'), ...frames('cgi-043_b', 'seqs/b')] })
  api.state.publish = { settings: { s3: { bucket: 'b-bucket', prefix: 'returns/BKK/', region: 'us-west-2', endpoint: '', credentials: 'panama', access_key_hint: '', presign_hours: 72 }, slack: { workspace_name: 'B', workspace_url: 'https://x.slack.com', channel: '#d', username: 'R', webhook_hint: '••••1' }, defaults: { targets: ['s3'], message: '{shot}' } }, tree: {}, there: [], heavy: [], jobs: [] }
  api.state.renders = { settings: { ...BASE, preset }, settingsSource: 'default', rows, requireColour }
  if (noEdl) api.state.noEdl = true; else api.state.edl = edl
  await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }).catch(() => {}))
  await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await expect(page.getByTestId('pod-outputs-modal').locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(2)
  await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Render Sequences' }).click(); const g = page.getByTestId('pod-outputs-previews-modal'); await expect(g.getByTestId('pod-outputs-render')).toBeVisible(); return g
}
const row = (g, name) => g.locator(`[data-testid="pod-outputs-render-clip-row"][data-name="${name}"]`)
/** The colour window of one row (the palette icon): open it, read or set its select, close it. */
const colourUi = (page, g) => { const m = () => page.getByTestId('clip-colour-modal'), sel = () => m().getByTestId('pod-outputs-render-colour-in')
  const open = async (name) => { await row(g, name).getByTestId('pod-outputs-render-colour-edit').click(); await expect(m()).toBeVisible() }
  const close = async () => { await m().getByRole('button', { name: 'Done' }).click(); await expect(m()).toBeHidden() }
  return { m, sel, open, close, set: async (name, v) => { await open(name); await sel().selectOption(v); await close() } } }
const flag = (g, name, code) => row(g, name).locator(`[data-testid="edl-flag"][data-code="${code}"]`)
const openDefault = (page) => openPublishing(page)

test.describe('the EDL status', () => {
  test('not loaded: says so; Load the V11 EDL loads it and shows events, elements, sha256 and the date; a source under Advanced rides the call', async ({ page, api }) => {
    api.state.edl = { loaded: false, elements: ELEMENTS, afterLoad: {} }
    const d = await openDefault(page)
    await expect(d.getByTestId('edl-status-line')).toHaveText('No EDL loaded'); await expect(d.getByTestId('edl-load')).toHaveText('Load the V11 EDL')
    await d.getByTestId('edl-advanced').locator('summary').click(); await d.getByTestId('edl-source').fill('bucket/rounds/v11.edl')
    await d.getByTestId('edl-load').click()
    await expect(d.getByTestId('edl-status-line')).toHaveText('V11 EDL: 121 events · 63 elements · sha256 7511… · loaded 19 Nov')
    expect(api.state.edl.loads[0]).toEqual({ source: 'bucket/rounds/v11.edl' })
  })
  test('a load error is shown inline; a pod\'s own editor has no EDL block; an older core hides it', async ({ page, api }) => {
    api.state.edl = { loaded: false, elements: [], loadError: 'The EDL could not be read: Access Denied' }
    let d = await openDefault(page)
    await d.getByTestId('edl-load').click(); await expect(d.getByTestId('edl-error')).toHaveText('The EDL could not be read: Access Denied'); await expect(d.getByTestId('edl-status-line')).toHaveText('No EDL loaded')
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click()
    const p = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' })); await expect(p).toBeVisible(); await expect(p.getByTestId('edl-status')).toHaveCount(0)
    api.state.noEdl = true
    d = await openDefault(page); await expect(d.getByTestId('settings-publishing')).toBeVisible(); await expect(d.getByTestId('edl-status')).toHaveCount(0)
  })
})

test.describe('Generate (Tunnel proxy): flags, timecode, colour and the clip-name picker', () => {
  test('the start timecode starts empty with the placeholder; after the plan it shows the EDL value and its source; typing overrides', async ({ page, api }) => {
    const g = await open(page, api, { rows: { [A]: { timecode_source: 'EDL', start_timecode: '01:00:00:00' }, [B]: { timecode_source: null } } })
    const a = row(g, 'cgi-042_a').getByTestId('pod-outputs-render-start-timecode'), b = row(g, 'cgi-043_b').getByTestId('pod-outputs-render-start-timecode')
    await expect(a).toHaveValue('01:00:00:00', { timeout: 6000 }); await expect(row(g, 'cgi-042_a').getByTestId('pod-outputs-render-timecode-source')).toHaveText('from the EDL: 01:00:00:00')
    await expect(b).toHaveValue(''); await expect(b).toHaveAttribute('placeholder', 'from the DPX header or the EDL')
    await b.fill('00:00:10:00'); await expect(row(g, 'cgi-043_b').getByTestId('pod-outputs-render-timecode-source')).toHaveText('set here')
    await g.getByTestId('pod-outputs-render-colour-all').selectOption('p3-d65-gamma26')
    await g.getByTestId('pod-outputs-render-start').click(); await expect.poll(() => api.state.renders.started.length).toBe(1)
    const seqs = api.state.renders.started[0].sequences; expect(seqs.find((s) => s.name === 'cgi-043_b').start_timecode).toBe('00:00:10:00'); expect(seqs.find((s) => s.name === 'cgi-042_a')).not.toHaveProperty('start_timecode')   // only what was typed is sent
  })
  test('block flags are red with the message and the sequence will be skipped; warnings are amber; Start stays enabled while one is ready, the summary counts the blocked; all blocked disables Start', async ({ page, api }) => {
    const g = await open(page, api, { rows: { [A]: { flags: [{ code: 'no-start-timecode', level: 'block', message: 'No start timecode: set it or load the EDL' }] }, [B]: { flags: [{ code: 'low-source-resolution', level: 'warn', message: 'the source is 1280x720: flag if the 4K is not usable' }] } } })
    await g.getByTestId('pod-outputs-render-colour-all').selectOption('kodak-log')
    const f = flag(g, 'cgi-042_a', 'no-start-timecode'); await expect(f).toHaveText('No start timecode: set it or load the EDL'); await expect(f).toHaveAttribute('data-level', 'block'); await expect(f).toHaveClass(/alert-danger/)
    await expect(row(g, 'cgi-042_a').getByTestId('edl-skipped')).toHaveText('will be skipped'); await expect(row(g, 'cgi-042_a')).toHaveAttribute('data-blocked', 'true')
    const w = flag(g, 'cgi-043_b', 'low-source-resolution'); await expect(w).toHaveAttribute('data-level', 'warn'); await expect(w).toHaveClass(/alert-warning/); await expect(row(g, 'cgi-043_b').getByTestId('edl-skipped')).toHaveCount(0)
    await expect(g.getByTestId('pod-outputs-render-blocked-summary')).toHaveText('1 sequence blocked'); await expect(g.getByTestId('pod-outputs-render-start')).toBeEnabled()
    api.state.renders.rows[B] = { flags: [{ code: 'not-in-edl', level: 'block', message: 'x' }] }
    await g.getByTestId('pod-outputs-render-colour-all').selectOption('p3-d65-srgb')   // a change replans
    await expect(g.getByTestId('pod-outputs-render-blocked-summary')).toHaveText('2 sequences blocked'); await expect(g.getByTestId('pod-outputs-render-start')).toBeDisabled()
  })
  test('frames-differ-from-edl: N frames, the EDL cut and its speed, an override checkbox per sequence that goes to the plan and the start; not-in-edl has no override', async ({ page, api }) => {
    const g = await open(page, api, { rows: { [A]: { expected_frames: 260, edl_element: { clip: 'CGI-042_A', speeds: ['90%'] }, flags: [{ code: 'frames-differ-from-edl', level: 'block', message: 'The DPX must carry the retime' }] }, [B]: { flags: [{ code: 'not-in-edl', level: 'block', message: 'x' }] } } })
    await g.getByTestId('pod-outputs-render-colour-all').selectOption('kodak-log')
    await expect(row(g, 'cgi-042_a').getByTestId('edl-frames-line')).toHaveText('3 frames · EDL cut 260 frames (speed 90%)'); await expect(row(g, 'cgi-042_a').getByTestId('edl-override-note')).toHaveText('Recorded in the manifest.')
    await expect(flag(g, 'cgi-043_b', 'not-in-edl')).toHaveText('Not in the V11 EDL: do not deliver'); await expect(row(g, 'cgi-043_b').locator('[data-testid^="edl-override-"]')).toHaveCount(0)
    await expect(g.getByTestId('pod-outputs-render-start')).toBeDisabled()   // both blocked
    await g.getByTestId('edl-override-cgi-042_a').check()
    await expect(row(g, 'cgi-042_a')).toHaveAttribute('data-blocked', 'false'); await expect(g.getByTestId('pod-outputs-render-blocked-summary')).toHaveText('1 sequence blocked'); await expect(g.getByTestId('pod-outputs-render-start')).toBeEnabled()
    await expect.poll(() => api.state.renders.planned.at(-1).edl_override).toEqual({ 'cgi-042_a': true })
    await g.getByTestId('pod-outputs-render-start').click(); await expect.poll(() => api.state.renders.started.length).toBe(1)
    expect(api.state.renders.started[0].edl_override).toEqual({ 'cgi-042_a': true })
  })
  test('ambiguous-edl-element: a picker of the candidates sets the clip name', async ({ page, api }) => {
    const g = await open(page, api, { rows: { [A]: { flags: [{ code: 'ambiguous-edl-element', level: 'block', message: 'Two EDL elements match: pick one' }] } } })
    const pick = row(g, 'cgi-042_a').getByTestId('edl-candidates'); await expect(pick.locator('option')).toHaveText(['Pick the EDL clip', 'CGI-042_A', 'CGI-042_B'])
    await pick.selectOption('CGI-042_B'); await expect(row(g, 'cgi-042_a').getByTestId('pod-outputs-render-clipname')).toHaveValue('CGI-042_B')
    expect(api.state.edl.lookups[0]).toMatchObject({ clip: 'cgi-042_a' })
  })
  test('Colour: no preselection, four choices, the suggestion hint, Same colour for all fills rows without one, colour-not-set blocks until chosen', async ({ page, api }) => {
    const g = await open(page, api, { requireColour: true, rows: { [B]: { suggested_colour: 'kodak-log' } } })
    const ui = colourUi(page, g)
    await ui.open('cgi-042_a'); await expect(ui.sel()).toHaveValue(''); await expect(ui.sel().locator('option')).toHaveText(['Choose', 'Linear light, P3-D65', 'Linear light, Rec.709', 'P3-D65, gamma 2.6', 'P3-D65, sRGB', 'P3-D65, gamma 2.2', 'Kodak log (no view transform)']); await ui.close()
    await ui.open('cgi-043_b'); await expect(page.getByTestId('pod-outputs-render-colour-suggested')).toHaveText('Suggested: Kodak log'); await expect(ui.sel()).toHaveValue(''); await ui.close()   // a suggestion, never applied
    await expect(flag(g, 'cgi-042_a', 'colour-not-set')).toBeVisible(); await expect(g.getByTestId('pod-outputs-render-start')).toBeDisabled()
    await ui.set('cgi-042_a', 'p3-d65-srgb')
    await expect(flag(g, 'cgi-042_a', 'colour-not-set')).toHaveCount(0); await expect(flag(g, 'cgi-043_b', 'colour-not-set')).toBeVisible(); await expect(g.getByTestId('pod-outputs-render-start')).toBeEnabled()   // one sequence is ready
    await g.getByTestId('pod-outputs-render-colour-all').selectOption('p3-d65-gamma26')   // the global override replaces every row's colour, the one set by hand too
    await expect(flag(g, 'cgi-043_b', 'colour-not-set')).toHaveCount(0); await expect(flag(g, 'cgi-042_a', 'colour-not-set')).toHaveCount(0)
    await ui.set('cgi-042_a', 'p3-d65-srgb')   // a row set after the global one wins again
    await g.getByTestId('pod-outputs-render-start').click(); await expect.poll(() => api.state.renders.started.length).toBe(1)
    const seqs = api.state.renders.started[0].sequences; expect(seqs.find((s) => s.name === 'cgi-042_a').colour_in).toBe('p3-d65-srgb'); expect(seqs.find((s) => s.name === 'cgi-043_b').colour_in).toBe('p3-d65-gamma26')
  })
  test('the clip-name picker lists the EDL elements of the sequence\'s shot with the match state', async ({ page, api }) => {
    const g = await open(page, api)
    const inp = row(g, 'cgi-042_a').getByTestId('pod-outputs-render-clipname')
    await expect(row(g, 'cgi-042_a').locator('datalist option')).toHaveCount(2); await expect(row(g, 'cgi-042_a').locator('datalist option').first()).toHaveAttribute('value', 'CGI-042_A')
    await expect(row(g, 'cgi-042_a').getByTestId('pod-outputs-render-clip-match')).toHaveText('not in the V11 EDL')   // cgi-042_a (lower case) is not the EDL's CGI-042_A
    await inp.fill('CGI-042_A'); await expect(row(g, 'cgi-042_a').getByTestId('pod-outputs-render-clip-match')).toHaveText('matches the V11 EDL')
  })
  test('No EDL loaded: a one-line notice with a Load button while the Tunnel preset is on; it loads and the notice goes', async ({ page, api }) => {
    const g = await open(page, api, { edl: { loaded: false, elements: ELEMENTS } })
    await expect(g.getByTestId('edl-none-line')).toContainText('No EDL loaded: timecode, frame counts and the not-in-EDL check cannot be used')
    await g.getByTestId('edl-none-load').click(); await expect(g.getByTestId('edl-none-line')).toHaveCount(0); await expect(row(g, 'cgi-042_a').getByTestId('pod-outputs-render-clip-match')).toBeVisible()
  })
  test('an older core (no edl, no flags): no notice, no match line, no picker, no edl_override; the colour choice and the timecode still work', async ({ page, api }) => {
    const g = await open(page, api, { noEdl: true })
    await expect(g.getByTestId('edl-none-line')).toHaveCount(0); await expect(g.getByTestId('pod-outputs-render-clip-match')).toHaveCount(0); await expect(g.locator('datalist')).toHaveCount(0); await expect(g.getByTestId('edl-flag')).toHaveCount(0)
    await g.getByTestId('pod-outputs-render-colour-all').selectOption('kodak-log'); await g.getByTestId('pod-outputs-render-start').click(); await expect.poll(() => api.state.renders.started.length).toBe(1)
    expect(api.state.renders.started[0]).not.toHaveProperty('edl_override')
  })
})

test.describe('Publish (bkk-return)', () => {
  const GB = 1e9
  const f = (n, dir) => ({ name: n, path: `${dir}/${n}`, dir: false, bytes: GB })
  const TREE = { '': [{ name: 'deliver', path: 'deliver', dir: true }], deliver: [{ name: 'a', path: 'deliver/a', dir: true }], 'deliver/a': [f('ENH-146_B.0001.dpx', 'deliver/a'), f('ENH-146_B.0002.dpx', 'deliver/a')] }
  async function openPub(page, api, { seqs, edl } = {}) {
    api.state.publish = { settings: { s3: { bucket: 'b-bucket', prefix: 'returns/BKK/', region: 'us-west-2', endpoint: '', credentials: 'panama', access_key_hint: '', presign_hours: 72 }, slack: { workspace_name: 'B', workspace_url: 'https://x.slack.com', channel: '#d', username: 'R', webhook_hint: '••••1' }, defaults: { targets: ['s3'], message: '{shot}' } }, tree: TREE, there: [], heavy: [], jobs: [], layoutSupport: true, rounds: [], planSequences: seqs }
    api.state.edl = edl || { loaded: true, elements: ELEMENTS }
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); await page.getByTestId('pod-outputs-publish').click()
    const m = page.getByTestId('publish-modal'); await m.getByTestId('publish-source-local').click(); await m.getByTestId('publish-quick-deliver').click(); await m.locator('[data-testid="publish-entry-check"][data-path="deliver/a"]').check()
    await m.getByTestId('publish-round').fill('qc_2026-11-19_r01'); await m.getByTestId('publish-approved-by').fill('B'); return m
  }
  test('flagged rows show their flags; the frame-count override goes to the plan and the run; the blocked summary; a job records the override', async ({ page, api }) => {
    const m = await openPub(page, api, { seqs: [{ stem: 'ENH-146_B', flags: [{ code: 'frames-differ-from-edl', level: 'block', message: 'The DPX must carry the retime' }], expected_frames: 260, frames: 234, edl_element: { speeds: ['90%'] } }, { stem: 'ARCH-077_A', flags: [{ code: 'not-in-edl', level: 'block', message: 'x' }] }] })
    await expect(m.getByTestId('publish-blocked-summary')).toHaveText('2 sequences blocked'); await expect(m.getByTestId('publish-run')).toBeDisabled()
    await expect(m.locator('[data-testid="publish-flagged-row"][data-stem="ARCH-077_A"] [data-testid="edl-flag"]')).toHaveText('Not in the V11 EDL: do not deliver')
    await expect(m.locator('[data-testid="publish-flagged-row"][data-stem="ENH-146_B"] [data-testid="edl-frames-line"]')).toHaveText('234 frames · EDL cut 260 frames (speed 90%)')
    await m.getByTestId('edl-override-ENH-146_B').check(); await expect(m.getByTestId('publish-blocked-summary')).toHaveText('1 sequence blocked'); await expect(m.getByTestId('publish-run')).toBeEnabled()
    await expect.poll(() => api.state.publish.planned.at(-1).edl_override).toEqual({ 'ENH-146_B': true })
    await m.getByTestId('publish-run').click()
    const jc = page.getByTestId('queue-modal').locator('[data-testid="publishing-job"]').first()   // publishing closes the window: the job is its Queue card
    await expect(page.getByTestId('publish-modal')).toHaveCount(0)
    await expect.poll(() => api.state.publish.runs.length).toBe(1); expect(api.state.publish.runs[0].edl_override).toEqual({ 'ENH-146_B': true })
    api.state.publish.jobs[0].edl_overrides = ['ENH-146_B']; api.state.publish.jobs[0].state = 'done'
    await expect(jc.getByTestId('publish-edl-override')).toHaveText('EDL override recorded: ENH-146_B', { timeout: 6000 })
  })
  test('the notice when no EDL is loaded, with a Load button; the clip-name picker with the match state', async ({ page, api }) => {
    const m = await openPub(page, api, { edl: { loaded: false, elements: ELEMENTS } })
    await expect(m.getByTestId('edl-none-line')).toContainText('No EDL loaded'); await m.getByTestId('edl-none-load').click(); await expect(m.getByTestId('edl-none-line')).toHaveCount(0)
    await expect(m.getByTestId('publish-clip-match')).toHaveText('not in the V11 EDL'); await m.getByTestId('publish-clip-name').fill('ARCHIVAL-077_A_FINAL_V03'); await expect(m.getByTestId('publish-clip-match')).toHaveText('matches the V11 EDL')
  })
  test('an older core (no flags, no EDL): none of it', async ({ page, api }) => {
    api.state.noEdl = true
    const m = await openPub(page, api, { edl: { loaded: false, elements: [] } })
    await expect(m.getByTestId('edl-none-line')).toHaveCount(0); await expect(m.getByTestId('publish-seq-flags')).toHaveCount(0); await expect(m.getByTestId('publish-clip-match')).toHaveCount(0)
  })
})

test.describe('stated colour', () => {
  test('frames whose header says linear need the colour stated: the header line, a required select with no preselection, the hint, skipped until stated, and colour_in only for that sequence', async ({ page, api }) => {
    const g = await open(page, api, { preset: 'none', rows: { [A]: { header_transfer: 'linear (code 2)', flags: [{ code: 'colour-not-stated', level: 'block', message: 'State the colour of these frames' }] } } })
    await expect(row(g, 'cgi-042_a').getByTestId('pod-outputs-render-header-transfer')).toHaveText('DPX header says: linear (code 2)')
    const ui = colourUi(page, g), rc = (n) => row(g, n).getByTestId('pod-outputs-render-row-colour')
    await expect(rc('cgi-042_a')).toHaveAttribute('data-source', 'none'); await expect(rc('cgi-042_a')).toContainText('not stated')   // said on the row even when not set
    await ui.open('cgi-042_a'); await expect(ui.sel()).toHaveValue(''); await expect(ui.sel().locator('option')).toHaveCount(7)
    await expect(ui.m().getByTestId('pod-outputs-render-colour-hint')).toHaveText('Kyle, 14 Nov: generated shots are P3-D65'); await ui.close()
    await expect(flag(g, 'cgi-042_a', 'colour-not-stated')).toHaveText('State the colour of these frames')
    await ui.set('cgi-042_a', 'linear-p3-d65'); await expect(rc('cgi-042_a')).toHaveAttribute('data-source', 'own'); await expect(rc('cgi-042_a')).toHaveText('Colour: Linear light, P3-D65 (set for this sequence)')
    await g.getByTestId('pod-outputs-render-start').click(); await expect.poll(() => api.state.renders.started.length).toBe(1)
    const seqs = api.state.renders.started[0].sequences; expect(seqs.find((s) => s.name === 'cgi-042_a').colour_in).toBe('linear-p3-d65'); expect(seqs.find((s) => s.name === 'cgi-043_b')).not.toHaveProperty('colour_in')
  })
  test('an OCIO record is the stated colour: "OCIO record: Gamma 2.6 P3-D65" on the row and in its colour window, an info note that the header disagrees, no colour needed, nothing sent; a choice of the person wins', async ({ page, api }) => {
    const ocio = { colorInteropID: 'g26_p3d65_display', colorspace: 'Gamma 2.6 P3-D65 - Display', gamut: 'P3-D65', label: 'Gamma 2.6 P3-D65', colour_in: 'p3-d65-gamma26', header_disagrees: true }
    const lin = { header_transfer: 'linear (code 2)', flags: [{ code: 'colour-not-stated', level: 'warn', message: 'State the colour of these frames' }] }
    const g = await open(page, api, { preset: 'none', rows: { [A]: { header_transfer: 'linear (code 2)', colour_in: 'p3-d65-gamma26', colour_source: 'ocio-record', ocio, header_disagrees: true, flags: [{ code: 'header-disagrees', level: 'info', message: 'the DPX header says linear; the colour record of ComfyUI-OCIO says Gamma 2.6 P3-D65 (g26_p3d65_display): the record was used, not the header' }] }, [B]: lin } })
    const ui = colourUi(page, g), rc = (n) => row(g, n).getByTestId('pod-outputs-render-row-colour')
    await expect(rc('cgi-042_a')).toHaveAttribute('data-source', 'ocio'); await expect(rc('cgi-042_a')).toHaveText('OCIO record: Gamma 2.6 P3-D65')
    await expect(flag(g, 'cgi-042_a', 'header-disagrees')).toHaveAttribute('data-level', 'info'); await expect(row(g, 'cgi-042_a').getByTestId('edl-skipped')).toHaveCount(0)
    await expect(rc('cgi-043_b')).toHaveAttribute('data-source', 'none')   // a sequence without a record still needs its colour stated
    await ui.open('cgi-042_a'); await expect(ui.m().getByTestId('clip-colour-ocio')).toContainText('OCIO record: Gamma 2.6 P3-D65'); await expect(ui.m().getByTestId('clip-colour-ocio-disagrees')).toContainText('header disagrees'); await expect(ui.sel().locator('option').first()).toHaveText('OCIO record: Gamma 2.6 P3-D65'); await ui.close()
    await g.getByTestId('pod-outputs-render-start').click(); await expect.poll(() => api.state.renders.started.length).toBe(1)
    expect(api.state.renders.started[0].sequences.find((s) => s.name === 'cgi-042_a')).not.toHaveProperty('colour_in')   // the record is the core's to read, never sent as a statement
    await ui.set('cgi-042_a', 'kodak-log'); await expect(rc('cgi-042_a')).toHaveAttribute('data-source', 'own'); await expect(rc('cgi-042_a')).toHaveText('Colour: Kodak log (set for this sequence)')
  })
  test('\"Same colour for all\" is said on EVERY row ("same colour for all"), a row\'s own choice from its colour window wins, and every sequence is sent with it', async ({ page, api }) => {
    const lin = { header_transfer: 'linear (code 2)', flags: [{ code: 'colour-not-stated', level: 'warn', message: 'State the colour of these frames' }] }
    const g = await open(page, api, { preset: 'none', rows: { [A]: lin, [B]: lin } }), ui = colourUi(page, g), rc = (n) => row(g, n).getByTestId('pod-outputs-render-row-colour')
    await expect(rc('cgi-042_a')).toHaveAttribute('data-source', 'none'); await expect(rc('cgi-043_b')).toHaveAttribute('data-source', 'none')
    await g.getByTestId('pod-outputs-render-colour-all').selectOption('linear-p3-d65')
    await expect(rc('cgi-042_a')).toHaveText('Colour: Linear light, P3-D65 (same colour for all)'); await expect(rc('cgi-043_b')).toHaveText('Colour: Linear light, P3-D65 (same colour for all)')
    await g.getByTestId('pod-outputs-render-colour-all').selectOption('linear-rec709')   // replaces every row's colour
    await expect(rc('cgi-042_a')).toContainText('Linear light, Rec.709'); await expect(rc('cgi-043_b')).toContainText('Linear light, Rec.709')
    await ui.set('cgi-043_b', 'kodak-log')   // a row's own choice, made after the global one, wins for that row
    await expect(rc('cgi-042_a')).toContainText('Linear light, Rec.709'); await expect(rc('cgi-043_b')).toHaveText('Colour: Kodak log (set for this sequence)')
    await ui.open('cgi-042_a'); await expect(ui.sel().locator('option').first()).toHaveText('Same colour for all: Linear light, Rec.709'); await ui.close()
    await g.getByTestId('pod-outputs-render-start').click(); await expect.poll(() => api.state.renders.started.length).toBe(1)
    const seqs = api.state.renders.started[0].sequences; expect(seqs.find((x) => x.name === 'cgi-042_a').colour_in).toBe('linear-rec709'); expect(seqs.find((x) => x.name === 'cgi-043_b').colour_in).toBe('kodak-log')
  })
  test('the global colour sits in the settings row, shows the colour every row resolves to (from the OCIO records) by default, replaces all colours when picked; "Per sequence" goes back; the row button says the current colour', async ({ page, api }) => {
    const ocio = { colorInteropID: 'g26_p3d65_display', colorspace: 'Gamma 2.6 P3-D65 - Display', gamut: 'P3-D65', label: 'Gamma 2.6 P3-D65', colour_in: 'p3-d65-gamma26', header_disagrees: true }
    const rec = { header_transfer: 'linear (code 2)', colour_in: 'p3-d65-gamma26', colour_source: 'ocio-record', ocio, header_disagrees: true }
    const g = await open(page, api, { preset: 'none', rows: { [A]: rec, [B]: rec } }), ui = colourUi(page, g)
    const all = g.getByTestId('pod-outputs-render-colour-all'), btn = (n) => row(g, n).getByTestId('pod-outputs-render-colour-edit')
    await expect(all).toBeVisible()   // always there, with Size, Frame rate and Where, not only when a colour is missing
    await expect(all).toHaveValue('p3-d65-gamma26'); await expect(all).toHaveAttribute('data-uniform', 'p3-d65-gamma26'); await expect(all).toHaveAttribute('data-override', '')   // by default: the colour all rows share, nothing stated by a person
    await expect(btn('cgi-042_a')).toHaveText('P3-D65, gamma 2.6'); await expect(btn('cgi-043_b')).toHaveText('P3-D65, gamma 2.6')   // the button says the current colour, not "Change Colour"
    await ui.set('cgi-043_b', 'kodak-log'); await expect(btn('cgi-043_b')).toHaveText('Kodak log'); await expect(all).toHaveValue('')   // rows differ: Per sequence
    await all.selectOption('linear-rec709')   // replaces every colour, the one set by hand too
    await expect(btn('cgi-042_a')).toHaveText('Linear light, Rec.709'); await expect(btn('cgi-043_b')).toHaveText('Linear light, Rec.709'); await expect(all).toHaveAttribute('data-override', 'linear-rec709')
    await all.selectOption('')   // back to what each sequence's record says
    await expect(all).toHaveValue('p3-d65-gamma26'); await expect(btn('cgi-042_a')).toHaveText('P3-D65, gamma 2.6')
  })
  test('a sequence with no colour at all says "Set Colour" on its button, and the global select is on Per sequence while rows differ', async ({ page, api }) => {
    const ocio = { colorInteropID: 'g26_p3d65_display', colorspace: 'Gamma 2.6 P3-D65 - Display', gamut: 'P3-D65', label: 'Gamma 2.6 P3-D65', colour_in: 'p3-d65-gamma26' }
    const lin = { header_transfer: 'linear (code 2)', flags: [{ code: 'colour-not-stated', level: 'warn', message: 'State the colour of these frames' }] }
    const g = await open(page, api, { preset: 'none', rows: { [A]: { colour_in: 'p3-d65-gamma26', colour_source: 'ocio-record', ocio }, [B]: lin } })
    await expect(row(g, 'cgi-043_b').getByTestId('pod-outputs-render-colour-edit')).toHaveText('Set Colour'); await expect(row(g, 'cgi-042_a').getByTestId('pod-outputs-render-colour-edit')).toHaveText('P3-D65, gamma 2.6')
    await expect(g.getByTestId('pod-outputs-render-colour-all')).toHaveValue('')
  })
  test('Auto-publish > Generate: the colour of the frames has no default, needs the approver\'s name, and is recorded with it; the Queue lists sequences skipped for it and where the waiting ones are', async ({ page, api }) => {
    api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'Brynley', at: '2026-11-19T10:00:00Z' }, generate: { enabled: true, where: 'local', preset: 'review', max_per_day: 20, settle_minutes: 5, fallback_local: false, colour_in: null } }
    api.state.autopublish = { generate: { enabled: true, where: 'local', generating: 0, generated_today: 0, max_per_day: 20, failed: [], skipped: [{ stem: 'MAP-066_A', reason: 'colour not stated' }], waiting_to_settle: [{ stem: 'CGI-042_A', source: 'volume', since: new Date(Date.now() - 120000).toISOString() }] } }
    const d = await openAutopublish(page)
    const sel = d.getByTestId('config-autopublish-generate-colour'); await expect(sel).toHaveValue(''); await expect(d.getByTestId('config-autopublish-generate-colour-help')).toHaveText('You are stating this conversion; it is recorded with your name.')
    await expect(d.getByTestId('autopublish-generate-waiting-title')).toHaveText('Waiting for frames to settle (1)'); await expect(d.getByTestId('autopublish-generate-waiting-place')).toHaveText('RunPod volume'); await expect(d.getByTestId('autopublish-generate-colour-skipped')).toContainText('colour not stated: set it in Auto-publish > Generate')
    await sel.selectOption('p3-d65-gamma26'); const who = d.getByTestId('config-autopublish-generate-colour-approver'); await who.fill(''); await page.getByTestId('volumes-save').click(); await expect(d.getByTestId('autopublish-error')).toBeVisible(); expect(api.state.mountPuts || []).toHaveLength(0)
    await who.fill('Kyle'); await page.getByTestId('volumes-save').click(); await expect(page.getByTestId('volumes-saved')).toBeVisible()
    expect(api.state.mountPuts.at(-1).auto_publish).toMatchObject({ approved_by: 'Kyle', generate: { colour_in: 'p3-d65-gamma26' } })
  })
})
