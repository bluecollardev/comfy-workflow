import { test, expect, openVolumes } from './fixtures'

// Configure Sync (docs/ADR-068, ADR-069): per event, send to where. A volume row lists each event with its storages; a storage row is a matrix (All Volumes, then every volume, three events);
// the BH row keeps only Approved = Auto-publish; This PC edits each volume's Auto Sync. The core is faked (state.storage, state.syncrules, state.autopublish, state.autosync in e2e/fixtures.js).
const ADAPTERS = () => JSON.parse(JSON.stringify([
  { id: 'publish-s3', name: 'Panama BH (S3)', builtin: true, kind: 'publish', enabled: true, endpoint: '', region: 'us-west-2', bucket: 'bh-panama', prefix: 'returns/', ready: true, key_hint: '', events: [] },
  { id: 'panama-s3', name: 'Panama BH exchange (S3)', builtin: true, kind: 'panama', enabled: true, endpoint: '', region: 'us-west-2', bucket: 'bh-panama', prefix: 'rounds/', ready: true, key_hint: '' },
  { id: 'wasabi', name: 'Wasabi', builtin: true, kind: 'wasabi', enabled: true, endpoint: 'https://s3.wasabisys.com', region: 'eu-central-1', bucket: 'bh-wasabi', prefix: '', ready: true, key_hint: '…1111', events: [] },
]))
const rulesOf = (api) => api.state.syncrules?.rules || {}
const setCalls = (api) => (api.state.syncrules?.calls || [])
const EVS = ['generated', 'approved', 'published']
const MINE = { id: 'mine', name: 'My Bucket', builtin: false, kind: 'custom', enabled: true, endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'mine', prefix: '', ready: true, key_hint: '…3333', default: true }
async function open(page, api, extra = []) {
  api.state.storage = { adapters: ADAPTERS().concat(extra) }; api.state.panama = { configured: true }
  await page.goto('/'); await openVolumes(page)
  const w = page.locator('[data-testid="volume-storage"][data-id="wasabi"]'), bh = page.getByTestId('volume-bh')
  await expect(w).toBeVisible(); await expect(bh).toBeVisible()
  return { w, bh }
}
const vrow = (page, id) => page.locator(`[data-testid="volume"][data-id="${id}"]`)
const vsec = async (page, id) => { const sec = vrow(page, id).getByTestId('volume-sync-rules'); await sec.getByTestId('collapsible-toggle').click(); return sec }
const tick = (sec, ev, id) => sec.locator(`[data-testid="volume-event-tick"][data-event="${ev}"][data-id="${id}"]`)

test('every volume row has a Configure Sync section, collapsed by default, with a summary badge', async ({ page, api }) => {
  const { w, bh } = await open(page, api)
  for (const [row, id] of [[vrow(page, 'vol1'), 'volume-sync-rules']]) {
    const sec = row.getByTestId(id)
    await expect(sec).toHaveAttribute('data-open', 'false'); await expect(sec.getByTestId('collapsible-title').first()).toHaveText('Configure Sync'); await expect(sec.getByTestId('collapsible-icon')).toBeAttached()
  }
  await expect(w.getByTestId('storage-events')).toHaveCount(0)   // a storage only receives: its rules are set on the volume rows
  await expect(bh.getByTestId('storage-events')).toHaveCount(0)   // Auto-publish is under Publishing there
})

test('a volume row: each event has its own destination list: the storages (default first, with its badge), then This PC, and the other volumes disabled with Not built yet', async ({ page, api }) => {
  await open(page, api, [MINE])
  const sec = await vsec(page, 'vol1')
  for (const ev of EVS) await expect(sec.getByTestId(`sync-push-${ev}`)).toBeVisible()
  await expect(sec.getByTestId('sync-push').locator('xpath=.//div[@data-testid="volume-event-dest"]').first()).toBeVisible()
  for (const ev of EVS) {
    const box = sec.locator(`[data-testid="sync-push-${ev}"]`)
    const ids = await box.locator('[data-testid="volume-event-dest"]').evaluateAll((els) => els.map((e) => e.dataset.id))
    expect(ids).toEqual(['mine', 'wasabi'])
    await expect(box.locator('[data-testid="volume-event-dest"][data-id="mine"]').getByTestId('volume-event-default')).toHaveText('Default')
    await expect(box.locator('[data-testid="volume-event-dest"][data-id="wasabi"]').getByTestId('volume-event-default')).toHaveCount(0)
    const nb = box.getByTestId('volume-event-notbuilt')
    await expect(nb).toHaveCount(1)   // vol2
    await expect(box.getByTestId('volume-event-local-tick')).toBeEnabled()
    for (const n of await nb.all()) { await expect(n).toContainText('Not built yet'); await expect(n.locator('input')).toBeDisabled() }
    await expect(box.locator('[data-testid="volume-event-notbuilt"][data-id="vol2"]')).toContainText('scratch')
  }
  await expect(sec.locator('[data-testid="sync-push-generated"]').getByTestId('volume-event-help')).toHaveText('Generated: when a render on this volume finishes')
  await expect(sec.locator('[data-testid="sync-push-approved"]').getByTestId('volume-event-help')).toHaveText('Approved: when a shot version is approved')
  await expect(sec.locator('[data-testid="sync-push-published"]').getByTestId('volume-event-help')).toHaveText('Published: after a publish that sent files from this volume')
  await expect(sec).not.toContainText('Sends To'); await expect(sec).not.toContainText("Send this volume's outputs here")
})

