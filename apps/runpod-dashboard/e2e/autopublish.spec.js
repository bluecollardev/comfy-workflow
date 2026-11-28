import { test, expect, openAutopublish, podCard, modal, cfgTab, answerConfirm, queueTab } from './fixtures'
import { formatBytes } from '../src/sync-progress'
import { t } from './i18n'

// Auto-publish (docs/ADR-050 amendment, v1.6.2): the settings block, the header chip, the Queue section and Mark approved. The core is faked (state.autopublish; the settings are the Default Configuration's auto_publish).
const DEST = 's3://bh-panama-exchange-610140802195/returns/BKK/'
const calls = (api, name) => (api.state.autopublish?.calls || []).filter((c) => c.call === name)
const slackOn = (api) => { api.state.publish = { settings: { s3: { bucket: 'bh-panama-exchange-610140802195', prefix: 'returns/BKK/', region: 'us-west-2', endpoint: '', credentials: 'panama', access_key_hint: '', presign_hours: 72 }, slack: { workspace_name: 'Beinghuman', workspace_url: 'https://beinghuman-hq.slack.com', channel: '#deliveries', username: 'RunPod Manager', webhook_hint: '••••9f2k' }, defaults: { targets: ['s3'], message: '{shot}' } } } }
const openBlock = async (page) => { const d = await openAutopublish(page); await expect(d.getByTestId('settings-autopublish')).toBeVisible(); return d }
const prompt = (page) => page.getByTestId('name-prompt')
const on = (api, o = {}) => { api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, daily_cap: null, dry_run_first: true, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'Brynley', at: '2026-11-19T10:00:00Z' }, ...o } }
const inMinutes = (m, s = 0) => new Date(Date.now() + m * 60000 + s * 1000).toISOString()
const entry = (o = {}) => ({ id: 'ap-1', shot: 'archival-085', version: 2, files: 3, bytes: 2.1e9, due_at: inMinutes(9, 41), state: 'waiting', approved_by: 'Kyle', targets: ['s3'], ...o })
const REVIEW = (o = {}) => ({ shot: 'archival-085', version: 3, files: [{ name: 'a.mov', bytes: 9e9 }], bytes: 9e9, complete: true, on_pc: true, approved: null, state: 'not approved', in_destination: false, ...o })

