import { test, expect, podCard, fileTiles } from './fixtures'
import { t } from './i18n'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// The colour of a DPX sequence is visible twice (docs/ADR-048, amendment 2026-11-20): chips on the Outputs tile and a Colour panel in the viewer. The ComfyUI-OCIO record `<stem>.json` beside the frames says what
// the writer made (Gamma 2.6 P3-D65); the header says what it says (linear). Both are shown, and where they disagree the header chip is amber.
const SUB = 'canal/mono_v015'
const STEMS = { rec: 'archival-080_b_mono_v018_NOT_RELEASED', none: 'archival-081_plain_v001', bad: 'archival-082_broken_v002' }
const frame = (stem, n) => `${stem}.${String(n).padStart(4, '0')}.dpx`
const RECORD = JSON.stringify({ file: 'x.0000.dpx', writer: 'ComfyUI-OCIO', codec: 'dpx 16', attributes: { chromaticities: [0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.3127, 0.329], 'com.ocio.gamut': 'P3-D65', colorInteropID: 'g26_p3d65_display', 'com.ocio.colorspace': 'Gamma 2.6 P3-D65 - Display', fps: 24 } })
const CORS = { 'access-control-allow-origin': '*' }

async function setup(page, api, { asked = [] } = {}) {
  const outputs = Object.values(STEMS).flatMap((stem) => [0, 1].map((n) => ({ filename: frame(stem, n), subfolder: SUB, type: 'output' })))
  api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'cccccccc-1111-2222', workflow: 'rounds/r1/archival-080/mono.json', status: 'success', started_at: '2026-11-20T10:00:00Z', duration_s: 80, cost_estimate: 0.02, outputs })
  await page.context().route('**/view?*', (r) => {
    const name = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1])
    asked.push(name)
    if (name === `${STEMS.rec}.json`) return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: RECORD })
    if (name === `${STEMS.none}.json`) return r.fulfill({ status: 404, contentType: 'text/plain', headers: CORS, body: 'not found' })
    if (name === `${STEMS.bad}.json`) return r.abort('failed')   // the read itself fails
    if (name.endsWith('.dpx')) {   // every header says linear (transfer 2), except the plain sequence: printing density (1) with a television timecode
      const plain = name.startsWith(STEMS.none)
      return r.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: makeDpx({ width: 16, height: 8, bits: 16, transfer: plain ? 1 : 2, colorimetric: plain ? 1 : 2, timecode: plain ? 0x10203004 : 0x01020304, fn: (x, y, c) => 20000 + x * 500 + y * 300 + c * 1000 }) })
    }
    return r.fulfill({ status: 200, contentType: 'text/plain', headers: CORS, body: '{}' })
  })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  return page.getByTestId('pod-outputs-modal')
}
/** Nothing downloads by itself: a frame's header is known once its preview was made, so the chips of a sequence get their header chip after Load preview. */
const preview = async (tile) => { await tile.getByTestId('outputs-dpx-load-preview').click(); await expect(tile.getByTestId('outputs-dpx-thumb')).toBeVisible() }
const tileOf = (m, stem) => m.locator(`[data-testid="outputs-tile"][data-kind="dpx"][title*="${stem}"]`)

test('Outputs: a sequence with a record shows its colour space and an amber chip when the header says linear; with no record the header\'s own words in grey; an unreadable record shows nothing', async ({ page, api }) => {
  const asked = []
  const m = await setup(page, api, { asked })
  const rec = tileOf(m, STEMS.rec)
  await expect(rec.getByTestId('outputs-dpx-colour-record')).toHaveText('Gamma 2.6 P3-D65')   // the record needs no frame: it shows as soon as the tile is on screen
  await expect(rec.getByTestId('outputs-dpx-colour-header')).toHaveCount(0)   // the header is not known yet: no frame was downloaded
  expect(asked.filter((n) => n.endsWith('.dpx'))).toEqual([])
  for (const s of Object.values(STEMS)) await preview(tileOf(m, s))
  const amber = rec.getByTestId('outputs-dpx-colour-header')
  await expect(amber).toHaveText(t('outputs.dpx.colour.headerSays', { name: 'linear' }))
  await expect(amber).toHaveAttribute('data-disagrees', 'true'); await expect(amber).toHaveClass(/text-bg-warning/)
  await expect(rec.getByTestId('outputs-dpx-colour-record')).toHaveClass(/text-bg-secondary/)

  const none = tileOf(m, STEMS.none)
  const grey = none.getByTestId('outputs-dpx-colour-header')
  await expect(grey).toHaveText(t('outputs.dpx.colour.headerIs', { name: 'printing density' }))
  await expect(grey).toHaveAttribute('data-disagrees', 'false'); await expect(grey).toHaveClass(/text-bg-secondary/)
  await expect(none.getByTestId('outputs-dpx-colour-record')).toHaveCount(0)

  // a record that cannot be read: no record chip, the header's words only, and the window is not disturbed
  const bad = tileOf(m, STEMS.bad)
  await expect(bad.getByTestId('outputs-dpx-colour-header')).toHaveText(t('outputs.dpx.colour.headerIs', { name: 'linear' }))
  await expect(bad.getByTestId('outputs-dpx-colour-record')).toHaveCount(0)
  await expect(fileTiles(m)).toHaveCount(3 + 1 /* the older run's plate */)

  // the record is read once per sequence, and only the first frame of each sequence was downloaded (for its preview)
  expect(asked.filter((n) => n === `${STEMS.rec}.json`).length).toBe(1)
  expect([...new Set(asked.filter((n) => n.endsWith('.dpx')))].sort()).toEqual(Object.values(STEMS).map((s) => frame(s, 0)).sort())
})

