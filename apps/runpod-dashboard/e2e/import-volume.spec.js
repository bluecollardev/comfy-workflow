import { test, expect } from './fixtures'

// ADR-044 steps 2 to 4: Import Round with Source = Volume. Binc's rounds already sit on a network volume: listed read-only, shots ticked as for BH, locked shots disabled
// as reference only, nothing about pulling, the estimate with its assumption and the cap before Start, and Start sends the shots (the core enforces the three guards).
async function openVolume(page, api) {
  api.state.sharedVolume = 'vol1'
  await page.goto('/')
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  await dlg.getByTestId('import-round-source').selectOption('volume')
  return dlg
}

test('Volume source: a volume chooser (the Shared volume), the rounds with shots and graphs, a folder that is not a round disabled, no Browse (nothing is copied)', async ({ page, api }) => {
  const dlg = await openVolume(page, api)
  await expect(dlg.getByTestId('import-round-source-volume')).toHaveValue('vol1')   // the Shared volume is the default
  await expect(dlg.getByTestId('import-round-source-volume-note')).toContainText('read-only')
  await expect(dlg.getByTestId('import-round-option')).toHaveCount(3)
  const r5 = dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"]')
  await expect(r5.getByTestId('import-round-counts')).toContainText('3 shots · 5 graphs · 1 reference only')
  await expect(dlg.locator('[data-testid="import-round-option"][data-round="canalv2"] input')).toBeDisabled()   // listed, not a round
  await expect(dlg.getByTestId('import-round-browse')).toHaveCount(0)   // the BH file tree is for BH rounds
  expect(api.state.libraryCalls.some((c) => c.path === '/library/items' && c.source === 'volume' && c.volume_id === 'vol1')).toBe(true)
})

test('Volume source: locked shots are disabled with a reference-only badge; the estimate, its assumption and the cap show before Start; Start sends the shots in place', async ({ page, api }) => {
  const dlg = await openVolume(page, api)
  await dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"] input').check()
  await dlg.getByTestId('import-round-next').click()
  await expect(dlg.getByTestId('import-round-shot')).toHaveCount(2)   // archival-080 and archival-084 can be ticked
  const locked = dlg.getByTestId('import-round-shot-locked')
  await expect(locked).toHaveCount(1); await expect(locked).toContainText('cgi-042')
  await expect(locked.locator('input')).toBeDisabled()
  await expect(locked.getByTestId('import-round-reference-only')).toHaveText('reference only')
  await dlg.getByTestId('import-round-shot').filter({ hasText: 'archival-084' }).locator('input').uncheck()
  await dlg.getByTestId('import-round-next').click()
  // step 3: no pull or download wording, no "run after the pull" tick, the volume is fixed
  await expect(dlg.getByTestId('import-round-inplace')).toBeVisible()
  await expect(dlg.getByTestId('import-round-run')).toHaveCount(0)
  await expect(dlg.getByTestId('import-round-volume')).toHaveCount(0)
  await expect(dlg.getByTestId('import-round-volume-fixed')).toContainText('comfy-workspace')
  await expect(dlg.getByTestId('import-round-vol-estimate')).toContainText('$0.12 for 2 graphs')
  await expect(dlg.getByTestId('import-round-assumption')).toContainText('600 s')
  await expect(dlg.getByTestId('import-round-remaining')).toContainText('$94.5')
  await expect(dlg.getByTestId('import-round-cost-cap')).toHaveValue('50')
  expect(await dlg.innerText()).not.toMatch(/\bpull|download/i)
  await expect(dlg.getByTestId('import-round-over-cap')).toHaveCount(0)
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await dlg.getByTestId('import-round-start').click()
  await expect(dlg).toBeHidden()
  await expect.poll(() => api.state.volumeImportCalls?.length).toBe(1)
  expect(api.state.volumeImportCalls[0]).toMatchObject({ source: 'volume', volume_id: 'vol1', approved_by: 'Lucas', run_workflows: true, cost_cap_usd: 50, items: [{ round: 'proxy_v005', shots: ['archival-080'] }] })
  expect(JSON.stringify(api.state.volumeImportCalls[0])).not.toContain('cgi-042')   // the locked shot is never sent
  expect(api.state.volumeImportCalls[0]).not.toHaveProperty('replace')
})

test('Volume source: an estimate over the cap shows and Start stays disabled', async ({ page, api }) => {
  api.state.volumeLib = { priceFactor: 1000 }   // the fake core prices every graph a thousand times higher
  const dlg = await openVolume(page, api)
  await dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"] input').check()
  await dlg.getByTestId('import-round-next').click(); await dlg.getByTestId('import-round-next').click()
  await dlg.getByTestId('import-round-approved-by').fill('Lucas')
  await expect(dlg.getByTestId('import-round-over-cap')).toBeVisible()
  await expect(dlg.getByTestId('import-round-start')).toBeDisabled()
  expect(api.state.planCalls.at(-1)).toMatchObject({ source: 'volume', volume_id: 'vol1', cost_cap_usd: 50 })
})

test('Volume source: a volume with no S3 API or no keys says why, lists nothing and starts no pod', async ({ page, api }) => {
  api.state.volumeLib = { status: { available: false, reason: 'RUNPOD_S3_ACCESS_KEY and RUNPOD_S3_SECRET_KEY are not set', volume_id: 'vol1' } }
  const dlg = await openVolume(page, api)
  await expect(dlg.getByTestId('import-round-volume-reason')).toContainText('not set')
  await expect(dlg.getByTestId('import-round-option')).toHaveCount(0)
  expect(api.state.libraryCalls.some((c) => c.path === '/library/items')).toBe(false)
})

test('Volume source: Check models is read-only, per round, on demand, and says where a model is instead', async ({ page, api }) => {
  const dlg = await openVolume(page, api)
  await dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"]').getByTestId('import-round-check-models').click()
  const res = dlg.getByTestId('import-round-models')
  await expect(res).toContainText('1 model(s) missing across 4 graphs')
  await expect(res.getByTestId('import-round-model-miss')).toContainText('LTX23_audio_vae_bf16.safetensors')
  await expect(res.getByTestId('import-round-model-miss')).toContainText('models/vae/LTX23_audio_vae_bf16.safetensors')
  await expect(res.getByTestId('import-round-model-miss')).toContainText('models/checkpoints/')
  expect(api.state.libraryCalls.filter((c) => c.path === '/library/preflight')).toHaveLength(1)   // one round, on demand
  await expect(dlg.getByTestId('import-round-source')).toHaveValue('volume')
  await dlg.getByTestId('import-round-source').selectOption('panama-s3')   // BH again: its rounds, unchanged
  await expect(dlg.getByTestId('import-round-option')).toHaveCount(3)
  await expect(dlg.getByTestId('import-round-browse').first()).toBeVisible()
})
