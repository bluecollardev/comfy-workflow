import { test, expect, cfgTab } from './fixtures'

// The close icon of a dismissible alert sits inside it, vertically centred at the right. It hung off the bottom edge of the Studio's error alert
// (desktop screenshot, 2026-10-24, "no core call imports.getPrompt").
test('the Studio\'s error alert keeps its close icon inside it, centred on the right, and closes it', async ({ page, api }) => {
  api.state.studio.saveFails = 'no core call imports.getPrompt'
  await page.goto('/')
  await page.getByTestId('open-config').click()
  const cfg = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
  await cfgTab(cfg, 'adapters')
  await cfg.locator('[data-testid="adapter-row"][data-id="agent-made"]').getByTestId('adapter-edit').click()
  const studio = page.getByTestId('studio')
  await studio.getByTestId('studio-name').fill('Renamed')
  await studio.getByTestId('studio-save').click()
  const alert = studio.getByTestId('studio-error')
  await expect(alert).toContainText('no core call imports.getPrompt')
  const [a, x] = await Promise.all([alert.boundingBox(), alert.locator('.btn-close').boundingBox()])
  expect(x.y).toBeGreaterThanOrEqual(a.y - 0.5); expect(x.y + x.height).toBeLessThanOrEqual(a.y + a.height + 0.5)   // inside the alert, not hanging off its bottom
  expect(Math.abs(x.y + x.height / 2 - (a.y + a.height / 2))).toBeLessThan(3)                                          // centred
  expect(x.x + x.width).toBeLessThanOrEqual(a.x + a.width + 0.5)
  await alert.locator('.btn-close').click()
  await expect(alert).toHaveCount(0)
})
