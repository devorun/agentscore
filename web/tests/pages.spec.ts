import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const LIVE_AGENT = '0x939ABdD89fE9C5aAC54615f56c50901acf5E6918'
const REAL_ADDR = '0x61f13440e56d155c69557344432933a70bc0a7b0'

const PAGES = [
  { name: 'home', path: '/', settle: 'text=Featured agents' },
  { name: 'marketplace', path: '/marketplace', settle: 'text=Live onchain activity' },
  { name: 'dashboard', path: '/dashboard', settle: 'text=My dashboard' },
  { name: 'arbiter', path: '/arbiter', settle: 'text=Scoring methodology' },
  { name: 'job-detail', path: '/job/D-01', settle: "text=Agent’s Mind" },
  { name: 'hire', path: `/hire/${LIVE_AGENT}`, settle: 'text=Escrow summary' },
  { name: 'agent-profile', path: `/agent/${REAL_ADDR}`, settle: 'text=Agent record' },
]

test.beforeAll(() => mkdirSync('screenshots', { recursive: true }))

function isNetNoise(t: string) {
  return /Failed to load resource/i.test(t) && /(429|rate|50\d)/i.test(t)
}
function collect(page: Page): string[] {
  const errs: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !isNetNoise(m.text())) errs.push(m.text())
  })
  page.on('pageerror', (e) => errs.push(`UNCAUGHT: ${e.message}`))
  return errs
}

async function assertNoDeadControls(page: Page) {
  for (const a of await page.locator('a:visible').all()) {
    const href = await a.getAttribute('href')
    expect(href, 'anchor missing href').toBeTruthy()
    expect(href).not.toBe('#')
  }
  for (const b of await page.locator('button:visible').all()) {
    await expect(b).toBeEnabled()
  }
}

for (const p of PAGES) {
  test(`${p.name}: shell, non-empty main, no dead controls, no app errors`, async ({ page }) => {
    const errors = collect(page)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(p.path)
    await page.waitForSelector(p.settle, { timeout: 25_000 })

    await expect(page.locator('header').first()).toBeVisible()
    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('footer')).toBeVisible()
    expect((await page.locator('main').innerText()).trim().length).toBeGreaterThan(0)

    await assertNoDeadControls(page)
    await page.waitForTimeout(400)
    expect(errors, 'no app console errors').toEqual([])
  })
}

test('nav links all route', async ({ page }) => {
  await page.goto('/')
  for (const [label, re] of [
    ['Marketplace', /\/marketplace/],
    ['Dashboard', /\/dashboard/],
    ['Arbiter', /\/arbiter/],
    ['Showcase', /\/$/],
  ] as const) {
    await page.getByRole('link', { name: label, exact: true }).first().click()
    await expect(page).toHaveURL(re)
  }
})

test('marketplace filters work and job links route', async ({ page }) => {
  await page.goto('/marketplace')
  await page.getByRole('button', { name: 'Audit', exact: true }).click()
  await expect(page.getByText('Subcontracted audit: ERC-8183 hook path')).toBeVisible()
  await page.getByRole('button', { name: 'All', exact: true }).first().click()
  await page.getByRole('link', { name: 'View job' }).first().click()
  await expect(page).toHaveURL(/\/job\//)
})

test('arbiter copy button works', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/arbiter')
  await page.getByRole('button', { name: /copy/i }).click()
  await expect(page.getByRole('button', { name: /copied/i })).toBeVisible()
})

test('screenshots — every page (dark, product default)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('agentscore-theme', 'dark'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const p of PAGES) {
    await page.goto(p.path)
    await page.waitForSelector(p.settle, { timeout: 25_000 }).catch(() => {})
    await page.waitForLoadState('networkidle').catch(() => {})
    // Let the Agent's Mind terminal play the full loop through settlement.
    await page.waitForTimeout(p.name === 'job-detail' ? 10_500 : 1200)
    await page.screenshot({ path: `screenshots/page-${p.name}.png`, fullPage: true })
  }
})
