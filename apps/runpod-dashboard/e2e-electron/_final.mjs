import { _electron as electron } from '@playwright/test'
const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.setViewportSize({ width: 1400, height: 900 })
page.on('console', (m) => { if (m.type() === 'error' && !/unsafe-eval|Content Security/.test(m.text())) console.log('console error', m.text().slice(0, 160)) })
await page.waitForSelector('[data-testid="pod-card"]', { timeout: 90000 })
const card = page.locator('[data-testid="pod-card"]', { hasText: 'ComfyUI-4090' }).first()
await page.waitForFunction(() => { const b = document.querySelector('[data-testid="pod-card"] [data-testid="pod-outputs"]'); return b && !b.disabled }, null, { timeout: 60000 })
await card.getByTestId('pod-outputs').click()
await page.waitForSelector('[data-testid="pod-outputs-run"]', { timeout: 30000 })
console.log('run titles:', JSON.stringify(await page.getByTestId('pod-outputs-workflow').allInnerTexts()))
await page.waitForTimeout(4000)
await page.getByTestId('outputs-tile').first().click()
const t0 = Date.now()
for (let i = 0; i < 40; i++) {
  const st = await page.getByTestId('output-viewer-image').evaluate((e) => ({ complete: e.complete, w: e.naturalWidth })).catch(() => null)
  if (st && st.complete && st.w > 0) { console.log('viewer image loaded in', Date.now() - t0, 'ms', JSON.stringify(st)); break }
  if (i === 39) console.log('viewer image never loaded', JSON.stringify(st))
  await page.waitForTimeout(1000)
}
await page.screenshot({ path: '/private/tmp/claude-501/-Users-lucas-Workspaces-comfy-workflow/9938f3bb-33f9-439b-9afe-101fc0172ba2/scratchpad/final.png' })
await app.close()
