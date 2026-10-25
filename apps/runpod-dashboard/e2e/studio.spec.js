import { test, expect, modal, podCard, cfgTab } from './fixtures'
import { t } from './i18n'

// The Adapter Studio (docs/ADR-009): one modal, laid out like an IDE, for Edit, New adapter and Write an adapter with Claude, against the fake API.
const PKG = '/Users/lucas/Projects/package'
const withKey = (api) => { api.state.settings = { ...api.state.settings, anthropic_key_set: true, anthropic_key_hint: '••••WXYZ' } }
const studio = (page) => page.getByTestId('studio')
const tid = (page, id) => studio(page).getByTestId(id)

const openConfigAdapters = async (page) => {
  await page.goto('/')
  await page.getByTestId('open-config').click()
  const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
  await cfgTab(cfg, 'adapters')
  return cfg
}
const editFromManager = async (page, id) => {
  const cfg = await openConfigAdapters(page)
  await cfg.locator(`[data-testid="adapter-row"][data-id="${id}"]`).getByTestId('adapter-edit').click()
  await expect(studio(page)).toBeVisible()
}
const attach = async (page, path = PKG) => { await tid(page, 'studio-folder').fill(path); await tid(page, 'studio-attach').click(); await expect(tid(page, 'studio-package-row').first()).toBeVisible() }
/** Replace the whole text of a CodeMirror editor by typing into it. */
async function typeInto(page, testid, text) {
  const content = tid(page, `${testid}-content`)
  await expect(content).toBeVisible()
  await expect(async () => { await content.click(); await expect(content).toBeFocused({ timeout: 500 }) }).toPass({ timeout: 8000 })   // the modal is still fading in at first
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(text)
}
const DOC = '/**\n * Edited by hand. What it does: maps a test package. Detects: its manifest. Maps: inputs to input/, workflows to workflows/.\n * Leaves in place: the finals. Needs / assumes: a manifest. Limits: none, it is a test.\n */\n'
const MODULE = (id, name = 'Edited') => `${DOC}export default { id: '${id}', name: '${name}', async detect() { return { match: 0 } }, async plan() { return { ops: [] } } }`

test.describe('Adapter Studio: the same modal from every door', () => {
  test('Edit in Default Configuration opens it on that adapter, built-ins included', async ({ page }) => {
    await editFromManager(page, 'agent-made')
    await expect(tid(page, 'studio-id')).toHaveValue('agent-made')
    await expect(tid(page, 'studio-name')).toHaveValue('Agent made')
    await expect(tid(page, 'studio-code-content')).toContainText("id: 'agent-made'")
    await expect(tid(page, 'studio-path')).toHaveText('/home/me/.config/runpod-pod-manager/adapters/agent-made.mjs')
    await tid(page, 'studio-close').click()
    await expect(studio(page)).toBeHidden()
    const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await cfg.locator('[data-testid="adapter-row"][data-id="comfy-shared"]').getByTestId('adapter-edit').click()
    await expect(tid(page, 'studio-builtin-badge')).toHaveText(t('studio.builtIn'))
    await expect(tid(page, 'studio-code-content')).toContainText("id: 'comfy-shared'")
  })

  test('New adapter opens it on the template, which already passes the structure check', async ({ page }) => {
    const cfg = await openConfigAdapters(page)
    await cfg.getByTestId('adapter-new').click()
    await expect(tid(page, 'studio-id')).toHaveValue('my-adapter')
    await expect(tid(page, 'studio-code-content')).toContainText('What it does')
    await expect(tid(page, 'studio-problem-count')).toHaveText('0')
    await expect(tid(page, 'studio-adapter-new')).toBeVisible()   // listed, marked unsaved
    await expect(tid(page, 'studio-path')).toHaveText(t('studio.notSavedYet'))
  })

  test('Write an adapter with Claude in Import Shot Pack is that modal, a new adapter with the package attached and the chat ready', async ({ page, api }) => {
    withKey(api)
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
    const dialog = modal(page, t('import.title'))
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.getByTestId('import-claude').click()
    await expect(studio(page)).toBeVisible()
    await expect(tid(page, 'studio-id')).toHaveValue('package')   // from the folder's name
    await expect(tid(page, 'studio-folder')).toHaveValue(PKG)
    await expect(tid(page, 'studio-package-row').first()).toBeVisible()
    await expect(tid(page, 'studio-context')).toBeVisible()
    await expect(tid(page, 'studio-input')).toBeEnabled()   // you can type straight away; Send is what starts the chat
    await expect(tid(page, 'studio-start')).toHaveCount(0)
  })

  test('so is Edit on an adapter in Import Shot Pack, with the folder attached', async ({ page }) => {
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
    const dialog = modal(page, t('import.title'))
    await dialog.getByTestId('import-folder').fill(PKG)
    await dialog.locator('[data-testid="import-adapter-row"][data-id="panama-imax-redux"]').getByTestId('import-adapter-edit').click()
    await expect(tid(page, 'studio-id')).toHaveValue('panama-imax-redux')
    await expect(tid(page, 'studio-folder')).toHaveValue(PKG)
  })
})