test.describe('Settings > Publishing > Auto-publish', () => {
  test('off by default: the destination, the switch, the quiet Binc line (no warning), and nothing else until it is on', async ({ page }) => {
    const d = await openBlock(page)
    const b = d.getByTestId('settings-autopublish')
    await expect(b.getByTestId('autopublish-destination')).toHaveText(`Uploads to ${DEST} only`)
    await expect(b.getByTestId('autopublish-state')).toHaveText('off'); await expect(b.getByTestId('autopublish-switch')).not.toBeChecked()
    await expect(b.getByTestId('autopublish-binc-note')).toHaveText('Binc agreed to Auto-publish (Lucas, 2026-11-19). Everything it uploads is recorded under the standing approval above.')
    await expect(b.getByTestId('autopublish-binc-note')).toHaveClass(/text-body-secondary/); await expect(b).not.toContainText("confirm his agreement")
    for (const id of ['autopublish-standing', 'autopublish-dry-run', 'autopublish-window', 'autopublish-off']) await expect(b.getByTestId(id)).toHaveCount(0)
  })
  test('turning it on asks a name and a tick (Enable waits for both), shows the core\'s 400 inline, then starts in dry run with the standing approval; the name is remembered', async ({ page, api }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem('c')) { localStorage.removeItem('runpod-manager.approved-by'); sessionStorage.setItem('c', '1') } })
    const d = await openBlock(page)
    await d.getByTestId('autopublish-switch').click()
    const p = prompt(page)
    await expect(p.getByTestId('name-prompt-ok')).toBeDisabled()
    await expect(p.getByTestId('autopublish-understood')).not.toBeChecked()
    await expect(p).toContainText(`This allows the app to upload approved review videos to ${DEST} by itself, under my name, with a cancel window; nothing is sent until a shot version is marked approved.`)
    await p.getByTestId('name-prompt-input').fill('Brynley'); await expect(p.getByTestId('name-prompt-ok')).toBeDisabled()   // the tick is needed too
    await p.getByTestId('autopublish-understood').check(); await expect(p.getByTestId('name-prompt-ok')).toBeEnabled()
    api.state.autopublish = { failNext: 'approved_by: Auto-publish needs the name of who says yes' }
    await p.getByTestId('name-prompt-ok').click()
    await expect(p.getByTestId('name-prompt-error')).toHaveText('approved_by: Auto-publish needs the name of who says yes'); await expect(p).toBeVisible()
    await p.getByTestId('name-prompt-ok').click()
    await expect(p).toBeHidden()
    expect(calls(api, 'setSettings').at(-1).body).toEqual({ enabled: true, approved_by: 'Brynley', understood: true, dry_run_first: true })
    const b = d.getByTestId('settings-autopublish')
    await expect(b.getByTestId('autopublish-state')).toHaveText('Auto-publish: DRY RUN'); await expect(b.getByTestId('autopublish-dry-run')).toBeChecked()
    await expect(b.getByTestId('autopublish-standing')).toHaveText('Running under the standing approval of Brynley, 19 Nov 2026')
    await expect(b.getByTestId('autopublish-switch')).toBeChecked()
    expect(await page.evaluate(() => localStorage.getItem('runpod-manager.approved-by'))).toBe('Brynley')
  })
  test('going live later: a plain confirm with no name, sends understood true and no approved_by; the standing approval stays; a tick back is a plain edit', async ({ page, api }) => {
    on(api)
    const d = await openBlock(page)
    const b = d.getByTestId('settings-autopublish')
    await b.getByTestId('autopublish-dry-run').click()
    await expect(prompt(page)).toBeHidden()   // no name field
    expect(await answerConfirm(page, false)).toBe(`The next approved version will really be uploaded to ${DEST}. Go live?`); expect(calls(api, 'setSettings')).toHaveLength(0)
    await expect(b.getByTestId('autopublish-dry-run')).toBeChecked()
    await b.getByTestId('autopublish-dry-run').click(); await answerConfirm(page, true)
    await expect.poll(() => calls(api, 'setSettings').at(-1)?.body).toEqual({ dry_run: false, understood: true })
    await expect(b.getByTestId('autopublish-state')).toHaveText('Auto-publish: LIVE'); await expect(b.getByTestId('autopublish-dry-run')).not.toBeChecked(); await expect(b.getByTestId('autopublish-standing')).toContainText('Brynley')
    const before = calls(api, 'setSettings').length
    await b.getByTestId('autopublish-dry-run').click()   // back to a dry run: edited here, saved with the window
    await expect(b.getByTestId('autopublish-dry-run')).toBeChecked(); expect(calls(api, 'setSettings')).toHaveLength(before)
    await expect(page.getByTestId('volumes-save')).toBeEnabled()
  })
  test('the core\'s two 400 texts for going live show inline', async ({ page, api }) => {
    on(api, { standing: null })
    const d = await openBlock(page)
    await d.getByTestId('autopublish-dry-run').click(); await answerConfirm(page, true)
    await expect(d.getByTestId('autopublish-action-error')).toContainText('Going live needs the standing approval: turn Auto-publish on first')
    on(api); await page.reload(); const d2 = await (async () => { const x = await openAutopublish(page, { fresh: false }); return x })()
    const r = await page.evaluate(async () => { const x = await fetch('http://localhost:8000/api/autopublish/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dry_run: false }) }); return { status: x.status, body: await x.json() } })
    expect(r.status).toBe(400); expect(r.body.detail).toBe('Confirm that the next approved version will really be uploaded')
    await expect(d2.getByTestId('autopublish-dry-run')).toBeChecked()
  })
  test('Start in dry run when turned on: ticked by default, rides the footer Save, an untouched config sends no key', async ({ page, api }) => {
    let d = await openBlock(page)
    await expect(d.getByTestId('autopublish-dry-first')).toBeChecked()
    await expect(page.getByTestId('volumes-save')).toBeDisabled(); expect(api.state.mountPuts || []).toHaveLength(0)   // untouched: nothing to save, nothing sent
    d = await openBlock(page)
    await d.getByTestId('autopublish-dry-first').uncheck(); await expect(page.getByTestId('volumes-save')).toBeEnabled()
    await page.getByTestId('volumes-save').click(); await expect(page.getByTestId('volumes-saved')).toBeVisible()
    expect(api.state.mountPuts.at(-1).auto_publish.dry_run_first).toBe(false); expect(api.state.mounts.config.auto_publish.dry_run_first).toBe(false)
  })
  test('the enable dialog shows the choice as a line and a tick: dry by default; unticked it says LIVE at once and the button is a red Enable and go live; the call carries dry_run_first and the state follows', async ({ page, api }) => {
    let d = await openBlock(page)
    await d.getByTestId('autopublish-switch').click()
    let p = prompt(page)
    await expect(p.getByTestId('name-prompt-extra')).toBeChecked(); await expect(p.getByTestId('name-prompt-extra-note')).toHaveText('It will start in dry run: nothing is sent until you go live.')
    await expect(p.getByTestId('name-prompt-ok')).toHaveText('Enable'); await expect(p.getByTestId('name-prompt-ok')).not.toHaveClass(/btn-danger/)
    await p.getByTestId('name-prompt-extra').uncheck()
    await expect(p.getByTestId('name-prompt-extra-note')).toHaveText('It will go LIVE at once: approved versions will be uploaded after the cancel window.')
    await expect(p.getByTestId('name-prompt-ok')).toHaveText('Enable and go live'); await expect(p.getByTestId('name-prompt-ok')).toHaveClass(/btn-danger/)
    await p.getByTestId('name-prompt-input').fill('Brynley'); await p.getByTestId('autopublish-understood').check(); await p.getByTestId('name-prompt-ok').click(); await expect(p).toBeHidden()
    expect(calls(api, 'setSettings').at(-1).body).toEqual({ enabled: true, approved_by: 'Brynley', understood: true, dry_run_first: false })
    await expect(d.getByTestId('autopublish-state')).toHaveText('Auto-publish: LIVE'); await expect(d.getByTestId('autopublish-dry-run')).not.toBeChecked()
    await expect(d.getByTestId('autopublish-dry-first')).not.toBeChecked()   // the dialog's choice is the setting
    await d.getByTestId('autopublish-off').click(); await expect(d.getByTestId('autopublish-state')).toHaveText('off')
    // the block's tick sets the dialog's starting point
    await d.getByTestId('autopublish-dry-first').check()
    await d.getByTestId('autopublish-switch').click(); p = prompt(page)
    await expect(p.getByTestId('name-prompt-extra')).toBeChecked()
    await p.getByTestId('name-prompt-input').fill('Brynley'); await p.getByTestId('autopublish-understood').check(); await p.getByTestId('name-prompt-ok').click()
    expect(calls(api, 'setSettings').at(-1).body.dry_run_first).toBe(true)
    await expect(d.getByTestId('autopublish-state')).toHaveText('Auto-publish: DRY RUN')
  })
  test('an older core without dry_run_first: no tick in the block, no tick in the dialog (dry first, as before), and nothing extra is sent', async ({ page, api }) => {
    api.state.mounts.config.auto_publish = { enabled: false, dry_run: true, window_minutes: 10, daily_cap: null, targets: { s3: true, slack: false, tunnel: false } }
    const d = await openBlock(page)
    await expect(d.getByTestId('autopublish-dry-first')).toHaveCount(0)
    await d.getByTestId('autopublish-switch').click(); const p = prompt(page)
    await expect(p.getByTestId('name-prompt-extra')).toHaveCount(0); await expect(p).toContainText('It will start in dry run: nothing is sent until you go live.')
    await p.getByTestId('name-prompt-input').fill('B'); await p.getByTestId('autopublish-understood').check(); await p.getByTestId('name-prompt-ok').click()
    expect(calls(api, 'setSettings').at(-1).body).toEqual({ enabled: true, approved_by: 'B', understood: true })
    await expect(d.getByTestId('autopublish-state')).toHaveText('Auto-publish: DRY RUN')
  })
  test('Turn Off calls off at once with no confirm, cancels what waits, says what it stops, and the block and chip say OFF', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [entry()] }
    const d = await openBlock(page)
    await expect(page.getByTestId('autopublish-chip')).toBeVisible()
    await expect(d.getByTestId('autopublish-off')).toHaveText('Turn Off'); await expect(d.getByTestId('autopublish-off-note')).toContainText('generating reviews, S3 uploads and Slack posts')   // says what it applies to
    { const b = await d.getByTestId('autopublish-off').boundingBox(), n = await d.getByTestId('autopublish-off-note').boundingBox(); expect(n.x).toBeGreaterThan(b.x + b.width - 1); expect(n.y).toBeLessThan(b.y + b.height) }   // the note sits on the SAME ROW as the button, to its right
    await expect(d.getByTestId('autopublish-existing-slot')).toHaveCount(0)   // no Generate Outputs button in this section
    await expect(d.getByTestId('autopublish-ready')).toHaveCount(0)   // the state badge in the header is the one badge
    await d.getByTestId('autopublish-off').click()
    await expect.poll(() => calls(api, 'off').length).toBe(1)
    await expect(page.getByTestId('confirm-modal')).toBeHidden()
    await expect(d.getByTestId('autopublish-state')).toHaveText('off'); await expect(d.getByTestId('autopublish-standing')).toHaveCount(0)
    await expect(page.getByTestId('autopublish-chip-label')).toHaveText('Auto-publish: OFF', { timeout: 12000 })
    expect(api.state.autopublish.pending).toHaveLength(0)
  })
  test('the footer Save carries window, cap and targets as auto_publish; an untouched configuration sends no such key; the window shows an unsaved flag; bad numbers wait', async ({ page, api }) => {
    let d = await openBlock(page)
    await expect(page.getByTestId('volumes-save')).toBeDisabled(); expect(api.state.mountPuts || []).toHaveLength(0)   // untouched: nothing to save, nothing sent
    on(api)
    d = await openBlock(page)
    await expect(page.getByTestId('volumes-save')).toBeDisabled()
    await d.getByTestId('autopublish-window').fill('20'); await d.getByTestId('autopublish-cap-on').check(); await d.getByTestId('autopublish-cap').fill('7')
    await expect(page.getByTestId('volumes-save')).toBeEnabled()
    await d.getByTestId('autopublish-cap').fill('101'); await page.getByTestId('volumes-save').click()
    await expect(d.getByTestId('autopublish-error')).toHaveText('The daily cap is a whole number from 1 to 100, or 0 for no limit.'); expect(api.state.mountPuts || []).toHaveLength(0)
    await d.getByTestId('autopublish-cap').fill('7'); await d.getByTestId('autopublish-window').fill('130'); await page.getByTestId('volumes-save').click()
    await expect(d.getByTestId('autopublish-error')).toHaveText('The cancel window is a whole number of minutes from 0 to 120.')
    await d.getByTestId('autopublish-window').fill('20'); await page.getByTestId('volumes-save').click(); await expect(page.getByTestId('volumes-saved')).toBeVisible()
    expect(api.state.mountPuts.at(-1).auto_publish).toMatchObject({ window_minutes: 20, daily_cap: 7, enabled: true, targets: { s3: true, slack: false, tunnel: false } })
    expect(api.state.mounts.config.auto_publish).toMatchObject({ window_minutes: 20, daily_cap: 7 })
  })
  test('the daily cap is optional and OFF: unticked with no field and "No daily limit"; ticking shows 5; saving carries the number; unticking saves null', async ({ page, api }) => {
    on(api)
    let d = await openBlock(page)
    const b = d.getByTestId('settings-autopublish')
    await expect(b.getByTestId('autopublish-cap-on')).not.toBeChecked(); await expect(b.getByTestId('autopublish-cap')).toHaveCount(0); await expect(b.getByTestId('autopublish-no-limit')).toHaveText('No daily limit')
    await b.getByTestId('autopublish-cap-on').check()
    await expect(b.getByTestId('autopublish-cap')).toHaveValue('5'); await expect(b.getByTestId('autopublish-no-limit')).toHaveCount(0)
    await b.getByTestId('autopublish-cap').fill('8')
    await page.getByTestId('volumes-save').click(); await expect(page.getByTestId('volumes-saved')).toBeVisible()
    expect(api.state.mountPuts.at(-1).auto_publish.daily_cap).toBe(8)
    d = await openBlock(page)
    await expect(d.getByTestId('autopublish-cap-on')).toBeChecked(); await expect(d.getByTestId('autopublish-cap')).toHaveValue('8')
    await d.getByTestId('autopublish-cap-on').uncheck(); await page.getByTestId('volumes-save').click(); await expect(page.getByTestId('volumes-saved')).toBeVisible()
    expect(api.state.mountPuts.at(-1).auto_publish.daily_cap).toBeNull()
  })
  test('the status text with and without a cap: the Queue header says Today: 3 uploaded, or Today: 3 of 5; a capped row only exists with a cap', async ({ page, api }) => {
    on(api); api.state.autopublish = { today: { count: 3, left: null }, pending: [entry({ state: 'would_upload' })] }
    await page.goto('/')
    await queueTab(page, 'publishing')
    await expect(page.getByTestId('autopublish-pane-today')).toContainText('Today: 3 uploaded'); await expect(page.getByTestId('autopublish-pane-today')).toContainText('No daily limit'); await expect(page.getByTestId('autopublish-pane-today')).not.toContainText('left')
    await expect(page.locator('[data-testid="autopublish-row"][data-state="capped"]')).toHaveCount(0)
    await page.getByTestId('queue-modal').locator('.btn-close').click()
    api.state.mounts.config.auto_publish.daily_cap = 5; api.state.autopublish = { today: { count: 3, left: 2 }, pending: [entry({ id: 'ap-c', state: 'capped' })] }
    await queueTab(page, 'publishing')
    await expect(page.getByTestId('autopublish-pane-today')).toHaveText('Today: 3 of 5'); await expect(page.locator('[data-testid="autopublish-row"][data-state="capped"]')).toHaveCount(1)
  })
  test('an older core without a daily cap shows no cap control', async ({ page, api }) => {
    api.state.mounts.config.auto_publish = { enabled: true, dry_run: true, window_minutes: 10, targets: { s3: true, slack: false, tunnel: false }, standing: { approved_by: 'B', at: '2026-11-19T10:00:00Z' } }
    const d = await openBlock(page)
    await expect(d.getByTestId('autopublish-window')).toBeVisible(); await expect(d.getByTestId('autopublish-cap-on')).toHaveCount(0); await expect(d.getByTestId('autopublish-cap')).toHaveCount(0)
  })
  test('an immediate act refreshes the form: enable, then change the cap, then Save: both persist, nothing stale is written back', async ({ page, api }) => {
    const d = await openBlock(page)
    await d.getByTestId('autopublish-switch').click()
    await prompt(page).getByTestId('name-prompt-input').fill('Brynley'); await prompt(page).getByTestId('autopublish-understood').check(); await prompt(page).getByTestId('name-prompt-ok').click()
    await expect(d.getByTestId('autopublish-state')).toHaveText('Auto-publish: DRY RUN')
    await expect(page.getByTestId('volumes-save')).toBeDisabled()   // the enable is not an unsaved edit
    await d.getByTestId('autopublish-cap-on').check(); await d.getByTestId('autopublish-cap').fill('9')
    await page.getByTestId('volumes-save').click(); await expect(page.getByTestId('volumes-saved')).toBeVisible()
    expect(api.state.mounts.config.auto_publish).toMatchObject({ enabled: true, daily_cap: 9, standing: { approved_by: 'Brynley' } })
    expect(api.state.mountPuts.at(-1).auto_publish.enabled).toBe(true)
  })
  test('Publish to: S3 on, Slack off, Tunnel disabled and off; Slack says why it is disabled (not connected, then S3 off) with the button to Connect; at least one target', async ({ page, api }) => {
    on(api)
    const d = await openBlock(page)
    const g = d.getByTestId('autopublish-targets')
    await expect(g.getByTestId('autopublish-target-s3')).toBeChecked(); await expect(g.getByTestId('autopublish-target-s3-dest')).toHaveText(DEST)
    await expect(g.getByTestId('autopublish-target-slack')).not.toBeChecked(); await expect(g.getByTestId('autopublish-target-slack')).toBeDisabled()
    await expect(g.getByTestId('autopublish-target-slack-reason')).toContainText('Slack is not connected')
    await g.getByTestId('autopublish-slack-connect').click(); await expect(page.getByTestId('connect-modal').getByTestId('slack-pane')).toBeVisible()
    await page.getByTestId('connect-modal').locator('.btn-close').click()
    await expect(g).toContainText('Tunnel (not available yet)'); await expect(g.getByTestId('autopublish-target-tunnel')).toBeDisabled(); await expect(g.getByTestId('autopublish-target-tunnel')).not.toBeChecked()
    await expect(g.getByTestId('autopublish-target-tunnel').locator('xpath=ancestor::label')).toHaveAttribute('title', 'Tunnel will be added when its delivery route is known')
    // no S3, no Slack: not allowed
    await g.getByTestId('autopublish-target-s3').uncheck()
    await page.getByTestId('volumes-save').click()
    await expect(d.getByTestId('autopublish-error')).toHaveText('At least one of S3 or Slack must be on.'); expect(api.state.mountPuts || []).toHaveLength(0)
  })
  test('with Slack connected it can be ticked and rides the Save; with S3 off it is disabled with "Slack announces an upload: turn S3 on"', async ({ page, api }) => {
    on(api); slackOn(api)
    const d = await openBlock(page)
    const g = d.getByTestId('autopublish-targets')
    await expect(g.getByTestId('autopublish-target-slack')).toBeEnabled(); await g.getByTestId('autopublish-target-slack').check()
    await g.getByTestId('autopublish-target-s3').uncheck()
    await expect(g.getByTestId('autopublish-target-slack')).toBeDisabled(); await expect(g.getByTestId('autopublish-target-slack-reason')).toHaveText('Slack announces an upload: turn S3 on')
    await g.getByTestId('autopublish-target-s3').check()
    await page.getByTestId('volumes-save').click(); await expect(page.getByTestId('volumes-saved')).toBeVisible()
    expect(api.state.mountPuts.at(-1).auto_publish.targets).toEqual({ s3: true, slack: true, tunnel: false })
  })
  test('Tunnel can never be on: a forced request is refused with the core\'s text', async ({ page, api }) => {
    on(api)
    await page.goto('/')
    const r = await page.evaluate(async () => { const x = await fetch('http://localhost:8000/api/autopublish/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targets: { tunnel: true } }) }); return { status: x.status, body: await x.json() } })
    expect(r.status).toBe(400); expect(r.body.detail).toContain('Tunnel is not available yet')
    expect(api.state.mounts.config.auto_publish.targets.tunnel).toBe(false)
  })
  test('an older core with the single slack boolean falls back to S3 (plus Slack when it was on)', async ({ page, api }) => {
    api.state.mounts.config.auto_publish = { enabled: false, dry_run: true, window_minutes: 10, daily_cap: 5, slack: false }
    const d = await openBlock(page)
    await expect(d.getByTestId('autopublish-switch')).not.toBeChecked()
    await d.getByTestId('autopublish-switch').click(); await prompt(page).getByTestId('name-prompt-input').fill('B'); await prompt(page).getByTestId('autopublish-understood').check(); await prompt(page).getByTestId('name-prompt-ok').click()
    await expect(d.getByTestId('autopublish-target-s3')).toBeChecked()
  })
})

test.describe('the header chip', () => {
  test('ONE clear state in the same words everywhere: OFF (grey), DRY RUN (amber), LIVE (green), with what it is doing in small text and the sentence as its tooltip; a click opens Queue > Publishing; no separate pill', async ({ page, api }) => {
    await page.goto('/')
    const chip = page.getByTestId('autopublish-chip')
    await expect(chip.getByTestId('autopublish-chip-label')).toHaveText('Auto-publish: OFF'); await expect(chip).toHaveClass(/text-bg-secondary/); await expect(chip).toHaveAttribute('data-mode', 'off')
    on(api, { targets: { s3: true, slack: true, tunnel: false } }); api.state.autopublish = { pending: [entry(), entry({ id: 'ap-2', shot: 'cgi-042' })] }
    await page.reload()
    await expect(chip.getByTestId('autopublish-chip-label')).toHaveText('Auto-publish: DRY RUN'); await expect(chip).toHaveAttribute('data-mode', 'dry'); await expect(chip).toHaveClass(/text-bg-warning/)
    await expect(chip.getByTestId('autopublish-chip-activity')).toContainText('2 waiting 9:'); await expect(chip).toHaveAttribute('title', /Dry run: nothing is sent/)
    api.state.mounts.config.auto_publish.dry_run = false
    await expect(chip.getByTestId('autopublish-chip-label')).toHaveText('Auto-publish: LIVE', { timeout: 12000 }); await expect(chip).toHaveClass(/text-bg-success/)
    await expect(chip).toHaveAttribute('title', 'Finished review videos are uploaded to S3 + Slack automatically, 10 minutes after they appear. Click to open the Queue.')
    await expect(page.getByTestId('autopublish-chip-off')).toHaveCount(0)
    await chip.click()
    await expect(page.getByTestId('queue-modal')).toBeVisible(); await expect(page.getByTestId('queue-tab-publishing')).toHaveAttribute('aria-selected', 'true'); await expect(page.getByTestId('queue-autopublish')).toBeVisible()
  })
  test('the Queue badge counts every pending entry: uploading, waiting and would-upload', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [entry(), entry({ id: 'ap-2', state: 'uploading' }), entry({ id: 'ap-3', state: 'would_upload' })] }
    await page.goto('/')
    await expect(page.getByTestId('queue-badge')).toHaveText('3'); await expect(page.getByTestId('queue-badge')).toHaveAttribute('title', '1 upload, 1 would upload (dry run), 1 waiting')
  })
})

