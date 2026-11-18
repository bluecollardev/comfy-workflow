import { test, expect, podCard } from './fixtures'
import { t } from './i18n'

// Retry Later's choice (ADR-042 section 19, 2026-11-17): the button opens a popup first; the watch starts only from "Start waiting".
// Same GPU = a resume watch on this pod. Another GPU in the pod's datacenter = a create watch for a NEW pod; the old pod is never deleted.
test.describe('retry later: the GPU choice', () => {
  const HOST_FULL = 'There are not enough free GPUs on the host machine to start this pod.'
  const noDelete = (api) => expect(api.calls.filter((c) => c.method === 'DELETE' && c.path.startsWith('/pods')).concat(api.calls.filter((c) => c.path.includes('/recreate')))).toEqual([])

  async function openChoice(page, api) {
    api.state.failures['POST /pods/pod-bbbbbbbb/resume'] = HOST_FULL
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Batch')
    await card.getByTestId('pod-resume').click()
    await card.getByTestId('pod-retry-later').click()
    const modal = page.getByTestId('retry-later-modal')
    await expect(modal).toBeVisible()
    return { card, modal }
  }

  test('pressing Retry Later opens the popup and starts nothing; it names the pod, the place and the schedule', async ({ page, api }) => {
    const { modal } = await openChoice(page, api)
    await expect(modal.getByTestId('retry-later-intro')).toContainText('ComfyUI-Batch')
    await expect(modal.getByTestId('retry-later-intro')).toContainText('EU-RO-1')
    await expect(modal.getByTestId('retry-later-schedule')).toHaveText(t('pod.rlSchedule', { n: 2, h: 12 }))
    await expect(modal.getByTestId('retry-later-same')).toBeChecked()   // the first option is the default
    await expect(modal.getByTestId('retry-later-other-note')).toHaveText('Creates a new pod; this pod is not deleted.')
    expect(api.state.resumeWhenFree).toBeUndefined(); expect(api.state.createLikeWhenFree).toBeUndefined(); expect(api.state.watches || []).toHaveLength(0)
  })

  test('Same GPU shows the model; Start waiting makes the resume watch on this pod, as before', async ({ page, api }) => {
    const { card, modal } = await openChoice(page, api)
    await expect(modal.getByTestId('retry-later-same-text')).toHaveText('Same GPU: A100')
    await modal.getByTestId('retry-later-start').click()
    await expect(modal).toBeHidden()
    expect(api.state.resumeWhenFree).toEqual([{ id: 'pod-bbbbbbbb' }])
    expect(api.state.createLikeWhenFree).toBeUndefined()
    await expect(card.getByTestId('pod-waiting')).toContainText('Waiting for a free A100 in EU-RO-1')
    noDelete(api)
  })

  test('Another GPU lists the datacenter\'s cards; Start waiting makes a create watch for the chosen one and the old pod is NOT deleted; the row names the GPU', async ({ page, api }) => {
    api.state.datacenters.datacenters[0].cards = [
      { key: 'rtx4090', name: 'RTX 4090', vram: 24, price: 0.89, stock: 'High', available: true, runs: true },
      { key: 'rtx4000ada', name: 'RTX 4000 Ada', vram: 20, price: 0.28, stock: 'Low', available: true, runs: true },
      { key: 'l40s', name: 'L40S', vram: 48, price: 0.99, stock: 'Out of stock', available: false, runs: true },
      { key: 'AMD Instinct', name: 'MI300X', vram: 192, price: 2.5, stock: 'High', available: true, runs: false },
    ]
    const { modal } = await openChoice(page, api)
    await modal.getByTestId('retry-later-other').check()
    await expect(modal.getByTestId('retry-later-other-text')).toHaveText('Another GPU in EU-RO-1')
    const rows = modal.getByTestId('retry-later-gpu-option')
    const opts = await rows.allTextContents()
    expect(opts).toHaveLength(3)                                      // the card the app cannot run is not offered
    expect(opts[0]).toContain('RTX 4000 Ada'); expect(opts[0]).toContain('$0.28')   // cheapest free card first
    expect(opts[2]).toContain('L40S'); expect(opts[2]).toContain(t('pod.rlNoStock'))   // out of stock stays choosable: the watch waits for it
    await expect(rows.nth(0).locator('input')).toBeChecked()          // the first card is ticked: one click starts it
    await rows.nth(0).locator('input').uncheck()
    await rows.nth(1).locator('input').check()                        // rtx4090 only
    await modal.getByTestId('retry-later-start').click()
    await expect(modal).toBeHidden()
    expect(api.state.createLikeWhenFree).toEqual([{ id: 'pod-bbbbbbbb', gpu: 'rtx4090' }])
    expect(api.state.resumeWhenFree).toBeUndefined()
    const row = page.getByTestId('pod-watch-waiting')
    await expect(row.getByTestId('pod-watch-kind')).toHaveText(t('podWatch.kindCreate'))
    await expect(row.getByTestId('pod-watch-label')).toHaveText('Waiting for a free RTX 4090 in EU-RO-1')
    noDelete(api)
    await expect(podCard(page, 'ComfyUI-Batch')).toBeVisible()   // the old pod is still there
    await row.getByTestId('pod-watch-cancel').click()           // Cancel works as today
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/pod-watches/watch-1' }))
  })

  test('Another GPU takes several cards: ranked in the order they are clicked, sent in that order as one wait that makes one pod', async ({ page, api }) => {
    api.state.datacenters.datacenters[0].cards = [
      { key: 'rtx4090', name: 'RTX 4090', vram: 24, price: 0.89, stock: 'High', available: true, runs: true },
      { key: 'rtx4000ada', name: 'RTX 4000 Ada', vram: 20, price: 0.28, stock: 'Low', available: true, runs: true },
      { key: 'l40s', name: 'L40S', vram: 48, price: 0.99, stock: 'Out of stock', available: false, runs: true },
    ]
    const { modal } = await openChoice(page, api)
    await modal.getByTestId('retry-later-other').check()
    const rows = modal.getByTestId('retry-later-gpu-option')
    await expect(modal.getByTestId('retry-later-order-note')).toContainText(t('pod.rlOrderNote').slice(0, 20))
    await expect(rows.nth(0).getByTestId('retry-later-gpu-rank')).toHaveText('1')   // the first card starts ticked, rank 1
    await rows.nth(2).locator('input').check()                                      // L40S second
    await rows.nth(1).locator('input').check()                                      // RTX 4090 third
    await expect(rows.nth(2).getByTestId('retry-later-gpu-rank')).toHaveText('2')
    await expect(rows.nth(1).getByTestId('retry-later-gpu-rank')).toHaveText('3')
    await rows.nth(2).locator('input').uncheck()                                    // drop L40S: RTX 4090 moves up
    await expect(rows.nth(1).getByTestId('retry-later-gpu-rank')).toHaveText('2')
    await modal.getByTestId('retry-later-start').click()
    await expect(modal).toBeHidden()
    expect(api.state.createLikeWhenFree).toEqual([{ id: 'pod-bbbbbbbb', gpu: ['rtx4000ada', 'rtx4090'] }])   // the order chosen
    const row = page.getByTestId('pod-watch-waiting')
    await expect(row.getByTestId('pod-watch-label')).toHaveText('Waiting for a free RTX 4000 Ada or RTX 4090 in EU-RO-1')
    expect(api.state.watches).toHaveLength(1)   // one wait
    noDelete(api)
  })

  test('Cancel starts nothing and the card keeps its choice', async ({ page, api }) => {
    const { card, modal } = await openChoice(page, api)
    await modal.getByTestId('retry-later-cancel').click()
    await expect(modal).toBeHidden()
    expect(api.state.resumeWhenFree).toBeUndefined(); expect(api.state.createLikeWhenFree).toBeUndefined(); expect(api.state.watches || []).toHaveLength(0)
    await expect(card.getByTestId('pod-retry-later')).toBeVisible()
    noDelete(api)
  })

  test('a datacenter with no card the app can run leaves Start waiting disabled for Another GPU', async ({ page, api }) => {
    api.state.datacenters.datacenters[0].cards = []
    const { modal } = await openChoice(page, api)
    await modal.getByTestId('retry-later-other').check()
    await expect(modal.getByTestId('retry-later-none')).toBeVisible()
    await expect(modal.getByTestId('retry-later-start')).toBeDisabled()
  })
})

