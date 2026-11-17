import { test, expect, podCard } from './fixtures'
import { t } from './i18n'

// Run workflows (docs/ADR-037): a button on a running pod's card opens a modal listing the pod's graphs by folder, all ticked; the user picks, runs, and sees each graph's result with its error.
test('Run workflows: the button opens a modal with every graph ticked; untick one, run, and the failing graph shows its error', async ({ page, api }) => {
  await page.goto('/')
  const card = podCard(page, 'ComfyUI-Dev')
  const btn = card.getByTestId('pod-run-workflows')
  await expect(btn).toBeVisible(); await expect(btn).toBeEnabled(); await expect(btn).toContainText(t('runflows.button'))
  await btn.click()
  const dlg = page.getByTestId('runflows-modal')
  await expect(dlg.getByTestId('runflows-file')).toHaveCount(3)
  await expect(dlg.getByTestId('runflows-group')).toHaveCount(2)
  await expect(dlg.getByTestId('runflows-count')).toContainText('3')   // all ticked by default: every workflow in the shot
  await dlg.getByTestId('runflows-file').filter({ hasText: 'other.json' }).locator('input').uncheck()
  await expect(dlg.getByTestId('runflows-run')).toContainText('2')
  await dlg.getByTestId('runflows-run').click()
  await expect(dlg.getByTestId('runflows-outputs')).toHaveCount(1)   // it moves to Outputs by itself
  await dlg.locator('[data-testid="runflows-step"][data-step="1"]').click()   // a run with results moves to Outputs by itself: the Run step still has the summary and the errors
  await expect(dlg.getByTestId('runflows-summary')).toBeVisible()
  expect(api.state.ranFlows).toEqual(['rounds/r1/cgi-042/stereo.json', 'rounds/r1/cgi-042/delivery.json'])
  await expect(dlg.getByTestId('runflows-error-line')).toContainText('boom (node 4, KSampler)')
  await expect(dlg.getByTestId('runflows-result').first()).toHaveAttribute('data-state', 'failed')
})

// Two steps: Run, then Outputs (the reusable gallery with a viewer and a download), and the card's own Outputs button.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
test('Run workflows: step 2 shows what the successful runs produced; a tile opens the viewer with Previous/Next, Open and Download', async ({ page }) => {
  await page.context().route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-run-workflows').click()
  const dlg = page.getByTestId('runflows-modal')
  await expect(dlg.locator('[data-testid="runflows-step"][data-step="2"]')).toHaveClass(/blocked/)   // the same stepper as Import Round: step 2 is dimmed until a run has something to show
  await dlg.locator('[data-testid="runflows-step"][data-step="2"]').click(); await expect(dlg.getByTestId('runflows-run')).toBeVisible()   // and a click does not go there
  await dlg.getByTestId('runflows-file').filter({ hasText: 'other.json' }).locator('input').uncheck()
  await dlg.getByTestId('runflows-run').click()
  await expect(dlg.getByTestId('runflows-outputs')).toHaveCount(1)   // it moves to Outputs by itself: one workflow succeeded, one failed
  await expect(dlg.getByTestId('runflows-outputs-failed')).toContainText('1')
  await expect(dlg.getByTestId('outputs-tile')).toHaveCount(3)
  await expect(dlg.getByTestId('outputs-zip')).toContainText('zip')   // Download all (zip): the app saves it; in a browser the button says so and is off
  await expect(dlg.getByTestId('outputs-zip')).toBeDisabled()
  await expect(dlg.locator('[data-testid="outputs-tile"][data-type="temp"]')).toHaveCount(1)   // a preview is marked and listed after the saved results
  await dlg.getByTestId('outputs-tile').first().click()
  const viewer = page.getByTestId('output-viewer')
  await expect(viewer.getByTestId('output-viewer-image')).toBeVisible()
  await expect(viewer.getByTestId('output-viewer-image')).toHaveAttribute('src', /pod-a\.test\/view\?filename=result_00001_\.png&subfolder=r1&type=output/)
  await viewer.getByTestId('output-viewer-next').click()
  await expect(viewer.getByTestId('output-viewer-video')).toBeVisible()
  await expect(viewer.getByTestId('output-viewer-download')).toBeVisible()
  await expect(viewer.getByTestId('output-viewer-open')).toHaveAttribute('href', /clip\.mp4/)
  await viewer.getByTestId('output-viewer-prev').click()
  const popup = page.waitForEvent('popup')
  await viewer.getByTestId('output-viewer-download').click()   // in the app: a Save As dialog and the bytes from the pod; in a browser (a pod on another address): the file opens in a tab to save
  const tab = await popup; await tab.waitForLoadState()
  expect(tab.url()).toContain('filename=result_00001_.png')
  await page.keyboard.press('Escape')
  await dlg.getByTestId('runflows-back').click()
  await expect(dlg.getByTestId('runflows-run')).toBeVisible()
})

