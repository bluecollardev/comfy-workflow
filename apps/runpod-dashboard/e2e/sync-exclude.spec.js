import { test, expect, podCard, modal, cfgTab } from './fixtures'
import { formatBytes } from '../src/sync-progress'
import { t } from './i18n'

// Sync: leave out (v1.5.0): per-run folder ticks and patterns on the Sync window, saved ones from the configuration, Remember for this pod, and the configuration's own textarea.
// The sync calls are the window.__e2eSync stand-in (src/api/sync.js); its count honours `exclude` the way the core does (a 2.1 TB CANALV2 against a 1,000 GB volume).
const TB = 1e12, GB = 1e9, POD = 'pod-aaaaaaaa'
const FOLDERS = { project: { CANALV2: 2.1 * TB, scripts: 1 * GB, Binc: 50 * GB }, plates: { 'plate-a': 10 * GB } }
const calls = (api, method, path) => api.calls.filter((c) => c.method === method && c.path === path)

async function openSync(page, { folders = FOLDERS, noFolders = false, measureMs = 50 } = {}) {
  await page.addInitScript(({ folders, noFolders, measureMs }) => {
    const listeners = [], sizes = folders
    window.__counts = []; window.__cancelled = []; window.__measures = []
    const excluded = (name, ex) => (ex || []).some((p) => p === `/${name}/` || p === `${name}/` || p === name)
    window.__e2eSync = {
      plan: async () => ({ steps: [{ key: 'project', local: '/Users/me/project', remote: '/workspace/project' }, { key: 'plates', local: '/Users/me/plates', remote: '/workspace/plates' }], transport: { kind: 'ssh', reason: 'ssh' }, shared: null }),
      count: async (req) => {
        window.__counts.push(req.exclude || null)
        let total = 0, files = 0
        for (const [step, fs] of Object.entries(sizes)) for (const [name, b] of Object.entries(fs)) if (!excluded(name, req.exclude)) { total += b; files += 1000 }
        return { pending: false, all: { total_files: files, total_bytes: total, scanned_files: files, capacity_bytes: 1e12, free_bytes: 3.4e11, over_capacity: total > 1e12 } }
      },
      start: async (req) => { window.__started = req; return { ok: true } }, cancel: async () => ({ ok: true }), state: async () => ({ running: false, events: [] }), onEvent: (cb) => { listeners.push(cb); return () => {} },
      measure: (req) => new Promise((res, rej) => { window.__measures.push(req); const t = setTimeout(() => res({ bytes: sizes[req.step]?.[req.name] ?? 0 }), measureMs); window.__abort = window.__abort || {}; window.__abort[req.id] = () => { clearTimeout(t); rej(new Error('cancelled')) } }),
      measureCancel: async (id) => { window.__cancelled.push(id); window.__abort?.[id]?.() },
    }
    if (!noFolders) window.__e2eSync.folders = async () => ({ steps: Object.entries(sizes).map(([key, fs]) => ({ key, local: `/Users/me/${key}`, folders: Object.keys(fs).sort().map((name) => ({ name, bytes: null })) })) })
  }, { folders, noFolders, measureMs })
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-sync').click()
  const d = page.getByTestId('sync-modal')
  await expect(d.getByTestId('sync-plan-counts')).toContainText('files')
  return d
}
const startBtn = (d) => d.locator('.modal-footer .btn-warning')
const box = (d, step, name) => d.locator(`[data-testid="sync-exclude-folder"][data-step="${step}"][data-name="${name}"]`)

test('the Leave out section lists each step\'s top-level folders, sorted, with the plain line that nothing is deleted', async ({ page }) => {
  const d = await openSync(page)
  const sec = d.getByTestId('sync-exclude')
  await expect(sec.getByTestId('sync-exclude-step')).toHaveCount(2)
  await expect(sec.locator('[data-testid="sync-exclude-step"][data-step="project"] [data-testid="sync-exclude-folder"]')).toHaveCount(3)
  expect(await sec.locator('[data-testid="sync-exclude-step"][data-step="project"] [data-testid="sync-exclude-folder"]').evaluateAll((els) => els.map((e) => e.dataset.name))).toEqual(['Binc', 'CANALV2', 'scripts'])
  await expect(box(d, 'plates', 'plate-a')).not.toBeChecked()
  await expect(sec.getByTestId('sync-exclude-help')).toHaveText('Left out folders are not copied and nothing on the volume is deleted.')
  await expect(sec.getByTestId('sync-exclude-remember')).not.toBeChecked()   // off by default
  expect(await page.evaluate(() => window.__measures.length)).toBe(0)   // nothing is measured by itself
})

