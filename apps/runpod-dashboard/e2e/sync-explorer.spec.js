import { test, expect, podCard } from './fixtures'
import { t } from './i18n'

// The Sync logs window (from a card's Sync window) and the Sync explorer under the Queue (docs/ADR-046).
const DEV = 'pod-aaaaaaaa', BATCH = 'pod-bbbbbbbb'
const iso = (minsAgo = 0) => new Date(Date.now() - minsAgo * 60e3).toISOString()
const MB = 1024 ** 2, GB = 1024 ** 3
const line = (level, text, n = 0) => ({ ts: iso(10 - n / 100), level, text })
const active = (over = {}) => ({
  run_id: 'run-act', pod_id: DEV, pod_name: 'ComfyUI-Dev', direction: 'pull', trigger: 'auto-sync:feed', state: 'running', started_at: iso(1),
  steps: [{ key: 'output', state: 'running', files_done: 12, files_total: 20, bytes_done: 1 * GB, bytes_total: 1.5 * GB }, { key: 'workflows', state: 'queued', files_done: 0, files_total: 5, bytes_done: 0, bytes_total: 10 * MB }],
  files_done: 12, files_total: 25, bytes_done: 1.1 * GB, bytes_total: 1.2 * GB, rate_bps: 38 * MB, eta_s: 3, streams: 4,
  current_files: [{ path: 'output/r1/frame_0012.png', bytes_done: 5 * MB, bytes_total: 10 * MB, percent: 50 }, { path: 'output/r1/frame_0013.png', bytes_done: 1 * MB, bytes_total: 4 * MB, percent: 25 }],
  recent_files: ['output/r1/frame_0010.png', 'output/r1/frame_0011.png', 'output/r1/frame_0009.png'], ...over,
})
const done = (over = {}) => ({ run_id: 'run-1', pod_id: DEV, pod_name: 'ComfyUI-Dev', direction: 'push', trigger: 'manual', state: 'done', started_at: iso(30), finished_at: iso(29), files: 40, bytes: 3 * MB, failed: 0, warned: 0, summary: 'Pushed 40 files', error: '', ...over })
const watchState = () => ({
  paused: false,
  pull: [{ pod_id: DEV, pod_name: 'ComfyUI-Dev', volume_id: 'vol1', state: 'idle', cursor: 'abcdef0123456789', last_event_at: iso(2), last_reconcile_at: iso(5), next_reconcile_at: iso(-5), pending_events: 3, pending_paths: 2, pending_bytes: 2 * MB }],
  push: [{ pod_id: BATCH, pod_name: 'ComfyUI-Batch', folders: [{ path: 'input', watching: true, pending: 2 }, { path: 'workflows', watching: false, pending: 0 }], pending_files: 2, debounce_ms_left: 6500, last_change_at: iso(1), last_push_at: iso(20), state: 'waiting' }],
  events: Array.from({ length: 35 }, (_, i) => ({ ts: iso(i / 10), writer: i % 2 ? 'comfy' : 'agent', op: 'create', path: `output/r1/file_${String(i).padStart(2, '0')}.png`, source_pod: DEV })),
})
const setSyncs = (api, over) => { api.state.syncs = { active: [], recent: [], logs: {}, watch: { paused: false, pull: [], push: [], events: [] }, ...(api.state.syncs || {}), ...over } }
const callsTo = (api, path) => api.calls.filter((c) => c.path === path)
const openSync = async (page, name = 'ComfyUI-Dev') => { await podCard(page, name).getByTestId('pod-sync').click(); return page.getByTestId('sync-modal') }
const openLogs = async (page) => { const d = await openSync(page); await d.getByTestId('sync-view-logs').click(); const m = page.getByTestId('sync-logs-modal'); await expect(m).toBeVisible(); return m }
const openQueue = async (page) => { await page.getByTestId('open-queue').click(); const q = page.getByTestId('queue-modal'); await expect(q).toBeVisible(); return q }
const LOGS = { 'run-1': [line('info', 'step output started'), line('warn', 'slow link on output/a.png'), line('error', 'rsync: connection reset on output/b.png'), line('info', 'step output done')], 'run-act': [line('info', 'started'), line('info', 'copied output/r1/frame_0010.png')] }

