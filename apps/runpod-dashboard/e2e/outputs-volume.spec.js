import { test, expect, podCard, fileTiles } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// The Outputs button of a STOPPED pod (docs/ADR-045): never greyed out because the pod is stopped. With a network volume the volume-s3 source lists comfy-shared/output/ by folder
// (no pod), a DPX sequence opens through an s3file:// address, and without S3 keys the modal says what to set.
const D = 'proxy_v004/archival-080/archival-080_a_v004_dpx16'
const frame = (n) => `archival-080_a_v004_proxy.${String(n).padStart(4, '0')}.dpx`
const FILES = [
  ...[0, 1, 2].map((n) => ({ key: `${D}/${frame(n)}`, bytes: 49768064, modified: '2026-11-17T19:06:55' })),
  { key: `${D}/archival-080_a_v004_proxy.json`, bytes: 300, modified: '2026-11-17T19:07:00' },
  { key: 'proxy_v004/archival-080/clip/clip.mp4', bytes: 9000, modified: '2026-11-16T08:00:00' },
  { key: 'proxy_v004/archival-084/x/x.png', bytes: 10, modified: '2026-11-15T08:00:00' },
  { key: 'proxy_v005/archival-080/y/y.png', bytes: 10, modified: '2026-11-17T12:00:00' },
  { key: 'delivery_v003_tests/t.png', bytes: 10, modified: '2026-11-01T08:00:00' },
]
const stopAll = (api) => { for (const p of api.state.pods) { p.status = 'stopped'; p.web_ui_url = null; p.uptime_seconds = null } }
const dpxBytes = (n) => Array.from(makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? Math.min(65535, (n + 1) * 20000 + x * 500) : c === 1 ? 30000 + y * 1000 : 0) }))

test('a stopped pod on a volume has an enabled Outputs button; the modal lists the volume top level with a breadcrumb, a volume chip and no start-a-pod banner', async ({ page, api }) => {
  stopAll(api); api.state.history.runs = {}
  api.state.s3Outputs = { files: FILES }
  await page.goto('/')
  const dev = podCard(page, 'ComfyUI-Dev')
  await expect(dev.getByTestId('pod-status')).toHaveText(/Stopped/i)
  await expect(dev.getByTestId('pod-outputs')).toBeEnabled()
  await dev.getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('pod-outputs-volume')).toBeVisible()
  await expect(m.getByTestId('pod-outputs-folder')).toHaveText(['delivery_v003_tests', 'proxy_v004', 'proxy_v005'])   // level 1: the top-level folders only
  await expect(m.getByTestId('pod-outputs-crumb')).toHaveCount(1)
  await expect(m.getByTestId('pod-outputs-offline')).toHaveCount(0)
  await expect(m.getByTestId('pod-outputs-s3-unavailable')).toHaveCount(0)
  // into proxy_v004, then the shot: the leaf folders are runs, each with the volume chip
  await m.locator('[data-testid="pod-outputs-folder"][data-name="proxy_v004"]').click()
  await expect(m.getByTestId('pod-outputs-crumb')).toHaveText(['output', 'proxy_v004'])
  await m.locator('[data-testid="pod-outputs-folder"][data-name="archival-080"]').click()
  await expect(m.getByTestId('pod-outputs-crumb')).toHaveText(['output', 'proxy_v004', 'archival-080'])
  const runs = m.getByTestId('pod-outputs-run')
  await expect(runs).toHaveCount(2)
  await expect(runs.first()).toHaveAttribute('data-source', 'volume')
  await expect(runs.first().getByTestId('pod-outputs-source')).toHaveText('volume')
  await expect(runs.first().getByTestId('pod-outputs-folder-name')).toHaveText('archival-080_a_v004_dpx16')   // newest LastModified first
  await expect(fileTiles(runs.first())).toHaveCount(2)   // the DPX sequence is ONE tile, plus its json sidecar
  await expect(runs.first().locator('[data-testid="outputs-tile"][data-kind="dpx"]')).toHaveAttribute('data-frames', '3')
  await expect(fileTiles(runs.first()).first()).toBeEnabled()   // viewable with no pod
  // breadcrumb back to the root
  await m.locator('[data-testid="pod-outputs-crumb"][data-prefix="proxy_v004"]').click()
  await expect(m.getByTestId('pod-outputs-folder')).toHaveText(['archival-080', 'archival-084'])
  await m.locator('[data-testid="pod-outputs-crumb"][data-prefix=""]').click()
  await expect(m.getByTestId('pod-outputs-folder')).toHaveCount(3)
})

