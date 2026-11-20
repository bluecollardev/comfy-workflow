import { test, expect, podCard, answerConfirm, queueTab } from './fixtures'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'

// The Queue's Generations section (docs/ADR-051 section 9): render jobs and the preview batch are jobs of the app, shown in the Queue whenever it is opened, with Stop, Play and Dismiss; the nav badge counts them.
const px = makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const seqRun = (n, frames = 2) => ({ prompt_id: 'gggggggg-1111', workflow: 'rounds/r1/g.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 5, cost_estimate: 0,
  outputs: Array.from({ length: n }, (_, i) => Array.from({ length: frames }, (_, k) => ({ filename: `s${i + 1}_proxy.${String(k).padStart(4, '0')}.dpx`, subfolder: `seqs/s${i + 1}`, type: 'output' }))).flat() })
const job = (o = {}) => ({ job_id: 'job-1', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', kind: 'proxy', state: 'rendering', started_at: '2026-11-19T10:00:00Z', finished_at: null, width: 'source', frames_done: 140, frames_total: 412, rate_fps: 9.2, current: 's2_proxy.0040.dpx', pulled_files: 0, pulled_bytes: 0, error: '', summary: '',
  sequences: [{ dir: 'seqs/s1', name: 's1_proxy', where: 'pod', state: 'rendered', frames_done: 100, frames_total: 100 }, { dir: 'seqs/s2', name: 's2_proxy', where: 'pod', state: 'rendering', frames_done: 40, frames_total: 200 }, { dir: 'seqs/s3', name: 's3_proxy', where: 'pod', state: 'failed', frames_done: 0, frames_total: 112, error: 'ffmpeg failed (exit 1)' }], ...o })
const openQueue = async (page) => { await queueTab(page, 'generations'); const q = page.getByTestId('queue-modal'); await expect(q).toBeVisible(); return q }
const gens = (q) => q.getByTestId('queue-generations')

test('nothing running: the section says so, and the badge is absent', async ({ page, api }) => {
  await page.goto('/')
  const q = await openQueue(page)
  await expect(gens(q).getByTestId('generations-none')).toHaveText('No generations running or finished.')
  await expect(page.getByTestId('queue-badge')).toHaveCount(0)
})

test('a running render job: title, kind and adapter badges, phases, progress with percent, numbers with the ETA, per-sequence rows with the failed one\'s error; Stop sends cancel', async ({ page, api }) => {
  api.state.renders = { jobs: [job()] }
  await page.goto('/')
  const q = await openQueue(page)
  const c = gens(q).getByTestId('generations-job')
  await expect(c).toHaveAttribute('data-state', 'rendering')
  await expect(c.getByTestId('generations-job-title')).toHaveText('Proxy: 3 sequences'); await expect(c.getByTestId('generations-job-kind')).toHaveText('Proxy'); await expect(c.getByTestId('generations-job-where')).toHaveText('pod')
  await expect(c.getByTestId('generations-job-bar')).toHaveAttribute('data-percent', '34')
  await expect(c.getByTestId('generations-job-numbers')).toHaveText('sequence 2 of 3 · frame 140 of 412 · 9 fps · about 30 s left')
  await expect(c.getByTestId('generations-job-current')).toHaveText('s2_proxy.0040.dpx')
  await expect(c.locator('[data-testid="generations-phase"][data-active="true"]')).toHaveAttribute('data-phase', 'rendering'); await expect(c.getByTestId('generations-phase')).toHaveText(['Rendering', 'Syncing to this PC'])
  await expect(c.getByTestId('generations-seq')).toHaveCount(0)   // collapsed
  await c.getByTestId('generations-job-rows-toggle').click()
  await expect(c.getByTestId('generations-seq')).toHaveCount(3)
  await expect(c.locator('[data-testid="generations-seq"][data-name="s2_proxy"] [data-testid="generations-seq-bar"]')).toHaveAttribute('data-percent', '20')
  await expect(c.locator('[data-testid="generations-seq"][data-state="failed"] [data-testid="generations-seq-error"]')).toHaveText('ffmpeg failed (exit 1)')
  await c.getByTestId('generations-job-stop').click()
  await expect.poll(() => api.state.renders.cancelled).toEqual(['job-1'])
  await expect(c).toHaveAttribute('data-state', 'cancelled', { timeout: 6000 })
  await expect(c.getByTestId('generations-job-stop')).toHaveCount(0)
})

