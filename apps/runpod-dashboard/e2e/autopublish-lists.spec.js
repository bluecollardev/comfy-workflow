import { test, expect, queueTab } from './fixtures'

// The Queue's Auto-publish section shows every list the core's status carries (AutoPublishLists, AutoPublishList): rendering now, generated today,
// not generated, uploaded today, skipped, pending uploads and recent, each with its count and a Show / Hide control; only Rendering Now and Pending Uploads start open.
const on = (api, o = {}) => { api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: 50, dry_run_first: true, targets: { s3: true, slack: true, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' }, ...o } }
const due = () => new Date(Date.now() + 580000).toISOString()
const at = (i) => new Date(Date.UTC(2026, 10, 21, 8, 0, i)).toISOString()
const stems = (n) => Array.from({ length: n }, (_, i) => ({ stem: `SEQ-${String(i).padStart(3, '0')}`, key: `delivery_v008/SEQ-${String(i).padStart(3, '0')}/SEQ-${String(i).padStart(3, '0')}`, at: at(i), job_id: `render-${i}`, state: i < 40 ? 'done' : i < 43 ? 'retrying' : 'failed' }))
const fixture = () => ({
  pending: [1, 2, 3, 4].map((i) => ({ id: `d${i}`, shot: `archival-0${i}0`, version: 1, files: 3, bytes: 289e6, state: 'would_upload', targets: ['s3'], due_at: due() })),
  recent: [{ id: 'r1', shot: 'archival-071', version: 1, files: 3, bytes: 1e6, state: 'done', done_at: new Date().toISOString() }],
  generate: {
    enabled: true, where: 'pod', preset: 'review', enabled_at: '2026-11-19T07:42:41Z', generating: 1, generated_today: 44, max_per_day: 500, failed: [], pending_existing: 0,
    waiting_to_settle: Array.from({ length: 10 }, (_, i) => ({ stem: `WAIT-${i}`, shot: '', since: new Date().toISOString(), source: 'volume', frames: 100 + i, seen: 1 })),
    skipped: [{ stem: 'NOEDL-1', reason: 'not in the V11 EDL', code: 'edl' }, { stem: 'NOEDL-2', reason: 'no start timecode', code: 'edl' }],
    running: [{ stem: 'ARCHIVAL-087_RAIN', key: 'delivery_v008/ARCHIVAL-087_RAIN/ARCHIVAL-087_RAIN', job_id: 'render-77', started_at: new Date(Date.now() - 120000).toISOString() }],
    generated: stems(44),
  },
  watching: {
    local: { enabled: false, root: null, root_exists: false, reviews: 0 }, volume: { enabled: true, id: 'a3upg9ey48', reviews: 68, scanned_at: new Date().toISOString(), scanning: false },
    root: null, root_exists: false, shots: 21, reviews: 68, approved: 66, eligible: 3, queued: 0, uploaded_today: 21, summary: 'Watching the volume',
    uploaded: Array.from({ length: 21 }, (_, i) => ({ shot: `archival-${String(100 + i)}`, version: 1, at: at(i), ...(i === 0 ? { manual: true } : {}) })),
    skipped: [{ shot: 'archival-080', version: 6, reason: 'no review video (.mov or .mp4) in the folder' }, { shot: 'archival-103', version: 1, reason: 'no review video (.mov or .mp4) in the folder' }, { shot: 'photoreal-013', version: 7, reason: 'not approved' }],
  },
})

test.describe('Auto-publish section: every list', () => {
  test('each list has a count in its title; only Rendering Now and Pending Uploads start open', async ({ page, api }) => {
    on(api); api.state.autopublish = fixture()
    await page.goto('/'); await queueTab(page, 'publishing')
    await expect(page.getByTestId('autopublish-list-running-title')).toHaveText('Rendering Now (1)')
    await expect(page.getByTestId('autopublish-list-running')).toHaveAttribute('data-open', 'true')
    await expect(page.getByTestId('autopublish-list-generated-title')).toHaveText('Generated Today (44)')
    await expect(page.getByTestId('autopublish-list-not-generated-title')).toHaveText('Not Generated (2)')
    await expect(page.getByTestId('autopublish-list-uploaded-title')).toHaveText('Uploaded Today (21)')
    await expect(page.getByTestId('autopublish-list-skipped-title')).toHaveText('Skipped (3)')
    await expect(page.getByTestId('autopublish-pending-title')).toHaveText('Pending Uploads (4)')
    await expect(page.getByTestId('autopublish-pending-head')).toHaveAttribute('data-open', 'true')
    await expect(page.getByTestId('autopublish-recent-title')).toHaveText('Recent (1)')
    for (const id of ['generated', 'not-generated', 'uploaded', 'skipped']) await expect(page.getByTestId(`autopublish-list-${id}`)).toHaveAttribute('data-open', 'false')
    await expect(page.getByTestId('autopublish-recent-head')).toHaveAttribute('data-open', 'false')
    await expect(page.getByTestId('autopublish-row')).toHaveCount(4); await expect(page.getByTestId('autopublish-row').first()).toBeVisible()
    await expect(page.getByTestId('autopublish-recent').first()).toBeHidden()
  })
  test('Generated Today shows 25 rows at a time (Show More, Show All) with where each stands; the running row names the sequence and the job', async ({ page, api }) => {
    on(api); api.state.autopublish = fixture()
    await page.goto('/'); await queueTab(page, 'publishing')
    const running = page.getByTestId('autopublish-list-running').getByTestId('autopublish-list-row')
    await expect(running).toHaveCount(1); await expect(running).toContainText('ARCHIVAL-087_RAIN'); await expect(running).toContainText('render-77'); await expect(running).toContainText('rendering')
    const list = page.getByTestId('autopublish-list-generated')
    await list.getByTestId('autopublish-list-generated-toggle').click(); await expect(list).toHaveAttribute('data-open', 'true')
    await expect(list.getByTestId('autopublish-list-row')).toHaveCount(25); await expect(list.getByTestId('autopublish-list-generated-shown')).toHaveText('25 of 44')
    await list.getByTestId('autopublish-list-generated-more').click(); await expect(list.getByTestId('autopublish-list-row')).toHaveCount(44)
    await expect(list.getByTestId('autopublish-list-row').first()).toHaveAttribute('data-state', 'failed')   // newest first
    await expect(list.getByTestId('autopublish-list-row').last()).toHaveAttribute('data-state', 'done')
    await list.getByTestId('autopublish-list-generated-toggle').click(); await expect(list).toHaveAttribute('data-open', 'false')
  })
  test('Uploaded Today, Skipped (with the reasons) and Not Generated list their rows with a View In Outputs link; Recent opens on its control', async ({ page, api }) => {
    on(api); api.state.autopublish = fixture()
    await page.goto('/'); await queueTab(page, 'publishing')
    const up = page.getByTestId('autopublish-list-uploaded'); await up.getByTestId('autopublish-list-uploaded-toggle').click()
    await expect(up.getByTestId('autopublish-list-row')).toHaveCount(21); await expect(up.getByTestId('autopublish-view-outputs')).toHaveCount(21)
    await expect(up.getByTestId('autopublish-list-row').last()).toContainText('published by a person')   // newest first: the first upload (a person's) is last
    const sk = page.getByTestId('autopublish-list-skipped'); await sk.getByTestId('autopublish-list-skipped-toggle').click()
    await expect(sk.getByTestId('autopublish-list-row')).toHaveText([/archival-080 v006\s*no review video/, /archival-103 v001\s*no review video/, /photoreal-013 v007\s*not approved/].map((r) => r))
    const ng = page.getByTestId('autopublish-list-not-generated'); await ng.getByTestId('autopublish-list-not-generated-toggle').click()
    await expect(ng.getByTestId('autopublish-list-row')).toHaveText(['NOEDL-1: not in the V11 EDL', 'NOEDL-2: no start timecode'])
    await page.getByTestId('autopublish-recent-toggle').click(); await expect(page.getByTestId('autopublish-recent').first()).toBeVisible()
  })
})
