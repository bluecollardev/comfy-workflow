import { test, expect, podCard, modal, cfgTab, answerConfirm } from './fixtures'
import { formatBytes } from '../src/sync-progress'
import { makeDpx } from '../src/utils/dpx-fixture.mjs'
import { t } from './i18n'

// Publishing to S3 and Slack: the app-wide settings (Default Configuration > Publishing), the Publish window, and the Render option. The core is faked (state.publish, state.renders in e2e/fixtures.js).
const GB = 1e9
const calls = (api, method, path) => api.calls.filter((c) => c.method === method && c.path === path)
const px = makeDpx({ width: 16, height: 8, bits: 16, fn: (x, y, c) => (c === 0 ? 20000 + x * 500 : 30000 + y * 1000) })
const CONFIGURED = { s3: { bucket: 'beinghuman-deliveries', prefix: 'imax/restoration', region: 'eu-west-1', endpoint: '', credentials: 'app', access_key_hint: '••••1234', presign_hours: 72 }, slack: { workspace_name: 'Beinghuman', workspace_url: 'https://beinghuman-hq.slack.com', channel: '#deliveries', username: 'RunPod Manager', webhook_hint: '••••9f2k' }, defaults: { targets: ['s3', 'slack'], message: '{shot} {version} is on S3: {links}' } }
const TREE = {
  '': [{ name: 'deliver', path: 'deliver', dir: true }, { name: '.proxies', path: '.proxies', dir: true }, { name: 'cgi-042', path: 'cgi-042', dir: true }, { name: 'notes.txt', path: 'notes.txt', dir: false, bytes: 1200 }],
  deliver: [{ name: 'archival-085', path: 'deliver/archival-085', dir: true }],
  'deliver/archival-085': [{ name: 'v003', path: 'deliver/archival-085/v003', dir: true }],
  'deliver/archival-085/v003': [{ name: 'a.mp4', path: 'deliver/archival-085/v003/a.mp4', dir: false, bytes: 2 * GB }, { name: 'a.mov', path: 'deliver/archival-085/v003/a.mov', dir: false, bytes: 9 * GB }, { name: 'a.meta.json', path: 'deliver/archival-085/v003/a.meta.json', dir: false, bytes: 900 }],
  '.proxies': [{ name: 'p.mp4', path: '.proxies/p.mp4', dir: false, bytes: 1 * GB }],
  'cgi-042': [{ name: 'weights.safetensors', path: 'cgi-042/weights.safetensors', dir: false, bytes: 7 * GB, weight: true }, { name: 'frame.png', path: 'cgi-042/frame.png', dir: false, bytes: 3000 }],
}
const setup = (api, o = {}) => { api.state.publish = { settings: JSON.parse(JSON.stringify(CONFIGURED)), tree: JSON.parse(JSON.stringify(TREE)), there: [], heavy: ['cgi-042/weights.safetensors'], ...o } }
const openModal = async (page) => { await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); await page.getByTestId('pod-outputs-publish').click(); const m = page.getByTestId('publish-modal'); await expect(m).toBeVisible(); await m.getByTestId('publish-source-local').click(); await expect(m.getByTestId('publish-entry').first()).toBeVisible(); return m }   // the Source opens on the Volume (default); most tests work with the Local PC tree, so they switch to it
const tick = (m, p) => m.locator(`[data-testid="publish-entry-check"][data-path="${p}"]`)
const openSettings = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'publishing'); return d }

const openConnectSlack = async (page) => { await page.goto('/'); await page.getByTestId('open-connect').click(); const d = modal(page, t('connect.title')); await d.getByRole('tab', { name: t('connect.slack') }).click(); await expect(d.getByTestId('slack-pane')).toBeVisible(); return d }

test.describe('Settings > Publishing', () => {
  test('the S3 block opens with the Panama exchange bucket, returns/BKK/ and the Panama credentials already set, with the core\'s note', async ({ page, api }) => {
    const d = await openSettings(page)
    const s = d.getByTestId('settings-publishing')
    await expect(s.getByTestId('publish-settings-note')).toHaveText('Nothing is configured until you enter it. Publishing always asks who says yes.')
    await expect(s.getByTestId('publish-s3-bucket')).toHaveValue('bh-panama-exchange-610140802195'); await expect(s.getByTestId('publish-s3-prefix')).toHaveValue('returns/BKK/'); await expect(s.getByTestId('publish-s3-region')).toHaveValue('us-west-2')
    await expect(s.getByTestId('publish-s3-preview')).toHaveText('Files go to s3://bh-panama-exchange-610140802195/returns/BKK/')
    await expect(s.getByTestId('publish-s3-cred-panama')).toBeChecked(); await expect(s.getByTestId('publish-s3-access-key')).toHaveCount(0)
    await expect(s.getByTestId('publish-s3-note')).toHaveText('Lucas, 2026-11-19: Panama exchange bucket, returns/BKK/')
    await expect(s.getByTestId('publish-s3-ready')).toHaveText('ready')
    await expect(s.getByTestId('publish-default-s3')).toBeChecked(); await expect(s.getByTestId('publish-default-message')).toHaveValue('{shot} {version} is on S3: {links}')
    await expect(s.getByTestId('publish-placeholders')).toContainText('{shot} {version} {files} {size} {links} {dest} {who} {channel}')
    await expect(d.getByText('Check the bucket with Kyle')).toHaveCount(0)
  })
  const footerSave = async (d) => { await d.getByTestId('config-save').click(); await expect(d).toBeHidden() }
  const reopen = async (page) => { await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'publishing'); return d }
  test('there is no Save of its own: the window\'s Save writes the configuration and then the publishing edits, and only changed secrets are sent', async ({ page, api }) => {
    let d = await openSettings(page)
    let s = d.getByTestId('settings-publishing')
    await expect(s.getByTestId('publish-settings-save')).toHaveCount(0)
    await expect(d.getByTestId('config-unsaved')).toHaveCount(0)
    await s.getByTestId('publish-s3-cred-app').check()
    await s.getByTestId('publish-s3-bucket').fill('beinghuman-deliveries'); await s.getByTestId('publish-s3-prefix').fill('/imax/restoration/')
    await expect(s.getByTestId('publish-s3-preview')).toHaveText('Files go to s3://beinghuman-deliveries/imax/restoration/')
    await s.getByTestId('publish-s3-access-key').fill('AKIAEXAMPLE1234'); await s.getByTestId('publish-s3-secret-key').fill('secretsecretsecret')
    await expect(d.getByTestId('config-unsaved')).toHaveText('Unsaved publishing changes')
    expect(calls(api, 'PUT', '/publish/settings')).toHaveLength(0)   // nothing is written until Save
    await footerSave(d)
    expect(calls(api, 'PUT', '/mounts')).toHaveLength(1)
    const put = calls(api, 'PUT', '/publish/settings')[0].body
    expect(put.s3).toMatchObject({ bucket: 'beinghuman-deliveries', access_key_id: 'AKIAEXAMPLE1234', secret_access_key: 'secretsecretsecret', credentials: 'app', presign_hours: 72 }); expect(put).not.toHaveProperty('slack')
    d = await reopen(page); s = d.getByTestId('settings-publishing')
    await expect(s.getByTestId('publish-s3-bucket')).toHaveValue('beinghuman-deliveries'); await expect(s.getByTestId('publish-s3-access-key')).toHaveValue(''); await expect(s.getByTestId('publish-s3-access-key')).toHaveAttribute('placeholder', 'saved ••••1234')   // never shown again
    await expect(s.getByTestId('publish-s3-ready')).toHaveText('ready'); await expect(d.getByTestId('config-unsaved')).toHaveCount(0)
    await s.getByTestId('publish-s3-region').fill('eu-west-1')
    await footerSave(d)
    const second = calls(api, 'PUT', '/publish/settings')[1].body
    expect(second.s3.region).toBe('eu-west-1'); expect(second.s3).not.toHaveProperty('access_key_id'); expect(second.s3).not.toHaveProperty('secret_access_key')   // an empty secret keeps the stored one
    expect(api.state.publish.settings.s3.access_key_hint).toBe('••••1234')
  })
  test('an untouched Publishing section is not written when the window is saved', async ({ page, api }) => {
    const d = await openSettings(page)
    await d.getByTestId('cfg-tab-runpod').click().catch(() => {})
    await footerSave(d)
    expect(calls(api, 'PUT', '/publish/settings')).toHaveLength(0)
  })
  test('Clear keys is an action of its own (it writes now, after a confirm)', async ({ page, api }) => {
    setup(api)
    const d = await openSettings(page)
    const s = d.getByTestId('settings-publishing')
    await s.getByTestId('publish-s3-clear').click(); await answerConfirm(page, true)
    await expect.poll(() => api.state.publish.settings.s3.access_key_hint).toBe('')
    expect(calls(api, 'PUT', '/publish/settings').at(-1).body.clear).toEqual(['s3_keys'])
    await expect(s.getByTestId('publish-s3-ready')).toHaveText('not ready'); await expect(d.getByTestId('config-unsaved')).toHaveCount(0)
  })
  test('a failure from the core names the field, keeps the window open and says the configuration was saved but publishing was not', async ({ page, api }) => {
    const d = await openSettings(page)
    const s = d.getByTestId('settings-publishing')
    await s.getByTestId('publish-s3-bucket').fill('Bad_Bucket')
    await d.getByTestId('config-save').click()
    await expect(d.getByTestId('config-error')).toContainText('The configuration was saved; publishing settings were not: a bucket name is 3 to 63 lowercase letters, digits, dots or dashes')
    await expect(s.locator('[data-testid="publish-field-error"][data-field="s3.bucket"]')).toHaveText('a bucket name is 3 to 63 lowercase letters, digits, dots or dashes')
    await expect(d).toBeVisible(); expect(calls(api, 'PUT', '/mounts')).toHaveLength(1)
    await s.getByTestId('publish-s3-bucket').fill('good-bucket')
    await footerSave(d)
    expect(calls(api, 'PUT', '/publish/settings').at(-1).body.s3.bucket).toBe('good-bucket')
  })
  test('the defaults (targets, message) save with the window; an unknown placeholder is flagged', async ({ page, api }) => {
    const d = await openSettings(page)
    const s = d.getByTestId('settings-publishing')
    await s.getByTestId('publish-default-slack').uncheck(); await s.getByTestId('publish-default-message').fill('{shot} {nope}')
    await expect(s.getByTestId('publish-unknown-placeholder')).toHaveText('Not a known placeholder: {nope}')
    await s.getByTestId('publish-default-message').fill('{shot} done {links}')
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/publish/settings').at(-1).body.defaults).toEqual({ targets: ['s3'], message: '{shot} done {links}' })
  })
  test('closing with unsaved publishing edits asks first; No keeps the window and the edits, Yes closes', async ({ page, api }) => {
    const d = await openSettings(page)
    await d.getByTestId('publish-s3-prefix').fill('elsewhere/')
    await d.getByTestId('config-close').click()
    expect(await answerConfirm(page, false)).toBe('Close without saving the publishing changes?')
    await expect(d).toBeVisible(); await expect(d.getByTestId('publish-s3-prefix')).toHaveValue('elsewhere/')
    await d.locator('.btn-close').click()   // the X asks too
    await answerConfirm(page, false); await expect(d).toBeVisible()
    await d.getByTestId('config-close').click(); await answerConfirm(page, true)
    await expect(d).toBeHidden(); expect(calls(api, 'PUT', '/publish/settings')).toHaveLength(0)
    await page.getByTestId('open-config').click(); const d2 = modal(page, t('config.title')); await cfgTab(d2, 'publishing'); await expect(d2.getByTestId('publish-s3-prefix')).toHaveValue('returns/BKK/')   // the edit was dropped
  })
  test('closing without publishing edits does not ask', async ({ page }) => {
    const d = await openSettings(page)
    await d.getByTestId('config-close').click()
    await expect(d).toBeHidden()
  })
  test('the Test button waits for Save while the section has edits (it tests the saved settings)', async ({ page, api }) => {
    setup(api)
    const d = await openSettings(page)
    const s = d.getByTestId('settings-publishing')
    await expect(s.getByTestId('publish-s3-test')).toBeEnabled(); await expect(s.getByTestId('publish-save-first')).toHaveCount(0)
    await s.getByTestId('publish-s3-prefix').fill('x/')
    await expect(s.getByTestId('publish-s3-test')).toBeDisabled(); await expect(s.getByTestId('publish-save-first')).toHaveText('Save first')
    await s.getByTestId('publish-s3-prefix').fill('imax/restoration')   // back to what is saved: clean again
    await expect(s.getByTestId('publish-s3-test')).toBeEnabled()
  })
  test('the Panama keys missing: the problem shows with a button to the Panama settings', async ({ page, api }) => {
    setup(api, { panamaKeys: false }); api.state.publish.settings.s3 = { ...api.state.publish.settings.s3, bucket: 'bh-panama-exchange-610140802195', prefix: 'returns/BKK/', credentials: 'panama', access_key_hint: '' }
    const d = await openSettings(page)
    const s = d.getByTestId('settings-publishing')
    await expect(s.getByTestId('publish-s3-ready')).toHaveText('not ready'); await expect(s.getByTestId('publish-s3-problem')).toHaveText('The Panama exchange keys are not set')
    await s.getByTestId('publish-s3-open-panama').click()
    await expect(d.getByTestId('cfg-panama-title')).toBeVisible()
  })
  test('Check the bucket is read only and shows the answer', async ({ page, api }) => {
    const d = await openSettings(page)
    const s = d.getByTestId('settings-publishing')
    await s.getByTestId('publish-s3-test').click()
    await expect(s.getByTestId('publish-s3-test-result')).toHaveText('The bucket answered: 3 objects listed')
    expect(api.state.publish.tests).toEqual([{ target: 's3' }])
    api.state.publish.testResult = { s3: { ok: false, detail: 'Access Denied' } }
    await s.getByTestId('publish-s3-test').click()
    await expect(s.getByTestId('publish-s3-test-result')).toHaveText('Access Denied')
  })
  test('Slack is one read-only status line here, with a button to Connect > Slack', async ({ page, api }) => {
    setup(api); api.state.publish.settings.slack.webhook_hint = ''
    const d = await openSettings(page)
    await expect(d.getByTestId('publish-slack-status-text')).toHaveText('Slack: not connected')
    await expect(d.getByTestId('settings-publishing').getByTestId('publish-slack-webhook')).toHaveCount(0)   // no Slack fields in Settings
    await d.getByTestId('publish-slack-open-connect').click()
    const c = modal(page, t('connect.title'))
    await expect(c.getByTestId('slack-pane')).toBeVisible(); await expect(c.getByTestId('connect-tab-slack')).toBeVisible()
  })
  test('a connected Slack shows the workspace and channel in the status line', async ({ page, api }) => {
    setup(api)
    const d = await openSettings(page)
    await expect(d.getByTestId('publish-slack-status-text')).toHaveText('Slack: connected to Beinghuman, #deliveries')
  })
  test('an older core says to restart and hides the Publish button', async ({ page, api }) => {
    api.state.publishOld = true
    const d = await openSettings(page)
    await expect(d.getByTestId('publish-settings-restart')).toHaveText('Restart the app to use Publishing')
    await page.keyboard.press('Escape')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
    await expect(page.getByTestId('pod-outputs-modal')).toBeVisible()
    await expect(page.getByTestId('pod-outputs-publish')).toHaveCount(0)
  })
})

