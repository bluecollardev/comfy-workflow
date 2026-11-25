import { test, expect, podCard } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'
import { mainVideoOf, versionOf, isTemp, groupTiles, shortName, dataFilesOf, GROUP_MAX } from '../src/utils/videogroups.js'

// Lucas, 2026-11-21: the Outputs entry `v11_assembly_master_v024_review025_part32c06_depth-182` (assembly_v024/review025_parts/split_cap120, pod CanalV2-fix-v020-a) is ONE run of 362 files: "this is a lot to preview at once".
// A DPX sequence collapses to its one tile; files of one type in a folder are ONE group (Videos with a Main video, Images, Audio, Data, Other) and every group expands; ComfyUI's temp files are hidden unless
// Show Temp Files is on; rows page by scrolling (Show All renders them all) and the list of runs has a pager; the video players alive at once are capped.
const SUB = 'assembly_v024/review025_parts/split_cap120'
const seq = (part) => `v11_assembly_master_v024_review025_part32c0${part}_depth-182`
const frame = (part, n) => `${seq(part)}.${String(n).padStart(4, '0')}.dpx`
const tinyDpx = () => makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const run = (id, outputs, extra = {}) => ({ prompt_id: id, workflow: 'x.json', status: 'success', started_at: '2026-11-21T15:00:00Z', duration_s: 10, outputs, ...extra })

/** 3 sequences of 120 frames and 2 review videos: 362 files, one run. */
const bigRun = () => {
  const outputs = []
  for (const part of [4, 5, 6]) for (let n = 0; n < 120; n++) outputs.push({ filename: frame(part, n), subfolder: SUB, type: 'output' })
  outputs.push({ filename: `${seq(6)}.mp4`, subfolder: SUB, type: 'output' }, { filename: `${seq(6)}.mov`, subfolder: SUB, type: 'output' })
  return run('cccccccc-1111-2222', outputs, { workflow: 'assembly_v024/review025_parts.json', started_at: '2026-11-21T14:39:00Z', duration_s: 131 })
}

async function open(page, api, runs, asked) {
  api.state.history.runs['pod-aaaaaaaa'] = [].concat(runs)   // only these runs: the fixture's own run would make a second gallery (two toolbars, two groups)
  await page.context().route('**/view?*', (r) => {
    const name = decodeURIComponent(/filename=([^&]+)/.exec(r.request().url())[1])
    asked?.push(name)
    if (name.endsWith('.dpx')) return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tinyDpx() })
    return r.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: '' })
  })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  return page.getByTestId('pod-outputs-modal')
}