test('the phase chips follow the job: syncing, then publishing; a local render has no syncing chip', async ({ page, api }) => {
  api.state.renders = { jobs: [job({ state: 'pulling', publish: { job_id: 'pub-1', state: 'queued' } })] }
  await page.goto('/')
  const q = await openQueue(page)
  const c = gens(q).getByTestId('generations-job')
  await expect(c.locator('[data-testid="generations-phase"][data-active="true"]')).toHaveAttribute('data-phase', 'syncing')
  await expect(c.getByTestId('generations-phase')).toHaveText(['Rendering', 'Syncing to this PC', 'Publishing'])
  await expect(c.getByTestId('generations-job-publish')).toHaveText('Publish: queued')
  api.state.renders.jobs[0].state = 'publishing'
  await expect(c.locator('[data-testid="generations-phase"][data-active="true"]')).toHaveAttribute('data-phase', 'publishing', { timeout: 7000 })
  api.state.renders.jobs[0] = job({ job_id: 'job-2', pod_id: '', kind: 'review', sequences: [{ dir: 'seqs/s1', name: 'ARCH', clip_name: 'ARCHIVAL-077_A', where: 'local', state: 'rendering', frames_done: 1, frames_total: 5 }] })
  await expect(gens(q).getByTestId('generations-job-title')).toHaveText('Review: ARCHIVAL-077_A', { timeout: 7000 })
  await expect(gens(q).getByTestId('generations-phase')).toHaveText(['Rendering'])
})

test('a finished job shows its summary and the files written; Dismiss removes it (for this app only); Play opens the pod\'s Outputs window on the sequence', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'].unshift(seqRun(1, 3))
  api.state.renders = { jobs: [job({ state: 'done', finished_at: '2026-11-19T10:05:00Z', frames_done: 3, frames_total: 3, summary: '1 sequence rendered; 2 files synced (3 MB)',
    sequences: [{ dir: 'seqs/s1', name: 's1_proxy', where: 'pod', state: 'pulled', frames_done: 3, frames_total: 3, files: [{ name: 's1_proxy.mp4' }] }] })], proxies: { 'seqs/s1/s1_proxy': { exists_local: true, local_url: 'http://proxy.test/p.webm', width: 1280 } } }
  await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }))
  await page.context().route('http://proxy.test/**', (r) => r.fulfill({ status: 200, contentType: 'video/webm', body: Buffer.from('x') }))
  await page.goto('/')
  const q = await openQueue(page)
  const c = gens(q).getByTestId('generations-job')
  await expect(c.getByTestId('generations-job-summary')).toHaveText('1 sequence rendered; 2 files synced (3 MB)')
  await expect(c.getByTestId('generations-job-files')).toContainText('s1_proxy.mp4')
  await expect(c.getByTestId('generations-job-bar')).toHaveAttribute('data-percent', '100')
  await c.getByTestId('generations-job-play').click()
  await expect(page.getByTestId('pod-outputs-modal')).toBeVisible()
  await expect(page.getByTestId('dpx-viewer')).toBeVisible({ timeout: 10000 })
  await page.keyboard.press('Escape'); await expect(page.getByTestId('dpx-viewer')).toHaveCount(0)
  await page.getByTestId('pod-outputs-modal').locator('.btn-close').click(); await expect(page.getByTestId('pod-outputs-modal')).toBeHidden()
  await queueTab(page, 'generations')
  await gens(page.getByTestId('queue-modal')).getByTestId('generations-job-dismiss').click()
  await expect(gens(page.getByTestId('queue-modal')).getByTestId('generations-job')).toHaveCount(0)
  expect(api.state.renders.jobs).toHaveLength(1)   // only hidden here: the core's job list is untouched
})

