import { test, expect, queueTab } from './fixtures'

// Import Round, step 3: Run Workflows > (Auto Sync To This PC, Generate Outputs > Publish). A child is HIDDEN (not disabled) unless its parent is ticked, and unticking a parent clears the children.
// The fake core (e2e/fixtures.js) records each import request in state.importManyBodies; nothing reaches a pod, S3 or Slack.
async function toStepThree(page, api, { by = '' } = {}) {
  await page.goto('/')
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  await dlg.getByTestId('import-round-option').first().locator('input').check()
  await dlg.getByTestId('import-round-next').click()
  await dlg.getByTestId('import-round-next').click()
  await expect(dlg.getByTestId('import-round-run')).toBeVisible()
  if (by) await dlg.getByTestId('import-round-approved-by').fill(by)
  return dlg
}
const ids = { sync: 'import-round-autosync', gen: 'import-round-generate', pub: 'import-round-publish' }
const lastBody = (api) => api.state.importManyBodies.at(-1)
async function start(dlg, api, n) {
  await dlg.getByTestId('import-round-volume').selectOption('vol1')
  await dlg.getByTestId('import-round-start').click()
  await expect.poll(() => api.state.importManyBodies?.length).toBe(n)
  return lastBody(api)
}

test('defaults: all four off, only Run Workflows is shown', async ({ page, api }) => {
  const dlg = await toStepThree(page, api)
  await expect(dlg.getByTestId('import-round-run')).not.toBeChecked()
  for (const id of Object.values(ids)) await expect(dlg.getByTestId(id)).toHaveCount(0)
  await expect(dlg.getByTestId('import-round-autosync-block')).toHaveCount(0)
})

test('ticking Run Workflows shows Auto Sync and Generate Outputs; ticking Generate Outputs shows Publish', async ({ page, api }) => {
  const dlg = await toStepThree(page, api, { by: 'Lucas' })
  await dlg.getByTestId('import-round-run').check()
  await expect(dlg.getByTestId(ids.sync)).toBeVisible(); await expect(dlg.getByTestId(ids.gen)).toBeVisible()
  await expect(dlg.getByTestId(ids.sync)).not.toBeChecked(); await expect(dlg.getByTestId(ids.gen)).not.toBeChecked()
  await expect(dlg.getByTestId(ids.pub)).toHaveCount(0)
  await expect(dlg.getByTestId('import-round-autosync-block')).toContainText('Auto Sync To This PC')
  await expect(dlg.getByTestId('import-round-autosync-hint')).toContainText('New outputs are copied to this PC by themselves (never deleted). Uses the name in Approved by.')
  await dlg.getByTestId(ids.gen).check()
  await expect(dlg.getByTestId(ids.gen)).toBeChecked()
  await expect(dlg.getByTestId(ids.pub)).toBeVisible(); await expect(dlg.getByTestId(ids.pub)).toBeEnabled(); await expect(dlg.getByTestId(ids.pub)).not.toBeChecked()
  await expect(dlg.getByTestId('import-round-autosync-block')).toContainText('Generate Outputs')
  await expect(dlg.getByTestId('import-round-autosync-block')).toContainText('Publish')
})

test('the four options are one group in order, Run Workflows first (labelled Run Workflows), then Auto Sync To This PC, Generate Outputs, Publish', async ({ page, api }) => {
  const dlg = await toStepThree(page, api, { by: 'Lucas' })
  await expect(dlg.getByTestId('import-round-run').locator('xpath=ancestor::label')).toContainText('Run Workflows')
  await dlg.getByTestId('import-round-run').check(); await dlg.getByTestId('import-round-generate').check()
  const y = async (id) => (await dlg.getByTestId(id).boundingBox()).y
  const ys = [await y('import-round-run'), await y('import-round-autosync'), await y('import-round-generate'), await y('import-round-publish')]
  expect(ys).toEqual([...ys].sort((p, q) => p - q))   // top to bottom: Run Workflows, Auto Sync, Generate Outputs, Publish
  expect(new Set(ys).size).toBe(4)
})
test('Publish is disabled with the reason when publishing is not configured', async ({ page, api }) => {
  api.state.publish = { panamaKeys: false }   // S3 has no keys: not ready
  const dlg = await toStepThree(page, api, { by: 'Lucas' })
  await dlg.getByTestId('import-round-run').check(); await dlg.getByTestId(ids.gen).check()
  await expect(dlg.getByTestId(ids.pub)).toBeDisabled()
  await expect(dlg.getByTestId('import-round-publish-reason')).toContainText('Publishing is not set up yet: The Panama exchange keys are not set')
})

