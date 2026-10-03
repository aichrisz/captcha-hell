import assert from 'node:assert/strict'

const playwrightModule = process.env.PLAYWRIGHT_MODULE
const baseURL = process.env.BASE_URL
assert.ok(playwrightModule, 'Set PLAYWRIGHT_MODULE to an installed Playwright module path.')
assert.ok(baseURL, 'Set BASE_URL to the running app URL, including its base path.')

const { chromium } = await import(playwrightModule)
const browser = await chromium.launch({ headless: true })
const pageErrors = []
const pages = new Set()
const failures = []
const expectedFake = 'Fake green flash - decoy. Do not click.'
const expectedGap = 'Fake flash ended. Verification is not open.'
const expectedOpen = 'Verification window open. Click VERIFY now.'
const expectedClosed = 'Verification window closed.'
const expectedWaiting = 'Waiting for the verification signal.'
const debugURL = () => {
  const url = new URL(baseURL)
  url.searchParams.set('debug', '1')
  return url.toString()
}

async function openRun({ width = 390, mobile = false, pauseClockAtPuzzle = false } = {}) {
  const page = await browser.newPage({
    viewport: { width, height: 844 },
    reducedMotion: 'reduce',
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  })
  pages.add(page)
  page.setDefaultTimeout(1500)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text())
  })
  await page.clock.install()
  await page.goto(debugURL())
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  for (let round = 1; round < 4; round += 1) {
    if (pauseClockAtPuzzle && round === 3) {
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
    }
    await page.getByRole('button', { name: 'Next round', exact: true }).click()
  }
  await page.locator('.verify').waitFor({ state: 'visible' })
  return page
}

async function closePage(page) {
  pages.delete(page)
  await page.close()
}

async function withRun(options, run) {
  const page = await openRun(options)
  try {
    await run(page)
  } finally {
    await closePage(page)
  }
}

async function expectRound(page, round, strikes) {
  const rows = await page.locator('.hud .stat').evaluateAll((elements) =>
    elements.map((element) => element.innerText.split('\n').map((part) => part.trim())),
  )
  const hud = Object.fromEntries(rows.map(([label, value]) => [label.toLowerCase(), value]))
  assert.equal(hud.round, `${round}/10`, `round HUD: ${JSON.stringify(hud)}`)
  assert.equal(hud.strikes, String(strikes), `strike HUD: ${JSON.stringify(hud)}`)
}

async function scenario(name, run) {
  try {
    await run()
    console.log(`PASS: ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.error(`FAIL: ${name}: ${error.message}`)
  }
}

async function activate(page, method = 'pointer') {
  const button = page.locator('.verify')
  if (method === 'keyboard') {
    await button.focus()
    await button.press('Enter')
  } else if (method === 'touch') {
    await button.tap()
  } else {
    await button.click()
  }
}

try {
  await scenario('pre-open click at 1000ms uses earlyClick and retries round 4', async () => {
    await withRun({}, async (page) => {
      await page.clock.runFor(1000)
      await activate(page)
      await expectRound(page, 4, 1)
    })
  })

  await scenario('fake green flash is textually identified and bounded by configured timing', async () => {
    await withRun({}, async (page) => {
      await page.clock.runFor(1700)
      assert.equal(await page.locator('.timed-click-status').count(), 1, 'timed-click has a textual phase status')
      assert.equal(await page.locator('.timed-click-status').innerText(), expectedFake)
      await page.clock.runFor(350)
      assert.equal(await page.locator('.timed-click-status').innerText(), expectedGap)
    })
  })

  await scenario('click during fakeout at 1800ms is rejected as early, not passed', async () => {
    await withRun({}, async (page) => {
      await page.clock.runFor(1800)
      await activate(page)
      await expectRound(page, 4, 1)
    })
  })

  await scenario('legacy-ready click at 2500ms remains early before the real window', async () => {
    await withRun({}, async (page) => {
      await page.clock.runFor(2500)
      await activate(page)
      await expectRound(page, 4, 1)
    })
  })

  await scenario('real window opens inclusively at 3450ms', async () => {
    await withRun({ pauseClockAtPuzzle: true }, async (page) => {
      await page.clock.fastForward(3450)
      assert.equal(await page.locator('.timed-click-status').count(), 1, 'timed-click has a textual phase status')
      assert.equal(await page.locator('.timed-click-status').innerText(), expectedOpen)
      await activate(page)
      await expectRound(page, 5, 0)
    })
  })

  await scenario('real window closes inclusively at 4650ms', async () => {
    await withRun({ pauseClockAtPuzzle: true }, async (page) => {
      await page.clock.fastForward(4650)
      assert.equal(await page.locator('.timed-click-status').count(), 1, 'timed-click has a textual phase status')
      assert.equal(await page.locator('.timed-click-status').innerText(), expectedClosed)
      await page.locator('.verify').dispatchEvent('click')
      await expectRound(page, 5, 0)
    })
  })

  await scenario('post-window click at 6000ms uses wrongSubmit and retries round 4', async () => {
    await withRun({}, async (page) => {
      await page.clock.runFor(6000)
      await page.locator('.verify').dispatchEvent('click')
      await expectRound(page, 4, 1)
    })
  })

  await scenario('retry starts a fresh fakeout, gap, and real window schedule', async () => {
    await withRun({}, async (page) => {
      await page.clock.runFor(1000)
      await activate(page)
      await expectRound(page, 4, 1)
      await page.clock.runFor(1000)
      assert.equal(await page.locator('.timed-click-status').innerText(), expectedWaiting, 'stale phase timers from the prior attempt were cleared')
      await page.clock.runFor(600)
      assert.equal(await page.locator('.timed-click-status').count(), 1, 'timed-click has a textual phase status')
      assert.equal(await page.locator('.timed-click-status').innerText(), expectedFake)
      await page.clock.runFor(450)
      assert.equal(await page.locator('.timed-click-status').innerText(), expectedGap)
      await page.clock.runFor(1400)
      assert.equal(await page.locator('.timed-click-status').innerText(), expectedOpen)
    })
  })

  for (const width of [320, 390]) {
    for (const activation of ['pointer', 'touch', 'keyboard']) {
      await scenario(`${activation} valid activation and no overflow at ${width}px`, async () => {
        await withRun({ width, mobile: activation === 'touch' }, async (page) => {
          await page.clock.runFor(4000)
          assert.equal(await page.locator('.verify').evaluate((button) => getComputedStyle(button).animationName), 'none', 'reduced motion suppresses the VERIFY pulse')
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `round 4 horizontal overflow at ${width}px`)
          assert.ok((await page.locator('.verify').boundingBox()).height >= 44, 'VERIFY meets 44px touch target')
          await activate(page, activation)
          await expectRound(page, 5, 0)
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `horizontal overflow at ${width}px`)
        })
      })
    }
  }

  assert.deepEqual(pageErrors, [], `browser JavaScript errors: ${pageErrors.join('; ')}`)
  if (failures.length) {
    console.error(`RED: ${failures.length} timed-click regression scenario(s) failed.`)
    process.exitCode = 1
  } else {
    console.log('PASS: no browser JavaScript errors.')
    console.log('GREEN: all timed-click browser regression scenarios passed.')
  }
} finally {
  await Promise.all([...pages].map((page) => page.close()))
  await browser.close()
}
