import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const playwrightModule = process.env.PLAYWRIGHT_MODULE
const baseURL = process.env.BASE_URL
assert.ok(playwrightModule, 'Set PLAYWRIGHT_MODULE to an installed Playwright module path.')
assert.ok(baseURL, 'Set BASE_URL to the running app URL, including its base path.')

const { chromium } = await import(playwrightModule)
const browser = await chromium.launch({ headless: true })
const evidenceDir = process.env.EVIDENCE_DIR ?? '/root/.hermes/cache/scratch/captcha-mobile-upgrade'
const screenshotsDir = path.join(evidenceDir, 'screenshots')
await mkdir(screenshotsDir, { recursive: true })
const pageErrors = []
const pages = new Set()
const metrics = []
const failures = []
const viewports = [
  { width: 320, height: 740, name: '320x740' },
  { width: 390, height: 844, name: '390x844' },
  { width: 412, height: 915, name: '412x915' },
  { width: 915, height: 412, name: '915x412' },
  { width: 1440, height: 1000, name: '1440x1000' },
]
const endingChoices = [
  ['I am human', 'VERIFIED: HUMAN'],
  ['I am trying', 'STATUS: PROBABLY HUMAN'],
  ['Does it matter', 'GHOST IN THE FORM'],
]
const endings = [
  'VERIFIED: HUMAN',
  'STATUS: PROBABLY HUMAN',
  'GHOST IN THE FORM',
  'APPLICATION REJECTED',
  'ACCOUNT FLAGGED',
  'ANOMALY: TOO PERFECT',
]
const debugURL = () => {
  const url = new URL(baseURL)
  url.searchParams.set('debug', '1')
  return url.toString()
}

async function openPage({ viewport, mode = 'full', clock = false, mobile = false } = {}) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  })
  pages.add(page)
  page.setDefaultTimeout(4000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text())
  })
  if (clock) await page.clock.install()
  await page.goto(debugURL())
  return page
}

async function begin(page) {
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
}

async function dismissPopups(page) {
  while (await page.locator('.popup button').count()) await page.locator('.popup button').first().click()
}

async function goToRound(page, round) {
  await begin(page)
  for (let current = 1; current < round; current += 1) {
    await page.getByRole('button', { name: 'Next round', exact: true }).dispatchEvent('click')
  }
  assert.equal(await page.locator('.hud .stat').nth(4).innerText(), `ROUND\n${round}/10`)
}

async function closePage(page) {
  pages.delete(page)
  await page.close()
}

async function scenario(name, run) {
  try {
    await run()
    console.log(`PASS: ${name}`)
  } catch (error) {
    failures.push({ name, error: error.message })
    console.error(`FAIL: ${name}: ${error.message}`)
  }
}

async function viewportMetrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const r = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        x: r.x, y: r.y, width: r.width, height: r.height,
        right: r.right, bottom: r.bottom,
        position: style.position,
        fontSize: style.fontSize,
      }
    }
    const viewport = window.visualViewport
    return {
      requestedWidth: window.__requestedWidth ?? document.documentElement.clientWidth,
      requestedHeight: window.__requestedHeight ?? window.innerHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      visualViewportWidth: viewport?.width ?? null,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      hud: rect('.hud'),
      timer: rect('.hud .stat:nth-of-type(6)'),
      widget: rect('.widget'),
      title: rect('.widget h1'),
      prompt: rect('.widget h2'),
      grid: rect('.grid'),
      verify: rect('.wide'),
      appeal: rect('.appeal'),
      terms: rect('.terms'),
      timedStatus: rect('.timed-click-status'),
      timedButton: rect('.verify'),
      popupLayer: rect('.popup-layer'),
      endingTitle: rect('.ending h1'),
    }
  })
}

async function capture(page, name, metadata = {}) {
  await page.evaluate((width) => { window.__requestedWidth = width }, page.viewportSize().width)
  const data = { name, viewport: page.viewportSize(), ...metadata, ...(await viewportMetrics(page)) }
  metrics.push(data)
  const debug = page.locator('.debug')
  const debugCount = await debug.count()
  const previousVisibility = debugCount ? await debug.evaluate((element) => element.style.visibility) : ''
  if (debugCount) await debug.evaluate((element) => { element.style.visibility = 'hidden' })
  try {
    await page.screenshot({ path: path.join(screenshotsDir, `${name}.png`), fullPage: true })
  } finally {
    if (debugCount) await debug.evaluate((element, visibility) => { element.style.visibility = visibility }, previousVisibility)
  }
  return data
}