test.describe('Connect > Slack', () => {
  test('the Beinghuman workspace is baked in, the webhook is masked and write-only, the help text is there, and the Connect intro mentions Slack', async ({ page, api }) => {
    const d = await openConnectSlack(page)
    await expect(d).toContainText('Slack connects the Beinghuman workspace')
    await expect(d.getByTestId('publish-slack-workspace')).toHaveValue('Beinghuman'); await expect(d.getByTestId('publish-slack-workspace-url')).toHaveValue('https://beinghuman-hq.slack.com')
    await expect(d.getByTestId('publish-slack-ready')).toHaveText('not ready'); await expect(d.getByTestId('publish-slack-problem')).toHaveText('Enter the webhook')
    await expect(d.getByTestId('publish-slack-channel')).toHaveValue(''); await expect(d.getByTestId('publish-slack-webhook')).toHaveAttribute('type', 'password'); await expect(d.getByTestId('publish-slack-webhook')).toHaveValue('')
    await expect(d.getByTestId('publish-slack-help')).toHaveText('The webhook URL works like a password. It is stored on this PC only.')
    const how = d.getByTestId('slack-howto')
    await expect(how).toHaveJSProperty('open', true)   // open while no webhook is saved
    await expect(how).toContainText('1. api.slack.com/apps > Create New App > From scratch, name it RunPod Manager, pick Beinghuman.')
    await expect(how).toContainText('4. Copy the Webhook URL and paste it here.')
    await expect(d.getByTestId('slack-howto-admin')).toHaveText('If your Slack needs an admin to approve apps, ask them to do steps 1-4 and send you the URL privately: it works like a password.')
    // the channel and the name are labels only: nothing says they choose where it posts
    await expect(d.getByText('Channel (label only)')).toBeVisible(); await expect(d.getByText('Posted as (label only)')).toBeVisible()
    await expect(d.getByTestId('publish-slack-channel-hint')).toHaveText('The webhook posts to the channel you picked in Slack. This name is only shown here (a plan preview, the History). To post somewhere else, create another webhook.')
    await expect(d.getByTestId('publish-slack-username-hint')).toHaveText("Shown in our preview; Slack uses the app's name.")
    await expect(d.getByTestId('publish-slack-ready-note')).toHaveCount(0)
  })
  test('channel and webhook save (the # is added), only Slack is sent, the webhook shows as a hint, an empty field keeps it, Clear webhook removes it', async ({ page, api }) => {
    const d = await openConnectSlack(page)
    await d.getByTestId('publish-slack-channel').fill('deliveries'); await d.getByTestId('publish-slack-webhook').fill('https://hooks.slack.com/services/T0/B0/xxxx9f2k')
    await d.getByTestId('publish-slack-save').click(); await expect(d.getByTestId('publish-slack-saved')).toBeVisible()
    const b = calls(api, 'PUT', '/publish/settings')[0].body
    expect(b.slack).toMatchObject({ channel: '#deliveries', webhook_url: 'https://hooks.slack.com/services/T0/B0/xxxx9f2k', workspace_name: 'Beinghuman' }); expect(b).not.toHaveProperty('s3'); expect(b).not.toHaveProperty('defaults')
    await expect(d.getByTestId('publish-slack-webhook')).toHaveAttribute('placeholder', 'saved ••••9f2k'); await expect(d.getByTestId('publish-slack-webhook')).toHaveValue(''); await expect(d.getByTestId('publish-slack-ready')).toHaveText('ready')
    await expect(d.getByTestId('publish-slack-ready-note')).toHaveText('Posts to the channel chosen in Slack')
    await expect(d.getByTestId('slack-howto')).toHaveJSProperty('open', false)   // closed once a webhook is saved
    await d.getByTestId('publish-slack-username').fill('Robot'); await d.getByTestId('publish-slack-save').click()
    await expect.poll(() => calls(api, 'PUT', '/publish/settings').length).toBe(2)
    expect(calls(api, 'PUT', '/publish/settings')[1].body.slack).not.toHaveProperty('webhook_url')   // empty keeps the stored
    await d.getByTestId('publish-slack-clear').click(); await answerConfirm(page, true)
    await expect.poll(() => api.state.publish.settings.slack.webhook_hint).toBe('')
    expect(calls(api, 'PUT', '/publish/settings').at(-1).body.clear).toEqual(['slack_webhook'])
  })
  test('Connect keeps the Slack pane\'s own Save (items are saved one by one there); its Test waits for it while there are edits', async ({ page, api }) => {
    setup(api)
    const d = await openConnectSlack(page)
    await expect(d.getByTestId('publish-slack-test')).toBeEnabled(); await expect(d.getByTestId('publish-slack-save-first')).toHaveCount(0)
    await d.getByTestId('publish-slack-channel').fill('#other')
    await expect(d.getByTestId('publish-slack-test')).toBeDisabled(); await expect(d.getByTestId('publish-slack-save-first')).toHaveText('Save first')
    await d.getByTestId('publish-slack-save').click(); await expect(d.getByTestId('publish-slack-saved')).toBeVisible()
    await expect(d.getByTestId('publish-slack-test')).toBeEnabled(); await expect(d.getByTestId('publish-slack-save-first')).toHaveCount(0)
  })
  test('validation errors show under the field they name', async ({ page }) => {
    const d = await openConnectSlack(page)
    await d.getByTestId('publish-slack-channel').fill('@@x'); await d.getByTestId('publish-slack-save').click()
    await expect(d.locator('[data-testid="publish-field-error"][data-field="slack.channel"]')).toContainText('a channel starts with #')
    await d.getByTestId('publish-slack-channel').fill('#ok'); await d.getByTestId('publish-slack-webhook').fill('http://evil.example/x'); await d.getByTestId('publish-slack-save').click()
    await expect(d.locator('[data-testid="publish-field-error"][data-field="slack.webhook_url"]')).toContainText('https://hooks.slack.com/')
  })
  test('the test message asks first, naming the channel and Beinghuman; No posts nothing', async ({ page, api }) => {
    setup(api)
    const d = await openConnectSlack(page)
    await d.getByTestId('publish-slack-test').click()
    expect(await answerConfirm(page, false)).toBe('This posts one test message to #deliveries in Beinghuman. Continue?')
    expect(api.state.publish.tests).toHaveLength(0)
    await d.getByTestId('publish-slack-test').click(); await answerConfirm(page, true)
    await expect(d.getByTestId('publish-slack-test-result')).toHaveText('The test message was posted: posted to #deliveries')
    expect(api.state.publish.tests).toEqual([{ target: 'slack' }])
  })
  test('the existing tabs are still there and open as before (MCP, Repositories)', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('open-connect').click()
    const d = modal(page, t('connect.title'))
    await expect(d.getByRole('tab')).toHaveText([t('connect.mcp'), t('connect.slack'), t('connect.repositories')])
    await d.getByRole('tab', { name: t('connect.repositories') }).click(); await expect(d.getByTestId('connect-repositories-heading')).toBeVisible()
  })
  test('an older core says to restart', async ({ page, api }) => {
    api.state.publishOld = true
    await page.goto('/'); await page.getByTestId('open-connect').click()
    const d = modal(page, t('connect.title')); await d.getByRole('tab', { name: t('connect.slack') }).click()
    await expect(d.getByTestId('slack-restart')).toHaveText('Restart the app to use Publishing')
  })
})

