import { defineConfig } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

// Playwright reloads this config in child processes; keep one ID for the run.
const runId = process.env.ETCHA_HERO_EVIDENCE_RUN ??= randomUUID()
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(runId)) {
  throw new Error('ETCHA_HERO_EVIDENCE_RUN must be a UUID')
}
const outputDir = join(import.meta.dirname, 'test-results', `run-${runId}`)

export default defineConfig({
  testDir: './tests/browser',
  outputDir,
  reporter: [
    ['list'],
    ['json', { outputFile: join(outputDir, 'results.json') }],
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4178',
    headless: true,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
})