test('Measure shows a size, never starts by itself, and a running measure can be cancelled', async ({ page }) => {
  const d = await openSync(page, { measureMs: 600 })
  const m = d.locator('[data-testid="sync-measure"][data-name="Binc"]')
  await m.click()
  await expect(d.getByTestId('sync-measure-cancel')).toBeVisible()
  await d.getByTestId('sync-measure-cancel').click()
  await expect(d.getByTestId('sync-measure-cancel')).toHaveCount(0)
  expect(await page.evaluate(() => window.__cancelled.length)).toBe(1)
  await expect(m).toBeVisible()   // back to a Measure link
  await page.waitForTimeout(800); await expect(d.locator('[data-testid="sync-measure-size"][data-name="Binc"]')).toHaveCount(0)   // the cancelled answer is dropped
  await m.click()
  await expect(d.locator('[data-testid="sync-measure-size"][data-name="Binc"]')).toHaveText(formatBytes(50 * GB), { timeout: 5000 })
  expect(await page.evaluate(() => window.__measures.at(-1))).toMatchObject({ pod_id: POD, step: 'project', name: 'Binc' })
})

test('the CANALV2 chip ticks it, the over-capacity alert goes off and the totals come down', async ({ page }) => {
  const d = await openSync(page)
  await expect(d.getByTestId('sync-over-capacity')).toBeVisible()
  await expect(startBtn(d)).toBeDisabled()
  const before = await d.getByTestId('sync-plan-counts').innerText()
  const chip = d.getByTestId('sync-exclude-canalv2')
  await expect(chip).toHaveText('Leave out CANALV2 (usually the largest)')
  await chip.click()
  await expect(box(d, 'project', 'CANALV2')).toBeChecked()
  await expect(chip).toHaveCount(0)
  await expect(d.getByTestId('sync-over-capacity')).toHaveCount(0)
  await expect(startBtn(d)).toBeEnabled()
  await expect(d.getByTestId('sync-plan-counts')).not.toHaveText(before)
  await expect(d.getByTestId('sync-plan-counts')).toContainText(formatBytes(61 * GB))
  expect(await page.evaluate(() => window.__counts.at(-1))).toEqual(['/CANALV2/'])
  await box(d, 'project', 'CANALV2').uncheck()   // and back
  await expect(d.getByTestId('sync-over-capacity')).toBeVisible()
})

test('no CANALV2 folder, no chip; the chip matches any case', async ({ page }) => {
  let d = await openSync(page, { folders: { project: { scripts: GB } } })
  await expect(d.getByTestId('sync-exclude-canalv2')).toHaveCount(0)
  await page.close()
})

