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
    ctx = await launchApp({ dry: true, env: { DRY_PODS_FILE: join(base, 'dry-pods.json'), MOUNTS_FILE: join(base, 'mounts.json'), POD_MANAGER_ADAPTERS_DIR: adapters, POD_MANAGER_IMPORTS_DIR: join(base, 'imports') } })
  })
  test.afterAll(async () => { await ctx.app.close() })

  const open = async (page) => {
    await podCard(page, 'ComfyUI-Import').getByTestId('pod-import').click()
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

  test('your own adapter is read and approved in the app, then plans the folder', async () => {
    const { page } = ctx
    mkdirSync(adapters, { recursive: true })
    writeFileSync(join(adapters, 'mine.mjs'), "export default { id: 'mine', name: 'Mine', version: 1, async detect(root, ctx) { return { match: 0.2, evidence: [] } }, async plan(root, ctx) { return { ops: [{ op: 'copy', kind: 'input', from: 'shotA/comfy/input/shots/shotA/ref.png', to: 'input/mine/ref.png' }], findings: [{ level: 'info', text: 'hello from mine' }] } } }")
    await page.locator('.modal.show', { hasText: t('import.title') }).getByRole('button', { name: t('connect.done') }).click()
    await expect(page.locator('.modal.show')).toHaveCount(0)
    const dialog = await open(page)
    const row = dialog.locator('[data-testid="import-adapter-row"][data-id="mine"]')
    await expect(row.getByTestId('import-adapter-state')).toHaveText(t('import.notApproved'))
    await row.getByTestId('import-adapter-read').click()                                   // imports.source
    const reading = page.locator('.modal.show', { hasText: 'mine' }).last()
    await expect(reading.getByTestId('import-source')).toContainText("id: 'mine'")
    await reading.getByTestId('import-approve').click()                                    // imports.approve
    await expect(row.getByTestId('import-adapter-state')).toHaveText(t('import.approved'))
    await dialog.getByTestId('import-folder').fill(pkg)
    await dialog.getByTestId('import-adapter').selectOption('mine')
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-plan-adapter')).toHaveText('mine')
    await expect(dialog.locator('[data-testid="import-finding"]')).toContainText('hello from mine')
  })
})
