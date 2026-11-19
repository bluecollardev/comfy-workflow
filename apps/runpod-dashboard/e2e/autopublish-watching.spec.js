import { test, expect, modal, cfgTab, queueTab } from './fixtures'
import { t } from './i18n'

// "I have Auto-publish on but I don't see anything in the Queue": the Queue section and the settings block say what Auto-publish is watching (the core's `watching`).
const W = (o = {}) => ({ root: '/Users/lucas/comfy/output/deliver', root_exists: true, shots: 4, reviews: 6, approved: 2, eligible: 2, queued: 0, uploaded_today: 0, skipped: [], summary: 'Watching output/deliver: 6 reviews, none approved yet', ...o })
const on = (api, o = {}) => { api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: true, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' }, ...o } }
const openQ = async (page) => { await queueTab(page, 'publishing'); const q = page.getByTestId('queue-modal'); await expect(q.getByTestId('queue-autopublish')).toBeVisible(); return q }

test.describe('Queue > Auto-publish with nothing in it', () => {
  test('off: "Auto-publish is off" with a link to the settings; no badge', async ({ page, api }) => {
    api.state.autopublish = { watching: W() }
    await page.goto('/'); await expect(page.getByTestId('queue-badge')).toHaveCount(0)
    const q = await openQ(page)
    await expect(q.getByTestId('queue-autopublish-watching')).toBeVisible(); await expect(q.getByTestId('autopublish-watching-mode')).toContainText('Auto-publish is off')
    await expect(q.getByTestId('autopublish-watching-counts')).toHaveText('6 reviews · 2 approved · 0 waiting · 0 uploaded today'); await expect(q.getByTestId('autopublish-watching-root')).toHaveText('/Users/lucas/comfy/output/deliver')
    await q.getByTestId('autopublish-watching-settings').click(); await expect(modal(page, t('config.title'))).toBeVisible()
  })
  test('on, in a dry run, with no deliver folder: the core\'s summary, the root said to be missing, "Dry run: nothing is sent"', async ({ page, api }) => {
    on(api); api.state.autopublish = { watching: W({ root_exists: false, shots: 0, reviews: 0, approved: 0, eligible: 0, summary: 'No deliver folder yet at output/deliver' }) }
    await page.goto('/'); const q = await openQ(page)
    await expect(q.getByTestId('autopublish-watching-chip')).toHaveText('Dry run: nothing is sent'); await expect(q.getByTestId('autopublish-watching-summary')).toHaveText('No deliver folder yet at output/deliver')
    await expect(q.getByTestId('autopublish-watching-root-line')).toContainText('folder not found'); await expect(q.getByTestId('autopublish-none')).toHaveCount(0)
    await expect(page.getByTestId('queue-badge')).toHaveCount(0)
  })
  test('on and LIVE with reviews not approved: the LIVE chip names the targets and the window', async ({ page, api }) => {
    on(api, { dry_run: false, window_minutes: 15 }); api.state.autopublish = { watching: W({ approved: 0, eligible: 0, summary: '6 reviews, none approved yet' }) }
    await page.goto('/'); const q = await openQ(page)
    await expect(q.getByTestId('autopublish-watching-chip')).toHaveText('LIVE: approved reviews are uploaded (S3 + Slack) after 15 minutes'); await expect(q.getByTestId('autopublish-watching-chip')).toHaveClass(/text-bg-success/)
    await expect(q.getByTestId('autopublish-watching-summary')).toHaveText('6 reviews, none approved yet'); await expect(q.getByTestId('autopublish-watching-counts')).toContainText('0 approved')
  })
  test('everything uploaded: the summary and the uploaded-today count', async ({ page, api }) => {
    on(api, { dry_run: false }); api.state.autopublish = { watching: W({ approved: 6, eligible: 0, queued: 0, uploaded_today: 6, summary: 'All 6 approved reviews are uploaded' }) }
    await page.goto('/'); const q = await openQ(page)
    await expect(q.getByTestId('autopublish-watching-summary')).toHaveText('All 6 approved reviews are uploaded'); await expect(q.getByTestId('autopublish-watching-counts')).toHaveText('6 reviews · 6 approved · 0 waiting · 6 uploaded today')
  })
  test('with entries waiting the rows show and the empty-state block does not; the nav button counts it', async ({ page, api }) => {
    on(api); api.state.autopublish = { watching: W({ queued: 1 }), pending: [{ id: 'ap-1', shot: 'archival-085', version: 2, files: 3, bytes: 2e9, due_at: new Date(Date.now() + 600000).toISOString(), state: 'waiting', approved_by: 'Kyle', targets: ['s3'] }] }
    await page.goto('/'); await expect(page.getByTestId('queue-badge')).toHaveText('1')
    const q = await openQ(page)
    await expect(q.getByTestId('autopublish-row')).toHaveCount(1); await expect(q.getByTestId('queue-autopublish-watching')).toHaveCount(0)
  })
  test('an older core without `watching`: the old empty line, unchanged', async ({ page, api }) => {
    on(api); api.state.autopublish = {}
    await page.goto('/'); const q = await openQ(page)
    await expect(q.getByTestId('autopublish-none')).toHaveText('Nothing waiting and nothing sent yet.'); await expect(q.getByTestId('queue-autopublish-watching')).toHaveCount(0)
  })
})

test.describe('the settings block', () => {
  test('is the first block of the Publishing tab, compact (the counts, not the long summary sentence), with a collapsed Skipped (N) list of shot version: reason', async ({ page, api }) => {
    on(api); api.state.autopublish = { watching: W({ skipped: [{ shot: 'archival-085', version: 3, reason: 'a file is still being written' }, { shot: 'cgi-042', version: 1, reason: 'no approved name' }] }) }
    await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'publishing')
    const b = d.getByTestId('autopublish-watching-block')
    await expect(b.getByTestId('collapsible-title').first()).toHaveText('What Auto-publish Is Watching')   // a foldable section, at the TOP of the tab
    expect(await d.getByTestId('settings-publishing').locator('xpath=preceding::*[@data-testid="autopublish-watching-block"]').count()).toBe(1)
    await expect(b.getByTestId('autopublish-watching-summary')).toHaveCount(0); await expect(b.getByTestId('autopublish-watching-counts')).toContainText('6 reviews')
    await expect(b.getByTestId('autopublish-skipped')).not.toHaveAttribute('open', ''); await expect(b.getByTestId('autopublish-skipped').locator('summary')).toHaveText('Skipped (2)')
    await b.getByTestId('autopublish-skipped').locator('summary').click()
    await expect(b.getByTestId('autopublish-skipped-row')).toHaveText(['archival-085 v003: a file is still being written', 'cgi-042 v001: no approved name'])
  })
  test('no skipped: no list; an older core: no block', async ({ page, api }) => {
    on(api); api.state.autopublish = { watching: W() }
    await page.goto('/'); await page.getByTestId('open-config').click(); let d = modal(page, t('config.title')); await cfgTab(d, 'publishing')
    await expect(d.getByTestId('autopublish-watching-block')).toBeVisible(); await expect(d.getByTestId('autopublish-skipped')).toHaveCount(0)
    api.state.autopublish = {}; await page.reload(); await page.getByTestId('open-config').click(); d = modal(page, t('config.title')); await cfgTab(d, 'publishing')
    await expect(d.getByTestId('settings-autopublish')).toBeVisible(); await expect(d.getByTestId('autopublish-watching-block')).toHaveCount(0)
  })
})

