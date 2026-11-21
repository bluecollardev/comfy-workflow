import { test, expect, queueTab, answerConfirm } from './fixtures'

// The frame-previews jobs in the Queue's Generations (Lucas, 2026-11-21: "i should see previews jobs in queue no? generations tab?", "and thumbnails generation, frames generation etc"):
// one row per job with what it is (Frame Previews, Thumbnails, Posters, Auto Previews), the pod, a bar and the counters per kind, Cancel / Relaunch / Remove, a filter, the Overview and the tab badge.
const NOW = Date.now()
const row = (o) => ({ job_id: 'framepreviews-1', pod_id: 'pod-aaaaaaaa', state: 'running', started_at: new Date(NOW - 125_000).toISOString(), external: false, trigger: 'manual', items: 3, current: '_delivery_v11/PHOTOREAL-013_TOP_FINAL_V02', relaunchable: false,
  frames_total: 650, frames_done: 412, frames_written: 412, thumbs_done: 380, thumbs_made: 380, posters_total: 12, posters_done: 3, posters_failed: 0, failed: 0, ...o })
const ROWS = [
  row({ job_id: 'fp-frames' }),
  row({ job_id: 'fp-thumbs', frames_total: 300, frames_done: 300, frames_written: 0, thumbs_done: 120, thumbs_made: 120, posters_total: 0, posters_done: 0, current: '_delivery_v11/CGI-072_HEAD' }),
  row({ job_id: 'fp-posters', frames_total: 0, frames_done: 0, frames_written: 0, thumbs_done: 0, thumbs_made: 0, posters_total: 12, posters_done: 5, current: 'assembly_v024/cgi-042/review025/movie' }),
  row({ job_id: 'fp-auto', trigger: 'automatic', frames_total: 100, frames_done: 20, frames_written: 20, thumbs_done: 20, thumbs_made: 20, posters_total: 0, posters_done: 0 }),
  row({ job_id: 'fp-ext', external: true, origin: 'mcp', client: 'claude-code', pod_id: 'pod-unknown-1', frames_total: 50, frames_done: 10, thumbs_done: 9, posters_total: 0, posters_done: 0 }),
  row({ job_id: 'fp-failed', state: 'failed', finished_at: new Date(NOW - 60_000).toISOString(), error: 'the script ended with code 255 on _delivery_v11/ARCHIVAL-168_A', relaunchable: true, failed: 8, frames_total: 1548, frames_done: 1540, thumbs_done: 1540, posters_total: 0, posters_done: 0 }),
  row({ job_id: 'fp-done', state: 'done', finished_at: new Date(NOW - 30_000).toISOString(), frames_total: 647, frames_done: 647, thumbs_done: 647, posters_total: 0, posters_done: 0, relaunchable: false }),
]
const sec = (page) => page.getByTestId('queue-modal').getByTestId('queue-previewjobs')
const byId = (page, id) => sec(page).locator(`[data-job="${id}"]`)

