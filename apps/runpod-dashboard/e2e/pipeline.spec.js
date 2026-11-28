import { test, expect, openAutopublish, modal, cfgTab, queueTab } from './fixtures'
import { t } from './i18n'

// Auto-publish as a pipeline (docs/ADR-050, 1.7.0): generate, publish to the BH S3 bucket, post to Slack; no approval per version unless required; holds; generate for what is already there; start a pod; a review optional.
const GEN = (o = {}) => ({ enabled: true, where: 'local', preset: 'review', max_per_day: 20, settle_minutes: 5, fallback_local: false, ...o })
const on = (api, o = {}) => { api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'Brynley', at: '2026-11-19T10:00:00Z' }, ...o } }
const openPub = async (page) => { const d = await openAutopublish(page); return d }
const openQ = async (page) => { await queueTab(page, 'publishing'); const q = page.getByTestId('queue-modal'); await expect(q.getByTestId('queue-autopublish')).toBeVisible(); return q }
const due = () => new Date(Date.now() + 580000).toISOString()
const entry = (o = {}) => ({ id: 'ap-1', shot: 'archival-085', version: 2, files: 3, bytes: 2e9, due_at: due(), state: 'waiting', approved_by: 'Brynley', targets: ['s3'], ...o })

test.describe('the pipeline block', () => {
  test('three step cards in order with arrows between, the destination read-only, the standing approval line and the one master switch', async ({ page, api }) => {
    on(api, { generate: GEN(), round: 'tunnel-v11_{date}_r01', require_approval: false })
    const d = await openPub(page)
    const cards = ['autopublish-step-generate', 'autopublish-step-publish', 'autopublish-step-slack']
    const ys = []; for (const c of cards) { await expect(d.getByTestId(c)).toBeVisible(); ys.push((await d.getByTestId(c).boundingBox()).y) }
    expect(ys[0]).toBeLessThan(ys[1]); expect(ys[1]).toBeLessThan(ys[2]); await expect(d.getByTestId('autopublish-arrow')).toHaveCount(2)
    await expect(d.getByTestId('autopublish-step-generate')).toContainText('1 Generate The Reviews'); await expect(d.getByTestId('autopublish-step-publish')).toContainText('2 Publish To The BH S3 Bucket'); await expect(d.getByTestId('autopublish-step-slack')).toContainText('3 Post To Slack')
    await expect(d.getByTestId('autopublish-destination-readonly')).toContainText('s3://bh-panama-exchange-610140802195/returns/BKK/tunnel-v11_{date}_r01/'); await expect(d.getByTestId('autopublish-destination-readonly')).not.toHaveAttribute('contenteditable')
    await expect(d.getByTestId('autopublish-standing')).toHaveText('Running under the standing approval of Brynley, 19 Nov 2026'); await expect(d.getByTestId('autopublish-switch')).toHaveCount(1)
    await expect(d.getByTestId('autopublish-step-publish').getByTestId('autopublish-target-s3')).toBeVisible(); await expect(d.getByTestId('autopublish-step-slack').getByTestId('autopublish-target-slack')).toBeVisible()
  })
  test('Two options: Approved review videos / All review videos (the default, require_approval false), each with its help; saved when changed; the status line names the option; the master switch\'s confirm says which; an older core has no radio', async ({ page, api }) => {
    on(api, { require_approval: false })
    let d = await openPub(page)
    await expect(d.getByTestId('config-autopublish-publish-all')).toBeChecked(); await expect(d.getByTestId('config-autopublish-publish-approved')).not.toBeChecked()
    await expect(d.getByTestId('config-autopublish-publish-all-help')).toHaveText('Every finished review is published automatically under the standing approval; Hold keeps one back.'); await expect(d.getByTestId('config-autopublish-publish-approved-help')).toHaveText('Only reviews someone approved are published; the Approve buttons show.')
    await expect(page.getByTestId('volumes-save')).toBeDisabled()   // untouched: nothing to save
    d = await openPub(page); await d.getByTestId('config-autopublish-publish-approved').check(); await page.getByTestId('volumes-save').click(); await expect(page.getByTestId('volumes-saved')).toBeVisible()
    expect(api.state.mounts.config.auto_publish.require_approval).toBe(true)
    on(api, { enabled: false, require_approval: true, standing: null }); d = await openPub(page); await d.getByTestId('autopublish-switch').click()
    await expect(page.getByTestId('name-prompt-message')).toContainText('Publishing: approved review videos only')
    await page.getByTestId('name-prompt-cancel').click()
    on(api); d = await openPub(page); await expect(d.getByTestId('autopublish-window')).toBeVisible(); await expect(d.getByTestId('config-autopublish-publish-all')).toHaveCount(0)
  })
})

