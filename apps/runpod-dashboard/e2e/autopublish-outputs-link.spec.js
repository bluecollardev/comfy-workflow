import { test, expect, queueTab } from './fixtures'

// View In Outputs on the Queue > Publishing rows (AutoPublishOutputsLink, outputsTarget in src/utils/autopublish.js).
// NOT RUN when written (Lucas: finish now, skip the tests): the logic is covered by the unit tests in src/utils/autopublish.test.mjs; run `npx playwright test e2e/autopublish-outputs-link.spec.js` before relying on this file.
const on = (api, o = {}) => { api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' }, ...o } }
const due = () => new Date(Date.now() + 580000).toISOString()
const entry = (o = {}) => ({ id: 'd1', shot: 'archival-087', version: 2, files: 3, bytes: 289e6, state: 'would_upload', targets: ['s3'], due_at: due(), ...o })

test.describe('Auto-publish rows: View In Outputs', () => {
  test('every pending (dry-run) row has the link; a row with no files has it disabled with "Nothing generated yet"', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [entry(), entry({ id: 'd2', shot: 'photoreal-013', version: 7, files: 0, bytes: 0 })] }
    await page.goto('/'); await queueTab(page, 'publishing')
    const rows = page.getByTestId('autopublish-row')
    await expect(rows.getByTestId('autopublish-view-outputs')).toHaveCount(2)
    await expect(rows.getByTestId('autopublish-view-outputs')).toHaveText(['View In Outputs', 'View In Outputs'])
    const empty = rows.nth(1)
    await expect(empty.getByTestId('autopublish-view-outputs')).toBeDisabled()
    await expect(empty.getByTestId('autopublish-outputs-wrap')).toHaveAttribute('title', 'Nothing generated yet')
    await expect(empty.getByTestId('autopublish-view-outputs')).toHaveAttribute('data-reason', 'nothing')
  })
  test('a row with files is enabled when a pod is on the volume and opens that pod\'s Outputs window in the review folder (folder scope); with no pod on the volume it is disabled with the reason', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [entry()] }
    api.state.s3Outputs = { files: [{ key: 'deliver/archival-087/v002/ARCHIVAL-087_RAIN.mov', bytes: 1000, modified: '2026-11-21T00:00:00Z' }] }   // the volume listing the Outputs window opens on
    await page.goto('/'); await queueTab(page, 'publishing')
    const link = page.getByTestId('autopublish-row').first().getByTestId('autopublish-view-outputs')
    if (await link.isDisabled()) {
      await expect(link).toHaveAttribute('data-reason', 'nopod')
      await expect(page.getByTestId('autopublish-row').first().getByTestId('autopublish-outputs-wrap')).toHaveAttribute('title', 'No pod is attached to the volume')
      return
    }
    await expect(page.getByTestId('autopublish-row').first().getByTestId('autopublish-outputs-wrap')).toHaveAttribute('title', 'Open the Outputs window in deliver/archival-087/v002')
    await link.click()
    await expect(page.getByTestId('pod-outputs-scope-folder')).toHaveClass(/active/)
  })
  test('the recent and held lists carry the link too (a failed row with no files is disabled)', async ({ page, api }) => {
    on(api, { require_approval: true }); api.state.autopublish = { pending: [], recent: [{ id: 'r1', shot: 'archival-085', version: 2, files: 3, bytes: 1e6, state: 'done', done_at: new Date().toISOString() }, { id: 'r2', shot: 'archival-086', version: 1, files: 0, bytes: 0, state: 'failed', reason: 'x' }] }
    await page.goto('/'); await queueTab(page, 'publishing')
    const recent = page.getByTestId('autopublish-recent')
    await expect(recent.getByTestId('autopublish-view-outputs')).toHaveCount(2)
    await expect(recent.nth(1).getByTestId('autopublish-view-outputs')).toBeDisabled()
  })
})
