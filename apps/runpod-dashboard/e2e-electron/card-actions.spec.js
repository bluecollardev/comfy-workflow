import { test, expect } from '@playwright/test'
import { launchApp, openCreatePod, podCard, toast } from './app.js'
import { t } from '../e2e/i18n.js'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Every call a card and the form make over IPC, in the real app, pods simulated (no-spend mode).
// A dispatch table that loses a call shows up here as the page's "no core call …" error.
test.describe('card actions over IPC', () => {
  let ctx
  test.beforeAll(async () => { ctx = await launchApp({ dry: true }) })
  test.afterAll(async () => { await ctx.app.close() })

  test('launches a pod from the form and the card shows it', async () => {
    const { page } = ctx
    await openCreatePod(page)
    await page.locator('#pod-name').fill('Sim-Card')
    await page.locator('#pod-image').selectOption('prebuilt')
    await page.getByTestId('pod-submit').click()
    await expect(toast(page).first()).toContainText(t('toast.podCreated', { name: 'Sim-Card' }))
    await expect(podCard(page, 'Sim-Card')).toBeVisible()
  })

  test('details, the idle stop and the logs modal answer over IPC', async () => {
    const { page } = ctx
    const card = podCard(page, 'Sim-Card')
    await card.getByTestId('pod-details-toggle').click()
    await expect(card.getByTestId('pod-details-status')).toContainText(/Simulated/)   // pods.details
    await card.getByTestId('pod-details-toggle').click()
    await card.getByTestId('pod-idle-edit').click()
    await card.getByTestId('pod-idle-input').fill('12')
    await card.getByTestId('pod-idle-save').click()                                    // pods.setIdle
    await expect(toast(page).last()).toContainText(t('toast.idleSet', { n: 12 }))
    await expect(card.getByTestId('pod-idle')).toContainText(t('pod.idleAfter', { n: 12 }))
    await card.getByTestId('pod-logs-toggle').click()
    const logs = page.locator('.modal.show', { hasText: t('pod.logsTitle', { name: 'Sim-Card' }) })
    await expect(logs).toBeVisible()
    await logs.getByRole('button', { name: 'Close' }).first().click().catch(() => page.keyboard.press('Escape'))
    await expect(logs).toBeHidden()
  })

  test('a pod gets its own configuration from the card, and Recreate carries it', async () => {
    const { page } = ctx
    const card = podCard(page, 'Sim-Card')
    await card.getByTestId('pod-config').click()                                       // pods.config
    const panel = page.locator('.modal.show', { has: page.getByTestId('config-modal-pod') })
    await expect(panel).toBeVisible()
    await panel.getByTestId('cfg-idle').fill('7')
    // Environment: load the env and the build args from the repo's Dockerfile, as the Create Pod form does (images.env, the real parser)
    await panel.getByTestId('cfg-tab-environment').click()
    await panel.getByTestId('cfg-env-load-menu').click()
    await panel.getByTestId('cfg-env-load-dockerfile').click()
    await expect(panel.getByTestId('cfg-env-summary')).toContainText('apps/comfy-app/Dockerfile')
    expect(await panel.getByTestId('cfg-env-key').count()).toBeGreaterThan(3)
    expect(await panel.getByTestId('cfg-env-arg').count()).toBeGreaterThan(0)         // the Dockerfile's ARGs are marked
    await panel.getByTestId('cfg-tab-volume').click()
    await panel.getByTestId('config-apply').click()                                    // pods.setConfig
    await expect(toast(page).last()).toContainText(t('toast.podConfigSet'))
    await expect(card.getByTestId('pod-config-badge')).toBeVisible()
    await card.getByTestId('pod-stop').click()
    await expect(card.getByTestId('pod-status')).toHaveText(t('pod.statuses.stopped'))
    page.once('dialog', (d) => d.accept())
    await card.getByTestId('pod-recreate').click()                                     // pods.recreate
    await expect(toast(page).last()).toContainText(t('toast.podRecreated'))
    await expect(card.getByTestId('pod-status')).toHaveText(/Starting|Running/)
    await expect(card.getByTestId('pod-config-badge')).toBeVisible()                  // the own configuration moved to the new pod
  })

  test('volumes and datacenters answer over IPC', async () => {
    const { page } = ctx
    await page.getByTestId('open-volumes').click()
    const volumes = page.locator('.modal.show', { hasText: t('volumes.title') })
    await expect(volumes).toBeVisible()
    await volumes.getByTestId('volume-new-name').fill('sim-vol')
    await volumes.getByTestId('volume-new-dc').selectOption('EU-RO-1')               // pods.datacenters (simulated menu)
    await volumes.getByTestId('volume-create').click()                                // volumes.create
    await expect(volumes.locator('[data-testid="volume"]', { hasText: 'sim-vol' })).toBeVisible()
    await volumes.locator('[data-testid="volume"]', { hasText: 'sim-vol' }).getByTestId('volume-use-default').click()   // volumes.useAsDefault
    await expect(toast(page).last()).toContainText('sim-vol')
    await volumes.getByRole('button', { name: t('volumes.done') }).click()
    await expect(volumes).toBeHidden()
    await page.getByTestId('open-config').click()
    const dialog = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await expect(dialog.getByTestId('cfg-dc')).toHaveAttribute('data-value', 'EU-RO-1')
    await expect(dialog.getByTestId('cfg-volume').locator('option', { hasText: 'sim-vol' })).toHaveCount(1)
    await dialog.getByTestId('config-close').click()
  })

  test('the Connect modal lists accounts and repositories over IPC', async () => {
    const { page } = ctx
    await page.getByTestId('open-connect').click()
    const connect = page.locator('.modal.show', { hasText: t('connect.title') })
    await expect(connect.getByTestId('connect-accounts')).toContainText('No accounts connected')    // git.accounts
    await connect.getByRole('tab', { name: t('connect.repositories') }).click()
    await expect(connect.getByTestId('connect-repositories')).toContainText('No repositories attached yet')   // repositories.list
    await connect.getByRole('button', { name: t('connect.done') }).click()
  })

  test('Sync: a confirmation with the plan and the transport, then the run with files, progress and the bar on the card', async () => {
    const { page, configDir } = ctx
    await page.getByTestId('open-config').click()
    const dialog = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await dialog.getByTestId('cfg-tab-folders').click()   // Default Configuration is tabs on a wide screen
    await dialog.getByTestId('folder-row-project').getByTestId('folder-local').fill(configDir)   // something to copy
    await dialog.getByTestId('config-save').click()
    await expect(dialog).toBeHidden()
    const card = podCard(page, 'Sim-Card')
    await card.getByTestId('pod-sync').click()
    const sync = page.locator('.modal.show', { hasText: t('sync.title', { name: 'Sim-Card' }) })
    await expect(sync.getByTestId('sync-confirm')).toContainText(t('sync.confirm'))
    await expect(sync.getByTestId('sync-step')).toHaveCount(1)                       // this pod has its own configuration (no project mapped there): the repo's workflows only
    await expect(sync.getByTestId('sync-transport')).toContainText('no-spend mode')
    await expect(sync.getByTestId('sync-plan-counts')).toHaveText(t('sync.planCounts', { files: 3, bytes: '4.5 GB' }))   // the listing pass; no project in this plan, so no second figure
    await expect(sync.getByTestId('sync-skip-renders')).toHaveCount(0)
    await expect(sync.locator('.modal-footer .btn')).toHaveText([t('picker.cancel'), t('sync.startPush')])   // the modal's own buttons, nothing else
    await sync.getByRole('button', { name: t('sync.startPush') }).click()
    await expect(sync.getByTestId('sync-status')).toContainText(t('sync.finished', { steps: 1 }))
    await expect(sync.locator('.modal-footer .btn')).toHaveText([t('sync.close'), t('sync.again')])
    await expect(sync.getByTestId('sync-file')).toHaveCount(3)
    await expect(sync.getByTestId('sync-counts')).toContainText(t('sync.countFiles', { n: 3 }))
    await expect(sync.getByTestId('sync-counts')).toContainText(t('sync.countErrors', { n: 0 }))
    await expect(sync.getByTestId('sync-counts')).toContainText(t('sync.countSkipped', { n: 0 }))             // beside copied and errors; the simulated copy finds nothing already there
    await sync.locator('.btn-close').click()
    await expect(sync).toBeHidden()
    await expect(card.getByTestId('pod-progress-label')).not.toContainText(t('sync.countFiles', { n: 3 }).split(' ')[1])   // the run ended: no sync bar (a boot bar may show, the pod was just recreated)
    await expect(card.getByTestId('pod-sync')).toBeEnabled()
  })

  // Lucas, 2026-10-21, a real push of three folders: "after the first folder (1/3) the whole thing seems to restart".
  // Three folders in the plan, paced; a recorder in the page keeps every state the card's bar, its label and the
  // modal's counters go through, and the list refreshes mid-run. Nothing may go backwards across a step boundary.
  test('Sync of three folders: the bars and the counters only move forward across the step boundaries, through a list refresh', async () => {
    const { page, configDir } = ctx
    const shared = join(configDir, 'comfy-shared'); mkdirSync(shared, { recursive: true })
    await page.getByTestId('open-config').click()
    const dialog = page.locator('.modal.show', { has: page.getByTestId('config-modal') })
    await dialog.getByTestId('folder-row-project').getByTestId('folder-local').fill(configDir)
    await dialog.getByTestId('folder-row-comfy-shared').getByTestId('folder-local').fill(shared)   // the plan: project, comfy-shared, workflows
    await dialog.getByTestId('config-save').click()
    await expect(dialog).toBeHidden()
    await openCreatePod(page)
    await page.locator('#pod-name').fill('Sim-Sync')                                   // a pod on the default configuration
    await page.locator('#pod-image').selectOption('prebuilt')
    await page.getByTestId('pod-submit').click()
    await expect(toast(page).filter({ hasText: t('toast.podCreated', { name: 'Sim-Sync' }) })).toBeVisible()
    const card = podCard(page, 'Sim-Sync')
    await card.getByTestId('pod-sync').click()
    const sync = page.locator('.modal.show', { hasText: t('sync.title', { name: 'Sim-Sync' }) })
    await expect(sync.getByTestId('sync-step')).toHaveCount(3)
    await expect(sync.getByTestId('sync-skip-renders')).toBeChecked()                                     // the shots' renders stay home unless asked
    // which ComfyUI-Shared folders this run carries: the configuration's choice (input, models, workflows; not output) until changed here
    for (const d of ['input', 'models', 'workflows']) await expect(sync.getByTestId(`sync-shared-${d}`)).toBeChecked()
    await expect(sync.getByTestId('sync-shared-output')).not.toBeChecked()
    await expect(sync.getByTestId('sync-plan-counts')).toHaveText(t('sync.planCountsWithout', { files: 5, bytes: '7.5 GB' }))   // no output files in the count
    await expect(sync.getByTestId('sync-existing-update')).toBeChecked()                                    // what is already on the pod: send what changed, unless asked otherwise
    for (const m of ['size', 'checksum', 'replace', 'update']) { await sync.getByTestId(`sync-existing-${m}`).check(); await expect(sync.getByTestId(`sync-existing-${m}`)).toBeChecked() }
    await sync.getByTestId('sync-skip-renders').uncheck(); await sync.getByTestId('sync-skip-tests').uncheck()   // the figure follows the switches: all of it again
    await expect(sync.getByTestId('sync-plan-counts')).toHaveText(t('sync.planCounts', { files: 6, bytes: '9.0 GB' }))
    await sync.getByTestId('sync-skip-renders').check(); await sync.getByTestId('sync-skip-tests').check()
    await expect(sync.getByTestId('sync-plan-counts')).toHaveText(t('sync.planCountsWithout', { files: 5, bytes: '7.5 GB' }))
    await sync.getByTestId('sync-shared-workflows').uncheck()                                              // the repo's workflows step goes with it
    await expect(sync.getByTestId('sync-step')).toHaveCount(2)
    await sync.getByTestId('sync-shared-workflows').check()
    await expect(sync.getByTestId('sync-step')).toHaveCount(3)
    await sync.getByTestId('sync-shared-output').check()                                                    // this run only: the configuration is not changed
    await expect(sync.getByTestId('sync-plan-counts')).toHaveText(t('sync.planCountsWithout', { files: 8, bytes: '12.0 GB' }))
    await page.evaluate(() => {
      // every distinct state of the card bar + label and the modal bar + counters, in order
      const card = document.querySelector('[data-testid="pod-card"][data-name="Sim-Sync"]')
      const modal = [...document.querySelectorAll('[data-testid="sync-modal"]')].find((el) => el.classList.contains('show'))   // this pod's, not an earlier pod's closed one
      const bar = (root) => { const el = root && (root.matches('[aria-valuenow]') ? root : root.querySelector('[aria-valuenow]')); return el ? Number(el.getAttribute('aria-valuenow')) : -1 }
      const read = () => JSON.stringify({
        bar: bar(card.querySelector('[data-testid="pod-progress"]')),
        label: card.querySelector('[data-testid="pod-progress-label"]')?.textContent?.trim() ?? '',
        mbar: bar(modal.querySelector('[data-testid="sync-bar"]')),
        counts: modal.querySelector('[data-testid="sync-counts"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        detail: modal.querySelector('[data-testid="sync-detail"]')?.textContent?.trim() ?? '',
        status: modal.querySelector('[data-testid="sync-status"]')?.textContent?.trim() ?? '',
      })
      window.__syncTrace = [read()]
      new MutationObserver(() => { const s = read(); if (s !== window.__syncTrace.at(-1)) window.__syncTrace.push(s) })
        .observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
    })
    await sync.getByRole('button', { name: t('sync.startPush') }).click()
    await expect(sync.getByRole('button', { name: t('sync.cancelRun') })).toBeVisible()
    await expect(sync.getByTestId('sync-counts')).toContainText(t('sync.countSteps', { step: 2, steps: 3 }))   // the second folder, seen while it runs
    await expect(card.getByTestId('pod-progress-label')).toContainText('(2 of 3)')
    await page.evaluate(() => document.querySelector('[data-testid="refresh"]').click())                     // the list reloads under the run (the modal covers the button)
    await expect(sync.getByTestId('sync-status')).toContainText(t('sync.finished', { steps: 3 }))
    await expect(sync.getByTestId('sync-counts')).toContainText(t('sync.countSteps', { step: 3, steps: 3 }))
    await expect(sync.getByTestId('sync-counts')).toContainText(t('sync.countFiles', { n: 8 }))              // the review frame stayed home
    const trace = (await page.evaluate(() => window.__syncTrace)).map((s) => JSON.parse(s))
    await test.info().attach('sync-trace', { body: JSON.stringify(trace, null, 1), contentType: 'application/json' })
    const during = trace.filter((s) => s.bar >= 0 && /\([123] of 3\)/.test(s.label))                       // while the card showed a folder of the sync
    expect(during.length).toBeGreaterThan(6)
    const steps = during.map((s) => Number(s.label.match(/\((\d) of 3\)/)[1]))
    const files = during.map((s) => Number(s.counts.match(/(\d+) files copied/)[1]))   // the run's count; the label's "ok" is per folder
    const folderOf = during.map((s) => Number((s.counts.match(/folder (\d) of 3/) || [0, 0])[1]))
    const bars = during.map((s) => s.bar), mbars = during.map((s) => s.mbar)
    for (const [name, seq] of Object.entries({ bar: bars, mbar: mbars, steps, files, folderOf })) {
      for (let i = 1; i < seq.length; i++) expect(seq[i], `${name} went backwards at state ${i}: ${JSON.stringify(during[i - 1])} -> ${JSON.stringify(during[i])}`).toBeGreaterThanOrEqual(seq[i - 1])
    }
    expect(new Set(steps)).toEqual(new Set([1, 2, 3]))                                                       // every folder was seen on the card
    const indexOf = (n) => [...new Set(during.filter((_, i) => steps[i] === n).map((s) => Number(s.label.match(/file (\d+) of/)[1])))]
    expect(indexOf(1)).toEqual([0, 1, 2])                                                                    // "file n of N": the files as rsync starts them, over the listing's count
    expect(indexOf(2)).toEqual([0, 1, 2, 3, 4])
    expect(indexOf(3)).toEqual([0, 1, 2])
    expect(during.at(-1).label).toContain('file 2 of 2 · 2 ok · 0 errors · 12.0 GB of 12.0 GB')              // eight files of 1.5 GB in the simulation
    expect(during.some((s) => /\(1 of 3\) · file 2 of 2 · 2 ok · 0 errors · 3\.0 GB of 12\.0 GB/.test(s.label))).toBe(true)
    expect(during.some((s) => /file \d of 4 · .*output\/render_000\d\.exr \(\d+%\)/.test(s.detail))).toBe(true)   // the modal names the file under way
    expect(trace.some((s) => s.counts.includes(t('sync.countFiles', { n: 8 })))).toBe(true)
    expect(trace.some((s) => s.label.startsWith(t('pod.syncListing', { folder: 'project' })))).toBe(true)   // the listing pass showed first
    expect(bars.at(-1)).toBe(100); expect(mbars.at(-1)).toBe(100)
    expect(during.some((s) => s.bar > 0 && s.bar < 33)).toBe(true)                                          // the bar moved within the first folder, not only at its end
    expect(trace.at(-1).counts).toContain(t('sync.countFiles', { n: 8 }))
    await sync.locator('.btn-close').click()
    await expect(sync).toBeHidden()
    await expect(card.getByTestId('pod-progress-label')).not.toContainText('files')
  })

  test('the Dockerfile modal answers over IPC: the repo source and the config, with the menu', async () => {
    const { page } = ctx
    await openCreatePod(page)
    await page.locator('#pod-image').selectOption('prebuilt')
    await page.getByTestId('pod-image-dockerfile').click()
    const dialog = page.locator('.modal.show', { hasText: t('dockerfile.title') })
    await expect(dialog.getByTestId('dockerfile-image')).toHaveValue('ashleykza/comfyui:latest')   // images.dockerfile
    await dialog.getByRole('tab', { name: t('dockerfile.source') }).click()
    await expect(dialog.getByTestId('dockerfile-source')).toContainText('FROM')                   // the repo's Dockerfile, real
    await dialog.getByRole('button', { name: t('dockerfile.close'), exact: true }).last().click()
  })
})
