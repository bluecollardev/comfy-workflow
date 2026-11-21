import { test, expect, modal, cfgTab, queueTab } from './fixtures'
import { t } from './i18n'

// Dry run does the whole job without sending: an S3 plan per entry (destination, files and actions, manifest, access check) and one Slack summary, in a panel above the entries.
const on = (api, o = {}) => { api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: true, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' }, ...o } }
const due = () => new Date(Date.now() + 580000).toISOString()
const plan = (o = {}) => ({ bucket: 'bh-panama-exchange', prefix: 'returns/BKK/', round: 'tunnel-v11_2026-11-19_r01', files: [{ key: 'archival-084/ARCHIVAL-084_A_V11.mp4', bytes: 40e6, action: 'upload' }, { key: 'archival-084/ARCHIVAL-084_A_V11.json', bytes: 2e3, action: 'skip' }], manifest_key: 'tunnel-v11_2026-11-19_r01/RETURN-MANIFEST.json', total_bytes: 40.002e6, total_files: 2, access: { ok: true, checked_at: '2026-11-19T10:00:00Z', detail: 'returns/BKK/' }, ...o })
const entry = (o = {}) => ({ id: 'd1', shot: 'archival-084', version: 3, files: 2, bytes: 40e6, state: 'would_upload', targets: ['s3', 'slack'], due_at: due(), dry_run_plan: plan(), ...o })

test.describe('Dry run: S3 and Slack', () => {
  test('the panel above the entries: how many review videos, files and size, the destination and the window; the Slack state; Copy the summary; the hint', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [entry(), entry({ id: 'd2', shot: 'cgi-042', version: 1, dry_run_plan: plan({ total_files: 3, total_bytes: 60e6 }) })], dryReportText: 'Dry run: would upload 2 review videos to s3://bh-panama-exchange/returns/BKK/' }
    api.state.slackSummary = true
    await page.goto('/'); await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    await queueTab(page, 'publishing')
    const p = page.getByTestId('autopublish-dryrun-panel')
    await expect(p.getByTestId('autopublish-dryrun-line')).toHaveText('Would upload 2 review videos (5 files, 95.4 MB) to s3://bh-panama-exchange/returns/BKK/tunnel-v11_2026-11-19_r01/ after a 10-minute window'); await expect(p.getByTestId('autopublish-dryrun-slack')).toHaveText('Slack: no dry-run summary posted yet')
    await expect(p.getByTestId('autopublish-dryrun-hint')).toHaveText('Switch off Dry run in the Auto-publish settings to send it for real')
    await p.getByTestId('autopublish-dryrun-copy').click(); await expect(p.getByTestId('autopublish-dryrun-copy')).toHaveText('Copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Dry run: would upload 2 review videos to s3://bh-panama-exchange/returns/BKK/')
    api.state.autopublish.slack_dry_run = { posted_at: new Date().toISOString() }
  })
  test('a posted Slack summary shows its time; with Slack off the panel says so', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [entry()], slack_dry_run: { posted_at: '2026-11-19T10:05:07' } }
    await page.goto('/'); await queueTab(page, 'publishing')
    await expect(page.getByTestId('autopublish-dryrun-slack')).toContainText('Slack: a dry-run summary was posted')
    on(api, { targets: { s3: true, slack: false, tunnel: false } }); await page.reload(); await queueTab(page, 'publishing')
    await expect(page.getByTestId('autopublish-dryrun-slack')).toHaveText('Slack target is off')
  })
  test('an entry expands to its S3 dry run: destination, files with their key relative to the round, size and action, the manifest, totals and the access check (with the note that writing is not proven)', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [entry(), entry({ id: 'd2', shot: 'cgi-042', version: 1, dry_run_plan: plan({ access: { ok: false, detail: 'Access Denied: s3:ListBucket on returns/BKK/' } }) })] }
    await page.goto('/'); await queueTab(page, 'publishing')
    const row = (id) => page.locator(`[data-testid="autopublish-row"][data-id="${id}"]`)
    await expect(row('d1').getByTestId('autopublish-dry-plan')).toHaveCount(0)
    const order = await row('d1').getByTestId('autopublish-row-actions').locator('xpath=./*').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    expect(order.slice(0, 4)).toEqual(['autopublish-outputs-wrap', 'autopublish-dry-toggle', 'autopublish-deliver', 'autopublish-cancel'])   // View In Outputs, then the S3 dry run link, Deliver, Cancel after it
    await row('d1').getByTestId('autopublish-dry-toggle').click()
    const d = row('d1').getByTestId('autopublish-dry-plan')
    await expect(d.getByTestId('autopublish-dry-dest')).toHaveText('s3://bh-panama-exchange/returns/BKK/tunnel-v11_2026-11-19_r01/')
    await expect(d.getByTestId('autopublish-dry-file')).toHaveCount(2); await expect(d.locator('[data-key="archival-084/ARCHIVAL-084_A_V11.mp4"] [data-testid="autopublish-dry-action"]')).toHaveText('upload'); await expect(d.locator('[data-key="archival-084/ARCHIVAL-084_A_V11.json"] [data-testid="autopublish-dry-action"]')).toHaveText('skip')
    await expect(d.getByTestId('autopublish-dry-manifest')).toContainText('RETURN-MANIFEST.json'); await expect(d.getByTestId('autopublish-dry-totals')).toHaveText('2 files, 38.1 MB')
    await expect(d.getByTestId('autopublish-dry-access')).toHaveAttribute('data-ok', 'true'); await expect(d.getByTestId('autopublish-dry-access')).toContainText('can list returns/BKK/'); await expect(d.getByTestId('autopublish-dry-access')).toContainText('write access is not proven in a dry run')
    await row('d2').getByTestId('autopublish-dry-toggle').click()
    await expect(row('d2').getByTestId('autopublish-dry-access')).toHaveAttribute('data-ok', 'false'); await expect(row('d2').getByTestId('autopublish-dry-access')).toContainText('Access Denied')
  })
  test('the Auto-publish steps say what a dry run did; live, none of it; an older core (no plans) shows no panel and no chevron', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [entry()] }
    await page.goto('/'); await page.getByTestId('open-config').click(); let d = modal(page, t('config.title')); await cfgTab(d, 'publishing')
    await expect(d.getByTestId('autopublish-step-dry-s3')).toHaveText('2 Publish to S3: dry run, nothing written'); await expect(d.getByTestId('autopublish-step-dry-slack')).toHaveText('3 Post to Slack: dry-run summary')
    on(api, { dry_run: false }); await page.reload(); await page.getByTestId('open-config').click(); d = modal(page, t('config.title')); await cfgTab(d, 'publishing')
    await expect(d.getByTestId('autopublish-step-dry-s3')).toHaveCount(0)
    on(api); api.state.autopublish = { pending: [entry({ dry_run_plan: undefined })] }
    await page.reload(); await queueTab(page, 'publishing')
    await expect(page.getByTestId('autopublish-row').first()).toBeVisible(); await expect(page.getByTestId('autopublish-dryrun-panel')).toHaveCount(0); await expect(page.getByTestId('autopublish-dry-toggle')).toHaveCount(0)
  })
})
