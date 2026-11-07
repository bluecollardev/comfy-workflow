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
  await expect(dlg.getByTestId('runflows-summary')).toBeVisible()
  expect(api.state.ranFlows).toEqual(['rounds/r1/cgi-042/stereo.json', 'rounds/r1/cgi-042/delivery.json'])
  await expect(dlg.getByTestId('runflows-error-line')).toContainText('boom (node 4, KSampler)')
  await expect(dlg.getByTestId('runflows-result').first()).toHaveAttribute('data-state', 'failed')
})
