import { test, expect, podCard, modal } from './fixtures'
import { t } from './i18n'

// Slack posts carry the first frame of up to 3 shots (slack.preview_frame) and where the files were on the volume (slack.volume_source), v1.6.2. The core is faked (state.publish.previewSupport / volumeSourceSupport).
const GB = 1e9
const SLACK = { workspace_name: 'Beinghuman', workspace_url: 'https://beinghuman-hq.slack.com', channel: '#deliveries', username: 'RunPod Manager', webhook_hint: '••••9f2k' }
const CONFIGURED = { s3: { bucket: 'beinghuman-deliveries', prefix: 'imax/restoration', region: 'eu-west-1', endpoint: '', credentials: 'app', access_key_hint: '••••1234', presign_hours: 72 }, slack: SLACK, defaults: { targets: ['s3', 'slack'], message: '{shot} {version} is on S3: {links}' } }
const f = (n, dir, b = GB) => ({ name: n, path: `${dir}/${n}`, dir: false, bytes: b })
const TREE = {
  '': [{ name: 'deliver', path: 'deliver', dir: true }, { name: 'notes.txt', path: 'notes.txt', dir: false, bytes: 1200 }],
  deliver: [{ name: 'a', path: 'deliver/a', dir: true }, { name: 'b', path: 'deliver/b', dir: true }, { name: 'c', path: 'deliver/c', dir: true }, { name: 'd', path: 'deliver/d', dir: true }],
  'deliver/a': [f('a_review.mov', 'deliver/a')], 'deliver/b': [f('b_review.mov', 'deliver/b')], 'deliver/c': [f('c_review.mp4', 'deliver/c')], 'deliver/d': [f('d_review.mov', 'deliver/d')],
}
const setup = (api, o = {}) => { api.state.publish = { settings: JSON.parse(JSON.stringify(CONFIGURED)), tree: JSON.parse(JSON.stringify(TREE)), there: [], heavy: [], previewSupport: true, ...o } }
const openModal = async (page) => { await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); await page.getByTestId('pod-outputs-publish').click(); const m = page.getByTestId('publish-modal'); await expect(m).toBeVisible(); await m.getByTestId('publish-source-local').click(); await expect(m.getByTestId('publish-entry').first()).toBeVisible(); return m }
const into = async (m) => { await m.getByTestId('publish-quick-deliver').click(); await expect(m.getByTestId('publish-entry').first()).toBeVisible() }
const tick = (m, p) => m.locator(`[data-testid="publish-entry-check"][data-path="${p}"]`)
const openConnectSlack = async (page) => { await page.goto('/'); await page.getByTestId('open-connect').click(); const d = modal(page, t('connect.title')); await d.getByRole('tab', { name: t('connect.slack') }).click(); await expect(d.getByTestId('slack-pane')).toBeVisible(); return d }