test('with a shot on the pod the folder scope starts in output/*/<shot>/ (the window itself starts in All outputs, one click away)', async ({ page, api }) => {
  stopAll(api); api.state.history.runs = {}
  const dev = api.state.pods.find((p) => p.name === 'ComfyUI-Dev'); dev.round = 'r1'; dev.shot = 'archival-084'
  api.state.s3Outputs = { files: FILES }
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('pod-outputs-scope-all')).toHaveClass(/active/)   // All outputs is the default
  await expect(m.getByTestId('pod-outputs-crumb')).toHaveText(['output', 'proxy_v004', 'archival-084'])
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(5)   // every folder
  await m.getByTestId('pod-outputs-scope-folder').click()
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1)
  expect(api.state.outputCalls.find((c) => !c.all).shot).toBe('archival-084')
})

test('opening a DPX sequence from the volume with the pod stopped reads s3file:// addresses (volume id and a key under comfy-shared/output/)', async ({ page, api }) => {
  stopAll(api); api.state.history.runs = {}
  api.state.s3Outputs = { files: FILES }
  const bytes = [0, 1, 2].map(dpxBytes)
  await page.addInitScript((frames) => {
    window.__s3 = []
    const real = window.fetch.bind(window)
    window.fetch = (u, init) => {
      const url = String(u?.url || u)
      if (!url.startsWith('s3file://')) return real(u, init)
      window.__s3.push(url)
      const n = Number(/\.(\d+)\.dpx$/.exec(decodeURIComponent(url))?.[1] ?? 0)
      return Promise.resolve(new Response(new Uint8Array(frames[n]), { status: 200 }))
    }
  }, bytes)
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await m.locator('[data-testid="pod-outputs-folder"][data-name="proxy_v004"]').click()
  await m.locator('[data-testid="pod-outputs-folder"][data-name="archival-080"]').click()
  await m.locator('[data-testid="outputs-tile"][data-kind="dpx"]').click()
  const v = page.getByTestId('dpx-viewer')
  await expect(v.getByTestId('dpx-viewer-canvas')).toHaveAttribute('data-drawn', '0')
  await expect(v.getByTestId('dpx-viewer-frame')).toHaveText(/1 \/ 3/)
  await expect(v.getByTestId('dpx-viewer-open')).toHaveCount(0)   // an s3file address has no tab to open in
  const asked = (await page.evaluate(() => window.__s3)).filter((u) => !decodeURIComponent(u).endsWith('.json'))   // the colour record is read too (a small .json for the chips); the frames are what this checks
  expect(asked.length).toBeGreaterThan(0)
  const u = new URL(asked[0])
  expect(u.protocol).toBe('s3file:'); expect(u.host).toBe('vol1')
  expect(decodeURIComponent(u.pathname.slice(1))).toBe(`comfy-shared/output/${D}/${frame(0)}`)
})

test('a video from the volume plays through an s3file:// source with no pod', async ({ page, api }) => {
  stopAll(api); api.state.history.runs = {}
  api.state.s3Outputs = { files: FILES }
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await m.locator('[data-testid="pod-outputs-folder"][data-name="proxy_v004"]').click()
  await m.locator('[data-testid="pod-outputs-folder"][data-name="archival-080"]').click()
  await m.locator('[data-testid="outputs-group-row"][title="clip.mp4"]').scrollIntoViewIfNeeded()   // thumbnails and players are made only near the viewport
  const video = m.locator('video').first()
  await expect(video).toHaveAttribute('src', `s3file://vol1/${encodeURIComponent('comfy-shared/output/proxy_v004/archival-080/clip/clip.mp4')}`)
})

test('with no S3 keys the Outputs button is still enabled and the modal says which keys to set, with a button that opens the configuration', async ({ page, api }) => {
  stopAll(api); api.state.history.runs = {}   // no api.state.s3Outputs: no keys
  await page.goto('/')
  const dev = podCard(page, 'ComfyUI-Dev')
  await expect(dev.getByTestId('pod-outputs')).toBeEnabled()
  await dev.getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('pod-outputs-s3-unavailable')).toContainText("Set the RunPod S3 keys in Default Configuration to browse a volume's outputs without a pod")
  await expect(m.getByTestId('pod-outputs-volume')).toHaveCount(0)
  await m.getByTestId('pod-outputs-open-config').click()
  await expect(page.getByTestId('cfg-s3-access')).toBeVisible()
})