test.describe('Queue: hold and release', () => {
  test('eligible reviews show the window countdown with Cancel and Hold; Hold sends the shot and version; Held lists it with Release', async ({ page, api }) => {
    on(api, { require_approval: false }); api.state.autopublish = { requireApproval: false, pending: [entry(), entry({ id: 'ap-2', shot: 'cgi-042', version: 1 })], watching: { root: '/x', root_exists: true, reviews: 2, approved: 0, eligible: 2, held: 0, queued: 2, uploaded_today: 0, skipped: [], summary: '2 reviews are eligible' } }
    await page.goto('/'); const q = await openQ(page)
    await expect(q.locator('[data-testid="autopublish-row"][data-id="ap-1"] [data-testid="autopublish-row-state"]')).toContainText('waiting for the window · uploads in 9:')
    await expect(q.locator('[data-testid="autopublish-row"][data-id="ap-1"]').getByTestId('autopublish-cancel')).toBeVisible()
    await q.locator('[data-testid="autopublish-row"][data-id="ap-1"]').getByTestId('autopublish-hold').click()
    await expect.poll(() => api.state.autopublish.calls.filter((c) => c.call === 'hold').map((c) => c.body)).toEqual([{ shot: 'archival-085', version: 2 }])
    await expect(q.locator('[data-testid="autopublish-row"][data-id="ap-1"]')).toHaveCount(0, { timeout: 6000 })
    await expect(q.getByTestId('autopublish-held').locator('summary')).toHaveText('Held (1)', { timeout: 6000 })
    await q.getByTestId('autopublish-held').locator('summary').click(); await expect(q.getByTestId('autopublish-held-row')).toHaveText(/archival-085 v002/)
    await q.getByTestId('autopublish-release').click(); await expect.poll(() => api.state.autopublish.calls.filter((c) => c.call === 'release').map((c) => c.body)).toEqual([{ shot: 'archival-085', version: 2 }])
    await expect(q.getByTestId('autopublish-held')).toHaveCount(0, { timeout: 6000 })
  })
  test('the counts say eligible and held when approval is not required; an older core keeps approved and shows no Hold', async ({ page, api }) => {
    on(api, { require_approval: false }); const w = { root: '/x', root_exists: true, reviews: 6, approved: 0, eligible: 4, held: 1, queued: 0, uploaded_today: 2, skipped: [], summary: 'Watching 6 reviews: 4 eligible' }
    api.state.autopublish = { requireApproval: false, watching: w }
    await page.goto('/'); let q = await openQ(page)
    await expect(q.getByTestId('autopublish-publishing-line')).toHaveText('Publishing: all review videos'); await expect(q.getByTestId('autopublish-watching-counts')).toHaveText('6 reviews · 4 eligible · 0 waiting · 1 held · 2 uploaded today'); await expect(q.getByTestId('autopublish-watching-summary')).toHaveText('Watching 6 reviews: 4 eligible')
    api.state.autopublish = { watching: w, pending: [entry()] }; await page.reload(); q = await openQ(page)
    await expect(q.getByTestId('autopublish-watching-counts')).toHaveCount(0); await expect(q.getByTestId('autopublish-hold')).toHaveCount(0)
  })
  test('Approve controls show only when approval is required', async ({ page, api }) => {
    const job = { job_id: 'job-r', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', kind: 'review', state: 'done', started_at: '2026-11-19T10:00:00Z', finished_at: 'now', frames_done: 5, frames_total: 5, rate_fps: 0, current: '', pulled_files: 1, pulled_bytes: 1, error: '', summary: 'done', sequences: [{ dir: 'seqs/a', name: 'ARCH', shot: 'cgi-042', version: 1, where: 'pod', state: 'pulled', frames_done: 5, frames_total: 5 }] }
    on(api, { require_approval: false }); api.state.renders = { jobs: [job] }; api.state.autopublish = { requireApproval: false, reviews: [{ shot: 'cgi-042', version: 1, files: [], bytes: 1, complete: true, approved: null, state: 'not approved' }] }
    await page.goto('/'); await queueTab(page, 'generations'); await expect(page.locator('[data-testid="generations-job"][data-job="job-r"]')).toBeVisible()
    await expect(page.getByTestId('autopublish-control')).toHaveCount(0)
    api.state.autopublish.requireApproval = true; await expect(page.getByTestId('autopublish-control')).toHaveCount(1, { timeout: 12000 })
  })
})

test.describe('Auto-generate settings', () => {
  test('Start a pod: ticked off by default with Stop when done and the spend limit; ticking asks the name before Save; the Queue says which pod and what it cost', async ({ page, api }) => {
    on(api, { generate: GEN({ start_pod: false, stop_when_done: true, max_spend_usd_per_day: 25 }) })
    let d = await openPub(page)
    const sp = d.getByTestId('config-autopublish-generate-start-pod'); await expect(sp).not.toBeChecked(); await expect(d.getByTestId('config-autopublish-generate-max-spend')).toHaveCount(0)
    await sp.check(); await expect(d.getByTestId('config-autopublish-generate-stop-when-done')).toBeChecked(); await expect(d.getByTestId('config-autopublish-generate-max-spend')).toHaveValue('25'); await expect(d.getByTestId('autopublish-generate-startpod-warning')).toHaveText('Spends money.')
    const who = d.getByTestId('config-autopublish-generate-start-approver'); await expect(who).toHaveValue('Brynley'); await who.fill('')
    await page.getByTestId('volumes-save').click(); await expect(d.getByTestId('autopublish-error')).toBeVisible(); expect(api.state.mountPuts || []).toHaveLength(0)
    await who.fill('Kyle'); await page.getByTestId('volumes-save').click(); await expect(page.getByTestId('volumes-saved')).toBeVisible()
    expect(api.state.mountPuts.at(-1).auto_publish).toMatchObject({ approved_by: 'Kyle', generate: { start_pod: true, stop_when_done: true, max_spend_usd_per_day: 25 } })
    const POD = (o) => ({ enabled: true, where: 'pod', generating: 1, generated_today: 1, max_per_day: 20, waiting_to_settle: [], failed: [], pod: { name: 'ComfyUI-Dev', state: 'running', case: 'running', price_per_hour: 0.5, est_cost_today_usd: 1.2, ...o } })
    for (const [pod, text] of [[{}, 'Using ComfyUI-Dev (running)'], [{ state: 'exited', case: 'resume' }, 'Resuming ComfyUI-Dev for rendering'], [{ case: 'create', card: 'RTX 4090', state: 'creating' }, 'Creating a render pod (RTX 4090, $0.5/h)'], [{ state: 'stopped', started_by_feature: true }, 'Stopped: batch done']]) {
      api.state.autopublish = { generate: POD(pod) }; await page.goto('/'); const q = await openQ(page)
      await expect(q.getByTestId('autopublish-generate-pod-line')).toHaveText(text); await expect(q.getByTestId('autopublish-generate-spend')).toHaveText('About $1.20 spent today')
    }
    api.state.autopublish = { generate: { ...POD({}), blocked: 'spend_limit' } }; await page.goto('/'); await expect((await openQ(page)).getByTestId('autopublish-generate-pod-line')).toHaveText('Blocked: spend limit')
  })
  test('A review video is required (ticked); unticking asks the name; Most GB per day; the Queue says nothing is selected to send; an older core has none of it', async ({ page, api }) => {
    on(api, { require_review: true, max_gb_per_day: null, generate: GEN() })
    let d = await openPub(page)
    await expect(d.getByTestId('config-autopublish-require-review')).toBeChecked(); await expect(d.getByTestId('config-autopublish-require-review-help')).toHaveText('Off: finished sequences are published without a review video (the DPX frames and/or the Tunnel proxy).')
    await d.getByTestId('config-autopublish-max-gb').fill('50'); await d.getByTestId('config-autopublish-require-review').uncheck()
    const who = d.getByTestId('config-autopublish-require-review-approver'); await who.fill(''); await page.getByTestId('volumes-save').click(); await expect(d.getByTestId('autopublish-error')).toBeVisible()
    await who.fill('Kyle'); await page.getByTestId('volumes-save').click(); await expect(page.getByTestId('volumes-saved')).toBeVisible()
    expect(api.state.mountPuts.at(-1).auto_publish).toMatchObject({ require_review: false, max_gb_per_day: 50, approved_by: 'Kyle' })
    api.state.autopublish = { generate: { enabled: true, where: 'local', generating: 0, generated_today: 0, max_per_day: 20, waiting_to_settle: [], failed: [] }, nothingSelected: true }
    api.state.mounts.config.auto_publish.generate = GEN(); api.state.autopublish.nothing_selected = true
    on(api); d = await openPub(page); await expect(d.getByTestId('autopublish-window')).toBeVisible(); await expect(d.getByTestId('config-autopublish-require-review')).toHaveCount(0); await expect(d.getByTestId('config-autopublish-max-gb')).toHaveCount(0)
  })
})