test.describe('Adapter Studio: it always says which app it is in (ADR-010)', () => {
  test('the header carries the app\'s mark and name, as the navbar does, and the no-spend badge when pods are simulated', async ({ page, api }) => {
    await editFromManager(page, 'agent-made')
    const brand = studio(page).getByTestId('app-brand')
    await expect(brand).toContainText(t('app.title'))
    await expect(brand.locator('i.fa-microchip')).toBeVisible()
    await expect(studio(page).getByTestId('no-spend-badge')).toHaveCount(0)
    api.state.mounts.config.dry_run = true
    await page.goto('/')
    await page.getByTestId('open-config').click()
    const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await cfgTab(cfg, 'adapters')
    await cfg.locator('[data-testid="adapter-row"][data-id="agent-made"]').getByTestId('adapter-edit').click()
    await expect(studio(page).getByTestId('no-spend-badge')).toHaveText(t('app.noSpend'))
  })
})

test.describe('Adapter Studio: on a phone', () => {
  for (const width of [390, 700, 900]) test(`the buttons are icons only at ${width}px: the words are hidden, the names stay for screen readers and tooltips`, async ({ page, api }) => {
    withKey(api)
    await page.setViewportSize({ width, height: 844 })
    await editFromManager(page, 'comfy-shared')
    await typeInto(page, 'studio-code', MODULE('comfy-shared', 'A ComfyUI-Shared folder'))
    await tid(page, 'studio-save').click()
    for (const id of ['studio-save', 'studio-document', 'studio-reset']) {
      const b = tid(page, id)
      await expect(b).toBeVisible()
      await expect(b.locator('.btn-label')).toBeHidden()                       // the text label is gone
      await expect(b.locator('i')).toBeVisible()                                // the icon stays
      expect(await b.getAttribute('aria-label')).toBeTruthy()                   // and the button still has its name
    }
    await expect(tid(page, 'studio-save')).toHaveAttribute('aria-label', t('studio.save'))
    await expect(tid(page, 'studio-document')).toHaveAttribute('aria-label', t('studio.document'))
    await expect(tid(page, 'studio-send')).toHaveAttribute('aria-label', t('studio.send'))
    await expect(tid(page, 'studio-send').locator('.btn-label')).toBeHidden()
    // nothing runs off the screen sideways, and every header button can be reached
    expect(await studio(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    for (const id of ['studio-save', 'studio-close', 'studio-wrap', 'studio-view-split']) await expect(tid(page, id)).toBeInViewport()
    await expect(tid(page, 'studio-send')).toBeInViewport()
    // the name and the id stay together on one line, side by side
    const [n, i] = await Promise.all([tid(page, 'studio-name').boundingBox(), tid(page, 'studio-id').boundingBox()])
    expect(Math.abs(n.y - i.y)).toBeLessThan(4)
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(tid(page, 'studio-save').locator('.btn-label')).toBeVisible()   // wide again: the words are back
    await expect(tid(page, 'studio-send').locator('.btn-label')).toBeVisible()
  })
})

test.describe('Adapter Studio: the editor', () => {
  test('looks like an IDE: explorer, tabs with the file name, path, line numbers, problems and a status bar', async ({ page }) => {
    await editFromManager(page, 'agent-made')
    await expect(tid(page, 'studio-explorer')).toBeVisible()
    await expect(tid(page, 'studio-tab-code')).toContainText('agent-made.mjs')
    await expect(tid(page, 'studio-tab-prompt')).toBeVisible()
    await expect(studio(page).locator('.cm-lineNumbers')).toBeVisible()
    await expect(tid(page, 'studio-problems')).toBeVisible()
    await expect(tid(page, 'studio-status')).toContainText(t('studio.lineCol', { line: 1, col: 1 }))
    await expect(tid(page, 'studio-status')).toContainText('JavaScript')
    await expect(tid(page, 'studio-chat')).toBeVisible()
  })

  test('view modes are icon buttons: code only, preview only, both; remembered', async ({ page }) => {
    await editFromManager(page, 'agent-made')
    for (const v of ['code', 'preview', 'split']) await expect(tid(page, `studio-view-${v}`)).toHaveAttribute('aria-label', t(`studio.view_${v}`))
    await expect(tid(page, 'studio-view-split')).toHaveAttribute('aria-pressed', 'true')   // the default
    await expect(tid(page, 'studio-preview')).toBeVisible(); await expect(tid(page, 'studio-code')).toBeVisible()
    await tid(page, 'studio-view-code').click()
    await expect(tid(page, 'studio-code')).toBeVisible(); await expect(tid(page, 'studio-preview')).toHaveCount(0)
    await tid(page, 'studio-view-preview').click()
    await expect(tid(page, 'studio-preview')).toBeVisible(); await expect(tid(page, 'studio-code')).toBeHidden()
    await expect(tid(page, 'studio-view-preview')).toHaveAttribute('aria-pressed', 'true')
    await page.reload()
    await editFromManager(page, 'agent-made')
    await expect(tid(page, 'studio-view-preview')).toHaveAttribute('aria-pressed', 'true')   // remembered in this browser
  })

  test('line wrap is a toggle in the header: long lines wrap or scroll, in the code, the prompt and the viewer, and the choice is remembered', async ({ page }) => {
    await editFromManager(page, 'agent-made')
    const long = `/**\n * ${'a long documentation line '.repeat(12)}\n * What it does: x. Detects: x. Maps: x. Leaves in place: x. Needs: x. Limits: x.\n */\nexport default { id: 'agent-made', name: 'Agent made', async detect() { return { match: 0 } }, async plan() { return { ops: [] } } }`
    await typeInto(page, 'studio-code', long)
    await expect(tid(page, 'studio-wrap')).toHaveAttribute('aria-pressed', 'true')   // on by default
    await expect(tid(page, 'studio-code')).toHaveAttribute('data-wrap', 'true')
    await expect(tid(page, 'studio-code').locator('.cm-lineWrapping')).toHaveCount(1)
    await expect(tid(page, 'studio-wrap-state')).toHaveText(t('studio.wrapState'))
    await tid(page, 'studio-wrap').click()
    await expect(tid(page, 'studio-wrap')).toHaveAttribute('aria-pressed', 'false')
    await expect(tid(page, 'studio-code')).toHaveAttribute('data-wrap', 'false')
    await expect(tid(page, 'studio-code').locator('.cm-lineWrapping')).toHaveCount(0)
    await expect(tid(page, 'studio-wrap-state')).toHaveText(t('studio.noWrapState'))
    await expect(tid(page, 'studio-code-content')).toContainText('a long documentation line')   // the text is untouched, and so is what you typed
    await expect(tid(page, 'studio-dirty-code')).toBeVisible()
    await tid(page, 'studio-tab-prompt').click()
    await expect(tid(page, 'studio-prompt')).toHaveAttribute('data-wrap', 'false')   // one toggle for every editor
    await page.reload()
    await editFromManager(page, 'agent-made')
    await expect(tid(page, 'studio-wrap')).toHaveAttribute('aria-pressed', 'false')   // remembered in this browser
    await tid(page, 'studio-wrap').click()
    await expect(tid(page, 'studio-code').locator('.cm-lineWrapping')).toHaveCount(1)
  })

  test('typing writes nothing: there is no autosave; Save is explicit and the tab shows it is modified', async ({ page, api }) => {
    await editFromManager(page, 'agent-made')
    await expect(tid(page, 'studio-save')).toBeDisabled()
    await expect(tid(page, 'studio-saved-state')).toHaveText(t('studio.savedState'))
    await typeInto(page, 'studio-code', MODULE('agent-made'))
    await expect(tid(page, 'studio-dirty-code')).toBeVisible()
    await expect(tid(page, 'studio-saved-state')).toHaveText(t('studio.modified'))
    await page.waitForTimeout(2500)   // longer than any debounce
    expect(api.state.studio.saves).toEqual([])   // nothing was saved by itself
    await tid(page, 'studio-save').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('studio.saved', { id: 'agent-made' }) })).toBeVisible()
    expect(api.state.studio.saves).toHaveLength(1); expect(api.state.studio.saves[0].text).toBe(MODULE('agent-made'))
    await expect(tid(page, 'studio-dirty-code')).toHaveCount(0)
    await expect(tid(page, 'studio-saved-state')).toHaveText(t('studio.savedState'))
  })

  test('the structure is checked as you type and the problems say what is wrong', async ({ page }) => {
    await editFromManager(page, 'agent-made')
    await typeInto(page, 'studio-code', "export default { id: 'agent-made', name: 'x' }")
    await expect(tid(page, 'studio-problem-count')).not.toHaveText('0')
    await expect(tid(page, 'studio-problems')).toContainText('detect')
    await expect(tid(page, 'studio-problems')).toContainText('documentation header')
    await expect(tid(page, 'studio-valid')).toHaveText(t('studio.notValid'))
    await typeInto(page, 'studio-code', MODULE('agent-made'))
    await expect(tid(page, 'studio-problem-count')).toHaveText('0')
    await expect(tid(page, 'studio-valid')).toHaveText(t('studio.valid'))
  })

  test('closing or switching with unsaved changes asks first', async ({ page }) => {
    await editFromManager(page, 'agent-made')
    await typeInto(page, 'studio-code', MODULE('agent-made'))
    await expect(tid(page, 'studio-code-content')).toContainText('Edited by hand')
    await expect(tid(page, 'studio-dirty-code')).toBeVisible()
    const asked = []
    page.on('dialog', (d) => { asked.push(d.message()); d.dismiss() })
    await tid(page, 'studio-close').click()
    await expect.poll(() => asked).toEqual([t('studio.confirmClose')])
    await expect(studio(page)).toBeVisible()   // dismissed: still here
    await studio(page).locator('[data-testid="studio-adapter"][data-id="comfy-shared"]').click()
    await expect.poll(() => asked.length).toBe(2)
    await expect(tid(page, 'studio-id')).toHaveValue('agent-made')
    page.removeAllListeners('dialog'); page.once('dialog', (d) => d.accept())
    await tid(page, 'studio-close').click()
    await expect(studio(page)).toBeHidden()
  })

  test('the name and the id are fields in the header and write into the code; saving lists the adapter under its name', async ({ page, api }) => {
    await editFromManager(page, 'agent-made')
    await tid(page, 'studio-name').fill('Shots from Kyle, round 3')
    await expect(tid(page, 'studio-code-content')).toContainText("'Shots from Kyle, round 3'")
    await expect(tid(page, 'studio-dirty-code')).toBeVisible()
    await tid(page, 'studio-save').click()
    await expect(studio(page).locator('[data-testid="studio-adapter"][data-id="agent-made"]')).toContainText('Shots from Kyle, round 3')
    expect(api.state.imports.adapters.find((a) => a.id === 'agent-made').name).toBe('Shots from Kyle, round 3')
  })

  test('a built-in is editable: its name and id stay, saving makes it modified, Reset brings the shipped one back', async ({ page, api }) => {
    await editFromManager(page, 'comfy-shared')
    await expect(tid(page, 'studio-id')).toBeDisabled(); await expect(tid(page, 'studio-name')).toBeDisabled()
    await expect(tid(page, 'studio-reset')).toHaveCount(0)
    await typeInto(page, 'studio-code', MODULE('comfy-shared', 'A ComfyUI-Shared folder'))
    await tid(page, 'studio-save').click()
    await expect(tid(page, 'studio-builtin-badge')).toHaveText(t('studio.builtinModified'))
    await expect(studio(page).locator('[data-testid="studio-adapter"][data-id="comfy-shared"]').getByTestId('studio-modified-dot')).toBeVisible()
    await expect(tid(page, 'studio-reset')).toBeVisible()
    page.once('dialog', (d) => d.accept())
    await tid(page, 'studio-reset').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('studio.wasReset', { id: 'comfy-shared' }) })).toBeVisible()
  })

  test('Document has Claude write the header from the code: only the header changes', async ({ page, api }) => {
    await editFromManager(page, 'agent-made')
    await tid(page, 'studio-document').click()
    await expect(tid(page, 'studio-code-content')).toContainText('Documented by Claude')
    expect(api.state.studio.documented).toEqual(['agent-made'])
    await expect(tid(page, 'studio-note').filter({ hasText: t('studio.documented', { id: 'agent-made' }) })).toBeVisible()
  })
})