test.describe('Connect > Slack: the preview frame and the volume source', () => {
  test('both are ticked by default with their help text; unticking and Save sends them with the other Slack fields; saving again keeps them', async ({ page, api }) => {
    setup(api, { previewSupport: true, volumeSourceSupport: true })
    const d = await openConnectSlack(page)
    await expect(d.getByTestId('slack-preview-frame')).toBeChecked(); await expect(d.getByTestId('slack-volume-source')).toBeChecked()
    await expect(d.getByTestId('slack-preview-help')).toHaveText('Slack shows the first frame of up to 3 shots in the message. It is uploaded next to the files and linked with an expiring link.')
    await expect(d.getByTestId('slack-volume-help')).toHaveText('The message names the volume and folder and gives an aws command for people with RunPod S3 keys. Files on the volume cannot be linked directly: its S3 API does not allow shared links.')
    await expect(d.getByTestId('publish-slack-save-first')).toHaveCount(0)
    await d.getByTestId('slack-preview-frame').uncheck(); await d.getByTestId('slack-volume-source').uncheck()
    await expect(d.getByTestId('publish-slack-save-first')).toBeVisible()   // edited, not saved
    await d.getByTestId('publish-slack-save').click(); await expect(d.getByTestId('publish-slack-saved')).toBeVisible()
    expect(api.state.publish.puts.at(-1).slack).toMatchObject({ preview_frame: false, volume_source: false, channel: '#deliveries' })
    await expect(d.getByTestId('slack-preview-frame')).not.toBeChecked(); await expect(d.getByTestId('slack-volume-source')).not.toBeChecked()
    await d.getByTestId('slack-preview-frame').check(); await d.getByTestId('publish-slack-save').click()
    await expect.poll(() => api.state.publish.puts.at(-1).slack.preview_frame).toBe(true)
  })
  test('an older core without either setting shows neither checkbox and sends neither key', async ({ page, api }) => {
    setup(api, { previewSupport: false })
    const d = await openConnectSlack(page)
    await expect(d.getByTestId('slack-preview-frame')).toHaveCount(0); await expect(d.getByTestId('slack-volume-source')).toHaveCount(0)
    await d.getByTestId('publish-slack-channel').fill('#other'); await d.getByTestId('publish-slack-save').click()
    await expect.poll(() => api.state.publish.puts.length).toBe(1)
    expect(api.state.publish.puts[0].slack).not.toHaveProperty('preview_frame'); expect(api.state.publish.puts[0].slack).not.toHaveProperty('volume_source')
  })
  test('the Auto-publish block says Slack posts include links and a preview frame', async ({ page, api }) => {
    setup(api)
    await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await d.getByRole('tab', { name: t('publish.tab') }).click()
    await expect(d.getByTestId('autopublish-preview-note')).toHaveText('Slack posts include links and a preview frame (Connect > Slack).')
  })
})

