import { test, expect } from './fixtures.js'

// Import Round, step 3: Choose Card takes several cards of ONE datacenter, ranked in click order (the first free one is used), and Number of Pods says what it does (docs/ADR-038, amendment 2026-11-18).
const chip = (page, card, dc) => page.getByTestId('choose-card-modal').locator(`[data-testid="dc-card-row"][data-card="${card}"] [data-testid="dc-chip"][data-dc="${dc}"]`)
const ranks = (page) => page.getByTestId('choose-card-modal').getByTestId('dc-chip-rank')
const done = (page) => page.getByTestId('choose-card-modal').getByRole('button', { name: 'Use these cards' }).click()

async function toStep3(page, api, n = 1) {
  api.state.datacenters.datacenters[0].cards.push({ key: 'rtx6000ada', name: 'RTX 6000 Ada', vram: 48, price: 1.09, stock: 'Low' })   // a third card at EU-RO-1
  api.state.datacenters.datacenters[2].cards = [{ key: 'rtxpro6000', name: 'RTX PRO 6000', vram: 96, price: 1.9, stock: 'Low' }]   // and a card in a datacenter with no volume of ours
  await page.goto('/')
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  for (let i = 0; i < n; i++) await dlg.getByTestId('import-round-option').nth(i).locator('input').check()
  await dlg.getByTestId('import-round-next').click()
  await dlg.getByTestId('import-round-next').click()
  return dlg
}

test('Choose Card: tick several cards of one datacenter, ranked in click order; unticking moves the ranks up; Done sends the ordered list to every shot', async ({ page, api }) => {
  const dlg = await toStep3(page, api)
  await expect(dlg.getByTestId('import-round-same-card-first')).toHaveCount(0)   // no line until there are several cards
  await dlg.getByTestId('import-round-choose-card-btn').click()
  await chip(page, 'RTX 4090', 'EU-RO-1').click()
  await chip(page, 'RTX 6000 Ada', 'EU-RO-1').click()
  await chip(page, 'RTX 4000 Ada', 'EU-RO-1').click()
  const table = page.getByTestId('choose-card-modal')
  await expect(table).toBeVisible()   // the window stays open for the next card
  await expect(ranks(page)).toHaveCount(3)
  await expect(chip(page, 'RTX 4090', 'EU-RO-1').getByTestId('dc-chip-rank')).toHaveText('1')
  await expect(chip(page, 'RTX 6000 Ada', 'EU-RO-1').getByTestId('dc-chip-rank')).toHaveText('2')
  await expect(chip(page, 'RTX 4000 Ada', 'EU-RO-1').getByTestId('dc-chip-rank')).toHaveText('3')
  await chip(page, 'RTX 4090', 'EU-RO-1').click()   // untick the first: the others move up
  await expect(chip(page, 'RTX 4090', 'EU-RO-1').getByTestId('dc-chip-rank')).toHaveCount(0)
  await expect(chip(page, 'RTX 6000 Ada', 'EU-RO-1').getByTestId('dc-chip-rank')).toHaveText('1')
  await expect(chip(page, 'RTX 4000 Ada', 'EU-RO-1').getByTestId('dc-chip-rank')).toHaveText('2')
  await chip(page, 'RTX 4090', 'EU-RO-1').click()   // ticked again: last
  await expect(chip(page, 'RTX 4090', 'EU-RO-1').getByTestId('dc-chip-rank')).toHaveText('3')
  await done(page)
  await expect(table).toBeHidden()
  await expect(dlg.getByTestId('import-round-chosen-card')).toContainText('RTX 6000 Ada 48 GB, RTX 4000 Ada 20 GB, RTX 4090 24 GB')   // the names, in rank order
  await expect(dlg.getByTestId('import-round-same-card-first')).toHaveText('All pods use your first card while it has free GPUs; if it runs out, the rest use your next card.')
  await expect(dlg.getByTestId('import-round-volume')).toHaveValue('vol1')   // the volumes in that datacenter are offered next
  await expect(dlg.getByTestId('import-round-dc-volumes')).toContainText('Network volumes in EU-RO-1')
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await dlg.getByTestId('import-round-start').click()
  await expect.poll(() => api.state.imported).toBeTruthy()
  expect(api.state.imported.cards).toEqual({ 'cgi-042': ['rtx6000ada', 'rtx4000ada', 'rtx4090'], 'cgi-043': ['rtx6000ada', 'rtx4000ada', 'rtx4090'] })   // every shot, same order
  const planned = api.state.planCalls.at(-1)
  expect(planned.cards['cgi-042']).toEqual(['rtx6000ada', 'rtx4000ada', 'rtx4090'])   // the estimate is asked for with the list too
})

