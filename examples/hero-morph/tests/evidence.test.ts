import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'

function loadConfig(runId?: string) {
  const env = { ...process.env }
  delete env.ETCHA_HERO_EVIDENCE_RUN
  if (runId !== undefined) env.ETCHA_HERO_EVIDENCE_RUN = runId
  const url = new URL('../playwright.config.ts', import.meta.url).href
  return JSON.parse(execFileSync(process.execPath, [
    '--input-type=module', '-e',
    `const { default: config } = await import(${JSON.stringify(url)}); console.log(JSON.stringify(config))`,
  ], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
}

test('browser runs keep separate evidence directories and matching result reports', () => {
  const first = loadConfig()
  const second = loadConfig()
  const evidenceRoot = join(import.meta.dirname, '..', 'test-results')

  assert.notEqual(first.outputDir, second.outputDir)
  for (const config of [first, second]) {
    assert.equal(dirname(config.outputDir), evidenceRoot)
    assert.deepEqual(config.reporter, [
      ['list'],
      ['json', { outputFile: join(config.outputDir, 'results.json') }],
    ])
    assert.equal(config.workers, 1)
    assert.equal(config.fullyParallel, false)
  }
  const child = loadConfig(basename(first.outputDir).slice('run-'.length))
  assert.equal(child.outputDir, first.outputDir)
  assert.deepEqual(child.reporter, first.reporter)
})

test('invalid inherited run IDs cannot redirect evidence outside its root', () => {
  assert.throws(() => loadConfig('../../outside'), /must be a UUID/)
})
