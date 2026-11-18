import { test, expect, modal, cfgTab } from './fixtures'
import { t } from './i18n'

// Big and slow volumes (v1.5.2): the filter box, the capped listing note, the timeout alert with Try again, the newest request winning, the spinner. WRITTEN, NOT RUN (released without tests at Lucas's call).
const picker = (page) => page.locator('.modal.show', { hasText: 'Use this folder' })
const MANY = Array.from({ length: 30 }, (_, i) => `shot-${String(i).padStart(2, '0')}`).concat(['CANALV2'])
async function openPicker(page, api, setup) {
  api.state.fs['/Users/lucas'] = ['Big', 'Slow', 'Fast']; api.state.fs['/Users/lucas/Big'] = MANY; api.state.fs['/Users/lucas/Slow'] = ['a']; api.state.fs['/Users/lucas/Fast'] = ['b']
  setup?.(api.state)
  await page.goto('/')
  await page.getByTestId('open-config').click()
  const d = modal(page, t('config.title')); await cfgTab(d, 'folders')
  await d.locator('[data-testid="folder-row-project"] [data-testid="folder-browse"]').click()
  return picker(page)
}
const dirsCalls = (api) => api.calls.filter((c) => c.path === '/fs/dirs')

test('the filter box shows for a long list, sends the filter after 250 ms, and clears when you navigate', async ({ page, api }) => {
  const p = await openPicker(page, api)
  await expect(p.getByTestId('folder-filter')).toHaveCount(0)   // three folders: no box
  await p.locator('[data-testid="picker-item"][data-name="Big"]').dblclick()
  await expect(p.getByTestId('picker-item')).toHaveCount(31)
  await expect(p.getByTestId('folder-filter')).toBeVisible()
  await p.getByTestId('folder-filter').fill('canal')
  await expect(p.getByTestId('picker-item')).toHaveCount(1)
  expect(dirsCalls(api).at(-1).query.filter).toBe('canal')
  await p.getByTestId('picker-up').click()
  await expect(p.getByTestId('folder-filter')).toHaveCount(0)
  await p.locator('[data-testid="picker-item"][data-name="Big"]').dblclick()
  await expect(p.getByTestId('folder-filter')).toHaveValue('')   // cleared by navigating
  expect(dirsCalls(api).at(-1).query.filter).toBeUndefined()
})

test('a capped listing says how many were left out and offers the filter', async ({ page, api }) => {
  const p = await openPicker(page, api, (s) => { s.fsTruncated = { '/Users/lucas/Big': 5000 } })
  await p.locator('[data-testid="picker-item"][data-name="Big"]').dblclick()
  await expect(p.getByTestId('folder-truncated')).toHaveText('Showing the first 31 of 5000 folders: type to filter')
  await expect(p.getByTestId('folder-filter')).toBeVisible()
  await p.getByTestId('folder-filter').fill('shot-0')
  await expect(p.getByTestId('folder-truncated')).toHaveCount(0)   // the filtered list fits
})

test('a hung folder shows an amber alert with the message; Try again asks again; Up, the typed path and the volumes still work', async ({ page, api }) => {
  const p = await openPicker(page, api, (s) => { s.fsTimeout = ['/Users/lucas/Slow']; s.volumes = [{ name: 'Work', path: '/Volumes/Work', link: false, size_bytes: 1e12, free_bytes: 5e11, readable: true }]; s.fs['/Volumes/Work'] = ['x'] })
  await p.locator('[data-testid="picker-item"][data-name="Slow"]').dblclick()
  const a = p.getByTestId('folder-timeout')
  await expect(a).toContainText('The folder is not answering'); await expect(p.getByTestId('folder-timeout-text')).toHaveText('The folder did not answer within 15 seconds (a sleeping drive or an unavailable network mount). Try again, or pick another place.')
  const before = dirsCalls(api).length
  api.state.fsTimeout = []   // the drive woke up
  await p.getByTestId('folder-retry').click()
  await expect(p.getByTestId('folder-timeout')).toHaveCount(0); await expect(p.getByTestId('picker-item')).toHaveText([/a/])
  expect(dirsCalls(api).length).toBe(before + 1); expect(dirsCalls(api).at(-1).query.path).toBe('/Users/lucas/Slow')
  api.state.fsTimeout = ['/Users/lucas/Slow']
  await p.getByTestId('picker-up').click(); await p.locator('[data-testid="picker-item"][data-name="Slow"]').dblclick()
  await expect(p.getByTestId('folder-timeout')).toBeVisible()
  await p.locator('[data-testid="folder-volume"][data-path="/Volumes/Work"]').click()   // the picker is usable
  await expect(p.getByTestId('picker-path')).toHaveValue('/Volumes/Work'); await expect(p.getByTestId('folder-timeout')).toHaveCount(0)
})

test('a slow listing shows a spinner, and an older answer never overwrites a later, faster navigation', async ({ page, api }) => {
  const p = await openPicker(page, api, (s) => { s.fsDelay = { '/Users/lucas/Slow': 1500 } })
  await p.locator('[data-testid="picker-item"][data-name="Slow"]').dblclick()
  await expect(p.getByTestId('folder-loading')).toBeVisible()
  await p.getByTestId('picker-path').fill('/Users/lucas/Fast'); await p.getByTestId('picker-path').press('Enter')   // a newer navigation while the slow one is pending
  await expect(p.getByTestId('picker-path')).toHaveValue('/Users/lucas/Fast'); await expect(p.getByTestId('picker-item')).toHaveText([/b/])
  await page.waitForTimeout(1800)   // the slow answer arrives now: ignored
  await expect(p.getByTestId('picker-path')).toHaveValue('/Users/lucas/Fast'); await expect(p.getByTestId('picker-item')).toHaveText([/b/]); await expect(p.getByTestId('folder-loading')).toHaveCount(0)
})