test('Open in Outputs opens the pod\'s Outputs window', async ({ page, api }) => {
  api.state.renders = { jobs: [job({ state: 'failed', error: 'ffmpeg exited' })] }
  await page.goto('/')
  const q = await openQueue(page)
  await expect(gens(q).getByTestId('generations-job-error')).toHaveText('ffmpeg exited')
  await gens(q).getByTestId('generations-job-open-outputs').click()
  await expect(page.getByTestId('pod-outputs-modal')).toBeVisible()
})

test('a job started in the Generate window shows in the Queue opened later, with the Queue closed in between', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'].unshift(seqRun(2))
  await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }))
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Render Sequences' }).click()
  const p = page.getByTestId('pod-outputs-previews-modal')
  await p.getByTestId('pod-outputs-render-start').click()
  await expect.poll(() => api.state.renders.started?.length).toBe(1)
  await p.locator('.modal-footer button').click(); await page.getByTestId('pod-outputs-modal').locator('.btn-close').click()
  Object.assign(api.state.renders.jobs[0], { frames_total: 4, frames_done: 2, rate_fps: 4 })
  await expect(page.getByTestId('queue-badge')).toHaveText('1', { timeout: 8000 })   // counted in the badge, with no window open
  const q = await openQueue(page)
  await expect(gens(q).getByTestId('generations-job-title')).toHaveText('Proxy: 2 sequences · all outputs')
  await expect(gens(q).getByTestId('generations-job-bar')).toHaveAttribute('data-percent', '50', { timeout: 6000 })
})

test('the Previews batch survives closing the Outputs window, shows in Generations as "Previews: n of N" with Stop, and Stop ends it', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'] = [seqRun(6)]
  let hits = 0
  await page.context().route('**/view?*', async (r) => { hits++; await new Promise((res) => setTimeout(res, 400)); await r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }).catch(() => {}) })
  await page.addInitScript(() => { try { indexedDB.deleteDatabase('pod-manager-thumbs') } catch { /* none */ } })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Previews' }).click()
  const pv = page.getByTestId('pod-outputs-previews-modal')
  await pv.getByTestId('pod-outputs-load-previews').click()
  await expect.poll(() => hits).toBeGreaterThan(0)
  await pv.locator('.modal-footer button').click(); await page.getByTestId('pod-outputs-modal').locator('.btn-close').click()
  await expect(page.getByTestId('pod-outputs-modal')).toBeHidden()
  await expect(page.getByTestId('queue-badge')).toHaveText('1')
  const q = await openQueue(page)
  const b = gens(q).getByTestId('generations-previews')
  await expect(b).toHaveAttribute('data-state', 'running')
  await expect(b.getByTestId('generations-previews-line')).toHaveText(/^Previews: \d+ of 6$/)
  const before = hits
  await expect.poll(() => hits, { timeout: 8000 }).toBeGreaterThan(before)   // it kept working with the window closed
  await b.getByTestId('generations-previews-stop').click()
  await expect(b).toHaveAttribute('data-state', 'cancelled'); await expect(b.getByTestId('generations-previews-state')).toHaveText('Previews stopped')
  const after = hits; await page.waitForTimeout(1200); expect(hits).toBeLessThanOrEqual(after + 1)   // at most the one in flight
  await expect(page.getByTestId('queue-badge')).toHaveCount(0)
})

test('reopening the Outputs window shows the running batch again (the button is busy, Stop is there)', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'] = [seqRun(5)]
  await page.context().route('**/view?*', async (r) => { await new Promise((res) => setTimeout(res, 500)); await r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }).catch(() => {}) })
  await page.addInitScript(() => { try { indexedDB.deleteDatabase('pod-manager-thumbs') } catch { /* none */ } })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Previews' }).click()
  await page.getByTestId('pod-outputs-previews-modal').getByTestId('pod-outputs-load-previews').click()
  await page.getByTestId('pod-outputs-previews-modal').locator('.modal-footer button').click(); await page.getByTestId('pod-outputs-modal').locator('.btn-close').click()
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await expect(page.getByTestId('pod-outputs-previews')).toContainText('Generating')
  await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Previews' }).click()
  await expect(page.getByTestId('pod-outputs-previews-modal').getByTestId('pod-outputs-stop-previews')).toBeVisible()
  await expect(page.getByTestId('pod-outputs-previews-modal').getByTestId('pod-outputs-load-previews')).toBeDisabled()
})