test.describe('the Publish window: the preview frame', () => {
  test('Publish files: the line names the first clip and "and 2 more" for three shots, with a list of names and keys; the tick starts from the setting', async ({ page, api }) => {
    setup(api)
    const m = await openModal(page)
    await into(m)
    await tick(m, 'deliver/a').check(); await tick(m, 'deliver/b').check(); await tick(m, 'deliver/c').check(); await tick(m, 'deliver/d').check()
    await expect(m.getByTestId('publish-preview-frame')).toBeChecked()
    await expect(m.getByTestId('publish-preview-line')).toContainText('Preview frame: a_review_preview.jpg')
    await expect(m.getByTestId('publish-preview-more')).toHaveText('(and 2 more)')   // up to 3 shots, the fourth is not included
    await m.getByTestId('publish-preview-list').locator('summary').click()
    await expect(m.getByTestId('publish-preview-item')).toHaveCount(3)
    await expect(m.getByTestId('publish-preview-item').first()).toContainText('imax/restoration/deliver/a/a_review_preview.jpg')
    await expect(m.getByTestId('publish-counts')).toContainText('4 files')   // the previews add nothing to the totals
  })
  test('one shot: no "and more"; the per-run tick sends preview_frame on plan and run for that run only; unticked shows no line', async ({ page, api }) => {
    setup(api)
    const m = await openModal(page)
    await into(m)
    await tick(m, 'deliver/a').check(); await m.getByTestId('publish-approved-by').fill('Brynley')
    await expect(m.getByTestId('publish-preview-line')).toContainText('a_review_preview.jpg'); await expect(m.getByTestId('publish-preview-more')).toHaveCount(0)
    await expect.poll(() => api.state.publish.planned.at(-1).preview_frame).toBe(true)
    await m.getByTestId('publish-preview-frame').uncheck()
    await expect.poll(() => api.state.publish.planned.at(-1).preview_frame).toBe(false)
    await expect(m.getByTestId('publish-preview-line')).toHaveCount(0); await expect(m.getByTestId('publish-preview-none')).toHaveCount(0)
    await m.getByTestId('publish-run').click()
    await expect.poll(() => api.state.publish.runs.length).toBe(1)
    expect(api.state.publish.runs[0]).toMatchObject({ targets: ['s3', 'slack'], preview_frame: false })
    expect(api.state.publish.settings.slack.preview_frame).toBe(true)   // the setting itself did not change
  })
  test('a selection with no video or sequence: amber "No preview frame will be included" with the reason (the core\'s own reason when it gives one)', async ({ page, api }) => {
    setup(api)
    const m = await openModal(page)
    await tick(m, 'notes.txt').check()
    await expect(m.getByTestId('publish-preview-none')).toHaveText('No preview frame will be included: no video or image sequence in the selection'); await expect(m.getByTestId('publish-preview-none')).toHaveClass(/text-warning/)
    api.state.publish.previewProblem = 'ffmpeg is not installed'
    await m.getByTestId('publish-message').fill('changed'); await expect(m.getByTestId('publish-preview-none')).toHaveText('No preview frame will be included: ffmpeg is not installed')
  })
  test('with Slack off as a target there is no preview line or tick; an older core (no setting) shows none and sends no preview_frame', async ({ page, api }) => {
    setup(api)
    let m = await openModal(page)
    await into(m)
    await tick(m, 'deliver/a').check(); await expect(m.getByTestId('publish-preview-frame')).toBeVisible()
    await m.getByTestId('publish-target-slack-check').uncheck(); await expect(m.getByTestId('publish-preview')).toHaveCount(0)
  })
  test('an older core ignores it entirely', async ({ page, api }) => {
    setup(api, { previewSupport: false })
    const m = await openModal(page)
    await into(m)
    await tick(m, 'deliver/a').check(); await m.getByTestId('publish-approved-by').fill('B')
    await expect(m.getByTestId('publish-slack-preview')).toBeVisible()
    await expect(m.getByTestId('publish-preview')).toHaveCount(0)
    await m.getByTestId('publish-run').click(); await expect.poll(() => api.state.publish.runs.length).toBe(1)
    expect(api.state.publish.runs[0]).not.toHaveProperty('preview_frame'); expect(api.state.publish.planned.at(-1)).not.toHaveProperty('preview_frame')
  })
  test('job warnings show as amber lines and the job is not failed', async ({ page, api }) => {
    setup(api, { runWarnings: ['No preview frame: ffmpeg is not installed'] })
    const m = await openModal(page)
    await into(m)
    await tick(m, 'deliver/a').check(); await m.getByTestId('publish-approved-by').fill('B'); await m.getByTestId('publish-run').click()
    const w = m.getByTestId('publish-job-warning')
    await expect(w).toHaveText('No preview frame: ffmpeg is not installed'); await expect(w).toHaveClass(/text-warning/)
    await expect(m.getByTestId('publish-job')).not.toHaveAttribute('data-state', 'failed')
  })
})

test.describe('the Publish window: the source on the volume', () => {
  const VTREE = { '': [{ name: 'archival-085', path: 'archival-085', dir: true }], 'archival-085': [{ name: 'a.mov', path: 'archival-085/a.mov', dir: false, bytes: GB }] }
  test('the plan view shows the core\'s line and a small badge when the setting is on and the files came from the volume; no badge for local files or with the setting off', async ({ page, api }) => {
    setup(api, { volumeSourceSupport: true, vtree: VTREE, vsizes: { 'archival-085': { files: 1, bytes: GB } } })
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); await page.getByTestId('pod-outputs-publish').click()
    const m = page.getByTestId('publish-modal')
    await m.locator('[data-testid="publish-volume-entry-check"][data-path="archival-085"]').check()
    await expect(m.getByTestId('publish-slack-preview')).toContainText('Source on the volume: comfy-shared · output/archival-085 (and 1 more)')
    await expect(m.getByTestId('publish-volume-source-badge')).toHaveText('includes the source location')
  })
  test('local files only: no line and no badge; with the setting off nothing is added either', async ({ page, api }) => {
    setup(api, { volumeSourceSupport: true, vtree: VTREE })
    const m = await openModal(page)
    await into(m)
    await tick(m, 'deliver/a').check()
    await expect(m.getByTestId('publish-slack-preview')).toBeVisible(); await expect(m.getByTestId('publish-slack-preview')).not.toContainText('Source on the volume'); await expect(m.getByTestId('publish-volume-source-badge')).toHaveCount(0)
  })
  test('an older core (no volume_source setting) shows no badge', async ({ page, api }) => {
    setup(api, { vtree: VTREE })
    const m = await openModal(page)
    await into(m)
    await tick(m, 'deliver/a').check()
    await expect(m.getByTestId('publish-volume-source-badge')).toHaveCount(0)
  })
})

