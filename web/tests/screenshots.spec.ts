import { test } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const KNOWN_AGENT = '0x61f13440e56d155c69557344432933a70bc0a7b0'
const OUT = 'screenshots'

const VIEWPORTS = [
  { tag: 'desktop', width: 1440, height: 900 },
  { tag: 'mobile', width: 375, height: 812 },
]

const PAGES = [
  { name: 'home', path: '/', settle: '.how-card' },
  { name: 'agent-profile', path: `/agent/${KNOWN_AGENT}`, settle: '.score-block, .status-message' },
  { name: 'not-found', path: '/no-such-page', settle: '.site-footer' },
]

test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

for (const vp of VIEWPORTS) {
  for (const p of PAGES) {
    test(`screenshot ${p.name} @ ${vp.tag}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(p.path)
      await page.waitForSelector(p.settle, { timeout: 30_000 }).catch(() => {})
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${OUT}/${p.name}-${vp.tag}.png`, fullPage: true })
    })
  }
}
