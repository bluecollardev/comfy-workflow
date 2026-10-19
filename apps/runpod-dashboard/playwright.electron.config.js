import { defineConfig } from '@playwright/test'

// The app itself, driven through Electron: the page talks to the core over IPC, no fake API.
// Two kinds of spec live here: no-spend runs (always; pods simulated, nothing bills) and the
// live proof against RunPod (only with RUNPOD_LIVE=1; it creates one real pod and stops it).
export default defineConfig({
  testDir: './e2e-electron',
  workers: 1,
  fullyParallel: false,
  timeout: 10 * 60 * 1000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
})