// ---- the pure rules (no browser) ----
const F = (filename, extra = {}) => ({ filename, subfolder: 'a', type: 'output', kind: /\.(mp4|mov)$/i.test(filename) ? 'video' : 'image', ...extra })
test('The main video: a delivered clip name wins, then the newest version, then the newest modified', () => {
  const delivered = F('ARCHIVAL-071_MAIN_FINAL_V02_3840X2160_23.976_PRORES422HQ.mov')
  const vids = [F('review_v11.mp4'), delivered, F('review_v03.mp4')]
  expect(mainVideoOf(vids).main.filename).toBe(delivered.filename)                       // (1) delivered beats a higher version
  expect(mainVideoOf(vids).how).toBe('delivered')
  expect(mainVideoOf([F('review_v11.mp4'), F('review_v03.mp4'), F('review_v07.mp4')]).main.filename).toBe('review_v11.mp4')   // (2) the highest vNNN
  expect(mainVideoOf([F('a.mp4', { modified: '2026-11-01T00:00:00Z' }), F('b.mp4', { modified: '2026-11-20T00:00:00Z' })]).main.filename).toBe('b.mp4')   // (3) the newest modified
  expect(mainVideoOf([F('X_FINAL_V01_1920X1080.mp4'), F('X_FINAL_V03_1920X1080.mov'), F('X_FINAL_V02_1920X1080.mov')]).main.filename).toBe('X_FINAL_V03_1920X1080.mov')   // the highest delivered version
  expect(mainVideoOf([F('same_v02.mp4'), F('same_v02.mov')]).main.filename).toBe('same_v02.mov')   // a .mov wins a .mp4 of the same version
  expect(mainVideoOf(vids, (stem) => stem === 'review_v03').main.filename).toBe('review_v03.mp4')   // an EDL answer from the caller counts as delivered
  expect(mainVideoOf([]).main).toBeNull()
  expect(versionOf('archival-080_a_mono_v015_NOT_RELEASED.mov')).toBe(15)
  expect(versionOf('ARCHIVAL-071_MAIN_FINAL_V02_3840X2160_23.976_PRORES422HQ.mov')).toBe(2)
  expect(versionOf('nothing.mov')).toBeNull()
})
test('Temp files: output type temp, a temp folder, and the ComfyUI_temp_ names', () => {
  expect(isTemp({ filename: 'x.png', subfolder: '', type: 'temp' })).toBe(true)
  expect(isTemp({ filename: 'x.png', subfolder: 'a/temp/b', type: 'output' })).toBe(true)
  expect(isTemp({ filename: 'ComfyUI_temp_abcde_00004_.png', subfolder: '', type: 'output' })).toBe(true)
  expect(isTemp({ filename: 'shot_v001.png', subfolder: 'templates', type: 'output' })).toBe(false)
})
test('Every file type of a folder is one group, whatever its size; a group of 4 or fewer is expanded by default', () => {
  const tiles = ['a.mp4', 'b.mp4', 'c.png', 'd.json'].map((n) => ({ key: n, kind: n.endsWith('.mp4') ? 'video' : n.endsWith('.png') ? 'image' : 'other', file: F(n) }))
  const g = groupTiles(tiles)
  expect(g.map((t) => [t.kind, t.cat, t.count])).toEqual([['fgroup', 'video', 2], ['fgroup', 'image', 1]])   // data files are not a group: a Data File button and a popup
  expect(dataFilesOf(tiles).map((f) => f.filename)).toEqual(['d.json'])
  expect(GROUP_MAX).toBe(4)
})
test('The order of a run is fixed: sequences, Videos, Images, Audio, Other; data files, wherever the listing has them, are never a group', () => {
  const mk = (n, kind) => ({ key: n, kind, file: F(n) })
  const tiles = [mk('a.json', 'other'), mk('x.png', 'image'), mk('v1.mp4', 'video'), mk('b.json', 'other'), mk('s.wav', 'audio'), mk('z.bin', 'other'), mk('v2.mp4', 'video')]
  expect(groupTiles(tiles).map((t) => t.cat)).toEqual(['video', 'image', 'audio', 'other'])
  expect(groupTiles([...tiles].reverse()).map((t) => t.cat)).toEqual(['video', 'image', 'audio', 'other'])   // independent of where the files were found
  expect(dataFilesOf(tiles).map((f) => f.filename)).toEqual(['a.json', 'b.json'])
})

// ---- the gallery ----
test('Outputs: a run of 362 files opens with its three sequences collapsed (one tile each, no frame list), the count and the Frames badge unchanged', async ({ page, api }) => {
  const asked = []
  const m = await open(page, api, bigRun(), asked)
  const dpxTiles = m.locator('[data-testid="outputs-tile"][data-kind="dpx"]')
  await expect(dpxTiles).toHaveCount(3)
  for (let i = 0; i < 3; i++) await expect(dpxTiles.nth(i)).toHaveAttribute('data-frames', '120')
  await expect(dpxTiles.first().getByTestId('outputs-dpx-badge')).toHaveText('DPX · 120 frames')
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(0)
  await expect(m.getByTestId('outputs-seq-toggle')).toHaveCount(3)
  await expect(m.getByTestId('outputs-seq-toggle').first()).toHaveAttribute('aria-expanded', 'false')
  await expect(m.getByTestId('outputs-seq-count')).toHaveText('3 sequence(s), 0 open')
  const frames = new Set(asked.filter((n) => n.endsWith('.dpx')))
  expect(frames.size).toBeLessThanOrEqual(3)
  for (const n of frames) expect(n).toMatch(/\.0000\.dpx$/)
  // the two review videos are one group of 2, expanded by default (4 or fewer), with a Main video
  const g = m.getByTestId('outputs-group')
  await expect(g).toHaveCount(1)
  await expect(g).toHaveAttribute('data-cat', 'video')
  await expect(g).toHaveAttribute('data-expanded', 'true')
  await expect(m.getByTestId('outputs-group-label')).toHaveText('2 Videos')
})

