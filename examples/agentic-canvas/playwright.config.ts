import { defineConfig, devices } from '@playwright/test'

const evidenceDir = process.env.ETCHA_EVIDENCE_DIR || `./artifacts/candidate-${new Date().toISOString().replace(/[:.]/g, '-')}`

export default defineConfig({
  testDir: './tests/browser',
  outputDir: `${evidenceDir}/tests`,
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: `${evidenceDir}/report`, open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { chromiumSandbox: true },
    ...(process.env.ETCHA_TEST_BROWSER_CHANNEL === 'chrome' ? { channel: 'chrome' } : {}),
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
