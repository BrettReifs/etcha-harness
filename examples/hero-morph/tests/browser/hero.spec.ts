import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function inspect(page: Page) {
  return page.evaluate(async () => (await import('/src/main.ts')).controller.inspect())
}

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.locator('#stage')).toHaveAttribute('data-renderer', 'ready')
  expect((await inspect(page)).context).toBe('WebGL2RenderingContext')
  expect((await inspect(page)).triangles).toBeGreaterThan(20_000)
}

async function settled(page: Page, amount: number) {
  await expect.poll(async () => (await inspect(page)).amount).toBe(amount)
  await expect.poll(async () => (await inspect(page)).pendingFrame).toBe(false)
}

test('real geometry, attachments, interruption, idempotence and idle rendering', async ({ page }) => {
  await ready(page)
  const original = await inspect(page)
  const button = page.getByRole('button', { name: 'Equip Seed badge', exact: true })
  await button.focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await inspect(page)).amount).toBeGreaterThan(0)
  await page.keyboard.press('Space')
  await settled(page, 0)
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  expect((await inspect(page)).geometry).toEqual(original.geometry)
  await button.click()
  await settled(page, 1)
  const seed = await inspect(page)
  expect(seed.geometry).not.toEqual(original.geometry)
  expect(seed.scale).toEqual([1, 1, 1])
  expect(seed.badgeVisible).toBe(true)
  expect(seed.eyes[0][1]).toBeGreaterThan(original.eyes[0][1])
  const attachmentErrors = await page.evaluate(async () => {
    const { controller } = await import('/src/main.ts')
    const { attachment } = await import('/src/shape.ts')
    const current = controller.inspect()
    return [
      [current.eyes[0], attachment('leftEye', current.amount)],
      [current.eyes[1], attachment('rightEye', current.amount)],
      [current.mouth, attachment('mouth', current.amount)],
      [current.badge, attachment('badge', current.amount)],
    ].map(([actual, expected]) => Math.max(...actual.map((v: number, i: number) => Math.abs(v - expected[i]))))
  })
  expect(attachmentErrors.every(error => error < 1e-6)).toBe(true)
  await page.evaluate(async () => {
    const { controller } = await import('/src/main.ts')
    controller.equip('seed')
    controller.equip('seed')
  })
  await page.waitForTimeout(180)
  expect((await inspect(page)).frames).toBe(seed.frames)
  await page.getByRole('button', { name: 'Unequip Seed badge', exact: true }).click()
  await settled(page, 0)
  expect((await inspect(page)).geometry).toEqual(original.geometry)
  expect((await inspect(page)).badgeVisible).toBe(false)
})

test('reduced motion snaps GPU geometry initially and when preference changes mid-morph', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await ready(page)
  await page.getByRole('button').click()
  await settled(page, 1)
  expect((await inspect(page)).reduced).toBe(true)
  const seed = await inspect(page)
  await page.waitForTimeout(120)
  expect((await inspect(page)).frames).toBe(seed.frames)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(async () => (await inspect(page)).reduced).toBe(false)
  await page.getByRole('button').click()
  await expect.poll(async () => (await inspect(page)).amount).toBeLessThan(1)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await settled(page, 0)
  expect((await inspect(page)).transitioning).toBe(false)
})

