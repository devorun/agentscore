import { test, expect, type Page } from '@playwright/test'

// A real address with onchain provider history on the reference contract.
const KNOWN_AGENT = '0x61f13440e56d155c69557344432933a70bc0a7b0'

const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'agent profile', path: `/agent/${KNOWN_AGENT}` },
  { name: 'not found', path: '/no-such-page' },
]

// Browser-level "Failed to load resource" logs are emitted for any 4xx/5xx HTTP
// response (e.g. the public RPC returning 429 under load). The app handles those
// with retry/backoff, so they are not app defects — we surface them but do not
// fail on them. Any other console error, and every uncaught exception, fails.
function isExternalNetworkNoise(text: string): boolean {
  return /Failed to load resource/i.test(text) && /(429|rate|503|502|504)/i.test(text)
}

interface Collected {
  appErrors: string[]
  networkNoise: string[]
}

function collectErrors(page: Page): Collected {
  const c: Collected = { appErrors: [], networkNoise: [] }
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (isExternalNetworkNoise(text)) c.networkNoise.push(text)
    else c.appErrors.push(text)
  })
  page.on('pageerror', (err) => c.appErrors.push(`UNCAUGHT: ${err.message}`))
  return c
}

for (const route of ROUTES) {
  test(`${route.name}: full shell, non-empty main, no app console errors`, async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto(route.path)

    // Full-width app shell: header, main, footer all present.
    await expect(page.locator('.site-header')).toBeVisible()
    await expect(page.locator('main.site-main')).toBeVisible()
    await expect(page.locator('.site-footer')).toBeVisible()

    // Main region is never empty.
    const mainText = (await page.locator('main.site-main').innerText()).trim()
    expect(mainText.length, 'main region must not be empty').toBeGreaterThan(0)

    // Shell spans the full viewport width (not a centered template box).
    const mainBox = await page.locator('.site-header').boundingBox()
    const viewport = page.viewportSize()!
    expect(mainBox!.width).toBeGreaterThan(viewport.width * 0.9)

    await page.waitForTimeout(500)
    if (errors.networkNoise.length) console.log(`  (external RPC noise on ${route.name}: ${errors.networkNoise.length})`)
    expect(errors.appErrors, 'no app console errors / uncaught exceptions').toEqual([])
  })
}

test('no dead links: every anchor has a real href', async ({ page }) => {
  await page.goto('/')
  const anchors = await page.locator('a').all()
  for (const a of anchors) {
    const href = await a.getAttribute('href')
    expect(href, 'every <a> must have a non-empty href').toBeTruthy()
    expect(href).not.toBe('#')
  }
})

test('every visible button is enabled and actionable', async ({ page }) => {
  await page.goto('/')
  const buttons = await page.locator('button:visible').all()
  expect(buttons.length).toBeGreaterThan(0)
  for (const b of buttons) {
    await expect(b).toBeEnabled()
  }
})

test('lookup: valid address navigates to the agent profile', async ({ page }) => {
  await page.goto('/')
  await page.fill('#agent-lookup', KNOWN_AGENT)
  await page.getByRole('button', { name: 'Look up an agent' }).click()
  await expect(page).toHaveURL(/\/agent\/0x/i)
  await expect(page.locator('.agent-address')).toBeVisible()
})

test('lookup: invalid address shows an error and does not navigate', async ({ page }) => {
  await page.goto('/')
  await page.fill('#agent-lookup', 'not-an-address')
  await page.getByRole('button', { name: 'Look up an agent' }).click()
  await expect(page.locator('.lookup-error')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})

test('primary control: "How scoring works" reveals the how-it-works section', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'How scoring works' }).click()
  await expect(page).toHaveURL(/#how-it-works/)
  await expect(page.locator('#how-it-works')).toBeVisible()
})

test('agent profile resolves to a real state, never a blank/stuck screen', async ({ page }) => {
  await page.goto(`/agent/${KNOWN_AGENT}`)
  // Either indexed data (score block) or an explicit error state — but not empty.
  await expect(page.locator('.score-block, .status-message').first()).toBeVisible({ timeout: 30_000 })
})

test('invalid agent address shows the invalid state, not a crash', async ({ page }) => {
  await page.goto('/agent/0xnotvalid')
  await expect(page.getByText('Invalid agent address')).toBeVisible()
})

test('wallet control renders in the header', async ({ page }) => {
  await page.goto('/')
  // No injected wallet in headless Chromium, so the control is the install link.
  const wallet = page.locator('.header-actions a, .header-actions button').first()
  await expect(wallet).toBeVisible()
})
