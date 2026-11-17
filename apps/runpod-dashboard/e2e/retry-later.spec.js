import { test, expect, podCard, openCreatePod, answerConfirm } from './fixtures'
import { t } from './i18n'

// Retry Later (ADR-042 section 19): when RunPod has no free GPU for a Resume or a Create, the window offers to keep trying instead of failing,
// and shows what is waiting. The mocked API plays the core: it records the asks and answers the watch list.
test.describe('retry later', () => {
  const HOST_FULL = 'There are not enough free GPUs on the host machine to start this pod.'
  const NO_CARD = 'No card available right now: tried a100 on SECURE. RunPod: There are no longer any instances available with the requested specifications.'

  test('a Resume that finds the host full offers Retry Later next to Recreate; it waits, shows on the card and in the list, and Cancel stops it', async ({ page, api }) => {
    api.state.failures['POST /pods/pod-bbbbbbbb/resume'] = HOST_FULL
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Batch')
    await card.getByTestId('pod-resume').click()
    await expect(card.getByTestId('pod-host-full')).toContainText(t('pod.hostFull'))
    await expect(card.getByTestId('pod-retry-later')).toHaveText(t('pod.retryLater'))
    await expect(card.getByTestId('pod-recreate')).toBeVisible()   // the other way on is still there

    await card.getByTestId('pod-retry-later').click()
    await page.getByTestId('retry-later-start').click()   // the choice's default: the same GPU
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.retryLaterSet', { n: 2 }))
    expect(api.state.resumeWhenFree).toEqual([{ id: 'pod-bbbbbbbb' }])   // the same pod, the default interval (the core's)
    expect(api.calls).not.toContainEqual(expect.objectContaining({ method: 'POST', path: '/pods/pod-bbbbbbbb/recreate' }))   // nothing deleted

    // the card says it is waiting (and no longer offers the choice); the list names what is waiting
    await expect(card.getByTestId('pod-waiting')).toContainText('Waiting for a free A100 in EU-RO-1 · trying every 2 min')
    await expect(card.getByTestId('pod-host-full')).toHaveCount(0)
    const row = page.getByTestId('pod-watch-waiting')
    await expect(row).toHaveCount(1)
    await expect(row.getByTestId('pod-watch-name')).toHaveText('ComfyUI-Batch')
    await expect(row.getByTestId('pod-watch-kind')).toHaveText(t('podWatch.kindResume'))
    await expect(row.getByTestId('pod-watch-tries')).toContainText('every 2 min')

    await card.getByTestId('pod-waiting-cancel').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.watchCancelled'))
    expect(api.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/pod-watches/watch-1' }))
    await expect(card.getByTestId('pod-waiting')).toHaveCount(0)
    await expect(page.getByTestId('pod-watch-waiting')).toHaveCount(0)
    await expect(page.getByTestId('pod-watch-cancelled').getByTestId('pod-watch-outcome')).toHaveText(t('podWatch.cancelled'))   // what came of it stays for a while
  })

  test('the choice can be dismissed: nothing is waiting and the pod is as it was', async ({ page, api }) => {
    api.state.failures['POST /pods/pod-bbbbbbbb/resume'] = HOST_FULL
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Batch')
    await card.getByTestId('pod-resume').click()
    await card.getByTestId('pod-host-full-dismiss').click()
    await expect(card.getByTestId('pod-host-full')).toHaveCount(0)
    expect(api.state.resumeWhenFree).toBeUndefined()
  })

  test('Recreate warns that the pod and its container disk are deleted, and points to Retry Later', async ({ page, api }) => {
    api.state.failures['POST /pods/pod-bbbbbbbb/resume'] = HOST_FULL
    await page.goto('/')
    const card = podCard(page, 'ComfyUI-Batch')
    await card.getByTestId('pod-resume').click()
    await card.getByTestId('pod-recreate').click()
    const msg = await answerConfirm(page, false)
    expect(msg).toContain('container disk'); expect(msg).toContain('Retry Later')
    expect(api.calls).not.toContainEqual(expect.objectContaining({ method: 'POST', path: '/pods/pod-bbbbbbbb/recreate' }))
  })

  test('a Create that finds no card offers Retry Later with the same request; the pod is not made twice and the wait shows in the list', async ({ page, api }) => {
    api.state.failures['POST /pods'] = NO_CARD
    await page.goto('/')
    await openCreatePod(page)
    await page.getByLabel('Name').fill('CanalV2-lores-v003-a-v27')
    await page.getByTestId('pod-submit').click()
    await expect(page.getByTestId('pod-form-error')).toContainText('No card available right now')
    await expect(page.getByTestId('pod-form-error')).toContainText(t('form.noCardHint'))

    await page.getByTestId('pod-retry-later').click()
    await expect(page.getByTestId('toast').last()).toContainText(t('toast.retryLaterCreateSet', { n: 2 }))
    expect(api.state.createWhenFree).toHaveLength(1)
    expect(api.state.createWhenFree[0].request).toMatchObject({ name: 'CanalV2-lores-v003-a-v27' })
    expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/pods')).toHaveLength(1)   // the one that failed; the watch makes the next, in the core
    const row = page.getByTestId('pod-watch-waiting')
    await expect(row.getByTestId('pod-watch-kind')).toHaveText(t('podWatch.kindCreate'))
    await expect(row.getByTestId('pod-watch-name')).toHaveText('CanalV2-lores-v003-a-v27')
    await expect(row.getByTestId('pod-watch-label')).toContainText('Waiting for a free')
    await expect(page.getByTestId('pod-form-error')).toHaveCount(0)   // the form is done with
  })

  test('another failure of a Create is just an error: no Retry Later', async ({ page, api }) => {
    api.state.failures['POST /pods'] = 'Your account balance is too low to rent a pod.'
    await page.goto('/')
    await openCreatePod(page)
    await page.getByLabel('Name').fill('x')
    await page.getByTestId('pod-submit').click()
    await expect(page.getByTestId('pod-form-error')).toContainText('balance is too low')
    await expect(page.getByTestId('pod-retry-later')).toHaveCount(0)
  })

  test('what ended shows for a while: a create that was made, a wait that gave up', async ({ page, api }) => {
    const now = Date.now(), iso = (ms) => new Date(ms).toISOString()
    api.state.watches = [
      { id: 'w1', kind: 'create', state: 'done', name: 'CanalV2-lores-v003-a-v27', label: 'x', every_s: 120, attempts: 3, created_at: iso(now - 600000), finished_at: iso(now - 60000), next_at: iso(now), give_up_at: iso(now) },
      { id: 'w2', kind: 'resume', state: 'expired', name: 'CanalV2-base-graphs-v001', label: 'x', detail: 'Gave up after 12 h without a free GPU.', every_s: 120, attempts: 360, created_at: iso(now - 43200000), finished_at: iso(now - 120000), next_at: iso(now), give_up_at: iso(now) },
      { id: 'w3', kind: 'create', state: 'done', name: 'old', label: 'x', every_s: 120, attempts: 1, created_at: iso(now - 7200000), finished_at: iso(now - 3600000), next_at: iso(now), give_up_at: iso(now) },
    ]
    await page.goto('/')
    await expect(page.getByTestId('pod-watch-done').getByTestId('pod-watch-outcome')).toHaveText(t('podWatch.created', { name: 'CanalV2-lores-v003-a-v27' }))
    await expect(page.getByTestId('pod-watch-expired').getByTestId('pod-watch-outcome')).toContainText('Gave up after 12 h')
    await expect(page.getByTestId('pod-watch-done')).toHaveCount(1)   // the one from an hour ago is not shown
  })
})