test.describe('Adapter Studio: the prompt', () => {
  test('is a tab beside the code, is text you edit yourself, and is saved with Save', async ({ page, api }) => {
    await editFromManager(page, 'agent-made')
    await tid(page, 'studio-tab-prompt').click()
    await expect(tid(page, 'studio-path')).toHaveText('/home/me/.config/runpod-pod-manager/adapters/agent-made.prompt.md')
    await expect(tid(page, 'studio-prompt-hint')).toContainText(t('studio.promptHint'))
    await expect(tid(page, 'studio-status')).toContainText('Markdown')
    await typeInto(page, 'studio-prompt', 'Map shotA/comfy/input to input/. Leave the finals.')
    await expect(tid(page, 'studio-dirty-prompt')).toBeVisible()
    expect(api.state.imports.prompts['agent-made']).toBeUndefined()   // not written by typing
    await tid(page, 'studio-save').click()
    await expect(page.getByTestId('toast').filter({ hasText: t('studio.saved', { id: 'agent-made' }) })).toBeVisible()
    await expect.poll(() => api.state.imports.prompts['agent-made']).toBe('Map shotA/comfy/input to input/. Leave the finals.')
    await expect(tid(page, 'studio-dirty-prompt')).toHaveCount(0)
  })
})

test.describe('Adapter Studio: the package', () => {
  test('is a tree of files and folders, each marked with what the adapter does with it', async ({ page }) => {
    await editFromManager(page, 'panama-imax-redux')
    await expect(tid(page, 'studio-nopackage')).toContainText(t('studio.attachHint'))
    await attach(page)
    const row = (path) => studio(page).locator(`[data-testid="studio-package-row"][data-path="${path}"]`)
    await expect(row('shotA/comfy/input/ref.png')).toHaveAttribute('data-status', 'copy')
    await expect(row('shotA/comfy/input/ref.png')).toContainText('input/shots/shotA/ref.png')
    await expect(row('shotA/final/shotA.mov')).toHaveAttribute('data-status', 'left')
    await expect(row('shotA/final/shotA.mov')).toContainText(t('studio.leftInPlace'))
    await expect(row('README.md')).toHaveAttribute('data-status', 'unmatched')   // a gap in the mapping shows as a file nobody mentions
    await expect(row('README.md')).toContainText(t('studio.notMatched'))
    await expect(row('shotA/comfy')).toHaveAttribute('data-dir', 'true')
    await row('shotA/comfy').click()   // a folder collapses
    await expect(row('shotA/comfy/input/ref.png')).toHaveCount(0)
    await row('shotA/comfy').click()
    await expect(row('shotA/comfy/input/ref.png')).toBeVisible()
  })

  test('a file opens read-only in a viewer tab: text, JSON pretty-printed, an image, or just its size', async ({ page, api }) => {
    api.state.studio.files['pic.png'] = { kind: 'image', bytes: 70, data_url: 'data:image/png;base64,iVBORw0KGgo=' }
    api.state.studio.files['blob.bin'] = { kind: 'binary', bytes: 3 }
    await editFromManager(page, 'panama-imax-redux')
    await attach(page)
    const pick = (p) => studio(page).locator(`[data-testid="studio-package-row"][data-path="${p}"]`).click()
    await pick('README.md')
    await expect(tid(page, 'studio-tab-file')).toContainText('README.md')
    await expect(tid(page, 'studio-viewer-code-content')).toContainText('The graphs are in shotA/comfy/workflows')
    await expect(tid(page, 'studio-viewer-code')).toHaveAttribute('data-readonly', 'true')
    await pick('MANIFEST.json')
    await expect(tid(page, 'studio-viewer-code-content')).toContainText('"for": "Brynley"')
    await studio(page).locator('[data-testid="studio-package-row"][data-path="MANIFEST.json"]').click()
    api.state.studio.tree.entries.push({ path: 'pic.png', dir: false, bytes: 70 }, { path: 'blob.bin', dir: false, bytes: 3 })
    await tid(page, 'studio-attach').click()
    await pick('pic.png')
    await expect(tid(page, 'studio-viewer-image')).toBeVisible()
    await pick('blob.bin')
    await expect(tid(page, 'studio-viewer-binary')).toContainText('blob.bin')
    await tid(page, 'studio-file-close').click()
    await expect(tid(page, 'studio-tab-file')).toHaveCount(0)
    await expect(tid(page, 'studio-tab-code')).toHaveClass(/active/)
  })

  test('Preview: the adapter\'s own words, the plan by kind, findings, the package tree and the destination tree', async ({ page }) => {
    await editFromManager(page, 'panama-imax-redux')
    await expect(tid(page, 'studio-preview-nofolder')).toContainText(t('studio.previewNoFolder'))
    await expect(tid(page, 'studio-preview-header')).toContainText('What it does: maps a package folder onto ComfyUI-Shared')
    await attach(page)
    await expect(tid(page, 'studio-preview-summary')).toContainText('Inputs 30')
    await expect(tid(page, 'studio-preview-summary')).toContainText(t('import.fenced'))
    await expect(tid(page, 'studio-preview-finding').first()).toContainText('ComfyUI 0.39.2')
    const dest = (p) => tid(page, 'studio-preview-dest').locator(`[data-testid="studio-preview-dest-row"][data-path="${p}"]`)
    await expect(dest('input/shots/shotA/ref.png')).toBeVisible()
    await expect(dest('workflows/panama-imax-redux/round/shotA-v01.json')).toBeVisible()
    await expect(tid(page, 'studio-preview-source').locator('[data-testid="studio-preview-source-row"][data-path="shotA/final/shotA.mov"]')).toHaveAttribute('data-status', 'left')
  })

  test('Preview of an adapter that has no documentation header says so; an unsaved one asks to be saved', async ({ page, api }) => {
    api.state.imports.sources['agent-made'] = "export default { id: 'agent-made', name: 'Agent made' }"
    await editFromManager(page, 'agent-made')
    await expect(tid(page, 'studio-preview-nodoc')).toContainText(t('studio.noHeader'))
    await tid(page, 'studio-tab-code').click()
    await studio(page).getByTestId('studio-new').click()
    await attach(page)
    await expect(tid(page, 'studio-preview-unsaved')).toContainText(t('studio.previewSaveFirst'))
  })
})