// A wait for a new pod 'like' this one (Another GPU) shows on the card of the pod it came from, with Cancel; the old pod stays as it is.
test('retry later: a waiting new-pod watch shows on the card of the pod it was made from, found by id or by the name it carries, and Cancel stops it', async ({ page, api }) => {
  const mk = (id, extra) => ({ id, kind: 'create', state: 'waiting', name: `ComfyUI-Dev-${id}`, label: `Waiting for a free ${id} in EU-RO-1`, every_s: 120, attempts: 4, created_at: 'now', next_at: '2026-11-17T14:00:00.000Z', give_up_at: '2026-11-18T01:00:00.000Z', request: {}, ...extra })
  api.state.watches = [mk('RTX-4090', { from_pod_id: 'pod-aaaaaaaa' }), mk('A100-PCIe', {}), mk('Elsewhere', { from_pod_id: 'pod-someone-else', name: 'Other-pod-X' })]
  await page.goto('/')
  const card = podCard(page, 'ComfyUI-Dev')
  const rows = card.getByTestId('pod-like-waiting')
  await expect(rows).toHaveCount(2)   // by id, and by the name prefix for one saved before the id was kept; another pod's wait is not shown here
  await expect(rows.first()).toContainText('Waiting for a free RTX-4090 in EU-RO-1')
  await expect(rows.first()).toContainText('this one is not deleted')
  await expect(rows.first()).toContainText('tried 4')
  await rows.first().getByTestId('pod-like-waiting-cancel').click()
  await expect.poll(() => (api.calls || []).some((c) => c.method === 'DELETE' && /pod-watches/.test(c.path))).toBe(true)
})