test('unticking Run Workflows hides and clears the three; the request carries none of them', async ({ page, api }) => {
  const dlg = await toStepThree(page, api, { by: 'Lucas' })
  await dlg.getByTestId('import-round-run').check()
  await dlg.getByTestId(ids.sync).check(); await dlg.getByTestId(ids.gen).check(); await dlg.getByTestId(ids.pub).check()
  await dlg.getByTestId('import-round-run').uncheck()
  for (const id of Object.values(ids)) await expect(dlg.getByTestId(id)).toHaveCount(0)
  await dlg.getByTestId('import-round-run').check()   // back on: they come back unticked
  await expect(dlg.getByTestId(ids.sync)).not.toBeChecked(); await expect(dlg.getByTestId(ids.gen)).not.toBeChecked()
  await expect(dlg.getByTestId(ids.pub)).toHaveCount(0)
  await dlg.getByTestId('import-round-run').uncheck()
  const body = await start(dlg, api, 1)
  expect(body.run_workflows).toBe(false)
  for (const k of ['auto_sync', 'generate_outputs', 'publish']) expect(body).not.toHaveProperty(k)
})

test('unticking Generate Outputs hides and clears Publish', async ({ page, api }) => {
  const dlg = await toStepThree(page, api, { by: 'Lucas' })
  await dlg.getByTestId('import-round-run').check(); await dlg.getByTestId(ids.gen).check(); await dlg.getByTestId(ids.pub).check()
  await expect(dlg.getByTestId(ids.pub)).toBeChecked()
  await dlg.getByTestId(ids.gen).uncheck()
  await expect(dlg.getByTestId(ids.pub)).toHaveCount(0)
  await dlg.getByTestId(ids.gen).check()
  await expect(dlg.getByTestId(ids.pub)).not.toBeChecked()   // cleared: not remembered
  await dlg.getByTestId(ids.gen).uncheck()
  const body = await start(dlg, api, 1)
  expect(body.run_workflows).toBe(true)
  for (const k of ['generate_outputs', 'publish']) expect(body).not.toHaveProperty(k)
})

test('an empty Approved by blocks ticking Generate Outputs and Publish, with the message', async ({ page, api }) => {
  const dlg = await toStepThree(page, api)   // no name
  await dlg.getByTestId('import-round-run').check()
  await dlg.getByTestId(ids.gen).click()   // blocked: the box does not tick
  await expect(dlg.getByTestId(ids.gen)).not.toBeChecked()
  await expect(dlg.getByTestId('import-round-name-needed')).toContainText('Fill in Approved by first')
  await expect(dlg.getByTestId(ids.pub)).toHaveCount(0)
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await expect(dlg.getByTestId('import-round-name-needed')).toHaveCount(0)
  await dlg.getByTestId(ids.gen).check()
  await expect(dlg.getByTestId(ids.gen)).toBeChecked()
  await dlg.getByTestId('import-round-approved-by').fill('')
  await dlg.getByTestId(ids.pub).click()   // the name was cleared again: Publish is blocked the same way
  await expect(dlg.getByTestId(ids.pub)).not.toBeChecked()
  await expect(dlg.getByTestId('import-round-name-needed')).toBeVisible()
})

test('the request carries exactly the ticked options, for every combination', async ({ page, api }) => {
  const combos = [
    { run: false, sync: false, gen: false, pub: false },
    { run: true, sync: false, gen: false, pub: false },
    { run: true, sync: true, gen: false, pub: false },
    { run: true, sync: false, gen: true, pub: false },
    { run: true, sync: true, gen: true, pub: false },
    { run: true, sync: false, gen: true, pub: true },
    { run: true, sync: true, gen: true, pub: true },
  ]
  let n = 0
  for (const c of combos) {
    const dlg = await toStepThree(page, api, { by: 'Lucas' })
    if (c.run) await dlg.getByTestId('import-round-run').check()
    if (c.sync) await dlg.getByTestId(ids.sync).check()
    if (c.gen) await dlg.getByTestId(ids.gen).check()
    if (c.pub) await dlg.getByTestId(ids.pub).check()
    const body = await start(dlg, api, ++n)
    expect(body.run_workflows, JSON.stringify(c)).toBe(c.run)
    expect('auto_sync' in body, JSON.stringify(c)).toBe(c.sync); if (c.sync) expect(body.auto_sync).toBe(true)
    expect('generate_outputs' in body, JSON.stringify(c)).toBe(c.gen); if (c.gen) expect(body.generate_outputs).toBe(true)
    expect('publish' in body, JSON.stringify(c)).toBe(c.pub); if (c.pub) expect(body.publish).toBe(true)
    expect(body.approved_by).toBe('Lucas')
  }
})

