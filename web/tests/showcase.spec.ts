import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

test.beforeAll(() => mkdirSync('screenshots', { recursive: true }))

function isExternalNetworkNoise(text: string): boolean {
  return /Failed to load resource/i.test(text) && /(429|rate|503|502|504)/i.test(text)
}

function collectAppErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !isExternalNetworkNoise(m.text())) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`UNCAUGHT: ${e.message}`))
  return errors
}

test('home showcase: Inter loads, theme is dark, desktop screenshot', async ({ page }) => {
  const errors = collectAppErrors(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('text=Featured agents', { timeout: 20_000 })
  await page.waitForLoadState('networkidle').catch(() => {})

  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const interLoaded = await page.evaluate(() => document.fonts.check('600 16px Inter'))

  console.log('BODY font-family :', bodyFont)
  console.log('BODY background  :', bg)
  console.log('Inter available  :', interLoaded)

  expect(bodyFont.toLowerCase()).toContain('inter')
  expect(interLoaded).toBe(true)
  expect(bg).toBe('rgb(10, 10, 11)') // #0A0A0B

  // Six agent cards, full nav, hire controls all present.
  await expect(page.getByRole('button', { name: 'Hire' })).toHaveCount(6)
  for (const label of ['Showcase', 'Marketplace', 'Dashboard', 'Arbiter']) {
    await expect(page.getByRole('link', { name: label }).first()).toBeVisible()
  }
  await expect(page.locator('main')).not.toBeEmpty()
  expect(errors, 'no app console errors').toEqual([])

  await page.screenshot({ path: 'screenshots/showcase-home-desktop.png', fullPage: true })
})

test('lookup routes a valid address to the agent profile', async ({ page }) => {
  await page.goto('/')
  await page.fill('input[aria-label="Agent address"]', '0x61f13440e56d155c69557344432933a70bc0a7b0')
  await page.getByRole('button', { name: 'Look up' }).click()
  await expect(page).toHaveURL(/\/agent\/0x/i)
})