test.describe('Scan and backfill: the preview frame and the volume source', () => {
  const INV = { rows: [
    { id: 'r1', shot: 'archival-085', name: 'a_review.mov', kind: 'review', frames: 0, bytes: 2 * GB, where: ['volume'], in_destination: false, source: 'volume:output/', path: 'deliver/a/a_review.mov', weight: false },
    { id: 'r2', shot: 'archival-085', name: 'b_review.mp4', kind: 'review', frames: 0, bytes: GB, where: ['pc'], in_destination: false, source: 'pc:output/', path: 'deliver/b/b_review.mp4', weight: false },
    { id: 'r3', shot: 'cgi-042', name: 'CGI', kind: 'dpx', frames: 24, bytes: 3 * GB, where: ['pc'], in_destination: false, source: 'pc:output/', path: 'cgi-042/dpx', weight: false },
  ], by_shot: { 'archival-085': 2, 'cgi-042': 1 }, unreadable: [] }
  async function bf(page, api, o = {}) {
    setup(api, { inventory: INV, volumeSourceSupport: true, ...o })
    const m = await openModal(page)
    await m.getByTestId('publish-tab-backfill').click(); await m.getByTestId('publish-backfill-scan').click(); await expect(m.getByTestId('publish-backfill-table')).toBeVisible()
    return m
  }
  const check = (m, id) => m.locator(`[data-testid="publish-backfill-row-check"][data-id="${id}"]`)
  test('two clips: the line, "and 1 more", the badge for a volume row; the tick sends preview_frame on the backfill plan and run', async ({ page, api }) => {
    const m = await bf(page, api)
    await check(m, 'r1').check(); await check(m, 'r2').check()
    await expect(m.getByTestId('publish-preview-line')).toContainText('Preview frame: a_review_preview.jpg'); await expect(m.getByTestId('publish-preview-more')).toHaveText('(and 1 more)')
    await expect(m.getByTestId('publish-backfill-slack-preview')).toContainText('Source on the volume'); await expect(m.getByTestId('publish-volume-source-badge')).toBeVisible()
    await expect.poll(() => api.state.publish.bfPlans.at(-1).preview_frame).toBe(true)
    await m.getByTestId('publish-preview-frame').uncheck()
    await expect.poll(() => api.state.publish.bfPlans.at(-1).preview_frame).toBe(false)
    await m.getByTestId('publish-backfill-approved-by').fill('B'); await m.getByTestId('publish-backfill-run').click()
    await expect.poll(() => api.state.publish.bfRuns.length).toBe(1)
    expect(api.state.publish.bfRuns[0].preview_frame).toBe(false)
  })
  test('a sequence-less, video-less pick shows the amber no-preview line; a pc-only pick has no volume badge; warnings show on the job', async ({ page, api }) => {
    const m = await bf(page, api, { runWarnings: ['No preview frame: ffmpeg is not installed'] })
    await check(m, 'r3').check()
    await expect(m.getByTestId('publish-preview-none')).toHaveText('No preview frame will be included: no video or image sequence in the selection')
    await expect(m.getByTestId('publish-volume-source-badge')).toHaveCount(0)
    await check(m, 'r3').uncheck(); await check(m, 'r2').check()
    await m.getByTestId('publish-backfill-approved-by').fill('B'); await m.getByTestId('publish-backfill-run').click()
    await expect(m.getByTestId('publish-job-warning')).toHaveText('No preview frame: ffmpeg is not installed')
  })
  test('an older core shows no preview line, tick or badge in the backfill view and sends no preview_frame', async ({ page, api }) => {
    const m = await bf(page, api, { previewSupport: false, volumeSourceSupport: false })
    await check(m, 'r1').check()
    await expect(m.getByTestId('publish-backfill-slack-preview')).toBeVisible(); await expect(m.getByTestId('publish-preview')).toHaveCount(0)
    expect(api.state.publish.bfPlans.at(-1)).not.toHaveProperty('preview_frame')
  })
})