const say = (text) => ({ kind: 'text', text })
const toolEv = (name, input, summary, changed, ok = true) => ({ kind: 'tool', name, input, ok, summary, ...(changed ? { changed } : {}) })
const startChat = async (page, text) => { await tid(page, 'studio-input').fill(text); await tid(page, 'studio-send').click() }

test.describe('Adapter Studio: the chat with Claude', () => {
  test('you can type right away; the card says what the first message carries; Send starts it, and nothing was sent before', async ({ page, api }) => {
    withKey(api)
    await editFromManager(page, 'panama-imax-redux')
    await attach(page)
    await expect(tid(page, 'studio-input')).toBeEnabled()
    await tid(page, 'studio-input').fill('The graphs are in shotA/comfy/workflows')
    await expect(tid(page, 'studio-context')).toContainText(t('studio.contextRule'))
    await expect(tid(page, 'studio-context-counts')).toContainText('11 files')
    await expect(tid(page, 'studio-context-text')).toHaveText([/MANIFEST\.json/, /README\.md/])
    await expect(tid(page, 'studio-context-send')).toContainText(t('studio.contextSendStarts'))
    expect(api.state.studio.steps).toBe(0)   // nothing sent yet
    await tid(page, 'studio-send').click()
    await expect(tid(page, 'studio-msg-user')).toHaveText('The graphs are in shotA/comfy/workflows')
    await expect(tid(page, 'studio-msg-assistant')).toHaveText('Noted.')
    await expect(tid(page, 'studio-context')).toHaveCount(0)   // said once, then out of the way
    expect(api.state.studio.sent[0].folder).toBe(PKG); expect(api.state.studio.sent[0].messages[0]).toEqual({ role: 'user', content: 'The graphs are in shotA/comfy/workflows' })
    await expect(tid(page, 'studio-calls')).toHaveText(t('studio.calls', { n: 1 }))
  })

  test('without a key you can still type and edit, Send says why it is off, and the way to the key is one click', async ({ page }) => {
    await editFromManager(page, 'agent-made')
    await expect(tid(page, 'studio-input')).toBeEnabled()
    await tid(page, 'studio-input').fill('hello')
    await expect(tid(page, 'studio-send')).toBeDisabled()
    await expect(tid(page, 'studio-context-nokey')).toContainText(t('studio.noKey'))
    await tid(page, 'studio-setkey').click()
    await expect(page.locator('.modal.show', { has: page.getByTestId('config-modal') }).getByTestId('cfg-claude-key')).toBeVisible()
  })

  test('chat builds the prompt, the prompt builds the adapter: each tool call shows as it lands, and the prompt and the code appear in their tabs', async ({ page, api }) => {
    withKey(api)
    const st = api.state
    st.studio.turns.push(
      () => ({ events: [say('Let me read the README.'), toolEv('read_folder_file', { path: 'README.md' }, 'README.md')], done: false }),
      (_s, fx) => { fx.imports.prompts['shots-a'] = 'Map shotA/comfy/input to input/. Leave the finals.'; return { events: [toolEv('update_prompt', { id: 'shots-a' }, 'shots-a: prompt 51 characters', 'prompt')], done: false, created: ['shots-a'], adapter: 'shots-a' } },
      (_s, fx) => {
        fx.imports.adapters.push({ id: 'shots-a', name: 'Shots A', version: 1, builtin: false, sha256: 'f'.repeat(64), file: '/home/me/.config/runpod-pod-manager/adapters/shots-a.mjs' })
        fx.imports.sources['shots-a'] = MODULE('shots-a', 'Shots A')
        return { events: [toolEv('build_adapter', { id: 'shots-a' }, 'shots-a: valid', 'code')], done: false }
      },
      () => ({ events: [toolEv('validate_adapter', { id: 'shots-a' }, 'structure ok'), toolEv('test_adapter', { id: 'shots-a' }, '1 files to copy')], done: false }),
      () => ({ events: [say('Built and tested: it plans 1 file.')], done: true }),
    )
    await editFromManager(page, 'panama-imax-redux')
    await tid(page, 'studio-new').click()
    await attach(page)
    await startChat(page, 'Build an adapter for this package: inputs to input/, leave the finals')
    await expect(tid(page, 'studio-msg-assistant').last()).toHaveText('Built and tested: it plans 1 file.')
    await expect(tid(page, 'studio-tool')).toHaveText([/read_folder_file/, /update_prompt/, /build_adapter/, /validate_adapter/, /test_adapter/])
    await expect(tid(page, 'studio-tool').first()).toHaveAttribute('data-ok', 'true')
    expect(st.studio.steps).toBe(5)
    await expect(tid(page, 'studio-id')).toHaveValue('shots-a')   // the chat named the adapter
    await expect(tid(page, 'studio-code-content')).toContainText("id: 'shots-a'")   // the built module is in the editor
    await expect(tid(page, 'studio-dirty-code')).toHaveCount(0)   // written by the build, so nothing is unsaved
    await tid(page, 'studio-tab-prompt').click()
    await expect(tid(page, 'studio-prompt-content')).toContainText('Map shotA/comfy/input to input/. Leave the finals.')
    // the conversation went back with every step, tool results included
    expect(st.studio.sent[4].messages.length).toBeGreaterThanOrEqual(1)
    await expect(tid(page, 'studio-calls')).toHaveText(t('studio.calls', { n: 5 }))
  })

  test('a tool that fails shows as failed and the chat goes on', async ({ page, api }) => {
    withKey(api)
    api.state.studio.turns.push(() => ({ events: [toolEv('build_adapter', { id: 'x' }, 'the prompt is empty: write it with update_prompt first', undefined, false)], done: false }), () => ({ events: [say('I will write the prompt first.')], done: true }))
    await editFromManager(page, 'agent-made')
    await startChat(page, 'build it')
    await expect(tid(page, 'studio-tool')).toHaveAttribute('data-ok', 'false')
    await expect(tid(page, 'studio-tool')).toContainText('the prompt is empty')
    await expect(tid(page, 'studio-msg-assistant')).toHaveText('I will write the prompt first.')
  })

  test('your own edits are never overwritten by the chat: an unsaved prompt or code is kept and the screen says so', async ({ page, api }) => {
    withKey(api)
    api.state.studio.turns.push(
      (_s, fx) => { fx.imports.prompts['agent-made'] = "Claude's version of the prompt"; return { events: [toolEv('update_prompt', { id: 'agent-made' }, 'agent-made: prompt', 'prompt')], done: false } },
      (_s, fx) => { fx.imports.sources['agent-made'] = MODULE('agent-made', 'By Claude'); return { events: [toolEv('build_adapter', { id: 'agent-made' }, 'valid', 'code')], done: false } },
      () => ({ events: [say('done')], done: true }),
    )
    await editFromManager(page, 'agent-made')
    await tid(page, 'studio-tab-prompt').click()
    await typeInto(page, 'studio-prompt', 'My own prompt, not saved yet')
    await tid(page, 'studio-tab-code').click()
    await typeInto(page, 'studio-code', MODULE('agent-made', 'Mine'))
    await startChat(page, 'rebuild it')
    await expect(tid(page, 'studio-msg-assistant')).toHaveText('done')
    await expect(tid(page, 'studio-note').filter({ hasText: t('studio.promptKept') })).toBeVisible()
    await expect(tid(page, 'studio-note').filter({ hasText: t('studio.codeKept') })).toBeVisible()
    await expect(tid(page, 'studio-code-content')).toContainText("name: 'Mine'")
    await tid(page, 'studio-tab-prompt').click()
    await expect(tid(page, 'studio-prompt-content')).toContainText('My own prompt, not saved yet')
  })

  test('Stop ends the conversation between steps', async ({ page, api }) => {
    withKey(api)
    api.state.studio.delay = 400   // each step takes a moment, so there is a gap to press Stop in
    for (let i = 0; i < 6; i++) api.state.studio.turns.push(() => ({ events: [toolEv('list_adapters', {}, '3 adapters')], done: false }))
    await editFromManager(page, 'agent-made')
    await startChat(page, 'keep going')
    await expect(tid(page, 'studio-stop')).toBeVisible()
    await tid(page, 'studio-stop').click({ force: true })
    await expect(tid(page, 'studio-note').filter({ hasText: t('studio.stopped') })).toBeVisible()
    expect(api.state.studio.steps).toBeLessThan(6)
  })

  test('a conversation is capped at ten steps per message', async ({ page, api }) => {
    withKey(api)
    for (let i = 0; i < 12; i++) api.state.studio.turns.push(() => ({ events: [toolEv('list_adapters', {}, '3 adapters')], done: false }))
    await editFromManager(page, 'agent-made')
    await startChat(page, 'loop')
    await expect(tid(page, 'studio-note').filter({ hasText: t('studio.maxSteps', { n: 10 }) })).toBeVisible()
    expect(api.state.studio.steps).toBe(10)
  })
})

