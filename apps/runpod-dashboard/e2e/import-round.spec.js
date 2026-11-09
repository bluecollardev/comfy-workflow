import { test, expect } from './fixtures'

// Import Round and Queue (docs/ADR-038): a call to action at the right of the top bar; one approval queues a pull and a run per shot; the Queue shows each task with its state and error.
test('Import Round: pick a round, see the shots and the caps, approve, and the Queue shows the tasks', async ({ page, api }) => {
  await page.goto('/')
  await expect(page.getByTestId('open-queue')).toBeVisible()
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  await dlg.getByTestId('import-round-select').selectOption({ index: 1 })
  await expect(dlg.getByTestId('import-round-shot')).toHaveCount(2)
  await expect(dlg.getByTestId('import-round-estimate')).toContainText('6.98')
  await expect(dlg.getByTestId('import-round-max-pods')).toHaveValue('2')   // one pod per shot ticked
  await expect(dlg.getByTestId('import-round-start')).toBeDisabled()   // nobody has said yes yet
  await dlg.getByTestId('import-round-shot').filter({ hasText: 'cgi-043' }).locator('input').uncheck()
  await expect(dlg.getByTestId('import-round-max-pods')).toHaveValue('1')   // it follows the ticks
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await dlg.getByTestId('import-round-start').click()
  expect(api.state.imported).toMatchObject({ shots: ['cgi-042'], approved_by: 'Lucas', run_workflows: true, max_pods: 1, cost_cap_usd: 50 })
  const q = page.getByTestId('queue-modal')
  await expect(q.getByTestId('queue-task')).toHaveCount(2)
  await expect(q.getByTestId('queue-task').filter({ hasText: 'cgi-042' })).toContainText('boom (node 4, KSampler)')
  await expect(q.getByTestId('queue-task').filter({ hasText: 'cgi-042' }).getByTestId('queue-retry')).toBeVisible()
})
