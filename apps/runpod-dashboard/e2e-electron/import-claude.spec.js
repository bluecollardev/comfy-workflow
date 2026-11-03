import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launchApp, podCard } from './app.js'
import { t } from '../e2e/i18n.js'

// The Anthropic key and everything that uses it, in the real app against a local stand-in for the API (ANTHROPIC_API_URL):
// save and test the key in Default Configuration, have Claude describe an attached folder, and write an adapter in the
// prompt loop until it validates. Nothing reaches Anthropic; the stand-in records what it was sent.
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }
const KEY = 'sk-ant-api03-E2EKEYE2EKEYE2EKEY'

test.describe('The Anthropic key, over IPC', () => {
  let ctx, base, server, port, pkg, adapters
  const seen = []   // what the stand-in was sent: { path, key, body }
  let studioTurns = 0
  const buildPrompts = []

  test.beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), 'runpod-claude-'))
    pkg = join(base, 'brynley-comfy-test'); adapters = join(base, 'adapters')
    put(pkg, 'shotA/comfy/input/shots/shotA/ref.png', 'PNG'); put(pkg, 'shotA/comfy/workflows/shotA-v01.json', '{}'); put(pkg, 'shotA/final/shotA.mov', 'FINAL-MEDIA-BYTES')
    put(pkg, 'MANIFEST.json', JSON.stringify({ built: '2026-10-24', for: 'Brynley', shots: { shotA: {} } })); put(pkg, 'README.md', '# Test round\nThe inputs are in shotA/comfy/input.')
    writeFileSync(join(base, 'mounts.json'), JSON.stringify({ network_volume_id: 'vol-test', folders: { 'comfy-shared': join(base, 'shared') } }))
    writeFileSync(join(base, 'dry-pods.json'), JSON.stringify([{ id: 'dry-claude01', name: 'ComfyUI-Claude', gpu: 'auto', gpu_count: 1, image: 'comfy-app:contract-v26', status: 'running', started_at: new Date().toISOString(), idle_stop_minutes: 30 }]))
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        const key = req.headers['x-api-key']
        seen.push({ path: req.url, key, body: body ? JSON.parse(body) : null })
        res.setHeader('content-type', 'application/json')
        if (key !== KEY) { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'invalid x-api-key' } })) }
        if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [] }))
        const b = JSON.parse(body)
        const reply = (text) => res.end(JSON.stringify({ content: [{ type: 'text', text }] }))
        if (/describe delivery packages/.test(b.system)) return reply('A one-shot test round for Brynley. It carries the graph for shotA, the files it loads, and the approved render.')
        if (/Adapter Studio/.test(b.system)) {   // the Studio's chat: scripted tool use, like a model working through it
          studioTurns += 1
          const use = (id, name, input) => ({ type: 'tool_use', id, name, input })
          const turns = [
            [{ type: 'text', text: 'Let me look at the package.' }, use('t1', 'list_folder', {}), use('t2', 'read_folder_file', { path: 'README.md' })],
            [use('t3', 'update_prompt', { id: 'shots-a', text: 'Map shotA/comfy/input into input/ keeping the shots/<shot>/ paths. Leave shotA/final where it is.' })],
            [use('t4', 'build_adapter', { id: 'shots-a', name: 'Shots A (Claude)' })],
            [use('t5', 'validate_adapter', { id: 'shots-a' }), use('t6', 'test_adapter', { id: 'shots-a' }), use('t7', 'write_file', { path: '/tmp/should-not-exist', text: 'x' }), use('t8', 'update_prompt', { id: '../../evil', text: 'x' })],
          ]
          const content = turns[studioTurns - 1] || [{ type: 'text', text: 'Built, valid, and it plans 1 file.' }]
          res.end(JSON.stringify({ content }))
          return
        }
        // the build: made from the adapter prompt (a different system prompt)
        const id = /with id "([^"]+)"/.exec(b.messages[0].content)[1]
        buildPrompts.push(b.messages[0].content)
        return reply("```javascript\n/**\n * Shots A, written by Claude from its prompt. What it does: maps the package's comfy/input onto input/ and nothing else.\n * Detects: a shotA/comfy folder. Maps: shotA/comfy/input/* to input/*. Leaves in place: shotA/final.\n * Needs / assumes: nothing. Limits: one shot.\n */\nexport default { id: '" + id + "', name: 'Claude made', version: 1, async detect(root, ctx) { return { match: 0.1, evidence: [] } }, async plan(root, ctx) { return { ops: [{ op: 'copy', kind: 'input', from: 'shotA/comfy/input/shots/shotA/ref.png', to: 'input/shots/shotA/ref.png' }, { op: 'note', kind: 'reference', from: 'shotA/final', note: 'left in place' }], findings: [] } } }\n```")
      })
    })
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); port = server.address().port
    // the real key (in the environment or ~/.config/runpod-pod-manager/.env) stays available to every other spec and to the live one; this spec simulates "no key" and brings its own, so it starts with an empty one
    ctx = await launchApp({ dry: true, env: { ANTHROPIC_API_KEY: '', ANTHROPIC_API_URL: `http://127.0.0.1:${port}`, DRY_PODS_FILE: join(base, 'dry-pods.json'), MOUNTS_FILE: join(base, 'mounts.json'), POD_MANAGER_ADAPTERS_DIR: adapters, POD_MANAGER_IMPORTS_DIR: join(base, 'imports') } })
  })
  test.afterAll(async () => { await ctx.app.close(); server.close() })
  test.describe.configure({ mode: 'serial' })

  test('with no key the Studio still opens and lets you type; Send says why it is off and the way to the key is one click', async () => {
    const { page } = ctx
    await podCard(page, 'ComfyUI-Claude').getByTestId('pod-import').click()
    await page.getByTestId('import-source-folder').click()   // the source picker is always first
    const dialog = page.locator('.modal.show', { hasText: t('import.title') })
    await dialog.getByTestId('import-claude').click()                                       // the same modal as Edit and New adapter
    const studio = page.getByTestId('studio')
    await expect(studio).toBeVisible()
    await expect(studio.getByTestId('app-brand')).toContainText(t('app.title'))              // ADR-010: it says which app it is
    await expect(studio.getByTestId('studio-input')).toBeEnabled()
    await studio.getByTestId('studio-input').fill('hello')
    await expect(studio.getByTestId('studio-send')).toBeDisabled()
    await studio.getByTestId('studio-setkey').click()
    const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await expect(cfg.getByTestId('cfg-claude-key')).toBeVisible()
    await expect(cfg.getByTestId('cfg-claude-key')).toBeInViewport()
    await cfg.getByTestId('config-close').click()
    await expect(cfg).toBeHidden()
    await page.getByTestId('studio-close').click()   // nothing was changed, so it closes without asking
    await expect(page.getByTestId('studio')).toBeHidden()
    await page.locator('.modal.show', { hasText: t('import.title') }).getByRole('button', { name: t('connect.done') }).click()
    await expect(page.locator('.modal.show')).toHaveCount(0)
  })

  test('the key tests itself: a wrong one is refused, the right one accepted before it is saved, then saved and checked on reopening', async () => {
    const { page } = ctx
    await page.getByTestId('open-config').click()
    const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await expect(cfg.getByTestId('cfg-claude-test')).toHaveCount(0)                        // no button
    await cfg.getByTestId('cfg-claude-key').fill('sk-ant-api03-WRONGWRONGWRONGWRONG')
    await expect(cfg.getByTestId('cfg-claude-result')).toHaveAttribute('data-ok', 'false')  // settings.checkAnthropic, on its own
    await expect(cfg.getByTestId('cfg-claude-result')).toContainText('invalid x-api-key')
    await cfg.getByTestId('cfg-claude-key').fill(KEY)
    await expect(cfg.getByTestId('cfg-claude-result')).toHaveAttribute('data-ok', 'true')
    expect(existsSync(join(ctx.configDir, '.env')) ? readFileSync(join(ctx.configDir, '.env'), 'utf8') : '').not.toContain('ANTHROPIC_API_KEY')   // tested, not stored
    await cfg.getByTestId('config-save').click()                                           // settings.set
    await expect.poll(() => (existsSync(join(ctx.configDir, '.env')) ? readFileSync(join(ctx.configDir, '.env'), 'utf8') : '')).toContain(`ANTHROPIC_API_KEY=${KEY}`)
    expect(seen.filter((s) => s.path.startsWith('/v1/models')).map((s) => s.key)).toEqual(['sk-ant-api03-WRONGWRONGWRONGWRONG', KEY])
    await expect(page.locator('.modal.show', { has: page.getByTestId('config-modal') })).toHaveCount(0)
    for (const close of await page.getByTestId('toast-close').all()) await close.click().catch(() => {})   // a toast sits over the gear button
    await page.getByTestId('open-config').click()                                          // reopened: the stored key checks itself
    const again = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await expect(again.getByTestId('cfg-claude-group')).toContainText('••••' + KEY.slice(-4))
    await expect(again.getByTestId('cfg-claude-result')).toHaveAttribute('data-ok', 'true')
    expect(seen.filter((s) => s.path.startsWith('/v1/models')).map((s) => s.key)).toEqual(['sk-ant-api03-WRONGWRONGWRONGWRONG', KEY, KEY])
    await again.getByTestId('config-close').click()
    await expect(page.locator('.modal.show')).toHaveCount(0)
  })

  test('attaching a folder has Claude describe it, with the key; the media is not sent', async () => {
    const { page } = ctx
    await podCard(page, 'ComfyUI-Claude').getByTestId('pod-import').click()
    await page.getByTestId('import-source-folder').click()   // the source picker is always first
    const dialog = page.locator('.modal.show', { hasText: t('import.title') })
    await expect(dialog.getByTestId('import-claude-ready')).toContainText('••••' + KEY.slice(-4))
    await dialog.getByTestId('import-folder').fill(pkg)
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-about-text')).toContainText('one-shot test round')   // imports.describe
    const d = seen.find((x) => x.body?.system?.includes('describe delivery packages'))
    expect(d.key).toBe(KEY); expect(d.body.messages[0].content).toContain('shotA/comfy/input'); expect(d.body.messages[0].content).toContain('"for":"Brynley"')
    expect(JSON.stringify(d.body)).not.toContain('FINAL-MEDIA-BYTES')
  })

  test('the Studio chat builds the prompt, the prompt builds the adapter, and Claude writes nothing else', async () => {
    const { page } = ctx
    const dialog = page.locator('.modal.show', { hasText: t('import.title') })
    await expect(dialog.getByTestId('import-folder')).toHaveValue(pkg)   // still attached from the description
    await dialog.getByTestId('import-claude').click()
    const studio = page.getByTestId('studio')
    await expect(studio.getByTestId('studio-id')).toHaveValue('brynley-comfy-test')           // named from the folder
    await expect(studio.getByTestId('studio-folder')).toHaveValue(pkg)
    await expect(studio.getByTestId('studio-context-counts')).toContainText('files')
    expect(seen.filter((x) => x.body?.system?.includes('Adapter Studio'))).toHaveLength(0)    // nothing sent yet
    // the prompt is the person's too: type it into the Prompt tab yourself first
    await studio.getByTestId('studio-id').fill('shots-a')
    await studio.getByTestId('studio-input').fill('Build an adapter for this package: the inputs go to input/, the finals stay put.')
    await studio.getByTestId('studio-send').click()                                           // studio.step, one request at a time
    await expect(studio.getByTestId('studio-msg-assistant').last()).toHaveText('Built, valid, and it plans 1 file.', { timeout: 30_000 })
    await expect(studio.getByTestId('studio-tool')).toHaveText([/list_folder/, /read_folder_file/, /update_prompt/, /build_adapter/, /validate_adapter/, /test_adapter/, /write_file/, /update_prompt/])
    await expect(studio.getByTestId('studio-tool').nth(6)).toHaveAttribute('data-ok', 'false')   // there is no write_file tool
    await expect(studio.getByTestId('studio-tool').nth(7)).toHaveAttribute('data-ok', 'false')   // a traversal id is refused
    await expect(studio.getByTestId('studio-tool').nth(5)).toHaveAttribute('data-ok', 'true')
    // the files: an adapter and its prompt, in the adapters folder, and nothing else anywhere
    expect(readdirSync(adapters).filter((f) => !f.startsWith('.')).sort()).toEqual(['shots-a.mjs', 'shots-a.prompt.md'])
    expect(readFileSync(join(adapters, 'shots-a.prompt.md'), 'utf8')).toContain('Leave shotA/final where it is.')
    expect(existsSync('/tmp/should-not-exist')).toBe(false)
    // built from the prompt (not from the chat), with the folder's material
    expect(buildPrompts).toHaveLength(1)
    expect(buildPrompts[0]).toContain('# The adapter prompt: the source of truth'); expect(buildPrompts[0]).toContain('Leave shotA/final where it is.')
    expect(buildPrompts[0]).not.toContain('Let me look at the package.')
    // the screen shows it: the code, the prompt, the documentation and the preview
    await expect(studio.getByTestId('studio-code-content')).toContainText("name: 'Shots A (Claude)'")
    await expect(studio.getByTestId('studio-preview-header')).toContainText('maps the package')
    await expect(studio.getByTestId('studio-preview-summary')).toContainText('Inputs 1')
    await expect(studio.locator('[data-testid="studio-package-row"][data-path="shotA/final"]')).toHaveAttribute('data-dir', 'true')
    await studio.getByTestId('studio-tab-prompt').click()
    await expect(studio.getByTestId('studio-prompt-content')).toContainText('keeping the shots/<shot>/ paths')
    // every request carried the key, the tools, and the Studio's rules
    const steps = seen.filter((x) => x.body?.system?.includes('Adapter Studio'))
    expect(steps.length).toBeGreaterThanOrEqual(5); expect(steps.every((x) => x.key === KEY)).toBe(true)
    expect(steps[0].body.tools.map((x) => x.name)).toEqual(expect.arrayContaining(['update_prompt', 'build_adapter', 'document_adapter']))
    expect(steps[0].body.tools.map((x) => x.name)).not.toContain('write_file')
    await studio.getByTestId('studio-close').click()
  })
})