test('a volume row: ticking a storage for one event saves that rule at once', async ({ page, api }) => {
  const { w } = await open(page, api, [MINE])
  const sec = await vsec(page, 'vol1')
  await tick(sec, 'generated', 'wasabi').check()
  await expect.poll(() => setCalls(api).at(-1)).toMatchObject({ set: 'vol1', event: 'generated', destinations: [{ type: 'storage', id: 'wasabi' }] })
  await tick(sec, 'generated', 'mine').check()
  await expect.poll(() => setCalls(api).at(-1)?.destinations).toEqual([{ type: 'storage', id: 'wasabi' }, { type: 'storage', id: 'mine' }])
  await expect(tick(sec, 'approved', 'wasabi')).not.toBeChecked()   // each event has its own list
  await expect(sec.getByTestId('volume-rules-summary')).toContainText('2 rule(s)')
})

test('the All Volumes rule is said to apply on a volume with no rule of its own', async ({ page, api }) => {
  api.state.syncrules = { rules: { '*': { generated: [{ type: 'storage', id: 'wasabi' }], approved: [], published: [] } }, calls: [] }
  await open(page, api)
  const sec = await vsec(page, 'vol1')
  await expect(sec.locator('[data-testid="sync-push-generated"]').getByTestId('volume-event-inherited')).toContainText('All Volumes')
  await expect(sec.locator('[data-testid="sync-push-approved"]').getByTestId('volume-event-inherited')).toHaveCount(0)
})

test('the BH row has no Configure Sync: Auto-publish is under Publishing, and nothing there is a sync rule', async ({ page, api }) => {
  const { bh } = await open(page, api)
  await expect(bh.getByTestId('storage-events')).toHaveCount(0)
  await bh.getByTestId('bh-publishing').getByTestId('collapsible-toggle').first().click()
  await expect(bh.getByTestId('bh-publishing').getByTestId('bh-autopublish-options')).toBeVisible()
  expect(setCalls(api)).toHaveLength(0)
})

test('This PC row: each volume ticks which events come down; On Change pushes up under the approver\'s name', async ({ page, api }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('c')) { localStorage.removeItem('runpod-manager.approved-by'); sessionStorage.setItem('c', '1') } })
  await open(page, api)
  const sec = page.getByTestId('volume-local').getByTestId('local-sync-rules')
  await expect(sec.getByTestId('local-rules-summary')).toHaveText('None')
  await sec.getByTestId('collapsible-toggle').click()
  await expect(sec.getByTestId('local-receives')).toHaveCount(2)
  await expect(sec.getByTestId('local-onchange-pull')).toHaveCount(2)   // each volume's Auto Sync down to this PC
  const r1 = sec.locator('[data-testid="local-receives"][data-id="vol1"]')
  await r1.locator('[data-testid="local-event-tick"][data-event="generated"]').check()
  await expect(sec.getByTestId('local-rules-summary')).toHaveText('1 rule(s)')
  expect(setCalls(api).at(-1)).toMatchObject({ set: 'vol1', event: 'generated', destinations: [{ type: 'local' }] })
  const s1 = sec.locator('[data-testid="local-sends"][data-id="vol1"]')
  await s1.getByTestId('volume-autosync-push').check(); await page.getByTestId('volumes-save').click()
  await expect(s1.getByTestId('volume-autosync-error')).toContainText('needs the name')
  await s1.getByTestId('volume-autosync-approved-by').fill('Lucas'); await page.getByTestId('volumes-save').click()
  await expect(page.getByTestId('volumes-saved')).toBeVisible()
  expect(api.state.autosync.volumeCalls.at(-1)).toMatchObject({ volume_id: 'vol1', enabled: true, pull: false, push: true, approved_by: 'Lucas' })
})

