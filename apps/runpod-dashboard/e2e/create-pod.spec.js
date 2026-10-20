import { test, expect, createPodToggle, openCreatePod, expandSection } from './fixtures'

test.describe('create pod', () => {
  test('form is collapsed by default and the card header toggles it', async ({ page }) => {
    await page.goto('/')
    const toggle = createPodToggle(page)
    await expect(page.getByLabel('Name')).toBeHidden()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await toggle.click()
    await expect(page.getByLabel('Name')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await toggle.click()
    await expect(page.getByLabel('Name')).toBeHidden()
  })

  test('submits every field in the API client shape, then collapses and refreshes', async ({ page, api }) => {
    await page.goto('/')
    await openCreatePod(page)

    await page.getByLabel('Name').fill('ComfyUI-Dev')
    await page.getByLabel('GPU', { exact: true }).selectOption('a4000')
    await page.getByLabel('GPU count').selectOption('2')
    await page.getByLabel('Instance type').selectOption('on-demand')
    await page.getByLabel('Per-pod volume (GB)').fill('100')
    await page.getByLabel('Container disk (GB)').fill('30')
    await page.getByLabel('Image', { exact: true }).selectOption('custom')
    await page.getByLabel('Image URI').fill('docker.io/me/comfy:1')
    await page.getByLabel('Start SSH').uncheck()
    await page.getByLabel('Start Jupyter').check()

    await expandSection(page, 'Environment & build args')
    const envRows = page.locator('#adv-envVars .env-row')
    const addVar = page.getByRole('button', { name: 'Add variable' })
    await addVar.click()
    await expect(envRows.nth(0).getByLabel('Type')).toHaveValue('env')
    await envRows.nth(0).getByLabel('Key').fill('HF_TOKEN')
    await envRows.nth(0).getByLabel('Value').fill('abc')
    await addVar.click()
    await envRows.nth(1).getByLabel('Key').fill('EMPTY')
    await addVar.click()
    await envRows.nth(2).getByLabel('Key').fill('PASTED=from clipboard')
    await expect(envRows.nth(2).getByLabel('Key')).toHaveValue('PASTED')
    await expect(envRows.nth(2).getByLabel('Value')).toHaveValue('from clipboard')
    await addVar.click() // left blank → dropped
    await addVar.click()
    await envRows.nth(4).getByLabel('Type').selectOption('arg')
    await envRows.nth(4).getByLabel('Key').fill('CUDA_SHORT=cu128')
    await expect(page.locator('#adv-envVars tr.env-group')).toHaveText([/Environment \(4\)/, /Build args \(1\)/])
    await expandSection(page, 'Pip requirements')
    await page.locator('#adv-pipRequirements textarea').fill('torch==2.1\n\nxformers')
    await expandSection(page, 'Custom nodes')
    await page.locator('#adv-customNodes textarea').fill([
      'https://github.com/me/nodes#pack_a',
      'https://github.com/me/nodes/tree/dev/pack_b',
      'https://github.com/other/ComfyUI-Thing.git',
    ].join('\n'))

    await page.locator('form button[type=submit]').click()

    const post = api.calls.find((c) => c.method === 'POST' && c.path === '/pods')
    expect(post.body).toEqual({
      name: 'ComfyUI-Dev',
      gpu: 'a4000',
      gpu_count: 2,
      instance_type: 'on-demand',
      volume_gb: 100,
      disk_gb: 30,
      image: 'docker.io/me/comfy:1',
      idle_stop_minutes: null,
      apply_mounts: true,
      config: null,
      env_vars: { HF_TOKEN: 'abc', EMPTY: '', PASTED: 'from clipboard' },
      build_args: { CUDA_SHORT: 'cu128' },
      pip_requirements: 'torch==2.1\n\nxformers',
      custom_nodes: [
        { name: 'pack_a', url: 'https://github.com/me/nodes', branch: 'main', path: 'pack_a' },
        { name: 'pack_b', url: 'https://github.com/me/nodes', branch: 'dev', path: 'pack_b' },
        { name: 'ComfyUI-Thing', url: 'https://github.com/other/ComfyUI-Thing.git', branch: 'main', path: '' },
      ],
      start_ssh: false,
      start_jupyter: true,
    })

    await expect(page.getByLabel('Name')).toBeHidden()
    await expect(page.locator('.card.h-100')).toHaveCount(4)
    await expect(page.locator('.card.h-100', { hasText: 'ComfyUI-Dev' }).first()).toBeVisible()
  })

  test('the defaults send the configured image, the cheap cloud and no per-pod volume', async ({ page, api }) => {
    await page.goto('/')
    await openCreatePod(page)
    await expect(page.getByLabel('Image URI')).toBeHidden()
    await expect(page.locator('form')).toContainText('ghcr.io/example/comfy-app:v26')   // what "configured" means, from GET /mounts
    await page.getByLabel('Name').fill('quick')
    await page.locator('form button[type=submit]').click()
    const post = api.calls.find((c) => c.method === 'POST' && c.path === '/pods')
    expect(post.body).toMatchObject({ name: 'quick', image: 'configured', gpu: 'auto', gpu_count: 1, instance_type: 'spot', volume_gb: 0, idle_stop_minutes: null, start_ssh: true, start_jupyter: false })
  })

  test('the stock image can still be chosen and sends "prebuilt"', async ({ page, api }) => {
    await page.goto('/')
    await openCreatePod(page)
    await page.getByLabel('Image', { exact: true }).selectOption('prebuilt')
    await page.getByLabel('Name').fill('quick')
    await page.getByLabel('Idle stop (minutes)').fill('0')
    await page.locator('form button[type=submit]').click()
    const post = api.calls.find((c) => c.method === 'POST' && c.path === '/pods')
    expect(post.body).toMatchObject({ name: 'quick', image: 'prebuilt', idle_stop_minutes: 0 })
  })

  test('name is required', async ({ page, api }) => {
    await page.goto('/')
    await openCreatePod(page)
    await page.locator('form button[type=submit]').click()
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    await expect(page.getByLabel('Name')).toBeVisible()
  })

  test('shows the API error and keeps the form', async ({ page, api }) => {
    api.state.failures['POST /pods'] = 'No RTX 4090 available in any datacenter'
    await page.goto('/')
    await openCreatePod(page)
    await page.getByLabel('Name').fill('ComfyUI-Dev')
    await page.locator('form button[type=submit]').click()
    await expect(page.getByRole('alert')).toContainText('No RTX 4090 available')
    await expect(page.getByLabel('Name')).toHaveValue('ComfyUI-Dev')
  })

  test('environment variable rows can be removed', async ({ page }) => {
    await page.goto('/')
    await openCreatePod(page)
    await expandSection(page, 'Environment & build args')
    const envRows = page.locator('#adv-envVars .env-row')
    const addVar = page.getByRole('button', { name: 'Add variable' })
    await addVar.click()
    await addVar.click()
    await envRows.nth(0).getByLabel('Key').fill('FIRST')
    await envRows.nth(1).getByLabel('Key').fill('SECOND')
    await envRows.nth(0).getByRole('button', { name: 'Remove variable' }).click()
    await expect(envRows).toHaveCount(1)
    await expect(envRows.nth(0).getByLabel('Key')).toHaveValue('SECOND')
  })

  test('loads env and build-arg defaults from the image, adding missing keys or replacing values', async ({ page, api }) => {
    api.state.imageEnv = [{ key: 'COMFYUI_PORT', value: '8188' }, { key: 'HF_TOKEN', value: 'from-image' }]
    api.state.imageBuildArgs = [{ key: 'TORCH_VERSION', value: '2.6.0' }, { key: 'CUDA_VERSION', value: '12.4.1' }]
    api.state.imageEnvSkipped = 41
    await page.goto('/')
    await openCreatePod(page)
    await expandSection(page, 'Environment & build args')
    const envRows = page.locator('#adv-envVars .env-row')
    await page.getByRole('button', { name: 'Add variable' }).click()
    await envRows.nth(0).getByLabel('Key').fill('HF_TOKEN')
    await envRows.nth(0).getByLabel('Value').fill('mine')

    await page.getByRole('button', { name: 'Load defaults' }).click()
    await page.locator('.dropdown-item', { hasText: 'From the image' }).click()
    // env rows first, then the build ARGs as "arg" rows, each group with a header
    await expect(envRows).toHaveCount(4)
    await expect(envRows.nth(0).getByLabel('Value')).toHaveValue('mine') // kept
    await expect(envRows.nth(1).getByLabel('Key')).toHaveValue('COMFYUI_PORT')
    await expect(envRows.nth(1).getByLabel('Value')).toHaveValue('8188')
    await expect(envRows.nth(2).getByLabel('Type')).toHaveValue('arg')
    await expect(envRows.nth(2).getByLabel('Key')).toHaveValue('TORCH_VERSION')
    await expect(envRows.nth(2).getByLabel('Value')).toHaveValue('2.6.0')
    await expect(envRows.nth(3).getByLabel('Key')).toHaveValue('CUDA_VERSION')
    await expect(page.locator('#adv-envVars tr.env-group')).toHaveText([/Environment \(2\)/, /Build args \(2\)/])
    await expect(page.locator('#adv-envVars')).toContainText(
      '2 env + 2 build args from ghcr.io/example/comfy-app:v26: 3 added, 0 replaced (41 system vars skipped)',
    )
    // an override typed into a build arg survives a plain reload
    await envRows.nth(2).getByLabel('Value').fill('2.8.0')
    await page.getByRole('button', { name: 'Load defaults' }).click()
    await page.locator('.dropdown-item', { hasText: 'From the image' }).click()
    await expect(envRows.nth(2).getByLabel('Value')).toHaveValue('2.8.0')
    expect(api.calls).toContainEqual(expect.objectContaining({ path: '/images/env', query: { source: 'image', image: 'ghcr.io/example/comfy-app:v26' } }))

    await page.getByLabel('Replace existing values').check()
    await page.getByRole('button', { name: 'Load defaults' }).click()
    await page.locator('.dropdown-item', { hasText: 'From the image' }).click()
    await expect(envRows.nth(0).getByLabel('Value')).toHaveValue('from-image')
    await expect(envRows.nth(2).getByLabel('Value')).toHaveValue('2.6.0') // override replaced too
    await expect(page.locator('#adv-envVars')).toContainText('0 added, 2 replaced')

    await page.getByRole('button', { name: 'Load defaults' }).click()
    await page.locator('.dropdown-item', { hasText: 'From the Dockerfile' }).click()
    expect(api.calls).toContainEqual(expect.objectContaining({ path: '/images/env', query: expect.objectContaining({ source: 'dockerfile' }) }))
  })

  test('reports when the image env lookup fails', async ({ page, api }) => {
    api.state.failures['GET /images/env'] = 'ghcr.io/me/private: registry refused anonymous access (private image?)'
    await page.goto('/')
    await openCreatePod(page)
    await expandSection(page, 'Environment & build args')
    await page.getByRole('button', { name: 'Load defaults' }).click()
    await page.locator('.dropdown-item', { hasText: 'From the image' }).click()
    await expect(page.getByRole('alert')).toContainText('registry refused anonymous access')
  })

  test('rows stay grouped by type and sort within the groups', async ({ page }) => {
    await page.goto('/')
    await openCreatePod(page)
    await expandSection(page, 'Environment & build args')
    const envRows = page.locator('#adv-envVars .env-row')
    const keys = () => envRows.locator('[aria-label="Key"]').evaluateAll((els) => els.map((e) => e.value))
    const addVar = page.getByRole('button', { name: 'Add variable' })

    // a new row is added at the end of the env group (not the table), so its index is the env count
    let envCount = 0
    for (const [type, key] of [['env', 'B'], ['arg', 'Z'], ['env', 'A'], ['arg', 'Y']]) {
      await addVar.click()
      const row = envRows.nth(envCount)
      await row.getByLabel('Key').fill(key)
      if (type === 'arg') await row.getByLabel('Type').selectOption('arg')
      else envCount++
    }
    // flipping a row to "arg" moves it to the end of the arg group; the env group keeps insertion order
    await expect.poll(keys).toEqual(['B', 'A', 'Z', 'Y'])
    await expect(page.locator('#adv-envVars tr.env-group')).toHaveText([/Environment \(2\)/, /Build args \(2\)/])

    await page.getByRole('button', { name: /^Key/ }).click()
    await expect.poll(keys).toEqual(['A', 'B', 'Y', 'Z'])
    await page.getByRole('button', { name: /^Key/ }).click()
    await expect.poll(keys).toEqual(['B', 'A', 'Z', 'Y'])
    await page.getByRole('button', { name: /^Type/ }).click()
    await expect.poll(keys).toEqual(['Z', 'Y', 'B', 'A'])
    await expect(page.locator('#adv-envVars tr.env-group').first()).toHaveText(/Build args/)
  })

  test('reset restores the defaults', async ({ page }) => {
    await page.goto('/')
    await openCreatePod(page)
    await page.getByLabel('Name').fill('scratch')
    await page.getByLabel('Per-pod volume (GB)').fill('200')
    await page.getByRole('button', { name: 'Reset' }).click()
    await expect(page.getByLabel('Name')).toHaveValue('')
    await expect(page.getByLabel('Per-pod volume (GB)')).toHaveValue('0')
  })
})
