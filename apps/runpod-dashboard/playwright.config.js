import { defineConfig, devices } from '@playwright/test'

// The browser suite against the Vite dev server. PW_PORT runs it on another port (two checkouts side by
// side: 5173 reused by default would serve the other one's code).
const PORT = Number(process.env.PW_PORT || 5173)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI && !process.env.PW_PORT,
  },
})