test.describe('the Publish window', () => {
  test('lists the local output tree: folders open, files tick, the filter narrows, deliver/ and .proxies/ are one click away, Select this folder ticks the folder', async ({ page, api }) => {
    setup(api)
    const m = await openModal(page)
    await expect(m.getByTestId('publish-entry')).toHaveCount(4)
    await m.getByTestId('publish-filter').fill('cgi'); await expect(m.getByTestId('publish-entry')).toHaveCount(1)
    await m.getByTestId('publish-filter').fill('')
    await m.getByTestId('publish-quick-deliver').click()
    await expect(m.getByTestId('publish-dir')).toContainText('deliver'); await expect(m.getByTestId('publish-entry')).toHaveCount(1)
    await m.locator('[data-testid="publish-entry"][data-path="deliver/archival-085"] [data-testid="publish-entry-open"]').click()
    await m.locator('[data-testid="publish-entry"][data-path="deliver/archival-085/v003"] [data-testid="publish-entry-open"]').click()
    await expect(m.getByTestId('publish-entry')).toHaveCount(3)
    await expect(m.locator('[data-testid="publish-entry"][data-path$="a.mp4"]')).toContainText(formatBytes(2 * GB))
    await tick(m, 'deliver/archival-085/v003/a.mp4').check()
    await expect(m.getByTestId('publish-selected-count')).toHaveText('1 selected')
    await m.getByTestId('publish-select-folder').click()
    await expect(m.getByTestId('publish-selected-count')).toHaveText('2 selected')
    await m.getByTestId('publish-up').click(); await expect(m.getByTestId('publish-dir')).toContainText('deliver/archival-085')
    await m.getByTestId('publish-quick-proxies').click(); await expect(m.getByTestId('publish-entry')).toHaveCount(1)
    await expect(m.getByTestId('publish-plan-none')).toBeHidden().catch(() => {})
  })
  test('targets that are not configured are disabled with the reason and an Open settings button that opens the Publishing tab; a configured S3 alone is enabled', async ({ page, api }) => {
    setup(api); api.state.publish.settings.slack.webhook_hint = ''
    const m = await openModal(page)
    await expect(m.getByTestId('publish-target-s3-check')).toBeEnabled(); await expect(m.getByTestId('publish-target-s3-check')).toBeChecked()   // the default target, ready
    await expect(m.getByTestId('publish-target-slack-check')).toBeDisabled(); await expect(m.getByTestId('publish-target-slack-reason')).toHaveText('Enter the webhook')
    await expect(m.getByTestId('publish-target-slack-settings')).toHaveText('Open Connect > Slack')
    await m.getByTestId('publish-target-slack-settings').click()
    await expect(modal(page, t('connect.title')).getByTestId('slack-pane')).toBeVisible()   // Slack is connected in Connect
    await page.getByTestId('connect-modal').locator('.btn-close').click()
    setup(api); api.state.publish.settings.s3.bucket = ''
    await m.getByTestId('publish-edit-settings').click()
    await expect(modal(page, t('config.title')).getByTestId('settings-publishing')).toBeVisible()   // S3 stays in Settings
  })
  test('the plan shows the destination, files and size, what is already there (same size) skipped, weights refused, and blockers', async ({ page, api }) => {
    setup(api, { there: ['deliver/archival-085/v003/a.mp4'] })
    const m = await openModal(page)
    await m.getByTestId('publish-quick-deliver').click()
    await m.locator('[data-testid="publish-entry"][data-path="deliver/archival-085"] [data-testid="publish-entry-open"]').click()
    await m.getByTestId('publish-select-folder').click()   // the folder archival-085: three files, one already there
    await expect(m.getByTestId('publish-dest')).toHaveText('Destination: s3://beinghuman-deliveries/imax/restoration/')
    await expect(m.getByTestId('publish-counts')).toHaveText(`2 files · ${formatBytes(9 * GB + 900)}`)
    await expect(m.getByTestId('publish-skipped')).toHaveText('1 already there (same size) will be skipped')
    await m.getByTestId('publish-crumb-root').click()
    await m.locator('[data-testid="publish-entry"][data-path="cgi-042"] [data-testid="publish-entry-open"]').click()
    await tick(m, 'cgi-042/weights.safetensors').check()
    await expect(m.locator('[data-testid="publish-refused-item"][data-path="cgi-042/weights.safetensors"]')).toContainText('model weights are not published')
    await expect(m.getByTestId('publish-counts')).toHaveText(`2 files · ${formatBytes(9 * GB + 900)}`)   // the refused one adds nothing
    api.state.publish.blockers = ['The S3 bucket cannot be reached']
    await tick(m, 'cgi-042/frame.png').check()   // a change re-plans
    await expect(m.getByTestId('publish-blocker')).toHaveText('The S3 bucket cannot be reached')
    await expect(m.getByTestId('publish-run')).toBeDisabled()
  })
  test('files not on this PC are listed as refused with the pull-first note', async ({ page, api }) => {
    setup(api); api.state.publish.tree[''].push({ name: 'remote-only.mov', path: 'remote-only.mov', dir: false, bytes: 5, remote: true })
    const m = await openModal(page)
    await tick(m, 'remote-only.mov').check()
    const r = m.locator('[data-testid="publish-refused-item"][data-path="remote-only.mov"]')
    await expect(r).toContainText('Pull the renders to this PC first'); await expect(r.getByTestId('publish-not-local')).toHaveText('· Not on the Local PC: pull first')
  })
  test('the Slack message is editable, previewed, and sent with the plan and the run', async ({ page, api }) => {
    setup(api)
    const m = await openModal(page)
    await tick(m, 'notes.txt').check()
    await expect(m.getByTestId('publish-message')).toHaveValue('{shot} {version} is on S3: {links}')
    await m.getByTestId('publish-message').fill('Hello {files} files {links}')
    await expect(m.getByTestId('publish-slack-preview')).toContainText('Hello 1 files <link>')
    await expect.poll(() => api.state.publish.planned.at(-1).message).toBe('Hello {files} files {links}')
    await m.getByTestId('publish-target-slack-check').uncheck()
    await expect(m.getByTestId('publish-message')).toHaveCount(0)
    await expect.poll(() => api.state.publish.planned.at(-1).targets).toEqual(['s3'])
  })
  test('a named yes is required, remembered, and the confirm line says what happens; Publish sends items, targets and approved_by', async ({ page, api }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem('c')) { localStorage.removeItem('runpod-manager.approved-by'); sessionStorage.setItem('c', '1') } })
    setup(api)
    const m = await openModal(page)
    await tick(m, 'notes.txt').check()
    await expect(m.getByTestId('publish-approved-hint')).toHaveText('Publishing needs who says yes')
    await expect(m.getByTestId('publish-run')).toBeDisabled()
    await expect(m.getByTestId('publish-confirm')).toHaveText(`This copies 1 files (${formatBytes(1200)}) to s3://beinghuman-deliveries/imax/restoration/ and posts to #deliveries in Beinghuman.`)
    await m.getByTestId('publish-approved-by').fill('Brynley')
    await expect(m.getByTestId('publish-run')).toBeEnabled()
    await m.getByTestId('publish-target-slack-check').uncheck()
    await expect(m.getByTestId('publish-confirm')).toHaveText(`This copies 1 files (${formatBytes(1200)}) to s3://beinghuman-deliveries/imax/restoration/.`)
    await m.getByTestId('publish-run').click()
    await expect.poll(() => api.state.publish.runs.length).toBe(1)
    expect(api.state.publish.runs[0]).toMatchObject({ items: ['notes.txt'], targets: ['s3'], approved_by: 'Brynley' })
    expect(await page.evaluate(() => localStorage.getItem('runpod-manager.approved-by'))).toBe('Brynley')
  })
  test('progress with numbers and percent, Cancel, then links with Copy and expiry, and a failed Slack post with Re-post', async ({ page, api, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    setup(api)
    const m = await openModal(page)
    await tick(m, 'notes.txt').check(); await m.getByTestId('publish-approved-by').fill('Brynley')
    await expect(m.getByTestId('publish-run')).toBeEnabled(); await m.getByTestId('publish-run').click()
    await expect(m.getByTestId('publish-job')).toBeVisible()
    const j = api.state.publish.jobs[0]
    Object.assign(j, { files_done: 1, bytes_done: 1e9, rate_bps: 50e6, current: 'deliver/x/a.mov' })
    await expect(m.getByTestId('publish-progress')).toHaveAttribute('data-percent', '33', { timeout: 6000 })
    await expect(m.getByTestId('publish-job-numbers')).toContainText('1 of 3 files'); await expect(m.getByTestId('publish-job-current')).toHaveText('deliver/x/a.mov')
    await m.getByTestId('publish-cancel').click()
    await expect.poll(() => api.state.publish.cancelled).toEqual(['pub-1'])
    await expect(m.getByTestId('publish-job')).toHaveAttribute('data-state', 'cancelled', { timeout: 6000 })
    await m.getByTestId('publish-run').click()
    await expect.poll(() => api.state.publish.jobs.length).toBe(2)
    const j2 = api.state.publish.jobs[1]
    Object.assign(j2, { state: 'done_with_warning', files_done: 3, bytes_done: 3e9, summary: '3 files published; Slack failed', links: [{ path: 'deliver/x/a.mp4', url: 'https://bucket.s3.amazonaws.com/deliver/x/a.mp4?sig=1', expires_at: '2026-11-22T10:00:00Z' }], slack: { state: 'failed', error: 'channel_not_found' } })
    await expect(m.getByTestId('publish-job-summary')).toHaveText('3 files published; Slack failed', { timeout: 6000 })
    await expect(m.getByTestId('publish-link-expiry')).toContainText('2026')
    await m.getByTestId('publish-link-copy').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://bucket.s3.amazonaws.com/deliver/x/a.mp4?sig=1')
    await expect(m.getByTestId('publish-link-copy')).toHaveText('Copied')
    await expect(m.getByTestId('publish-slack-state')).toContainText('Slack failed: channel_not_found')
    await m.getByTestId('publish-slack-repost').click()
    await expect.poll(() => api.state.publish.reposts).toEqual(['pub-2'])
    await expect(m.getByTestId('publish-slack-state')).toContainText('Slack: posted', { timeout: 6000 })
    await expect(m.getByTestId('publish-slack-repost')).toHaveCount(0)
  })
  test('Edit publishing settings opens the same section from inside the window, and a change to Connect > Slack is picked up when it closes', async ({ page, api }) => {
    setup(api); api.state.publish.settings.slack.webhook_hint = ''
    const m = await openModal(page)
    await expect(m.getByTestId('publish-target-slack-check')).toBeDisabled()
    await m.getByTestId('publish-edit-settings').click()
    await expect(modal(page, t('config.title')).getByTestId('settings-publishing')).toBeVisible()
    await modal(page, t('config.title')).locator('.btn-close').click()
    await m.getByTestId('publish-target-slack-settings').click()
    const d = modal(page, t('connect.title'))
    await expect(d.getByTestId('publish-slack-webhook')).toBeVisible()
    await d.getByTestId('publish-slack-channel').fill('#deliveries'); await d.getByTestId('publish-slack-webhook').fill('https://hooks.slack.com/services/T0/B0/zzzz1111')
    await d.getByTestId('publish-slack-save').click(); await expect(d.getByTestId('publish-slack-saved')).toBeVisible()
    await d.locator('.btn-close').click()
    await expect(m.getByTestId('publish-target-slack-check')).toBeEnabled({ timeout: 6000 })
  })
  test('opened from the Outputs window it ticks the review and proxy files on this PC of the sequences listed', async ({ page, api }) => {
    setup(api)
    api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'pppppppp-1111', workflow: 'rounds/r1/p.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 5, cost_estimate: 0,
      outputs: [0, 1].map((n) => ({ filename: `ARCHIVAL-085_MAIN.${String(n).padStart(4, '0')}.dpx`, subfolder: 'seqs/a', type: 'output' })) })
    api.state.renders = { deliverables: [{ shot: 'archival-085', version: 3, file: 'output/deliver/archival-085/v003/ARCHIVAL-085_MAIN.mp4', exists_local: true, files: [{ name: 'ARCHIVAL-085_MAIN.mp4', codec: 'h264' }, { name: 'ARCHIVAL-085_MAIN.mov', codec: 'prores422hq' }] }] }
    await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px }))
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
    await expect(page.getByTestId('pod-outputs-modal').getByTestId('outputs-dpx-review')).toBeVisible()
    await page.getByTestId('pod-outputs-publish').click()
    const m = page.getByTestId('publish-modal')
    await expect(m.getByTestId('publish-selected-item')).toHaveCount(2)   // the combined Selected list shows them whichever Source is open (the Volume is the default)
    await expect.poll(() => api.state.publish.planned.at(-1)?.items).toEqual(['deliver/archival-085/v003/ARCHIVAL-085_MAIN.mp4', 'deliver/archival-085/v003/ARCHIVAL-085_MAIN.mov'])
  })
})