test.describe('the Queue: Auto-publish', () => {
  async function openQueue(page) { await queueTab(page, 'publishing'); const q = page.getByTestId('queue-modal'); await expect(q.getByTestId('queue-autopublish')).toBeVisible(); return q.getByTestId('queue-autopublish') }
  test('a waiting entry shows its line and a live countdown, with Cancel and Publish now; other states read as their own', async ({ page, api }) => {
    on(api, { daily_cap: 5 }); api.state.autopublish = { pending: [entry(), entry({ id: 'ap-w', shot: 'cgi-042', version: 1, state: 'would_upload', targets: ['s3', 'slack'] }), entry({ id: 'ap-c', shot: 'cgi-043', state: 'capped' }), entry({ id: 'ap-f', shot: 'cgi-044', state: 'failed', reason: 'Access Denied' }), entry({ id: 'ap-u', shot: 'cgi-045', state: 'uploading' })],
      recent: [entry({ id: 'ap-d', shot: 'old-001', state: 'done', done_at: '2026-11-19T08:00:00Z' }), entry({ id: 'ap-x', shot: 'old-002', state: 'cancelled' })] }
    await page.goto('/')
    const q = await openQueue(page)
    const row = q.locator('[data-testid="autopublish-row"][data-id="ap-1"]')
    await expect(row.getByTestId('autopublish-row-line')).toHaveText(`archival-085 v002 · 3 files · ${formatBytes(2.1e9)}`)
    const first = await row.getByTestId('autopublish-row-state').innerText()
    expect(first).toMatch(/^waiting for the window · uploads in 9:(3\d|4\d)$/)
    await page.waitForTimeout(2200)
    const later = await row.getByTestId('autopublish-row-state').innerText(); expect(later).not.toBe(first)   // it moves each second
    const secs = (s) => { const [m, x] = s.replace('waiting for the window · uploads in ', '').split(':').map(Number); return m * 60 + x }
    expect(secs(later)).toBeLessThan(secs(first))
    await expect(row.getByTestId('autopublish-row-targets')).toHaveText('S3')
    const would = q.locator('[data-testid="autopublish-row"][data-id="ap-w"]')
    await expect(would).toHaveClass(/text-body-secondary/); await expect(would.getByTestId('autopublish-row-state')).toHaveText(''); await expect(would).not.toContainText('would upload (dry run)')   // the dry-run text is gone from the row (the Overview keeps the badge)
    await expect(q.locator('[data-testid="autopublish-row"][data-id="ap-c"] [data-testid="autopublish-row-state"]')).toHaveText('daily cap reached, tries tomorrow')
    await expect(q.locator('[data-testid="autopublish-row"][data-id="ap-f"] [data-testid="autopublish-row-state"]')).toHaveText('failed: Access Denied')
    await expect(q.locator('[data-testid="autopublish-row"][data-id="ap-u"] [data-testid="autopublish-row-state"]')).toContainText('uploading')
    await expect(q.locator('[data-testid="autopublish-row"][data-id="ap-u"] [data-testid="autopublish-cancel"]')).toHaveCount(0)   // it is on its way
    await q.getByTestId('autopublish-recent-toggle').click()   // Recent starts collapsed (its count is in the title)
    await expect(q.locator('[data-testid="autopublish-recent"][data-id="ap-d"] [data-testid="autopublish-recent-state"]')).toContainText('uploaded')
    await expect(q.locator('[data-testid="autopublish-recent"][data-id="ap-x"] [data-testid="autopublish-recent-state"]')).toHaveText('cancelled')
    await expect(q.getByTestId('autopublish-pane-mode')).toHaveText('dry run'); await expect(q.getByTestId('autopublish-pane-today')).toHaveText('Today: 0 of 5')
  })
  test('while an upload runs, its row says Publishing… (disabled) and every Publish Now is disabled; with none running they are enabled', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [entry(), entry({ id: 'ap-f', shot: 'cgi-044', state: 'failed' }), entry({ id: 'ap-u', shot: 'archival-090', state: 'uploading' })] }
    await page.goto('/')
    const q = await openQueue(page), row = (id) => q.locator(`[data-testid="autopublish-row"][data-id="${id}"]`)
    const running = row('ap-u').getByTestId('autopublish-publishing')
    await expect(running).toHaveText('Publishing…'); await expect(running).toBeDisabled()
    await expect(row('ap-u').getByTestId('autopublish-publish-now')).toHaveCount(0)
    for (const id of ['ap-1', 'ap-f']) { const b = row(id).getByTestId('autopublish-publish-now'); await expect(b).toHaveText('Publish Now'); await expect(b).toBeDisabled() }
    api.state.autopublish = { pending: [entry(), entry({ id: 'ap-f', shot: 'cgi-044', state: 'failed' })] }
    for (const id of ['ap-1', 'ap-f']) await expect(row(id).getByTestId('autopublish-publish-now')).toBeEnabled({ timeout: 8000 })
  })
  test('Cancel removes the entry (request body {id}); Publish now asks for a name and sends {id, approved_by}', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [entry(), entry({ id: 'ap-2', shot: 'cgi-042' })] }
    await page.goto('/')
    const q = await openQueue(page)
    await expect(q.locator('[data-testid="autopublish-row"][data-id="ap-1"] [data-testid="autopublish-cancel"]')).toHaveText('Cancel')   // a waiting entry is still cancelled
    await q.locator('[data-testid="autopublish-row"][data-id="ap-1"] [data-testid="autopublish-cancel"]').click()
    await expect.poll(() => calls(api, 'cancel').map((c) => c.body)).toEqual([{ id: 'ap-1' }])
    await expect(q.locator('[data-testid="autopublish-row"][data-id="ap-1"]')).toHaveCount(0, { timeout: 6000 })
    await q.locator('[data-testid="autopublish-row"][data-id="ap-2"] [data-testid="autopublish-publish-now"]').click()
    const p = prompt(page)
    await expect(p.getByTestId('name-prompt-ok')).toBeDisabled()
    await p.getByTestId('name-prompt-input').fill('Brynley'); await p.getByTestId('name-prompt-ok').click(); await expect(p).toBeHidden()
    expect(calls(api, 'publishNow').at(-1).body).toEqual({ id: 'ap-2', approved_by: 'Brynley' })
    await expect(q.locator('[data-testid="autopublish-row"][data-id="ap-2"] [data-testid="autopublish-row-state"]')).toContainText('uploading', { timeout: 6000 })
  })
  test('a dry-run row has Deliver next to Cancel: the confirm shows what is delivered and where, then {id, approved_by} is sent and the row uploads', async ({ page, api }) => {
    on(api, { daily_cap: 5 }); api.state.autopublish = { today: { count: 2, left: 3 }, pending: [entry({ id: 'ap-w', shot: 'cgi-042', version: 1, state: 'would_upload', targets: ['s3', 'slack'], dry_run_plan: { bucket: 'bh-panama-exchange-610140802195', prefix: 'returns/BKK/', round: 'tunnel-v11-edl-2026-11-18', total_files: 3, total_bytes: 3e8, files: [] } }), entry({ id: 'ap-x', shot: 'cgi-043', version: 1, state: 'would_upload' })] }
    await page.goto('/')
    const q = await openQueue(page), row = (id) => q.locator(`[data-testid="autopublish-row"][data-id="${id}"]`)
    const real = row('ap-w').getByTestId('autopublish-deliver')
    await expect(real).toHaveText('Deliver'); await expect(real).toBeEnabled(); await expect(row('ap-w').getByTestId('autopublish-cancel')).toHaveText('Remove')   // a dry-run entry is removed, not cancelled (Lucas: cancel when done can be swapped for remove)
    await expect(row('ap-w').getByTestId('autopublish-publish-now')).toHaveCount(0)
    await real.click()
    const p = prompt(page)
    await expect(p).toContainText('cgi-042'); await expect(p).toContainText('tunnel-v11-edl-2026-11-18'); await expect(p).toContainText('S3 + Slack'); await expect(p).toContainText('Daily cap left today: 3')
    await expect(p.getByTestId('name-prompt-input')).toHaveValue('Brynley')   // the standing approval's person is offered
    await expect(p).toContainText('the delivery round tunnel-v11-edl-2026-11-18'); await expect(p).toContainText('It goes out for real')
    await p.getByTestId('name-prompt-input').fill('Lucas'); await p.getByTestId('name-prompt-ok').click(); await expect(p).toBeHidden()
    expect(calls(api, 'publishNow').at(-1).body).toEqual({ id: 'ap-w', approved_by: 'Lucas' })
    await expect(row('ap-w').getByTestId('autopublish-row-state')).toContainText('uploading', { timeout: 6000 })
    await expect(row('ap-w').getByTestId('autopublish-deliver')).toHaveCount(0)   // it is not offered twice
    await expect(row('ap-x').getByTestId('autopublish-deliver')).toBeDisabled()   // one upload at a time: the other waits until this one is done
  })
  test('Deliver needs a name: with none remembered or offered the confirm button stays off until one is typed', async ({ page, api }) => {
    on(api, { standing: null }); api.state.autopublish = { today: { count: 0, left: null }, pending: [entry({ id: 'ap-w', shot: 'cgi-042', version: 1, state: 'would_upload' })] }
    await page.goto('/')
    const q = await openQueue(page); await q.locator('[data-testid="autopublish-row"][data-id="ap-w"]').getByTestId('autopublish-deliver').click()
    const p = prompt(page); await expect(p.getByTestId('name-prompt-input')).toHaveValue(''); await expect(p.getByTestId('name-prompt-ok')).toBeDisabled(); await expect(p.getByTestId('name-prompt-ok')).toHaveText('Deliver'); await expect(p).toContainText('Daily cap left today: no cap')
    await p.getByTestId('name-prompt-input').fill('Lucas'); await expect(p.getByTestId('name-prompt-ok')).toBeEnabled()
  })
  test('Deliver is off, with the reason as its tooltip, when the daily cap is spent', async ({ page, api }) => {
    on(api, { daily_cap: 5 }); api.state.autopublish = { today: { count: 5, left: 0 }, pending: [entry({ id: 'ap-w', shot: 'cgi-042', version: 1, state: 'would_upload', dry_run_plan: { bucket: 'b', prefix: 'returns/BKK/', round: 'r1', total_files: 3, total_bytes: 3e8, files: [] } })] }
    await page.goto('/')
    const q = await openQueue(page), real = q.locator('[data-testid="autopublish-row"][data-id="ap-w"]').getByTestId('autopublish-deliver')
    await expect(real).toBeDisabled(); await expect(real).toHaveAttribute('title', /daily cap is spent \(5 a day\)/)
    await expect(q.getByTestId('autopublish-dryrun-deliver-all')).toBeDisabled()
  })
  test('Deliver is off for a row the scope or the dpx fix holds, showing that reason', async ({ page, api }) => {
    on(api); api.state.autopublish = { pending: [entry({ id: 'ap-h', shot: 'cgi-042', version: 1, state: 'would_upload', reason: 'held back: dpx fix: frame count 60 of 70' })] }
    await page.goto('/')
    const q = await openQueue(page), real = q.locator('[data-testid="autopublish-row"][data-id="ap-h"]').getByTestId('autopublish-deliver')
    await expect(real).toBeDisabled(); await expect(real).toHaveAttribute('title', 'held back: dpx fix: frame count 60 of 70')
  })
  test('Deliver All: one confirmation with the count and size, then every dry-run entry goes; the daily cap stops it and the refused ones are listed', async ({ page, api }) => {
    on(api, { daily_cap: 5 }); api.state.autopublish = { today: { count: 3, left: 2 }, allowOnly: 2, pending: [entry({ id: 'ap-a', shot: 'cgi-041', version: 1, state: 'would_upload', dry_run_plan: { bucket: 'b', prefix: 'returns/BKK/', round: 'r1', total_files: 3, total_bytes: 3e8, files: [] } }), entry({ id: 'ap-b', shot: 'cgi-042', version: 1, state: 'would_upload', dry_run_plan: { bucket: 'b', prefix: 'returns/BKK/', round: 'r1', total_files: 3, total_bytes: 3e8, files: [] } }), entry({ id: 'ap-c', shot: 'cgi-043', version: 1, state: 'would_upload', dry_run_plan: { bucket: 'b', prefix: 'returns/BKK/', round: 'r1', total_files: 3, total_bytes: 3e8, files: [] } })] }
    await page.goto('/')
    const q = await openQueue(page), all = q.getByTestId('autopublish-dryrun-deliver-all')
    await expect(all).toHaveText('Deliver All'); await expect(all).toBeEnabled()
    await all.click()
    const p = prompt(page)
    await expect(p).toContainText('3 dry-run review(s)'); await expect(p).toContainText('Daily cap left today: 2')
    await p.getByTestId('name-prompt-input').fill('Lucas'); await p.getByTestId('name-prompt-ok').click(); await expect(p).toBeHidden()
    expect(calls(api, 'publishAllDry').at(-1).body).toEqual({ approved_by: 'Lucas' })
    await expect(q.getByTestId('autopublish-dryrun-error')).toContainText('cgi-043'); await expect(q.getByTestId('autopublish-dryrun-error')).toContainText('daily cap is spent')
  })
  test('Purge Dry Runs: the button is in Pending Uploads, a plan then one confirmation names the count and that nothing is deleted, Cancel keeps the list, OK clears only the dry-run entries and keeps a real one', async ({ page, api }) => {
    on(api)
    api.state.autopublish = { watching: { root: '/o', root_exists: true, shots: 3, reviews: 3, approved: 3, eligible: 0, queued: 3, uploaded_today: 0, skipped: [], summary: 'Watching /o' }, pending: [entry({ id: 'ap-a', shot: 'cgi-041', version: 1, state: 'would_upload' }), entry({ id: 'ap-b', shot: 'cgi-042', version: 1, state: 'would_upload' }), entry({ id: 'ap-c', shot: 'cgi-043', version: 1, state: 'waiting' })] }
    await page.goto('/')
    const q = await openQueue(page), btn = q.getByTestId('autopublish-purge')
    await expect(btn).toHaveText('Purge Dry Runs'); await expect(q.getByTestId('autopublish-pending-title')).toHaveText('Pending Uploads (3)')
    await btn.click()
    const cancelMsg = await answerConfirm(page, false)   // Cancel: the list stays
    expect(cancelMsg).toContain('Purge 2 dry-run entries'); expect(cancelMsg).toContain('Nothing is deleted from the volume, this PC or the bucket')
    expect(calls(api, 'purgeDryRuns').map((c) => c.body)).toEqual([{}])   // only the plan was asked
    await expect(q.getByTestId('autopublish-row')).toHaveCount(3)
    await btn.click(); await answerConfirm(page, true)
    await expect.poll(() => calls(api, 'purgeDryRuns').length).toBe(3)
    expect(calls(api, 'purgeDryRuns').at(-1).body).toEqual({ approved_by: 'Brynley', understood: true })
    await expect(q.getByTestId('autopublish-row')).toHaveCount(1); await expect(q.getByTestId('autopublish-row').first()).toHaveAttribute('data-id', 'ap-c')   // the real (waiting) entry stays
    await expect(btn).toHaveCount(0); await expect(q.getByTestId('autopublish-restore')).toHaveText('Restore Dismissed (2)')
    await q.getByTestId('autopublish-restore').click(); await expect.poll(() => calls(api, 'restoreDryRuns').length).toBe(1)
    await expect(q.getByTestId('autopublish-restore')).toHaveCount(0)
  })
  test('the section is absent when the core has no Auto-publish; a configuration with it OFF shows an empty state', async ({ page, api }) => {
    await page.goto('/')
    const q = await openQueue(page)
    await expect(q.getByTestId('autopublish-none')).toHaveText('Nothing waiting and nothing sent yet.')
    await page.keyboard.press('Escape')
    api.state.noAutoPublish = true
    await page.reload(); await queueTab(page, 'publishing')
    await expect(page.getByTestId('queue-modal')).toBeVisible(); await expect(page.getByTestId('queue-autopublish')).toHaveCount(0)
  })
})

