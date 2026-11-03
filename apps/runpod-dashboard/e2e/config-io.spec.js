import { readFileSync } from 'node:fs'
import { test, expect } from './fixtures'
import { t } from './i18n'

// Export and import of the Default Configuration as a JSON file (docs/ADR-023), on the fake API; in a browser the file is a download and an <input type=file>.
const configModal = (page) => page.locator('.modal.show', { has: page.getByTestId('config-modal') })
const file = (obj) => ({ name: 'cfg.json', mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) })
const good = (over = {}, panama) => ({ format: 'runpod-pod-manager-config', version: 1, exported_at: '2026-10-30T10:00:00.000Z', app_version: '1.0.1', config: { image: 'ghcr.io/other/comfy-app:v27', idle_stop_minutes: 10, folders: { project: '/Users/other/CANALV2', plates: '', 'comfy-shared': '/Users/other/ComfyUI-Shared' }, ...over }, ...(panama ? { panama } : {}), secrets_set: ['RUNPOD_API_KEY', 'PANAMA_AWS_ACCESS_KEY_ID'] })
const open = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); return configModal(page) }

test.describe('Configuration file: export', () => {
  test('Export saves one JSON file with the format header, no dry_run, and by default your keys and tokens, with the warning next to the box that is ticked', async ({ page, api }) => {
    api.state.mounts.config.dry_run = true
    const dialog = await open(page)
    await expect(dialog.getByTestId('cfg-io-include-secrets')).toBeChecked()   // ticked by default
    await expect(dialog.getByTestId('cfg-io-secrets-warning')).toContainText(t('configio.secretsWarning'))
    await expect(dialog.getByTestId('cfg-io-excluded')).toContainText(t('configio.excluded'))
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByTestId('cfg-io-export').click()])
    expect(download.suggestedFilename()).toMatch(/^pod-manager-config-\d{4}-\d{2}-\d{2}\.json$/)
    const saved = JSON.parse(readFileSync(await download.path(), 'utf8'))
    expect(saved).toMatchObject({ format: 'runpod-pod-manager-config', version: 1, app_version: '1.0.2', secrets_included: true })
    expect('dry_run' in saved.config).toBe(false)
    expect(saved.config.image).toBe('ghcr.io/example/comfy-app:v26')
    expect(saved.secrets.settings.RUNPOD_API_KEY).toBe('rpa_CURRENT_PC_KEY_VALUE_0000')   // the real value: that is the point
    expect(saved.secrets.git_accounts[0]).toMatchObject({ provider: 'github', username: 'octo', token: 'ghp_CURRENT_PC_TOKEN_0000' })
    expect(api.state.configio.exportSecrets).toEqual([true])
  })
  test('unticking Include keys and tokens leaves them out: the warning goes, the file lists only the names', async ({ page, api }) => {
    api.state.mounts.config.env = { COMFY_PORT: '8188', HF_TOKEN: 'hf_ENV_TOKEN_SECRET_7777' }
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-include-secrets').click()
    await expect(dialog.getByTestId('cfg-io-secrets-warning')).toHaveCount(0)
    await expect(dialog.getByTestId('cfg-io-secrets-off')).toContainText(t('configio.secretsOff'))
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByTestId('cfg-io-export').click()])
    const raw = readFileSync(await download.path(), 'utf8'), saved = JSON.parse(raw)
    expect(saved.secrets_included).toBe(false)
    expect('secrets' in saved).toBe(false)
    expect(saved.secrets_set).toEqual(expect.arrayContaining(['RUNPOD_API_KEY', 'git:github/octo']))
    expect(saved.config.env).toEqual({ COMFY_PORT: '8188' }); expect(saved.env_omitted).toEqual(['HF_TOKEN'])
    expect(raw).not.toMatch(/rpa_CURRENT|ghp_CURRENT|hf_ENV_TOKEN/)
    expect(api.state.configio.exportSecrets).toEqual([false])
  })
})

