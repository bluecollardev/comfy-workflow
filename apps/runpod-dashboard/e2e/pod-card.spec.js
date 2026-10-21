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
    await expect(card.getByTestId('pod-console')).toHaveAttribute('href', 'https://console.runpod.io/pods?id=pod-aaaaaaaa')
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

  test('when the host has no free GPU, the card says so and Recreate makes the pod on another host', async ({ page, api }) => {
    api.state.failures['POST /pods/pod-bbbbbbbb/resume'] = 'There are not enough free GPUs on the host machine to start this pod.'
    page.on('dialog', (d) => d.accept())
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Batch')
    await card.getByTestId('pod-resume').click()
    await expect(card.getByTestId('pod-host-full')).toHaveText(t('pod.hostFull'))
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.hostFull'))
    await card.getByTestId('pod-recreate').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.podRecreated'))
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/pods/pod-bbbbbbbb/recreate' }))
    await expect(podCard(page, 'ComfyUI-Batch').getByTestId('pod-id')).toHaveText('pod-re-bbbb')
    await expect(podCard(page, 'ComfyUI-Batch').getByTestId('pod-status')).toHaveText('starting')
  })

  test('the idle stop can be changed on the card', async ({ page, api }) => {
    api.state.pods[0].idle_stop_minutes = 30
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    await card.getByTestId('pod-idle-edit').click()
    await card.getByTestId('pod-idle-input').fill('10')
    await card.getByTestId('pod-idle-save').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.idleSet', { n: 10 }))
    await expect(card.getByTestId('pod-idle')).toContainText(t('pod.idleAfter', { n: 10 }))
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'PUT', path: '/pods/pod-aaaaaaaa/idle', query: { minutes: '10' } }))
  })

  test('a running pod whose ComfyUI is not up yet shows that instead of a dead link', async ({ page, api }) => {
    api.state.pods[0].comfy_ready = false
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    await expect(card.getByTestId('pod-comfy-starting')).toContainText(t('pod.comfyStarting'))
    await expect(card.getByTestId('pod-open')).toHaveCount(0)
    api.state.pods[0].comfy_ready = true
    await page.getByTestId('refresh').click()
    await expect(card.getByTestId('pod-open')).toBeVisible()
  })

  test('a pod on its way shows a step bar: requested, container up, then nothing once ComfyUI answers', async ({ page, api }) => {
    api.state.pods[0].comfy_ready = false
    await page.goto('/')
    const starting = podCard(page, 'ComfyUI-Test')   // the fixture's starting pod
    await expect(starting.getByTestId('pod-progress')).toHaveAttribute('data-step', '1')
    await expect(starting.getByTestId('pod-progress-label')).toContainText(t('pod.stepRequested'))
    const booting = podCard(page, 'ComfyUI-Dev')     // running, ComfyUI not answering yet
    await expect(booting.getByTestId('pod-progress')).toHaveAttribute('data-step', '2')
    await expect(booting.getByTestId('pod-progress-label')).toContainText(t('pod.stepBooting'))
    api.state.pods[0].comfy_ready = true
    await page.getByTestId('refresh').click()
    await expect(booting.getByTestId('pod-progress')).toHaveCount(0)
  })

  test('Stop shows a bar on the card while RunPod shuts the pod down', async ({ page, api }) => {
    api.state.slow = { stop: 800 }   // the fake API answers Stop late enough to see the bar
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    await card.getByTestId('pod-stop').click()
    await expect(card.getByTestId('pod-progress-label')).toContainText(t('pod.action_stop'))
    await expect(card.getByTestId('pod-status')).toHaveText('stopped')
    await expect(card.getByTestId('pod-progress')).toHaveCount(0)
  })

  test('the Config button is short, and Sync in a plain browser says it runs in the app', async ({ page }) => {
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    await expect(card.getByTestId('pod-config')).toHaveText(t('pod.config'))
    await expect(card.getByTestId('pod-config')).toHaveAttribute('title', /^Config: /)   // the tooltip explains it
    await card.getByTestId('pod-sync').click()
    const dialog = page.locator('.modal.show', { hasText: t('sync.title', { name: 'ComfyUI-Dev' }) })
    await expect(dialog.getByTestId('sync-unavailable')).toContainText(t('sync.unavailable'))
  })

  test('a pod created without its image\'s UI port says so instead of waiting forever', async ({ page, api }) => {
    api.state.pods[0].comfy_ready = false; api.state.pods[0].port_mismatch = true
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    await expect(card.getByTestId('pod-port-mismatch')).toHaveText(t('pod.portMismatch'))
    await expect(card.getByTestId('pod-comfy-starting')).toHaveCount(0)
  })
})