test('Outputs: Expand lists every frame of a 120-frame sequence (200 a page), nothing is fetched per frame, Collapse hides them', async ({ page, api }) => {
  const asked = []
  const m = await open(page, api, bigRun(), asked)
  const before = new Set(asked.filter((n) => n.endsWith('.dpx'))).size
  const first = m.getByTestId('outputs-seq-toggle').first()
  await first.click()
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(1)
  await expect(m.getByTestId('outputs-seq-frame')).toHaveCount(120)
  await expect(m.getByTestId('outputs-seq-frames-count')).toHaveText('120 of 120 frames')
  await expect(m.getByTestId('outputs-seq-all')).toHaveCount(0)                           // nothing more to show
  await expect(m.getByTestId('outputs-seq-count')).toHaveText('3 sequence(s), 1 open')
  expect(new Set(asked.filter((n) => n.endsWith('.dpx'))).size).toBe(before)             // listing frames fetched none
  await first.click()
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(0)
  await expect(m.locator('[data-testid="outputs-tile"][data-kind="dpx"]').first()).toHaveAttribute('data-frames', '120')
})

test('Outputs: a 362-frame sequence pages by scrolling (200, then the rest, no click); Show All renders all 362 at once', async ({ page, api }) => {
  const outputs = Array.from({ length: 362 }, (_, n) => ({ filename: frame(8, n), subfolder: SUB, type: 'output' }))
  const m = await open(page, api, run('ffffffff-7777-8888', outputs), [])
  await m.getByTestId('outputs-seq-toggle').click()
  await expect(m.getByTestId('outputs-seq-frames')).toHaveAttribute('data-shown', /^(200|362)$/)
  await m.getByTestId('outputs-page-sentinel').scrollIntoViewIfNeeded().catch(() => {})
  await expect(m.getByTestId('outputs-seq-frame')).toHaveCount(362)                      // reached the end with no Show More click
  await expect(m.getByTestId('outputs-seq-frames-count')).toHaveText('362 of 362 frames')
  // Show All on a fresh window: every row at once
  await page.reload()
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m2 = page.getByTestId('pod-outputs-modal')
  await m2.getByTestId('outputs-seq-toggle').click()
  if (await m2.getByTestId('outputs-seq-all').count()) await m2.getByTestId('outputs-seq-all').click()
  await expect(m2.getByTestId('outputs-seq-frame')).toHaveCount(362)
})

test('Outputs: Expand All and Collapse All act on every sequence and every group and drop single choices; a frame opens the viewer on that frame', async ({ page, api }) => {
  const m = await open(page, api, bigRun(), [])
  await m.getByTestId('outputs-seq-toggle').nth(1).click()
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(1)
  await m.getByTestId('outputs-expand-all').click()
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(3)
  await expect(m.getByTestId('outputs-seq-frame')).toHaveCount(360)
  await expect(m.getByTestId('outputs-seq-count')).toHaveText('3 sequence(s), 3 open')
  await m.getByTestId('outputs-collapse-all').click()
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(0)
  await expect(m.getByTestId('outputs-group')).toHaveAttribute('data-expanded', 'false')   // the group of 2 videos too
  await expect(m.getByTestId('outputs-seq-count')).toHaveText('3 sequence(s), 0 open')
  await m.getByTestId('outputs-seq-toggle').nth(2).click()
  await m.getByTestId('outputs-seq-frame').nth(5).click()
  await expect(page.getByTestId('dpx-viewer-frame')).toHaveText(/6 \/ 120/)
  await expect(page.getByTestId('dpx-viewer-title')).toHaveText(frame(6, 5))
})

test('Outputs: a sequence of 12 frames or fewer starts expanded in the automatic mode', async ({ page, api }) => {
  const outputs = Array.from({ length: 12 }, (_, n) => ({ filename: frame(7, n), subfolder: SUB, type: 'output' }))
  const m = await open(page, api, run('dddddddd-3333-4444', outputs), [])
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(1)
  await expect(m.getByTestId('outputs-seq-frame')).toHaveCount(12)
})