test.describe('the Render option', () => {
  const px2 = px
  async function openRender(page, api, { publish = CONFIGURED, renders = {}, mutate } = {}) {
    if (publish) setup(api); if (mutate) mutate(api.state.publish)
    api.state.history.runs['pod-aaaaaaaa'].unshift({ prompt_id: 'rrrrrrrr-1111', workflow: 'rounds/r1/r.json', status: 'success', started_at: '2026-11-19T10:00:00Z', duration_s: 5, cost_estimate: 0,
      outputs: [0, 1, 2].map((n) => ({ filename: `s1_proxy.${String(n).padStart(4, '0')}.dpx`, subfolder: 'seqs/s1', type: 'output' })) })
    api.state.renders = renders
    await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: px2 }))
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
    await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Render Sequences' }).click()
    const p = page.getByTestId('pod-outputs-previews-modal')
    await expect(p.getByTestId('pod-outputs-render')).toBeVisible()
    return p
  }
  test('both boxes show; each is disabled with its reason and a settings link when not configured', async ({ page, api }) => {
    const p = await openRender(page, api, { mutate: (s) => { s.settings.slack.webhook_hint = '' } })
    await expect(p.getByTestId('pod-outputs-render-publish-s3')).toBeEnabled()
    await expect(p.getByTestId('pod-outputs-render-publish-slack')).toBeDisabled()
    await expect(p.getByTestId('pod-outputs-render-publish-slack-reason')).toContainText('Enter the webhook')
    await p.getByTestId('pod-outputs-render-publish-slack-settings').click()
    await expect(modal(page, t('connect.title')).getByTestId('slack-pane')).toBeVisible()
  })
  test('ticking one asks who says yes (a proxy shows the field), shows where it will go, and the request carries publish and approved_by', async ({ page, api }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem('c')) { localStorage.removeItem('runpod-manager.approved-by'); sessionStorage.setItem('c', '1') } })
    const p = await openRender(page, api)
    await expect(p.getByTestId('pod-outputs-render-approved-by')).toHaveCount(0)
    await p.getByTestId('pod-outputs-render-publish-s3').check()
    await expect(p.getByTestId('pod-outputs-render-publish-plan')).toHaveText('will publish to s3://beinghuman-deliveries/imax/restoration/.proxies/…')
    await expect(p.getByTestId('pod-outputs-render-publish-approved-hint')).toHaveText('Publishing needs who says yes')
    await expect(p.getByTestId('pod-outputs-render-start')).toBeDisabled()
    await p.getByTestId('pod-outputs-render-approved-by').fill('Brynley')
    await p.getByTestId('pod-outputs-render-publish-slack').check()
    await expect(p.getByTestId('pod-outputs-render-start')).toBeEnabled()
    await p.getByTestId('pod-outputs-render-start').click()
    await expect.poll(() => api.state.renders.started.length).toBe(1)
    expect(api.state.renders.started[0]).toMatchObject({ approved_by: 'Brynley', publish: { targets: ['s3', 'slack'] }, kind: 'proxy' })
  })
  test('a review plans to deliver/, and without a publish box the request has no publish key', async ({ page, api }) => {
    const p = await openRender(page, api)
    await p.getByTestId('pod-outputs-render-kind-review').check(); await p.getByTestId('pod-outputs-render-approved-by').fill('B')
    await p.getByTestId('pod-outputs-render-publish-s3').check()
    await expect(p.getByTestId('pod-outputs-render-publish-plan')).toHaveText('will publish to s3://beinghuman-deliveries/imax/restoration/deliver/…')
    await p.getByTestId('pod-outputs-render-publish-s3').uncheck()
    await p.getByTestId('pod-outputs-render-start').click()
    await expect.poll(() => api.state.renders.started.length).toBe(1)
    expect(api.state.renders.started[0]).not.toHaveProperty('publish')
  })
  test('publishing does not need Sync: with Sync off the boxes stay on and enabled (the render is published from the volume); nothing says to turn Sync on', async ({ page, api }) => {
    const p = await openRender(page, api)
    await p.getByTestId('pod-outputs-render-publish-s3').check()
    await p.getByTestId('pod-outputs-render-pull').uncheck()
    await expect(p.getByTestId('pod-outputs-render-publish-s3')).toBeEnabled(); await expect(p.getByTestId('pod-outputs-render-publish-s3')).toBeChecked()   // not cleared
    await expect(p.getByTestId('pod-outputs-render-publish-needsync')).toHaveCount(0)
    await p.getByTestId('pod-outputs-render-where').selectOption('local')
    await expect(p.getByTestId('pod-outputs-render-publish-s3')).toBeEnabled()
  })
  test('the choice is never remembered: nothing is saved in the render settings, and a reload starts with both off', async ({ page, api }) => {
    const p = await openRender(page, api)
    await p.getByTestId('pod-outputs-render-publish-s3').check()
    expect(api.calls.filter((c) => c.method === 'PUT' && (c.path === '/mounts' || c.path.endsWith('/config')))).toHaveLength(0)
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('publish')
    await page.reload(); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); await page.getByTestId('pod-outputs-previews').click(); await page.getByTestId('pod-outputs-previews-modal').getByRole('tab', { name: 'Render Sequences' }).click()
    await expect(page.getByTestId('pod-outputs-previews-modal').getByTestId('pod-outputs-render-publish-s3')).not.toBeChecked()
  })
  test('the job summary shows the publish state with a link that opens the Publish window', async ({ page, api }) => {
    const p = await openRender(page, api)
    await p.getByTestId('pod-outputs-render-publish-s3').check(); await p.getByTestId('pod-outputs-render-approved-by').fill('B')
    await p.getByTestId('pod-outputs-render-start').click()
    await expect(p.getByTestId('pod-outputs-render-job')).toBeVisible()
    Object.assign(api.state.renders.jobs[0], { state: 'done', finished_at: 'now', publish: { job_id: 'pub-1', state: 'uploading' } })
    await expect(p.getByTestId('pod-outputs-render-publish-state')).toHaveText(/Publish: uploading/, { timeout: 6000 })
    await p.getByTestId('pod-outputs-render-publish-open').click()
    await expect(page.getByTestId('publish-modal')).toBeVisible()
  })
  test('an older core (no publish calls) hides the boxes quietly', async ({ page, api }) => {
    api.state.publishOld = true
    const p = await openRender(page, api, { publish: false })
    await expect(p.getByTestId('pod-outputs-render')).toBeVisible()
    await expect(p.getByTestId('pod-outputs-render-publish')).toHaveCount(0)
  })
})