test('failed previews: the batch line lists the failed sequences with their reasons (open when it just ended), paged 5/10/25, and the History gets the first 20 plus one summary', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'] = [seqRun(25, 1)]
  await page.context().route('**/view?*', (r) => r.fulfill({ status: 500, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'boom https://pod.example/view?token=secret' }))
  await page.addInitScript(() => { try { indexedDB.deleteDatabase('pod-manager-thumbs') } catch { /* none */ } })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Previews' }).click()
  await page.getByTestId('pod-outputs-previews-modal').getByTestId('pod-outputs-load-previews').click()
  await page.getByTestId('pod-outputs-previews-modal').locator('.modal-footer button').click(); await page.getByTestId('pod-outputs-modal').locator('.btn-close').click()
  await expect.poll(async () => (api.state.history.notes || []).length, { timeout: 30000 }).toBe(21)
  const q = await openQueue(page)
  const b = gens(q).getByTestId('generations-previews')
  await expect(b).toHaveAttribute('data-state', 'done', { timeout: 20000 })
  await expect(b.getByTestId('generations-previews-line')).toHaveText('Previews: 25 of 25 · 25 failed')
  await expect(b.getByTestId('previews-failures-list')).toBeVisible()   // open: it just finished with failures
  await expect(b.getByTestId('previews-failure')).toHaveCount(10)
  const first = b.getByTestId('previews-failure').first()
  await expect(first.getByTestId('previews-failure-name')).toHaveText(/^s\d+_proxy\.#+\.dpx$|^s\d+_proxy\.\d+\.dpx$/)
  await expect(first.getByTestId('previews-failure-pod')).toHaveText('on ComfyUI-Dev')
  await expect(first.getByTestId('previews-failure-reason')).not.toBeEmpty()
  await expect(b).not.toContainText('secret')   // URLs are struck out
  const info = b.getByTestId('previews-failures-page-info'), prev = b.getByTestId('previews-failures-page-prev'), next = b.getByTestId('previews-failures-page-next'), size = b.getByTestId('previews-failures-page-size')
  await expect(info).toHaveText('1–10 of 25'); await expect(prev).toBeDisabled()
  await next.click(); await expect(info).toHaveText('11–20 of 25'); await next.click(); await expect(info).toHaveText('21–25 of 25'); await expect(next).toBeDisabled(); await expect(b.getByTestId('previews-failure')).toHaveCount(5)
  await size.selectOption('5'); await expect(info).toHaveText('1–5 of 25')   // a new size starts at page 1
  await size.selectOption('25'); await expect(info).toHaveText('1–25 of 25'); await expect(b.getByTestId('previews-failure')).toHaveCount(25)
  await b.getByTestId('previews-failures-toggle').click(); await expect(b.getByTestId('previews-failures-list')).toHaveCount(0)
  // the History: the first 20 one by one, then one summary
  const notes = api.state.history.notes
  expect(notes.filter((n) => n.action === 'preview failed')).toHaveLength(20); expect(notes.filter((n) => n.action === 'previews failed')).toHaveLength(1)
  expect(notes[0]).toMatchObject({ kind: 'change', area: 'outputs', action: 'preview failed' }); expect(notes[0].detail).toContain('ComfyUI-Dev'); expect(JSON.stringify(notes)).not.toContain('secret')
  expect(notes.at(-1).detail).toMatch(/^25 of 25 previews failed/)
})

test('the badge adds running generations to what it counted: a render job and a preview batch', async ({ page, api }) => {
  api.state.renders = { jobs: [job(), job({ job_id: 'job-2', state: 'done' })] }
  await page.goto('/')
  await expect(page.getByTestId('queue-badge')).toHaveText('1')   // the finished one is not counted
  api.state.renders.jobs[0].state = 'done'
  await expect(page.getByTestId('queue-badge')).toHaveCount(0, { timeout: 8000 })
})

test('a core without the render calls hides the section quietly', async ({ page, api }) => {
  api.state.rendersOld = true
  await page.goto('/')
  const q = await openQueue(page)
  await expect(q.getByTestId('queue-generations')).toHaveCount(0)
  await page.getByTestId('queue-tab-syncs').click(); await expect(q.getByTestId('queue-syncs')).toBeVisible()   // the rest of the Queue is there
})