test('the plan is asked with the options too, and the summary says what will happen', async ({ page, api }) => {
  const dlg = await toStepThree(page, api, { by: 'Lucas' })
  await expect(dlg.getByTestId('import-round-autosync-line')).toHaveCount(0)
  await dlg.getByTestId('import-round-run').check()
  await dlg.getByTestId(ids.sync).check(); await dlg.getByTestId(ids.gen).check(); await dlg.getByTestId(ids.pub).check()
  await expect(dlg.getByTestId('import-round-autosync-line')).toContainText('Auto sync: on (pull)')
  await expect(dlg.getByTestId('import-round-generate-line')).toHaveText('Then generate the review videos on each pod')
  await expect(dlg.getByTestId('import-round-publish-line')).toHaveText('Then publish them to S3 as Lucas')
  await expect.poll(() => api.state.planCalls.at(-1)).toMatchObject({ run_workflows: true, generate_outputs: true, publish: true })
  await dlg.getByTestId(ids.pub).uncheck()
  await expect(dlg.getByTestId('import-round-publish-line')).toHaveCount(0)
  await expect(dlg.getByTestId('import-round-generate-line')).toBeVisible()
  await dlg.getByTestId(ids.gen).uncheck()
  await expect(dlg.getByTestId('import-round-generate-line')).toHaveCount(0)
})

test('a volume source: Run Workflows is shown ticked and locked (rounds run in place) and the chain below it is offered; the options apply to volume and BH alike', async ({ page, api }) => {
  api.state.sharedVolume = 'vol1'
  await page.goto('/')
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  await dlg.getByTestId('import-round-source').selectOption('volume')
  await dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"] input').check()
  await dlg.getByTestId('import-round-next').click()
  await dlg.getByTestId('import-round-next').click()
  await expect(dlg.getByTestId('import-round-run')).toBeVisible(); await expect(dlg.getByTestId('import-round-run')).toBeChecked(); await expect(dlg.getByTestId('import-round-run')).toBeDisabled()
  await expect(dlg.getByTestId(ids.sync)).toBeVisible(); await expect(dlg.getByTestId(ids.gen)).toBeVisible()
  await expect(dlg.getByTestId(ids.pub)).toHaveCount(0)
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await dlg.getByTestId(ids.gen).check(); await expect(dlg.getByTestId(ids.pub)).toBeVisible()
  await dlg.getByTestId(ids.pub).check()
  await dlg.getByTestId('import-round-start').click()
  await expect.poll(() => api.state.volumeImportCalls?.length).toBe(1)
  expect(api.state.volumeImportCalls[0]).toMatchObject({ source: 'volume', run_workflows: true, generate_outputs: true, publish: true, approved_by: 'Lucas' })
})

test('the Queue card of an import says what it does after the runs and why a step could not run', async ({ page, api }) => {
  api.state.queue = { imports: [{ id: 'imp1', round: 'r1', approved_by: 'Lucas', state: 'active', spent_usd: 0, cap_enabled: true, cost_cap_usd: 50, max_pods: 1, counts: {}, generate_outputs: true, publish: { s3: true, slack: false }, output_notes: ['pod-1 (cgi-043): cannot generate: ffmpeg is not installed on this PC'] }], tasks: [], active: 1 }
  await page.goto('/')
  await queueTab(page, 'imports')
  const q = page.getByTestId('queue-modal')
  await expect(q.getByTestId('queue-import-outputs')).toContainText('generate the review videos and publish them, as Lucas')
  await expect(q.getByTestId('queue-import-output-note')).toContainText('ffmpeg is not installed')
})
