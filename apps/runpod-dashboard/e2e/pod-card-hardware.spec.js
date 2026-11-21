import { test, expect, podCard } from './fixtures'

// The card says what the pod is: the count and total VRAM, and the container's RAM when it is known.
const run = (over) => ({ id: 'pod-dddddddd', name: 'Two-Card', status: 'running', datacenter: 'EU-RO-1', gpu: 'RTX PRO 4500', vram: 32, uptime_seconds: 60, web_ui_url: 'https://pod-d.proxy.runpod.io:8188', ssh_command: 'ssh root@pod-d.proxy.runpod.io', ...over })

test.describe('pod card hardware', () => {
  test('one card keeps the per-card size; two cards show the count and the total VRAM', async ({ page, api }) => {
    api.state.pods = [run({ id: 'pod-1', name: 'One-Card', gpu_count: 1, vram_total: 32 }), run({ gpu_count: 2, vram_total: 64 })]
    await page.goto('/')
    await expect(podCard(page, 'One-Card').getByTestId('pod-gpu')).toHaveText('RTX PRO 4500 · 32 GB')
    await expect(podCard(page, 'Two-Card').getByTestId('pod-gpu')).toHaveText('RTX PRO 4500 x2 · 64 GB VRAM')
  })

  test('RAM: nothing when unknown, the limit when known, used and percent when read, a warning from 85%', async ({ page, api }) => {
    api.state.pods = [
      run({ id: 'pod-1', name: 'Unknown', gpu_count: 1 }),
      run({ id: 'pod-2', name: 'Limit', gpu_count: 2, ram_gb: 116.4, ram_source: 'cgroup' }),
      run({ id: 'pod-3', name: 'Used', gpu_count: 1, ram_gb: 57.7, ram_used_gb: 20, ram_pct: 34.7, ram_source: 'cgroup' }),
      run({ id: 'pod-4', name: 'Hot', gpu_count: 1, ram_gb: 87.5, ram_used_gb: 80, ram_pct: 91.4, ram_source: 'cgroup' }),
    ]
    await page.goto('/')
    await expect(podCard(page, 'Unknown').getByTestId('pod-ram')).toHaveCount(0)
    await expect(podCard(page, 'Limit').getByTestId('pod-ram')).toHaveText('116 GB')
    await expect(podCard(page, 'Used').getByTestId('pod-ram')).toHaveText('20 / 58 GB (34.7%)')
    await expect(podCard(page, 'Used').getByTestId('pod-ram')).not.toHaveAttribute('data-warn', 'true')
    await expect(podCard(page, 'Hot').getByTestId('pod-ram')).toHaveText('80 / 88 GB (91.4%)')
    await expect(podCard(page, 'Hot').getByTestId('pod-ram')).toHaveAttribute('data-warn', 'true')
  })
})
