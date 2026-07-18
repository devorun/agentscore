import { test } from '@playwright/test'
import { mkdirSync } from 'node:fs'

test.beforeAll(() => mkdirSync('screenshots', { recursive: true }))

async function shot(page: import('@playwright/test').Page, jobId: string, name: string) {
  await page.addInitScript(() => localStorage.setItem('agentscore-theme', 'dark'))
  await page.setViewportSize({ width: 1440, height: 1300 })
  await page.goto(`/job/${jobId}`)
  await page.waitForSelector('text=Deliverable — real work product', { timeout: 25_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true })
}

test('job 158648 — verified deliverable settles', async ({ page }) => {
  await shot(page, '158648', 'job-158648-verified')
})

test('job 158649 — tampered deliverable rejected', async ({ page }) => {
  await shot(page, '158649', 'job-158649-rejected')
})