test.describe('links in the Slack message', () => {
  const EXP = '2026-11-26T10:00:00Z'
  const LINKS = [
    { path: 'imax/restoration/deliver/a', url: 'https://eu-west-1.console.aws.amazon.com/s3/buckets/beinghuman-deliveries?prefix=imax/restoration/deliver/a/', kind: 'folder' },
    { path: 'deliver/a/a_review.mov', url: 'https://s3.example/a_review.mov?sig=1', expires_at: EXP, kind: 'file' },
    { path: 'deliver/a/b.mov', url: 'https://s3.example/b.mov?sig=1', expires_at: EXP },
    { path: 'deliver/a/a_review_preview.jpg', url: 'https://s3.example/a_review_preview.jpg?sig=1', expires_at: EXP, kind: 'preview' },
    { path: 'deliver/a/legacy', url: 'https://console.aws.amazon.com/s3/x' },
  ]
  test('Connect > Slack: the Links in the message group: both ticked and 10 by default with the help texts; the count is 1..25 inline and blocks Save; the Save body carries all three', async ({ page, api }) => {
    setup(api, { linksSupport: true })
    const d = await openConnectSlack(page)
    const g = d.getByTestId('slack-links')
    await expect(g).toContainText('Links in the message')
    await expect(g.getByTestId('slack-folder-link')).toBeChecked(); await expect(g.getByTestId('slack-file-links')).toBeChecked(); await expect(g.getByTestId('slack-file-link-count')).toHaveValue('10')
    await expect(g.getByTestId('slack-folder-link-help')).toHaveText('A link to the destination folder in the AWS console: opens for people with access to the bucket.')
    await expect(g.getByTestId('slack-file-links-help')).toHaveText('Each link expires (up to 7 days). Anyone who has the Slack message can open the file links until they expire.')
    for (const bad of ['0', '26', '']) {
      await g.getByTestId('slack-file-link-count').fill(bad)
      await expect(g.getByTestId('slack-file-link-count-error')).toHaveText('The number of file links is a whole number from 1 to 25.')
      const before = api.state.publish.puts.length
      await d.getByTestId('publish-slack-save').click(); await page.waitForTimeout(150); expect(api.state.publish.puts.length).toBe(before)
    }
    await g.getByTestId('slack-file-link-count').fill('25'); await expect(g.getByTestId('slack-file-link-count-error')).toHaveCount(0)
    await g.getByTestId('slack-file-link-count').fill('15'); await g.getByTestId('slack-folder-link').uncheck()
    await d.getByTestId('publish-slack-save').click(); await expect(d.getByTestId('publish-slack-saved')).toBeVisible()
    expect(api.state.publish.puts.at(-1).slack).toMatchObject({ folder_link: false, file_links: true, file_link_count: 15 })
    await expect(g.getByTestId('slack-folder-link')).not.toBeChecked(); await expect(g.getByTestId('slack-file-link-count')).toHaveValue('15')
    await g.getByTestId('slack-file-links').uncheck(); await expect(g.getByTestId('slack-file-link-count')).toBeDisabled()
  })
  test('an older core without the link settings shows no group and sends no link keys', async ({ page, api }) => {
    setup(api)
    const d = await openConnectSlack(page)
    await expect(d.getByTestId('slack-links')).toHaveCount(0)
    await d.getByTestId('publish-slack-channel').fill('#x'); await d.getByTestId('publish-slack-save').click(); await expect.poll(() => api.state.publish.puts.length).toBe(1)
    for (const k of ['folder_link', 'file_links', 'file_link_count']) expect(api.state.publish.puts[0].slack).not.toHaveProperty(k)
  })
  test('Publish files: the plan line for each combination, with the expiry; an older core has no line', async ({ page, api }) => {
    setup(api, { linksSupport: true })
    const m = await openModal(page)
    await into(m); await tick(m, 'deliver/a').check()
    const line = m.getByTestId('publish-links-line')
    await expect(line).toContainText('Links: the folder and the first 10 files, expiring'); await expect(line).toContainText('2026')
    const set = async (o) => { Object.assign(api.state.publish.settings.slack, o); await m.getByTestId('publish-message').fill(`m${Math.random()}`) }
    await set({ folder_link: false }); await expect(line).toContainText('Links: the first 10 files, expiring')
    await set({ file_link_count: 3 }); await expect(line).toContainText('Links: the first 3 files')
    await set({ folder_link: true, file_links: false }); await expect(line).toHaveText('Links: the folder')
    await set({ folder_link: false }); await expect(line).toHaveText('No links')
  })
  test('an older core shows no links line in the Publish window', async ({ page, api }) => {
    setup(api)
    const m = await openModal(page)
    await into(m); await tick(m, 'deliver/a').check()
    await expect(m.getByTestId('publish-slack-preview')).toBeVisible(); await expect(m.getByTestId('publish-links-line')).toHaveCount(0)
  })
  test('the job result groups the links: Folder links, File links with Copy and expiry, Preview image; a missing kind falls back on the address; an older core shows one plain list', async ({ page, api }) => {
    setup(api, { linksSupport: true, runLinks: LINKS })
    const m = await openModal(page)
    await into(m); await tick(m, 'deliver/a').check(); await m.getByTestId('publish-approved-by').fill('B'); await m.getByTestId('publish-run').click()
    await expect(m.getByTestId('publish-links-folder')).toContainText('Folder links'); await expect(m.getByTestId('publish-links-file')).toContainText('File links'); await expect(m.getByTestId('publish-links-preview')).toContainText('Preview image')
    await expect(m.locator('[data-testid="publish-link"][data-kind="folder"]')).toHaveCount(2)   // the console address without a kind is a folder
    await expect(m.locator('[data-testid="publish-link"][data-kind="file"]')).toHaveCount(2)
    await expect(m.locator('[data-testid="publish-link"][data-kind="preview"]')).toHaveCount(1)
    await expect(m.locator('[data-testid="publish-link"][data-kind="file"]').first().getByTestId('publish-link-copy')).toBeVisible()
    await expect(m.locator('[data-testid="publish-link"][data-kind="file"]').first().getByTestId('publish-link-expiry')).toContainText('2026')
  })
  test('a core without the settings shows the one list as before', async ({ page, api }) => {
    setup(api, { runLinks: LINKS.slice(1, 3) })
    const m = await openModal(page)
    await into(m); await tick(m, 'deliver/a').check(); await m.getByTestId('publish-approved-by').fill('B'); await m.getByTestId('publish-run').click()
    await expect(m.getByTestId('publish-link')).toHaveCount(2); await expect(m.getByTestId('publish-links-file')).toHaveCount(0)
  })
  test('Backfill: the same plan line, and its result groups the folder links too', async ({ page, api }) => {
    const INV = { rows: [{ id: 'r1', shot: 's', name: 'a.mov', kind: 'review', frames: 0, bytes: GB, where: ['pc'], in_destination: false, source: 'pc:output/', path: 'deliver/a/a.mov', weight: false }], by_shot: { s: 1 }, unreadable: [] }
    setup(api, { inventory: INV, linksSupport: true, runLinks: LINKS })
    const m = await openModal(page)
    await m.getByTestId('publish-tab-backfill').click(); await m.getByTestId('publish-backfill-scan').click(); await expect(m.getByTestId('publish-backfill-table')).toBeVisible()
    await m.locator('[data-testid="publish-backfill-row-check"][data-id="r1"]').check()
    await expect(m.getByTestId('publish-links-line')).toContainText('Links: the folder and the first 10 files, expiring')
    await m.getByTestId('publish-backfill-approved-by').fill('B'); await m.getByTestId('publish-backfill-run').click()
    await expect(m.getByTestId('publish-links-folder')).toBeVisible(); await expect(m.locator('[data-testid="publish-link"][data-kind="folder"]')).toHaveCount(2)
  })
})