test.describe('Mark approved', () => {
  const DPX = (n) => ({ filename: `ARCHIVAL-085_MAIN.${String(n).padStart(4, '0')}.dpx`, subfolder: 'seqs/a', type: 'output' })
  const seed = (api) => {
    api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'mk000000-1111', workflow: 'x.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 1, cost_estimate: 0, outputs: [DPX(0), DPX(1)] })
    api.state.renders = { deliverables: [{ shot: 'archival-085', version: 3, file: 'output/deliver/archival-085/v003/ARCHIVAL-085_MAIN.mov', exists_local: true, files: [{ name: 'ARCHIVAL-085_MAIN.mov', codec: 'prores422hq' }] }] }
    api.state.autopublish = { reviews: [REVIEW()] }
  }
  const tile = (page) => page.getByTestId('pod-outputs-modal').locator('[data-testid="outputs-tile"][data-kind="dpx"]')
  test('on the Review badge of a tile: Mark approved asks a name, sends {shot, version, approved_by}, then shows Approved by <name> with Revoke (confirm) that sends {shot, version}', async ({ page, api }) => {
    seed(api)
    await page.addInitScript(() => { if (!sessionStorage.getItem('c')) { localStorage.removeItem('runpod-manager.approved-by'); sessionStorage.setItem('c', '1') } })
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
    await expect(tile(page).getByTestId('outputs-dpx-review')).toHaveText('Review v003')
    await tile(page).getByTestId('autopublish-approve').click()
    const p = prompt(page)
    await expect(p.getByTestId('name-prompt-message')).toHaveText('archival-085 v003: a person says this review version is approved.')
    await expect(p.getByTestId('name-prompt-ok')).toBeDisabled()
    await p.getByTestId('name-prompt-input').fill('Brynley'); await p.getByTestId('name-prompt-ok').click(); await expect(p).toBeHidden()
    expect(calls(api, 'approve').at(-1).body).toEqual({ shot: 'archival-085', version: 3, approved_by: 'Brynley' })
    await expect(tile(page).getByTestId('autopublish-approved')).toHaveText('Approved by Brynley'); await expect(tile(page).getByTestId('autopublish-approve')).toHaveCount(0)
    expect(await tile(page).getByTestId('outputs-dpx-review').count()).toBe(1)   // the tile itself did not open
    await expect(page.getByTestId('dpx-viewer')).toHaveCount(0)
    await tile(page).getByTestId('autopublish-revoke').click()
    expect(await answerConfirm(page, false)).toContain('Remove the approval of archival-085 v003?'); expect(calls(api, 'revoke')).toHaveLength(0)
    await tile(page).getByTestId('autopublish-revoke').click(); await answerConfirm(page, true)
    expect(calls(api, 'revoke').at(-1).body).toEqual({ shot: 'archival-085', version: 3 })
    await expect(tile(page).getByTestId('autopublish-approve')).toBeVisible()
  })
  test('a core 400 or 404 shows in the name prompt and keeps it open; the name is remembered for the next time', async ({ page, api }) => {
    seed(api); api.state.autopublish.reviews = [REVIEW({ version: 4 })]   // the tile's version 3 does not exist for the core
    api.state.renders.deliverables[0].version = 4
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
    await tile(page).getByTestId('autopublish-approve').click()
    await prompt(page).getByTestId('name-prompt-input').fill('Brynley'); await prompt(page).getByTestId('name-prompt-ok').click(); await expect(prompt(page)).toBeHidden()
    await tile(page).getByTestId('autopublish-revoke').click(); await answerConfirm(page, true)
    await tile(page).getByTestId('autopublish-approve').click()
    await expect(prompt(page).getByTestId('name-prompt-input')).toHaveValue('Brynley')   // remembered
  })
  test('in the Publish window a review version folder under deliver/ has the same control', async ({ page, api }) => {
    api.state.autopublish = { reviews: [REVIEW()] }
    api.state.publish = { tree: { '': [{ name: 'deliver', path: 'deliver', dir: true }], deliver: [{ name: 'archival-085', path: 'deliver/archival-085', dir: true }], 'deliver/archival-085': [{ name: 'v003', path: 'deliver/archival-085/v003', dir: true }, { name: 'v004', path: 'deliver/archival-085/v004', dir: true }] } }
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); await page.getByTestId('pod-outputs-publish').click()
    const m = page.getByTestId('publish-modal')
    await m.getByTestId('publish-source-local').click()
    await m.getByTestId('publish-quick-deliver').click()
    await m.locator('[data-testid="publish-entry"][data-path="deliver/archival-085"] [data-testid="publish-entry-open"]').click()
    await expect(m.locator('[data-testid="publish-entry"][data-path="deliver/archival-085/v003"] [data-testid="autopublish-approve"]')).toBeVisible()
    await expect(m.locator('[data-testid="publish-entry"][data-path="deliver/archival-085/v004"] [data-testid="autopublish-control"]')).toHaveCount(0)   // the core knows no v004
    await m.locator('[data-testid="publish-entry"][data-path="deliver/archival-085/v003"] [data-testid="autopublish-approve"]').click()
    await prompt(page).getByTestId('name-prompt-input').fill('Kyle'); await prompt(page).getByTestId('name-prompt-ok').click()
    expect(calls(api, 'approve').at(-1).body).toEqual({ shot: 'archival-085', version: 3, approved_by: 'Kyle' })
    await expect(m.locator('[data-testid="publish-entry"][data-path="deliver/archival-085/v003"] [data-testid="autopublish-approved"]')).toHaveText('Approved by Kyle')
  })
  test('on the Queue\'s render card of a finished review job', async ({ page, api }) => {
    api.state.autopublish = { reviews: [REVIEW({ shot: 'cgi-042', version: 1 })] }
    api.state.renders = { jobs: [{ job_id: 'job-r', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', kind: 'review', state: 'done', started_at: '2026-11-19T10:00:00Z', finished_at: 'now', frames_done: 5, frames_total: 5, rate_fps: 0, current: '', pulled_files: 1, pulled_bytes: 1, error: '', summary: 'done',
      sequences: [{ dir: 'seqs/a', name: 'ARCH', shot: 'cgi-042', version: 1, where: 'pod', state: 'pulled', frames_done: 5, frames_total: 5 }, { dir: 'seqs/b', name: 'ARCH2', shot: 'cgi-042', version: 1, where: 'pod', state: 'pulled', frames_done: 5, frames_total: 5 }] }, { job_id: 'job-p', pod_id: 'pod-aaaaaaaa', kind: 'proxy', state: 'done', started_at: '2026-11-19T09:00:00Z', sequences: [] }] }
    await page.goto('/'); await queueTab(page, 'generations')
    const card = page.locator('[data-testid="generations-job"][data-job="job-r"]')
    await expect(card.getByTestId('autopublish-control')).toHaveCount(1)   // once per shot version
    await card.getByTestId('autopublish-approve').click()
    await prompt(page).getByTestId('name-prompt-input').fill('Brynley'); await prompt(page).getByTestId('name-prompt-ok').click()
    expect(calls(api, 'approve').at(-1).body).toEqual({ shot: 'cgi-042', version: 1, approved_by: 'Brynley' })
    await expect(card.getByTestId('autopublish-approved')).toHaveText('Approved by Brynley')
    await expect(page.locator('[data-testid="generations-job"][data-job="job-p"]').getByTestId('autopublish-control')).toHaveCount(0)   // a proxy is never approved
  })
  test('an older core hides every control and every Auto-publish surface, and no secret is on the page', async ({ page, api }) => {
    seed(api); api.state.noAutoPublish = true; slackOn(api)
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
    await expect(tile(page).getByTestId('outputs-dpx-review')).toBeVisible()
    await expect(page.getByTestId('autopublish-control')).toHaveCount(0); await expect(page.getByTestId('autopublish-chip')).toHaveCount(0)
    await page.getByTestId('pod-outputs-modal').locator('.btn-close').click()
    const d = await openAutopublish(page, { fresh: false })
    await expect(d.getByTestId('bh-publishing')).toBeVisible(); await expect(d.getByTestId('settings-autopublish')).toHaveCount(0); await expect(d.getByTestId('bh-autopublish-options')).toHaveCount(0)
    expect(await page.content()).not.toContain('hooks.slack.com/services')
  })
})

