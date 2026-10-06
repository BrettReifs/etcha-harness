import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function draw(page: Page, x = 220, y = 230) {
  await page.getByRole('button', { name: 'Draw', exact: true }).click()
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (const [dx, dy] of [[30, -20], [60, 20], [95, -10], [125, 0]]) await page.mouse.move(x + dx!, y + dy!)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('notes only run on submit and replies stay attached to their source', async ({ page }) => {
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await page.getByRole('textbox', { name: 'Note text' }).fill('A small idea')
  await expect(page.locator('.reply')).toHaveCount(0)
  await page.getByRole('button', { name: 'Submit note' }).click()
  await expect(page.locator('.object .reply')).toHaveCount(1)
  await expect(page.locator('.reply')).toContainText('Animate')
  await expect(page.locator('.reply')).toContainText('Illustrate')
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue('A small idea')
})

test('completed handwriting offers real animation with stop, reset and undo', async ({ page }) => {
  await draw(page)
  await expect(page.locator('.stroke-body path')).toHaveCount(1)
  await expect(page.locator('.reply')).toContainText('Animate')
  await page.getByRole('button', { name: 'Animate', exact: true }).click()
  await page.getByRole('button', { name: 'Rotate', exact: true }).click()
  await expect(page.locator('.motion-rotate')).toHaveCount(1)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.locator('.motion-rotate')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.motion-rotate')).toHaveCount(1)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.locator('.motion-rotate')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.stroke-body path')).toHaveCount(1)
})

test('a typed transcript resolves the recent stroke without replacing handwriting', async ({ page }) => {
  await draw(page)
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await page.getByRole('textbox', { name: 'Note text' }).fill('Make that rotate')
  await page.getByRole('button', { name: 'Submit note' }).click()
  await expect(page.locator('.reply').last()).toContainText('Rotate')
  await page.locator('.reply').last().getByRole('button', { name: 'Rotate', exact: true }).click()
  await expect(page.locator('.stroke-body.motion-rotate')).toHaveCount(1)
  await expect(page.locator('.stroke-body path')).toHaveCount(1)
})

test('ambiguous references ask for a target', async ({ page }) => {
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await page.getByRole('textbox', { name: 'Note text' }).fill('Make that animate')
  await page.getByRole('button', { name: 'Submit note' }).click()
  await expect(page.locator('.reply')).toContainText('select')
  await expect(page.locator('.motion-rotate,.motion-pulse')).toHaveCount(0)
})

test('microphone denial explains the typed fallback', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) })
  })

  test('explicit audio stop releases tracks and preserves audio without inventing a transcript', async ({ page }) => {
    await draw(page)
    await page.evaluate(() => {
      let released = 0
      Object.defineProperty(window, '__releasedAudioTracks', { get: () => released })
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async () => ({ getTracks: () => [{ stop: () => { released++ } }] }),
      })
      class LocalRecorder {
        state = 'inactive'
        mimeType = 'audio/webm;codecs=opus'
        ondataavailable?: (event: { data: Blob }) => void
        onstop?: () => void
        start() { this.state = 'recording' }
        stop() {
          this.state = 'inactive'
          this.ondataavailable?.({ data: new Blob(['local audio evidence'], { type: this.mimeType }) })
          this.onstop?.()
        }
      }
      Object.defineProperty(window, 'MediaRecorder', { value: LocalRecorder })
    })
    await page.getByRole('button', { name: 'Record audio', exact: true }).click()
    await expect(page.locator('#status')).toContainText('Recording locally')
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Audio transcript' })).toHaveValue('')
    await expect(page.locator('audio')).toHaveCount(1)
    expect(await page.evaluate(() => (window as unknown as { __releasedAudioTracks: number }).__releasedAudioTracks)).toBe(1)
    await page.getByRole('textbox', { name: 'Audio transcript' }).fill('Make that pulse')
    await page.getByRole('button', { name: 'Submit transcript', exact: true }).click()
    await page.locator('.object').last().getByRole('button', { name: 'Pulse', exact: true }).click()
    await expect(page.locator('.stroke-body.motion-pulse')).toHaveCount(1)
    await page.reload()
    await expect(page.locator('audio')).toHaveAttribute('src', /^data:audio\/webm;codecs=opus;base64,/)
    await expect(page.getByRole('textbox', { name: 'Audio transcript' })).toHaveValue('Make that pulse')
  })
  await page.getByRole('button', { name: 'Record audio' }).click()
  await expect(page.locator('#status')).toContainText('type your transcript')
  await expect(page.getByRole('button', { name: 'Record audio' })).toBeVisible()
})