test('Choose Card: a card at another datacenter replaces the selection and the datacenter; a single card is still sent as one key', async ({ page, api }) => {
  const dlg = await toStep3(page, api)
  await dlg.getByTestId('import-round-choose-card-btn').click()
  await chip(page, 'RTX 4090', 'EU-RO-1').click()
  await chip(page, 'RTX 6000 Ada', 'EU-RO-1').click()
  await expect(ranks(page)).toHaveCount(2)
  await chip(page, 'A40', 'CA-MTL-1').click()   // another datacenter: replaces, ranked 1 there
  await expect(ranks(page)).toHaveCount(1); await expect(ranks(page).first()).toHaveText('1')
  await expect(chip(page, 'A40', 'CA-MTL-1').getByTestId('dc-chip-rank')).toHaveText('1')
  await expect(page.getByTestId('choose-card-modal').getByTestId('dc-table-chosen')).toContainText('CA-MTL-1')
  await chip(page, 'RTX 5090', 'CA-MTL-1').click()   // the same new datacenter: adds
  await expect(ranks(page)).toHaveCount(2)
  await chip(page, 'RTX 5090', 'CA-MTL-1').click(); await chip(page, 'A40', 'CA-MTL-1').click()   // untick all
  await expect(ranks(page)).toHaveCount(0)
  await chip(page, 'RTX 4090', 'EU-RO-1').click()   // one card at EU-RO-1
  await done(page)
  await expect(dlg.getByTestId('import-round-chosen-card')).toContainText('RTX 4090'); await expect(dlg.getByTestId('import-round-chosen-card')).not.toContainText(',')
  await expect(dlg.getByTestId('import-round-same-card-first')).toHaveCount(0)   // one card: no fallback line
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await dlg.getByTestId('import-round-start').click()
  await expect.poll(() => api.state.imported).toBeTruthy()
  expect(api.state.imported.cards).toEqual({ 'cgi-042': 'rtx4090', 'cgi-043': 'rtx4090' })   // a single card is a plain key, as before
})

test('Choose Card: with several rounds ticked every shot of every round gets the ordered list; a card with no volume at its datacenter still offers one to create; Auto clears', async ({ page, api }) => {
  const dlg = await toStep3(page, api, 2)
  await dlg.getByTestId('import-round-choose-card-btn').click()
  await chip(page, 'RTX 4090', 'EU-RO-1').click(); await chip(page, 'RTX 4000 Ada', 'EU-RO-1').click()
  await done(page)
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await dlg.getByTestId('import-round-start').click()
  await expect.poll(() => api.state.importedAll?.length).toBe(2)
  for (const i of api.state.importedAll) expect(Object.values(i.cards)).toEqual([['rtx4090', 'rtx4000ada'], ['rtx4090', 'rtx4000ada']])
})

test('Choose Card: a card where none of your volumes live says so; the Auto button clears every card', async ({ page, api }) => {
  const dlg = await toStep3(page, api)
  await dlg.getByTestId('import-round-choose-card-btn').click()
  await page.getByTestId('choose-card-modal').getByTestId('dc-dc-filter').selectOption('')   // US-KS-2 has no volume of ours: it starts hidden, All datacenters shows it
  await chip(page, 'RTX PRO 6000', 'US-KS-2').click(); await done(page)
  await expect(dlg.getByTestId('import-round-dc-novolume')).toBeVisible()
  await dlg.getByTestId('import-round-choose-card-btn').click()
  await page.getByTestId('choose-card-modal').getByTestId('import-round-dc-gpu-auto').click()
  await expect(ranks(page)).toHaveCount(0); await done(page)
  await expect(dlg.getByTestId('import-round-chosen-card')).toHaveCount(0)
})