test.describe('Configuration file: import', () => {
  test('the preview lists each section with what changes; Folders is flagged as paths from another machine and starts unticked, the rest of the changes ticked', async ({ page }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file(good({}, { bucket: 'other-bucket', region: 'us-west-2', profile: 'panama' })))
    await expect(dialog.getByTestId('cfg-io-preview')).toBeVisible()
    await expect(dialog.getByTestId('cfg-io-source')).toContainText('cfg.json')
    await expect(dialog.getByTestId('cfg-io-source')).toContainText('1.0.1')
    await expect(dialog.getByTestId('cfg-io-secrets')).toContainText('RUNPOD_API_KEY')   // names only: the file has no values to show
    const box = (k) => dialog.getByTestId(`cfg-io-section-${k}`)
    await expect(dialog.getByTestId('cfg-io-machine-flag')).toBeVisible()
    await expect(box('folders')).not.toBeChecked()
    await expect(box('image')).toBeChecked(); await expect(box('pod_defaults')).toBeChecked(); await expect(box('panama')).toBeChecked()
    await expect(dialog.getByTestId('cfg-io-changed-image')).toHaveText(t('configio.changed'))
    await expect(dialog.getByTestId('cfg-io-account-flag').first()).toBeVisible()   // image is account-specific
    await expect(dialog.getByTestId('cfg-io-apply')).toContainText('3')
  })
  test('Apply writes only the ticked sections, says what it did, offers Undo; Undo puts the configuration back', async ({ page, api }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file(good()))
    await dialog.getByTestId('cfg-io-section-pod_defaults').click()   // untick one that was ticked
    await dialog.getByTestId('cfg-io-apply').click()
    await expect(dialog.getByTestId('cfg-io-done')).toContainText('image')
    await expect(dialog.getByTestId('cfg-io-preview')).toHaveCount(0)
    expect(api.state.configio.applied).toEqual([['image']])   // not Folders, not the unticked pod defaults
    expect(api.state.mounts.config.image).toBe('ghcr.io/other/comfy-app:v27')
    expect(api.state.mounts.config.idle_stop_minutes).toBe(30)
    expect(api.state.mounts.config.folders['comfy-shared']).toBe('')
    await expect(dialog.getByTestId('cfg-io-undo')).toBeVisible()
    await dialog.getByTestId('cfg-io-undo').click()
    await expect(dialog.getByTestId('cfg-io-done')).toContainText('mounts-')
    expect(api.state.mounts.config.image).toBe('ghcr.io/example/comfy-app:v26')
    await expect(dialog.getByTestId('cfg-io-undo')).toHaveCount(0)   // nothing left to undo
  })
  test('ticking Folders applies it too; with nothing ticked Apply is off', async ({ page, api }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file(good()))
    await dialog.getByTestId('cfg-io-section-image').click(); await dialog.getByTestId('cfg-io-section-pod_defaults').click()
    await expect(dialog.getByTestId('cfg-io-apply')).toBeDisabled()
    await dialog.getByTestId('cfg-io-section-folders').click()
    await dialog.getByTestId('cfg-io-apply').click()
    await expect(dialog.getByTestId('cfg-io-done')).toBeVisible()
    expect(api.state.configio.applied).toEqual([['folders']])
    expect(api.state.mounts.config.folders['comfy-shared']).toBe('/Users/other/ComfyUI-Shared')
  })
  test('Cancel leaves the configuration alone', async ({ page, api }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file(good()))
    await dialog.getByTestId('cfg-io-cancel').click()
    await expect(dialog.getByTestId('cfg-io-preview')).toHaveCount(0)
    expect(api.state.configio.applied).toEqual([])
  })
  test('a file that is not JSON, not ours, or from a newer version is refused with a plain message and nothing is applied', async ({ page, api }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file('{ not json'))
    await expect(dialog.getByTestId('cfg-io-error')).toContainText('cfg.json is not valid JSON')
    await dialog.getByTestId('cfg-io-file').setInputFiles(file({ hello: 'world' }))
    await expect(dialog.getByTestId('cfg-io-refused')).toContainText('not a pod manager configuration file')
    await dialog.getByTestId('cfg-io-cancel').click()
    await dialog.getByTestId('cfg-io-file').setInputFiles(file({ ...good(), version: 2 }))
    await expect(dialog.getByTestId('cfg-io-refused')).toContainText('version 2')
    expect(api.state.configio.applied).toEqual([])
  })
  test('a dry_run in the file is warned about and never imported', async ({ page }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file(good({ dry_run: false })))
    await expect(dialog.getByTestId('cfg-io-warning').first()).toContainText('dry_run')
  })
})

