import { test, expect, podCard } from './fixtures'

// The Outputs window has one Source box (type to filter, or pick), above the folder selection: All Sources, Pod, Saved, Volume, any other volume, any ready storage (Wasabi, S3).
const FILES = [
  { key: 'proxy_v004/archival-080/clip/clip.mp4', bytes: 9000, modified: '2026-11-16T08:00:00' },
  { key: 'proxy_v004/archival-084/x/x.png', bytes: 10, modified: '2026-11-15T08:00:00' },
]
const open = async (page, api) => {
  for (const p of api.state.pods) { p.status = 'stopped'; p.web_ui_url = null; p.uptime_seconds = null }
  api.state.history.runs = {}; api.state.s3Outputs = { files: FILES }
  api.state.storage = { adapters: [
    { id: 'wasabi', name: 'Wasabi', builtin: true, kind: 'wasabi', enabled: true, endpoint: 'https://s3.wasabisys.com', region: 'us-east-1', bucket: 'bh-wasabi', prefix: '', ready: true, key_hint: '...5678' },
    { id: 'b2', name: 'Backblaze B2', builtin: false, kind: 'custom', enabled: false, endpoint: '', region: 'x', bucket: '', prefix: '', ready: false, problem: 'Add a bucket', key_hint: '' },
  ] }
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  return page.getByTestId('pod-outputs-modal')
}

test('the Source box sits above the folder selection and lists the sources in its dropdown', async ({ page, api }) => {
  const m = await open(page, api)
  const box = m.getByTestId('pod-outputs-source-box'), crumbs = m.getByTestId('pod-outputs-breadcrumb')
  await expect(box).toBeVisible(); await expect(crumbs).toBeVisible()
  expect((await box.boundingBox()).y).toBeLessThan((await crumbs.boundingBox()).y)
  await expect(box).toHaveValue('All Sources')
  await m.getByTestId('pod-outputs-source-arrow').click()
  await expect(m.getByTestId('pod-outputs-source-list')).toBeVisible()
  const labels = await m.getByTestId('pod-outputs-source-option').allTextContents()
  expect(labels.map((l) => l.trim())).toEqual(expect.arrayContaining(['All Sources', 'Pod (0)', "Local (this PC's output folder)", 'Wasabi (bh-wasabi)'])); expect(labels.some((l) => /^\s*Volume \(\d+\)$/.test(l))).toBe(true)
  expect(labels.some((l) => /Backblaze/.test(l))).toBe(false)   // a storage that is not ready is not offered
})

test('picking Volume shows only the volume runs; All Sources shows them together again', async ({ page, api }) => {
  const m = await open(page, api)
  const box = m.getByTestId('pod-outputs-source-box')
  await m.getByTestId('pod-outputs-source-arrow').click()
  const vol = (await m.getByTestId('pod-outputs-source-option').allTextContents()).map((l) => l.trim()).find((l) => /^Volume \(\d+\)$/.test(l))
  await m.getByTestId('pod-outputs-source-option').filter({ hasText: vol }).click()
  await expect(box).toHaveValue(vol)
  await expect(m.locator('[data-testid="pod-outputs-run"]:not([data-source="volume"])')).toHaveCount(0)
  for (const n of ['proxy_v004', 'archival-080', 'clip']) await m.locator(`[data-testid="pod-outputs-folder"][data-name="${n}"]`).click()   // the files sit inside the folders
  await expect(m.locator('[data-testid="pod-outputs-run"][data-source="volume"]').first()).toBeVisible()
  await box.fill('all sou'); await box.press('Enter')
  await expect(box).toHaveValue('All Sources')
})

test('picking another volume lists its output files in the gallery (no explorer), and the pod volume comes back', async ({ page, api }) => {
  const m = await open(page, api)
  const box = m.getByTestId('pod-outputs-source-box')
  await m.getByTestId('pod-outputs-source-arrow').click()
  const other = m.locator('[data-testid="pod-outputs-source-option"][data-kind="volume"]').first()
  await expect(other).toBeVisible()
  const id = await other.getAttribute('data-id')
  await other.click()
  await expect(page.getByTestId('volume-files-modal')).toHaveCount(0)
  await expect.poll(() => (api.state.outputCalls || []).some((c) => c.volume_id === id)).toBe(true)   // its files were listed
  await expect(m.locator('[data-testid="pod-outputs-run"]:not([data-source="volume"])')).toHaveCount(0)
  await expect(m.locator('[data-testid="pod-outputs-run"]').first()).toBeVisible()
  await expect(box).not.toHaveValue('All Sources')
  await m.getByTestId('pod-outputs-source-arrow').click()
  await m.locator('[data-testid="pod-outputs-source-option"][data-kind="thisvolume"]').click()
  await expect(box).toHaveValue('All Sources')
})

test('the Volume count is not 0 when the volume has output files', async ({ page, api }) => {
  const m = await open(page, api)
  await m.getByTestId('pod-outputs-source-arrow').click()
  await expect(m.locator('[data-testid="pod-outputs-source-option"][data-kind="filter"][data-id="volume"]')).toHaveText(/Volume \([1-9]/)
})

test('a second pager sits at the bottom of the runs', async ({ page, api }) => {
  const files = Array.from({ length: 30 }, (_, i) => ({ key: `proxy_v004/shot-${String(i).padStart(3, '0')}/clip/clip.mp4`, bytes: 9000, modified: `2026-11-16T08:${String(i).padStart(2, '0')}:00` }))
  for (const p of api.state.pods) { p.status = 'stopped'; p.web_ui_url = null; p.uptime_seconds = null }
  api.state.history.runs = {}; api.state.s3Outputs = { files }
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('outputs-bottom-pager')).toBeVisible()
  await m.getByTestId('outputs-bottom-pager-next').click()
  await expect(m.getByTestId('outputs-bottom-pager-page')).toContainText('2')
  await expect(m.getByTestId('outputs-pager-page')).toContainText('2')   // the two pagers move together
})