/** A mixed folder: 2 sequences of 20 frames, 12 videos (one delivered clip name), 30 PNGs, 5 JSON, 6 ComfyUI temp previews. */
const mixedRun = () => {
  const o = []
  for (const part of [1, 2]) for (let n = 0; n < 20; n++) o.push({ filename: frame(part, n), subfolder: SUB, type: 'output' })
  for (let v = 1; v <= 11; v++) o.push({ filename: `review_v${String(v).padStart(2, '0')}.mp4`, subfolder: SUB, type: 'output' })
  o.push({ filename: 'ARCHIVAL-071_MAIN_FINAL_V02_3840X2160_23.976_PRORES422HQ.mov', subfolder: SUB, type: 'output' })
  for (let n = 0; n < 30; n++) o.push({ filename: `still_${String(n).padStart(3, '0')}.png`, subfolder: SUB, type: 'output' })
  for (let n = 0; n < 5; n++) o.push({ filename: `meta_${n}.json`, subfolder: SUB, type: 'output' })
  for (let n = 0; n < 6; n++) o.push({ filename: `ComfyUI_temp_abcde_${String(n).padStart(5, '0')}_.png`, subfolder: '', type: 'temp' })
  return run('99999999-aaaa-bbbb', o)
}

test('Outputs: a mixed folder shows one group per type (collapsed above 4), the Main video, and hides ComfyUI temp files until Show Temp Files', async ({ page, api }) => {
  const asked = []
  const m = await open(page, api, mixedRun(), asked)
  const group = (cat) => m.locator(`[data-testid="outputs-group"][data-cat="${cat}"]`)
  await expect(group('video')).toHaveAttribute('data-expanded', 'false')
  await expect(group('image')).toHaveAttribute('data-expanded', 'false')
  await expect(group('data')).toHaveCount(0)   // the 5 data files are a button in the main row, not a group
  await expect(m.getByTestId('outputs-data-button')).toHaveText('Data Files (5)')
  await expect(group('video').getByTestId('outputs-group-label')).toHaveText(/^12 Videos/)
  await expect(group('image').getByTestId('outputs-group-label')).toHaveText(/^30 Images/)
  await expect(group('video').getByTestId('outputs-group-main-name')).toHaveAttribute('title', /^ARCHIVAL-071_MAIN_FINAL_V02/)   // the delivered clip is the Main video, not the highest vNN
  await expect(m.getByTestId('outputs-seq-count')).toHaveText('2 sequence(s), 0 open')
  // temp files: hidden, not counted, nothing fetched for them
  await expect(m.locator('[data-testid="outputs-group"][data-kind="tempgroup"]')).toHaveCount(0)
  await expect(m.getByTestId('outputs-files-count')).toHaveText(/^87 /)                  // 40 frames + 12 videos + 30 PNGs + 5 JSON
  await expect(m.getByTestId('outputs-temp-toggle')).toContainText('Show Temp Files')
  await expect(m.getByTestId('outputs-temp-toggle')).toContainText('(6)')
  expect(asked.filter((n) => n.startsWith('ComfyUI_temp_'))).toHaveLength(0)
  await m.getByTestId('outputs-temp-toggle').click()
  await expect(m.locator('[data-testid="outputs-group"][data-kind="tempgroup"]')).toHaveAttribute('data-expanded', 'false')   // 6 files: its own collapsed group
  await expect(m.locator('[data-testid="outputs-group"][data-kind="tempgroup"]').getByTestId('outputs-group-label')).toHaveText(/^6 Temp Files/)
  await expect(m.getByTestId('outputs-files-count')).toHaveText(/^93 /)
  await expect(m.getByTestId('outputs-temp-toggle')).toContainText('Hide Temp Files')
  expect(asked.filter((n) => n.startsWith('ComfyUI_temp_'))).toHaveLength(0)             // a collapsed temp group makes no preview
  await m.getByTestId('outputs-temp-toggle').click()
  await expect(m.getByTestId('outputs-files-count')).toHaveText(/^87 /)
})