async function assertRequestedWidth(page, label) {
  const requested = page.viewportSize().width
  const result = await page.evaluate((width) => ({
    width,
    client: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    htmlRight: document.documentElement.getBoundingClientRect().right,
    offenders: [...document.querySelectorAll('body *')].map((element) => {
      const r = element.getBoundingClientRect()
      return { tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', text: element.innerText?.slice(0, 48), x: r.x, right: r.right, width: r.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
    }).filter((element) => element.right > width + 1 || element.scrollWidth > element.clientWidth + 1).slice(0, 8),
  }), requested)
  assert.ok(result.document <= requested + 1, `${label}: document scrollWidth ${result.document} exceeds requested ${requested}px (clientWidth ${result.client}; offenders ${JSON.stringify(result.offenders)})`)
  assert.ok(result.client <= requested + 1, `${label}: clientWidth ${result.client} exceeds requested ${requested}px`)
  assert.ok(result.body <= requested + 1, `${label}: body scrollWidth ${result.body} exceeds requested ${requested}px`)
  assert.ok(result.htmlRight <= requested + 1, `${label}: root right edge ${result.htmlRight} exceeds requested ${requested}px`)
}

async function assertTimerVisible(page, label) {
  const box = await page.locator('.hud .stat').nth(5).boundingBox()
  assert.ok(box && box.y >= -1 && box.y + box.height <= page.viewportSize().height + 1, `${label}: timer is not visible: ${JSON.stringify(box)}`)
}

async function assertControlVisible(page, selector, label) {
  const box = await page.locator(selector).boundingBox()
  const hud = await page.locator('.hud').boundingBox()
  assert.ok(box && hud && box.y >= hud.y + hud.height - 1 && box.y + box.height <= page.viewportSize().height + 1, `${label}: control is obscured or offscreen: ${JSON.stringify({ box, hud, scrollY: await page.evaluate(() => window.scrollY) })}`)
  return box
}

async function assertControlTargets(page, label, selector = '.widget button:not(:disabled), .widget input') {
  const boxes = await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const r = element.getBoundingClientRect()
    return { text: element.innerText || element.getAttribute('aria-label') || element.tagName, width: r.width, height: r.height }
  }))
  for (const box of boxes) {
    assert.ok(box.width >= 44 && box.height >= 44, `${label}: active target below 44px: ${JSON.stringify(box)}`)
  }
}

async function assertCheckboxContained(page, selector, label) {
  const info = await page.locator(selector).evaluate((element) => {
    const r = element.getBoundingClientRect()
    const widget = element.closest('.widget').getBoundingClientRect()
    const style = getComputedStyle(element.closest('.widget'))
    const left = parseFloat(style.paddingLeft)
    const right = parseFloat(style.paddingRight)
    const top = parseFloat(style.paddingTop)
    const bottom = parseFloat(style.paddingBottom)
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const hit = document.elementFromPoint(x, y)
    return {
      rect: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom },
      area: { left: widget.left + left, right: widget.right - right, top: widget.top + top, bottom: widget.bottom - bottom },
      centerHit: Boolean(hit && (hit === element || element.contains(hit))),
      transform: element.style.transform,
      computedTransform: getComputedStyle(element).transform,
    }
  })
  assert.ok(info.rect.x >= info.area.left - 1 && info.rect.right <= info.area.right + 1, `${label}: checkbox escapes padded widget: ${JSON.stringify(info)}`)
  assert.ok(info.rect.y >= info.area.top - 1 && info.rect.bottom <= info.area.bottom + 1, `${label}: checkbox escapes vertical play area: ${JSON.stringify(info)}`)
  assert.equal(info.centerHit, true, `${label}: checkbox center is not hit-testable: ${JSON.stringify(info)}`)
  return info
}

async function reachFinal(page) {
  await page.getByRole('button', { name: 'Next round', exact: true }).click()
  const box = page.locator('.final-box')
  const reduced = await page.locator('.app').evaluate((element) => element.classList.contains('reduce-motion'))
  const attempts = reduced ? 2 : 3
  for (let i = 0; i < attempts; i += 1) await box.click()
  await page.getByRole('button', { name: 'I am human', exact: true }).waitFor()
}

async function makeEnding(page, title) {
  if (title === 'STATUS: PROBABLY HUMAN') {
    await page.getByRole('button', { name: 'Force ending', exact: true }).click()
  } else if (title === 'APPLICATION REJECTED') {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.locator('.cell').nth(1).click()
      await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
    }
  } else if (title === 'ACCOUNT FLAGGED') {
    for (let i = 1; i < 7; i += 1) await page.getByRole('button', { name: 'Next round', exact: true }).dispatchEvent('click')
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Suspicion +30', exact: true }).dispatchEvent('click')
    await dismissPopups(page)
    await page.getByRole('button', { name: 'Optimize response latency', exact: true }).click()
  } else {
    for (let round = 1; round < 10; round += 1) await page.getByRole('button', { name: 'Next round', exact: true }).dispatchEvent('click')
    await dismissPopups(page)
    const box = page.locator('.final-box')
    const reduced = await page.locator('.app').evaluate((element) => element.classList.contains('reduce-motion'))
    for (let i = 0; i < (reduced ? 2 : 3); i += 1) await box.click()
    const choice = endingChoices.find(([, endingTitle]) => endingTitle === title)?.[0]
    if (choice) {
      const button = page.getByRole('button', { name: choice, exact: true })
      if (page.viewportSize().width <= 520) await button.tap()
      else if (page.viewportSize().height <= 520) { await button.focus(); await button.press('Enter') }
      else await button.click()
    }
  }
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
}