test('approved workflows can be saved, edited, reloaded, reused and deleted', async ({ page }) => {
  await draw(page)
  await page.getByRole('button', { name: 'Animate', exact: true }).click()
  await page.getByRole('button', { name: 'Rotate', exact: true }).click()
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
  await page.getByRole('textbox', { name: 'Workflow name' }).fill('My rotation')
  await page.getByRole('button', { name: 'Approve and save', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Workflows', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue('My rotation')
  await page.getByRole('textbox', { name: 'Workflow name' }).fill('Slow rotation')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('button', { name: 'Run on selected', exact: true }).click()
  await expect(page.locator('.motion-rotate')).toHaveCount(1)
  await page.getByRole('button', { name: 'Delete workflow', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveCount(0)
})

test('keyboard navigation, reduced motion and accessible desk', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await draw(page)
  await page.getByRole('button', { name: 'Animate', exact: true }).click()
  await page.getByRole('button', { name: 'Pulse', exact: true }).click()
  await expect(page.locator('.motion-pulse')).toHaveCSS('animation-name', 'none')
  const select = page.getByRole('button', { name: /Select stroke/ }).first()
  await select.focus()
  const before = Number(await page.locator('.object').first().getAttribute('data-x'))
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.object').first()).toHaveAttribute('data-x', String(before + 5))
  await page.keyboard.press('+')
  await expect(page.locator('#zoom-level')).toHaveText('120%')
  await page.getByRole('button', { name: 'Pan', exact: true }).click()
  const cameraBefore = await page.locator('#world').getAttribute('style')
  await page.keyboard.press('ArrowLeft')
  expect(await page.locator('#world').getAttribute('style')).not.toBe(cameraBefore)
  await expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

test('live errors do not fall back, streamed strings remain text, and cancellation wins', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Enable Jev cloud judgment' })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Enable Copilot live execution' })).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Enable Copilot live execution' }).check()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  let payload: Record<string, unknown> | undefined
  await page.route('http://127.0.0.1:4318/api/run', async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type' } })
      return
    }
    payload = route.request().postDataJSON()
    await route.fulfill({
      status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' },
      body: `data: ${JSON.stringify({ type: 'delta', text: '<img src=x onerror=alert(1)>' })}\n\ndata: ${JSON.stringify({ type: 'error', message: 'Failed' })}\n\n`,
    })
  })
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await page.getByRole('textbox', { name: 'Note text' }).fill('A live thought')
  await page.getByRole('button', { name: 'Submit note' }).click()
  await expect(page.locator('.reply')).toContainText('Live provider unavailable')
  await expect(page.locator('.reply')).not.toContainText('Offline reply')
  await expect(page.locator('.reply img')).toHaveCount(0)
  expect(payload?.consent).toBe(true)
  expect((payload?.snapshot as { workflows: unknown[] }).workflows).toEqual([])
  await page.unroute('http://127.0.0.1:4318/api/run')
  await page.route('http://127.0.0.1:4318/api/run', async route => {
    await new Promise(resolve => setTimeout(resolve, 500))
    await route.fulfill({
      contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' },
      body: `data: ${JSON.stringify({ type: 'result', decision: { type: 'clarify', question: 'A stale response' } })}\n\n`,
    }).catch(() => {})
  })
  await page.getByRole('button', { name: 'Submit note' }).click()
  await page.getByRole('button', { name: 'Cancel request', exact: true }).click()
  await expect(page.locator('.reply')).toContainText('Request cancelled')
  await page.waitForTimeout(600)
  await expect(page.locator('.reply')).not.toContainText('stale response')
})

test('unsafe stored markup stays editable text and image consent remains separate', async ({ page }) => {
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await page.getByRole('textbox', { name: 'Note text' }).fill('<svg onload=alert(1)>')
  await page.getByRole('button', { name: 'Submit note' }).click()
  await expect(page.locator('.reply')).toContainText('<svg onload=alert(1)>')
  await expect(page.locator('.reply svg')).toHaveCount(0)
  await page.getByRole('button', { name: 'Illustrate', exact: true }).click()
  await expect(page.locator('#status')).toContainText('requires separate confirmation')
  await expect(page.locator('.reply')).toContainText('unavailable')
})

test('desktop and mobile screenshots are candidates, never approved baselines', async ({ page }, testInfo) => {
  await draw(page, 240, 245)
  await page.screenshot({ path: testInfo.outputPath('desktop-candidate.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Center', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Agentic canvas' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('mobile-candidate.png'), fullPage: true })
})
