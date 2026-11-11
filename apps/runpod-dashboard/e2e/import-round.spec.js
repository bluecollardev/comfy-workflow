import { test, expect } from './fixtures'

// Import Round and Queue (docs/ADR-038): a call to action at the right of the top bar; one approval queues a pull and a run per shot; the Queue shows each task with its state and error.
test('Import Round: three steps - rounds, shots, cards - then Import with the approval in the footer; the Queue shows the tasks', async ({ page, api }) => {
  await page.goto('/')
  await expect(page.getByTestId('open-queue')).toBeVisible()
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  // 1. Choose rounds
  await expect(dlg.locator('[data-testid="import-round-step"][data-active="true"]')).toContainText('Choose rounds')
  await expect(dlg.getByTestId('import-round-next')).toBeDisabled()
  await dlg.getByTestId('import-round-option').first().locator('input').check()
  await dlg.getByTestId('import-round-browse').first().click()   // the round's files as a folder tree
  await expect(page.getByTestId('round-files-modal').getByTestId('round-files-row')).toHaveCount(5)
  await page.getByTestId('round-files-modal').getByText('Close', { exact: true }).click()
  await expect(dlg.locator('.stepper-item[data-done="true"]')).toHaveCount(1)   // step 1 is green with a check as soon as the round is chosen
  await dlg.getByTestId('import-round-next').click()
  // 2. Choose shots
  await expect(dlg.locator('[data-testid="import-round-step"][data-active="true"]')).toContainText('Choose shots')
  await expect(dlg.getByTestId('import-round-shot')).toHaveCount(2)
  await dlg.getByTestId('import-round-shot').filter({ hasText: 'cgi-043' }).locator('input').uncheck()
  await dlg.getByTestId('import-round-next').click()
  // 3. Choose cards for the shots
  await dlg.locator('[data-testid="import-round-step"][data-step="1"]').click()   // a finished step can be revisited from the stepper
  await expect(dlg.getByTestId('import-round-option').first()).toBeVisible()
  await dlg.locator('[data-testid="import-round-step"][data-step="3"]').click()   // and so can the next one, once its shots are chosen
  await expect(dlg.getByTestId('import-round-card-row')).toHaveCount(1)
  await expect(dlg.getByTestId('import-round-estimate')).toContainText('6.98')
  await expect(dlg.getByTestId('import-round-max-pods')).toHaveValue('1')   // one pod per shot ticked
  await dlg.getByTestId('import-round-card').selectOption('rtxpro6000')
  await expect(dlg.getByTestId('import-round-volume-problem')).toBeVisible()   // no default volume: one has to be picked
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await expect(dlg.getByTestId('import-round-start')).toBeDisabled()   // no volume yet
  await dlg.getByTestId('import-round-volume').selectOption('vol1')
  await expect(dlg.getByTestId('import-round-volume-note')).toBeVisible()   // it becomes the default
  await expect(dlg.locator('.stepper-item[data-done="true"]')).toHaveCount(3)   // all three are green with a check once it can be imported
  await expect(dlg.locator('.stepper-item.done .fa-check')).toHaveCount(3)
  await dlg.getByTestId('import-round-start').click()   // Approved by is in the footer
  expect(api.state.imported).toMatchObject({ shots: ['cgi-042'], cards: { 'cgi-042': 'rtxpro6000' }, approved_by: 'Lucas', run_workflows: true, max_pods: 1, cost_cap_usd: 50 })
  const q = page.getByTestId('queue-modal')
  await expect(q.getByTestId('queue-task')).toHaveCount(2)
  await expect(q.getByTestId('queue-task').filter({ hasText: 'cgi-042' })).toContainText('boom (node 4, KSampler)')
  await expect(q.getByTestId('queue-task').filter({ hasText: 'cgi-042' }).getByTestId('queue-retry')).toBeVisible()
})

test('Import Round(s): several rounds can be ticked; each is its own import, the dollar cap is split between them', async ({ page, api }) => {
  await page.goto('/')
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  await dlg.getByTestId('import-round-option').nth(0).locator('input').check()
  await dlg.getByTestId('import-round-option').nth(1).locator('input').check()
  await dlg.getByTestId('import-round-next').click()
  await expect(dlg.getByTestId('import-round-group')).toHaveCount(2)
  await dlg.getByTestId('import-round-next').click()
  await expect(dlg.getByTestId('import-round-estimate')).toContainText('13.96')   // 6.98 for each round
  await dlg.getByTestId('import-round-volume').selectOption('vol1')
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await dlg.getByTestId('import-round-start').click()
  await expect.poll(() => api.state.importedAll?.length).toBe(2)
  expect(api.state.importedAll.map((i) => i.round)).toEqual(['brynley-comfy-2026-10-23', 'brynley-comfy-2026-10-20'])
  expect(api.state.importedAll.every((i) => i.approved_by === 'Lucas' && i.cost_cap_usd === 25 && i.max_pods === 2)).toBe(true)
})