// Auto-publish sources (docs/ADR-050): this PC and/or the volume, a setting of the Default Configuration; the status says what each place holds.
const PLACES = (o = {}) => ({ root: '/Users/lucas/comfy/output/deliver', approved: 0, eligible: 0, queued: 0, uploaded_today: 0, skipped: [], summary: 'Watching this PC (0 reviews) and the volume (12 reviews): none approved yet',
  local: { enabled: true, root: '/Users/lucas/comfy/output/deliver', root_exists: true, reviews: 0 }, volume: { enabled: true, id: 'vol123', reviews: 12, scanned_at: new Date(Date.now() - 120000).toISOString(), scanning: false }, ...o })
const withSources = (api, o = {}) => on(api, { sources: { local: true, volume: true }, volume_scan_minutes: 5, ...o })
const openPub = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'publishing'); return d }

test.describe('Auto-publish sources: the configuration', () => {
  test('Watch these places: both ticked and 5 minutes by default with the help; unticking the last one is blocked inline; minutes are 1 to 120', async ({ page, api }) => {
    withSources(api)
    const d = await openPub(page)
    const b = d.getByTestId('autopublish-sources')
    await expect(b.getByTestId('config-autopublish-source-local')).toBeChecked(); await expect(b.getByTestId('config-autopublish-source-volume')).toBeChecked(); await expect(b.getByTestId('config-autopublish-volume-minutes')).toHaveValue('5')
    await expect(b.getByTestId('config-autopublish-sources-help')).toHaveText('Auto-publish looks at deliver/ on this PC and on the volume. A review still needs its approval before anything is sent.')
    await b.getByTestId('config-autopublish-source-local').uncheck(); await expect(b.getByTestId('config-autopublish-volume-minutes')).toBeEnabled()
    await b.getByTestId('config-autopublish-source-volume').click()   // the last one: refused
    await expect(b.getByTestId('config-autopublish-source-volume')).toBeChecked(); await expect(b.getByTestId('config-autopublish-sources-error')).toHaveText('Choose at least one place to watch')
    await b.getByTestId('config-autopublish-source-local').uncheck(); await b.getByTestId('config-autopublish-source-local').check()
    await b.getByTestId('config-autopublish-source-volume').uncheck(); await expect(b.getByTestId('config-autopublish-volume-minutes')).toBeDisabled()
    await b.getByTestId('config-autopublish-source-volume').check()
    for (const bad of ['0', '121', '']) { await b.getByTestId('config-autopublish-volume-minutes').fill(bad); await d.getByTestId('config-save').click(); await expect(d.getByTestId('autopublish-error')).toHaveText('The volume is checked every 1 to 120 minutes.') }
    expect(api.state.mountPuts || []).toHaveLength(0)
  })
  test('Save carries sources and the minutes; an untouched configuration sends no auto_publish key', async ({ page, api }) => {
    api.state.mounts.config.auto_publish = undefined
    let d = await openPub(page)
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(api.state.mountPuts[0]).not.toHaveProperty('auto_publish')
    withSources(api)
    d = await openPub(page)
    await d.getByTestId('config-autopublish-source-local').uncheck(); await d.getByTestId('config-autopublish-volume-minutes').fill('15'); await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(api.state.mounts.config.auto_publish).toMatchObject({ sources: { local: false, volume: true }, volume_scan_minutes: 15 })
  })
  test('an older core (no sources): no Watch these places', async ({ page, api }) => {
    on(api)
    const d = await openPub(page)
    await expect(d.getByTestId('autopublish-window')).toBeVisible(); await expect(d.getByTestId('autopublish-sources')).toHaveCount(0)
  })
  test('a pod\'s own configuration never has them', async ({ page, api }) => {
    withSources(api)
    await page.goto('/'); await page.locator('[data-testid="pod-card"]').filter({ hasText: 'ComfyUI-Dev' }).getByTestId('pod-config').click()
    const d = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' })); await expect(d).toBeVisible()
    await expect(d.getByTestId('autopublish-sources')).toHaveCount(0); await expect(d.getByTestId('config-autopublish-source-volume')).toHaveCount(0); await expect(d.getByTestId('config-autopublish-volume-minutes')).toHaveCount(0)
  })
})

