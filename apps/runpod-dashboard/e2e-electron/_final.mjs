import { _electron as electron } from '@playwright/test'
const S = '/private/tmp/claude-501/-Users-lucas-Workspaces-comfy-workflow/9938f3bb-33f9-439b-9afe-101fc0172ba2/scratchpad/'
const log = (...a) => console.log(new Date().toISOString().slice(14, 19), ...a)
const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.setViewportSize({ width: 1400, height: 900 })
try {
  await page.waitForSelector('[data-testid="pod-card"]', { timeout: 90000 }); log('cards shown')
  const card = page.locator('[data-testid="pod-card"]', { hasText: 'ComfyUI-4090' }).first()
  await page.waitForFunction(() => { const b = document.querySelector('[data-testid="pod-card"] [data-testid="pod-outputs"]'); return b && !b.disabled }, null, { timeout: 60000 }); log('outputs enabled')
  await card.getByTestId('pod-outputs').click()
  await page.waitForSelector('[data-testid="pod-outputs-run"]', { timeout: 30000 }); log('runs listed')
  log('titles:', JSON.stringify(await page.getByTestId('pod-outputs-workflow').allInnerTexts()))
  await page.waitForTimeout(5000)
  await page.screenshot({ path: S + 'out-list.png' })
  await page.getByTestId('outputs-tile').first().click(); log('tile clicked')
  const t0 = Date.now()
  for (let i = 0; i < 45; i++) {
    const st = await page.getByTestId('output-viewer-image').evaluate((e) => ({ complete: e.complete, w: e.naturalWidth, h: e.naturalHeight })).catch(() => null)
    if (st && st.complete && st.w > 0) { log('viewer image loaded in', Date.now() - t0, 'ms', JSON.stringify(st)); break }
    if (i === 44) log('viewer image never loaded', JSON.stringify(st))
    await page.waitForTimeout(1000)
  }
  await page.screenshot({ path: S + 'out-viewer.png' })
} catch (e) { log('FAILED', e.message.slice(0, 200)); await page.screenshot({ path: S + 'out-fail.png' }).catch(() => {}) }
await app.close()