test.describe('Sync logs', () => {
  test('the Sync window has View sync logs, the existing flow and Auto sync section stay', async ({ page, api }) => {
    setSyncs(api, {})
    await page.goto('/')
    const d = await openSync(page)
    await expect(d.getByTestId('sync-view-logs')).toHaveText(t('syncs.viewLogs'))
    await expect(d.getByTestId('sync-autosync-section')).toBeVisible()
    await expect(d.getByTestId('sync-unavailable')).toBeVisible()   // a browser has no sync transport: the window says so as before
  })

  test('empty: a pod without runs says so, with no spinner left', async ({ page, api }) => {
    setSyncs(api, { recent: [done({ run_id: 'run-b', pod_id: BATCH })] })
    await page.goto('/')
    const m = await openLogs(page)
    await expect(m.getByTestId('sync-logs-empty')).toHaveText(t('syncs.noRuns'))
    await expect(m.getByTestId('sync-logs-run')).toHaveCount(0)
    await expect(m.getByTestId('sync-logs-select')).toHaveText(t('syncs.selectRun'))
  })

  test('lists this pod only, the active run first and marked running; the first run opens with its lines coloured', async ({ page, api }) => {
    setSyncs(api, {
      active: [active(), active({ run_id: 'run-other', pod_id: BATCH, pod_name: 'ComfyUI-Batch' })],
      recent: [done(), done({ run_id: 'run-2', trigger: 'auto-sync:output', state: 'failed', error: 'disk full', files: 3 }), done({ run_id: 'run-b', pod_id: BATCH })],
      logs: LOGS,
    })
    await page.goto('/')
    const m = await openLogs(page)
    const rows = m.getByTestId('sync-logs-run')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toHaveAttribute('data-run', 'run-act')
    await expect(rows.nth(0)).toHaveAttribute('data-state', 'running')
    await expect(rows.nth(0).getByTestId('sync-logs-trigger')).toHaveText(t('syncs.trigger_auto'))
    await expect(rows.nth(1).getByTestId('sync-logs-trigger')).toHaveText(t('syncs.trigger_manual'))
    await expect(rows.nth(2)).toContainText('disk full')
    await expect(rows.nth(2)).toContainText(t('syncs.state_failed'))
    await expect(m.locator('[data-run="run-b"], [data-run="run-other"]')).toHaveCount(0)
    expect(callsTo(api, '/syncs/recent')[0].query).toMatchObject({ pod_id: DEV, limit: '30' })
    await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true')
    await rows.nth(1).click()
    const ls = m.getByTestId('sync-logs-line')
    await expect(ls).toHaveCount(4)
    await expect(ls.nth(1)).toHaveAttribute('data-level', 'warn')
    await expect(ls.nth(1)).toHaveClass(/text-warning/)
    await expect(ls.nth(2)).toHaveClass(/text-danger/)
    await expect(ls.nth(0)).not.toHaveClass(/text-(warning|danger)/)
    await expect(m.getByTestId('sync-logs-following')).toHaveCount(0)   // a finished run is not followed
  })

  test('level filter asks the core and shows the matching lines; search narrows the loaded lines', async ({ page, api }) => {
    setSyncs(api, { recent: [done()], logs: LOGS })
    await page.goto('/')
    const m = await openLogs(page)
    const ls = m.getByTestId('sync-logs-line')
    await expect(ls).toHaveCount(4)
    await m.getByTestId('sync-logs-level').getByText(t('syncs.levelWarn')).click()
    await expect(ls).toHaveCount(2)
    expect(callsTo(api, '/syncs/log').some((c) => c.query.level === 'warn')).toBe(true)
    await m.getByTestId('sync-logs-level').getByText(t('syncs.levelError'), { exact: true }).click()
    await expect(ls).toHaveCount(1)
    await expect(ls.first()).toContainText('connection reset')
    await m.getByTestId('sync-logs-level').getByText(t('syncs.levelAll'), { exact: true }).click()
    await expect(ls).toHaveCount(4)
    await m.getByTestId('sync-logs-search').fill('SLOW link')
    await expect(ls).toHaveCount(1)
    await m.getByTestId('sync-logs-search').fill('nothing like this')
    await expect(ls).toHaveCount(0)
    await expect(m.getByTestId('sync-logs-nomatch')).toHaveText(t('syncs.noMatch'))
  })

  test('Load more pages through a long log, 500 lines at a time, and the omitted marker shows as is', async ({ page, api }) => {
    const many = Array.from({ length: 1200 }, (_, i) => line('info', i === 600 ? '... 4,000 lines omitted ...' : `file ${i}`, i))
    setSyncs(api, { recent: [done()], logs: { 'run-1': many } })
    await page.goto('/')
    const m = await openLogs(page)
    const ls = m.getByTestId('sync-logs-line')
    await expect(ls).toHaveCount(500)
    await expect(m.getByTestId('sync-logs-count')).toHaveText(t('syncs.shown', { shown: 500, total: 1200 }))
    await expect(m.getByTestId('sync-logs-more')).toHaveText(t('syncs.loadMore', { n: 700 }))
    await m.getByTestId('sync-logs-more').click()
    await expect(ls).toHaveCount(1000)
    await m.getByTestId('sync-logs-more').click()
    await expect(ls).toHaveCount(1200)
    await expect(m.getByTestId('sync-logs-more')).toHaveCount(0)
    await expect(m.getByText('... 4,000 lines omitted ...')).toHaveCount(1)
    expect(callsTo(api, '/syncs/log').map((c) => c.query.offset)).toEqual(expect.arrayContaining(['0', '500', '1000']))
  })

  test('a running run is followed: new lines appear by themselves, the pane stays at the end, then the finish is shown', async ({ page, api }) => {
    const many = Array.from({ length: 80 }, (_, i) => line('info', `copied file ${i}`, i))
    setSyncs(api, { active: [active()], logs: { 'run-act': many } })
    await page.goto('/')
    const m = await openLogs(page)
    const ls = m.getByTestId('sync-logs-line')
    await expect(ls).toHaveCount(80)
    await expect(m.getByTestId('sync-logs-following')).toBeVisible()
    const atEnd = () => m.getByTestId('sync-logs-pane').evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 30)
    await expect.poll(atEnd).toBe(true)
    api.state.syncs.logs['run-act'].push(line('warn', 'new line while running'))
    await expect(ls).toHaveCount(81, { timeout: 5000 })
    await expect.poll(atEnd).toBe(true)
    await expect(ls.last()).toContainText('new line while running')
    // the person scrolls up: the pane is left where they put it
    await m.getByTestId('sync-logs-pane').evaluate((e) => { e.scrollTop = 0 })
    await expect(m.getByTestId('sync-logs-following')).toHaveCount(0)
    api.state.syncs.logs['run-act'].push(line('info', 'another one'))
    await expect(ls).toHaveCount(82, { timeout: 5000 })
    expect(await atEnd()).toBe(false)
    // it finishes between two polls: moved to the finished runs, its last line read once more
    api.state.syncs.logs['run-act'].push(line('info', 'finished ok'))
    const fin = done({ run_id: 'run-act', direction: 'pull', trigger: 'auto-sync:feed', files: 25 })
    api.state.syncs.active = []; api.state.syncs.recent = [fin]
    await expect(m.getByTestId('sync-logs-run').first()).toHaveAttribute('data-state', 'done', { timeout: 5000 })
    await expect(ls).toHaveCount(83, { timeout: 5000 })
  })

  test('Copy log puts the loaded lines on the clipboard', async ({ page, api }) => {
    await page.addInitScript(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (x) => { window.__copied = x } }, configurable: true }) })
    setSyncs(api, { recent: [done()], logs: LOGS })
    await page.goto('/')
    const m = await openLogs(page)
    await expect(m.getByTestId('sync-logs-line')).toHaveCount(4)
    await m.getByTestId('sync-logs-copy').click()
    await expect(m.getByTestId('sync-logs-copied')).toBeVisible()
    const copied = await page.evaluate(() => window.__copied)
    expect(copied).toContain('WARN slow link on output/a.png')
    expect(copied).toContain('ERROR rsync: connection reset on output/b.png')
    expect(copied.trim().split('\n')).toHaveLength(4)
  })

  test('Save as downloads the log in a browser', async ({ page, api }) => {
    setSyncs(api, { recent: [done()], logs: LOGS })
    await page.goto('/')
    const m = await openLogs(page)
    await expect(m.getByTestId('sync-logs-line')).toHaveCount(4)
    const dl = page.waitForEvent('download')
    await m.getByTestId('sync-logs-save').click()
    expect((await dl).suggestedFilename()).toBe('sync-run-1.log')
  })

  test('a failing call shows the reason and Retry, and Retry reads the log once the core answers', async ({ page, api }) => {
    setSyncs(api, { recent: [done()], logs: LOGS })
    api.state.failures['GET /syncs/log'] = 'core exploded'
    await page.goto('/')
    const m = await openLogs(page)
    await expect(m.getByTestId('sync-logs-error')).toContainText('core exploded')
    await expect(m.getByTestId('sync-logs-loading')).toHaveCount(0)
    delete api.state.failures['GET /syncs/log']
    await m.getByTestId('sync-logs-retry').click()
    await expect(m.getByTestId('sync-logs-line')).toHaveCount(4)
    await expect(m.getByTestId('sync-logs-error')).toHaveCount(0)
  })

  test('a failing run list shows the reason and Retry too', async ({ page, api }) => {
    setSyncs(api, { recent: [done()], logs: LOGS })
    api.state.failures['GET /syncs/recent'] = 'recent broke'
    await page.goto('/')
    const m = await openLogs(page)
    await expect(m.getByTestId('sync-logs-runs-error')).toContainText('recent broke')
    delete api.state.failures['GET /syncs/recent']
    await m.getByTestId('sync-logs-runs-retry').click()
    await expect(m.getByTestId('sync-logs-run')).toHaveCount(1)
  })

  test('an older core: the logs window says to restart the app, nothing breaks', async ({ page, api }) => {
    api.state.syncsOld = true
    const errors = []; page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/')
    const m = await openLogs(page)
    await expect(m.getByTestId('sync-logs-old')).toHaveText(t('syncs.old'))
    expect(errors).toEqual([])
  })
})

