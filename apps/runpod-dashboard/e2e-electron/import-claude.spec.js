import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
  let adapterReplies = 0

  test.beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), 'runpod-claude-'))
    pkg = join(base, 'brynley-comfy-test'); adapters = join(base, 'adapters')
    put(pkg, 'shotA/comfy/input/shots/shotA/ref.png', 'PNG'); put(pkg, 'shotA/comfy/workflows/shotA-v01.json', '{}'); put(pkg, 'shotA/final/shotA.mov', 'FINAL-MEDIA-BYTES')
    put(pkg, 'MANIFEST.json', JSON.stringify({ built: '2026-10-24', for: 'Brynley', shots: { shotA: {} } }))
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
        const id = /with id "([^"]+)"/.exec(b.messages[0].content)[1]
        adapterReplies += 1
        // round 1 gets the id wrong and has no detect; round 2 is well formed but plans a path that leaves its folder; round 3 is right
        if (adapterReplies === 1) return reply("```javascript\nexport default { id: 'wrong', name: 'Claude made', async plan() { return { ops: [] } } }\n```")
        const to = adapterReplies === 2 ? '../escape.png' : 'input/shots/shotA/ref.png'
        return reply("```javascript\nexport default { id: '" + id + "', name: 'Claude made', version: 1, async detect() { return { match: 0.1, evidence: [] } }, async plan(root, ctx) { return { ops: [{ op: 'copy', kind: 'input', from: 'shotA/comfy/input/shots/shotA/ref.png', to: '" + to + "' }], findings: [] } } }\n```")
      })
    })
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); port = server.address().port
    ctx = await launchApp({ dry: true, env: { ANTHROPIC_API_URL: `http://127.0.0.1:${port}`, DRY_PODS_FILE: join(base, 'dry-pods.json'), MOUNTS_FILE: join(base, 'mounts.json'), POD_MANAGER_ADAPTERS_DIR: adapters, POD_MANAGER_IMPORTS_DIR: join(base, 'imports') } })
  })
  test.afterAll(async () => { await ctx.app.close(); server.close() })
  test.describe.configure({ mode: 'serial' })

  test('with no key the Write an adapter button sends you to the key field', async () => {
    const { page } = ctx
    await podCard(page, 'ComfyUI-Claude').getByTestId('pod-import').click()
    const dialog = page.locator('.modal.show', { hasText: t('import.title') })
    await expect(dialog.getByTestId('import-claude-nokey')).toBeVisible()
    await dialog.getByTestId('import-claude').click()
    const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await expect(cfg.getByTestId('cfg-claude-key')).toBeVisible()
    await expect(cfg.getByTestId('cfg-claude-key')).toBeInViewport()   // the panel scrolled to the key field
    await expect(cfg.getByTestId('cfg-claude-key')).toBeFocused()
  })

  test('a wrong key is refused by Test key; the right one is saved, tested and shown as stored', async () => {
    const { page } = ctx
    const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await cfg.getByTestId('cfg-claude-key').fill('sk-ant-api03-WRONGWRONGWRONGWRONG')
    await cfg.getByTestId('cfg-claude-test').click()                                       // settings.set, settings.checkAnthropic
    await expect(cfg.getByTestId('cfg-claude-result')).toHaveAttribute('data-ok', 'false')
    await expect(cfg.getByTestId('cfg-claude-result')).toContainText('invalid x-api-key')
    await cfg.getByTestId('cfg-claude-key').fill(KEY)
    await cfg.getByTestId('cfg-claude-test').click()
    await expect(cfg.getByTestId('cfg-claude-result')).toHaveAttribute('data-ok', 'true')
    await expect(cfg.getByTestId('cfg-claude-group')).toContainText('••••' + KEY.slice(-4))
    expect(seen.filter((s) => s.path.startsWith('/v1/models')).map((s) => s.key)).toEqual(['sk-ant-api03-WRONGWRONGWRONGWRONG', KEY])
    expect(readFileSync(join(ctx.configDir, '.env'), 'utf8')).toContain(`ANTHROPIC_API_KEY=${KEY}`)   // stored where every runtime reads it
    await cfg.getByTestId('config-close').click()
    await expect(page.locator('.modal.show')).toHaveCount(0)
  })

  test('attaching a folder has Claude describe it, with the key; the media is not sent', async () => {
    const { page } = ctx
    await podCard(page, 'ComfyUI-Claude').getByTestId('pod-import').click()
    const dialog = page.locator('.modal.show', { hasText: t('import.title') })
    await expect(dialog.getByTestId('import-claude-ready')).toContainText('••••' + KEY.slice(-4))
    await dialog.getByTestId('import-folder').fill(pkg)
    await dialog.getByTestId('import-plan').click()
    await expect(dialog.getByTestId('import-about-text')).toContainText('one-shot test round')   // imports.describe
    const d = seen.find((s) => s.body?.system?.includes('describe delivery packages'))
    expect(d.key).toBe(KEY); expect(d.body.messages[0].content).toContain('shotA/comfy/input'); expect(d.body.messages[0].content).toContain('"for":"Brynley"')
    expect(JSON.stringify(d.body)).not.toContain('FINAL-MEDIA-BYTES')
  })

  test('Write an adapter with Claude: prompt, structure fails, prompt again, the plan fails, prompt again, valid, used', async () => {
    const { page } = ctx
    const dialog = page.locator('.modal.show', { hasText: t('import.title') })
    await dialog.getByTestId('import-claude').click()
    const ask = page.locator('.modal.show', { hasText: t('import.claudeTitle') })
    await expect(ask.getByTestId('import-claude-counts')).toBeVisible()                     // imports.draftPreview
    await ask.getByTestId('import-claude-instruction').fill('the graphs are under comfy/workflows')
    await ask.getByTestId('import-claude-send').click()                                     // imports.draft, with the key
    await expect(dialog.getByTestId('import-draft-id')).toHaveText('draft-brynley-comfy-test')
    await expect(dialog.getByTestId('import-draft-structure')).toHaveText(t('import.draftStructureBad'))
    await expect(dialog.getByTestId('import-draft-error').first()).toContainText('must be "draft-brynley-comfy-test"')
    expect(existsSync(join(adapters, 'draft-brynley-comfy-test.mjs'))).toBe(true)
    await dialog.getByTestId('import-draft-instruction').fill('use the id I gave and add detect')
    await dialog.getByTestId('import-draft-rewrite').click()
    await expect(dialog.getByTestId('import-draft-structure')).toHaveText(t('import.draftStructureOk'))
    // the errors and the previous source went back with the prompt
    const second = seen.filter((s) => s.path === '/v1/messages' && !s.body.system.includes('describe delivery packages'))[1].body.messages[0].content
    expect(second).toContain("id: 'wrong'"); expect(second).toContain('must be "draft-brynley-comfy-test"'); expect(second).toContain('use the id I gave and add detect')
    await dialog.getByTestId('import-draft-test').click()                                   // imports.plan on the draft, fenced
    await expect(dialog.getByTestId('import-draft-tested')).toHaveText(t('import.draftTestedBad'))
    await expect(dialog.getByTestId('import-draft-error')).toContainText('leaves its folder')
    await dialog.getByTestId('import-draft-instruction').fill('keep every destination inside input/')
    await dialog.getByTestId('import-draft-rewrite').click()
    await dialog.getByTestId('import-draft-test').click()
    await expect(dialog.getByTestId('import-draft-valid')).toBeVisible()
    await dialog.getByTestId('import-draft-use').click()
    await expect(dialog.getByTestId('import-adapter')).toHaveValue('draft-brynley-comfy-test')
    await expect(dialog.getByTestId('import-plan-adapter')).toHaveText('draft-brynley-comfy-test')
    // and it is in Default Configuration with its code open
    await dialog.getByTestId('import-manage-adapters').click()
    const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await cfg.locator('[data-testid="adapter-row"][data-id="draft-brynley-comfy-test"]').getByTestId('adapter-inspect').click()
    await expect(page.locator('.modal.show', { hasText: t('adapters.inspectTitle', { id: 'draft-brynley-comfy-test' }) }).getByTestId('adapter-view-code')).toContainText("name: 'Claude made'")
  })
})
