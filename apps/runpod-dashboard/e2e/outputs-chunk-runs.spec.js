import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// Lucas, 2026-11-21: "why does my outputs say 5 of 70 frames". A chunked render (ADR-056) writes ONE sequence as a probe and several chunks, each its own ComfyUI run, into the same folder: the last chunk (frames 65-69)
// showed `Frames 5 / 70` in red because the check counted that run's frames. The check counts the union of the frames over every run listed; chunk runs of one graph and folder are ONE row; a tile holding only part
// of a larger sequence says "part of 70" in grey; red stays for a union that is really short, or has gaps.
const CLIP = 'CGI-072_BACKHALF-B_FINAL_V02_1920X1080_23.976_PRORES422HQ'
const DIR = `delivery_v008/${CLIP}`
const GRAPH = 'base_v008/cgi-072/cgi-072__backhalf-b__base_v008.json'
const EDL = { loaded: true, elements: [{ clip: CLIP, shot: 'cgi-072', element: 'backhalf-b', kind: 'dpx', version: 'v02', raster: '1920x1080', first_source_in: '00:00:00:00', frames_in_cut: 70, speeds: [], effects: [] }], events: 1, sha256: 'abc', loaded_at: '2026-11-21T09:00:00Z' }
const tinyDpx = () => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const frames = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => ({ filename: `${CLIP}.${String(a + i).padStart(4, '0')}.dpx`, subfolder: DIR, type: 'output' }))
const run = (n, outputs, extra = {}) => ({ prompt_id: `c0000000-00${String(n).padStart(2, '0')}-aaaa`, workflow: GRAPH, status: 'success', started_at: `2026-11-21T09:${String(10 + n).padStart(2, '0')}:00Z`, duration_s: 100, outputs, ...extra })
// the probe 0-9, chunks of 11 and the last of 5: 7 runs, 70 frames; run(n) is newer for a bigger n
const CHUNKS = [[0, 9], [10, 20], [21, 31], [32, 42], [43, 53], [54, 64], [65, 69]]
const chunkRuns = (list = CHUNKS) => list.map(([a, b], i) => run(i + 1, frames(a, b)))

async function open(page, api, runs, edl = EDL) {
  api.state.history.runs['pod-aaaaaaaa'] = runs   // only these runs: the fixture's own run would add a second gallery
  api.state.edl = edl
  await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tinyDpx() }).catch(() => {}))
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  return page.getByTestId('pod-outputs-modal')
}

test('7 chunk runs and a re-run are ONE row of 70 frames: no red badge, no "part of", the chunks listed on request', async ({ page, api }) => {
  const m = await open(page, api, [...chunkRuns(), run(9, frames(10, 20), { duration_s: 50 })])   // the re-run duplicates frames 10-20
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1)
  await expect(m.getByTestId('pod-outputs-chunks')).toHaveAttribute('data-chunks', '8')
  await expect(m.getByTestId('pod-outputs-chunks')).toHaveText('8 chunks')
  const tile = m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')
  await expect(tile).toHaveCount(1)
  await expect(tile).toHaveAttribute('data-frames', '70')                  // the union, the re-run counted once
  await expect(m.getByTestId('outputs-dpx-frames')).toHaveCount(0)         // 70 of 70: nothing red
  await expect(m.getByTestId('outputs-dpx-part')).toHaveCount(0)
  await expect(m.getByTestId('pod-outputs-chunk-list')).toHaveCount(0)
  await m.getByTestId('pod-outputs-chunks-toggle').click()
  await expect(m.getByTestId('pod-outputs-chunk-row')).toHaveCount(8)
  await m.getByTestId('pod-outputs-chunks-toggle').click()
  await expect(m.getByTestId('pod-outputs-chunk-list')).toHaveCount(0)
})

test('a sequence that is really short is INCOMPLETE: hidden by default and counted, Show Incomplete lists it in its group with a grey Frames 60 / 70', async ({ page, api }) => {
  const m = await open(page, api, chunkRuns([[0, 9], [10, 20], [21, 31], [32, 42], [43, 53], [54, 59]]))   // frames 0-59 only
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(0)                    // its only content is incomplete: the run is not listed
  await expect(m.getByTestId('outputs-incomplete-hidden')).toHaveText('1 hidden')
  await expect(m.getByTestId('outputs-incomplete-show')).toHaveText('Show Incomplete (1)')
  await m.getByTestId('outputs-incomplete-show').click()
  await expect(m.getByTestId('outputs-incomplete-hidden')).toHaveCount(0)
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1)
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(0)   // not in the grid
  const group = m.getByTestId('outputs-incomplete-group')
  await expect(group.getByTestId('outputs-incomplete-label')).toHaveText('1 Incomplete Sequences')
  await expect(group).toHaveAttribute('data-expanded', 'false')                    // collapsed
  await group.getByTestId('outputs-incomplete-toggle').click()
  await expect(group.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveAttribute('data-frames', '60')
  await expect(group.getByTestId('outputs-dpx-incomplete')).toHaveText('Frames 60 / 70')   // grey, with the reason in its title
  await expect(group.getByTestId('outputs-dpx-incomplete')).toHaveAttribute('title', /Incomplete: 60 frames of the 70/)
  await expect(m.getByTestId('outputs-dpx-frames')).toHaveCount(0)                  // never red for being short
  await m.getByTestId('outputs-incomplete-show').click()                             // Hide Incomplete (1): gone again
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(0)
})