test.describe('Auto-publish sources: what is watched', () => {
  test('two lines (This PC, The volume with when it was scanned) in the Queue and in the settings block; the summary; a source turned off says so', async ({ page, api }) => {
    withSources(api); api.state.autopublish = { watching: PLACES() }
    await page.goto('/'); const q = await openQ(page)
    await expect(q.getByTestId('autopublish-watching-local')).toContainText('This PC: /Users/lucas/comfy/output/deliver: 0 reviews'); await expect(q.getByTestId('autopublish-watching-volume')).toContainText('RunPod volume vol123: comfy-shared/output/deliver: 12 reviews · scanned 2 minutes ago')
    await expect(q.getByTestId('autopublish-watching-summary')).toContainText('none approved yet'); await expect(q.getByTestId('autopublish-watching-counts')).toContainText('12 reviews')
    api.state.autopublish.watching.volume = { enabled: false, reviews: 0 }
    await expect(q.getByTestId('autopublish-watching-volume')).toContainText('RunPod volume : not watched', { timeout: 6000 }); await expect(q.getByTestId('autopublish-scan-now')).toBeDisabled()
    await page.keyboard.press('Escape')
  })
  test('Scan now calls scanVolume, shows the spinner while it runs, then the new counts', async ({ page, api }) => {
    withSources(api); api.state.autopublish = { watching: PLACES(), scanTo: { reviews: 20 }, scanMs: 1800 }
    await page.goto('/'); const q = await openQ(page)
    await q.getByTestId('autopublish-scan-now').click()
    await expect(q.getByTestId('autopublish-scanning')).toBeVisible(); await expect(q.getByTestId('autopublish-scan-now')).toBeDisabled()
    await expect.poll(() => api.state.autopublish.calls.filter((c) => c.call === 'scanVolume').length).toBe(1)
    await expect(q.getByTestId('autopublish-watching-volume')).toContainText('comfy-shared/output/deliver: 20 reviews', { timeout: 8000 }); await expect(q.getByTestId('autopublish-scanning')).toHaveCount(0); await expect(q.getByTestId('autopublish-watching-volume')).toContainText('scanned just now')
  })
  test('a volume error is shown inline without hiding the local line; a failed Scan now says why', async ({ page, api }) => {
    withSources(api); api.state.autopublish = { watching: PLACES({ volume: { enabled: true, id: 'vol123', reviews: 0, scanning: false, error: 'S3 keys are not set' } }), scanFail: 'The volume scan could not start' }
    await page.goto('/'); const q = await openQ(page)
    await expect(q.getByTestId('autopublish-volume-error')).toHaveText('S3 keys are not set'); await expect(q.getByTestId('autopublish-watching-local')).toContainText('This PC: /Users/lucas/comfy/output/deliver: 0 reviews')
  })
  test('entries carry a This PC or Volume badge', async ({ page, api }) => {
    withSources(api); const due = new Date(Date.now() + 600000).toISOString()
    api.state.autopublish = { watching: PLACES({ queued: 2 }), pending: [{ id: 'a', shot: 'archival-085', version: 2, files: 3, bytes: 2e9, due_at: due, state: 'waiting', approved_by: 'K', targets: ['s3'], source: 'local' }, { id: 'b', shot: 'cgi-042', version: 1, files: 1, bytes: 1e9, due_at: due, state: 'waiting', approved_by: 'K', targets: ['s3'], source: 'volume' }] }
    await page.goto('/'); const q = await openQ(page)
    await expect(q.locator('[data-testid="autopublish-row"][data-id="a"] [data-testid="autopublish-source-badge"]')).toHaveText('This PC'); await expect(q.locator('[data-testid="autopublish-row"][data-id="b"] [data-testid="autopublish-source-badge"]')).toHaveText('RunPod volume')
  })
  test('an older core\'s watching (one root, no places) is shown as before, with no Scan now', async ({ page, api }) => {
    on(api); api.state.autopublish = { watching: W() }
    await page.goto('/'); const q = await openQ(page)
    await expect(q.getByTestId('autopublish-watching-root')).toBeVisible(); await expect(q.getByTestId('autopublish-scan-now')).toHaveCount(0); await expect(q.getByTestId('autopublish-watching-volume')).toHaveCount(0)
  })
})