async function playPerfectRun(page) {
  for (const i of [0, 4, 7]) await page.locator('.cell').nth(i).click()
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await dismissPopups(page)
  const checkbox = page.locator('.checkbox').first()
  await checkbox.click(); await checkbox.click(); await checkbox.click()
  await dismissPopups(page)
  for (const i of [1, 3, 8]) await page.locator('.cell').nth(i).click()
  await dismissPopups(page)
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await page.clock.runFor(3450)
  await page.locator('.verify').dispatchEvent('click')
  await dismissPopups(page)
  const slider = page.locator('input[type="range"]')
  await slider.focus()
  await slider.press('Home')
  for (let step = 0; step < 62; step += 1) await slider.press('ArrowRight')
  await dismissPopups(page)
  await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
  await dismissPopups(page)
  for (const i of [0, 2, 4, 7]) await page.locator('.cell').nth(i).click()
  await dismissPopups(page)
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await dismissPopups(page)
  await page.getByRole('button', { name: 'Cry at a song from 2009', exact: true }).click()
  await dismissPopups(page)
  await page.getByRole('button', { name: '3', exact: true }).click()
  await dismissPopups(page)
  for (let i = 0; i < 9; i += 1) await page.locator('.cell').nth(i).click()
  await dismissPopups(page)
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await dismissPopups(page)
  const box = page.locator('.final-box')
  await box.click(); await box.click(); await box.click()
  await page.getByRole('button', { name: 'I am human', exact: true }).click()
  await page.getByRole('heading', { name: 'ANOMALY: TOO PERFECT', exact: true }).waitFor()
}

