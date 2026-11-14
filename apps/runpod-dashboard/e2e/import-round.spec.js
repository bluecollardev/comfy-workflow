import { test, expect } from './fixtures'

// Import Round and Queue (docs/ADR-038): a call to action at the right of the top bar; one approval queues a pull and a run per shot; the Queue shows each task with its state and error.
test('Import Round: three steps - rounds, shots, cards - then Import with the approval in the footer; the Queue shows the tasks', async ({ page, api }) => {
  await page.goto('/')
  await expect(page.getByTestId('open-queue')).toBeVisible()
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  // 1. Choose rounds
  await expect(dlg.locator('[data-testid="import-round-step"][data-active="true"]')).toContainText('Choose Rounds')
  await dlg.getByTestId('import-round-next').click()   // nothing chosen: Next says why instead of doing nothing
  await expect(dlg.getByTestId('import-round-error')).toBeVisible()
  await expect(dlg.locator('[data-testid="import-round-step"][data-active="true"]')).toContainText('Choose Rounds')
  await dlg.getByTestId('import-round-option').first().locator('input').check()
  await dlg.getByTestId('import-round-browse').first().click()   // the round's files as a folder tree
  await expect(page.getByTestId('round-files-modal').getByTestId('round-files-row')).toHaveCount(5)
  await page.getByTestId('round-files-modal').getByText('Close', { exact: true }).click()
  await expect(dlg.locator('.stepper-item[data-done="true"]')).toHaveCount(1)   // step 1 is green with a check as soon as the round is chosen
  await dlg.getByTestId('import-round-next').click()
  // 2. Choose shots
  await expect(dlg.locator('[data-testid="import-round-step"][data-active="true"]')).toContainText('Choose Shots')
  await expect(dlg.getByTestId('import-round-shot')).toHaveCount(2)
  await page.route('**/panama/files*', (r) => r.fulfill({ json: { round: 'r', files: 3, bytes: 600, entries: [{ path: 'cgi-042', dir: true, bytes: 300, files: 1 }, { path: 'cgi-042/a.json', dir: false, bytes: 300 }, { path: 'cgi-043', dir: true, bytes: 300, files: 1 }, { path: 'cgi-043/b.json', dir: false, bytes: 300 }] } }))
  await dlg.getByTestId('import-round-shot').filter({ hasText: 'cgi-042' }).getByTestId('import-round-shot-browse').click()   // each shot has its own Browse: that shot's files only
  const files = page.getByTestId('round-files-modal')
  await expect(files.getByTestId('round-files-row')).toHaveCount(2)
  await expect(files).toContainText('a.json'); await expect(files).not.toContainText('b.json')
  await files.getByText('Close', { exact: true }).click()
  const all = dlg.getByTestId('import-round-shots-select-all')
  const left = async (l) => (await l.boundingBox()).x
  expect(Math.abs(await left(all) - await left(dlg.getByTestId('import-round-shot').first().locator('input')))).toBeLessThan(2)   // above the checkbox column
  await expect(all).toBeChecked()
  await all.uncheck()   // select all clears every shot, then ticks them again
  await expect(dlg.getByTestId('import-round-shot').locator('input:checked')).toHaveCount(0)
  await all.check()
  await expect(dlg.getByTestId('import-round-shot').locator('input:checked')).toHaveCount(2)
  await dlg.getByTestId('import-round-shot').filter({ hasText: 'cgi-043' }).locator('input').uncheck()
  await dlg.getByTestId('import-round-next').click()
  // 3. Configure deployment: cards for the shots, volume, caps
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
  await page.route('**/queue/import-many', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.fallback() })   // planning takes a while
  await dlg.getByTestId('import-round-start').click()   // Approved by is in the footer
  await expect(dlg).toBeHidden()   // the wizard gives way at once to the Queue, which says what is going on
  await expect(page.getByTestId('queue-modal').getByTestId('queue-starting')).toContainText('Queueing')
  await expect(page.getByTestId('queue-modal').getByTestId('queue-starting')).toBeHidden()
  expect(api.state.imported).toMatchObject({ shots: ['cgi-042'], cards: { 'cgi-042': 'rtxpro6000' }, approved_by: 'Lucas', run_workflows: true, max_pods: 1, cost_cap_usd: 50 })
  const q = page.getByTestId('queue-modal')
  await expect(q.getByTestId('queue-task')).toHaveCount(2)
  await expect(q.getByTestId('queue-task').filter({ hasText: 'cgi-042' })).toContainText('boom (node 4, KSampler)')
  await expect(q.getByTestId('queue-task').filter({ hasText: 'cgi-042' }).getByTestId('queue-retry')).toBeVisible()
  const bs = await q.getByTestId('queue-task').filter({ hasText: 'cgi-042' }).getByTestId('queue-actions').locator('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))
  for (let i = 1; i < bs.length; i++) expect(bs[i].left - bs[i - 1].right).toBeGreaterThanOrEqual(4)   // the buttons do not touch
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

test('Import Round(s): a round with no shots is refused on its own row and stays unticked', async ({ page, api }) => {
  await page.route('**/queue/plan', async (route) => { const body = route.request().postDataJSON(); await route.fulfill({ json: body.round === 'brynley-comfy-2026-10-20' ? { round: body.round, shots: [], price_per_hour: 3.99, pull_hours: 0.5, est_total_usd: 2, max_pods: 2, cost_cap_usd: 50, cap_enabled: true, over_cap: false } : { round: body.round, shots: ['cgi-042'], price_per_hour: 3.99, pull_hours: 0.5, est_total_usd: 6, max_pods: 2, cost_cap_usd: 50, cap_enabled: true, over_cap: false } }) })
  await page.goto('/'); await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  const row = dlg.locator('[data-testid="import-round-option"][data-round="brynley-comfy-2026-10-20"]')
  await row.locator('input').check()
  await expect(dlg.getByTestId('import-round-row-error')).toContainText('No shots in this round')
  await expect(row.locator('input')).not.toBeChecked()
  await dlg.getByTestId('import-round-next').click()   // still nothing valid chosen
  await expect(dlg.locator('[data-testid="import-round-step"][data-active="true"]')).toContainText('Choose Rounds')
  await dlg.locator('[data-testid="import-round-option"][data-round="brynley-comfy-2026-10-23"] input').check()
  await expect(dlg.getByTestId('import-round-row-error')).toHaveCount(1)   // the other round's check did not clear it
  await dlg.getByTestId('import-round-next').click()
  await expect(dlg.getByTestId('import-round-shot')).toHaveCount(1)
})

test('Import Round(s): step 2 opens right after a round is ticked, while its shots are still being read', async ({ page }) => {
  await page.route('**/queue/plan', async (route) => { const body = route.request().postDataJSON(); await new Promise((r) => setTimeout(r, 2000)); await route.fulfill({ json: { round: body.round, shots: ['cgi-042', 'cgi-043'], price_per_hour: 3.99, pull_hours: 0.5, est_total_usd: 6, max_pods: 2, cost_cap_usd: 50, cap_enabled: true, over_cap: false } }) })
  await page.goto('/'); await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  await dlg.getByTestId('import-round-option').first().locator('input').check()
  await dlg.locator('[data-testid="import-round-step"][data-step="2"]').click()   // not waiting for the plan
  await expect(dlg.locator('[data-testid="import-round-step"][data-step="2"]')).toHaveAttribute('data-active', 'true')
  await expect(dlg.getByTestId('import-round-reading')).toBeVisible()
  await dlg.getByTestId('import-round-next').click()   // still reading: says so
  await expect(dlg.getByTestId('import-round-error')).toBeVisible()
  await expect(dlg.getByTestId('import-round-shot')).toHaveCount(2)   // then the shots appear
  await expect(dlg.getByTestId('import-round-reading')).toHaveCount(0)
})

test('Import Round(s): Select all ticks every round (and clears them), and Next goes on with all of them', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  const boxes = dlg.getByTestId('import-round-option').locator('input')
  { const x = async (l) => (await l.boundingBox()).x; expect(Math.abs(await x(dlg.getByTestId('import-round-select-all')) - await x(dlg.getByTestId('import-round-option').first().locator('input')))).toBeLessThan(2) }   // above the checkbox column
  await dlg.getByTestId('import-round-select-all').check()
  const n = await boxes.count()
  for (let i = 0; i < n; i++) await expect(boxes.nth(i)).toBeChecked()
  await dlg.getByTestId('import-round-next').click()
  await expect(dlg.getByTestId('import-round-group')).toHaveCount(n)
  await dlg.locator('[data-testid="import-round-step"][data-step="1"]').click()
  await dlg.getByTestId('import-round-select-all').uncheck()
  for (let i = 0; i < await boxes.count(); i++) await expect(boxes.nth(i)).not.toBeChecked()
})

test('Queue: Purge finished asks first; No keeps everything, Yes removes finished imports and leaves the running one', async ({ page, api }) => {
  const imp = (id, state) => ({ id, round: `round-${id}`, approved_by: 'L', created_at: '2026-11-09T01:00:00Z', state, spent_usd: 0, cap_enabled: true, cost_cap_usd: 10, max_pods: 2, counts: {} })
  api.state.queue = { imports: [imp('a', 'done'), imp('b', 'active')], tasks: [{ id: 't1', import_id: 'a', round: 'round-a', shot: null, kind: 'pull', state: 'done' }, { id: 't2', import_id: 'b', round: 'round-b', shot: 'x', kind: 'run', state: 'running' }], active: 1 }
  await page.goto('/'); await page.getByTestId('open-queue').click()
  const q = page.getByTestId('queue-modal')
  await expect(q.getByTestId('queue-import')).toHaveCount(2)
  page.once('dialog', (d) => d.dismiss())   // the user says no
  await q.getByTestId('queue-purge').click()
  await expect(q.getByTestId('queue-import')).toHaveCount(2)
  expect(api.state.purged).toBeUndefined()
  page.once('dialog', (d) => { expect(d.message()).toContain('1 finished'); d.accept() })   // the user says yes
  await q.getByTestId('queue-purge').click()
  await expect(q.getByTestId('queue-import')).toHaveCount(1)
  await expect(q.getByTestId('queue-import')).toContainText('round-b')
  expect(api.state.purged).toEqual({ confirmed: true })
})