test.describe('the Publish window: Scan and backfill', () => {
  const GBn = 1e9
  const INVENTORY = {
    rows: [
      { id: 'r1', shot: 'archival-085', name: 'ARCHIVAL-085_MAIN', kind: 'dpx', frames: 240, bytes: 12 * GBn, modified: '2026-11-10T10:00:00Z', where: ['pc', 'volume'], in_destination: false, source: 'volume:output/', path: 'archival-085/dpx', weight: false },
      { id: 'r2', shot: 'archival-085', name: 'archival-085_review.mp4', kind: 'review', frames: 0, bytes: 2 * GBn, where: ['pc'], in_destination: true, source: 'pc:output/', path: 'deliver/archival-085/v001/archival-085_review.mp4', weight: false },
      { id: 'r3', shot: 'archival-085', name: 'archival-085_proxy.mp4', kind: 'proxy', frames: 0, bytes: 1 * GBn, where: ['volume'], in_destination: false, source: 'volume:input/pipe_finals/', path: 'pipe_finals/archival-085_proxy.mp4', weight: false },
      { id: 'r4', shot: 'cgi-042', name: 'weights.safetensors', kind: 'other', frames: 0, bytes: 7 * GBn, where: ['volume'], in_destination: false, source: 'volume:output/', path: 'cgi-042/weights.safetensors', weight: true },
      { id: 'r5', shot: 'cgi-042', name: 'cgi-042_review.mov', kind: 'review', frames: 0, bytes: 9 * GBn, where: ['volume'], in_destination: true, source: 'volume:project/90_DELIVERIES/', path: '90_DELIVERIES/cgi-042_review.mov', weight: false },
    ],
    by_shot: { 'archival-085': 3, 'cgi-042': 2, 'cgi-099': 0 }, unreadable: [{ path: 'volume:input/pipe_finals/old', reason: 'Permission denied' }],
  }
  async function openBackfill(page, api, { mutate, ...o } = {}) {
    setup(api, { inventory: INVENTORY, ...o }); if (mutate) mutate(api.state.publish)
    const m = await openModal(page)
    await m.getByTestId('publish-tab-backfill').click()
    await expect(m.getByTestId('publish-backfill')).toBeVisible()
    return m
  }
  async function scanned(page, api, o) { const m = await openBackfill(page, api, o); await m.getByTestId('publish-backfill-scan').click(); await expect(m.getByTestId('publish-backfill-table')).toBeVisible(); return m }
  const row = (m, id) => m.locator(`[data-testid="publish-backfill-row"][data-id="${id}"]`)
  const check = (m, id) => m.locator(`[data-testid="publish-backfill-row-check"][data-id="${id}"]`)

  test('the tab lists the four sources, all ticked; Scan sends them, shows progress with Cancel, then the inventory and its totals', async ({ page, api }) => {
    const m = await openBackfill(page, api, { scanSteps: 2 })
    await expect(m.getByTestId('publish-tab-files')).toHaveText('Publish files'); await expect(m.getByTestId('publish-tab-backfill')).toHaveText('Scan and backfill')
    await expect(m.getByTestId('publish-backfill-sources')).toContainText('This PC: output/'); await expect(m.getByTestId('publish-backfill-sources')).toContainText('Volume: input/pipe_finals/'); await expect(m.getByTestId('publish-backfill-sources')).toContainText('Volume: project/90_DELIVERIES/'); await expect(m.getByTestId('publish-backfill-sources')).toContainText('The scan only reads.')
    await expect(m.getByTestId('publish-backfill-source')).toHaveCount(4)
    for (const c of await m.getByTestId('publish-backfill-source').all()) await expect(c).toBeChecked()
    await expect(m.getByTestId('publish-backfill-empty')).toHaveText('Scan, then tick what to upload.')
    await m.getByTestId('publish-backfill-scan').click()
    await expect(m.getByTestId('publish-backfill-cancel-scan')).toBeVisible(); await expect(m.getByTestId('publish-backfill-scan')).toBeDisabled()
    expect(api.state.publish.scans[0].sources).toEqual(['pc:output/', 'volume:output/', 'volume:input/pipe_finals/', 'volume:project/90_DELIVERIES/'])
    await expect(m.getByTestId('publish-backfill-table')).toBeVisible({ timeout: 8000 })
    await expect(m.getByTestId('publish-backfill-totals')).toHaveText(`5 files, ${formatBytes(31 * GB)}, 2 already there`)
    await expect(m.getByTestId('publish-backfill-unreadable')).toHaveText('Could not read: volume:input/pipe_finals/old (Permission denied)')
    await expect(m.getByTestId('publish-backfill-scan')).toBeEnabled()
  })
  test('only the ticked sources are scanned; with none ticked Scan is off', async ({ page, api }) => {
    const m = await openBackfill(page, api)
    await m.locator('[data-testid="publish-backfill-source"][data-source="volume:output/"]').uncheck(); await m.locator('[data-testid="publish-backfill-source"][data-source="pc:output/"]').uncheck()
    await m.getByTestId('publish-backfill-scan').click()
    await expect.poll(() => api.state.publish.scans.length).toBe(1)
    expect(api.state.publish.scans[0].sources).toEqual(['volume:input/pipe_finals/', 'volume:project/90_DELIVERIES/'])
    for (const c of await m.getByTestId('publish-backfill-source').all()) await c.uncheck()
    await expect(m.getByTestId('publish-backfill-scan')).toBeDisabled()
  })
  test('the inventory is grouped by shot (a shot with nothing says none found); rows show kind, frames, size, where, already in S3 and weights as refused; shots collapse; the filter narrows', async ({ page, api }) => {
    const m = await scanned(page, api)
    await expect(m.getByTestId('publish-backfill-shot')).toHaveCount(3)
    await expect(m.locator('[data-testid="publish-backfill-shot"][data-shot="cgi-099"]').getByTestId('publish-backfill-none')).toHaveText('none found')
    await expect(row(m, 'r1')).toContainText('ARCHIVAL-085_MAIN'); await expect(row(m, 'r1').getByTestId('publish-backfill-kind')).toHaveText('dpx'); await expect(row(m, 'r1')).toContainText('240 fr'); await expect(row(m, 'r1')).toContainText(formatBytes(12 * GB))
    await expect(row(m, 'r1').getByTestId('publish-backfill-where')).toHaveText(['PC', 'volume']); await expect(row(m, 'r3').getByTestId('publish-backfill-where')).toHaveText(['volume'])
    await expect(row(m, 'r2').getByTestId('publish-backfill-there')).toBeVisible(); await expect(row(m, 'r1').getByTestId('publish-backfill-there')).toHaveCount(0)
    await expect(row(m, 'r4').getByTestId('publish-backfill-weight')).toHaveText('weights: not published'); await expect(check(m, 'r4')).toBeDisabled()
    await m.locator('[data-testid="publish-backfill-shot-toggle"][data-shot="archival-085"]').click()
    await expect(row(m, 'r1')).toBeHidden(); await expect(row(m, 'r5')).toBeVisible()
    await m.locator('[data-testid="publish-backfill-shot-toggle"][data-shot="archival-085"]').click(); await expect(row(m, 'r1')).toBeVisible()
    await m.getByTestId('publish-backfill-filter').fill('review')
    await expect(m.getByTestId('publish-backfill-row')).toHaveCount(2); await expect(m.getByTestId('publish-backfill-shot')).toHaveCount(2)   // the shots with a match
  })
  test('checkboxes: a row, a shot (not the weights), all; the plan numbers skip what is already there (same size)', async ({ page, api }) => {
    const m = await scanned(page, api)
    await check(m, 'r1').check()
    await expect(m.getByTestId('publish-backfill-plan')).toHaveText(`1 files · ${formatBytes(12 * GB)}`)
    await m.locator('[data-testid="publish-backfill-shot-check"][data-shot="cgi-042"]').check()
    await expect(check(m, 'r5')).toBeChecked(); await expect(check(m, 'r4')).not.toBeChecked()   // the weights are never ticked
    await m.getByTestId('publish-backfill-all').check()
    for (const id of ['r1', 'r2', 'r3', 'r5']) await expect(check(m, id)).toBeChecked()
    await expect(m.getByTestId('publish-backfill-plan')).toContainText(`2 files · ${formatBytes(13 * GB)}`); await expect(m.getByTestId('publish-backfill-skipped')).toHaveText('· 2 already there (same size) will be skipped')
    await m.getByTestId('publish-backfill-all').uncheck()
    await expect(m.getByTestId('publish-backfill-plan')).toHaveCount(0)
  })
  test('the destination shows the Panama exchange bucket and returns/BKK/, uploads as they are, names the inventory CSV, and the folder can be changed', async ({ page, api }) => {
    setup(api, { inventory: INVENTORY }); api.state.publish.settings.s3 = { ...api.state.publish.settings.s3, bucket: 'bh-panama-exchange-610140802195', prefix: 'returns/BKK/', credentials: 'panama' }
    const m = await openModal(page); await m.getByTestId('publish-tab-backfill').click()
    await expect(m.getByTestId('publish-backfill-prefix')).toHaveValue('returns/BKK/')
    await expect(m.getByTestId('publish-backfill-destline')).toHaveText('Destination: s3://bh-panama-exchange-610140802195/returns/BKK/<shot>/<name> (the Panama exchange bucket)')
    await expect(m.getByTestId('publish-backfill-asis')).toHaveText('Upload as they are (names unchanged; naming can be fixed after)')
    await expect(m.getByTestId('publish-backfill-csvline')).toHaveText(/^_inventory_\d{4}-\d{2}-\d{2}\.csv will be uploaded too$/)
    await expect(m.getByText('Check the bucket with Kyle')).toHaveCount(0)
    await m.getByTestId('publish-backfill-scan').click(); await expect(m.getByTestId('publish-backfill-table')).toBeVisible()
    await check(m, 'r1').check()
    await m.getByTestId('publish-backfill-prefix').fill('returns/TEST/')
    await expect(m.getByTestId('publish-backfill-destline')).toContainText('s3://bh-panama-exchange-610140802195/returns/TEST/<shot>/<name>')
    await expect.poll(() => api.state.publish.bfPlans?.at(-1)?.destination_prefix).toBe('returns/TEST/')
  })
  test('the confirm line counts the files streamed from the volume through this PC; approver required and remembered; Publish sends the rows, targets, prefix and approved_by', async ({ page, api }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem('c')) { localStorage.removeItem('runpod-manager.approved-by'); sessionStorage.setItem('c', '1') } })
    const m = await scanned(page, api)
    await m.getByTestId('publish-backfill-all').check()
    await m.getByTestId('publish-target-slack-check').check()
    await expect(m.getByTestId('publish-backfill-confirm')).toHaveText(`This copies 2 files (${formatBytes(13 * GB)}), 2 of them straight from the volume through this PC, to s3://beinghuman-deliveries/returns/BKK/ and posts a status to #deliveries.`)
    await expect(m.getByTestId('publish-backfill-approved-hint')).toHaveText('Publishing needs who says yes'); await expect(m.getByTestId('publish-backfill-run')).toBeDisabled()
    await m.getByTestId('publish-backfill-approved-by').fill('Brynley'); await expect(m.getByTestId('publish-backfill-run')).toBeEnabled()
    await m.getByTestId('publish-target-slack-check').uncheck()
    await expect(m.getByTestId('publish-backfill-confirm')).toHaveText(`This copies 2 files (${formatBytes(13 * GB)}), 2 of them straight from the volume through this PC, to s3://beinghuman-deliveries/returns/BKK/.`)
    await m.getByTestId('publish-backfill-run').click()
    await expect.poll(() => api.state.publish.bfRuns.length).toBe(1)
    expect(api.state.publish.bfRuns[0]).toMatchObject({ rows: ['r1', 'r2', 'r3', 'r5'], targets: ['s3'], destination_prefix: 'returns/BKK/', approved_by: 'Brynley' })
    expect(await page.evaluate(() => localStorage.getItem('runpod-manager.approved-by'))).toBe('Brynley')
  })
  test('a blocker from the plan keeps Publish off', async ({ page, api }) => {
    const m = await scanned(page, api, { blockers: ['The bucket cannot be reached'] })
    await check(m, 'r1').check(); await m.getByTestId('publish-backfill-approved-by').fill('B')
    await expect(m.getByTestId('publish-backfill-blocker')).toHaveText('The bucket cannot be reached'); await expect(m.getByTestId('publish-backfill-run')).toBeDisabled()
  })
  test('the Slack status message is editable with a preview; Slack not connected shows the reason and Open Connect', async ({ page, api }) => {
    const m = await scanned(page, api)
    await check(m, 'r1').check(); await m.getByTestId('publish-target-slack-check').check()
    await m.getByTestId('publish-backfill-message').fill('Backfill: {files} files done')
    await expect(m.getByTestId('publish-backfill-slack-preview')).toHaveText('Backfill: 1 files done')
    await expect.poll(() => api.state.publish.bfPlans?.at(-1)?.message).toBe('Backfill: {files} files done')
  })
  test('Slack not connected: the box is off with the reason and Open Connect', async ({ page, api }) => {
    const m = await openBackfill(page, api, { mutate: (pb) => { pb.settings.slack.webhook_hint = '' } })
    await expect(m.getByTestId('publish-target-slack-reason')).toContainText('Enter the webhook')
    await expect(m.getByTestId('publish-target-slack-check')).toBeDisabled()
    await m.getByTestId('publish-target-slack-settings').click()
    await expect(page.getByTestId('connect-modal').getByTestId('slack-pane')).toBeVisible()
  })
  test('the job shows the streaming phase, numbers and current file; the result says uploaded, already there and failed with reasons; Retry failed sends just those; Slack state shows', async ({ page, api }) => {
    const m = await scanned(page, api)
    await m.getByTestId('publish-backfill-all').check(); await m.getByTestId('publish-backfill-approved-by').fill('Brynley'); await m.getByTestId('publish-target-slack-check').check()
    await m.getByTestId('publish-backfill-run').click()
    await expect(m.getByTestId('publish-job')).toBeVisible()
    const j = api.state.publish.jobs[0]
    Object.assign(j, { files_done: 1, bytes_done: 1e9, rate_bps: 40e6, current: 'archival-085/dpx/0001.dpx' })
    await expect(m.getByTestId('publish-job-phase')).toHaveText('Streaming from the volume through this PC', { timeout: 6000 })
    await expect(m.getByTestId('publish-progress')).toHaveAttribute('data-percent', '20'); await expect(m.getByTestId('publish-job-current')).toHaveText('archival-085/dpx/0001.dpx')
    Object.assign(j, { state: 'done_with_warning', phase: '', files_done: 2, uploaded: 2, skipped: 2, bytes_done: 5e9, failed: [{ id: 'r3', path: 'pipe_finals/archival-085_proxy.mp4', error: 'Access Denied' }, { id: 'r1', path: 'archival-085/dpx', error: 'timed out' }], slack: { state: 'sent' }, summary: '2 uploaded, 2 failed' })
    await expect(m.getByTestId('publish-job-result')).toHaveText('uploaded 2 · already there 2 · failed 2', { timeout: 6000 })
    await expect(m.locator('[data-testid="publish-job-failed"][data-path="pipe_finals/archival-085_proxy.mp4"]')).toContainText('Access Denied')
    await expect(m.getByTestId('publish-slack-state')).toContainText('Slack: posted')
    await m.getByTestId('publish-retry-failed').click()
    await expect.poll(() => api.state.publish.bfRuns.length).toBe(2)
    expect(api.state.publish.bfRuns[1]).toMatchObject({ rows: ['r3', 'r1'], approved_by: 'Brynley' })
  })
  test('Copy inventory as CSV puts a header and every row on the clipboard', async ({ page, api, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const m = await scanned(page, api)
    await m.getByTestId('publish-backfill-copy-csv').click()
    await expect(m.getByTestId('publish-backfill-copy-csv')).toHaveText('Copied')
    const csv = await page.evaluate(() => navigator.clipboard.readText())
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('shot,name,kind,frames,bytes,modified,where,in_destination,source,path'); expect(lines).toHaveLength(6)
    expect(lines[1]).toBe('"archival-085","ARCHIVAL-085_MAIN","dpx","240","12000000000","2026-11-10T10:00:00Z","pc+volume","no","volume:output/","archival-085/dpx"')
    expect(lines[2]).toContain('"yes"')
    const [dl] = await Promise.all([page.waitForEvent('download'), m.getByTestId('publish-backfill-save-csv').click()])
    expect(dl.suggestedFilename()).toMatch(/^_inventory_\d{4}-\d{2}-\d{2}\.csv$/)
  })
  test('a core with Publishing but no backfill calls says to restart, in the tab', async ({ page, api }) => {
    const m = await openBackfill(page, api, { backfillOld: true })
    await m.getByTestId('publish-backfill-scan').click()
    await expect(m.getByTestId('publish-backfill-restart')).toHaveText('Restart the app to use Publishing')
  })
})