test('the jobs are rows in Generations: what each is, the pod, the bar and the counters per kind; the tab counts the running ones', async ({ page, api }) => {
  api.state.fpJobRows = ROWS
  await page.goto('/')
  await queueTab(page, 'generations')
  const s = sec(page)
  await expect(s.getByTestId('queue-previewjobs-title')).toHaveText('Previews (5 running)')
  await expect(s.getByTestId('queue-previewjob')).toHaveCount(7)
  const frames = byId(page, 'fp-frames')
  await expect(frames).toHaveAttribute('data-kind', 'frames'); await expect(frames.getByTestId('queue-previewjob-label')).toHaveText('Frame Previews')
  await expect(frames.getByTestId('queue-previewjob-counters')).toHaveText('Frames 412 of 650 · Thumbnails 380 of 650 · Posters 3 of 12 · 63%')   // all three kinds, and one percentage ((412 + 3) of (650 + 12))
  await expect(frames.getByTestId('queue-previewjob-bar')).toHaveAttribute('data-percent', '63')
  await expect(frames.getByTestId('queue-previewjob-pod')).toHaveText('ComfyUI-Dev')   // the pod's name from the pods list
  await expect(frames.getByTestId('queue-previewjob-current')).toContainText('PHOTOREAL-013_TOP_FINAL_V02')
  await expect(frames.getByTestId('queue-previewjob-elapsed')).toHaveText(/^2 min \d+ s$/)
  await expect(frames.getByTestId('queue-previewjob-state')).toHaveText('running')
  await expect(byId(page, 'fp-thumbs')).toHaveAttribute('data-kind', 'thumbnails'); await expect(byId(page, 'fp-thumbs').getByTestId('queue-previewjob-label')).toHaveText('Thumbnails')   // every JPEG was there: only thumbnails were made
  await expect(byId(page, 'fp-posters').getByTestId('queue-previewjob-label')).toHaveText('Posters')
  await expect(byId(page, 'fp-posters').getByTestId('queue-previewjob-counters')).toHaveText('Posters 5 of 12 · 42%')
  await expect(byId(page, 'fp-auto').getByTestId('queue-previewjob-label')).toHaveText('Auto Previews')
  const ext = byId(page, 'fp-ext')
  await expect(ext.getByTestId('queue-previewjob-external')).toHaveText('claude-code'); await expect(ext.getByTestId('queue-previewjob-pod')).toHaveText('pod-unknown-1')   // a pod the list does not know shows its id
  const failed = byId(page, 'fp-failed')
  await expect(failed.getByTestId('queue-previewjob-error')).toContainText('code 255'); await expect(failed.getByTestId('queue-previewjob-failed')).toHaveText('8 failed')
  await expect(failed.getByTestId('queue-previewjob-relaunch')).toHaveText('Relaunch'); await expect(failed.getByTestId('queue-previewjob-remove')).toHaveText('Remove')
  await expect(byId(page, 'fp-done').getByTestId('queue-previewjob-relaunch')).toHaveCount(0)   // nothing to run again
  await expect(byId(page, 'fp-done').getByTestId('queue-previewjob-remove')).toHaveText('Remove')
  await expect(page.getByTestId('queue-modal').getByTestId('queue-tab-generations')).toContainText('5')
})

test('Cancel stops a running job (also another process\'s), Remove hides a finished one for the session, Remove Finished hides them all; a bar has room below it', async ({ page, api }) => {
  api.state.fpJobRows = ROWS.map((r) => ({ ...r }))
  await page.goto('/')
  await queueTab(page, 'generations')
  const frames = byId(page, 'fp-frames')
  await frames.getByTestId('queue-previewjob-cancel').click()
  await expect(frames).toHaveAttribute('data-state', 'cancelled'); expect(api.state.fp.cancelAny).toEqual(['fp-frames'])
  await expect(frames.getByTestId('queue-previewjob-cancel')).toHaveCount(0); await expect(frames.getByTestId('queue-previewjob-remove')).toHaveText('Remove')   // over now: Remove instead of Cancel
  await byId(page, 'fp-ext').getByTestId('queue-previewjob-cancel').click()   // another process's job: the owner is asked
  await expect(byId(page, 'fp-ext')).toHaveAttribute('data-state', 'cancelled'); expect(api.state.fp.cancelAny).toEqual(['fp-frames', 'fp-ext'])
  // the bar keeps its room below it (the 8 px of the progress-bar rule), so the counters never touch it
  const gap = await frames.getByTestId('queue-previewjob-bar').evaluate((el) => parseFloat(getComputedStyle(el).marginBottom))
  expect(gap).toBeGreaterThanOrEqual(8)
  await byId(page, 'fp-done').getByTestId('queue-previewjob-remove').click()
  await expect(byId(page, 'fp-done')).toHaveCount(0)
  await expect(sec(page).getByTestId('queue-previewjobs-remove-all')).toHaveText('Remove Finished (3)')   // failed, the cancelled frames job and the cancelled external one
  await sec(page).getByTestId('queue-previewjobs-remove-all').click()
  await expect(sec(page).getByTestId('queue-previewjob')).toHaveCount(3)   // thumbnails, posters and auto previews are still running
  await expect(sec(page).getByTestId('queue-previewjobs-remove-all')).toHaveCount(0)
})