test.describe('the configuration window', () => {
  test('a pod\'s own configuration has no Auto-publish block (it is app-wide)', async ({ page }) => {
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click()
    const d = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' }))
    await expect(d).toBeVisible(); await expect(d.getByTestId('settings-autopublish')).toHaveCount(0)
  })
  test('Export says it carries the Auto-publish settings and importing never turns it on; the import plan row says OFF; applying it keeps it off with no standing approval', async ({ page, api }) => {
    on(api, { targets: { s3: true, slack: false, tunnel: false } })
    await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title'))
    await expect(d.getByTestId('cfg-io-autopublish-export-note')).toHaveText('Auto-publish settings are exported; importing never turns it on.')
    const file = { format: 'runpod-pod-manager-config', version: 1, exported_at: '2026-11-19T10:00:00Z', app_version: '1.6.2', config: { auto_publish: { enabled: true, dry_run: false, window_minutes: 30, daily_cap: 8, targets: { s3: true, slack: true, tunnel: true }, standing: { approved_by: 'X', at: 'y' } } } }
    await d.getByTestId('cfg-io-file').setInputFiles({ name: 'cfg.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
    await expect(d.getByTestId('cfg-io-row-auto_publish')).toBeVisible()
    await expect(d.getByTestId('cfg-io-autopublish-row-note')).toHaveText('Will be imported turned OFF (the standing approval is never imported)')
    await d.getByTestId('cfg-io-apply').click()
    await expect.poll(() => api.state.mounts.config.auto_publish.enabled).toBe(false)
    expect(api.state.mounts.config.auto_publish).toMatchObject({ dry_run: true, window_minutes: 30, daily_cap: 8, targets: { tunnel: false } }); expect(api.state.mounts.config.auto_publish.standing).toBeUndefined()
  })
  test('clearing the saved configuration while Auto-publish is ON says it turns it off, and asks first; with it off there is no extra question', async ({ page, api }) => {
    on(api); api.state.mounts.stored = true
    const d = await (async () => { await page.goto('/'); await page.getByTestId('open-config').click(); return modal(page, t('config.title')) })()
    await d.getByTestId('config-clear').click()
    expect(await answerConfirm(page, false)).toBe('Clear the saved configuration? This also turns Auto-publish off.')
  })
})