test.describe('the Publish window: one Destination block, the Sources line and where each file lands', () => {
  test('the Destination block is one element above the tabs, identical on both tabs, with the full s3 destination, credentials source, ready badges and shared checkboxes', async ({ page, api }) => {
    setup(api, { inventory: { rows: [], by_shot: {}, unreadable: [] } })
    const m = await openModal(page)
    const dest = m.getByTestId('publish-destination')
    await expect(dest).toHaveCount(1)
    await expect(dest.getByTestId('publish-destination-s3')).toHaveText('s3://beinghuman-deliveries/imax/restoration/'); await expect(dest).toContainText('region eu-west-1'); await expect(dest.getByTestId('publish-destination-creds')).toHaveText('separate keys')
    await expect(dest.getByTestId('publish-destination-slack')).toHaveText('#deliveries in Beinghuman')
    await expect(dest.getByTestId('publish-destination-s3-badge')).toHaveText('ready'); await expect(dest.getByTestId('publish-destination-slack-badge')).toHaveText('ready')
    expect(await m.evaluate((el) => { const d = el.querySelector('[data-testid="publish-destination"]'), t = el.querySelector('[data-testid="publish-tabs"]'); return !!(d.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) }, null)).toBe(true)   // above the tabs
    const text = await dest.innerText()
    await m.getByTestId('publish-tab-backfill').click()
    await expect(m.getByTestId('publish-destination')).toHaveCount(1); expect(await m.getByTestId('publish-destination').innerText()).toBe(text)   // the same block, not a copy
    // the checkboxes are shared by both tabs
    await m.getByTestId('publish-target-slack-check').uncheck()
    await m.getByTestId('publish-tab-files').click()
    await expect(m.getByTestId('publish-target-slack-check')).not.toBeChecked(); await expect(m.getByTestId('publish-message')).toHaveCount(0)
    await m.getByTestId('publish-tab-backfill').click()
    await expect(m.getByTestId('publish-target-slack-check')).not.toBeChecked()
  })
  test('the Panama bucket is labelled; a target that is not ready shows its reason and the button to the right place, on either tab', async ({ page, api }) => {
    setup(api); api.state.publish.settings.s3 = { ...api.state.publish.settings.s3, bucket: 'bh-panama-exchange-610140802195', prefix: 'returns/BKK/', credentials: 'panama', access_key_hint: '' }; api.state.publish.panamaKeys = false; api.state.publish.settings.slack.webhook_hint = ''
    const m = await openModal(page)
    const dest = m.getByTestId('publish-destination')
    await expect(dest.getByTestId('publish-destination-creds')).toHaveText('Panama exchange bucket'); await expect(dest.getByTestId('publish-destination-s3')).toHaveText('s3://bh-panama-exchange-610140802195/returns/BKK/')
    await expect(dest.getByTestId('publish-destination-s3-badge')).toHaveText('not ready'); await expect(dest.getByTestId('publish-target-s3-reason')).toHaveText('The Panama exchange keys are not set')
    await expect(dest.getByTestId('publish-destination-slack')).toHaveText('not connected'); await expect(dest.getByTestId('publish-target-slack-reason')).toHaveText('Enter the webhook')
    await expect(dest.getByTestId('publish-target-s3-check')).toBeDisabled()
    await m.getByTestId('publish-tab-backfill').click()
    await expect(m.getByTestId('publish-destination').getByTestId('publish-target-slack-settings')).toHaveText('Open Connect > Slack')
    await m.getByTestId('publish-target-s3-settings').click()
    await expect(modal(page, t('config.title')).getByTestId('settings-publishing')).toBeVisible()
  })
  test('the Destination stays on screen while the window scrolls', async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 560 })
    setup(api, { inventory: { rows: Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, shot: 's', name: `f${i}.mp4`, kind: 'proxy', frames: 0, bytes: 1, where: ['pc'], in_destination: false, source: 'pc:output/', path: `f${i}`, weight: false })), by_shot: { s: 40 }, unreadable: [] } })
    const m = await openModal(page)
    await m.getByTestId('publish-tab-backfill').click(); await m.getByTestId('publish-backfill-scan').click(); await expect(m.getByTestId('publish-backfill-table')).toBeVisible()
    await m.locator('.modal-body').evaluate((b) => { b.scrollTop = b.scrollHeight })
    await expect(m.getByTestId('publish-destination')).toBeInViewport()
  })
  test('Publish files shows its Sources: the folder open on this PC, the selection with its count and size, the paths (first five, then more), and the not-on-this-PC count', async ({ page, api }) => {
    setup(api); api.state.publish.tree[''].push({ name: 'remote-only.mov', path: 'remote-only.mov', dir: false, bytes: 5, remote: true })
    const m = await openModal(page)
    const src = m.getByTestId('publish-sources')
    await expect(src.getByTestId('publish-sources-pc')).toHaveText('Local PC: output')
    await expect(src.getByTestId('publish-sources-selected')).toHaveText('Nothing selected yet'); await expect(src.getByTestId('publish-sources-path')).toHaveCount(0)
    await tick(m, 'notes.txt').check()
    await expect(src.getByTestId('publish-sources-selected')).toHaveText(`1 files · ${formatBytes(1200)} selected`)
    await tick(m, 'remote-only.mov').check()
    await expect(src.getByTestId('publish-sources-not-local')).toHaveText('On the Volume (not on the Local PC): 1 files: pull first')
    await m.getByTestId('publish-quick-deliver').click()
    await expect(src.getByTestId('publish-sources-pc')).toHaveText('Local PC: output/deliver')
    for (const p of ['deliver/archival-085', 'x/1', 'x/2', 'x/3', 'x/4']) await m.evaluate((el, path) => { el.dispatchEvent(new CustomEvent('noop', { detail: path })) }, p).catch(() => {})
    await expect(src.getByTestId('publish-sources-path')).toHaveText(['notes.txt', 'remote-only.mov'])
  })
  test('the first rows show where each file would land on S3, with the prefix', async ({ page, api }) => {
    setup(api)
    const m = await openModal(page)
    await m.getByTestId('publish-quick-deliver').click()
    await m.locator('[data-testid="publish-entry"][data-path="deliver/archival-085"] [data-testid="publish-entry-open"]').click()
    await m.locator('[data-testid="publish-entry"][data-path="deliver/archival-085/v003"] [data-testid="publish-entry-open"]').click()
    await expect(m.getByTestId('publish-entry-key')).toHaveText(['→ imax/restoration/deliver/archival-085/v003/a.mp4', '→ imax/restoration/deliver/archival-085/v003/a.mov', '→ imax/restoration/deliver/archival-085/v003/a.meta.json'])
    await m.getByTestId('publish-up').click()
    await expect(m.getByTestId('publish-entry-key')).toHaveCount(0)   // folders have no key of their own
  })
})

