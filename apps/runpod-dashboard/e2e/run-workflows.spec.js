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
  await expect(dlg.locator('[data-testid="runflows-step"][data-step="2"]')).toBeDisabled()   // nothing to show before a run
  await dlg.getByTestId('runflows-file').filter({ hasText: 'other.json' }).locator('input').uncheck()
  await dlg.getByTestId('runflows-run').click()
  await expect(dlg.getByTestId('runflows-outputs')).toHaveCount(1)   // it moves to Outputs by itself: one workflow succeeded, one failed
  await expect(dlg.getByTestId('runflows-outputs-failed')).toContainText('1')
  await expect(dlg.getByTestId('outputs-tile')).toHaveCount(3)
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

test('pod card: Import, Run and Outputs sit on one row; Outputs is disabled until the pod has produced files, then opens the gallery', async ({ page }) => {
  await page.route('**/view?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  await page.goto('/')
  const dev = podCard(page, 'ComfyUI-Dev')   // has a finished run with a file in its history
  await expect(dev.getByTestId('pod-work-row').locator('button')).toHaveText([t('pod.importShort'), t('runflows.button'), t('outputs.button')].map((x) => new RegExp(x)))
  const ys = await dev.getByTestId('pod-work-row').locator('button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
  expect(new Set(ys).size).toBe(1)   // one row
  await expect(dev.getByTestId('pod-outputs')).toBeEnabled()
  await dev.getByTestId('pod-outputs').click()
  const m = page.getByTestId('pod-outputs-modal')
  await expect(m.getByTestId('pod-outputs-run')).toHaveCount(1)   // the failed run has no files and is not listed
  await expect(m.getByTestId('outputs-tile')).toHaveCount(1)
  await m.getByTestId('outputs-tile').click()
  await expect(page.getByTestId('output-viewer').getByTestId('output-viewer-image')).toBeVisible()
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  const test2 = podCard(page, 'ComfyUI-Test')   // starting, no history: nothing to show
  await expect(test2.getByTestId('pod-outputs')).toBeDisabled()
})
