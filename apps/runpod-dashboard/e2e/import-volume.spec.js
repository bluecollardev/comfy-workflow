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

test('Volume source: a volume chooser (the Shared volume), the rounds with shots and graphs, a folder that is not a round disabled, Browse on every round (nothing is copied)', async ({ page, api }) => {
  const dlg = await openVolume(page, api)
  await expect(dlg.getByTestId('import-round-source-volume')).toHaveValue('vol1')   // the Shared volume is the default
  await expect(dlg.getByTestId('import-round-source-volume-note')).toContainText('read-only')
  await expect(dlg.getByTestId('import-round-option')).toHaveCount(3)
  const r5 = dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"]')
  await expect(r5.getByTestId('import-round-counts')).toContainText('3 shots · 5 graphs · 1 reference only')
  await expect(dlg.locator('[data-testid="import-round-option"][data-round="canalv2"] input')).toBeDisabled()   // listed, not a round
  await expect(dlg.getByTestId('import-round-browse')).toHaveCount(3)   // every round can be inspected, the one that is not a round too
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
  const run = dlg.getByTestId('import-round-run')   // a volume round is run in place: Run Workflows is there, ticked and locked, the first of the four
  await expect(run).toBeVisible(); await expect(run).toBeChecked(); await expect(run).toBeDisabled(); await expect(dlg.getByTestId('import-round-run-hint')).toContainText('run in place')
  await expect(dlg.getByTestId('import-round-autosync')).toBeVisible(); await expect(dlg.getByTestId('import-round-generate')).toBeVisible()   // the chain below it is offered
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

// Browse Files on the volume's rounds: the read-only tree of comfy-shared/workflows/<round>, listed by prefix over the S3 API (no pod), nothing copied.
test('Volume source: Browse Files on a round opens the volume tree with sizes and folder totals; nothing is copied', async ({ page, api }) => {
  const dlg = await openVolume(page, api)
  await dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"]').getByTestId('import-round-browse').click()
  const m = page.getByTestId('round-files-modal')
  await expect(m).toContainText('comfy-workspace · comfy-shared/workflows/proxy_v005')   // which volume and folder
  await expect(m.getByTestId('round-files-summary')).toContainText('5')
  await expect(m.getByTestId('round-files-where')).toContainText('nothing is copied')
  const rows = m.getByTestId('round-files-row')
  await expect(rows.filter({ hasText: 'archival-080' }).first()).toContainText('3')   // the folder's file total (its two graphs and notes/)
  await expect(m).toContainText('README.md'); await expect(m).toContainText('2 KB')
  await expect(rows.filter({ hasText: /readme\.md/ })).toHaveCount(0)   // deeper folders closed (the regex is case-sensitive: README.md is another file)
  await rows.filter({ hasText: 'notes' }).first().click()
  await rows.filter({ hasText: 'old' }).first().click()
  await expect(rows.filter({ hasText: /readme\.md/ })).toContainText('1.0 MB')
  expect(api.state.roundFilesCalls).toEqual([{ volume_id: 'vol1', round: 'proxy_v005' }])   // one prefix, lazily, on the click
  expect(api.state.volumeImportCalls?.length || 0).toBe(0)   // nothing copied
  await m.getByText('Close', { exact: true }).click()
  await expect(m).toBeHidden()
  await expect(dlg).toBeVisible()
})

test('Volume source: Browse Files is not called until the button is clicked', async ({ page, api }) => {
  const dlg = await openVolume(page, api)
  await expect(dlg.getByTestId('import-round-option')).toHaveCount(3)
  expect(api.state.roundFilesCalls?.length || 0).toBe(0)
})

test('Volume source: Browse Files on a shot shows only that shot folder', async ({ page, api }) => {
  const dlg = await openVolume(page, api)
  await dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"] input').check()
  await dlg.getByTestId('import-round-next').click()
  await dlg.getByTestId('import-round-shot').filter({ hasText: 'archival-084' }).getByTestId('import-round-shot-browse').click()
  const m = page.getByTestId('round-files-modal')
  await expect(m).toContainText('comfy-shared/workflows/proxy_v005/archival-084')
  await expect(m.getByTestId('round-files-row').filter({ hasText: 'archival-084__main' })).toHaveCount(1)
  await expect(m).not.toContainText('archival-080'); await expect(m).not.toContainText('README.md')
  expect(api.state.roundFilesCalls).toEqual([{ volume_id: 'vol1', round: 'proxy_v005', shot: 'archival-084' }])
  expect(api.state.volumeImportCalls?.length || 0).toBe(0)
})

test('Volume source: a listing error shows inline in the modal and the window still works', async ({ page, api }) => {
  api.state.volumeLib = { filesFail: "RunPod's S3 API: An error occurred (AccessDenied) when calling the ListObjectsV2 operation" }
  const dlg = await openVolume(page, api)
  await dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"]').getByTestId('import-round-browse').click()
  const m = page.getByTestId('round-files-modal')
  await expect(m.getByTestId('round-files-error')).toContainText('AccessDenied')
  await m.getByText('Close', { exact: true }).click()
  await expect(m).toBeHidden()
  await dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"] input').check()   // still usable
  await dlg.getByTestId('import-round-next').click()
  await expect(dlg.getByTestId('import-round-shot')).toHaveCount(2)
})

test('Volume source: a round with nothing in it says nothing there, not an error; a truncated listing says so', async ({ page, api }) => {
  api.state.volumeLib = { files: [] }
  const dlg = await openVolume(page, api)
  await dlg.locator('[data-testid="import-round-option"][data-round="proxy_v004g"]').getByTestId('import-round-browse').click()
  const m = page.getByTestId('round-files-modal')
  await expect(m).toContainText('Nothing there')
  await expect(m.getByTestId('round-files-error')).toHaveCount(0)
  await m.getByText('Close', { exact: true }).click()
  api.state.volumeLib = { filesTruncated: true }
  await dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"]').getByTestId('import-round-browse').click()
  await expect(page.getByTestId('round-files-capped')).toBeVisible()
})

// A failed rounds listing shows its reason and a Retry that runs the same listing again.
test('Volume source: a failed rounds listing shows the reason and Retry; a second failure keeps Retry; then the rounds appear', async ({ page, api }) => {
  api.state.libraryItems = { fail: [false, true, 'The volume timed out', false], delay: [0, 0, 0, 400] }   // call 1 is BH, on open
  const dlg = await openVolume(page, api)
  await expect(dlg.getByTestId('import-round-rounds-error')).toContainText('Unable to locate credentials')
  await expect(dlg.getByTestId('import-round-rounds-retry')).toHaveText('Retry')
  await expect(dlg.getByTestId('import-round-option')).toHaveCount(0)
  await dlg.getByTestId('import-round-rounds-retry').click()
  await expect(dlg.getByTestId('import-round-rounds-error-text')).toContainText('The volume timed out')   // a second failure keeps Retry
  await expect(dlg.getByTestId('import-round-rounds-retry')).toBeVisible()
  await dlg.getByTestId('import-round-rounds-retry').click()
  await expect(dlg.getByTestId('import-round-listing')).toBeVisible()   // the spinner line is back
  await expect(dlg.getByTestId('import-round-option')).toHaveCount(3)
  await expect(dlg.getByTestId('import-round-rounds-error')).toHaveCount(0)
  await expect(dlg.getByTestId('import-round-rounds-retry')).toHaveCount(0)
})

test('Volume source: an empty rounds listing says there are no rounds, with no Retry', async ({ page, api }) => {
  api.state.volumeLib = { rounds: [] }
  const dlg = await openVolume(page, api)
  await expect(dlg).toContainText('No rounds under comfy-shared/workflows/')
  await expect(dlg.getByTestId('import-round-rounds-retry')).toHaveCount(0)
})

test('Import Round: a failed BH rounds listing offers Retry too; a late answer from the volume is ignored after the Source changes', async ({ page, api }) => {
  api.state.libraryItems = { fail: [false, false, false, true], delay: [0, 1500, 0, 0] }
  const dlg = await openVolume(page, api)   // call 1 is BH on open; call 2: the volume's rounds, held for 1.5 s
  await dlg.getByTestId('import-round-source').selectOption('panama-s3')   // call 2: BH, answers at once
  await expect(dlg.getByTestId('import-round-option').first()).toBeVisible()
  await page.waitForTimeout(1800)
  await expect(dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"]')).toHaveCount(0)   // the stale volume answer did not overwrite BH's
  await dlg.getByTestId('import-round-source').selectOption('volume')   // call 3 fails
  await expect(dlg.getByTestId('import-round-rounds-retry')).toBeVisible()
  await dlg.getByTestId('import-round-source').selectOption('panama-s3')   // a new source clears the old error
  await expect(dlg.getByTestId('import-round-rounds-error')).toHaveCount(0)
})

test('Import Round: the BH listing failing shows Retry', async ({ page, api }) => {
  api.state.libraryItems = { fail: [true] }
  await page.goto('/')
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  await expect(dlg.getByTestId('import-round-rounds-error')).toBeVisible()
  await dlg.getByTestId('import-round-rounds-retry').click()
  await expect(dlg.getByTestId('import-round-option').first()).toBeVisible()
  await expect(dlg.getByTestId('import-round-rounds-retry')).toHaveCount(0)
})

// The Source defaults to Volume when it can be used (the S3 keys are set and a volume can be chosen), else the BH bucket.
test('Import Round starts on Volume when the volume source is available: its rounds, the Shared volume chosen, no BH listing first', async ({ page, api }) => {
  api.state.volumeSourceReady = true; api.state.sharedVolume = 'vol1'
  await page.goto('/')
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  await expect(dlg.getByTestId('import-round-source')).toHaveValue('volume')
  await expect(dlg.getByTestId('import-round-source-volume')).toHaveValue('vol1')
  await expect(dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"]')).toBeVisible()
  await expect(dlg.getByTestId('import-round-option')).toHaveCount(3)
  expect(api.state.libraryCalls.filter((c) => c.path === '/library/items').every((c) => c.source === 'volume')).toBe(true)   // the first rounds loaded are the volume's
  await dlg.getByTestId('import-round-source').selectOption('panama-s3')   // still a default only: switch back and forth
  await expect(dlg.getByTestId('import-round-option').first()).not.toHaveAttribute('data-round', 'proxy_v005')
  await dlg.getByTestId('import-round-source').selectOption('volume')
  await expect(dlg.getByTestId('import-round-option')).toHaveCount(3)
  await expect(dlg.locator('[data-testid="import-round-option"][data-round="proxy_v005"]')).toBeVisible()
})

test('Import Round starts on BH when the volume source is unavailable (no keys), with nothing odd shown', async ({ page, api }) => {
  api.state.sharedVolume = 'vol1'   // volumeSourceReady unset: no S3 keys
  await page.goto('/')
  await page.getByTestId('open-import-round').click()
  const dlg = page.getByTestId('import-round-modal')
  await expect(dlg.getByTestId('import-round-source')).toHaveValue('panama-s3')
  await expect(dlg.getByTestId('import-round-source-volume-row')).toHaveCount(0)
  await expect(dlg.getByTestId('import-round-source-reason')).toHaveCount(0)
  await expect(dlg.getByTestId('import-round-option').first()).toBeVisible()
  expect((api.state.libraryCalls || []).length).toBe(0)
})

test('Import Round opened by a re-import keeps the BH source even when the volume is available', async ({ page, api }) => {
  api.state.volumeSourceReady = true; api.state.sharedVolume = 'vol1'
  api.state.pods.find((p) => p.name === 'ComfyUI-Batch').round = 'brynley-comfy-2026-11-06'
  await page.goto('/')
  await page.locator('[data-testid="round-section"][data-round="brynley-comfy-2026-11-06"]').getByTestId('round-reimport').click()
  const dlg = page.getByTestId('import-round-modal')
  await expect(dlg.locator('[data-testid="import-round-option"][data-round="brynley-comfy-2026-11-06"] input')).toBeChecked()
  await expect(dlg.getByTestId('import-round-source')).toHaveValue('panama-s3')
})

test('Volume source: a round on both sources browses the one the Source select is on', async ({ page, api }) => {
  const dlg = await openVolume(page, api)
  await dlg.getByTestId('import-round-source').selectOption('panama-s3')
  await dlg.getByTestId('import-round-browse').first().click()
  const m = page.getByTestId('round-files-modal')
  await expect(m.getByTestId('round-files-row')).toHaveCount(5)   // the BH bucket tree
  await expect(m).not.toContainText('comfy-shared/workflows')
  await m.getByText('Close', { exact: true }).click()
  expect(api.state.roundFilesCalls?.length || 0).toBe(0)
  await dlg.getByTestId('import-round-source').selectOption('volume')
  await dlg.getByTestId('import-round-browse').first().click()
  await expect(page.getByTestId('round-files-modal')).toContainText('comfy-shared/workflows/')
})