test('picking a storage filters the gallery to its folders and files (videos included), no explorer window', async ({ page, api }) => {
  const m = await open(page, api)
  const box = m.getByTestId('pod-outputs-source-box')
  await box.fill('wasabi'); await expect(m.getByTestId('pod-outputs-source-option')).toHaveCount(1); await box.press('Enter')
  await expect(page.getByTestId('bucket-modal')).toHaveCount(0)
  await expect(m.getByTestId('pod-outputs-storage')).toBeVisible()
  await expect(m.getByTestId('pod-outputs-storage-folder')).toHaveText([/renders/, /plates/])
  await expect(m.locator('[data-testid="pod-outputs-run"][data-source="storage"]')).toHaveCount(1)   // readme.txt at the top
  await m.locator('[data-testid="pod-outputs-storage-folder"][data-name="renders"]').click()
  await expect(m.getByTestId('pod-outputs-storage-folder')).toHaveText([/shot-001/])
  await expect(m.getByTestId('pod-outputs-run').first()).toContainText('a.mov')   // a video, shown as a file of the folder
  await expect(m.locator('[data-testid="pod-outputs-storage-crumb"][data-prefix="renders/"]')).toBeVisible()
  await m.locator('[data-testid="pod-outputs-storage-crumb"][data-prefix=""]').click()
  await expect(m.getByTestId('pod-outputs-storage-folder')).toHaveText([/renders/, /plates/])
  expect((api.state.storage.calls || []).filter((c) => c.browse).map((c) => `${c.browse}:${c.prefix}`)).toEqual(['wasabi:', 'wasabi:renders/', 'wasabi:'])
  await m.getByTestId('pod-outputs-source-arrow').click()
  await m.locator('[data-testid="pod-outputs-source-option"][data-id="all"]').click()
  await expect(m.getByTestId('pod-outputs-storage')).toHaveCount(0)
})

test('while the whole volume is still being listed the Volume entry says so, then shows the count', async ({ page, api }) => {
  for (const p of api.state.pods) { p.status = 'stopped'; p.web_ui_url = null; p.uptime_seconds = null }
  api.state.history.runs = {}; api.state.s3Outputs = { files: FILES, allDelayMs: 1500 }
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await m.getByTestId('pod-outputs-source-arrow').click()
  const v = m.locator('[data-testid="pod-outputs-source-option"][data-kind="filter"][data-id="volume"]')
  await expect(v).toContainText('listing')
  await expect(v).toHaveText(/Volume \([1-9]/)
})

test('a volume whose whole listing failed never says 0: it says so, and picking it lists again', async ({ page, api }) => {
  for (const p of api.state.pods) { p.status = 'stopped'; p.web_ui_url = null; p.uptime_seconds = null }
  api.state.history.runs = {}; api.state.s3Outputs = { files: FILES, noAll: true }
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await m.getByTestId('pod-outputs-source-arrow').click()
  await expect(m.locator('[data-testid="pod-outputs-source-option"][data-id="volume"]')).not.toHaveText(/\(0\)/)
})

test('Local filters to this PC output folder: folders as buttons, videos and files below', async ({ page, api }) => {
  const m = await open(page, api)
  const box = m.getByTestId('pod-outputs-source-box')
  await box.fill('local'); await box.press('Enter')
  await expect(m.getByTestId('pod-outputs-storage-folder')).toHaveText([/proxy_v004/, /deliver/])
  await expect(m.locator('[data-testid="pod-outputs-run"][data-source="local"]')).toHaveCount(1)   // notes.txt at the top
  await m.locator('[data-testid="pod-outputs-storage-folder"][data-name="deliver"]').click()
  const run = m.locator('[data-testid="pod-outputs-run"][data-source="local"]')
  await expect(run).toContainText('clip.mov'); await expect(run).toContainText('clip.mp4')
  expect(api.state.localOutputs.calls).toEqual(['', 'deliver/'])
})

test('the x button clears the Source back to All Sources (and is absent by default)', async ({ page, api }) => {
  const m = await open(page, api)
  const box = m.getByTestId('pod-outputs-source-box'), x = m.getByTestId('pod-outputs-source-clear')
  await expect(x).toHaveCount(0)
  await box.fill('local'); await box.press('Enter')
  await expect(x).toBeVisible(); await expect(box).toHaveValue(/Local/)
  await x.click()
  await expect(box).toHaveValue('All Sources'); await expect(x).toHaveCount(0)
  await expect(m.getByTestId('pod-outputs-storage')).toHaveCount(0)
  await m.getByTestId('pod-outputs-source-arrow').click()
  await m.locator('[data-testid="pod-outputs-source-option"][data-kind="volume"]').first().click()
  await expect(x).toBeVisible(); await x.click()
  await expect(box).toHaveValue('All Sources')
})

test('with no round or shot on the card the window starts in All Outputs; with a round it starts in the folder scope', async ({ page, api }) => {
  const m = await open(page, api)
  await expect(m.getByTestId('pod-outputs-scope-all')).toHaveClass(/active/)
  await expect(m.getByTestId('pod-outputs-scope-folder')).not.toHaveClass(/active/)
})

test('the window opens at the output folder itself (prefix empty) when no round is selected', async ({ page, api }) => {
  await open(page, api)
  await expect.poll(() => (api.state.outputCalls || []).length).toBeGreaterThan(0)
  const first = api.state.outputCalls.find((c) => !c.all)
  expect(first.prefix).toBe('')
})