// Auto-publish can generate the outputs too (docs/ADR-050): a group in the Default Configuration, its state on the Queue, the badge on Generations.
const GEN = (o = {}) => ({ enabled: false, where: 'local', preset: 'review', max_per_day: 20, settle_minutes: 5, fallback_local: false, ...o })
const withGen = (api, g = {}, ap = {}) => on(api, { generate: GEN(g), ...ap })

test.describe('Auto-publish generates the outputs: the configuration', () => {
  test('off by default with its help; ticking shows Where, Preset, Most per day and the settle minutes with their defaults; Save carries them', async ({ page, api }) => {
    withGen(api)
    const d = await openPub(page); const g = d.getByTestId('autopublish-generate')
    await expect(g.getByTestId('config-autopublish-generate')).not.toBeChecked(); await expect(g.getByTestId('config-autopublish-generate-where')).toHaveCount(0)
    await expect(g.getByTestId('config-autopublish-generate-help')).toHaveText('Only new sequences that finish after you turn this on are rendered. A review still needs approval before it is published.')
    await g.getByTestId('config-autopublish-generate').check()
    await expect(g.getByTestId('config-autopublish-generate-where')).toHaveValue('local'); await expect(g.getByTestId('config-autopublish-generate-preset')).toHaveValue('review'); await expect(g.getByTestId('config-autopublish-generate-max')).toHaveValue('20'); await expect(g.getByTestId('config-autopublish-generate-settle')).toHaveValue('5')
    await expect(g.getByTestId('autopublish-generate-pod')).toHaveCount(0)
    await g.getByTestId('config-autopublish-generate-preset').selectOption('tunnel'); await g.getByTestId('config-autopublish-generate-max').fill(''); await g.getByTestId('config-autopublish-generate-settle').fill('12')
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    const ap = api.state.mountPuts.at(-1).auto_publish
    expect(ap.generate).toEqual({ enabled: true, where: 'local', preset: 'tunnel', max_per_day: null, settle_minutes: 12, fallback_local: false }); expect(ap).not.toHaveProperty('approved_by')
  })
  test('on a running pod: the spend warning and the approver\'s name are required before Save (inline); with the name it saves; reloaded, it is there', async ({ page, api }) => {
    withGen(api)
    let d = await openPub(page)
    await d.getByTestId('config-autopublish-generate').check(); await d.getByTestId('config-autopublish-generate-where').selectOption('pod')
    await expect(d.getByTestId('autopublish-generate-pod-warning')).toHaveText('Spends money on a pod that is already running. Nothing is started for you.')
    const who = d.getByTestId('config-autopublish-generate-approver'); await expect(who).toHaveValue('B')   // the standing approver, offered
    await who.fill(''); await d.getByTestId('config-save').click()
    await expect(d.getByTestId('autopublish-error')).toHaveText("Rendering on a pod spends money: put the approver's name"); expect(api.state.mountPuts || []).toHaveLength(0)
    await who.fill('Kyle'); await d.getByTestId('config-autopublish-generate-fallback').check(); await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(api.state.mountPuts.at(-1).auto_publish).toMatchObject({ approved_by: 'Kyle', generate: { enabled: true, where: 'pod', fallback_local: true } })
    d = await openPub(page); await expect(d.getByTestId('config-autopublish-generate')).toBeChecked(); await expect(d.getByTestId('config-autopublish-generate-where')).toHaveValue('pod')
  })
  test('the settle minutes (1 to 120) and Most per day are checked inline', async ({ page, api }) => {
    withGen(api, { enabled: true })
    const d = await openPub(page)
    for (const bad of ['0', '121']) { await d.getByTestId('config-autopublish-generate-settle').fill(bad); await d.getByTestId('config-save').click(); await expect(d.getByTestId('autopublish-error')).toHaveText('Frames settle after 1 to 120 minutes.') }
    await d.getByTestId('config-autopublish-generate-settle').fill('5'); await d.getByTestId('config-autopublish-generate-max').fill('0'); await d.getByTestId('config-save').click()
    await expect(d.getByTestId('autopublish-error')).toContainText('Most per day'); expect(api.state.mountPuts || []).toHaveLength(0)
  })
  test('an older core (no generate): no group; a pod\'s own configuration never has it', async ({ page, api }) => {
    on(api)
    const d = await openPub(page)
    await expect(d.getByTestId('autopublish-window')).toBeVisible(); await expect(d.getByTestId('autopublish-generate')).toHaveCount(0)
    withGen(api)
    await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {})
    await page.goto('/'); await page.locator('[data-testid="pod-card"]').filter({ hasText: 'ComfyUI-Dev' }).getByTestId('pod-config').click()
    const p = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' })); await expect(p).toBeVisible(); await expect(p.getByTestId('config-autopublish-generate')).toHaveCount(0)
  })
})