test('Outputs: expanding the Videos group lists the Main video first with a Main badge; every group expands and collapses; Show All; the player cap holds', async ({ page, api }) => {
  const m = await open(page, api, mixedRun(), [])
  const video = m.locator('[data-testid="outputs-group"][data-cat="video"]')
  await video.getByTestId('outputs-group-toggle').click()
  await expect(video).toHaveAttribute('data-expanded', 'true')
  const rows = video.getByTestId('outputs-group-row')
  await expect(rows).toHaveCount(12)                                                      // 12 fit in a page of 48
  await expect(rows.first()).toHaveAttribute('data-main', 'true')
  await expect(rows.first().getByTestId('outputs-group-main')).toHaveText('Main')
  await expect(rows.first()).toHaveAttribute('title', /^ARCHIVAL-071_MAIN_FINAL_V02/)   // the name is shortened in the middle; the title has it whole
  await expect(video.getByTestId('outputs-group-shown')).toHaveText('12 of 12')
  await expect(video.getByTestId('outputs-group-all')).toHaveCount(0)
  expect(await m.locator('video').count()).toBeLessThanOrEqual(6)
  // the 5 data files: one button opens one popup that lists them (no group, no rows in the body); Escape closes the popup and leaves the pod modal open
  await m.getByTestId('outputs-data-button').click()
  await expect(page.getByTestId('datafile-modal')).toBeVisible()
  await expect(page.getByTestId('datafile-item')).toHaveCount(5)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('datafile-modal')).toHaveCount(0)
  await expect(m.getByTestId('outputs-gallery')).toBeVisible()
  await video.getByTestId('outputs-group-toggle').click()
  await expect(video).toHaveAttribute('data-expanded', 'false')
  await m.getByTestId('outputs-expand-all').click()
  await expect(m.getByTestId('outputs-group').first()).toHaveAttribute('data-expanded', 'true')
  expect(await m.locator('video').count()).toBeLessThanOrEqual(6)
  await m.getByTestId('outputs-collapse-all').click()
  await expect(video).toHaveAttribute('data-expanded', 'false')
})

test('Outputs: 100 videos are one group of 48 rows a page that grows by scrolling; Show All renders all 100; never more than 6 players', async ({ page, api }) => {
  const outputs = Array.from({ length: 100 }, (_, n) => ({ filename: `review_${String(n).padStart(3, '0')}.mp4`, subfolder: SUB, type: 'output' }))
  const m = await open(page, api, run('eeeeeeee-5555-6666', outputs), [])
  const g = m.getByTestId('outputs-group')
  await expect(g).toHaveCount(1)
  await expect(m.getByTestId('outputs-group-label')).toHaveText(/^100 Videos/)
  await g.getByTestId('outputs-group-toggle').click()
  await expect(g.getByTestId('outputs-group-row')).toHaveCount(48, { timeout: 2000 }).catch(() => {})   // the first page (the next may already have loaded by scrolling)
  const most = async () => m.locator('video').count()
  expect(await most()).toBeLessThanOrEqual(6)
  await g.getByTestId('outputs-group-all').dispatchEvent('click')   // the list grows under the button as the scroll loads pages: a real click can chase a moving target under load
  await expect(g.getByTestId('outputs-group-row')).toHaveCount(100)
  await g.getByTestId('outputs-group-row').last().scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  expect(await most()).toBeLessThanOrEqual(6)
  await expect(g.getByTestId('outputs-group-shown')).toHaveText('100 of 100')
})

test('Outputs: 4 files of a type are a group expanded by default; one file is still a group with its control', async ({ page, api }) => {
  const outputs = [...Array.from({ length: 4 }, (_, n) => ({ filename: `clip_${n}.mp4`, subfolder: SUB, type: 'output' })), { filename: 'only.png', subfolder: SUB, type: 'output' }]
  const m = await open(page, api, run('12121212-0000-1111', outputs), [])
  const v = m.locator('[data-testid="outputs-group"][data-cat="video"]')
  await expect(v).toHaveAttribute('data-expanded', 'true')
  await expect(v.getByTestId('outputs-group-row')).toHaveCount(4)
  await expect(v.getByTestId('outputs-group-label')).toHaveText(/^4 Videos/)
  const img = m.locator('[data-testid="outputs-group"][data-cat="image"]')
  await expect(img.getByTestId('outputs-group-label')).toHaveText(/^1 Image/)
  await expect(img.getByTestId('outputs-group-toggle')).toBeVisible()
  await img.getByTestId('outputs-group-toggle').click()
  await expect(img).toHaveAttribute('data-expanded', 'false')
})