const HADAL = 'PHOTOREAL-013_HADAL_FINAL_V01_1920X1080_24_HEVC'
const hadal = (n, sub, count, extra = {}) => ({ prompt_id: `h0000000-00${String(n).padStart(2, '0')}-bbbb`, workflow: `chunk_proof/hadal_p${count}.json`, status: 'success', started_at: `2026-11-21T08:${String(10 + n).padStart(2, '0')}:00Z`, duration_s: 60, outputs: Array.from({ length: count }, (_, i) => ({ filename: `${HADAL}.${String(i).padStart(4, '0')}.dpx`, subfolder: sub, type: 'output' })), ...extra })
const EDL2 = { ...EDL, elements: [...EDL.elements, { clip: HADAL, shot: 'photoreal-013', element: 'hadal', kind: 'dpx', version: 'v01', raster: '1920x1080', first_source_in: '00:00:00:00', frames_in_cut: 160, speeds: [], effects: [] }] }

test('hadal_p10 and hadal_p30 (partial renders of 160) are hidden; a complete 7-chunk element and a sequence with no EDL entry stay; the counts are right', async ({ page, api }) => {
  const noEdl = run(20, Array.from({ length: 20 }, (_, i) => ({ filename: `ZZZ-999_ONLY_V01.${String(i).padStart(4, '0')}.dpx`, subfolder: 'misc/zzz', type: 'output' })), { workflow: 'misc/zzz.json' })
  const m = await open(page, api, [hadal(1, 'chunk_proof/hadal_p10', 10), hadal(2, 'chunk_proof/hadal_p30', 30), ...chunkRuns(), noEdl], EDL2)
  await expect(m.getByTestId('outputs-incomplete-show')).toHaveText('Show Incomplete (2)')       // p10 and p30; the no-EDL one and the complete element are not incomplete
  await expect(m.getByTestId('outputs-incomplete-hidden')).toHaveText('2 hidden')
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(2)                                    // the merged 7-chunk element and the no-EDL sequence
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(2)
  await expect(m.getByTestId('pod-outputs-chunks')).toHaveText('7 chunks')
  await m.getByTestId('outputs-incomplete-show').click()
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(4)
  await expect(m.getByTestId('outputs-incomplete-group')).toHaveCount(2)                           // one group in each of the two runs
  for (const g of await m.getByTestId('outputs-incomplete-group').all()) await g.getByTestId('outputs-incomplete-toggle').click()
  const chips = m.getByTestId('outputs-dpx-incomplete')
  await expect(chips).toHaveCount(2)
  await expect(chips.nth(0)).toHaveText(/Frames (10|30) \/ 160/)
  await expect(m.getByTestId('outputs-dpx-frames')).toHaveCount(0)
  await expect(m.getByTestId('outputs-dpx-part')).toHaveCount(0)
})

test('a run that has other content stays listed with its incomplete sequence hidden: the video shows, the group only with Show Incomplete', async ({ page, api }) => {
  const mixed = hadal(1, 'chunk_proof/hadal_p10', 10)
  mixed.outputs.push({ filename: 'review.mp4', subfolder: 'chunk_proof/hadal_p10', type: 'output' })
  const m = await open(page, api, [mixed], EDL2)
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1)
  await expect(m.getByTestId('outputs-incomplete-hidden')).toHaveCount(0)                          // not a hidden run
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveCount(0)
  await expect(m.getByTestId('outputs-incomplete-group')).toHaveCount(0)
  await expect(m.getByTestId('outputs-incomplete-show')).toHaveText('Show Incomplete (1)')
  await m.getByTestId('outputs-incomplete-show').click()
  await expect(m.getByTestId('outputs-incomplete-group').getByTestId('outputs-incomplete-label')).toHaveText('1 Incomplete Sequences')
})

test('a gap is red too: 70 frames that are 0-34 and 40-74 say Gaps in frames 0-74', async ({ page, api }) => {
  const m = await open(page, api, chunkRuns([[0, 34], [40, 74]]))
  await expect(m.getByTestId('outputs-dpx-frames')).toHaveText('Gaps in frames 0-74')
})

test('runs of different graphs that share the folder are not merged: the tile with the last chunk says part of 70 in grey, never red', async ({ page, api }) => {
  const m = await open(page, api, [run(1, frames(0, 64), { workflow: 'a/first.json' }), run(2, frames(65, 69), { workflow: 'b/second.json' })])
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(2)             // different graphs: two rows, no chunk badge
  await expect(m.getByTestId('pod-outputs-chunks')).toHaveCount(0)
  await expect(m.getByTestId('outputs-dpx-frames')).toHaveCount(0)          // the union is 70 of 70
  const part = m.getByTestId('outputs-dpx-part')
  await expect(part).toHaveCount(2)                                          // each tile holds part of the 70
  const last = m.locator('[data-testid="pod-outputs-run"]').filter({ hasText: 'second' }).getByTestId('outputs-dpx-part')
  await expect(last).toHaveText('part of 70')
  await expect(last).toHaveAttribute('data-range', '65-69')
})