test('a storage row has the same icon-only buttons as a volume row: Explore, Sync, Erase (Not built yet) and Delete (unlinks after a confirm; disabled for the default)', async ({ page, api }) => {
  const { w } = await open(page, api, [MINE])
  const m = page.locator('[data-testid="volume-storage"][data-id="mine"]')
  for (const row of [w, m]) {
    for (const id of ['volume-storage-explore', 'storage-sync-btn', 'storage-erase-btn', 'storage-delete-btn']) { const b = row.getByTestId(id); await expect(b).toBeVisible(); await expect(b).toHaveText(''); await expect(b).toHaveAttribute('title', /.+/); await expect(b).toHaveClass(/vol-icon/) }
    await expect(row.getByTestId('storage-delete-btn')).toHaveAttribute('aria-label', 'Delete'); await expect(row.getByTestId('storage-erase-btn')).toHaveAttribute('aria-label', 'Erase')
    await expect(row.locator('.vol-side')).toBeVisible()
  }
  await expect(vrow(page, 'vol1').locator('.vol-side')).toBeVisible()
  await expect(w.getByTestId('storage-erase-btn')).toBeDisabled(); await expect(w.getByTestId('storage-erase-btn')).toHaveAttribute('title', 'Not built yet')
  await expect(m.getByTestId('storage-erase-btn')).toBeDisabled()
  await expect(m.getByTestId('storage-delete-btn')).toBeDisabled()
  await expect(m.getByTestId('storage-delete-btn')).toHaveAttribute('title', 'The default storage cannot be deleted: make another storage the default first')
  await w.getByTestId('storage-delete-btn').click()
  await expect(page.getByTestId('confirm-message')).toContainText('only removes the link')
  await page.getByTestId('confirm-cancel').click()
  await expect(w).toBeVisible()
  await w.getByTestId('storage-delete-btn').click()
  await page.getByTestId('confirm-ok').click()
  await expect.poll(() => (api.state.storage.calls || []).some((c) => c.remove === 'wasabi')).toBe(true)
  await expect(w).toHaveCount(0)
})

test('volume and This PC rows have Push and Pull blocks; storage rows have no Configure Sync; volume Pull events are disabled Not built yet; a storage only receives', async ({ page, api }) => {
  const { w, bh } = await open(page, api)
  const v = await vsec(page, 'vol1')
  await expect(v.getByTestId('sync-push').locator('.fw-semibold').first()).toHaveText('Push'); await expect(v.getByTestId('sync-pull').locator('.fw-semibold').first()).toHaveText('Pull')
  await expect(v.getByTestId('sync-push-on_change')).toBeVisible(); await expect(v.getByTestId('sync-pull-on_change')).toBeVisible()
  for (const ev of ['generated', 'approved', 'pod_started']) {
    const box = v.getByTestId(`sync-pull-${ev}`)
    await expect(box.locator('[data-testid="volume-pull-notbuilt"][data-kind="storage"][data-id="wasabi"]')).toContainText('Not built yet')
    await expect(box.locator('[data-testid="volume-pull-notbuilt"][data-kind="local"]')).toBeVisible()
    await expect(box.locator('[data-testid="volume-pull-notbuilt"][data-kind="volume"][data-id="vol2"] input')).toBeDisabled()
  }
  await expect(w.getByTestId('storage-events')).toHaveCount(0)
  await expect(bh.getByTestId('storage-events')).toHaveCount(0)
  const local = page.getByTestId('volume-local').getByTestId('local-sync-rules'); await local.getByTestId('collapsible-toggle').click()
  await expect(local.getByTestId('sync-push')).toBeVisible(); await expect(local.getByTestId('sync-pull')).toBeVisible()
  await expect(local.getByTestId('local-sends')).toHaveCount(2)
})

test('a refused save puts the This PC box back and says why', async ({ page, api }) => {
  api.state.syncrules = { rules: {}, calls: [], refuse: 'Not built yet: refused by the test' }
  await open(page, api)
  const sec = page.getByTestId('volume-local').getByTestId('local-sync-rules')
  await sec.getByTestId('collapsible-toggle').click()
  const box = sec.locator('[data-testid="local-receives"][data-id="vol1"] [data-testid="local-event-tick"][data-event="generated"]')
  await box.click()
  await expect(sec.getByTestId('local-rules-error')).toContainText('refused by the test')
  await expect(box).not.toBeChecked()
})

test('This PC row: Pull Now on a storage opens Sync from that bucket', async ({ page, api }) => {
  await open(page, api)
  const sec = page.getByTestId('volume-local').getByTestId('local-sync-rules')
  await sec.getByTestId('collapsible-toggle').click()
  const row = sec.locator('[data-testid="local-pull-storage"][data-id="wasabi"]')
  await expect(row).toContainText('bh-wasabi')
  await row.getByTestId('local-pull-now').click()
  await expect(page.getByTestId('sync-modal')).toBeVisible()
  await expect(page.getByTestId('sync-modal')).toContainText('Wasabi')
})

test('This PC row: a storage has its own event ticks', async ({ page, api }) => {
  await open(page, api)
  const sec = page.getByTestId('volume-local').getByTestId('local-sync-rules')
  await sec.getByTestId('collapsible-toggle').click()
  const box = sec.locator('[data-testid="local-pull-storage"][data-id="wasabi"] [data-testid="local-storage-tick"][data-event="approved"]')
  await box.check()
  await expect.poll(() => setCalls(api).at(-1)).toMatchObject({ set: 'wasabi', event: 'approved', destinations: [{ type: 'local' }] })
  await expect(box).toBeChecked()
  await expect(sec.getByTestId('local-rules-summary')).toHaveText('1 rule(s)')
})