test('pod card: Import, Run and Outputs sit on one row; Outputs is disabled until the pod has produced files or sits on a network volume, then opens the gallery', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'].splice(1, 0, { prompt_id: 'beadbead-1111-2222', workflow: 'rounds/r1/cgi-043/other.json', status: 'success', started_at: '2026-11-03T11:20:00Z', duration_s: 9.1, cost_estimate: 0.01, outputs: [{ filename: 'other_0001.png', type: 'output', subfolder: '' }] })   // a second finished run, in another workflow
  await page.route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  await page.goto('/')
  const dev = podCard(page, 'ComfyUI-Dev')   // has a finished run with a file in its history
  await expect(dev.getByTestId('pod-work-row').locator('button')).toHaveText([t('pod.importShort'), t('runflows.button'), t('outputs.button')].map((x) => new RegExp(x)))
  const ys = await dev.getByTestId('pod-work-row').locator('button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
  expect(new Set(ys).size).toBe(1)   // one row
  await expect(dev.getByTestId('pod-outputs')).toBeEnabled()
  await dev.getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(2)   // the failed run has no files and is not listed
  await expect(m.getByTestId('outputs-tile')).toHaveCount(2)
  const bar = await m.getByTestId('pod-outputs-toolbar').boundingBox(), refresh = await m.getByTestId('pod-outputs-refresh').boundingBox()
  expect(refresh.x + refresh.width).toBeGreaterThan(bar.x + bar.width - 4)   // Refresh sits at the right edge of the toolbar
  await expect(m.getByTestId('pod-outputs-workflow').first()).toHaveText('other')   // newest first (11:20), then stereo (11:00)
  await expect(m.getByTestId('pod-outputs-workflow').nth(1)).toHaveText('stereo')   // each run names the workflow it came from, with its folder beside it
  await expect(m.getByTestId('pod-outputs-run-title').nth(1)).toContainText('rounds/r1/cgi-042')
  await m.getByTestId('outputs-tile').first().click()
  await expect(page.getByTestId('output-viewer').getByTestId('output-viewer-image')).toBeVisible()
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect(podCard(page, 'ComfyUI-Test').getByTestId('pod-outputs')).toBeEnabled()   // starting, no history, but on the network volume: its outputs can be listed over S3 (docs/ADR-045)
  await expect(podCard(page, 'ComfyUI-Batch').getByTestId('pod-outputs')).toBeDisabled()   // no runs and no volume: nothing to show
})

test('pod Outputs: with a Shot set on the pod only that shot\'s runs show, with a box to see them all', async ({ page, api }) => {
  api.state.history.runs['pod-aaaaaaaa'].splice(1, 0, { prompt_id: 'beadbead-1111-2222', workflow: 'rounds/r1/cgi-043/other.json', status: 'success', started_at: '2026-11-03T11:20:00Z', duration_s: 9.1, cost_estimate: 0.01, outputs: [{ filename: 'other_0001.png', type: 'output', subfolder: '' }] })
  await page.route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  const dev = api.state.pods.find((p) => p.name === 'ComfyUI-Dev'); dev.round = 'r1'; dev.shot = 'stereo'
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1)
  const bar2 = await m.getByTestId('pod-outputs-toolbar').boundingBox(), refresh2 = await m.getByTestId('pod-outputs-refresh').boundingBox()
  expect(refresh2.x + refresh2.width).toBeGreaterThan(bar2.x + bar2.width - 4)   // and with the shot filter on and one run showing
  await expect(m.getByTestId('pod-outputs-workflow')).toHaveText('stereo')
  await expect(m.getByTestId('pod-outputs-shot-filter')).toContainText('1')   // "1 other run hidden"
  await m.getByTestId('pod-outputs-shot-filter').locator('input').uncheck()
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(2)
})

test('Run workflows: a pod with a Shot set pre-ticks only that shot\'s graphs; "All Shots" ticks them all', async ({ page, api }) => {
  const dev = api.state.pods.find((p) => p.name === 'ComfyUI-Dev'); dev.round = 'r1'; dev.shot = 'stereo'
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-run-workflows').click()
  const dlg = page.getByTestId('runflows-modal')
  await expect(dlg.getByTestId('runflows-count')).toContainText('1')   // 1 of 3: only the graphs of the pod's Shot
  await expect(dlg.getByTestId('runflows-run')).toContainText('1')
  await dlg.getByTestId('runflows-all').click()
  await expect(dlg.getByTestId('runflows-run')).toContainText('3')   // and the user can still tick the rest
})

