import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launchApp, podCard } from './app.js'
import { t } from '../e2e/i18n.js'

// Import Shot Pack in the real app (docs/ADR-008): the adapters run in a child of the app's own executable under
// Node's permission fence, the plan comes back over IPC, and Import really copies into the mapped ComfyUI-Shared.
const sha = (s) => createHash('sha256').update(s).digest('hex')
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }

test.describe('Import Shot Pack over IPC', () => {
  test.describe.configure({ mode: 'serial' })
  let ctx, base, shared, pkg, adapters
  test.beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), 'runpod-import-'))
    shared = join(base, 'ComfyUI-Shared'); mkdirSync(shared)
    adapters = join(base, 'adapters')
    pkg = join(base, 'brynley-comfy-test')
    const files = { 'shotA/comfy/input/shots/shotA/ref.png': 'PNG', 'shotA/comfy/workflows/shotA-v01.json': '{"nodes":[]}', 'shotA/final/shotA.mov': 'FINAL' }
    for (const [p, tx] of Object.entries(files)) put(pkg, p, tx)
    put(pkg, 'shotA/MANIFEST.json', JSON.stringify({ shot: 'shotA', graph: 'g', node_types: ['LoadImage'], files: Object.entries(files).map(([path, tx]) => ({ path, sha256: sha(tx), bytes: tx.length })) }))
    put(pkg, 'MANIFEST.json', JSON.stringify({ built: '2026-10-24', for: 'Brynley', shots: { shotA: {} } }))
    writeFileSync(join(base, 'mounts.json'), JSON.stringify({ network_volume_id: 'vol-test', folders: { 'comfy-shared': shared } }))
    // the pod card carries the button: one simulated pod, in place before the app starts
    writeFileSync(join(base, 'dry-pods.json'), JSON.stringify([{ id: 'dry-import01', name: 'ComfyUI-Import', gpu: 'auto', gpu_count: 1, image: 'comfy-app:contract-v26', status: 'running', started_at: new Date().toISOString(), idle_stop_minutes: 30 }]))
    ctx = await launchApp({ dry: true, env: { ANTHROPIC_API_KEY: '', DRY_PODS_FILE: join(base, 'dry-pods.json'), MOUNTS_FILE: join(base, 'mounts.json'), POD_MANAGER_ADAPTERS_DIR: adapters, POD_MANAGER_IMPORTS_DIR: join(base, 'imports') } })
  })
  test.afterAll(async () => { await ctx.app.close() })

  const open = async (page) => {
    await podCard(page, 'ComfyUI-Import').getByTestId('pod-import').click()
    await page.getByTestId('import-source-folder').click()   // the source picker is always first
    const dialog = page.locator('.modal.show', { hasText: t('import.title') })
    await expect(dialog.getByTestId('import-pane')).toBeVisible()
    return dialog
  }

  test('plans the package with the built-in adapter, fenced, and imports it into ComfyUI-Shared', async () => {
    const { page } = ctx
    const dialog = await open(page)
    await expect(dialog.getByTestId('import-target-path')).toHaveText(shared)
    await expect(dialog.locator('[data-testid="import-adapter-row"][data-id="panama-imax-redux"]')).toBeVisible()   // imports.list
    await dialog.getByTestId('import-folder').fill(pkg)
    await dialog.getByTestId('import-plan').click()                                        // imports.plan, in a fenced child
    await expect(dialog.getByTestId('import-plan-adapter')).toHaveText('panama-imax-redux')
    await expect(dialog.getByTestId('import-fenced')).toHaveText(t('import.fenced'))       // this Electron's Node supports --permission
    await expect(dialog.locator('[data-testid="import-kind"][data-kind="input"]')).toContainText('1')
    await dialog.getByTestId('import-dry').click()                                         // imports.apply, dry
    await expect(dialog.getByTestId('import-count-would-copy')).toContainText('2')
    expect(existsSync(join(shared, 'input'))).toBe(false)
    await dialog.getByTestId('import-run').click()                                         // imports.apply
    await expect(dialog.getByTestId('import-count-copied')).toContainText('2')
    await expect(page.getByTestId('toast').filter({ hasText: t('import.toastDone', { n: 2 }) })).toBeVisible()
    expect(readFileSync(join(shared, 'input/shots/shotA/ref.png'), 'utf8')).toBe('PNG')
    expect(existsSync(join(shared, 'workflows/panama-imax-redux/brynley-comfy-test/shotA-v01.json'))).toBe(true)
    expect(existsSync(join(shared, 'final'))).toBe(false)                                   // left where it was
    expect(readFileSync(join(pkg, 'shotA/final/shotA.mov'), 'utf8')).toBe('FINAL')
    // a simulated pod is not synced to: the app says so (imports.syncAfter), without asking for configuration
    await expect(page.getByTestId('toast').filter({ hasText: t('import.syncSimulated', { name: 'ComfyUI-Import' }) })).toBeVisible()
  })

  test('a second import finds everything already there', async () => {
    const dialog = ctx.page.locator('.modal.show', { hasText: t('connect.title') })
    await dialog.getByTestId('import-run').click()
    await expect(dialog.getByTestId('import-count-same')).toContainText('2')
    await expect(dialog.getByTestId('import-result')).toHaveAttribute('data-ok', 'true')
  })

  test('the Studio over IPC: every adapter is editable, built-ins by override; yours is created, saved, used and deleted, on disk', async () => {
    const { page } = ctx
    await page.locator('.modal.show', { hasText: t('import.title') }).getByRole('button', { name: t('connect.done') }).click()
    await expect(page.locator('.modal.show')).toHaveCount(0)
    await page.getByTestId('open-config').click()
    const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await cfg.getByTestId('cfg-tab-adapters').click()
    const mgr = cfg.getByTestId('adapter-manager')
    await expect(mgr.locator('[data-testid="adapter-row"][data-id="panama-imax-redux"]').getByTestId('adapter-builtin')).toBeVisible()   // imports.list
    const studio = page.getByTestId('studio')
    const typeInto = async (testid, text) => { const c = studio.getByTestId(`${testid}-content`); await expect(async () => { await c.click(); await expect(c).toBeFocused({ timeout: 500 }) }).toPass({ timeout: 8000 }); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(text) }
    // Edit a built-in: its code, its documentation, read-only name and id (imports.source, imports.getPrompt)
    await mgr.locator('[data-testid="adapter-row"][data-id="comfy-shared"]').getByTestId('adapter-edit').click()
    await expect(studio.getByTestId('app-brand')).toContainText(t('app.title'))
    await expect(studio.getByTestId('studio-code-content')).toContainText("id: 'comfy-shared'")
    await expect(studio.getByTestId('studio-builtin-badge')).toHaveText(t('studio.builtIn'))
    await expect(studio.getByTestId('studio-problem-count')).toHaveText('0')   // the shipped adapters pass the structure check, documentation header included
    // edit it: a real override file, the shipped one untouched; then Reset
    const shipped = (await import('node:fs')).readFileSync(join(import.meta.dirname, '..', 'libs', 'core', 'runtime', 'adapters', 'comfy-shared.mjs'), 'utf8')
    await typeInto('studio-code', shipped.replace("name: 'A ComfyUI-Shared folder'", "name: 'Shared, my way'"))
    await studio.getByTestId('studio-save').click()                                        // studio.saveChecked
    await expect(studio.getByTestId('studio-builtin-badge')).toHaveText(t('studio.builtinModified'))
    expect(readFileSync(join(adapters, 'comfy-shared.mjs'), 'utf8')).toContain("name: 'Shared, my way'")
    expect(readFileSync(join(import.meta.dirname, '..', 'libs', 'core', 'runtime', 'adapters', 'comfy-shared.mjs'), 'utf8')).toBe(shipped)
    page.once('dialog', (d) => d.accept())
    await studio.getByTestId('studio-reset').click()                                       // imports.remove: Reset
    await expect(studio.getByTestId('studio-builtin-badge')).toHaveText(t('studio.builtIn'))
    expect(existsSync(join(adapters, 'comfy-shared.mjs'))).toBe(false)
    await studio.getByTestId('studio-close').click()
    // New adapter: the template passes the structure check; name and id are fields; Save writes the file
    await mgr.getByTestId('adapter-new').click()
    await expect(studio.getByTestId('studio-problem-count')).toHaveText('0')
    await studio.getByTestId('studio-id').fill('mine')
    await studio.getByTestId('studio-name').fill('Mine (test)')
    await typeInto('studio-code', `/**
 * Mine (test): copies one file. What it does: copies the reference still into input/. Detects: nothing (it is picked by name).
 * Maps: shotA/comfy/input/shots/shotA/ref.png to input/mine/ref.png. Leaves in place: everything else. Needs / assumes: that file. Limits: one file.
 */
export default { id: 'mine', name: 'Mine (test)', version: 1, async detect(root, ctx) { return { match: 0.2, evidence: [] } }, async plan(root, ctx) { return { ops: [{ op: 'copy', kind: 'input', from: 'shotA/comfy/input/shots/shotA/ref.png', to: 'input/mine/ref.png' }], findings: [{ level: 'info', text: 'hello from mine' }] } } }`)
    await studio.getByTestId('studio-tab-prompt').click()
    await typeInto('studio-prompt', 'Copy the reference still into input/mine/.')
    await studio.getByTestId('studio-save').click()
    await expect(studio.getByTestId('studio-saved-state')).toHaveText(t('studio.savedState'))
    expect(readFileSync(join(adapters, 'mine.mjs'), 'utf8')).toContain('hello from mine')
    expect(readFileSync(join(adapters, 'mine.prompt.md'), 'utf8')).toBe('Copy the reference still into input/mine/.')
    // attach the package: Preview runs it fenced and the tree says what happens to each file
    await studio.getByTestId('studio-tab-code').click()
    await studio.getByTestId('studio-folder').fill(pkg)
    await studio.getByTestId('studio-attach').click()
    await expect(studio.locator('[data-testid="studio-package-row"][data-path="shotA/comfy/input/shots/shotA/ref.png"]')).toHaveAttribute('data-status', 'copy')
    await expect(studio.locator('[data-testid="studio-package-row"][data-path="shotA/final/shotA.mov"]')).toHaveAttribute('data-status', 'unmatched')
    await expect(studio.getByTestId('studio-preview-finding')).toContainText('hello from mine')
    await studio.locator('[data-testid="studio-package-row"][data-path="MANIFEST.json"]').click()   // the viewer, over studio.file
    await expect(studio.getByTestId('studio-viewer-code-content')).toContainText('"Brynley"')
    await studio.getByTestId('studio-close').click()
    // used straight away: no approval step
    await cfg.getByTestId('config-close').click()
    const dialog = await open(page)
    await dialog.getByTestId('import-folder').fill(pkg)
    await dialog.getByTestId('import-adapter').selectOption('mine')
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-plan-adapter')).toHaveText('mine')
    await expect(dialog.locator('[data-testid="import-finding"]')).toContainText('hello from mine')
    // the same Studio from here: Edit on a row
    await dialog.locator('[data-testid="import-adapter-row"][data-id="mine"]').getByTestId('import-adapter-edit').click()
    await expect(studio.getByTestId('studio-id')).toHaveValue('mine')
    await expect(studio.getByTestId('studio-folder')).toHaveValue(pkg)
    await studio.getByTestId('studio-close').click()
    // Manage adapters, then delete: the file and its prompt are gone
    await dialog.getByTestId('import-manage-adapters').click()
    const cfg2 = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    page.once('dialog', (d) => d.accept())
    await cfg2.locator('[data-testid="adapter-row"][data-id="mine"]').getByTestId('adapter-delete').click()
    await expect(cfg2.locator('[data-testid="adapter-row"][data-id="mine"]')).toHaveCount(0)
    expect(existsSync(join(adapters, 'mine.mjs'))).toBe(false); expect(existsSync(join(adapters, 'mine.prompt.md'))).toBe(false)
  })
})
