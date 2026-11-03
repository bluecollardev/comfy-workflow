import { test, expect, modal, podCard } from './fixtures'
import { t } from './i18n'

// The Pod / Local switch on the Panama pane (docs/ADR-022): where a round is staged. The pane is built against the contract the core implements
// (status().pod, podRounds, podPlan, podPull, podJob, podCancel, podRemove); here the fake API answers it. Pod stays off until the core says it can.
const dialogOf = (page) => modal(page, t('import.title'))
const open = async (page) => {
  await page.goto('/')
  await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
  const dialog = dialogOf(page)
  await dialog.getByTestId('import-source-panama').click()
  await expect(dialog.getByTestId('panama-pane')).toBeVisible()
  return dialog
}
const row = (dialog, name) => dialog.locator(`[data-testid="panama-round"][data-round="${name}"]`)

test.describe('Panama pane: Pod / Local', () => {
  test('Pod is disabled while the core says it is not available, with the reason as its title; Local keeps working', async ({ page, api }) => {
    api.state.mounts.config.folders['comfy-shared'] = '/Users/lucas/ComfyUI-Shared'
    api.state.panama = { configured: true, pod: { available: false, reason: 'Pod mode needs a network volume in the Default Configuration.' } }
    const dialog = await open(page)
    await expect(dialog.getByTestId('panama-target-pod')).toBeDisabled()
    await expect(dialog.getByTestId('panama-target-pod-wrap')).toHaveAttribute('title', 'Pod mode needs a network volume in the Default Configuration.')
    await expect(dialog.getByTestId('panama-target-local')).toBeChecked()
    await expect(dialog.getByTestId('panama-staging-path')).toHaveText('/Users/lucas/panama-rounds')
    await expect(dialog.getByTestId('panama-round')).toHaveCount(3)   // the local list
  })

  test('Pod shows the volume path and when it was last read, rows come from podRounds, and the choice survives a reload', async ({ page, api }) => {
    api.state.panama = { configured: true, pod: { available: true } }
    let dialog = await open(page)
    await dialog.getByTestId('panama-target-pod').check({ force: true })
    await expect(dialog.getByTestId('panama-staging-path')).toHaveText('/workspace/comfy-shared/temp/rounds')
    await expect(dialog.getByTestId('panama-volume')).toContainText('comfy-workspace')
    await expect(dialog.getByTestId('panama-as-of')).toContainText(t('panama.asOf', { when: '' }).replace(/\s+$/, ''))   // 'as of …': the state is last-known
    await expect(dialog.getByTestId('panama-round')).toHaveCount(3)
    await expect(row(dialog, 'brynley-comfy-2026-10-22').getByTestId('panama-staged')).toBeVisible()
    await expect(row(dialog, 'brynley-comfy-2026-10-22').getByTestId('panama-on-disk')).toContainText('15.2 GB')
    await expect(row(dialog, 'brynley-inbox-2026-10-28-v001').getByTestId('panama-partial')).toContainText('100')
    await expect(row(dialog, 'brynley-inbox-2026-10-28-v001').getByTestId('panama-pull')).toHaveText(t('panama.resume'))
    // no Import Package in Pod mode (phase 2); a note instead
    await expect(dialog.getByTestId('panama-use')).toHaveCount(0)
    await expect(row(dialog, 'brynley-comfy-2026-10-22').getByTestId('panama-use-local-note')).toBeVisible()
    await page.reload()
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-import').click()
    dialog = dialogOf(page)
    await dialog.getByTestId('import-source-panama').click()
    await expect(dialog.getByTestId('panama-target-pod')).toBeChecked()   // remembered
    await dialog.getByTestId('panama-target-local').check({ force: true })
    await expect(dialog.getByTestId('panama-use').first()).toBeVisible()   // Local still has Import Package on a complete round
  })

  test('Download asks first and names the pod it would start (price, volume, deletion, idle stop); Cancel starts nothing; Start pulls and the card shows the stage and the temporary pod', async ({ page, api }) => {
    api.state.panama = { configured: true, pod: { available: true, slow: true } }
    const dialog = await open(page)
    await dialog.getByTestId('panama-target-pod').check({ force: true })
    await row(dialog, 'brynley-comfy-2026-10-23').getByTestId('panama-pull').click()
    const text = dialog.getByTestId('panama-pod-confirm-text')
    await expect(text).toContainText('L4'); await expect(text).toContainText('0.59'); await expect(text).toContainText('comfy-workspace')
    await expect(text).toContainText('ComfyUI-Pull'); await expect(text).toContainText('30')
    await dialog.getByTestId('panama-pod-cancel').click()
    await expect(dialog.getByTestId('panama-pod-confirm')).toHaveCount(0)
    expect(api.state.panama.pod.pulled).toBeUndefined()   // nothing started
    await row(dialog, 'brynley-comfy-2026-10-23').getByTestId('panama-pull').click()
    await dialog.getByTestId('panama-pod-start').click()
    expect(api.state.panama.pod.pulled).toEqual(['brynley-comfy-2026-10-23'])
    await expect(dialog.getByTestId('panama-job-state')).toHaveText(t('panama.state.creating'))
    await expect(dialog.getByTestId('panama-job-pod')).toContainText('ComfyUI-Pull-brynley-comfy-2026-10-23')
    await expect(dialog.getByTestId('panama-job-temporary')).toBeVisible()
    await expect(dialog.getByTestId('panama-job-header').getByTestId('panama-cancel')).toBeVisible()   // Cancel in the header
    await expect(row(dialog, 'brynley-comfy-2026-10-23').getByTestId('panama-pull')).toBeDisabled()   // one job at a time
    await expect(dialog.getByTestId('panama-job-state')).toHaveText(t('panama.state.pulling'))   // the poll moves it on
    await dialog.getByTestId('panama-cancel').click()
    expect(api.state.panama.pod.cancelled).toBe('brynley-comfy-2026-10-23-pod-1')
    await expect(dialog.getByTestId('panama-job-state')).toHaveText(t('panama.state.cancelled'))
    await expect(dialog.getByTestId('panama-job-cancelled')).toContainText(t('panama.cancelledNotePod').slice(0, 20))
    await expect(dialog.getByTestId('panama-cancel')).toHaveCount(0)
  })

  test('with a pod of yours running, the confirmation says it runs there, starts no pod, and the card does not tag it temporary', async ({ page, api }) => {
    api.state.panama = { configured: true, pod: { available: true, route: 'active' } }
    const dialog = await open(page)
    await dialog.getByTestId('panama-target-pod').check({ force: true })
    await row(dialog, 'brynley-comfy-2026-10-23').getByTestId('panama-pull').click()
    const text = dialog.getByTestId('panama-pod-confirm-text')
    await expect(text).toContainText('ComfyUI-Dev'); await expect(text).not.toContainText('Starts a pod')
    await dialog.getByTestId('panama-pod-start').click()
    await expect(dialog.getByTestId('panama-job-pod')).toContainText('ComfyUI-Dev')
    await expect(dialog.getByTestId('panama-job-temporary')).toHaveCount(0)
  })

  test('Delete in Pod mode names the volume and that a pod does it, confirms, then calls podRemove; Keep removes nothing', async ({ page, api }) => {
    api.state.panama = { configured: true, pod: { available: true } }
    const dialog = await open(page)
    await dialog.getByTestId('panama-target-pod').check({ force: true })
    await row(dialog, 'brynley-comfy-2026-10-22').getByTestId('panama-delete').click()
    const text = dialog.getByTestId('panama-delete-confirm-text')
    await expect(text).toContainText('comfy-workspace'); await expect(text).toContainText('15.2 GB'); await expect(text).toContainText('ComfyUI-Pull')
    await dialog.getByTestId('panama-delete-no').click()
    await expect(dialog.getByTestId('panama-delete-confirm')).toHaveCount(0)
    expect(api.state.panama.pod.removed).toBeUndefined()
    await row(dialog, 'brynley-comfy-2026-10-22').getByTestId('panama-delete').click()
    await dialog.getByTestId('panama-delete-yes').click()
    expect(api.state.panama.pod.removed).toEqual(['brynley-comfy-2026-10-22'])
    await expect(row(dialog, 'brynley-comfy-2026-10-22').getByTestId('panama-staged')).toHaveCount(0)   // the volume row is empty after the job
    await expect(row(dialog, 'brynley-comfy-2026-10-22').getByTestId('panama-pull')).toHaveText(t('panama.download'))
  })
})
