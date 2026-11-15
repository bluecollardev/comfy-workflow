import { test, expect, modal, cfgTab, openVolumes, openModels } from './fixtures'
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
    await expect(m.getByTestId('models-target')).toContainText(t('models.targetShared'))
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
    await expect(m.getByTestId('models-target')).toContainText(t('models.targetShared'))
    expect(api.state.sharedVolume).toBe('vol1')
    await m.getByTestId('models-search').fill('zzz nothing')
    await m.getByTestId('models-search-go').click()
    await expect(m.getByTestId('models-no-results')).toBeVisible()
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
    await expect(m.getByTestId('wanted-empty')).toBeVisible()
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
