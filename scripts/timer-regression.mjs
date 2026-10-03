import assert from 'node:assert/strict'

const playwrightModule = process.env.PLAYWRIGHT_MODULE
const baseURL = process.env.BASE_URL
assert.ok(playwrightModule, 'Set PLAYWRIGHT_MODULE to an installed Playwright module path.')
assert.ok(baseURL, 'Set BASE_URL to the running app URL, including its base path.')

const { chromium } = await import(playwrightModule)
const browser = await chromium.launch({ headless: true })
const pageErrors = []
const pages = new Set()
const durationFor = (round) => round >= 4 && round <= 6 ? 15 : 20
const debugURL = () => {
  const url = new URL(baseURL)
  url.searchParams.set('debug', '1')
  return url.toString()
}

async function readHud(page) {
  const rows = await page.locator('.hud .stat').evaluateAll((elements) =>
    elements.map((element) => element.innerText.split('\n').map((part) => part.trim())),
  )
  return Object.fromEntries(rows.map(([label, value]) => [label.toLowerCase(), value]))
}

async function assertHud(page, round, timer, strikes) {
  const hud = await readHud(page)
  assert.equal(hud.round, `${round}/10`, `round HUD: ${JSON.stringify(hud)}`)
  assert.equal(hud.timer, timer, `timer HUD at round ${round}: ${JSON.stringify(hud)}`)
  assert.equal(hud.strikes, String(strikes), `strike HUD: ${JSON.stringify(hud)}`)
}

async function openRun(round = 1) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  pages.add(page)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.clock.install()
  await page.goto(debugURL())
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  for (let current = 1; current < round; current += 1) {
    await page.getByRole('button', { name: 'Next round', exact: true }).click()
  }
  const timer = round === 10 ? 'final' : `${durationFor(round)}s`
  await assertHud(page, round, timer, 0)
  return page
}

async function closePage(page) {
  pages.delete(page)
  await page.close()
}

try {
  {
    const page = await openRun()
    await page.clock.runFor(20_000)
    await assertHud(page, 1, '20s', 1)
    await page.clock.runFor(20_000)
    await assertHud(page, 1, '20s', 2)
    await page.clock.runFor(20_000)
    assert.match(await page.locator('.result').innerText(), /Strikes\s+3\/3/)
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await assertHud(page, 1, '20s', 0)
    await closePage(page)
    console.log('PASS: three one-strike timer expiries exhaust retries; restart restores round 1.')
  }

  for (let round = 1; round <= 9; round += 1) {
    const page = await openRun(round)
    await page.clock.runFor(durationFor(round) * 1000)
    if (round <= 6) {
      await assertHud(page, round, `${durationFor(round)}s`, 1)
    } else {
      const nextRound = round + 1
      await assertHud(page, nextRound, nextRound === 10 ? 'final' : `${durationFor(nextRound)}s`, 1)
    }
    await closePage(page)
  }
  console.log('PASS: expiry lifecycle covered for every timed round 1-9; round 7 advances only to 8.')

  {
    const page = await openRun(1)
    for (let second = 0; second < 19; second += 1) await page.clock.runFor(1_000)
    await assertHud(page, 1, '1s', 0)
    await page.locator('.cell').nth(1).click()
    await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
    await assertHud(page, 1, '20s', 1)
    assert.equal(await page.locator('.cell').nth(1).getAttribute('aria-pressed'), 'true', 'retry retains puzzle selection')
    await page.locator('.cell').nth(1).click()
    for (const index of [0, 4, 7]) await page.locator('.cell').nth(index).click()
    await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
    await assertHud(page, 2, '20s', 1)
    await page.clock.runFor(3_000)
    await assertHud(page, 2, '17s', 1)
    await page.getByRole('button', { name: 'Sound on', exact: true }).click()
    await assertHud(page, 2, '17s', 1)
    const appeal = page.getByRole('button', { name: 'Appeal verdict', exact: true })
    assert.equal(await appeal.isEnabled(), true, 'appeal is available after score and retry suspicion')
    await appeal.click()
    await assertHud(page, 2, '17s', 1)
    await page.clock.runFor(1_000)
    await assertHud(page, 2, '16s', 1)
    await closePage(page)
    console.log('PASS: pre-expiry submission, retained puzzle state, sound and appeal renders preserve the active timer.')
  }

  {
    const page = await openRun(1)
    await page.clock.runFor(20_000)
    await assertHud(page, 1, '20s', 1)
    await page.locator('.cell').nth(1).click()
    await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
    await assertHud(page, 1, '20s', 2)
    await closePage(page)
    console.log('PASS: submission immediately after the expiry boundary adds only its own single penalty.')
  }

  {
    const page = await openRun(10)
    await page.clock.runFor(60_000)
    await assertHud(page, 10, 'final', 0)
    assert.equal(await page.locator('.final-box').count(), 1)
    await closePage(page)
    console.log('PASS: final round remains untimed.')
  }

  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join('; ')}`)
  console.log('PASS: no browser page errors.')
} finally {
  await Promise.all([...pages].map((page) => page.close()))
  await browser.close()
}