test.describe('Configuration file: keys and tokens on import', () => {
  const FILE_KEYS = { RUNPOD_API_KEY: 'rpa_FILE_SECRET_VALUE_1111', ANTHROPIC_API_KEY: 'sk-ant-FILE-SECRET-VALUE-22222222' }
  const withKeys = (settingsOver = FILE_KEYS, accounts = [{ id: 'gl-9', provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', token: 'glpat_FILE_TOKEN_SECRET_3333' }]) => ({ ...good(), secrets_included: true, secrets: { settings: settingsOver, git_accounts: accounts } })
  const fullValues = ['rpa_FILE_SECRET_VALUE_1111', 'sk-ant-FILE-SECRET-VALUE-22222222', 'glpat_FILE_TOKEN_SECRET_3333', 'rpa_CURRENT_PC_KEY_VALUE_0000', 'ghp_CURRENT_PC_TOKEN_0000']

  test('the preview has a Keys and tokens section, ticked, naming each key with only its last four characters; no full value is on the page', async ({ page }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file(withKeys()))
    await expect(dialog.getByTestId('cfg-io-section-secrets')).toBeChecked()
    await expect(dialog.getByTestId('cfg-io-changed-secrets')).toHaveText(t('configio.changed'))
    const item = (n) => dialog.locator(`[data-testid="cfg-io-secret-item"][data-name="${n}"]`)
    await expect(item('RUNPOD_API_KEY').getByTestId('cfg-io-secret-hint')).toHaveText('••••1111')
    await expect(item('ANTHROPIC_API_KEY').getByTestId('cfg-io-secret-hint')).toHaveText('••••2222')
    await expect(item('git:gitlab/tanuki').getByTestId('cfg-io-secret-hint')).toHaveText('••••3333')
    await expect(dialog.getByTestId('cfg-io-secrets')).toHaveCount(0)   // the file HAS keys: no "enter them yourself" note
    const text = await page.locator('body').innerText(), html = await page.content()
    for (const v of fullValues) { expect(text).not.toContain(v); expect(html).not.toContain(v) }
  })
  test('a file without keys says so and names what was set where it was exported', async ({ page }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file({ ...good(), secrets_included: false }))
    await expect(dialog.getByTestId('cfg-io-secrets')).toContainText('RUNPOD_API_KEY')
    await expect(dialog.getByTestId('cfg-io-section-secrets')).toHaveCount(0)
  })
  test('Apply writes the keys and tokens; Undo puts the previous ones back', async ({ page, api }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file(withKeys()))
    await dialog.getByTestId('cfg-io-apply').click()
    await expect(dialog.getByTestId('cfg-io-done')).toContainText('secrets')
    expect(api.state.configio.secrets).toMatchObject(FILE_KEYS)
    expect(api.state.configio.git.map((g) => g.username).sort()).toEqual(['octo', 'tanuki'])
    expect(await page.locator('body').innerText()).not.toContain('rpa_FILE_SECRET_VALUE_1111')
    await dialog.getByTestId('cfg-io-undo').click()
    expect(api.state.configio.secrets).toEqual({ RUNPOD_API_KEY: 'rpa_CURRENT_PC_KEY_VALUE_0000', ANTHROPIC_API_KEY: 'sk-ant-CURRENT-PC-KEY-0000000000' })
    expect(api.state.configio.git.map((g) => g.username)).toEqual(['octo'])
  })
  test('unticking Keys and tokens imports the rest and leaves the keys alone', async ({ page, api }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file(withKeys()))
    await dialog.getByTestId('cfg-io-section-secrets').click()
    await dialog.getByTestId('cfg-io-apply').click()
    await expect(dialog.getByTestId('cfg-io-done')).toBeVisible()
    expect(api.state.configio.applied[0]).not.toContain('secrets')
    expect(api.state.configio.secrets.RUNPOD_API_KEY).toBe('rpa_CURRENT_PC_KEY_VALUE_0000')
  })
  test('a malformed key is named with its reason and never shown; the good ones still import', async ({ page, api }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file(withKeys({ RUNPOD_API_KEY: 'rpa_FILE_SECRET_VALUE_1111', ANTHROPIC_API_KEY: 'bad secret value with spaces' }, [])))
    const bad = dialog.locator('[data-testid="cfg-io-secret-item"][data-name="ANTHROPIC_API_KEY"]')
    await expect(bad.getByTestId('cfg-io-secret-error')).toContainText('ANTHROPIC_API_KEY')
    expect(await page.locator('body').innerText()).not.toContain('bad secret value with spaces')
    await dialog.getByTestId('cfg-io-apply').click()
    await expect(dialog.getByTestId('cfg-io-done')).toContainText('ANTHROPIC_API_KEY')   // reported as not imported, by name
    expect(api.state.configio.secrets.RUNPOD_API_KEY).toBe('rpa_FILE_SECRET_VALUE_1111')
    expect(api.state.configio.secrets.ANTHROPIC_API_KEY).toBe('sk-ant-CURRENT-PC-KEY-0000000000')
  })
  test('a secret-looking environment value in the preview is shown by its last four characters only', async ({ page }) => {
    const dialog = await open(page)
    await dialog.getByTestId('cfg-io-file').setInputFiles(file(good({ env: { HF_TOKEN: 'hf_ENV_TOKEN_SECRET_7777', COMFY_PORT: '9999' } })))
    await dialog.getByTestId('cfg-io-row-env').locator('summary').click()
    await expect(dialog.getByTestId('cfg-io-incoming-env')).toContainText('••••7777')
    await expect(dialog.getByTestId('cfg-io-incoming-env')).not.toContainText('hf_ENV_TOKEN_SECRET_7777')
    await expect(dialog.getByTestId('cfg-io-incoming-env')).toContainText('9999')
  })
})

