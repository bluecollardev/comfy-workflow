import { test, expect, modal, cfgTab, openVolumes, openModels, answerConfirm } from './fixtures'
import { t } from './i18n'

// Shared (ADR-042 section 9): the nav button opens a chooser with Volumes and Models; the Shared volume is badged and cannot be deleted;
// the Models window searches Hugging Face, lists a repo's weight files and loads the chosen ones onto the Shared volume; the agent rules
// are one app-wide setting.

const configModal = (page) => page.locator('.modal.show', { has: page.getByTestId('config-modal') })

test.describe('Shared', () => {
  test('the button says Shared and opens a chooser: Volumes opens the volumes window, Models its own', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('open-shared')).toContainText(t('app.shared'))
    await page.getByTestId('open-shared').click()
    const chooser = page.getByTestId('shared-modal')
    await expect(chooser).toBeVisible()
    await expect(chooser.getByTestId('shared-volumes')).toContainText(t('shared.volumes'))
    await expect(chooser.getByTestId('shared-models')).toContainText(t('shared.models'))
    await chooser.getByTestId('shared-volumes').click()
    await expect(modal(page, t('volumes.title'))).toBeVisible()
    await expect(chooser).toBeHidden()
    await modal(page, t('volumes.title')).getByRole('button', { name: t('volumes.done') }).click()
    await openModels(page)
    await expect(page.getByTestId('models-modal')).toBeVisible()
  })

  test('the Shared volume carries a badge, its Delete is disabled with the reason, and Make Shared moves it', async ({ page, api }) => {
    await page.goto('/')
    const dialog = await (async () => { await openVolumes(page); return modal(page, t('volumes.title')) })()
    const vol1 = dialog.locator('[data-testid="volume"][data-id="vol1"]'), vol2 = dialog.locator('[data-testid="volume"][data-id="vol2"]')
    await expect(dialog.getByTestId('volume-shared-badge')).toHaveCount(0)               // nothing is Shared yet
    await vol2.getByTestId('volume-set-shared').click()
    expect(api.state.sharedVolume).toBe('vol2')
    await expect(vol2.getByTestId('volume-shared-badge')).toHaveText(t('volumes.sharedBadge'))
    await expect(vol1.getByTestId('volume-shared-badge')).toHaveCount(0)
    await expect(vol2.getByTestId('volume-delete')).toBeDisabled()                        // it holds the models: not deletable
    await expect(vol2.getByTestId('volume-delete')).toHaveAttribute('aria-label', t('volumes.deleteShared'))
    await vol1.getByTestId('volume-set-shared').click()                                   // another volume becomes the Shared one
    await expect(vol1.getByTestId('volume-shared-badge')).toBeVisible()
    await expect(vol2.getByTestId('volume-shared-badge')).toHaveCount(0)
    await expect(vol2.getByTestId('volume-delete')).toBeEnabled()
    await vol1.getByTestId('volume-set-shared').click()                                   // and Not Shared clears it
    await expect(dialog.getByTestId('volume-shared-badge')).toHaveCount(0)
    expect(api.state.sharedCalls).toEqual(['vol2', 'vol1', ''])
  })

  test('Models: search Hugging Face, open a repo, choose files and a folder, load them onto the Shared volume; no name is asked for', async ({ page, api }) => {
    api.state.sharedVolume = 'vol1'
    await page.goto('/')
    await openModels(page)
    const m = page.getByTestId('models-modal')
    await expect(m.getByTestId('models-target')).toContainText('comfy-workspace')
    await expect(m.getByTestId('models-target')).not.toContainText(t('models.targetDefault'))   // a Shared volume adds no extra text
    await expect(m.getByTestId('models-on-volume-unknown')).toBeVisible()                // status answered null: it says it does not know
    await expect(m.getByTestId('models-search-go')).toBeDisabled()                        // two characters at least
    await m.getByTestId('models-search').fill('seedvr2')
    await m.getByTestId('models-search-go').click()
    await expect(m.getByTestId('models-result')).toHaveCount(3)
    expect(api.state.modelSearches).toEqual(['seedvr2'])
    await m.locator('[data-testid="models-result"][data-repo="Comfy-Org/SeedVR2"]').click()
    expect(api.state.modelFilesFor).toEqual(['Comfy-Org/SeedVR2'])
    await expect(m.getByTestId('models-file')).toHaveCount(3)
    await expect(m.getByTestId('models-load')).toBeDisabled()                             // nothing chosen
    const vae = m.locator('[data-testid="models-file"][data-path="vae/seedvr2_ema_vae_fp16.safetensors"]')
    const net = m.locator('[data-testid="models-file"][data-path="diffusion_models/seedvr2_3b_fp8_e4m3fn.safetensors"]')
    await expect(vae.getByTestId('models-file-folder')).toHaveValue('vae')               // the folder is the core's guess
    await expect(net.getByTestId('models-file-folder')).toHaveValue('diffusion_models')
    await vae.getByTestId('models-file-check').check()
    await net.getByTestId('models-file-check').check()
    await net.getByTestId('models-file-folder').selectOption('checkpoints')              // and can be changed
    await expect(m.getByTestId('models-selected')).toContainText('3.9 GB')               // 0.5 + 3.4
    await expect(m.getByText(/approved|Approved by/i).first()).toHaveCount(0)             // no approval field
    await m.getByTestId('models-load').click()
    await expect(m.getByTestId('models-job')).toHaveAttribute('data-state', 'done')
    await expect(m.getByTestId('models-job')).toContainText('seedvr2_ema_vae_fp16.safetensors')
    expect(api.state.modelFetch).toEqual({
      volume_id: 'vol1',
      items: [{ repo: 'Comfy-Org/SeedVR2', path: 'vae/seedvr2_ema_vae_fp16.safetensors', revision: 'main', folder: 'vae' }, { repo: 'Comfy-Org/SeedVR2', path: 'diffusion_models/seedvr2_3b_fp8_e4m3fn.safetensors', revision: 'main', folder: 'checkpoints' }],
    })
  })

  test('Models: with no Shared volume it loads onto the default volume and says so; the Shared volume can be chosen there; what the volume holds is listed when known', async ({ page, api }) => {
    api.state.mounts.config.network_volume_id = 'vol2'
    api.state.modelsOnVolume = [{ path: 'vae/ae.safetensors', bytes: 335000000 }, { folder: 'diffusion_models', name: 'z_image.safetensors', size: 12000000000 }]
    await page.goto('/')
    await openModels(page)
    const m = page.getByTestId('models-modal')
    await expect(m.getByTestId('models-target')).toContainText('scratch')
    await expect(m.getByTestId('models-target')).toContainText(t('models.targetDefault'))
    await expect(m.getByTestId('models-on-volume-file')).toHaveCount(2)
    await expect(m.getByTestId('models-on-volume')).toContainText('diffusion_models/z_image.safetensors')
    await m.getByTestId('models-shared-select').selectOption('vol1')                     // choosing it is the same as Make Shared
    await expect(m.getByTestId('models-target')).not.toContainText(t('models.targetDefault'))   // a Shared volume adds no extra text
    expect(api.state.sharedVolume).toBe('vol1')
    await m.getByTestId('models-search').fill('zzz nothing')
    await m.getByTestId('models-search-go').click()
    await expect(m.getByTestId('models-no-results')).toBeVisible()
  })

  test('Models: files already on the volume can be deleted one by one or several at once, after a confirmation; the bookkeeping folder is not offered', async ({ page, api }) => {
    api.state.sharedVolume = 'vol1'
    api.state.modelsOnVolume = [
      { folder: 'vae', name: 'ae.safetensors', bytes: 335000000 },
      { folder: 'diffusion_models', name: 'z_image.safetensors', bytes: 12000000000 },
      { folder: 'checkpoints', name: 'ltx-2.3/ltx-2.3-22b-dev-fp8.safetensors', bytes: 29145431166 },
      { folder: '_canalv2_pull', name: 'MODELS_PULL_v003.csv', bytes: 6375 },
    ]
    await page.goto('/')
    await openModels(page)
    const m = page.getByTestId('models-modal')
    const row = (path) => m.locator(`[data-testid="models-on-volume-file"][data-path="${path}"]`)
    await expect(m.getByTestId('models-on-volume-file')).toHaveCount(4)
    await expect(row('_canalv2_pull/MODELS_PULL_v003.csv').getByTestId('models-delete-one')).toHaveCount(0)    // Binc's pull list is bookkeeping: no Delete
    await expect(row('_canalv2_pull/MODELS_PULL_v003.csv').getByTestId('models-delete-check')).toHaveCount(0)
    await expect(m.getByTestId('models-delete-selected')).toBeDisabled()
    // one file: the trash icon asks first; No leaves everything as it was
    await row('vae/ae.safetensors').getByTestId('models-delete-one').click()
    const msg = await answerConfirm(page, false)
    expect(msg).toContain(t('models.fileOne', { n: 1 })); expect(msg).toContain('vae/ae.safetensors'); expect(msg).toContain('cannot be undone')
    expect(api.state.modelDeletes).toBeUndefined()
    await expect(m.getByTestId('models-on-volume-file')).toHaveCount(4)
    // Yes: the core is asked with confirmed: true, the list refreshes and the job says what was freed
    await row('vae/ae.safetensors').getByTestId('models-delete-one').click()
    await answerConfirm(page, true)
    await expect(m.getByTestId('models-on-volume-file')).toHaveCount(3)
    await expect(m.getByTestId('models-job')).toContainText(new RegExp(t('models.fileOne', { n: 1 }), 'i'))   // job lines are shown in title case
    expect(api.state.modelDeletes).toEqual([{ volume_id: 'vol1', items: [{ folder: 'vae', name: 'ae.safetensors' }] }])
    // several at once: tick two, the button carries the count, the confirmation lists both
    await row('diffusion_models/z_image.safetensors').getByTestId('models-delete-check').check()
    await row('checkpoints/ltx-2.3/ltx-2.3-22b-dev-fp8.safetensors').getByTestId('models-delete-check').check()
    await expect(m.getByTestId('models-delete-selected')).toBeEnabled()
    await expect(m.getByTestId('models-delete-selected')).toContainText('(2,')
    await m.getByTestId('models-delete-selected').click()
    const msg2 = await answerConfirm(page, true)
    expect(msg2).toContain(t('models.fileMany', { n: 2 })); expect(msg2).toContain('diffusion_models/z_image.safetensors'); expect(msg2).toContain('checkpoints/ltx-2.3/ltx-2.3-22b-dev-fp8.safetensors')
    await expect(m.getByTestId('models-on-volume-file')).toHaveCount(1)
    expect(api.state.modelDeletes[1]).toEqual({ volume_id: 'vol1', items: [{ folder: 'diffusion_models', name: 'z_image.safetensors' }, { folder: 'checkpoints', name: 'ltx-2.3/ltx-2.3-22b-dev-fp8.safetensors' }] })
  })

  test('the agent rules are one app-wide setting: a switch and a ceiling, saved with the settings', async ({ page, api }) => {
    await page.goto('/')
    await page.getByTestId('open-config').click()
    const dialog = configModal(page)
    await cfgTab(dialog, 'runpod')
    await expect(dialog.getByTestId('cfg-agent-title')).toContainText(t('config.agentTitle'))
    await expect(dialog.getByTestId('cfg-agent-named-yes')).not.toBeChecked()             // off: this is Lucas's own tool
    await expect(dialog.getByTestId('cfg-agent-cap')).toHaveValue('0')
    await dialog.getByTestId('cfg-agent-named-yes').check({ force: true })
    await dialog.getByTestId('cfg-agent-cap').fill('40')
    await dialog.getByTestId('config-save').click()
    await expect(dialog).toBeHidden()
    expect(api.state.settings.agent_named_yes_required).toBe(true)
    expect(api.state.settings.agent_spend_cap_usd).toBe(40)
    await page.getByTestId('open-config').click()                                          // reopened: what was saved is shown
    const again = configModal(page)
    await cfgTab(again, 'runpod')
    await expect(again.getByTestId('cfg-agent-named-yes')).toBeChecked()
    await expect(again.getByTestId('cfg-agent-cap')).toHaveValue('40')
  })

  test('a gated repo: its files are listed (name, size) with a gated badge but cannot be loaded; the Hugging Face token is a setting that is stored and shown as a hint only', async ({ page, api }) => {
    api.state.sharedVolume = 'vol1'
    await page.goto('/')
    await openModels(page)
    const m = page.getByTestId('models-modal')
    await m.getByTestId('models-search').fill('gated')
    await m.getByTestId('models-search-go').click()
    await m.locator('[data-testid="models-result"][data-repo="someone/gated-model"]').click()
    const row = m.locator('[data-testid="models-file"][data-path="gated-model-fp8.safetensors"]')
    await expect(row.getByTestId('models-file-locked')).toBeVisible()
    await row.getByTestId('models-file-check').check()
    await expect(m.getByTestId('models-load')).toBeDisabled()
    await expect(m.getByTestId('models-locked-note')).toContainText(t('models.lockedNote'))
    await m.getByTestId('models-want').click()                                           // naming it for later is allowed
    expect(api.state.wantedAdds[0]).toMatchObject([{ repo: 'someone/gated-model', path: 'gated-model-fp8.safetensors' }])
    await page.keyboard.press('Escape')
    await page.getByTestId('open-config').click()
    const dialog = configModal(page)
    await cfgTab(dialog, 'runpod')
    await expect(dialog.getByTestId('cfg-hf-group')).toContainText(t('config.hfUnset'))
    await dialog.getByTestId('cfg-hf-token').fill('hf_0123456789ABCDEFGHWXYZ')
    await dialog.getByTestId('config-save').click()
    await expect(dialog).toBeHidden()
    expect(api.state.settings.hf_token_set).toBe(true)
    expect(JSON.stringify(api.state.settings)).not.toContain('0123456789ABCDEFGH')       // only the hint is kept
    await page.getByTestId('open-config').click()
    const again = configModal(page)
    await cfgTab(again, 'runpod')
    await expect(again.getByTestId('cfg-hf-group')).toContainText('••••WXYZ')
    await expect(again.getByTestId('cfg-hf-token')).toHaveValue('')
  })

  test('Wanted models: add files from a search, save what the volume holds, add Binc\'s list (pasted when the volume cannot be read), see what is missing, load it', async ({ page, api }) => {
    api.state.sharedVolume = 'vol1'
    api.state.wantedOnVolume = ['diffusion_models/seedvr2_ema_3b_fp16.safetensors']
    await page.goto('/')
    await openModels(page)
    const m = page.getByTestId('models-modal')
    await expect(m.getByTestId('wanted-empty')).toBeVisible()
    await expect(m.getByTestId('wanted-load')).toBeDisabled()
    await m.getByTestId('models-search').fill('seedvr2')
    await m.getByTestId('models-search-go').click()
    await m.locator('[data-testid="models-result"][data-repo="Comfy-Org/SeedVR2"]').click()
    await m.locator('[data-testid="models-file"][data-path="vae/seedvr2_ema_vae_fp16.safetensors"]').getByTestId('models-file-check').check()
    await m.getByTestId('models-want').click()                                           // the file is listed, not loaded
    await expect(m.getByTestId('wanted-row')).toHaveCount(1)
    expect(api.state.wantedAdds[0]).toMatchObject([{ folder: 'vae', repo: 'Comfy-Org/SeedVR2', path: 'vae/seedvr2_ema_vae_fp16.safetensors' }])
    expect(api.state.modelFetch).toBeUndefined()
    await m.getByTestId('wanted-save').click()                                           // what the volume holds is recorded
    await expect(m.getByTestId('wanted-note')).toContainText(t('wanted.added', { n: 1, u: 0 }))
    api.state.wantedCsvUnreadable = true
    await m.getByTestId('wanted-binc').click()                                           // the volume cannot be read: the paste box opens
    await expect(m.getByTestId('wanted-paste')).toBeVisible()
    await m.getByTestId('wanted-paste-text').fill('pipeline,install_to,file,hf_repo,hf_path,bytes,notes\nx,vae/,v.safetensors,a/b,v.safetensors,5,')
    await m.getByTestId('wanted-paste-add').click()
    await expect(m.getByTestId('wanted-paste')).toHaveCount(0)
    await expect(m.getByTestId('wanted-row')).toHaveCount(4)
    await expect(m.locator('[data-testid="wanted-row"][data-name="seedvr2_ema_3b_fp16.safetensors"]')).toHaveAttribute('data-state', 'present')
    await expect(m.locator('[data-testid="wanted-row"][data-name="dyn.safetensors"]')).toHaveAttribute('data-state', 'missing')
    await expect(m.getByTestId('wanted-load')).toContainText('3 files')                    // the saved file has no repo and the present one is skipped: dyn, v and the VAE
    await m.getByTestId('wanted-load').click()
    await expect(m.getByTestId('models-job')).toHaveAttribute('data-state', 'done')
    expect(api.state.wantedLoad.files.sort()).toEqual(['loras/ltx2/dyn.safetensors', 'vae/seedvr2_ema_vae_fp16.safetensors', 'vae/v.safetensors'])
    await m.locator('[data-testid="wanted-row"][data-name="dyn.safetensors"]').getByTestId('wanted-remove').click()
    await expect(m.getByTestId('wanted-row')).toHaveCount(3)
    await m.getByTestId('wanted-clear').click()
    await answerConfirm(page, false)                                                      // No keeps the list
    await expect(m.getByTestId('wanted-row')).toHaveCount(3)
    await m.getByTestId('wanted-clear').click()
    await answerConfirm(page, true)
    await expect(m.getByTestId('wanted-empty')).toBeVisible()
  })

  const fetchJob = (over) => ({ id: 'vjf1', kind: 'fetch', volume_id: 'vol1', pod_name: 'ComfyUI-Pull-vol-vol1-1115', started_at: '2026-11-15T17:00:00.000Z', files: 0, lines: ['Approved by a click in the app window.'], bytes_done: 0, bytes_total: 20e9, rate: null, recent: [], fetched: [], fetch_items: [], ...over })

  test('a download shows each state as it happens (creating, starting, connecting, downloading file i of n with a bar, verifying, done), in title case, with Cancel at the right', async ({ page, api }) => {
    api.state.sharedVolume = 'vol1'
    api.state.volumeSteps = [
      fetchJob({ state: 'creating' }),
      fetchJob({ state: 'creating' }),
      fetchJob({ state: 'starting' }),
      fetchJob({ state: 'connecting' }),
      fetchJob({ state: 'pulling', bytes_done: 5e9, rate: 50e6, fetch: { file: 'a.safetensors', index: 1, count: 2, file_done: 5e9, file_total: 8e9, eta_s: 300 } }),
      fetchJob({ state: 'pulling', bytes_done: 14e9, rate: 60e6, fetched: ['a.safetensors'], fetch: { file: 'b.safetensors', index: 2, count: 2, file_done: 6e9, file_total: 12e9, eta_s: 100 } }),
      fetchJob({ state: 'verifying', bytes_done: 20e9, fetched: ['a.safetensors'], fetch: { file: 'b.safetensors', index: 2, count: 2, file_done: 12e9, file_total: 12e9, eta_s: 0 } }),
      fetchJob({ state: 'done', bytes_done: 20e9, fetched: ['a.safetensors', 'b.safetensors'] }),
    ]
    await page.goto('/')
    await openModels(page)
    const m = page.getByTestId('models-modal')
    const state = m.getByTestId('volume-job-state')
    await expect(state).toHaveText('Creating Pod')                       // not the first log line: the state, in title case
    await expect(state).toHaveText('Pod Starting')
    await expect(state).toHaveText('Connecting (SSH)')
    await expect(state).toHaveText('Downloading File 1 Of 2')
    await expect(m.getByTestId('models-job')).toHaveAttribute('data-state', 'pulling')
    await expect(m.getByTestId('volume-job-detail')).toContainText('a.safetensors')
    await expect(m.getByTestId('volume-job-detail')).toContainText('5.0 GB of 20.0 GB')
    await expect(m.getByTestId('volume-job-bar')).toHaveAttribute('data-percent', '25')
    await expect(m.getByTestId('volume-job-pod')).toHaveText('ComfyUI-Pull-vol-vol1-1115')          // the pod's name is kept exactly
    const cancel = m.getByTestId('models-cancel'), card = m.getByTestId('models-job')
    const [cb, jb] = [await cancel.boundingBox(), await card.boundingBox()]
    expect(cb.x + cb.width).toBeGreaterThan(jb.x + jb.width - 40)        // Cancel floats to the right end of the row
    await expect(state).toHaveText('Downloading File 2 Of 2')
    await expect(state).toHaveText('Verifying Checksum')
    await expect(state).toHaveText(/^Done: 2 Files Loaded/)
    await expect(m.getByTestId('models-cancel')).toHaveCount(0)
    await expect(m.getByTestId('models-job-lines')).toContainText('Approved By A Click In The App Window.')
  })

  test('closing and reopening the Models window shows the download that is running', async ({ page, api }) => {
    api.state.sharedVolume = 'vol1'
    api.state.volumeJob = fetchJob({ state: 'pulling', bytes_done: 2e9, rate: 40e6, fetch: { file: 'a.safetensors', index: 1, count: 3, file_done: 2e9, file_total: 8e9, eta_s: 150 } })
    await page.goto('/')
    await openModels(page)
    const m = page.getByTestId('models-modal')
    await expect(m.getByTestId('volume-job-state')).toHaveText('Downloading File 1 Of 3')
    await m.getByRole('button', { name: t('models.done') }).click()
    await expect(m).toBeHidden()
    await openModels(page)
    await expect(page.getByTestId('models-modal').getByTestId('volume-job-state')).toHaveText('Downloading File 1 Of 3')
  })

  test('a wanted model whose .part is on the volume says Downloading with the percent, and its row on the volume has no Delete', async ({ page, api }) => {
    api.state.sharedVolume = 'vol1'
    api.state.wanted = [{ folder: 'text_encoders', name: 'q.safetensors', repo: 'a/b', path: 'q.safetensors', bytes: 8e9 }]
    api.state.wantedOnVolume = []
    api.state.wantedParts = { 'text_encoders/q.safetensors': 2e9 }
    api.state.modelsOnVolume = [{ folder: 'text_encoders', name: 'q.safetensors.part', bytes: 2e9 }]
    api.state.volumeJob = fetchJob({ state: 'pulling', bytes_done: 2e9, fetch: { file: 'q.safetensors', index: 1, count: 1, file_done: 2e9, file_total: 8e9, eta_s: null } })   // a download is running
    await page.goto('/')
    await openModels(page)
    const m = page.getByTestId('models-modal')
    const row = m.locator('[data-testid="wanted-row"][data-name="q.safetensors"]')
    await expect(row).toHaveAttribute('data-state', 'downloading')
    await expect(row.getByTestId('wanted-state')).toHaveText('Downloading 25%')
    const part = m.locator('[data-testid="models-on-volume-file"][data-path="text_encoders/q.safetensors.part"]')
    await expect(part.getByTestId('models-part-badge')).toHaveText('Downloading')
    await expect(part.getByTestId('models-delete-one')).toHaveCount(0)
  })

  test('the Queue lists the volume jobs with their progress and Cancel, and a pod the app lost at a restart with a Delete Pod button; the nav badge counts them', async ({ page, api }) => {
    api.state.volumeJob = fetchJob({ state: 'pulling', bytes_done: 2e9, rate: 40e6, fetch: { file: 'a.safetensors', index: 1, count: 3, file_done: 2e9, file_total: 8e9, eta_s: 150 } })
    api.state.interrupted = [{ name: 'ComfyUI-Pull-vol-a3upg9ey48-1115', kind: 'fetch', round: 'vol-a3upg9ey48', pod_id: 'p9', volume: 'a3upg9ey48', created_at: '2026-11-15T16:56:04.000Z', approved_by: 'a click in the app window' }]
    await page.goto('/')
    await expect(page.getByTestId('queue-badge')).toHaveText('2')           // the running download and the interrupted pod
    await page.getByTestId('open-queue').click()
    const q = page.getByTestId('queue-modal')
    const job = q.getByTestId('queue-volume-job')
    await expect(job).toHaveAttribute('data-kind', 'fetch')
    await expect(job.getByTestId('volume-job-state')).toHaveText('Downloading File 1 Of 3')
    await expect(job.getByTestId('volume-job-bar')).toBeVisible()
    await expect(job.getByTestId('queue-volume-cancel')).toBeVisible()
    const lost = q.getByTestId('queue-interrupted')
    await expect(lost).toContainText('Interrupted (No Job)')
    await expect(lost).toContainText('ComfyUI-Pull-vol-a3upg9ey48-1115')
    await lost.getByTestId('queue-interrupted-delete').click()
    await answerConfirm(page, true)
    await expect(q.getByTestId('queue-interrupted')).toHaveCount(0)
    expect(api.state.droppedPod).toBe('ComfyUI-Pull-vol-a3upg9ey48-1115')
  })

  test('an interrupted download (its pod could not be reached) offers Reattach as well as Delete Pod; Reattach follows it again; a pod with no run to follow offers Delete only', async ({ page, api }) => {
    api.state.interrupted = [
      { name: 'ComfyUI-Pull-vol-a3upg9ey48-1115', kind: 'fetch', round: 'vol-a3upg9ey48', pod_id: 'p9', volume: 'a3upg9ey48', created_at: '2026-11-15T16:56:04.000Z', approved_by: 'a click in the app window', remote_id: 'fetch-vol-a3upg9ey48-1', fetch_items: [{ name: 'a.safetensors', folder: 'vae', bytes: 8e9 }] },
      { name: 'ComfyUI-Pull-vol-a3upg9ey48-1116', kind: 'erase', round: 'vol-a3upg9ey48', pod_id: 'p8', volume: 'a3upg9ey48', created_at: '2026-11-15T16:56:04.000Z', approved_by: 'a click in the app window' },
    ]
    await page.goto('/')
    await page.getByTestId('open-queue').click()
    const q = page.getByTestId('queue-modal')
    const lost = q.locator('[data-testid="queue-interrupted"][data-name="ComfyUI-Pull-vol-a3upg9ey48-1115"]')
    await expect(lost.getByTestId('queue-interrupted-reattach')).toHaveText('Reattach')
    await expect(q.locator('[data-testid="queue-interrupted"][data-name="ComfyUI-Pull-vol-a3upg9ey48-1116"]').getByTestId('queue-interrupted-reattach')).toHaveCount(0)
    await expect(q.locator('[data-testid="queue-interrupted"][data-name="ComfyUI-Pull-vol-a3upg9ey48-1116"]').getByTestId('queue-interrupted-delete')).toBeVisible()
    await lost.getByTestId('queue-interrupted-reattach').click()
    await expect(q.getByTestId('queue-volume-job')).toHaveAttribute('data-kind', 'fetch')
    await expect(q.getByTestId('queue-volume-job').getByTestId('volume-job-state')).toHaveText('Connecting (SSH)')
    await expect(q.locator('[data-testid="queue-interrupted"][data-name="ComfyUI-Pull-vol-a3upg9ey48-1115"]')).toHaveCount(0)
    expect(api.state.reattached).toBe('ComfyUI-Pull-vol-a3upg9ey48-1115')
  })

  test('Wanted models: a too-small volume shows the warning; a volume that cannot be listed shows every row as not checked', async ({ page, api }) => {
    api.state.sharedVolume = 'vol1'
    api.state.wanted = [{ folder: 'vae', name: 'v.safetensors', repo: 'a/b', path: 'v.safetensors', bytes: 90_000_000_000 }]
    api.state.wantedShort = 40_000_000_000
    await page.goto('/')
    await openModels(page)
    const m = page.getByTestId('models-modal')
    await expect(m.getByTestId('wanted-warning')).toBeVisible()
    api.state.wantedShort = 0
    api.state.wantedOnVolume = undefined
    await m.getByTestId('wanted-save').click()
    await expect(m.locator('[data-testid="wanted-row"][data-name="v.safetensors"]')).toHaveAttribute('data-state', 'unknown')
  })
})