test.describe('Sync explorer', () => {
  test('active sync: pod, direction, trigger, state, overall bar with percent, numbers, streams, steps', async ({ page, api }) => {
    setSyncs(api, { active: [active()], watch: watchState() })
    await page.goto('/')
    const q = await openQueue(page)
    const sec = q.getByTestId('queue-syncs')
    await expect(sec).toBeVisible()
    const card = sec.getByTestId('syncs-card')
    await expect(card).toHaveCount(1)
    await expect(card.getByTestId('syncs-card-pod')).toHaveText('ComfyUI-Dev')
    await expect(card.getByTestId('syncs-direction')).toContainText(t('syncs.direction_pull'))
    await expect(card.getByTestId('syncs-trigger')).toHaveText(t('syncs.trigger_auto'))
    await expect(card.getByTestId('syncs-state')).toHaveText(t('syncs.state_running'))
    await expect(card.getByTestId('syncs-bar')).toHaveAttribute('data-percent', '92')
    await expect(card.getByTestId('syncs-percent')).toHaveText('92%')
    const nums = card.getByTestId('syncs-numbers')
    await expect(nums).toContainText('12 of 25 files')
    await expect(nums).toContainText('1.1 GB of 1.2 GB')
    await expect(nums).toContainText('38.0 MB/s')
    await expect(nums).toContainText('ETA 3 s')
    await expect(card.getByTestId('syncs-streams')).toHaveText(t('syncs.streams', { n: 4 }))
    const steps = card.getByTestId('syncs-step')
    await expect(steps).toHaveCount(2)
    await expect(steps.nth(0)).toHaveAttribute('data-key', 'output')
    await expect(steps.nth(0)).toHaveAttribute('data-percent', '67')
    await expect(steps.nth(1)).toHaveAttribute('data-percent', '0')
  })

  test('files in flight each have a percent; recently copied is collapsed and lists the finished files', async ({ page, api }) => {
    setSyncs(api, { active: [active()] })
    await page.goto('/')
    const q = await openQueue(page)
    const files = q.getByTestId('syncs-file')
    await expect(files).toHaveCount(2)
    await expect(files.nth(0)).toHaveAttribute('data-path', 'output/r1/frame_0012.png')
    await expect(files.nth(0)).toHaveAttribute('data-percent', '50')
    await expect(files.nth(0)).toContainText('5.0 MB / 10.0 MB')
    await expect(files.nth(1)).toHaveAttribute('data-percent', '25')
    await expect(q.getByTestId('syncs-recent')).not.toHaveAttribute('open', '')
    await expect(q.getByTestId('syncs-recent-file').first()).toBeHidden()
    await q.getByTestId('syncs-recent').locator('summary').click()
    await expect(q.getByTestId('syncs-recent-file')).toHaveCount(3)
    await expect(q.getByTestId('syncs-recent-file').first()).toBeVisible()
  })

  test('it follows the sync: a changed percent and a finished sync show without reopening', async ({ page, api }) => {
    setSyncs(api, { active: [active()] })
    await page.goto('/')
    const q = await openQueue(page)
    await expect(q.getByTestId('syncs-bar')).toHaveAttribute('data-percent', '92')
    api.state.syncs.active = [active({ bytes_done: 1.2 * GB, files_done: 25 })]
    await expect(q.getByTestId('syncs-bar')).toHaveAttribute('data-percent', '100', { timeout: 5000 })
    api.state.syncs.active = []
    await expect(q.getByTestId('syncs-none')).toHaveText(t('syncs.noneRunning'), { timeout: 5000 })
  })

  test('nothing active: No syncs running, and the Watching panel is there', async ({ page, api }) => {
    setSyncs(api, {})
    await page.goto('/')
    const q = await openQueue(page)
    await expect(q.getByTestId('queue-syncs')).toBeVisible()
    await expect(q.getByTestId('syncs-none')).toHaveText(t('syncs.noneRunning'))
    await expect(q.getByTestId('syncs-watch-none')).toHaveText(t('syncs.watchingNone'))
    await expect(q.getByTestId('syncs-feed-empty')).toBeVisible()
    await expect(q.getByTestId('syncs-finished-empty')).toBeVisible()
  })

  test('Watching: pull rows with state, reconcile times, cursor and pending; push rows with folders, debounce and times', async ({ page, api }) => {
    setSyncs(api, { watch: watchState() })
    await page.goto('/')
    const q = await openQueue(page)
    const pull = q.getByTestId('syncs-pull-row')
    await expect(pull).toHaveCount(1)
    await expect(pull).toHaveAttribute('data-state', 'idle')
    await expect(pull.getByTestId('syncs-watch-state')).toHaveText(t('syncs.watchState_idle'))
    await expect(pull.getByTestId('syncs-reconcile')).toContainText(/last reconcile \d\d:\d\d · next \d\d:\d\d/)
    await expect(pull.getByTestId('syncs-cursor')).toHaveText('cursor abcdef01…')
    await expect(pull.getByTestId('syncs-pending')).toHaveText('3 events, 2 paths, 2.0 MB pending')
    const push = q.getByTestId('syncs-push-row')
    await expect(push).toHaveCount(1)
    await expect(push).toContainText('ComfyUI-Batch')
    await expect(push.getByTestId('syncs-debounce')).toHaveText(t('syncs.debounce', { s: 7 }))
    await expect(push.getByTestId('syncs-push-pending')).toHaveText(t('syncs.pendingFiles', { n: 2 }))
    await expect(push.getByTestId('syncs-last-change')).toContainText(/last change \d\d:\d\d/)
    await expect(push.getByTestId('syncs-last-push')).toContainText(/last push \d\d:\d\d/)
    const folders = push.getByTestId('syncs-folder')
    await expect(folders).toHaveCount(2)
    await expect(folders.nth(0)).toHaveAttribute('data-watching', 'true')
    await expect(folders.nth(0).getByTestId('syncs-folder-pending')).toHaveText(t('syncs.folderPending', { n: 2 }))
    await expect(folders.nth(1)).toHaveAttribute('data-watching', 'false')
    await expect(folders.nth(1).getByTestId('syncs-folder-pending')).toHaveCount(0)
  })

  test('Watching: paused shows Resume, and Resume tells the core', async ({ page, api }) => {
    setSyncs(api, { watch: { ...watchState(), paused: true } })
    await page.goto('/')
    const q = await openQueue(page)
    await expect(q.getByTestId('syncs-paused')).toContainText(t('syncs.paused'))
    await q.getByTestId('syncs-resume').click()
    await expect.poll(() => callsTo(api, '/autosync/pause').map((c) => c.body)).toEqual([{ on: false }])
  })

  test('Feed: the last 30 events as a table with time, writer, op and path', async ({ page, api }) => {
    setSyncs(api, { watch: watchState() })
    await page.goto('/')
    const q = await openQueue(page)
    const rows = q.getByTestId('syncs-event')
    await expect(rows).toHaveCount(30)
    await expect(rows.first()).toContainText('output/r1/file_00.png')
    await expect(rows.first().getByTestId('syncs-event-writer')).toHaveText('agent')
    await expect(rows.nth(1).getByTestId('syncs-event-writer')).toHaveText('comfy')
    await expect(rows.first()).toContainText('create')
    await expect(rows.first()).toContainText(/\d\d:\d\d:\d\d/)
  })

  test('Finished: the last 10 runs, each with a Logs link that opens that run\'s log', async ({ page, api }) => {
    const recent = Array.from({ length: 12 }, (_, i) => done({ run_id: `run-${i}`, state: i === 1 ? 'failed' : 'done', error: i === 1 ? 'boom' : '', trigger: i === 2 ? 'auto-sync:push' : 'manual' }))
    setSyncs(api, { recent, logs: { 'run-1': [line('error', 'the failure of run one')], 'run-0': [line('info', 'the log of run zero')] } })
    await page.goto('/')
    const q = await openQueue(page)
    const rows = q.getByTestId('syncs-finished-row')
    await expect(rows).toHaveCount(10)
    expect(callsTo(api, '/syncs/recent').some((c) => c.query.limit === '10' && !c.query.pod_id)).toBe(true)
    await expect(rows.nth(1)).toContainText('boom')
    await expect(rows.nth(1)).toContainText(t('syncs.state_failed'))
    await rows.nth(1).getByTestId('syncs-finished-logs').click()
    const m = page.getByTestId('sync-logs-modal')
    await expect(m).toBeVisible()
    await expect(m.getByTestId('sync-logs-line')).toHaveCount(1)
    await expect(m.getByTestId('sync-logs-line')).toContainText('the failure of run one')
    await expect(m.getByTestId('sync-logs-run').filter({ hasText: 'boom' })).toHaveAttribute('data-selected', 'true')
  })

  test('the Logs link on an active card opens that run\'s log, followed', async ({ page, api }) => {
    setSyncs(api, { active: [active()], logs: LOGS })
    await page.goto('/')
    const q = await openQueue(page)
    await q.getByTestId('syncs-card-logs').click()
    const m = page.getByTestId('sync-logs-modal')
    await expect(m.getByTestId('sync-logs-line')).toHaveCount(2)
    await expect(m.getByTestId('sync-logs-run').first()).toHaveAttribute('data-run', 'run-act')
    await expect(m.getByTestId('sync-logs-following')).toBeVisible()
  })

  test('the Queue badge counts active syncs; none, no badge', async ({ page, api }) => {
    setSyncs(api, {})
    await page.goto('/')
    await expect(page.getByTestId('pod-card').first()).toBeVisible()
    await expect(page.getByTestId('queue-badge')).toHaveCount(0)
    setSyncs(api, { active: [active(), active({ run_id: 'run-x' })] })
    await page.reload()
    await expect(page.getByTestId('queue-badge')).toHaveText('2')
  })

  test('an older core: the explorer says to restart the app, no errors, no polling storm', async ({ page, api }) => {
    api.state.syncsOld = true
    const errors = []; page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/')
    const q = await openQueue(page)
    await expect(q.getByTestId('syncs-old')).toHaveText(t('syncs.old'))
    await expect(q.getByTestId('syncs-card')).toHaveCount(0)
    await expect(q.getByTestId('queue-error')).toHaveCount(0)
    await expect(page.getByTestId('queue-badge')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('polling: every second while the Queue is open, never while it is closed', async ({ page, api }) => {
    setSyncs(api, { active: [active()] })
    await page.goto('/')
    await expect(page.getByTestId('pod-card').first()).toBeVisible()
    const n = () => callsTo(api, '/syncs/active').length
    const before = n()
    await openQueue(page)
    await expect.poll(n, { timeout: 6000 }).toBeGreaterThanOrEqual(before + 3)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('queue-modal')).toBeHidden()
    await page.waitForTimeout(500)
    const closedAt = callsTo(api, '/syncs/watch').length
    await page.waitForTimeout(2500)
    expect(callsTo(api, '/syncs/watch').length).toBe(closedAt)
  })
})

test.describe('History: auto sync entries', () => {
  test('auto runs get an auto badge and their detail; old entries render as before', async ({ page, api }) => {
    api.state.history.events.push({ ts: '2026-11-03T15:00:00Z', kind: 'job', job: 'sync', state: 'done', what: 'output', pod_name: 'ComfyUI-Dev', trigger: 'auto-sync:feed', detail: 'Pulled 3 files from the feed', files: 3, bytes: 1024 })
    api.state.history.events.push({ ts: '2026-11-03T15:30:00Z', kind: 'job', job: 'sync', state: 'done', what: 'ComfyUI-Shared', pod_name: 'ComfyUI-Dev', trigger: 'manual', files: 1, bytes: 10 })
    await page.goto('/')
    await page.getByTestId('open-history').click()
    const d = page.getByTestId('history-modal')
    await d.getByRole('tab', { name: t('history.tabJobs') }).click()
    const rows = d.getByTestId('history-job-row')
    await expect(rows).toHaveCount(4)
    const auto = rows.filter({ hasText: 'Pulled 3 files from the feed' })
    await expect(auto.getByTestId('history-auto')).toHaveText(t('history.autoBadge'))
    await expect(auto.getByTestId('history-job-detail')).toHaveText('Pulled 3 files from the feed')
    await expect(d.getByTestId('history-auto')).toHaveCount(1)   // the manual one, the old ones: none
    await expect(rows.filter({ hasText: 'round-3' }).getByTestId('history-auto')).toHaveCount(0)
    await expect(rows.filter({ hasText: 'round-3' }).getByTestId('history-job-detail')).toHaveCount(0)
  })
})