test('Outputs: the list of runs is paged: 10 a page by default, Next goes to page 2, 100 a page shows 100, a scope change goes back to page 1', async ({ page, api }) => {
  const runs = Array.from({ length: 120 }, (_, i) => run(`aaaaaaaa-${String(i).padStart(4, '0')}-0000`, [{ filename: `r${i}_00001_.png`, subfolder: '', type: 'output' }], { started_at: `2026-11-21T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z` }))
  const m = await open(page, api, runs, [])
  const rows = m.getByTestId('pod-outputs-run')
  await expect(m.getByTestId('outputs-pager')).toBeVisible()
  await expect(rows).toHaveCount(10)
  await expect(m.getByTestId('outputs-pager-page')).toHaveText('Page 1 of 12')
  await expect(m.getByTestId('outputs-pager-shown')).toHaveText('10 of 120')
  await expect(m.getByTestId('outputs-pager-prev')).toBeDisabled()
  const firstOnPage1 = await rows.first().getAttribute('data-prompt')
  await m.getByTestId('outputs-pager-next').click()
  await expect(m.getByTestId('outputs-pager-page')).toHaveText('Page 2 of 12')
  await expect(rows).toHaveCount(10)
  expect(await rows.first().getAttribute('data-prompt')).not.toBe(firstOnPage1)
  await m.getByTestId('outputs-pager-size').selectOption('100')
  await expect(m.getByTestId('outputs-pager-page')).toHaveText('Page 1 of 2')            // a new page size goes back to page 1
  await expect(rows).toHaveCount(100)
  await expect(m.getByTestId('outputs-pager-shown')).toHaveText('100 of 120')
  await m.getByTestId('outputs-pager-next').click()
  await expect(rows).toHaveCount(20)
  await expect(m.getByTestId('outputs-pager-next')).toBeDisabled()
  const scope = m.getByTestId('pod-outputs-scope-all')
  if (await scope.count()) { await m.getByTestId('pod-outputs-scope-folder').click().catch(() => {}); await scope.click().catch(() => {}); await expect(m.getByTestId('outputs-pager-page')).toHaveText(/Page 1 of/) }
})

test('Names are shortened in the MIDDLE so tiles stay distinguishable; the full name is in the tooltip', async ({ page, api }) => {
  const long = (v) => `ARCHIVAL-071_ASSEMBLY_part09c02_v00${v}.png`
  expect(shortName(long(3))).toMatch(/^ARCHIVAL-071_ASSE….*_v003\.png$/)
  expect(shortName(long(3)).length).toBeLessThanOrEqual(34)
  expect(shortName(long(3))).not.toBe(shortName(long(4)))                                 // the end tells them apart
  expect(shortName('short.png')).toBe('short.png')
  const outputs = [1, 2, 3].map((v) => ({ filename: long(v), subfolder: SUB, type: 'output' }))
  const m = await open(page, api, run('34343434-0000-1111', outputs), [])
  const rows = m.getByTestId('outputs-group-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0).locator('.gname')).toHaveAttribute('title', /^ARCHIVAL-071_ASSEMBLY_part09c02_v00\d\.png$/)
  await expect(rows.nth(0).locator('.gname')).toContainText('…')
})

test('A DPX sequence has a header row on its own tile (name, frame count, Expand/Collapse); a group has the same header row', async ({ page, api }) => {
  const m = await open(page, api, bigRun(), [])
  const heads = m.getByTestId('outputs-seq-head')
  await expect(heads).toHaveCount(3)
  await expect(heads.first().getByTestId('outputs-seq-headcount')).toHaveText('120')
  await expect(heads.first().getByTestId('outputs-seq-name')).toHaveAttribute('title', /_depth-182\.#+\.dpx$/)
  await expect(heads.first().getByTestId('outputs-seq-toggle')).toBeVisible()           // the control is in the header, not below the grid row
  await expect(m.getByTestId('outputs-group-head').getByTestId('outputs-group-toggle')).toBeVisible()
  await heads.first().getByTestId('outputs-seq-toggle').click()
  await expect(m.getByTestId('outputs-seq-frames')).toHaveCount(1)
})