test('Number of Pods: the label, the note, the typed value reaches max_pods and is never overwritten, the default follows the shots', async ({ page, api }) => {
  const dlg = await toStep3(page, api)
  const pods = dlg.getByTestId('import-round-max-pods')
  await expect(dlg.locator('label[for="ir-pods"]')).toHaveText('Number of Pods')
  await expect(dlg.getByTestId('import-round-pods-note')).toContainText('split into chunks')
  await expect(dlg.getByTestId('import-round-pods-note')).toContainText('more pods finish sooner and cost more')
  await expect(pods).toHaveValue('2')   // the default: one pod per shot ticked (the round has two)
  await expect(pods).toHaveAttribute('min', '1'); await expect(pods).toHaveAttribute('max', '20')
  await pods.fill('4')
  await dlg.locator('[data-testid="import-round-step"][data-step="2"]').click()   // change the ticked shots after editing
  await dlg.locator('[data-testid="import-round-step"][data-step="3"]').click()
  await expect(pods).toHaveValue('4')   // typed: never overwritten
  await dlg.getByTestId('import-round-volume').selectOption('vol1')
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await dlg.getByTestId('import-round-start').click()
  await expect.poll(() => api.state.imported).toBeTruthy()
  expect(api.state.imported.max_pods).toBe(4)
})

test('Number of Pods: out-of-range values are brought to 1..20 on Import; with several rounds the label says each round', async ({ page, api }) => {
  const dlg = await toStep3(page, api, 2)
  await expect(dlg.locator('label[for="ir-pods"]')).toHaveText('Number of Pods (each round)')
  await dlg.getByTestId('import-round-max-pods').fill('50')
  await dlg.getByTestId('import-round-volume').selectOption('vol1')
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await dlg.getByTestId('import-round-start').click()
  await expect.poll(() => api.state.importedAll?.length).toBe(2)
  expect(api.state.importedAll.map((i) => i.max_pods)).toEqual([20, 20])
})

// Choose Card's datacenter dropdown (Lucas, 2026-11-18: 'by default datacenters should be filtered', 'filter datacenters can be a dropdown too'): it starts on the datacenters where the person has a network volume (a pod can only run there), All datacenters and each single datacenter are one choice away, and the text filter works inside it.
test('Choose Card: the datacenter dropdown starts on the datacenters of your volumes; All, or one datacenter, change what is listed; the text filter works inside it; a chosen datacenter never vanishes', async ({ page, api }) => {
  const dlg = await toStep3(page, api)
  await dlg.getByTestId('import-round-choose-card-btn').click()
  const modal = page.getByTestId('choose-card-modal'), sel = modal.getByTestId('dc-dc-filter')
  const chipsIn = (dc) => modal.locator(`[data-testid="dc-chip"][data-dc="${dc}"]`)
  await expect(sel).toHaveValue('__volumes')                                              // filtered by default
  await expect(sel.locator('option:checked')).toContainText('CA-MTL-1, EU-RO-1')           // and it says which datacenters
  await expect(chipsIn('EU-RO-1').first()).toBeVisible()
  await expect(chipsIn('CA-MTL-1').first()).toBeVisible()
  await expect(chipsIn('US-KS-2')).toHaveCount(0)                                          // no volume of ours there: hidden
  await sel.selectOption('')                                                              // All datacenters
  await expect(chipsIn('US-KS-2').first()).toBeVisible()
  await sel.selectOption('EU-RO-1')                                                       // one datacenter
  await expect(modal.locator('[data-testid="dc-chip"]:not([data-dc="EU-RO-1"])')).toHaveCount(0)
  await expect(chipsIn('EU-RO-1').first()).toBeVisible()
  await sel.selectOption('')                                                              // the text filter inside All
  await modal.getByTestId('dc-filter').fill('4090')
  await expect(modal.getByTestId('dc-card-row')).toHaveCount(1)
  await modal.getByTestId('dc-filter').fill('')
  await sel.selectOption('__volumes')                                                     // a chosen datacenter stays listed whatever the dropdown says
  await chip(page, 'RTX 4090', 'EU-RO-1').click()
  await sel.selectOption('CA-MTL-1')
  await expect(chip(page, 'RTX 4090', 'EU-RO-1').getByTestId('dc-chip-rank')).toHaveText('1')
})