test.describe('Auto-publish generates the outputs: what it is doing', () => {
  const GENSTATE = (o = {}) => ({ enabled: true, where: 'local', preset: 'review', enabled_at: '2026-11-19T09:00:00Z', generating: 1, generated_today: 3, max_per_day: 20, waiting_to_settle: [{ stem: 'ARCHIVAL-077_A_V11', shot: 'archival-077', since: new Date(Date.now() - 180000).toISOString() }, { stem: 'CGI-042_B', shot: 'cgi-042', since: new Date(Date.now() - 60000).toISOString() }], failed: [{ stem: 'MAP-066_A', reason: 'ffmpeg exited 1' }], ...o })
  test('the Queue and the settings block show the chip, the line with its counts, the waiting list and the failures (collapsed)', async ({ page, api }) => {
    withGen(api, { enabled: true }); api.state.autopublish = { watching: W(), generate: GENSTATE() }
    await page.goto('/'); const q = await openQ(page)
    const b = q.getByTestId('queue-autopublish-generate')
    await expect(b.getByTestId('autopublish-generate-chip')).toHaveText('Auto-generate: ON (This PC)'); await expect(b.getByTestId('autopublish-generate-line')).toHaveText('Generating automatically: 1 running · 2 waiting for frames to settle · 3 today of 20')
    await expect(b.getByTestId('autopublish-generate-waiting-row')).toHaveCount(2); await expect(b.getByTestId('autopublish-generate-waiting-row').first()).toContainText('ARCHIVAL-077_A_V11'); await expect(b.getByTestId('autopublish-generate-waiting-since').first()).toHaveText('seen since 3 minutes ago')
    await expect(b.getByTestId('autopublish-generate-failed')).not.toHaveAttribute('open', ''); await expect(b.getByTestId('autopublish-generate-failed').locator('summary')).toHaveText('Failed (1)')
    await b.getByTestId('autopublish-generate-failed').locator('summary').click(); await expect(b.getByTestId('autopublish-generate-failed-row')).toHaveText('failedMAP-066_A: ffmpeg exited 1')
    await page.keyboard.press('Escape')
    await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'publishing')
    await expect(d.getByTestId('autopublish-generate-block').getByTestId('autopublish-generate-line')).toContainText('1 running')
  })
  test('on a pod, with no cap: the chip says the pod and the line has no "of"', async ({ page, api }) => {
    withGen(api, { enabled: true, where: 'pod' }); api.state.autopublish = { generate: GENSTATE({ where: 'pod', max_per_day: null, generating: 0, waiting_to_settle: [], failed: [] }) }
    await page.goto('/'); const q = await openQ(page)
    await expect(q.getByTestId('autopublish-generate-chip')).toHaveText('Auto-generate: ON (A running pod)'); await expect(q.getByTestId('autopublish-generate-line')).toHaveText('Generating automatically: 0 running · 0 waiting for frames to settle · 3 today')
    await expect(q.getByTestId('autopublish-generate-waiting')).toHaveCount(0); await expect(q.getByTestId('autopublish-generate-failed')).toHaveCount(0)
  })
  test('off or an older core: no generate state; a Generations job started by Auto-publish carries a badge', async ({ page, api }) => {
    on(api); api.state.autopublish = { generate: GENSTATE({ enabled: false }) }
    api.state.renders = { jobs: [{ job_id: 'job-a', pod_id: '', pod_name: '', kind: 'review', trigger: 'auto-publish', state: 'rendering', started_at: '2026-11-19T10:00:00Z', finished_at: null, frames_done: 2, frames_total: 10, rate_fps: 1, current: '', pulled_files: 0, pulled_bytes: 0, error: '', summary: '', sequences: [] }, { job_id: 'job-m', pod_id: '', kind: 'proxy', state: 'rendering', started_at: '2026-11-19T10:01:00Z', finished_at: null, frames_done: 0, frames_total: 5, rate_fps: 0, current: '', pulled_files: 0, pulled_bytes: 0, error: '', summary: '', sequences: [] }] }
    await page.goto('/'); let q = await openQ(page)
    await expect(q.getByTestId('queue-autopublish-generate')).toHaveCount(0)
    await page.getByTestId('queue-tab-generations').click(); q = page.getByTestId('queue-modal')
    await expect(q.locator('[data-testid="generations-job"][data-job="job-a"]').getByTestId('generations-job-auto')).toHaveText('Auto-publish'); await expect(q.locator('[data-testid="generations-job"][data-job="job-m"]').getByTestId('generations-job-auto')).toHaveCount(0)
  })
})