test.describe('the Publish window: Source Local PC | Volume', () => {
  const GB0 = 1e9
  const VT = {
    '': [{ name: 'proxy_v004', path: 'proxy_v004', dir: true }, { name: 'delivery_empty', path: 'delivery_empty', dir: true, empty: true }, { name: 'notes.txt', path: 'notes.txt', dir: false, bytes: 40 }],
    proxy_v004: [{ name: 'archival-080', path: 'proxy_v004/archival-080', dir: true }, { name: 'old', path: 'proxy_v004/old', dir: true, empty: true }, { name: 'w.safetensors', path: 'proxy_v004/w.safetensors', dir: false, bytes: 7 * GB0, weight: true }],
    'proxy_v004/archival-080': [{ name: 'a.mov', path: 'proxy_v004/archival-080/a.mov', dir: false, bytes: 4 * GB0 }, { name: 'b.mov', path: 'proxy_v004/archival-080/b.mov', dir: false, bytes: 3 * GB0 }],
  }
  const volSetup = (api, o = {}) => { setup(api, { vtree: JSON.parse(JSON.stringify(VT)), vsizes: { proxy_v004: { files: 12, bytes: 31 * 1e9 } }, ...o }) }
  const vcheck = (m, p) => m.locator(`[data-testid="publish-volume-entry-check"][data-path="${p}"]`)
  const sel = (m) => m.getByTestId('publish-selected-item')

  test('the Publish files right pane shows the Destination like the Backfill tab: Folder, the destination line with the bucket, and "as they are", with a link to the settings', async ({ page, api }) => {
    setup(api)
    const m = await openModal(page)
    const dest = m.getByTestId('publish-files-dest')
    await expect(dest).toBeVisible()
    await expect(dest.getByTestId('publish-files-prefix')).toHaveValue('imax/restoration')   // the configured folder (setup's settings), read-only here
    await expect(dest.getByTestId('publish-files-prefix')).toHaveAttribute('readonly', '')
    await expect(dest.getByTestId('publish-files-destline')).toContainText('s3://')
    await expect(dest.getByTestId('publish-files-destline')).toContainText('imax/restoration/<path>')
    await expect(dest.getByTestId('publish-files-asis')).toHaveText('Upload as they are (names unchanged; naming can be fixed after)')
    await expect(dest.getByTestId('publish-files-open-settings')).toBeVisible()
    await expect(m.getByTestId('publish-plan-none')).toBeVisible()   // shown even with nothing selected
  })
  test('the Source opens on the Volume by default, from anywhere (with or without a volume folder open), and lists the volume\'s output/', async ({ page, api }) => {
    volSetup(api)
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); await page.getByTestId('pod-outputs-publish').click()
    const m = page.getByTestId('publish-modal'); await expect(m).toBeVisible()
    await expect(m.getByTestId('publish-source-volume')).toHaveClass(/active/)
    await expect(m.getByTestId('publish-source-local')).not.toHaveClass(/active/)
    await expect(m.getByTestId('publish-volume-tree')).toBeVisible()
    await expect(m.getByTestId('publish-tree')).toHaveCount(0)               // the Local PC tree is not what opens
    await expect(m.getByTestId('publish-volume-entry').first()).toBeVisible() // the volume's output/ is listed at once
  })
  test('the Source picker names Local PC and Volume with their counts; switching switches the tree and keeps BOTH selections in one Selected list with where badges and remove buttons', async ({ page, api }) => {
    volSetup(api)
    const m = await openModal(page)
    const pick = m.getByTestId('publish-source-picker')
    await expect(pick).toContainText('Source'); await expect(pick.getByTestId('publish-source-local')).toHaveText('Local PC (0 selected)'); await expect(pick.getByTestId('publish-source-volume')).toHaveText('Volume (0 selected)')
    await expect(pick.getByTestId('publish-source-local')).toHaveClass(/active/)   // openModal switched to the Local PC (the Volume is the default: see the next test)
    await tick(m, 'notes.txt').check()
    await m.getByTestId('publish-source-volume').click()
    await expect(m.getByTestId('publish-volume-tree')).toBeVisible(); await expect(m.getByTestId('publish-tree')).toHaveCount(0)
    await m.locator('[data-testid="publish-volume-entry"][data-path="proxy_v004"] [data-testid="publish-volume-entry-open"]').click()
    await vcheck(m, 'proxy_v004/archival-080').check()
    await expect(m.getByTestId('publish-source-volume')).toHaveText('Volume (1 selected)'); await expect(m.getByTestId('publish-source-local')).toHaveText('Local PC (1 selected)')
    await expect(sel(m)).toHaveCount(2)
    await expect(sel(m).first().getByTestId('publish-selected-where')).toHaveText('Local PC'); await expect(sel(m).nth(1).getByTestId('publish-selected-where')).toHaveText('Volume: streamed')
    await m.getByTestId('publish-source-local').click()   // switching back keeps the volume selection
    await expect(m.getByTestId('publish-tree')).toBeVisible(); await expect(tick(m, 'notes.txt')).toBeChecked(); await expect(sel(m)).toHaveCount(2)
    await m.locator('[data-testid="publish-selected-remove"][data-where="volume"]').click()
    await expect(m.getByTestId('publish-source-volume')).toHaveText('Volume (0 selected)'); await expect(sel(m)).toHaveCount(1)
    await expect(m.getByTestId('publish-source-volume')).toHaveAttribute('title', 'Volume · comfy-workspace')
  })
  test('the volume tree: breadcrumb, files and folders, weight tags, the filename filter, empty folders tagged and hidden by default with a toggle and a count', async ({ page, api }) => {
    volSetup(api)
    const m = await openModal(page)
    await m.getByTestId('publish-source-volume').click()
    await expect(m.getByTestId('publish-volume-entry')).toHaveCount(2)   // delivery_empty is hidden
    await expect(m.getByTestId('publish-volume-empty-hidden')).toHaveText('1 empty hidden')
    await m.getByTestId('publish-volume-hide-empty').uncheck()
    await expect(m.getByTestId('publish-volume-entry')).toHaveCount(3)
    await expect(m.locator('[data-testid="publish-volume-entry"][data-path="delivery_empty"] [data-testid="publish-volume-empty-tag"]')).toHaveText('empty')
    await expect(m.locator('[data-testid="publish-volume-entry"][data-path="delivery_empty"]')).toHaveClass(/opacity-50/)
    await m.getByTestId('publish-volume-hide-empty').check()
    await m.locator('[data-testid="publish-volume-entry"][data-path="proxy_v004"] [data-testid="publish-volume-entry-open"]').click()
    await expect(m.getByTestId('publish-volume-dir')).toContainText('proxy_v004'); await expect(m.getByTestId('publish-volume-entry')).toHaveCount(2)
    await expect(m.locator('[data-testid="publish-volume-entry"][data-path$="w.safetensors"] [data-testid="publish-volume-weight"]')).toHaveText('weights')
    await m.getByTestId('publish-volume-filter').fill('archival'); await expect(m.getByTestId('publish-volume-entry')).toHaveCount(1)
    await m.getByTestId('publish-volume-filter').fill('')
    await m.getByTestId('publish-volume-up').click(); await expect(m.getByTestId('publish-volume-dir')).toHaveText('Folder: output')
  })
  test('Measure a volume folder: a spinner, then its files and size (asked once); Cancel drops the answer', async ({ page, api }) => {
    volSetup(api, { vsizeMs: 600 })
    const m = await openModal(page)
    await m.getByTestId('publish-source-volume').click()
    const meas = m.locator('[data-testid="publish-volume-measure"][data-path="proxy_v004"]')
    expect(api.state.publish.vsizeCalls || []).toHaveLength(0)   // never by itself
    await meas.click()
    await expect(m.locator('[data-testid="publish-volume-measure-cancel"][data-path="proxy_v004"]')).toBeVisible()
    await m.locator('[data-testid="publish-volume-measure-cancel"][data-path="proxy_v004"]').click()
    await page.waitForTimeout(900); await expect(m.locator('[data-testid="publish-volume-size"]')).toHaveCount(0)   // dropped
    await m.locator('[data-testid="publish-volume-measure"][data-path="proxy_v004"]').click()
    await expect(m.locator('[data-testid="publish-volume-size"][data-path="proxy_v004"]')).toHaveText(`12 files · ${formatBytes(31 * 1e9)}`, { timeout: 5000 })
    expect(api.state.publish.vsizeCalls).toEqual(['proxy_v004', 'proxy_v004'])
  })
  test('the plan and the run carry local paths as strings and volume paths as { where: "volume", path }; the Sources line and the confirm count what is streamed; the plan rows say where', async ({ page, api }) => {
    volSetup(api)
    const m = await openModal(page)
    await tick(m, 'notes.txt').check()
    await m.getByTestId('publish-source-volume').click()
    await m.locator('[data-testid="publish-volume-entry"][data-path="proxy_v004"] [data-testid="publish-volume-entry-open"]').click()
    await vcheck(m, 'proxy_v004/archival-080').check()
    await expect.poll(() => api.state.publish.planned.at(-1)?.items).toEqual(['notes.txt', { where: 'volume', path: 'proxy_v004/archival-080' }])
    await expect(m.getByTestId('publish-sources-selected')).toHaveText(`1 files on Local PC · 2 files streamed from the volume, ${formatBytes(7 * 1e9)}`)
    await expect(m.getByTestId('publish-confirm')).toContainText('2 files (7.0 GB) are streamed from the volume through this PC.'.replace('7.0 GB', formatBytes(7 * 1e9)))
    await m.getByTestId('publish-approved-by').fill('Brynley'); await m.getByTestId('publish-run').click()
    await expect.poll(() => api.state.publish.runs.length).toBe(1)
    expect(api.state.publish.runs[0].items).toEqual(['notes.txt', { where: 'volume', path: 'proxy_v004/archival-080' }])
  })
  test('opened from the Outputs window with a volume folder open it starts on Volume with that folder selected, not a local one', async ({ page, api }) => {
    volSetup(api)
    api.state.s3Outputs = { files: [{ key: 'proxy_v004/archival-080/a/a.png', bytes: 5 }], keys: true }
    await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
    const o = page.getByTestId('pod-outputs-modal')
    await o.locator('[data-testid="pod-outputs-folder"][data-name="proxy_v004"]').click()
    await o.locator('[data-testid="pod-outputs-folder"][data-name="archival-080"]').click()
    await page.getByTestId('pod-outputs-publish').click()
    const m = page.getByTestId('publish-modal')
    await expect(m.getByTestId('publish-source-volume')).toHaveClass(/active/); await expect(m.getByTestId('publish-source-volume')).toHaveText('Volume (1 selected)'); await expect(m.getByTestId('publish-source-local')).toHaveText('Local PC (0 selected)')
    await expect(m.getByTestId('publish-selected-item')).toHaveText(/proxy_v004\/archival-080/)
    await expect(m.getByTestId('publish-volume-dir')).toContainText('proxy_v004/archival-080')
    await expect.poll(() => api.state.publish.planned.at(-1)?.items).toEqual([{ where: 'volume', path: 'proxy_v004/archival-080' }])
  })
  test('an older core without publish.volume: the Volume source says to restart; Local PC works', async ({ page, api }) => {
    volSetup(api, { volumeOld: true })
    const m = await openModal(page)
    await m.getByTestId('publish-source-volume').click()
    await expect(m.getByTestId('publish-volume-restart')).toHaveText('Restart the app to publish from the volume')
    await m.getByTestId('publish-source-local').click(); await expect(m.getByTestId('publish-tree')).toBeVisible()
  })
})

