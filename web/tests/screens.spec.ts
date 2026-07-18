import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const LIVE_AGENT = '0x939ABdD89fE9C5aAC54615f56c50901acf5E6918'
const DEMO_AGENT = '0xb2e8d1a7c93f45602d8b1e6a4f70c9d3e2517a80' // Sentin (demo)

test.beforeAll(() => mkdirSync('screenshots', { recursive: true }))

async function withTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('agentscore-theme', t as string), theme)
}

test('home — dark theme', async ({ page }) => {
  await withTheme(page, 'dark')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('text=Featured agents')
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(10, 10, 11)')
  await page.screenshot({ path: 'screenshots/home-dark.png', fullPage: true })
})

test('home — light theme', async ({ page }) => {
  await withTheme(page, 'light')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('text=Featured agents')
  // #F7F6F2
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(247, 246, 242)')
  await page.getByText(/jobs on the reference contract/).waitFor()
  await page.waitForFunction(() => /\d/.test(document.querySelector('.tabular')?.textContent ?? ''))
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'screenshots/home-light.png', fullPage: true })
})

test('theme toggle flips and persists', async ({ page }) => {
  await withTheme(page, 'dark')
  await page.goto('/')
  await page.waitForSelector('text=Featured agents')
  await page.getByRole('button', { name: /switch to light mode/i }).click()
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(247, 246, 242)')
  expect(await page.evaluate(() => localStorage.getItem('agentscore-theme'))).toBe('light')
})

test('hire flow — live agent shows escrow preview', async ({ page }) => {
  await withTheme(page, 'dark')
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto(`/hire/${LIVE_AGENT}`)
  await page.waitForSelector('text=Escrow summary', { timeout: 20_000 })
  await expect(page.getByText('Connect wallet to hire')).toBeVisible()
  await expect(page.getByText(/Approval is for this exact amount only/)).toBeVisible()
  // Wait for the on-chain fee reads to resolve (0% currently), not skeletons.
  await page.getByText(/0%/).first().waitFor({ timeout: 15_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'screenshots/hire-flow.png', fullPage: true })
})

test('hire flow — demo agent is gated, not a broken flow', async ({ page }) => {
  await page.goto(`/hire/${DEMO_AGENT}`)
  await expect(page.getByText(/not yet registered onchain/i)).toBeVisible()
})
