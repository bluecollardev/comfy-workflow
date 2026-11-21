import { test, expect, queueTab, answerConfirm } from './fixtures'

// The render runs (graph generations) in the Queue (Lucas, 2026-11-21: "in queue why don't i see these renderings happening", "these are generations"): one row per run with the pod, the element,
// frames and chunk, ComfyUI's own step, the rate and ETA; Cancel asks first; the Generations tab and the Overview count them.
const T0 = '2026-11-21T10:07:00.000Z'
const eta = new Date(Date.now() + 40 * 60000).toISOString()
const run = (o) => ({ job_id: `run-${o.pod_id}-1`, pod_name: o.pod_name, state: 'running', started_at: T0, external: false, path: `base_v008/x/${o.element}.json`, rate_spf: 29, eta, ...o })
const JOBS = [
  run({ pod_id: 'kqdx2u4xqs8jef', pod_name: 'ComfyUI-v008-top-2x4500', element: 'photoreal-013 top', frames_done: 122, frames_total: 209, chunk: 5, chunks: 8, live: { state: 'live', node: '7', node_class: 'SeedVR2VideoUpscaler', node_title: 'SeedVR2 sampling', step: 3, max: 12, percent: 25, ts: 1 } }),
  run({ pod_id: 'h563hjyoacn5p0', pod_name: 'ComfyUI-v008-landing-2x4500', element: 'photoreal-013 landing', frames_done: 166, frames_total: 226, chunk: 7, chunks: 9, live: { state: 'waiting', reason: 'waiting for the next step', ts: 1 } }),
  run({ pod_id: 'zlujagddxx5gop', pod_name: 'ComfyUI-v008-sunlight-2x4500', element: 'photoreal-013 sunlight', frames_done: 94, frames_total: 212, chunk: 4, chunks: 8, external: true, client: 'claude-code', live: { state: 'none', reason: 'no live progress (socket closed (403))', ts: 1 } }),
  { job_id: 'run-old-1', pod_id: 'so7icc2vb2j80o', pod_name: 'ComfyUI-v008-ram-test', element: 'cgi-072 backhalf-b', state: 'done', started_at: '2026-11-21T09:00:00.000Z', finished_at: '2026-11-21T09:50:00.000Z', external: false, path: 'p', frames_done: 70, frames_total: 70, chunk: 7, chunks: 7 },
]

test('the three running renders are rows in Generations with their pod, element, frames, chunk, ComfyUI step and rate; the tab counts them', async ({ page, api }) => {
  api.state.runJobs = JOBS
  await page.goto('/')
  await queueTab(page, 'generations')
  const q = page.getByTestId('queue-modal'), sec = q.getByTestId('queue-runjobs')
  await expect(sec.getByTestId('queue-runjobs-title')).toHaveText('Graph Generations (3 running)')
  const rows = sec.getByTestId('queue-runjob')
  await expect(rows).toHaveCount(4)   // 3 running + 1 finished
  const top = rows.filter({ hasText: 'photoreal-013 top' })
  await expect(top.getByTestId('queue-runjob-pod')).toHaveText('ComfyUI-v008-top-2x4500')
  await expect(top.getByTestId('queue-runjob-progress')).toContainText('122 of 209 frames · chunk 5 of 8 · SeedVR2 sampling 3/12 · 25%')
  await expect(top.getByTestId('queue-runjob-bar')).toHaveAttribute('data-percent', '58')
  await expect(top.getByTestId('queue-runjob-rate')).toContainText('29 s/frame')
  const landing = rows.filter({ hasText: 'photoreal-013 landing' })
  await expect(landing.getByTestId('queue-runjob-waiting')).toHaveText('waiting for the next step')
  const sun = rows.filter({ hasText: 'photoreal-013 sunlight' })
  await expect(sun.getByTestId('queue-runjob-nolive')).toHaveText('no live progress')
  await expect(sun.getByTestId('queue-runjob-nolive')).toHaveAttribute('title', /socket closed/)
  await expect(sun.getByTestId('queue-runjob-external')).toHaveText('claude-code')
  await expect(rows.filter({ hasText: 'cgi-072 backhalf-b' }).getByTestId('queue-runjob-progress')).toContainText('70 of 70 frames')
  await expect(q.getByTestId('queue-tab-generations')).toContainText('3')
})

test('the Overview lists them as Working rows and Cancel asks first, then cancels that run only', async ({ page, api }) => {
  api.state.runJobs = JOBS
  await page.goto('/')
  await page.getByTestId('open-queue').click()
  const q = page.getByTestId('queue-modal')
  const g = q.getByTestId('queue-working-row').filter({ hasText: 'Generation: photoreal-013 top' })
  await expect(g).toHaveCount(1)
  await expect(g.getByTestId('queue-working-progress')).toHaveCount(0)   // the progress cell has no own test id: its text is checked on the row
  await expect(g).toContainText('122 of 209 frames · chunk 5 of 8')
  await g.getByTestId('queue-working-cancel').click()
  const msg = await answerConfirm(page, false)
  expect(msg).toContain('photoreal-013 top'); expect(msg).toContain('ComfyUI-v008-top-2x4500')
  expect(api.state.cancelledRuns || []).toHaveLength(0)
  await g.getByTestId('queue-working-cancel').click()
  await answerConfirm(page, true)
  await expect.poll(() => api.state.cancelledRuns || []).toEqual(['run-kqdx2u4xqs8jef-1'])
  await q.getByTestId('queue-tab-generations').click()
  await expect(q.getByTestId('queue-runjob').filter({ hasText: 'photoreal-013 top' })).toHaveAttribute('data-state', 'cancelled')
})

test('the Generations Cancel on a row asks first too', async ({ page, api }) => {
  api.state.runJobs = JOBS
  await page.goto('/')
  await queueTab(page, 'generations')
  const q = page.getByTestId('queue-modal')
  const land = q.getByTestId('queue-runjob').filter({ hasText: 'photoreal-013 landing' })
  await land.getByTestId('queue-runjob-cancel').click()
  await answerConfirm(page, false)
  expect(api.state.cancelledRuns || []).toHaveLength(0)
  await land.getByTestId('queue-runjob-cancel').click()
  await answerConfirm(page, true)
  await expect.poll(() => api.state.cancelledRuns || []).toEqual(['run-h563hjyoacn5p0-1'])
})
