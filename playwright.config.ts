import { defineConfig, devices } from '@playwright/test'

// End-to-end tests drive Mono against a real Decaid running in simulate mode:
//   DECAID_DIR=/path/to/decaid scripts/decaid-sim.sh start
// Set MONO_URL to test an installed copy instead of the dev server.
const installed = process.env.MONO_URL

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1, // one simulated machine: tests must not overlap
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: installed ?? 'http://localhost:5173',
    viewport: { width: 1194, height: 834 },
    trace: 'retain-on-failure',
  },
  webServer: installed
    ? undefined
    : { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true },
})