test('Play is the first, leftmost item of every row, in a slot of the same width; disabled until there is something to play', async ({ page, api }) => {
  const job = (o) => ({ job_id: 'j', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', kind: 'proxy', state: 'rendering', started_at: '2026-11-19T10:00:00Z', finished_at: null, frames_done: 1, frames_total: 5, rate_fps: 1, current: '', pulled_files: 0, pulled_bytes: 0, error: '', summary: '', sequences: [], ...o })
  api.state.renders = { jobs: [job({ job_id: 'run' }), job({ job_id: 'done', state: 'done', finished_at: 'now', sequences: [{ dir: 'a', name: 'A', where: 'pod', state: 'pulled', frames_done: 5, frames_total: 5 }] }), job({ job_id: 'bad', state: 'failed', error: 'x' })] }
  await page.goto('/'); await queueTab(page, 'generations')
  const c = (id) => page.locator(`[data-testid="generations-job"][data-job="${id}"]`)
  const xs = []
  for (const id of ['run', 'done', 'bad']) {
    const first = await c(id).locator('xpath=./div[1]/*[1]').getAttribute('data-testid'); expect(first).toBe('generations-job-play-slot')   // the first child of the header row
    xs.push((await c(id).getByTestId('generations-job-play-slot').boundingBox()).x)
  }
  expect(new Set(xs.map((x) => Math.round(x))).size).toBe(1)   // the columns do not shift
  await expect(c('done').getByTestId('generations-job-play')).toBeEnabled(); await expect(c('run').getByTestId('generations-job-play-disabled')).toBeDisabled(); await expect(c('bad').getByTestId('generations-job-play-disabled')).toBeDisabled()
})

test('an automatic review shows the real steps: no Sync step when it stayed on the volume, and a Publishing to S3 step that follows Auto-publish', async ({ page, api }) => {
  const rv = (o = {}) => job({ job_id: 'auto-1', kind: 'review', state: 'done', trigger: 'auto-publish', pull: false, finished_at: '2026-11-19T10:05:00Z', frames_done: 94, frames_total: 94,
    sequences: [{ dir: 'mono/a', name: 'archival-080_a_mono', clip_name: 'archival-080_a_mono', where: 'pod', state: 'rendered', shot: 'archival-080', version: 1, frames_done: 94, frames_total: 94 }], ...o })
  const ap = (state) => ({ id: 'ap-1', shot: 'archival-080', version: 'v001', state, files: 5, bytes: 1e8, due_at: new Date(Date.now() + 300000).toISOString(), targets: ['s3', 'slack'] })
  api.state.renders = { jobs: [rv()] }; api.state.autopublish = { pending: [ap('waiting')] }
  await page.goto('/')
  const q = await openQueue(page), c = gens(q).getByTestId('generations-job')
  await expect(c.locator('[data-testid="generations-phase"][data-phase="syncing"]')).toHaveCount(0)   // pull false: nothing is copied to this PC
  await expect(c.locator('[data-testid="generations-phase"][data-phase="rendering"]')).toHaveCount(1)
  await expect(c.getByTestId('generations-job-autopub')).toHaveText('Publishing to S3: waiting for the window'); await expect(c.getByTestId('generations-job-autopub')).toHaveAttribute('data-state', 'waiting')
  api.state.autopublish = { pending: [ap('uploading')] }
  await expect(c.getByTestId('generations-job-autopub')).toHaveText('Publishing to S3: uploading', { timeout: 12000 })
  api.state.autopublish = { pending: [], recent: [{ ...ap('done') }] }
  await expect(c.getByTestId('generations-job-autopub')).toHaveText('Publishing to S3: uploaded', { timeout: 12000 })
  // a job that did pull keeps its Sync step; a manual job has no automatic Publishing step
  api.state.renders = { jobs: [rv({ job_id: 'man-1', trigger: 'manual', pull: true })] }
  await expect(c.locator('[data-testid="generations-phase"][data-phase="syncing"]')).toHaveCount(1, { timeout: 12000 }); await expect(c.getByTestId('generations-job-autopub')).toHaveCount(0)
})