try {
  await scenario('matrix: requested viewport geometry, all ten puzzles, motion modes, targets, and screenshots', async () => {
    const puzzleScreens = new Set([1, 2, 4, 6, 9, 10])
    for (const viewport of viewports) {
      for (const mode of ['full', 'reduced']) {
        const page = await openPage({ viewport, mode, mobile: viewport.width < 600 || viewport.height < 600 })
        await assertControlTargets(page, `${viewport.name} ${mode} start`, '.start button:not(:disabled)')
        await assertRequestedWidth(page, `${viewport.name} ${mode} start`)
        await capture(page, `${viewport.name}-${mode}-start`, { mode, round: 'start' })
        await begin(page)
        for (let round = 1; round <= 10; round += 1) {
          if (round > 1) await page.getByRole('button', { name: 'Next round', exact: true }).click()
          assert.equal(await page.locator('.hud .stat').nth(4).innerText(), `ROUND\n${round}/10`)
          await assertRequestedWidth(page, `${viewport.name} ${mode} round ${round}`)
          await assertControlTargets(page, `${viewport.name} ${mode} round ${round}`)
          await assertTimerVisible(page, `${viewport.name} ${mode} round ${round}`)
          const labels = await page.locator('.hud .stat span').allTextContents()
          assert.deepEqual(labels.map((label) => label.trim().toLowerCase()), ['score', 'suspicion', 'humanity', 'strikes', 'round', 'timer'], `${viewport.name} ${mode}: all HUD values retain readable labels`)
          const soundBox = await page.locator('.hud > button').boundingBox()
          assert.ok(soundBox && soundBox.width >= 44 && soundBox.height >= 44, `${viewport.name} ${mode}: Sound target is below 44px`)
          const columns = await page.locator('.hud').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
          const hud = await page.locator('.hud').boundingBox()
          const expectedMax = viewport.height <= 520 ? 64 : viewport.width <= 520 ? 160 : Infinity
          if (Number.isFinite(expectedMax)) assert.ok(hud && hud.height <= expectedMax + 1, `${viewport.name} ${mode}: HUD ${hud?.height}px exceeds ${expectedMax}px`)
          if (viewport.height <= 520) assert.equal(columns, 7, `${viewport.name} ${mode}: landscape HUD is one seven-value row`)
          else if (viewport.width <= 520) assert.equal(columns, 3, `${viewport.name} ${mode}: portrait HUD uses three columns`)
          if ((viewport.width <= 520 && viewport.height > 520) || viewport.height <= 520) {
            assert.equal(await page.locator('.hud').evaluate((element) => getComputedStyle(element).position), 'sticky', `${viewport.name} ${mode}: compact HUD remains sticky`)
          }
          if (round === 1) {
            const sound = page.locator('.hud > button')
            await sound.focus()
            await page.keyboard.press('Tab')
            const focus = await page.locator('.cell').first().evaluate((element) => ({
              active: document.activeElement === element,
              visible: element.matches(':focus-visible'),
              outlineWidth: parseFloat(getComputedStyle(element).outlineWidth),
              outlineStyle: getComputedStyle(element).outlineStyle,
            }))
            assert.ok(focus.active && focus.visible && focus.outlineWidth >= 2 && focus.outlineStyle !== 'none', `${viewport.name} ${mode}: keyboard focus is visible on a grid target: ${JSON.stringify(focus)}`)
          }
          if (round === 2) {
            const box = page.locator('.checkbox').first()
            const reduced = mode === 'reduced'
            const attempts = reduced ? 1 : 2
            for (let activation = 1; activation <= attempts; activation += 1) {
              await box.click()
              if (viewport.width <= 820 || viewport.height <= 520) {
                await page.waitForTimeout(250)
                await assertCheckboxContained(page, '.checkbox', `${viewport.name} ${mode} checkbox dodge ${activation}`)
                const checkbox = await page.locator('.checkbox').boundingBox()
                const appeal = await page.locator('.appeal').boundingBox()
                assert.ok(checkbox && appeal && (checkbox.y + checkbox.height <= appeal.y + 1 || appeal.y + appeal.height <= checkbox.y + 1), `${viewport.name} ${mode}: dodge overlaps the Appeal control: ${JSON.stringify({ checkbox, appeal })}`)
              }
            }
            if (viewport.width <= 520 || viewport.height <= 520) await capture(page, `${viewport.name}-${mode}-checkbox-dodge`, { mode, round, dodge: attempts })
          }
          if (round === 10) {
            const box = page.locator('.final-box')
            const attempts = mode === 'reduced' ? 1 : 2
            for (let activation = 1; activation <= attempts; activation += 1) {
              await box.click()
              await page.waitForTimeout(250)
              if (viewport.width <= 820 || viewport.height <= 520) await assertCheckboxContained(page, '.final-box', `${viewport.name} ${mode} final dodge ${activation}`)
            }
            await capture(page, `${viewport.name}-${mode}-final`, { mode, round })
            for (let activation = attempts; activation < (mode === 'reduced' ? 2 : 3); activation += 1) await box.click()
            await page.waitForTimeout(250)
            const choices = await page.locator('.choices button').evaluateAll((elements) => elements.map((element) => {
              const r = element.getBoundingClientRect()
              return { y: r.y, bottom: r.bottom }
            }))
            const checkbox = await box.boundingBox()
            assert.ok(choices.length === 3 && checkbox && choices.every((choice) => checkbox.y + checkbox.height <= choice.y + 1 || choice.bottom <= checkbox.y + 1), `${viewport.name} ${mode}: final choice hit areas overlap the dodging checkbox: ${JSON.stringify({ checkbox, choices })}`)
          }
          if (puzzleScreens.has(round) && round !== 2 && round !== 10 && (viewport.width <= 520 || viewport.height <= 520)) {
            await capture(page, `${viewport.name}-${mode}-round${round}`, { mode, round })
          }
          if ([1, 3, 6, 9].includes(round)) {
            const cells = await page.locator('.cell').evaluateAll((elements) => elements.map((element) => {
              const r = element.getBoundingClientRect()
              const label = element.querySelector('small')
              return { y: r.y, bottom: r.bottom, width: r.width, height: r.height, labelOverflow: Boolean(label && label.scrollWidth > label.clientWidth + 1) }
            }))
            const verify = await page.getByRole('button', { name: 'Verify selection', exact: true }).boundingBox()
            assert.ok(cells.every((cell) => !cell.labelOverflow), `${viewport.name} ${mode} round ${round}: clue labels are not clipped`)
            if (viewport.width === 320 && viewport.height > 520) {
              assert.ok(cells.slice(0, 3).every((cell) => cell.bottom <= viewport.height), `320px round ${round}: full first grid row fits on entry`)
              await page.getByRole('button', { name: 'Verify selection', exact: true }).scrollIntoViewIfNeeded()
              assert.ok(await page.evaluate(() => window.scrollY) <= 200, `320px round ${round}: grid Verify requires at most 200px page scroll`)
              await page.evaluate(() => window.scrollTo(0, Math.min(120, document.documentElement.scrollHeight - window.innerHeight)))
              await assertTimerVisible(page, `320px round ${round} while scrolling puzzle controls`)
              const action = await page.getByRole('button', { name: 'Verify selection', exact: true }).boundingBox()
              const stickyHud = await page.locator('.hud').boundingBox()
              assert.ok(action && stickyHud && action.y >= stickyHud.y + stickyHud.height - 1, `320px round ${round}: sticky HUD covers the focused action`)
              await page.evaluate(() => window.scrollTo(0, 0))
            }
            if (viewport.width === 390 || viewport.width === 412) {
              assert.ok(cells.every((cell) => cell.bottom <= viewport.height), `${viewport.width}px round ${round}: entire grid fits on entry`)
              assert.ok(verify && verify.y + verify.height <= viewport.height, `${viewport.width}px: first grid Verify fits on entry: ${JSON.stringify(verify)}`)
            }
          }
          if (round === 1 && viewport.width <= 520 && viewport.height > 520) {
            const appeal = page.locator('.appeal')
            const appealBox = await appeal.boundingBox()
            const copy = await appeal.innerText()
            assert.ok(appealBox && appealBox.height <= 120, `${viewport.name}: Appeal occupies ${appealBox?.height}px, over the 120px target`)
            assert.match(copy, /50 points/i)
            assert.match(copy, /up to 20 suspicion/i)
            assert.match(copy, /Unavailable|Available|Already used/i)
          }
        }
        await closePage(page)
      }
    }
  })

  await scenario('timed-click: stable visible hit area across every phase and requested phone size', async () => {
    for (const viewport of viewports.slice(0, 4)) {
      for (const mode of ['full', 'reduced']) {
        const page = await openPage({ viewport, mode, clock: true, mobile: true })
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
        await begin(page)
        for (let round = 1; round < 4; round += 1) await page.getByRole('button', { name: 'Next round', exact: true }).click()
        const button = page.locator('.verify')
        const positions = []
        const phaseMetrics = []
        const expectedStatus = {
          waiting: 'Waiting for the verification signal.',
          fakeout: 'Fake green flash - decoy. Do not click.',
          gap: 'Fake flash ended. Verification is not open.',
          open: 'Verification window open. Click VERIFY now.',
          closed: 'Verification window closed.',
        }
        const phases = [
          ['waiting', 0], ['fakeout', 1600], ['gap', 450], ['open', 1400], ['closed', 1200],
        ]
        for (const [phase, advance] of phases) {
          if (advance) await page.clock.runFor(advance)
          const status = await page.locator('.timed-click-status').innerText()
          const box = await button.boundingBox()
          const timer = await page.locator('.hud .stat').nth(5).boundingBox()
          assert.equal(await page.evaluate(() => window.scrollY), 0, `${viewport.name} ${mode} ${phase}: timed puzzle must begin and remain visible without page scroll`)
          assert.ok(box && box.width >= 44 && box.height >= 44, `${viewport.name} ${mode} ${phase}: timed action below 44px`)
          assert.ok(box && box.y >= -1 && box.y + box.height <= viewport.height + 1, `${viewport.name} ${mode} ${phase}: timed action offscreen: ${JSON.stringify(box)}`)
          assert.ok(timer && timer.y >= -1 && timer.y + timer.height <= viewport.height + 1, `${viewport.name} ${mode} ${phase}: timer offscreen`)
          if (positions.length) assert.ok(Math.abs(box.y - positions[0]) <= 1, `${viewport.name} ${mode} ${phase}: button shifted ${box.y - positions[0]}px`)
          positions.push(box.y)
          assert.equal(status, expectedStatus[phase], `${viewport.name} ${mode} ${phase}: phase copy remains accurate`)
          phaseMetrics.push({ phase, status, buttonY: box.y, buttonHeight: box.height, timerY: timer.y, timerHeight: timer.height, scrollY: await page.evaluate(() => window.scrollY) })
          await assertRequestedWidth(page, `${viewport.name} ${mode} timed ${phase}`)
          if (phase === 'open') await capture(page, `${viewport.name}-${mode}-timed-open`, { mode, round: 4, phases: phaseMetrics })
        }
        if (viewport.height === 412) {
          assert.equal(await page.evaluate(() => window.scrollY), 0, 'landscape timed action begins without scrolling')
          assert.ok(positions.at(-2) < viewport.height, 'landscape open timed button fits')
        }
        await capture(page, `${viewport.name}-${mode}-timed-closed`, { mode, round: 4, phases: phaseMetrics })
        await closePage(page)
      }
    }
  })

  await scenario('natural taps: grid submissions transition to usable checkbox and timed prompt without losing timer visibility', async () => {
    for (const viewport of [...viewports.slice(0, 3), viewports[3]]) {
      for (const mode of ['full', 'reduced']) {
        const page = await openPage({ viewport, mode, clock: true, mobile: true })
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
        await begin(page)
        for (const i of [0, 4, 7]) await page.locator('.cell').nth(i).click()
        await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
        await page.getByRole('heading', { name: 'Confirm you are not a robot.' }).waitFor()
        await assertTimerVisible(page, `${viewport.name} ${mode} natural round 2`)
        const reduced = mode === 'reduced'
        const box = page.locator('.checkbox').first()
        for (let i = 0; i < (reduced ? 2 : 3); i += 1) await box.click()
        await page.getByRole('heading', { name: 'Select all squares with bicycles.' }).waitFor()
        await assertTimerVisible(page, `${viewport.name} ${mode} natural round 3`)
        for (const i of [1, 3, 8]) await page.locator('.cell').nth(i).click()
        await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
        await page.getByRole('heading', { name: 'Click VERIFY when it turns green. Not before.' }).waitFor()
        await assertTimerVisible(page, `${viewport.name} ${mode} natural round 4`)
        const action = await page.locator('.verify').boundingBox()
        assert.ok(action && action.y >= -1 && action.y + action.height <= viewport.height + 1, `${viewport.name} ${mode}: natural timed action offscreen: ${JSON.stringify({ action, timer: await page.locator('.hud .stat').nth(5).boundingBox(), scrollY: await page.evaluate(() => window.scrollY) })}`)
        await capture(page, `${viewport.name}-${mode}-natural-round4`, { mode, round: 4, scrollY: await page.evaluate(() => window.scrollY) })
        await closePage(page)
      }
    }
  })

  await scenario('popup notices: single and accumulated stacks scroll to every dismiss without covering HUD timer', async () => {
    for (const viewport of [viewports[0], viewports[3]]) {
      for (const mode of ['full', 'reduced']) {
        const page = await openPage({ viewport, mode, clock: true, mobile: true })
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
        await begin(page)
        for (let round = 1; round < 3; round += 1) await page.getByRole('button', { name: 'Next round', exact: true }).click()
        await page.clock.runFor(1400)
        assert.equal(await page.locator('.popup').count(), 1, `${viewport.name} ${mode}: one notice appears`)
        for (const round of [4, 5, 6, 7, 8, 9]) {
          await page.getByRole('button', { name: 'Next round', exact: true }).dispatchEvent('click')
          if ([5, 7, 9].includes(round)) await page.clock.runFor(round === 5 ? 1800 : round === 7 ? 1200 : 1600)
        }
        assert.equal(await page.locator('.popup').count(), 4, `${viewport.name} ${mode}: all four notices accumulate`)
        const layer = page.locator('.popup-layer')
        const layerBox = await layer.boundingBox()
        const hudBox = await page.locator('.hud').boundingBox()
        assert.ok(layerBox && hudBox && layerBox.y >= hudBox.y + hudBox.height - 1, `${viewport.name} ${mode}: notice area overlaps sticky HUD/timer: ${JSON.stringify({ layerBox, hudBox, scrollY: await page.evaluate(() => window.scrollY) })}`)
        const popupRects = await page.locator('.popup').evaluateAll((elements) => elements.map((element) => {
          const r = element.getBoundingClientRect()
          return { x: r.x, right: r.right, inlineTransform: element.style.transform }
        }))
        assert.ok(popupRects.every((rect) => rect.x >= -1 && rect.right <= viewport.width + 1 && rect.inlineTransform === ''), `${viewport.name} ${mode}: popup stack is translated or outside the requested viewport: ${JSON.stringify(popupRects)}`)
        await assertTimerVisible(page, `${viewport.name} ${mode} accumulated popups`)
        await capture(page, `${viewport.name}-${mode}-popup-accumulated`, { mode, round: 9, popups: 4 })
        for (let index = 0; index < 4; index += 1) {
          const dismiss = page.locator('.popup button').first()
          await dismiss.scrollIntoViewIfNeeded()
          const box = await dismiss.boundingBox()
          assert.ok(box && box.width >= 44 && box.height >= 44, `${viewport.name} ${mode}: dismiss target below 44px`)
          assert.ok(box && box.x >= -1 && box.x + box.width <= viewport.width + 1 && box.y >= -1 && box.y + box.height <= viewport.height + 1, `${viewport.name} ${mode}: dismiss offscreen: ${JSON.stringify(box)}`)
          await dismiss.click()
          await assertTimerVisible(page, `${viewport.name} ${mode} popup dismissal`)
        }
        assert.equal(await page.locator('.popup').count(), 0)
        const firstCell = page.locator('.cell').first()
        await firstCell.click()
        assert.equal(await firstCell.getAttribute('aria-pressed'), 'true', `${viewport.name} ${mode}: dismissing notices restores puzzle interaction`)
        await assertRequestedWidth(page, `${viewport.name} ${mode} popups`)
        await capture(page, `${viewport.name}-${mode}-popup-dismissed`, { mode, round: 9, dismissed: 4 })
        await closePage(page)
      }
    }
  })

  await scenario('200% text popup clearance preserves HUD timer hit-testing and scroll-dismisses later before earlier notices', async () => {
    for (const viewport of [viewports[0], viewports[1], viewports[2], viewports[3]]) {
      for (const mode of ['full', 'reduced']) {
        const page = await openPage({ viewport, mode, clock: true, mobile: true })
        await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
        await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '32px')
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
        await begin(page)
        await page.getByRole('button', { name: 'Next round', exact: true }).click()
        for (const [round, delay] of [[3, 1400], [4, 0], [5, 1800], [6, 0], [7, 1200], [8, 0], [9, 1600]]) {
          await page.getByRole('button', { name: 'Next round', exact: true }).dispatchEvent('click')
          if (delay) await page.clock.runFor(delay)
          assert.equal(await page.locator('.hud .stat').nth(4).innerText(), `ROUND\n${round}/10`)
        }
        assert.equal(await page.locator('.popup').count(), 4, `${viewport.name} ${mode}: notices accumulate at 200% text`)
        const geometry = await page.evaluate(() => {
          const hud = document.querySelector('.hud').getBoundingClientRect()
          const timer = document.querySelectorAll('.hud .stat')[5]
          const timerRect = timer.getBoundingClientRect()
          const layer = document.querySelector('.popup-layer').getBoundingClientRect()
          const popups = [...document.querySelectorAll('.popup')].map((element) => {
            const rect = element.getBoundingClientRect()
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
          })
          const hit = document.elementFromPoint(timerRect.left + timerRect.width / 2, timerRect.top + timerRect.height / 2)
          return {
            hud: { top: hud.top, bottom: hud.bottom, height: hud.height },
            timer: { top: timerRect.top, bottom: timerRect.bottom },
            timerHit: Boolean(hit && (hit === timer || timer.contains(hit))),
            layer: { top: layer.top, bottom: layer.bottom },
            popups,
          }
        })
        assert.ok(geometry.layer.top >= geometry.hud.bottom - 1, `${viewport.name} ${mode}: popup layer covers enlarged sticky HUD: ${JSON.stringify(geometry)}`)
        assert.ok(geometry.popups.every((popup) => popup.top >= geometry.hud.bottom - 1), `${viewport.name} ${mode}: notice covers enlarged sticky HUD: ${JSON.stringify(geometry)}`)
        assert.equal(geometry.timerHit, true, `${viewport.name} ${mode}: HUD timer is not the actual hit target: ${JSON.stringify(geometry)}`)
        await capture(page, `${viewport.name}-${mode}-200-text-popup-accumulated`, { mode, textScale: 2, round: 9, popups: 4, geometry })

        const initialPageScroll = await page.evaluate(() => window.scrollY)
        const laterDismiss = page.locator('.popup button').last()
        await laterDismiss.scrollIntoViewIfNeeded()
        const scrolled = await page.locator('.popup-layer').evaluate((element) => element.scrollTop)
        assert.ok(scrolled > 0, `${viewport.name} ${mode}: reaching the later notice must scroll the notice area`)
        assert.equal(await page.evaluate(() => window.scrollY), initialPageScroll, `${viewport.name} ${mode}: notice scrolling must not move the game page`)
        const laterHit = await laterDismiss.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return Boolean(hit && (hit === element || element.contains(hit)))
        })
        assert.equal(laterHit, true, `${viewport.name} ${mode}: later dismiss target is covered`)
        await laterDismiss.click()
        assert.equal(await page.locator('.popup').count(), 3, `${viewport.name} ${mode}: later notice dismisses first`)

        const earlyDismiss = page.locator('.popup button').first()
        await earlyDismiss.scrollIntoViewIfNeeded()
        const earlyHit = await earlyDismiss.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return Boolean(hit && (hit === element || element.contains(hit)))
        })
        assert.equal(earlyHit, true, `${viewport.name} ${mode}: early dismiss target is covered after scrolling back`)
        await earlyDismiss.click()
        assert.equal(await page.locator('.popup').count(), 2, `${viewport.name} ${mode}: early notice dismisses after the later notice`)
        assert.equal(await page.evaluate(() => window.scrollY), initialPageScroll, `${viewport.name} ${mode}: dismissing notices does not scroll the game page`)
        await assertTimerVisible(page, `${viewport.name} ${mode} 200% popup dismissals`)
        await closePage(page)
      }
    }
  })

  await scenario('slider, every word/recall choice, and final choices work by touch or keyboard', async () => {
    for (const viewport of [viewports[0], viewports[3]]) {
      for (const method of ['touch', 'keyboard']) {
        const page = await openPage({ viewport, mode: 'reduced', mobile: true })
        await goToRound(page, 5)
        await dismissPopups(page)
        const slider = page.locator('input[type="range"]')
        const sliderBox = await slider.boundingBox()
        assert.ok(sliderBox && sliderBox.height >= 44, `${viewport.name} ${method}: slider target below 44px`)
        if (method === 'touch') {
          await slider.tap({ position: { x: sliderBox.width * .62, y: sliderBox.height / 2 } })
          assert.notEqual(await slider.inputValue(), '50', `${viewport.name}: touch adjusts slider`)
          await page.getByRole('button', { name: 'Lock alignment', exact: true }).tap()
        } else {
          await slider.focus(); await slider.press('ArrowRight')
          assert.equal(await slider.inputValue(), '51', `${viewport.name}: keyboard adjusts slider`)
          const lock = page.getByRole('button', { name: 'Lock alignment', exact: true })
          await lock.focus(); await lock.press('Enter')
        }
        await closePage(page)
      }
    }

    for (const [viewport, method, round, expectedCount, nextRound] of [
      [viewports[0], 'touch', 7, 4, 8],
      [viewports[3], 'keyboard', 7, 4, 8],
      [viewports[0], 'keyboard', 8, 4, 9],
      [viewports[3], 'touch', 8, 4, 9],
    ]) {
      for (let index = 0; index < expectedCount; index += 1) {
        const page = await openPage({ viewport, mode: 'reduced', mobile: true })
        await goToRound(page, round)
        await dismissPopups(page)
        const options = page.locator('.choices button')
        assert.equal(await options.count(), expectedCount, `${viewport.name} round ${round}: all choices render`)
        const option = options.nth(index)
        await option.scrollIntoViewIfNeeded()
        const box = await option.boundingBox()
        assert.ok(box && box.width >= 44 && box.height >= 44, `${viewport.name} round ${round} option ${index + 1} is a full-size target`)
        assert.ok(box && box.y >= -1 && box.y + box.height <= viewport.height + 1, `${viewport.name} round ${round} option ${index + 1} is reachable in the viewport`)
        if (method === 'touch') await option.tap()
        else { await option.focus(); await option.press('Enter') }
        assert.equal(await page.locator('.hud .stat').nth(4).innerText(), `ROUND\n${nextRound}/10`, `${viewport.name} round ${round} option ${index + 1} activates`)
        await closePage(page)
      }
    }
  })

  await scenario('all six ending headings fit actual requested widths and ending actions remain reachable', async () => {
    for (const viewport of viewports) {
      for (const title of endings) {
        const mode = title === 'ANOMALY: TOO PERFECT' ? 'full' : 'reduced'
        const page = await openPage({ viewport, mode, clock: title === 'ANOMALY: TOO PERFECT', mobile: viewport.width <= 520 || viewport.height <= 520 })
        await begin(page)
        if (title === 'ANOMALY: TOO PERFECT') await playPerfectRun(page)
        else await makeEnding(page, title)
        await assertRequestedWidth(page, `${viewport.name} ${title}`)
        const titleBox = await page.getByRole('heading', { name: title, exact: true }).boundingBox()
        assert.ok(titleBox && titleBox.x >= -1 && titleBox.x + titleBox.width <= viewport.width + 1, `${viewport.name}: ending title exceeds requested viewport: ${JSON.stringify(titleBox)}`)
        assert.ok(await page.getByRole('button', { name: 'Try again', exact: true }).isVisible())
        assert.ok(await page.getByRole('button', { name: 'Copy result', exact: true }).isVisible())
        if (viewport.width <= 412) await capture(page, `${viewport.name}-ending-${endings.indexOf(title) + 1}`, { mode, ending: title })
        await closePage(page)
      }
    }
  })

  await scenario('ending share fallback, Try again, and clipboard-denied raw text', async () => {
    const page = await openPage({ viewport: viewports[1], mode: 'reduced', mobile: true })
    await begin(page)
    await page.getByRole('button', { name: 'Force ending', exact: true }).click()
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('clipboard denied by regression') } },
    }))
    await page.getByRole('button', { name: 'Copy result', exact: true }).click()
    assert.ok(await page.locator('.share-raw').isVisible(), 'denied clipboard exposes selectable raw share text')
    assert.match(await page.locator('.copy-note').innerText(), /Clipboard unavailable/i)
    await capture(page, '390x844-ending-share-fallback', { mode: 'reduced', ending: 'STATUS: PROBABLY HUMAN', clipboard: 'denied' })
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    assert.equal(await page.locator('.hud .stat').nth(4).innerText(), 'ROUND\n1/10', 'Try again starts a fresh round 1 run')
    await capture(page, '390x844-ending-retry-start', { mode: 'reduced', phase: 'play', round: 1 })
    await closePage(page)
  })

  await scenario('200% text reflow, Appeal disclosure, and desktop baseline', async () => {
    for (const viewport of [viewports[0], viewports[1], viewports[2], viewports[3]]) {
      const page = await openPage({ viewport, mode: 'reduced' })
      await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
      await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '32px')
      await assertRequestedWidth(page, `${viewport.name} start 200% text`)
      await capture(page, `${viewport.name}-200-text-start`, { mode: 'reduced', textScale: 2 })
      await begin(page)
      await page.getByRole('button', { name: 'Next round', exact: true }).click()
      await assertRequestedWidth(page, `${viewport.name} checkbox 200% text`)
      await assertControlTargets(page, `${viewport.name} checkbox 200% text`)
      const appeal = page.locator('.appeal')
      assert.match(await appeal.innerText(), /50 points/i, 'Appeal cost remains explicit at 200% text')
      assert.match(await appeal.innerText(), /suspicion/i, 'Appeal effect/eligibility remains explicit at 200% text')
      await capture(page, `${viewport.name}-200-text-appeal`, { mode: 'reduced', textScale: 2 })
      for (let round = 3; round <= 7; round += 1) await page.getByRole('button', { name: 'Next round', exact: true }).dispatchEvent('click')
      await dismissPopups(page)
      await assertRequestedWidth(page, `${viewport.name} word choices 200% text`)
      await assertControlTargets(page, `${viewport.name} word choices 200% text`)
      const choices = await page.locator('.choices button').evaluateAll((elements) => elements.map((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })))
      assert.ok(choices.every((choice) => choice.scrollWidth <= choice.clientWidth + 1), `${viewport.name}: word choices clip at 200% text: ${JSON.stringify(choices)}`)
      await capture(page, `${viewport.name}-200-text-word-choices`, { mode: 'reduced', textScale: 2, round: 7 })
      await closePage(page)
    }
    const desktop = await openPage({ viewport: viewports[4], mode: 'full' })
    await begin(desktop)
    const shell = await desktop.locator('.shell').boundingBox()
    const hud = await desktop.locator('.hud').boundingBox()
    const terms = await desktop.locator('.terms').boundingBox()
    assert.ok(shell && Math.abs(shell.width - 1180) <= 1, `desktop shell baseline changed: ${JSON.stringify(shell)}`)
    assert.ok(hud && Math.abs(hud.height - 58) <= 1, `desktop HUD baseline changed: ${JSON.stringify(hud)}`)
    assert.ok(terms && Math.abs(terms.width - 280) <= 1, `desktop notes column baseline changed: ${JSON.stringify(terms)}`)
    await capture(desktop, '1440x1000-desktop-baseline', { mode: 'full' })
    await closePage(desktop)
  })

  assert.deepEqual(pageErrors, [], `browser JavaScript/console errors: ${pageErrors.join('; ')}`)
  await writeFile(path.join(evidenceDir, 'metrics.json'), `${JSON.stringify({ baseURL, generatedAt: new Date().toISOString(), viewports, metrics, pageErrors, failures }, null, 2)}\n`)
  if (failures.length) {
    console.error(`RED: ${failures.length} mobile regression scenario(s) failed.`)
    process.exitCode = 1
  } else {
    console.log(`PASS: zero browser page/console errors; ${metrics.length} evidence captures.`)
    console.log(`GREEN: all mobile play-surface scenarios passed. Evidence: ${evidenceDir}`)
  }
} finally {
  await Promise.all([...pages].map((page) => page.close()))
  await browser.close()
}