test('offscreen, document visibility, resize and teardown stop stale work', async ({ page }) => {
  await ready(page)
  await page.locator('#viewport').evaluate(element => { element.style.visibility = 'hidden'; element.style.transform = 'translateY(3000px)' })
  await expect.poll(async () => (await inspect(page)).offscreen).toBe(true)
  const frames = (await inspect(page)).frames
  await page.getByRole('button').click()
  expect((await inspect(page)).amount).toBe(1)
  await page.waitForTimeout(100)
  expect((await inspect(page)).frames).toBe(frames)
  await page.locator('#viewport').evaluate(element => { element.style.visibility = ''; element.style.transform = '' })
  await expect.poll(async () => (await inspect(page)).frames).toBeGreaterThan(frames)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const hiddenFrames = (await inspect(page)).frames
  await page.getByRole('button').click()
  await page.waitForTimeout(100)
  expect((await inspect(page)).amount).toBe(0)
  expect((await inspect(page)).frames).toBe(hiddenFrames)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.setViewportSize({ width: 720, height: 900 })
  await expect.poll(async () => (await inspect(page)).frames).toBeGreaterThan(hiddenFrames)
  await page.evaluate(async () => (await import('/src/main.ts')).controller.dispose())
  expect((await inspect(page)).disposed).toBe(true)
  expect((await inspect(page)).pendingFrame).toBe(false)
  await expect(page.locator('canvas')).toHaveCount(0)
})

test('context loss shows honest illustrated controls and restores the selected form', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const gl = document.querySelector('canvas')!.getContext('webgl2')!
    ;(window as any).testContextExtension = gl.getExtension('WEBGL_lose_context')
    ;(window as any).testContextExtension.loseContext()
  })
  await expect(page.locator('#stage')).toHaveAttribute('data-renderer', 'lost')
  await expect(page.locator('.fallback.original')).toBeVisible()
  await page.getByRole('button').click()
  await expect(page.locator('.fallback.seed')).toBeVisible()
  await expect(page.locator('#render-message')).toContainText('3D was interrupted')
  await page.waitForTimeout(150)
  await page.evaluate(() => (window as any).testContextExtension.restoreContext())
  await expect(page.locator('#stage')).toHaveAttribute('data-renderer', 'ready')
  await settled(page, 1)
  expect((await inspect(page)).badgeVisible).toBe(true)
})

test('WebGL unavailable and JavaScript unavailable preserve static content', async ({ page, browser }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: any[]) {
      if (kind.includes('webgl')) return null
      return original.call(this, kind, ...args)
    } as typeof original
  })
  await page.goto('/')
  await expect(page.locator('#stage')).toHaveAttribute('data-renderer', 'unavailable')
  await expect(page.locator('.fallback.original')).toBeVisible()
  await page.getByRole('button').click()
  await expect(page.locator('.fallback.seed')).toBeVisible()
  await expect(page.locator('#form-name')).toHaveText('Leaf-wisp')
  await expect(page.locator('#render-message')).toContainText('3D is unavailable')
  const context = await browser.newContext({ javaScriptEnabled: false })
  const staticPage = await context.newPage()
  await staticPage.goto('http://127.0.0.1:4178/')
  await expect(staticPage.locator('.fallback.original')).toBeVisible()
  await expect(staticPage.getByRole('button')).toBeDisabled()
  await context.close()
})

test('desktop and mobile candidate evidence, touch, accessibility and local-only requests', async ({ browser }, testInfo) => {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: name === 'mobile' })
    const page = await context.newPage()
    const failures: string[] = []
    page.on('pageerror', error => failures.push(error.message))
    page.on('console', message => { if (message.type() === 'error') failures.push(message.text()) })
    page.on('requestfailed', request => failures.push(request.url()))
    page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`) })
    page.on('request', request => {
      if (!request.url().startsWith('http://127.0.0.1:4178/') && !request.url().startsWith('ws://127.0.0.1:4178/')) failures.push(request.url())
    })
    await ready(page)
    await settled(page, 0)
    await page.screenshot({ path: testInfo.outputPath(`${name}-original-candidate.png`), fullPage: true })
    const button = page.getByRole('button')
    if (name === 'mobile') await button.tap()
    else await button.click()
    await settled(page, 1)
    await page.screenshot({ path: testInfo.outputPath(`${name}-seed-candidate.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const audit = await new AxeBuilder({ page }).analyze()
    expect(audit.violations).toEqual([])
    await page.setViewportSize({ width: 320, height: 720 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(failures).toEqual([])
    await context.close()
  }
})