test('Outputs: a refresh asks for the record again', async ({ page, api }) => {
  const asked = []
  const m = await setup(page, api, { asked })
  await expect(tileOf(m, STEMS.rec).getByTestId('outputs-dpx-colour-record')).toBeVisible()
  const before = asked.filter((n) => n === `${STEMS.rec}.json`).length
  await m.getByTestId('pod-outputs-refresh').click()
  await expect.poll(() => asked.filter((n) => n === `${STEMS.rec}.json`).length).toBeGreaterThan(before)
})

test('Viewer: one line under the title, a closed Colour panel that lists the header and the record, and the verdict', async ({ page, api }) => {
  const m = await setup(page, api)
  await tileOf(m, STEMS.rec).click()
  const v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-title')).toHaveText(frame(STEMS.rec, 0))
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveAttribute('data-drawn', '0')
  await expect(v.getByTestId('dpx-viewer-colour-summary')).toHaveText('Gamma 2.6 P3-D65 (OCIO record) · header: linear')
  await expect(v.getByTestId('dpx-viewer-colour-disagree')).toHaveText(t('outputs.dpx.colour.disagree'))
  await expect(v.getByTestId('dpx-viewer-colour-panel')).toHaveCount(0)   // closed by default
  await expect(v.getByTestId('dpx-viewer-colour-note')).toHaveText(t('outputs.dpx.colour.previewNote'))
  await v.getByTestId('dpx-viewer-colour-toggle').click()
  const header = v.getByTestId('dpx-viewer-colour-header-rows'), record = v.getByTestId('dpx-viewer-colour-record-rows')
  await expect(header.locator('[data-field="transfer"]')).toHaveText('linear (2)')
  await expect(header.locator('[data-field="colorimetric"]')).toHaveText('linear (2)')
  await expect(header.locator('[data-field="descriptor"]')).toHaveText('RGB')
  await expect(header.locator('[data-field="bits"]')).toHaveText('16')
  await expect(header.locator('[data-field="packing"]')).toHaveText('packed')
  await expect(header.locator('[data-field="encoding"]')).toHaveText('none')
  await expect(header.locator('[data-field="size"]')).toHaveText('16 x 8')
  await expect(header.locator('[data-field="timecode"]')).toHaveText('01:02:03:04')
  await expect(record.locator('[data-field="colourSpace"]')).toHaveText('Gamma 2.6 P3-D65 - Display')
  await expect(record.locator('[data-field="interop"]')).toHaveText('g26_p3d65_display')
  await expect(record.locator('[data-field="gamut"]')).toHaveText('P3-D65')
  await expect(record.locator('[data-field="chromaticities"]')).toHaveText('R 0.68, 0.32 · G 0.265, 0.69 · B 0.15, 0.06 · W 0.3127, 0.329')
  await expect(record.locator('[data-field="writer"]')).toHaveText('ComfyUI-OCIO')
  await expect(record.locator('[data-field="fps"]')).toHaveText('24')
  await expect(v.getByTestId('dpx-viewer-colour-verdict')).toHaveText(t('outputs.dpx.colour.convertsFrom', { colour: 'p3-d65-gamma26', source: t('outputs.dpx.colour.sourceRecord') }))
  await v.getByTestId('dpx-viewer-colour-toggle').click()
  await expect(v.getByTestId('dpx-viewer-colour-panel')).toHaveCount(0)
  // the next frame keeps the colour line (same sequence, same record) and still draws
  await v.getByTestId('dpx-viewer-next').click()
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveAttribute('data-drawn', '1')
  await expect(v.getByTestId('dpx-viewer-colour-summary')).toHaveText('Gamma 2.6 P3-D65 (OCIO record) · header: linear')
})

test('Viewer: with no record the summary is the header\'s words and the verdict says nothing is stated; with an unreadable record the picture still draws', async ({ page, api }) => {
  const m = await setup(page, api)
  await tileOf(m, STEMS.none).click()
  let v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveAttribute('data-drawn', '0')
  await expect(v.getByTestId('dpx-viewer-colour-summary')).toHaveText('header: printing density')
  await expect(v.getByTestId('dpx-viewer-colour-disagree')).toHaveCount(0)
  await v.getByTestId('dpx-viewer-colour-toggle').click()
  await expect(v.getByTestId('dpx-viewer-colour-no-record')).toHaveText(t('outputs.dpx.colour.noRecord', { file: `${STEMS.none}.json` }))
  await expect(v.getByTestId('dpx-viewer-colour-header-rows').locator('[data-field="timecode"]')).toHaveText('10:20:30:04')
  await expect(v.getByTestId('dpx-viewer-colour-verdict')).toHaveText(t('outputs.dpx.colour.convertsNone'))
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('dpx-viewer')).toHaveCount(0)

  await tileOf(m, STEMS.bad).click()
  v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveAttribute('data-drawn', '0')
  await expect(v.getByTestId('dpx-viewer-colour-summary')).toHaveText('header: linear')
  await expect(v.getByTestId('dpx-viewer-error')).toHaveCount(0)
  await expect(v.getByTestId('dpx-viewer-frame')).toHaveText(/1 \/ 2/)
})
