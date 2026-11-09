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

  test('a stopped pod still shows its price per hour, marked as an estimate; a running pod shows RunPod\'s own', async ({ page }) => {
    await page.goto('/')
    const stopped = podCard(page, 'ComfyUI-Batch')
    await stopped.getByTestId('pod-details-toggle').click()
    await expect(stopped.getByTestId('pod-details-status')).toContainText('EXITED')
    await expect(stopped.getByTestId('pod-details-cost')).toHaveText('≈ $0.28' + t('pod.perHour'))
    const running = podCard(page, 'ComfyUI-Dev')
    await running.getByTestId('pod-details-toggle').click()
    await expect(running.getByTestId('pod-details-cost')).toHaveText('$0.28' + t('pod.perHour'))
  })

  test('a pod card names the network volume it is attached to; a pod with none shows no row', async ({ page }) => {
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    await expect(card.getByTestId('pod-volume')).toContainText('comfy-workspace')
    await expect(card.getByTestId('pod-volume')).toContainText('120 GB · EU-RO-1')
    await expect(podCard(page, 'ComfyUI-Batch').getByTestId('pod-volume')).toHaveCount(0)
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
    await expect(details).toContainText(t('pod.diskNetwork', { disk: 20, name: 'comfy-workspace', size: 120 }))   // a pod on a network volume has 0 GB of its own: say where the data is
    await podCard(page, 'ComfyUI-Batch').getByTestId('pod-details-toggle').click()
    await expect(podCard(page, 'ComfyUI-Batch').getByTestId('pod-details')).toContainText(t('pod.diskValue', { disk: 20, volume: 0 }))   // no network volume: the plain figure
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
    await expect(podCard(page, 'ComfyUI-Batch').getByTestId('pod-status')).toHaveText(t('pod.statuses.starting'))
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
    await expect(card.getByTestId('pod-status')).toHaveText(t('pod.statuses.stopped'))
    await expect(card.getByTestId('pod-progress')).toHaveCount(0)
  })

  test('Import Shot Pack is a primary button on its own row and opens the Import Shot Pack modal', async ({ page }) => {
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Dev')
    const btn = card.getByTestId('pod-import')
    await expect(btn).toHaveText(t('pod.importShotPack'))
    await expect(btn).toHaveClass(/btn-primary/)
    const [row, actions] = await Promise.all([btn.boundingBox(), card.getByTestId('pod-config').boundingBox()])
    expect(row.y).toBeGreaterThan(actions.y + actions.height - 1)   // below the Config / Sync / Details / Logs row, not in it
    await btn.click()
    const dialog = page.locator('.modal.show', { hasText: t('import.title') })
    await expect(dialog.getByTestId('import-source-picker')).toBeVisible()   // one button, then where the package comes from
    await dialog.getByTestId('import-source-folder').click()
    await expect(dialog.getByTestId('import-pane')).toBeVisible()
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

test.describe('Pod card: rename (a name on our side only)', () => {
  test('the pencil renames the pod here; the old name stays as a tooltip; empty goes back to RunPod\'s name; Escape cancels', async ({ page }) => {
    await page.goto('/')
    let card = podCard(page, 'ComfyUI-Batch')
    await card.getByTestId('pod-rename').click()
    await card.getByTestId('pod-rename-input').fill('cgi-042 plates')
    await card.getByTestId('pod-rename-input').press('Escape')
    await expect(podCard(page, 'ComfyUI-Batch')).toBeVisible()   // cancelled: nothing changed
    await card.getByTestId('pod-rename').click()
    await card.getByTestId('pod-rename-input').fill('cgi-042 plates')
    await card.getByTestId('pod-rename-save').click()
    card = podCard(page, 'cgi-042 plates')
    await expect(card.getByTestId('pod-name')).toHaveText('cgi-042 plates')
    await expect(card.getByTestId('pod-name')).toHaveAttribute('title', /ComfyUI-Batch/)
    await card.getByTestId('pod-rename').click()
    await card.getByTestId('pod-rename-input').fill('')
    await card.getByTestId('pod-rename-input').press('Enter')
    await expect(podCard(page, 'ComfyUI-Batch').getByTestId('pod-name')).toHaveText('ComfyUI-Batch')
  })
})

test.describe('Rounds: a round holds a series of pods (ADR-039)', () => {
  test('pods group by round into collapsible lists; a pod is dropped into a round from its card; a round is renamable; empty and "No round" groups show', async ({ page, api }) => {
    api.state.pods.find((p) => p.name === 'ComfyUI-Batch').round = 'brynley-comfy-2026-11-06'
    api.state.pods.find((p) => p.name === 'ComfyUI-Batch').round_label = 'brynley-comfy-2026-11-06'
    await page.goto('/')
    const round = page.locator('[data-testid="round-section"][data-round="brynley-comfy-2026-11-06"]')
    await expect(round.getByTestId('round-title')).toHaveText('brynley-comfy-2026-11-06')
    await expect(round.getByTestId('pod-card')).toHaveCount(1)
    await expect(page.locator('[data-testid="round-section"][data-round=""]').getByTestId('pod-card').first()).toBeVisible()   // the rest are in "No round"
    // collapsible
    await round.getByTestId('round-toggle').click()
    await expect(round.getByTestId('pod-card')).toBeHidden()
    await round.getByTestId('round-toggle').click()
    await expect(round.getByTestId('pod-card')).toBeVisible()
    // drop another pod in from its card
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-round').selectOption('brynley-comfy-2026-11-06')
    await expect(round.getByTestId('pod-card')).toHaveCount(2)
    await expect(round.getByTestId('round-count')).toContainText('2')
    // rename the round
    await round.getByTestId('round-rename').click()
    await round.getByTestId('round-rename-input').fill('Reel 1 conversions')
    await round.getByTestId('round-rename-save').click()
    await expect(round.getByTestId('round-title')).toHaveText('Reel 1 conversions')
    // a pod leaves; the round stays listed
    await podCard(page, 'ComfyUI-Dev').getByTestId('pod-round').selectOption('')
    await expect(round.getByTestId('pod-card')).toHaveCount(1)
    // group by round off: one plain list
    await page.getByTestId('pods-round-toggle').click()
    await expect(page.getByTestId('round-toggle')).toHaveCount(0)
  })

  test('beside each round: Import this round again opens Import Round with it chosen; Delete asks, then its pods leave it and keep running (ADR-039)', async ({ page, api }) => {
    api.state.pods.find((p) => p.name === 'ComfyUI-Batch').round = 'brynley-comfy-2026-11-06'
    const asked = []; let answer = 'dismiss'
    page.on('dialog', (d) => { asked.push(d.message()); return answer === 'accept' ? d.accept() : d.dismiss() })
    await page.goto('/')
    const round = page.locator('[data-testid="round-section"][data-round="brynley-comfy-2026-11-06"]')
    await round.getByTestId('round-reimport').click()
    await expect(page.getByTestId('import-round-modal').locator('[data-testid="import-round-option"][data-round="brynley-comfy-2026-11-06"] input')).toBeChecked()
    await page.getByTestId('import-round-modal').getByText('Cancel', { exact: true }).click()
    await round.getByTestId('round-delete').click()   // Cancel: it stays
    expect(asked).toHaveLength(1)
    await expect(round.getByTestId('pod-card')).toHaveCount(1)
    answer = 'accept'
    await round.getByTestId('round-delete').click()
    await expect(round).toHaveCount(0)
    await expect(podCard(page, 'ComfyUI-Batch')).toBeVisible()   // the pod is still there, in "No round"
  })

  test('a pod card is dragged by its handle onto another round; the move asks first; Cancel leaves it; onto "No round" takes it out (ADR-039)', async ({ page, api }) => {
    api.state.pods.find((p) => p.name === 'ComfyUI-Batch').round = 'round-a'
    api.state.pods.find((p) => p.name === 'ComfyUI-Dev').round = 'round-b'
    await page.setViewportSize({ width: 1280, height: 1800 })   // every round on screen: a drag that scrolls the page picks up another card
    const asked = []; let answer = 'dismiss'
    page.on('dialog', (d) => { asked.push(d.message()); return answer === 'accept' ? d.accept() : d.dismiss() })
    await page.goto('/')
    const a = page.locator('[data-testid="round-section"][data-round="round-a"]')
    const b = page.locator('[data-testid="round-section"][data-round="round-b"]')
    const none = page.locator('[data-testid="round-section"][data-round=""]')
    await expect(a.getByTestId('pod-drag-handle')).toHaveCount(1)   // every card has its grip
    // Cancel: nothing moves, and it asked once
    await a.getByTestId('pod-drag-handle').dragTo(b.getByTestId('round-toggle'))
    await expect.poll(() => asked.length).toBe(1)
    expect(asked[0]).toContain('round-b')
    await expect(a.getByTestId('pod-card')).toHaveCount(1)
    await expect(b.getByTestId('pod-card')).toHaveCount(1)
    // Confirm: it moves
    answer = 'accept'
    await a.getByTestId('pod-drag-handle').dragTo(b.getByTestId('round-toggle'))
    await expect(b.getByTestId('pod-card')).toHaveCount(2)
    await expect(a.getByTestId('pod-card')).toHaveCount(0)
    expect(asked.length).toBe(2)
    // Out of its round, onto "No round"
    await b.getByTestId('pod-drag-handle').first().dragTo(none.getByTestId('round-toggle'))
    await expect(b.getByTestId('pod-card')).toHaveCount(1)
    expect(asked.length).toBe(3)
    // Grouping by round off: no grips
    await page.getByTestId('pods-round-toggle').click()
    await expect(page.getByTestId('pod-drag-handle')).toHaveCount(0)
  })
})
