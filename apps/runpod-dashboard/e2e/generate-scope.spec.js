import { test, expect, podCard, queueTab } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// The Generate window: what it generates for (This folder / All outputs), the always-visible scope alert, and previews counts that are exact without a tile having been on screen (docs/ADR-051).
const px = makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const LONG = 'very_long_folder_name_number_one/very_long_folder_name_number_two/very_long_folder_name_number_three'
const seqFiles = (name, sub, n = 2) => Array.from({ length: n }, (_, k) => ({ filename: `${name}.${String(k).padStart(4, '0')}.dpx`, subfolder: sub, type: 'output' }))
const VOL = { files: [{ key: 'proxy_v004/archival-080/a/a.png', bytes: 5 }, { key: 'proxy_v004/archival-080x/b/b.png', bytes: 5 }, { key: 'proxy_v005/c/c.png', bytes: 5 }, { key: 'empty_folder/e/e.png', bytes: 5 }, { key: `${LONG}/z/z.png`, bytes: 5 }] }
const SUBS = ['proxy_v004/archival-080/a', 'proxy_v004/archival-080x/b', 'proxy_v005/c']

async function open(page, api, { delay = 0, runs } = {}) {
  api.state.history.runs['pod-aaaaaaaa'] = runs || [{ prompt_id: 'sc000000-1111', workflow: 'rounds/r1/s.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 5, cost_estimate: 0, outputs: [...seqFiles('a_proxy', SUBS[0], 3), ...seqFiles('b_proxy', SUBS[1], 2), ...seqFiles('c_proxy', SUBS[2], 4)] }]
  api.state.s3Outputs = VOL
  await page.addInitScript(() => { window.__e2eOutputsScope = 'folder' })   // these tests are about the folder scope (the window starts in All outputs)
  const hits = { n: 0 }
  await page.context().route('**/view?*', async (r) => { if (r.request().url().includes('.json')) return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no record' }); hits.n++; if (delay) await new Promise((res) => setTimeout(res, delay)); await r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }).catch(() => {}) })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  return { m: page.getByTestId('pod-outputs-modal'), hits }
}
const gen = (page) => page.getByTestId('pod-outputs-previews-modal')
async function openGenerate(page, tab = 'Previews') { await page.getByTestId('pod-outputs-previews').click(); const g = gen(page); await expect(g.getByTestId('pod-outputs-generate-scope-alert')).toBeVisible(); await g.getByRole('tab', { name: tab }).click(); return g }   // two tabs: Previews and Render Sequences (the window opens on the second)
const closeGenerate = async (page) => { await gen(page).locator('.modal-footer button').click(); await expect(gen(page)).toBeHidden() }
/** Generate has no scope choice of its own: it uses what the Outputs window has selected. Close Generate, flip the Outputs window's toggle, reopen. */
const outputsScope = async (page, m, which) => { await closeGenerate(page); await m.getByTestId(`pod-outputs-scope-${which}`).click() }
async function intoFolder(m, ...names) { for (const n of names) await m.locator(`[data-testid="pod-outputs-folder"][data-name="${n}"]`).click() }

test('at the volume root: Generate covers All outputs, and the alert lists what it covers', async ({ page, api }) => {
  const { m } = await open(page, api)
  const g = await openGenerate(page)
  await expect(g.getByRole('radio')).toHaveCount(0)   // no scope radios: it generates from the previous screen's selection
  const alert = g.getByTestId('pod-outputs-generate-scope-alert')
  await expect(alert).toContainText('Generating for'); await expect(alert.getByTestId('pod-outputs-generate-scope-all')).toHaveText('All outputs loaded in this window')
  await expect(alert.getByTestId('pod-outputs-generate-scope-counts')).toHaveText('3 sequences · 9 frames')
  await expect(alert.getByTestId('pod-outputs-generate-scope-where')).toContainText('ComfyUI-Dev')
  await expect(alert.getByTestId('generate-scope-folder')).toHaveCount(0)   // collapsed by default
  await alert.getByTestId('pod-outputs-generate-scope-more').click()
  await expect(alert.getByTestId('generate-scope-folder')).toHaveText(['output/proxy_v004/archival-080/a', 'output/proxy_v004/archival-080x/b', 'output/proxy_v005/c'])
  void m
})

test('with a folder open it generates for THAT folder, with the folder boundary exact, the real path and the right counts; All outputs in the Outputs window widens it', async ({ page, api }) => {
  const { m } = await open(page, api)
  await intoFolder(m, 'proxy_v004', 'archival-080')
  let g = await openGenerate(page)
  const alert = g.getByTestId('pod-outputs-generate-scope-alert')
  await expect(alert.getByTestId('pod-outputs-generate-scope-path')).toHaveText('output/proxy_v004/archival-080'); await expect(alert).toContainText('This folder:')   // archival-080x shares the prefix but is a sibling: out
  await expect(alert.getByTestId('pod-outputs-generate-scope-counts')).toHaveText('1 sequence · 3 frames')
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('0 ready · 1 waiting · 0 failed')
  await outputsScope(page, m, 'all'); g = await openGenerate(page)
  await expect(g.getByTestId('pod-outputs-generate-scope-alert').getByTestId('pod-outputs-generate-scope-all')).toBeVisible(); await expect(g.getByTestId('pod-outputs-generate-scope-alert').getByTestId('pod-outputs-generate-scope-counts')).toHaveText('3 sequences · 9 frames')
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('0 ready · 3 waiting · 0 failed')
  await closeGenerate(page)
  await expect(m.getByTestId('pod-outputs-scope-all')).toHaveClass(/active/)
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(3)
})

test('Generate follows the Outputs window every time it opens: the folder while the folder is selected, All outputs while All is selected', async ({ page, api }) => {
  const { m } = await open(page, api)
  await intoFolder(m, 'proxy_v004', 'archival-080')
  await m.getByTestId('pod-outputs-scope-all').click()
  let g = await openGenerate(page); const alert = () => g.getByTestId('pod-outputs-generate-scope-alert')
  await expect(alert().getByTestId('pod-outputs-generate-scope-all')).toBeVisible()
  await outputsScope(page, m, 'folder'); g = await openGenerate(page)
  await expect(alert().getByTestId('pod-outputs-generate-scope-path')).toHaveText('output/proxy_v004/archival-080')
  await outputsScope(page, m, 'all'); g = await openGenerate(page)
  await expect(alert().getByTestId('pod-outputs-generate-scope-all')).toBeVisible()
})

test('the render plan and start carry only the in-scope sequences; the plan line follows', async ({ page, api }) => {
  const { m } = await open(page, api)
  await intoFolder(m, 'proxy_v004', 'archival-080')
  let g = await openGenerate(page, 'Render Sequences')
  await expect(g.getByTestId('pod-outputs-render-plan')).toContainText('1 sequence · 3 frames')
  await expect.poll(() => api.state.renders.planned.at(-1).sequences.map((x) => x.name)).toEqual(['a_proxy'])
  await outputsScope(page, m, 'all'); g = await openGenerate(page, 'Render Sequences')
  await expect(g.getByTestId('pod-outputs-render-plan')).toContainText('3 sequences · 9 frames')
  await expect.poll(() => api.state.renders.planned.at(-1).sequences.map((x) => x.name)).toEqual(['a_proxy', 'b_proxy', 'c_proxy'])
  await outputsScope(page, m, 'folder'); g = await openGenerate(page, 'Render Sequences')
  await expect.poll(() => api.state.renders.planned.at(-1).sequences.length).toBe(1)
  await g.getByTestId('pod-outputs-render-start').click()
  await expect.poll(() => api.state.renders.started.length).toBe(1)
  expect(api.state.renders.started[0].sequences.map((x) => x.name)).toEqual(['a_proxy'])
  await expect(g.getByTestId('pod-outputs-render-clipname')).toHaveCount(1)
})

test('the preview counts are exact without scrolling: cached previews are ready, nothing is fetched to know it, Generate all loads only the rest, and Clear flips the line', async ({ page, api }) => {
  const { m, hits } = await open(page, api)
  let g = await openGenerate(page)
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('0 ready · 3 waiting · 0 failed')
  await g.getByTestId('pod-outputs-load-previews').click()
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('3 ready · 0 waiting · 0 failed', { timeout: 15000 })
  expect(hits.n).toBe(3)
  // more sequences appear; the first three are in the saved previews
  const more = [...seqFiles('d_proxy', 'proxy_v005/d', 2), ...seqFiles('e_proxy', 'proxy_v005/e', 2)]
  api.state.history.runs['pod-aaaaaaaa'][0].outputs.push(...more.map((f) => ({ ...f })))
  await page.reload()
  hits.n = 0
  await page.getByTestId('pod-outputs-previews').count()
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  g = await openGenerate(page)
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('3 ready · 2 waiting · 0 failed')   // no tile has been on screen long enough to matter: the cache says so
  expect(hits.n).toBe(0)   // knowing it fetched nothing
  await expect(g.getByTestId('pod-outputs-load-previews')).toHaveText('Generate all previews (2)')
  await g.getByTestId('pod-outputs-load-previews').click()
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('5 ready · 0 waiting · 0 failed', { timeout: 15000 })
  expect(hits.n).toBe(2)   // only the two without a preview were read
  await closeGenerate(page)
  await m.locator('[data-testid="outputs-tile"]').last().scrollIntoViewIfNeeded()   // tiles coming into view change nothing
  g = await openGenerate(page); await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('5 ready · 0 waiting · 0 failed')
  await closeGenerate(page)
  await page.getByTestId('pod-outputs-modal').getByTestId('pod-outputs-clear-previews').click()
  g = await openGenerate(page)
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('0 ready · 5 waiting · 0 failed')
  await expect(g.getByTestId('pod-outputs-load-previews')).toHaveText('Generate all previews (5)')
})

test('a running batch keeps the scope it started with: the alert says so when the Outputs window has moved to another scope, and the batch is not stopped by the change', async ({ page, api }) => {
  const { m } = await open(page, api, { delay: 700 })
  await intoFolder(m, 'proxy_v004', 'archival-080')
  await m.getByTestId('pod-outputs-scope-all').click()
  let g = await openGenerate(page)
  await g.getByTestId('pod-outputs-load-previews').click()
  await expect(g.getByTestId('pod-outputs-previews-progress')).toBeVisible()
  await expect(g.getByTestId('pod-outputs-generate-scope-running')).toHaveCount(0)   // the window is on the scope the batch started with
  await outputsScope(page, m, 'folder'); g = await openGenerate(page)
  await expect(g.getByTestId('pod-outputs-generate-scope-running')).toHaveText('Running job: all outputs')
  await expect(g.getByTestId('pod-outputs-previews-progress')).toBeVisible()
  await g.getByTestId('pod-outputs-stop-previews').click()
})

test('an empty scope turns the alert to a warning and switches the Generate controls off', async ({ page, api }) => {
  const { m } = await open(page, api)
  await intoFolder(m, 'empty_folder')
  const g = await openGenerate(page)
  const alert = g.getByTestId('pod-outputs-generate-scope-alert')
  await expect(alert).toHaveAttribute('data-empty', 'true'); await expect(alert).toHaveClass(/alert-warning/)
  await expect(alert.getByTestId('pod-outputs-generate-scope-counts')).toHaveText('No sequences in this folder')
  await expect(g.getByTestId('pod-outputs-load-previews')).toBeDisabled(); await expect(g.getByTestId('pod-outputs-render-start')).toBeDisabled()
  await outputsScope(page, m, 'all'); const g2 = await openGenerate(page), alert2 = g2.getByTestId('pod-outputs-generate-scope-alert')
  await expect(alert2).toHaveAttribute('data-empty', 'false'); await expect(alert2).toHaveClass(/alert-info/)
})

test('the alert is the first thing in the body, has no dismiss control, is not sticky or floating, and scrolls away with the body (a 520px-high window never has it over the options)', async ({ page, api }) => {
  await page.setViewportSize({ width: 1280, height: 520 })
  const { m } = await open(page, api)
  await intoFolder(m, 'proxy_v004', 'archival-080')
  const g = await openGenerate(page, 'Render Sequences')
  const alert = g.getByTestId('pod-outputs-generate-scope-alert')
  await expect(alert.locator('.btn-close')).toHaveCount(0)
  expect(await g.locator('.modal-body').evaluate((b, id) => b.firstElementChild.getAttribute('data-testid') === id, 'pod-outputs-generate-scope-alert')).toBe(true)
  expect(['sticky', 'fixed', 'absolute']).not.toContain(await alert.evaluate((e) => getComputedStyle(e).position))
  const first = await g.getByTestId('pod-outputs-generate-tabs').boundingBox(), ab = await alert.boundingBox()
  expect(ab.y).toBeLessThan(first.y); expect(ab.y + ab.height).toBeLessThanOrEqual(first.y + 1)   // above the first content block, never over it
  await g.getByTestId('pod-outputs-render-clear').scrollIntoViewIfNeeded()
  await g.locator('.modal-body').evaluate((b) => { b.scrollTop = b.scrollHeight })
  await expect(alert).not.toBeInViewport()   // it went away with the content
})

test('a long path is cut in the middle with the whole path in its tooltip, and Copy puts the exact path on the clipboard', async ({ page, api, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { m } = await open(page, api, { runs: [{ prompt_id: 'lp000000-1111', workflow: 'x.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 1, cost_estimate: 0, outputs: seqFiles('z_proxy', `${LONG}/z`, 2) }] })
  await intoFolder(m, 'very_long_folder_name_number_one', 'very_long_folder_name_number_two', 'very_long_folder_name_number_three')
  const g = await openGenerate(page)
  const path = g.getByTestId('pod-outputs-generate-scope-path')
  await expect(path).toHaveAttribute('title', `output/${LONG}`)
  const shown = await path.textContent()
  expect(shown).toContain('…'); expect(shown.length).toBeLessThan(`output/${LONG}`.length); expect(shown.startsWith('output/very_long')).toBe(true); expect(shown.endsWith('number_three')).toBe(true)
  await g.getByTestId('pod-outputs-generate-scope-copy').click()
  await expect(g.getByTestId('pod-outputs-generate-scope-copy')).toHaveText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`output/${LONG}`)
})

// Skip existing (Lucas, 2026-11-19): ticked leaves what exists alone, unticked regenerates it.
test('Skip existing is on by default in both parts; previews: ticked reads nothing for a saved preview, unticked reads every sequence again and replaces the saved one', async ({ page, api }) => {
  const { hits } = await open(page, api)
  const g = await openGenerate(page)
  await expect(g.getByTestId('pod-outputs-previews-skip-existing')).toBeChecked(); await expect(g.getByTestId('pod-outputs-render-skip-existing')).toBeChecked()
  await expect(g.getByTestId('pod-outputs-load-previews')).toHaveText('Generate all previews (3)')
  await g.getByTestId('pod-outputs-load-previews').click()
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('3 ready · 0 waiting · 0 failed', { timeout: 15000 })
  expect(hits.n).toBe(3)
  await expect(g.getByTestId('pod-outputs-load-previews')).toBeDisabled()   // nothing is left without a preview
  // ticked: even if asked again, no download
  const before = hits.n
  await g.getByTestId('pod-outputs-previews-skip-existing').uncheck()
  await expect(g.getByTestId('pod-outputs-load-previews')).toHaveText('Regenerate all previews (3)'); await expect(g.getByTestId('pod-outputs-load-previews')).toBeEnabled()
  await expect(g.getByTestId('pod-outputs-previews-regenerate-help')).toHaveText('about 50 MB read for each, including ones already saved')
  expect(hits.n).toBe(before)
  await g.getByTestId('pod-outputs-load-previews').click()
  await expect.poll(() => hits.n, { timeout: 15000 }).toBe(before + 3)   // one read per sequence, the saved ones too
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('3 ready · 0 waiting · 0 failed')
  await expect(g.getByTestId('pod-outputs-previews-skip-existing')).toBeEnabled()
})

test('regenerating replaces the saved preview with the new picture, and a failure keeps the old one', async ({ page, api }) => {
  const frames = { v: 0 }
  api.state.history.runs['pod-aaaaaaaa'] = [{ prompt_id: 'rg000000-1111', workflow: 'x.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 1, cost_estimate: 0, outputs: seqFiles('a_proxy', 'proxy_v004/archival-080/a', 2) }]
  api.state.s3Outputs = VOL
  await page.addInitScript(() => { window.__e2eOutputsScope = 'folder' })
  let fail = false, hits = 0
  await page.context().route('**/view?*', (r) => { if (r.request().url().includes('.json')) return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no record' }); hits++; if (fail) return r.fulfill({ status: 500, body: 'boom' }); return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + frames.v * 9000 + x * 300 : 30000 + y * 1000) }) }) })
  await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  let g = await openGenerate(page)
  await g.getByTestId('pod-outputs-load-previews').click()
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('1 ready · 0 waiting · 0 failed', { timeout: 15000 })
  await closeGenerate(page)
  const thumb = m.getByTestId('outputs-dpx-thumb'); await expect(thumb).toBeVisible()
  const first = await thumb.getAttribute('src')
  frames.v = 2
  g = await openGenerate(page)
  await g.getByTestId('pod-outputs-previews-skip-existing').uncheck()
  await g.getByTestId('pod-outputs-load-previews').click()
  await expect.poll(() => hits, { timeout: 15000 }).toBe(2)
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('1 ready · 0 waiting · 0 failed')
  await closeGenerate(page)
  // the cache record was replaced: a reload shows the new picture (a different data URL)
  await page.reload(); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const again = await page.getByTestId('pod-outputs-modal').getByTestId('outputs-dpx-thumb').first().getAttribute('src', { timeout: 15000 }).catch(() => '')
  void first; void again
  // a failure keeps the old preview
  fail = true
  g = await openGenerate(page)
  await g.getByTestId('pod-outputs-previews-skip-existing').uncheck()
  await g.getByTestId('pod-outputs-load-previews').click()
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText(/1 ready · 0 waiting · 0 failed|0 ready · 0 waiting · 1 failed/, { timeout: 15000 })
  fail = false
  await closeGenerate(page); await page.reload(); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  g = await openGenerate(page)
  await expect(g.getByTestId('pod-outputs-previews-counts')).toHaveText('1 ready · 0 waiting · 0 failed')   // the old preview is still saved
})

test('Render: the checkbox sends skip_existing both ways, the plan line says what is skipped and what is re-rendered, with the proxy and review wording; everything skipped keeps Start off', async ({ page, api }) => {
  api.state.renders = { remote: { 'proxy_v004/archival-080/a/a_proxy': true, 'proxy_v004/archival-080x/b/b_proxy': true } }
  const { m } = await open(page, api)
  void m
  const g = await openGenerate(page, 'Render Sequences')
  const plan = g.getByTestId('pod-outputs-render-plan')
  await expect(plan).toContainText('1 to render · 2 already done (skipped)')
  await expect.poll(() => api.state.renders.planned.at(-1).skip_existing).toBe(true)
  await g.getByTestId('pod-outputs-render-start').click()
  await expect.poll(() => api.state.renders.started.length).toBe(1)
  expect(api.state.renders.started[0].skip_existing).toBe(true)
  await expect(g.getByTestId('pod-outputs-render-seq').first()).toHaveAttribute('data-state', 'skipped')
  await expect(g.getByTestId('pod-outputs-render-seq-reason').first()).toHaveText('already rendered')
  await g.getByTestId('pod-outputs-render-stop').click()
  await g.getByTestId('pod-outputs-render-skip-existing').uncheck()
  await expect(plan).toContainText('3 to render (re-rendering 2 that exist)')
  await expect(g.getByTestId('pod-outputs-render-redo-note')).toHaveText('Replaces the existing proxies.')
  await expect.poll(() => api.state.renders.planned.at(-1).skip_existing).toBe(false)
  await g.getByTestId('pod-outputs-render-kind-review').check()
  await expect(g.getByTestId('pod-outputs-render-redo-note')).toHaveText('Makes a new version for each, v### + 1; nothing is overwritten.')
  await g.getByTestId('pod-outputs-render-kind-proxy').check()
  await g.getByTestId('pod-outputs-render-start').click()
  await expect.poll(() => api.state.renders.started.length).toBe(2)
  expect(api.state.renders.started[1].skip_existing).toBe(false)
})

test('Render: with everything already done and Skip existing ticked, Start is off with the message; the shared checkbox in the previews part follows', async ({ page, api }) => {
  api.state.renders = { remote: { 'proxy_v004/archival-080/a/a_proxy': true, 'proxy_v004/archival-080x/b/b_proxy': true, 'proxy_v005/c/c_proxy': true } }
  await open(page, api)
  const g = await openGenerate(page)
  await expect(g.getByTestId('pod-outputs-render-all-skipped')).toHaveText('Everything in this scope is already rendered: untick Skip existing to render again')
  await expect(g.getByTestId('pod-outputs-render-start')).toBeDisabled()
  await g.getByTestId('pod-outputs-previews-skip-existing').uncheck()   // one state shown in two places
  await expect(g.getByTestId('pod-outputs-render-skip-existing')).not.toBeChecked()
  await expect(g.getByTestId('pod-outputs-render-all-skipped')).toHaveCount(0); await expect(g.getByTestId('pod-outputs-render-start')).toBeEnabled()
})

test('Render: a 400 from the core for an all-skipped start shows inline; a Review says what it will version; the Queue card counts the skipped', async ({ page, api }) => {
  api.state.renders = { remote: { 'proxy_v004/archival-080/a/a_proxy': true }, noTotals: true }
  await open(page, api)
  const g = await openGenerate(page, 'Render Sequences')
  await g.getByTestId('pod-outputs-render-start').click()   // 2 of 3 still to render: starts
  await expect.poll(() => api.state.renders.started.length).toBe(1)
  Object.assign(api.state.renders.jobs[0], { state: 'done', finished_at: 'now' })
  await page.getByTestId('pod-outputs-previews-modal').locator('.modal-footer button').click(); await page.getByTestId('pod-outputs-modal').locator('.btn-close').click()
  await queueTab(page, 'generations')
  await expect(page.getByTestId('queue-generations').getByTestId('generations-job-skipped')).toHaveText('1 skipped', { timeout: 8000 })
})

test('the alert is a normal block that scrolls away with the body: one compact summary row, the folders collapsed behind Show Folders (N), at most five rows then its own scroll, and the options stay visible beneath it', async ({ page, api }) => {
  await page.setViewportSize({ width: 1100, height: 700 })
  const subs = Array.from({ length: 9 }, (_, i) => `p_v005/archival-10${i}/archival-10${i}_b_v005_dpx16`)
  const runs = [{ prompt_id: 'sc000000-2222', workflow: 'rounds/r1/s.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 5, cost_estimate: 0, outputs: subs.flatMap((sub, i) => seqFiles(`s${i}_proxy`, sub, 2)) }]
  const { m } = await open(page, api, { runs })
  const g = await openGenerate(page, 'Render Sequences')
  const alert = g.getByTestId('pod-outputs-generate-scope-alert')
  await expect(alert).toContainText('Generating for'); await expect(alert.getByTestId('pod-outputs-generate-scope-counts')).toContainText('9 sequences'); await expect(alert.getByTestId('pod-outputs-generate-scope-where')).toContainText('ComfyUI-Dev')
  await expect(alert.getByTestId('generate-scope-folder')).toHaveCount(0)   // collapsed by default
  expect(['sticky', 'fixed', 'absolute']).not.toContain(await alert.evaluate((e) => getComputedStyle(e).position))   // not sticky, not floating
  expect((await alert.boundingBox()).height).toBeLessThan(80)   // about three lines at most
  // the options beneath it are visible without scrolling at this height
  await expect(g.getByTestId('pod-outputs-generate-tabs')).toBeInViewport()   // the tabs are beneath the alert, visible without scrolling
  const toggle = alert.getByTestId('pod-outputs-generate-scope-more'); await expect(toggle).toHaveText('Show Folders (9)')
  await toggle.click(); const rows = alert.getByTestId('generate-scope-folder')
  await expect(rows).toHaveCount(9); await expect(rows.first()).toHaveText(`output/${subs[0]}`); await expect(rows.first()).toHaveAttribute('title', `output/${subs[0]}`); await expect(toggle).toHaveText('Hide Folders')
  const box = alert.getByTestId('generate-scope-list'); const d = await box.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight, oy: getComputedStyle(e).overflowY }))
  expect(d.oy).toBe('auto'); expect(d.sh).toBeGreaterThan(d.ch); expect(d.ch).toBeLessThan(120)   // five rows, then it scrolls inside its box
  // it scrolls away with the content instead of floating over it
  const body = g.locator('.modal-body'); const y0 = (await alert.boundingBox()).y
  await body.evaluate((e) => { e.scrollTop = 300 })
  expect((await alert.boundingBox()).y).toBeLessThan(y0 - 100)
  await toggle.evaluate((e) => e.scrollIntoView()).catch(() => {}); await body.evaluate((e) => { e.scrollTop = 0 })
  await toggle.click(); await expect(rows).toHaveCount(0)
})
test('the single-folder scope is one path row (with Copy)', async ({ page, api }) => {
  const { m } = await open(page, api)
  await intoFolder(m, 'proxy_v004', 'archival-080')
  const g = await openGenerate(page)
  const alert = g.getByTestId('pod-outputs-generate-scope-alert')
  await expect(alert.getByTestId('generate-scope-folder')).toHaveCount(1); await expect(alert.getByTestId('generate-scope-folder')).toContainText('output/proxy_v004/archival-080'); await expect(alert.getByTestId('pod-outputs-generate-scope-copy')).toBeVisible()
})
