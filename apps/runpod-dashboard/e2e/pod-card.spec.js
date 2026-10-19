import { test, expect, podCard } from './fixtures'
import { t } from './i18n'

// What a card tells about its pod beyond the buttons: the id that matches the RunPod console, the
// link there, RunPod's own status text, the details panel, and the log stream.
test.describe('pod card', () => {
  test('shows the pod id, a link to it in the RunPod console, and copies the id', async ({ page, api, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    await expect(card.getByTestId('pod-id')).toHaveText('pod-aaaaaaaa')
    await expect(card.getByTestId('pod-console')).toHaveAttribute('href', 'https://www.runpod.io/console/pods/pod-aaaaaaaa')
    await card.getByTestId('pod-copy-id').click()
    await expect(page.getByTestId('toast').first()).toContainText(t('pod.copied'))
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('pod-aaaaaaaa')
  })

  test('shows RunPod\'s own status text on the card when the list carries it', async ({ page, api }) => {
    api.state.pods[1].status_text = 'Exited by user: Mon Oct 19 2026 11:03:19 GMT+0000'
    await page.goto('/')
    await expect(podCard(page, 'ComfyUI-Batch').getByTestId('pod-status-text')).toContainText('Exited by user')
    await expect(podCard(page, 'ComfyUI-Dev').getByTestId('pod-status-text')).toHaveCount(0)
  })

  test('the details panel asks RunPod and shows the price, the place, the card and the image', async ({ page, api }) => {
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    await card.getByTestId('pod-details-toggle').click()
    const details = card.getByTestId('pod-details')
    await expect(details.getByTestId('pod-details-status')).toContainText('RUNNING')
    await expect(details.getByTestId('pod-details-cost')).toHaveText('$0.28' + t('pod.perHour'))
    await expect(details).toContainText('SECURE · EUR-IS-1')
    await expect(details).toContainText('NVIDIA RTX 4000 Ada Generation ×1')
    await expect(details).toContainText('ashleykza/comfyui:latest')
    await expect(details).toContainText(t('pod.diskValue', { disk: 20, volume: 0 }))
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'GET', path: '/pods/pod-aaaaaaaa/details' }))
  })

  test('the logs open in a scrollable modal, stream the pod\'s lines, and stop when closed', async ({ page, api }) => {
    api.state.logs['pod-aaaaaaaa'] = ['Pulling from ashleykza/comfyui', 'Status: Downloaded newer image', 'start container: begin']
    await page.goto('/')
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-logs-toggle').click()
    const modal = page.locator('.modal.show', { has: page.getByTestId('pod-logs') })
    await expect(modal).toBeVisible()
    await expect(modal).toContainText(t('pod.logsTitle', { name: 'ComfyUI-Dev' }))
    const lines = modal.getByTestId('pod-logs-lines')
    await expect(lines).toContainText('Pulling from ashleykza/comfyui')
    await expect(lines).toContainText('start container: begin')
    await expect(lines.locator('div')).toHaveCount(3)
    await modal.getByLabel('Close').click()
    await expect(page.getByTestId('pod-logs')).toHaveCount(0)
  })
})