test.describe('A new installation asks once whether to import a configuration file', () => {
  const fresh = (api) => { api.state.settings = { runpod_api_key_set: false, runpod_api_key_hint: '', source: 'none' }; api.state.mounts.stored = false }
  test('the popup comes first; Import a configuration file opens Default Configuration at the import form and remembers the answer', async ({ page, api }) => {
    fresh(api)
    await page.goto('/')
    const welcome = page.getByTestId('welcome-modal')
    await expect(welcome).toBeVisible()
    await expect(welcome.getByTestId('welcome-body')).toContainText(t('configio.welcomeBody'))
    await expect(page.getByTestId('config-modal')).toBeHidden()   // not yet: asked first
    await welcome.getByTestId('welcome-import').click()
    await expect(welcome).toBeHidden()
    const dialog = configModal(page)
    await expect(dialog.getByTestId('cfg-io-panel')).toBeVisible()
    await expect(dialog.getByTestId('cfg-io-panel')).toBeInViewport()   // scrolled to the form
    await expect(dialog.getByTestId('cfg-key-gate')).toBeVisible()      // the key is still asked for, below it
    await dialog.getByTestId('cfg-io-file').setInputFiles(file(good()))   // and it works from here, before any key
    await expect(dialog.getByTestId('cfg-io-preview')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('welcome-modal')).toBeHidden()      // answered once, not asked again
  })
  test('Set up from scratch goes to Default Configuration as before, on the key, without the scroll', async ({ page, api }) => {
    fresh(api)
    await page.goto('/')
    await page.getByTestId('welcome-scratch').click()
    const dialog = configModal(page)
    await expect(dialog.getByTestId('cfg-key-gate')).toBeVisible()
    await expect(page.getByTestId('welcome-modal')).toBeHidden()
  })
  test('closing the popup counts as setting up from scratch', async ({ page, api }) => {
    fresh(api)
    await page.goto('/')
    await page.getByTestId('welcome-modal').getByRole('button', { name: /close/i }).click()
    await expect(configModal(page).getByTestId('cfg-key-gate')).toBeVisible()
  })
  test('no popup when a key is set', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('open-config')).toBeVisible()
    await expect(page.getByTestId('welcome-modal')).toBeHidden()
  })
  test('no popup when a configuration is already saved even without a key', async ({ page, api }) => {
    api.state.settings = { runpod_api_key_set: false, runpod_api_key_hint: '', source: 'none' }
    api.state.mounts.stored = true
    await page.goto('/')
    await expect(configModal(page).getByTestId('cfg-key-gate')).toBeVisible()   // straight to the key, as before
    await expect(page.getByTestId('welcome-modal')).toBeHidden()
  })
})