test('a run sends the ticks and the patterns as exclude, on the count and on Start; each change counts again (debounced)', async ({ page }) => {
  const d = await openSync(page)
  await box(d, 'project', 'Binc').check()
  const add = d.getByTestId('sync-exclude-add')
  await add.fill('*.tmp'); await add.press('Enter')
  await add.fill('old/'); await d.getByTestId('sync-exclude-add-button').click()
  await expect(d.getByTestId('sync-exclude-pattern')).toHaveText([/\/Binc\//, /\*\.tmp/, /old\//])
  await expect.poll(() => page.evaluate(() => window.__counts.at(-1))).toEqual(['/Binc/', '*.tmp', 'old/'])
  expect(await page.evaluate(() => window.__counts.length)).toBeLessThan(8)   // bursts are folded
  await d.locator('[data-testid="sync-exclude-remove"][data-pattern="*.tmp"]').click()
  await expect(d.getByTestId('sync-exclude-pattern')).toHaveCount(2)
  await d.getByTestId('sync-exclude-canalv2').click()
  await startBtn(d).click()
  await expect.poll(() => page.evaluate(() => window.__started)).toBeTruthy()
  expect(await page.evaluate(() => window.__started.exclude)).toEqual(['/Binc/', 'old/', '/CANALV2/'])
})

test('pattern validation is inline and matches the core\'s rules', async ({ page }) => {
  const d = await openSync(page)
  const add = d.getByTestId('sync-exclude-add'), err = d.getByTestId('sync-exclude-error')
  for (const [v, text] of [['', 'A pattern cannot be empty.'], ['   ', 'A pattern cannot be empty.'], ['../secret', 'A pattern has no `..`, no line breaks and does not start with ~.'], ['~/x', 'A pattern has no `..`, no line breaks and does not start with ~.'], ['x'.repeat(201), 'A pattern is at most 200 characters.']]) {
    await add.fill(v); await add.press('Enter')
    await expect(err).toHaveText(text)
  }
  await expect(d.getByTestId('sync-exclude-pattern')).toHaveCount(0)
  await add.fill('CANALV2/'); await add.press('Enter')
  await expect(err).toHaveCount(0); await expect(d.getByTestId('sync-exclude-pattern')).toHaveText(/CANALV2\//)
  await add.fill('CANALV2/'); await add.press('Enter')   // a duplicate is not listed twice
  await expect(d.getByTestId('sync-exclude-pattern')).toHaveCount(1)
})

test('saved patterns (the pod\'s own configuration, else the Default\'s) are listed marked saved, pre-ticked, and always in force', async ({ page, api }) => {
  api.state.mounts.config.sync_exclude = ['/Binc/']
  let d = await openSync(page)
  await expect(d.locator('[data-testid="sync-exclude-pattern"][data-saved="true"]')).toHaveText(/\/Binc\/.*saved/)
  await expect(box(d, 'project', 'Binc')).toBeChecked(); await expect(box(d, 'project', 'Binc')).toBeDisabled()
  await expect(d.getByTestId('sync-exclude-saved')).toHaveCount(1)
  await expect(d.getByTestId('sync-exclude-canalv2')).toBeVisible()   // the chip is still offered: CANALV2 is not saved
  await d.getByTestId('sync-exclude-canalv2').click()
  await startBtn(d).click()
  await expect.poll(() => page.evaluate(() => window.__started)).toBeTruthy()
  expect(await page.evaluate(() => window.__started.exclude)).toEqual(['/CANALV2/'])   // the saved ones are the core's to add
})

test('a pod\'s own list wins over the Default\'s', async ({ page, api }) => {
  api.state.mounts.config.sync_exclude = ['/Binc/']
  api.state.podConfigs[POD] = { ...api.state.mounts.config, sync_exclude: ['/scripts/'] }
  const d = await openSync(page)
  await expect(d.locator('[data-testid="sync-exclude-pattern"][data-saved="true"]')).toHaveCount(1)
  await expect(box(d, 'project', 'scripts')).toBeChecked(); await expect(box(d, 'project', 'Binc')).not.toBeChecked()
})

test('Remember for this pod saves the list into the pod\'s own configuration and changes nothing else', async ({ page, api }) => {
  api.state.podConfigs[POD] = { ...api.state.mounts.config, mount_path: '/custom/mount', sync_exclude: ['/scripts/'] }
  const own = JSON.parse(JSON.stringify(api.state.podConfigs[POD]))
  const d = await openSync(page)
  await d.getByTestId('sync-exclude-canalv2').click()
  await d.getByTestId('sync-exclude-add').fill('*.tmp'); await d.getByTestId('sync-exclude-add').press('Enter')
  expect(calls(api, 'PUT', `/pods/${POD}/config`)).toHaveLength(0)   // not by itself
  await d.getByTestId('sync-exclude-remember').check()
  await startBtn(d).click()
  await expect.poll(() => calls(api, 'PUT', `/pods/${POD}/config`).length).toBe(1)
  expect(calls(api, 'PUT', `/pods/${POD}/config`)[0].body).toEqual({ ...own, sync_exclude: ['/scripts/', '/CANALV2/', '*.tmp'] })
  expect(await page.evaluate(() => window.__started.exclude)).toEqual(['/CANALV2/', '*.tmp'])
})

test('Remember left off (the default) never touches the pod configuration', async ({ page, api }) => {
  const d = await openSync(page)
  await d.getByTestId('sync-exclude-canalv2').click(); await startBtn(d).click()
  await expect.poll(() => page.evaluate(() => window.__started)).toBeTruthy()
  expect(calls(api, 'PUT', `/pods/${POD}/config`)).toHaveLength(0)
})

test('Remember on a pod with no own configuration saves the Default\'s as the pod\'s, plus the list', async ({ page, api }) => {
  const d = await openSync(page)
  await d.getByTestId('sync-exclude-canalv2').click(); await d.getByTestId('sync-exclude-remember').check(); await startBtn(d).click()
  await expect.poll(() => calls(api, 'PUT', `/pods/${POD}/config`).length).toBe(1)
  expect(calls(api, 'PUT', `/pods/${POD}/config`)[0].body).toEqual({ ...api.state.mounts.config, sync_exclude: ['/CANALV2/'] })
})

test('a core without sync.folders (older) hides the section quietly: no error, the rest of the window works', async ({ page }) => {
  const d = await openSync(page, { noFolders: true })
  await expect(d.getByTestId('sync-exclude')).toHaveCount(0)
  await expect(d.getByTestId('sync-plan-error')).toHaveCount(0)
  await expect(startBtn(d)).toBeDisabled()   // (the fake count is over capacity; the window is otherwise unchanged)
})

test.describe('Configuration: Sync: leave out', () => {
  const openDefault = async (page) => { await page.goto('/'); await page.getByTestId('open-config').click(); const d = modal(page, t('config.title')); await cfgTab(d, 'options'); return d }
  const openPod = async (page) => { await page.goto('/'); await podCard(page, 'ComfyUI-Dev').getByTestId('pod-config').click(); const d = modal(page, t('config.podTitle', { name: 'ComfyUI-Dev' })); await cfgTab(d, 'options'); return d }
  test('the textarea loads with the help line; an untouched config saves with no sync_exclude', async ({ page, api }) => {
    const d = await openDefault(page)
    await expect(d.getByTestId('config-sync-exclude')).toHaveValue('')
    await expect(d.getByTestId('config-sync-exclude-help')).toHaveText('Folders or patterns the Sync window never pushes (for example CANALV2/). Each Sync can add more.')
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body).not.toHaveProperty('sync_exclude')
  })
  test('lines save as a list (trimmed, blanks and duplicates dropped), reload, and clearing a stored list saves []', async ({ page, api }) => {
    let d = await openDefault(page)
    await d.getByTestId('config-sync-exclude').fill('CANALV2/\n  *.tmp  \n\nCANALV2/\n')
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts')[0].body.sync_exclude).toEqual(['CANALV2/', '*.tmp'])
    await page.reload(); await page.getByTestId('open-config').click()
    d = modal(page, t('config.title')); await cfgTab(d, 'options')
    await expect(d.getByTestId('config-sync-exclude')).toHaveValue('CANALV2/\n*.tmp')
    await d.getByTestId('config-sync-exclude').fill('')
    await d.getByTestId('config-save').click(); await expect(d).toBeHidden()
    expect(calls(api, 'PUT', '/mounts').at(-1).body.sync_exclude).toEqual([])   // it was stored: the empty list is saved so it clears
  })
  test('a bad pattern is refused inline before any call', async ({ page, api }) => {
    const d = await openDefault(page)
    await d.getByTestId('config-sync-exclude').fill('ok/\n../etc')
    await d.getByTestId('config-save').click()
    await expect(d.getByTestId('config-sync-exclude-error')).toHaveText('Sync: leave out: ../etc: A pattern has no `..`, no line breaks and does not start with ~.')
    expect(calls(api, 'PUT', '/mounts')).toHaveLength(0)
  })
  test('a pod\'s own configuration has it too, starts from the Default\'s list, saves its own', async ({ page, api }) => {
    api.state.mounts.config.sync_exclude = ['CANALV2/']
    const p = await openPod(page)
    await expect(p.getByTestId('config-sync-exclude')).toHaveValue('CANALV2/')
    await p.getByTestId('config-sync-exclude').fill('CANALV2/\nBinc/')
    await p.getByTestId('config-apply').click(); await expect(p).toBeHidden()
    expect(api.state.podConfigs[POD].sync_exclude).toEqual(['CANALV2/', 'Binc/'])
  })
})