// State survives closing the window (the run lives in the core; the ticks are kept per pod): reopening shows what was ticked and a run still going.
test('Run workflows: closing and reopening keeps what was ticked, and finds a run that is still going', async ({ page, api }) => {
  await page.goto('/')
  const open = async () => { await podCard(page, 'ComfyUI-Dev').getByTestId('pod-run-workflows').click(); return page.getByTestId('runflows-modal') }
  let dlg = await open()
  await expect(dlg.getByTestId('runflows-count')).toContainText('3')
  await dlg.getByTestId('runflows-file').filter({ hasText: 'other.json' }).locator('input').uncheck()
  await expect(dlg.getByTestId('runflows-count')).toContainText('2')
  await dlg.getByTestId('runflows-close').click()
  await expect(page.getByTestId('runflows-modal')).toBeHidden()
  dlg = await open()   // the ticks come back, not "everything ticked"
  await expect(dlg.getByTestId('runflows-count')).toContainText('2')
  await expect(dlg.getByTestId('runflows-file').filter({ hasText: 'other.json' }).locator('input')).not.toBeChecked()
  await dlg.getByTestId('runflows-close').click()
  await expect(page.getByTestId('runflows-modal')).toBeHidden()
  // a run the core still has going: the window finds it again, shows each graph's state, and its graphs are the selection
  api.state.ranFlows = ['rounds/r1/cgi-042/stereo.json', 'rounds/r1/cgi-043/other.json']
  api.state.latestFlow = { id: 'run-1', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', state: 'running', started_at: 'now', ok: 0, failed: 0, results: [{ path: 'rounds/r1/cgi-042/stereo.json', state: 'running' }, { path: 'rounds/r1/cgi-043/other.json', state: 'pending' }] }
  dlg = await open()
  await expect(dlg.getByTestId('runflows-count')).toContainText('2')
  await expect(dlg.getByTestId('runflows-cancel')).toBeVisible()
  await expect(dlg.getByTestId('runflows-run')).toBeDisabled()
  await expect(dlg.getByTestId('runflows-result').first()).toHaveAttribute('data-state', 'running')
})

// A run in progress shows in the card's own Run button: it says Running, stays clickable, and opens the window on that run's progress.
test('pod card: while a run is in progress the Run button says Running and opens the window on its progress; when it is over the button says Run again', async ({ page, api }) => {
  api.state.ranFlows = ['rounds/r1/cgi-042/stereo.json', 'rounds/r1/cgi-043/other.json']
  api.state.latestFlow = { id: 'run-1', pod_id: 'pod-aaaaaaaa', pod_name: 'ComfyUI-Dev', state: 'running', started_at: 'now', ok: 0, failed: 0, results: [{ path: 'rounds/r1/cgi-042/stereo.json', state: 'running' }, { path: 'rounds/r1/cgi-043/other.json', state: 'pending' }] }
  await page.goto('/')
  const btn = podCard(page, 'ComfyUI-Dev').getByTestId('pod-run-workflows')
  await expect(btn).toContainText(t('runflows.running'))
  await expect(btn).toHaveAttribute('data-running', 'true')
  await expect(btn).toBeEnabled()
  await expect(btn).toHaveAttribute('title', t('runflows.runningTitle', { done: 0, total: 2 }))
  await btn.click()
  const dlg = page.getByTestId('runflows-modal')
  await expect(dlg.getByTestId('runflows-cancel')).toBeVisible()   // its progress, not an empty list
  await expect(dlg.getByTestId('runflows-result').first()).toHaveAttribute('data-state', 'running')
  api.state.latestFlow = null   // the run is over
  await dlg.getByTestId('runflows-close').click()
  await expect(btn).toHaveAttribute('data-running', 'false')
  await expect(btn).toContainText(t('runflows.button'))
})

// The right pane has two logs: this run's own steps, and ComfyUI's log on the pod, line for line (the same data as the pod's Logs button).
test('Run workflows: the Pod log tab shows the pod\'s ComfyUI log line for line, errors and warnings coloured', async ({ page }) => {
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-run-workflows').click()
  const dlg = page.getByTestId('runflows-modal')
  await expect(dlg.getByTestId('runflows-log')).toBeVisible()   // the run's own log is the default tab
  await dlg.getByTestId('runflows-tab-pod').click()
  await expect(dlg.getByTestId('runflows-podlog-line')).toHaveCount(3)
  await expect(dlg.getByTestId('runflows-podlog-line').nth(0)).toContainText('Starting server')
  await expect(dlg.getByTestId('runflows-podlog-line').nth(2)).toContainText('CUDA out of memory')
  await expect(dlg.getByTestId('runflows-podlog-line').nth(2)).toHaveClass(/text-danger/)
  await expect(dlg.getByTestId('runflows-podlog-line').nth(1)).toHaveClass(/text-warning/)
  await dlg.getByTestId('runflows-tab-run').click()
  await expect(dlg.getByTestId('runflows-log')).toBeVisible()
})