test('Relaunch runs the unfinished folders again; with no pod running it says Resume A Pod first and names the stopped pod, and Resume Pod asks before it spends', async ({ page, api }) => {
  api.state.fpJobRows = [ROWS.find((r) => r.job_id === 'fp-failed')]
  api.state.fpNeedsPod = true
  await page.goto('/')
  await queueTab(page, 'generations')
  const failed = byId(page, 'fp-failed')
  await failed.getByTestId('queue-previewjob-relaunch').click()
  const needs = failed.getByTestId('queue-previewjob-needs-pod')
  await expect(needs).toContainText('No pod is running: Resume A Pod first'); await expect(needs).toContainText('ComfyUI-Landing')
  expect(api.state.fp.relaunches.length).toBe(1); expect(Object.keys(api.state.fp.jobs).length).toBe(0)   // asked once, nothing was started
  await needs.getByTestId('queue-previewjob-resume-pod').click()
  expect(await answerConfirm(page, false)).toContain('ComfyUI-Landing')   // it bills while it runs: it asks first, and No keeps everything as it was
  await expect(needs).toBeVisible()
  api.state.fpNeedsPod = false   // a pod runs now: the same folders are asked for again, as a new job, with Skip Existing on
  await failed.getByTestId('queue-previewjob-relaunch').click()
  await expect(needs).toHaveCount(0)
  expect(api.state.fp.relaunches.length).toBe(2); expect(api.state.fp.relaunches[1].job_id).toBe('fp-failed')
  const again = Object.values(api.state.fp.jobs)[0]
  expect(again.relaunch_of).toBe('fp-failed'); expect(again.skip_existing).toBe(true)
})

test('the filter shows All, Renders, Previews or Review Videos: the previews jobs and the review previews are under Previews, the graph runs under Renders', async ({ page, api }) => {
  api.state.fpJobRows = ROWS
  api.state.runJobs = [{ job_id: 'run-1', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', element: 'photoreal-013 top', path: 'p', state: 'running', started_at: new Date(NOW - 60_000).toISOString(), external: false, frames_done: 12, frames_total: 209, chunk: 1, chunks: 8 }]
  await page.goto('/')
  await queueTab(page, 'generations')
  const q = page.getByTestId('queue-modal')
  await expect(q.getByTestId('generations-filter')).toBeVisible()
  await expect(q.getByTestId('queue-previewjobs')).toBeVisible(); await expect(q.getByTestId('queue-runjobs')).toBeVisible()   // All
  await q.getByTestId('generations-filter-previews').click()
  await expect(q.getByTestId('queue-previewjobs')).toBeVisible(); await expect(q.getByTestId('queue-runjobs')).toHaveCount(0)
  await q.getByTestId('generations-filter-renders').click()
  await expect(q.getByTestId('queue-previewjobs')).toHaveCount(0); await expect(q.getByTestId('queue-runjobs')).toBeVisible()
  await q.getByTestId('generations-filter-review').click()
  await expect(q.getByTestId('queue-previewjobs')).toHaveCount(0); await expect(q.getByTestId('queue-runjobs')).toHaveCount(0)
  await expect(q.getByTestId('generations-filter-review')).toHaveText('Review Videos'); await expect(q.getByTestId('generations-filter-review')).toHaveAttribute('aria-pressed', 'true')
  await q.getByTestId('generations-filter-all').click()
  await expect(q.getByTestId('queue-previewjobs')).toBeVisible(); await expect(q.getByTestId('queue-runjobs')).toBeVisible()
})

test('the Overview lists a running previews job as a Working row and its Cancel stops it', async ({ page, api }) => {
  api.state.fpJobRows = ROWS.map((r) => ({ ...r }))
  await page.goto('/')
  await page.getByTestId('open-queue').click()
  const q = page.getByTestId('queue-modal')
  const mine = q.getByTestId('queue-working-row').filter({ hasText: 'fp-frames' })
  await expect(mine).toHaveCount(1); await expect(mine).toHaveAttribute('data-kind', 'previewjob'); await expect(mine).toContainText('Frame Previews'); await expect(mine).toContainText('Frames 412 of 650')
  await expect(q.getByTestId('queue-working-row').filter({ hasText: 'fp-auto' })).toContainText('Auto Previews')
  await mine.getByTestId('queue-working-cancel').click()
  await expect.poll(() => api.state.fp?.cancelAny || []).toContain('fp-frames')
})

test('a core without the call shows no section and no error; with no jobs there is no section either', async ({ page, api }) => {
  api.state.fpJobsOld = true
  await page.goto('/')
  await queueTab(page, 'generations')
  await expect(page.getByTestId('queue-modal').getByTestId('queue-generations')).toBeVisible()
  await expect(page.getByTestId('queue-modal').getByTestId('queue-previewjobs')).toHaveCount(0)
})