test.describe('Adapter Studio: the agent checks every Save', () => {
  test('a clean save says nothing more; a save Claude had to fix shows each round in the chat and in the code', async ({ page, api }) => {
    withKey(api)
    await editFromManager(page, 'agent-made')
    await attach(page)
    await typeInto(page, 'studio-code', MODULE('agent-made', 'Edited'))
    api.state.studio.nextSave = { valid: true, errors: [], text: MODULE('agent-made', 'Fixed by Claude'), rounds: [{ round: 1, errors: ['running it on the attached folder: op 0: ../x leaves its folder'], fixed: true }] }
    await tid(page, 'studio-save').click()
    await expect(tid(page, 'studio-round')).toContainText(t('studio.roundFixed', { n: 1, errors: 1 }))
    await expect(tid(page, 'studio-code-content')).toContainText('Fixed by Claude')   // the fixed code replaced the typed text, and is the saved one
    await expect(tid(page, 'studio-dirty-code')).toHaveCount(0)
    expect(api.state.studio.saves.at(-1).folder).toBe(PKG)   // the check ran against the attached folder
  })

  test('when three rounds do not fix it, the adapter stays saved, marked not valid, with the errors in Problems', async ({ page, api }) => {
    withKey(api)
    await editFromManager(page, 'agent-made')
    await typeInto(page, 'studio-code', MODULE('agent-made', 'Still wrong'))
    const errors = ['running it on the attached folder: op 0: ../x leaves its folder']
    api.state.studio.nextSave = { valid: false, errors, text: MODULE('agent-made', 'Still wrong'), rounds: [1, 2, 3].map((round) => ({ round, errors, fixed: false })) }
    await tid(page, 'studio-save').click()
    await expect(tid(page, 'studio-round')).toHaveCount(3)
    await expect(tid(page, 'studio-round').first()).toContainText(t('studio.roundFailed', { n: 1, errors: 1 }))
    await expect(tid(page, 'studio-note').filter({ hasText: t('studio.savedNotValid', { id: 'agent-made', n: 1 }) })).toBeVisible()
    expect(api.state.studio.saves).toHaveLength(1)
  })
})