test('Import Round(s): the Import button is always there; a zip or folder dropped from the desktop is staged and imported on this PC', async ({ page, api }) => {
  await page.goto('/')
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  await page.setViewportSize({ width: 1000, height: 520 })   // a short window: the button is in the modal's footer, never scrolled out of sight
  await expect(dlg.getByTestId('import-round-start')).toBeDisabled()   // there before anything is ticked
  await expect(dlg.getByTestId('import-round-start')).toBeInViewport()
  await expect(dlg.getByTestId('import-round-hint')).toBeVisible()
  await dlg.getByTestId('import-round-drop').evaluate((el) => {
    const dt = new DataTransfer(); const f = new File(['x'], 'brynley-extra.zip'); Object.defineProperty(f, 'path', { value: '/Users/x/brynley-extra.zip' }); dt.items.add(f)
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  const row = dlg.getByTestId('import-round-dropped-row')
  await expect(row).toContainText('brynley-extra')
  await expect(row).toContainText('zip extracted')
  expect(api.state.staged).toEqual(['/Users/x/brynley-extra.zip'])
  await row.getByTestId('import-round-dropped-import').click()
  await expect(page.getByTestId('import-modal')).toBeVisible()   // Import Shot Pack, on the dropped folder
})

test('Queue: the latest import is at the top, the oldest at the bottom, and the list scrolls', async ({ page, api }) => {
  api.state.queue = { imports: Array.from({ length: 4 }, (_, n) => ({ id: `imp${n}`, round: `round-${n}`, approved_by: 'L', created_at: `2026-11-09T0${n}:00:00Z`, state: 'done', spent_usd: 0, cap_enabled: true, cost_cap_usd: 10, max_pods: 2, counts: {} })), tasks: Array.from({ length: 4 }, (_, n) => Array.from({ length: 8 }, (_, k) => ({ id: `t${n}-${k}`, import_id: `imp${n}`, round: `round-${n}`, shot: k ? `shot-${k}` : null, kind: k ? 'run' : 'pull', state: 'failed' }))).flat(), active: 0 }
  await page.goto('/'); await page.getByTestId('open-queue').click()
  const q = page.getByTestId('queue-modal')
  await expect(q.getByTestId('queue-import').locator('strong').first()).toHaveText('round-3')
  await expect(q.getByTestId('queue-import').locator('strong').last()).toHaveText('round-0')
  const body = q.locator('.modal-body')
  await body.hover(); await page.mouse.wheel(0, 600)
  await expect.poll(() => body.evaluate((b) => b.scrollTop)).toBeGreaterThan(300)
})

test('Queue: a task shows its pod, its stage and, opened, what happened and when', async ({ page, api }) => {
  api.state.queue = { imports: [{ id: 'imp1', round: 'round-a', approved_by: 'L', created_at: '2026-11-09T01:00:00Z', state: 'active', spent_usd: 0, cap_enabled: true, cost_cap_usd: 10, max_pods: 2, counts: {} }], tasks: [{ id: 't1', import_id: 'imp1', round: 'round-a', shot: 'cgi-042', kind: 'run', state: 'running', pod_id: 'pod9', pod_name: 'queue-round-a-1', gpu: 'rtxpro6000', card: 'rtxpro6000', started_at: '2026-11-09T01:00:05Z', stage: 'running 1/3 graphs', events: [{ at: '2026-11-09T01:00:05Z', text: 'created pod queue-round-a-1 (rtxpro6000) in round round-a' }, { at: '2026-11-09T01:03:00Z', text: 'pod queue-round-a-1 is ready: running 3 graph(s)' }] }], active: 1 }
  await page.goto('/'); await page.getByTestId('open-queue').click()
  const q = page.getByTestId('queue-modal')
  await expect(q.getByTestId('queue-task-stage')).toHaveText('running 1/3 graphs')
  await expect(q.getByTestId('queue-task')).toContainText('pod9')
  await expect(q.getByTestId('queue-task-card')).toHaveText('rtxpro6000')   // the card is in the queue
  await q.getByTestId('queue-details').click()
  await expect(q.getByTestId('queue-task-events')).toContainText('created pod queue-round-a-1 (rtxpro6000)')
  await expect(q.getByTestId('queue-task-events')).toContainText('is ready: running 3 graph(s)')
})

test('Import Round(s): the steps are clickable in any order once their needs are met; a step that is not ready says why', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  const step = (n) => dlg.locator(`[data-testid="import-round-step"][data-step="${n}"]`)
  await step(3).click()   // nothing chosen yet: it says why and stays
  await expect(dlg.getByTestId('import-round-error')).toBeVisible()
  await expect(step(1)).toHaveAttribute('data-active', 'true')
  await dlg.getByTestId('import-round-option').first().locator('input').check()
  await step(3).click()   // straight to the last step, without Next
  await expect(step(3)).toHaveAttribute('data-active', 'true')
  await step(2).click()   // and back to the middle
  await expect(dlg.getByTestId('import-round-shot').first()).toBeVisible()
  await step(1).click()
  await expect(dlg.getByTestId('import-round-option').first()).toBeVisible()
})