test.describe('the Outputs window: empty volume folders', () => {
  const FILES2 = { files: [{ key: 'proxy_v004/a/a.png', bytes: 5 }, { key: 'proxy_v005/b/b.png', bytes: 5 }, { key: 'empty_one/.keep', bytes: 0 }, { key: 'empty_two/.keep', bytes: 0 }], keys: true, folderInfo: { empty_one: { empty: true }, empty_two: { empty: true }, proxy_v004: { empty: false } } }
  const openO = async (page, api) => { api.state.s3Outputs = FILES2; api.state.history.runs = {}; for (const p of api.state.pods) { p.status = 'stopped'; p.web_ui_url = null; p.uptime_seconds = null }; await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); return page.getByTestId('pod-outputs-modal') }
  test('folders known to be empty are hidden by default with a count; the toggle shows them greyed with (empty)', async ({ page, api }) => {
    const m = await openO(page, api)
    await expect(m.getByTestId('pod-outputs-folder')).toHaveText(['proxy_v004', 'proxy_v005'])
    await expect(m.getByTestId('pod-outputs-empty-hidden')).toHaveText('2 empty folders hidden')
    await expect(m.getByTestId('pod-outputs-hide-empty')).toBeChecked()
    await m.getByTestId('pod-outputs-hide-empty').uncheck()
    await expect(m.getByTestId('pod-outputs-folder')).toHaveCount(4)
    const e = m.locator('[data-testid="pod-outputs-folder"][data-name="empty_one"]')
    await expect(e).toHaveAttribute('data-empty', 'true'); await expect(e.getByTestId('pod-outputs-folder-empty')).toHaveText('(empty)'); await expect(e).toHaveClass(/opacity-50/)
    await expect(m.locator('[data-testid="pod-outputs-folder"][data-name="proxy_v004"]')).toHaveAttribute('data-empty', 'false')
    await expect(m.getByTestId('pod-outputs-empty-hidden')).toHaveCount(0)
  })
  test('an older core without folder_info shows every folder and no toggle count', async ({ page, api }) => {
    const m = await (async () => { api.state.s3Outputs = { ...FILES2, folderInfo: undefined }; api.state.history.runs = {}; for (const p of api.state.pods) { p.status = 'stopped'; p.web_ui_url = null; p.uptime_seconds = null }; await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click(); return page.getByTestId('pod-outputs-modal') })()
    await expect(m.getByTestId('pod-outputs-folder')).toHaveCount(4); await expect(m.getByTestId('pod-outputs-empty-hidden')).toHaveCount(0)
  })
})
