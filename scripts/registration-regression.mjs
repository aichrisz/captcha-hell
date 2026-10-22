import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const playwrightModule = process.env.PLAYWRIGHT_MODULE
const baseURL = process.env.BASE_URL
const evidenceDir = process.env.EVIDENCE_DIR
const mode = process.env.REGISTRATION_MODE ?? 'all'
assert.ok(playwrightModule, 'Set PLAYWRIGHT_MODULE to an installed Playwright module path.')
assert.ok(baseURL, 'Set BASE_URL to the running app URL, including its base path.')
assert.ok(evidenceDir, 'Set EVIDENCE_DIR to the designated artifact directory.')
const modes = new Set(['visual', 'initial-boundaries', 'shrunken-boundaries', 'lifecycle', 'accessibility', 'all'])
assert.ok(modes.has(mode), `Unknown REGISTRATION_MODE: ${mode}`)

const { chromium } = await import(playwrightModule)
const browser = await chromium.launch({ headless: true })
const pages = new Set()
const pageErrors = []
const results = []
const screenshotsDir = path.join(evidenceDir, 'screenshots')
const bestKey = 'captcha-hell.best.v1'
const endingsKey = 'captcha-hell.endings.v1'
await mkdir(screenshotsDir, { recursive: true })

function appURL() {
  const url = new URL(baseURL)
  url.searchParams.delete('debug')
  return url.toString()
}

async function openPage({ viewport = { width: 390, height: 844 }, motion = 'reduced', mobile = false } = {}) {
  const page = await browser.newPage({
    viewport,
    reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference',
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  })
  pages.add(page)
  page.setDefaultTimeout(8000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()) })
  await page.clock.install()
  await page.goto(appURL())
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  return page
}

async function closePage(page) {
  pages.delete(page)
  await page.close()
}

async function reachRound5(page, motion = 'reduced') {
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  for (const index of [0, 4, 7]) await page.locator('.cell').nth(index).click()
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  for (let click = 0; click < (motion === 'reduced' ? 2 : 3); click += 1) await page.locator('.checkbox').first().click()
  for (const index of [1, 3, 8]) await page.locator('.cell').nth(index).click()
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await page.clock.runFor(3450)
  await page.locator('.verify').dispatchEvent('click')
  await page.getByRole('heading', { name: 'Slide to align the verification image.', exact: true }).waitFor()
  assert.equal(await page.locator('.hud .stat').nth(4).innerText(), 'ROUND\n5/10')
}

async function setRangeValue(page, value) {
  const slider = page.getByRole('slider', { name: 'alignment slider', exact: true })
  await slider.focus()
  const current = Number(await slider.inputValue())
  if (current !== value) {
    const useEnd = 100 - value < value
    await slider.press(useEnd ? 'End' : 'Home')
    const steps = useEnd ? 100 - value : value
    for (let step = 0; step < steps; step += 1) await slider.press(useEnd ? 'ArrowLeft' : 'ArrowRight')
  }
  assert.equal(await slider.inputValue(), String(value), `keyboard selects range value ${value}`)
  return slider
}

async function hud(page) {
  const rows = await page.locator('.hud .stat').evaluateAll((elements) =>
    elements.map((element) => element.innerText.split('\n').map((part) => part.trim())))
  return Object.fromEntries(rows.map(([label, value]) => [label.toLowerCase(), value]))
}

async function storage(page) {
  return page.evaluate(([best, endings]) => [localStorage.getItem(best), localStorage.getItem(endings)], [bestKey, endingsKey])
}

async function assertRegistration(page, { value, tolerance, phrase }) {
  const illustration = page.locator('[data-registration-illustration]')
  assert.equal(await illustration.count(), 1, 'one registration illustration is rendered')
  assert.equal(await illustration.getAttribute('aria-hidden'), 'true', 'artwork is decorative; text conveys its meaning')
  assert.equal(await illustration.getAttribute('data-value'), String(value))
  assert.equal(await illustration.getAttribute('data-target'), '62')
  assert.equal(await illustration.getAttribute('data-tolerance'), String(tolerance))
  const status = page.locator('#slider-registration-status')
  const text = await status.innerText()
  assert.ok(text.includes(phrase), `status text ${JSON.stringify(text)} includes ${phrase}`)
  assert.match(text, new RegExp(`target 62; tolerance plus or minus ${tolerance}`, 'i'))
  assert.equal(await status.getAttribute('role'), 'status')
  assert.equal(await status.getAttribute('aria-live'), 'polite')
  const slider = page.getByRole('slider', { name: 'alignment slider', exact: true })
  assert.equal(await slider.getAttribute('aria-describedby'), 'slider-instructions slider-registration-status')
  assert.equal(await slider.getAttribute('aria-valuetext'), text)

  const geometry = await illustration.evaluate((element) => {
    const original = element.querySelector('.registration-original').getBoundingClientRect()
    const copyElement = element.querySelector('[data-registration-copy]')
    const copy = copyElement.getBoundingClientRect()
    const stage = element.querySelector('.registration-stage').getBoundingClientRect()
    const band = element.querySelector('[data-tolerance-band]').getBBox()
    const offset = Number(element.getAttribute('data-offset-percent'))
    return {
      value: element.getAttribute('data-value'),
      cssOffset: getComputedStyle(copyElement).getPropertyValue('--registration-offset').trim(),
      left: getComputedStyle(copyElement).left,
      transform: getComputedStyle(copyElement).transform,
      original: { left: original.left, right: original.right, width: original.width, center: original.left + original.width / 2 },
      copy: { left: copy.left, right: copy.right, width: copy.width, center: copy.left + copy.width / 2 },
      stage: { left: stage.left, right: stage.right },
      marks: [...element.querySelectorAll('.registration-mark')].map((mark) => {
        const rect = mark.getBoundingClientRect()
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      }),
      offsetPercent: offset,
      band: { x: band.x, width: band.width },
    }
  })
  assert.ok(geometry.copy.left >= geometry.stage.left - 1 && geometry.copy.right <= geometry.stage.right + 1, `copy remains inside the illustration: ${JSON.stringify(geometry)}`)
  assert.ok(geometry.original.left >= geometry.stage.left - 1 && geometry.original.right <= geometry.stage.right + 1, 'original remains inside the illustration')
  const delta = value - 62
  const expectedOffset = delta * 0.0019 * (geometry.stage.right - geometry.stage.left)
  assert.ok(Math.abs((geometry.copy.center - geometry.original.center) - expectedOffset) < 0.3, `copy displacement is linear on one horizontal axis: ${JSON.stringify(geometry)}`)
  assert.ok(Math.abs(geometry.offsetPercent - delta * 0.19) < 0.01, 'every nonzero value is represented by an unsnapped offset')
  assert.ok(geometry.marks.every((mark) => mark.left >= geometry.stage.left - 1 && mark.right <= geometry.stage.right + 1 && mark.top >= 0 && mark.bottom > 0), 'all registration marks remain visible within the illustration')
  assert.ok(Math.abs(geometry.band.x - (62 - tolerance)) < 0.01, 'tolerance band begins at the exact inclusive lower boundary')
  assert.ok(Math.abs(geometry.band.width - 2 * tolerance) < 0.01, 'tolerance band width uses the current validator tolerance')
  return { text, geometry }
}

async function capture(page, name) {
  const file = path.join(screenshotsDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  return file
}

async function runVisual() {
  const page = await openPage()
  try {
    await reachRound5(page)
    const initial = await assertRegistration(page, { value: 50, tolerance: 8, phrase: 'Copy left of registration' })
    const screenshots = [await capture(page, 'registration-initial-390x844')]
    await setRangeValue(page, 58)
    const misaligned = await assertRegistration(page, { value: 58, tolerance: 8, phrase: 'Within tolerance' })
    screenshots.push(await capture(page, 'registration-misaligned-390x844'))
    await setRangeValue(page, 62)
    const aligned = await assertRegistration(page, { value: 62, tolerance: 8, phrase: 'Within tolerance' })
    assert.equal(aligned.geometry.copy.center, aligned.geometry.original.center, 'exact target aligns form edges and split seal')
    screenshots.push(await capture(page, 'registration-aligned-390x844'))
    await setRangeValue(page, 50)
    await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
    await page.getByText('Misses: 1/3', { exact: true }).waitFor()
    const shrunk = await assertRegistration(page, { value: 50, tolerance: 4, phrase: 'Copy left of registration' })
    screenshots.push(await capture(page, 'registration-shrunk-tolerance-390x844'))
    const extremes = []
    for (const value of [0, 100]) {
      await setRangeValue(page, value)
      extremes.push(await assertRegistration(page, { value, tolerance: 4, phrase: value < 62 ? 'Copy left of registration' : 'Copy right of registration' }))
    }
    results.push({ scenario: 'live graphic, status, unsnapped geometry, truthful tolerance band, bounded extrema and required viewport captures', passed: true, initial, misaligned, aligned, shrunk, extremes, screenshots })
  } finally {
    await closePage(page)
  }
}

async function runInitialBoundaries() {
  for (const test of [
    { value: 53, phrase: 'Copy left of registration', accepted: false },
    { value: 54, phrase: 'Within tolerance', accepted: true },
    { value: 62, phrase: 'Within tolerance', accepted: true },
    { value: 70, phrase: 'Within tolerance', accepted: true },
    { value: 71, phrase: 'Copy right of registration', accepted: false },
  ]) {
    const page = await openPage()
    try {
      await reachRound5(page)
      const before = await hud(page)
      const receipt = await page.locator('[data-receipt-announcer]').textContent()
      const saved = await storage(page)
      await setRangeValue(page, test.value)
      const graphic = await assertRegistration(page, { value: test.value, tolerance: 8, phrase: test.phrase })
      assert.deepEqual(await hud(page), before, 'moving the range changes no global game measures')
      assert.equal(await page.locator('[data-receipt-announcer]').textContent(), receipt, 'moving the range creates no verdict receipt')
      assert.deepEqual(await storage(page), saved, 'moving the range does not write best score or endings')
      await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
      if (test.accepted) {
        await page.waitForFunction(() => document.querySelector('.hud .stat:nth-of-type(5) strong')?.textContent === '6/10')
      } else {
        await page.getByText('Misses: 1/3', { exact: true }).waitFor()
        assert.equal((await hud(page)).round, '5/10')
        assert.equal((await page.locator('[data-receipt-announcer]').textContent()), receipt, 'nonterminal slider miss has no global verdict')
      }
      results.push({ scenario: `initial tolerance value ${test.value} ${test.accepted ? 'accepted' : 'rejected'}`, passed: true, accepted: test.accepted, graphic })
    } finally {
      await closePage(page)
    }
  }
}

async function missToTolerance(page, missCount) {
  for (let miss = 0; miss < missCount; miss += 1) {
    await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
    await page.getByText(`Misses: ${miss + 1}/3`, { exact: true }).waitFor()
  }
  assert.equal(await page.locator('[data-registration-illustration]').getAttribute('data-tolerance'), String(8 / (2 ** missCount)))
}

async function runShrunkenBoundaries() {
  for (const group of [
    { misses: 1, tolerance: 4, cases: [
      { value: 57, phrase: 'Copy left of registration', accepted: false },
      { value: 58, phrase: 'Within tolerance', accepted: true },
      { value: 66, phrase: 'Within tolerance', accepted: true },
      { value: 67, phrase: 'Copy right of registration', accepted: false },
    ] },
    { misses: 2, tolerance: 2, cases: [
      { value: 59, phrase: 'Copy left of registration', accepted: false },
      { value: 60, phrase: 'Within tolerance', accepted: true },
      { value: 64, phrase: 'Within tolerance', accepted: true },
      { value: 65, phrase: 'Copy right of registration', accepted: false },
    ] },
  ]) {
    for (const test of group.cases) {
      const page = await openPage()
      try {
        await reachRound5(page)
        await missToTolerance(page, group.misses)
        const graphic = await (async () => {
          await setRangeValue(page, test.value)
          return assertRegistration(page, { value: test.value, tolerance: group.tolerance, phrase: test.phrase })
        })()
        await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
        if (test.accepted) await page.waitForFunction(() => document.querySelector('.hud .stat:nth-of-type(5) strong')?.textContent === '6/10')
        else if (group.misses < 2) {
          await page.getByText(`Misses: ${group.misses + 1}/3`, { exact: true }).waitFor()
          assert.equal((await hud(page)).round, '5/10')
        } else {
          await page.getByText('Misses: 0/3', { exact: true }).waitFor()
          await page.waitForFunction(() => document.querySelector('[data-registration-illustration]')?.getAttribute('data-tolerance') === '8')
          assert.equal((await hud(page)).round, '5/10')
          assert.equal((await hud(page)).strikes, '1')
          assert.equal(await page.getByRole('slider', { name: 'alignment slider' }).inputValue(), String(test.value), 'third-miss reset retains the outside-boundary value')
        }
        results.push({ scenario: `tolerance ${group.tolerance} value ${test.value} ${test.accepted ? 'accepted' : 'rejected'}`, passed: true, accepted: test.accepted, graphic })
      } finally {
        await closePage(page)
      }
    }
  }
}

async function runLifecycle() {
  {
    const page = await openPage()
    try {
      await reachRound5(page)
      const before = { hud: await hud(page), receipt: await page.locator('[data-receipt-announcer]').textContent(), storage: await storage(page) }
      await setRangeValue(page, 58)
      await assertRegistration(page, { value: 58, tolerance: 8, phrase: 'Within tolerance' })
      assert.deepEqual(await hud(page), before.hud)
      assert.equal(await page.locator('[data-receipt-announcer]').textContent(), before.receipt)
      assert.deepEqual(await storage(page), before.storage)
      await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.hud .stat:nth-of-type(5) strong')?.textContent === '6/10')
      assert.equal((await hud(page)).strikes, before.hud.strikes)
      assert.equal(Number((await hud(page)).score), Number(before.hud.score) + 165, 'accepted Lock applies the existing clean-round score once')
      assert.equal(await page.locator('[data-receipt-announcer]').textContent(), 'Receipt 5: Accepted; next challenge opened. Round 5. Score +165.')
      results.push({ scenario: 'range edits are local and accepted Lock advances once with existing receipt and score', passed: true })
    } finally { await closePage(page) }
  }
  {
    const page = await openPage()
    try {
      await reachRound5(page)
      const slider = page.getByRole('slider', { name: 'alignment slider', exact: true })
      for (let miss = 1; miss <= 3; miss += 1) {
        await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
        if (miss < 3) await page.getByText(`Misses: ${miss}/3`, { exact: true }).waitFor()
      }
      await page.getByText('Misses: 0/3', { exact: true }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-registration-illustration]')?.getAttribute('data-tolerance') === '8')
      assert.equal(await slider.inputValue(), '50', 'third-miss reset retains selected value')
      assert.equal((await hud(page)).round, '5/10')
      assert.equal((await hud(page)).strikes, '1')
      assert.equal((await hud(page)).timer, '15s')
      assert.equal(await page.locator('[data-receipt-announcer]').textContent(), 'Receipt 5: Rejected; retry available. Round 5. Strikes +1. Suspicion +10.')
      results.push({ scenario: 'third miss adds one existing strike and resets misses/tolerance but retains value', passed: true })
    } finally { await closePage(page) }
  }
  {
    const page = await openPage()
    try {
      await reachRound5(page)
      const slider = await setRangeValue(page, 58)
      await page.clock.runFor(15_000)
      await page.getByText('Misses: 0/3', { exact: true }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-registration-illustration]')?.getAttribute('data-tolerance') === '8')
      assert.equal(await slider.inputValue(), '58', 'timer expiry reset retains selected value')
      assert.equal((await hud(page)).round, '5/10')
      assert.equal((await hud(page)).strikes, '1')
      assert.equal((await hud(page)).timer, '15s')
      assert.equal(await page.locator('[data-receipt-announcer]').textContent(), 'Receipt 5: Time expired; retry available. Round 5. Strikes +1.')
      results.push({ scenario: 'timer expiry restores tolerance/misses and retains selected value', passed: true })
    } finally { await closePage(page) }
  }
}

async function auditFocusedHit(page, element, label) {
  const result = await element.evaluate((target) => {
    const rect = target.getBoundingClientRect()
    const hud = document.querySelector('.hud').getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      focused: document.activeElement === target,
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
      hud: { top: hud.top, bottom: hud.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      hit: hit === target || target.contains(hit),
      hitTarget: { tag: hit?.tagName, className: typeof hit?.className === 'string' ? hit.className : '', text: hit?.textContent?.trim().slice(0, 80) },
      scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      popups: [...document.querySelectorAll('.popup')].map((popup) => {
        const popupRect = popup.getBoundingClientRect()
        return { top: popupRect.top, bottom: popupRect.bottom, left: popupRect.left, right: popupRect.right }
      }),
      outlineStyle: getComputedStyle(target).outlineStyle,
    }
  })
  assert.ok(result.focused, `${label}: actual keyboard focus was lost: ${JSON.stringify(result)}`)
  assert.ok(result.rect.width >= 44 && result.rect.height >= 44, `${label}: target below 44px: ${JSON.stringify(result)}`)
  assert.ok(result.rect.left >= -1 && result.rect.right <= result.viewport.width + 1, `${label}: target exceeds viewport: ${JSON.stringify(result)}`)
  assert.ok(result.rect.top >= result.hud.bottom - 1 && result.rect.bottom <= result.viewport.height + 1, `${label}: target under HUD or outside viewport: ${JSON.stringify(result)}`)
  assert.equal(result.hit, true, `${label}: center is obstructed: ${JSON.stringify(result)}`)
  assert.notEqual(result.outlineStyle, 'none', `${label}: visible keyboard focus is required`)
  return result
}

async function assertLayout(page, viewport, name) {
  const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, page: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  assert.ok(dimensions.page <= viewport.width + 1 && dimensions.body <= viewport.width + 1, `${name}: horizontal overflow ${JSON.stringify(dimensions)}`)
  const slider = await page.getByRole('slider', { name: 'alignment slider', exact: true }).boundingBox()
  const lock = await page.getByRole('button', { name: 'Lock alignment', exact: true }).boundingBox()
  assert.ok(slider && slider.width >= 44 && slider.height >= 44, `${name}: native range target below 44px`)
  assert.ok(lock && lock.width >= 44 && lock.height >= 44, `${name}: Lock target below 44px`)
  const graphic = await page.locator('[data-registration-illustration]').boundingBox()
  const status = await page.locator('#slider-registration-status').boundingBox()
  assert.ok(graphic && graphic.width > 0 && graphic.x >= -1 && graphic.x + graphic.width <= viewport.width + 1, `${name}: artwork out of bounds`)
  assert.ok(status && status.width > 0 && status.height > 0 && status.x >= -1 && status.x + status.width <= viewport.width + 1, `${name}: status clipped`)
  return { dimensions, slider, lock, graphic, status }
}

async function runAccessibility() {
  const viewports = [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 915, height: 412 },
    { width: 1440, height: 1000 },
  ]
  for (const viewport of viewports) {
    for (const motion of ['full', 'reduced']) {
      const page = await openPage({ viewport, motion, mobile: viewport.width <= 520 || viewport.height <= 520 })
      try {
        await reachRound5(page, motion)
        const layout = await assertLayout(page, viewport, `${viewport.width}x${viewport.height} ${motion} motion`)
        await assertRegistration(page, { value: 50, tolerance: 8, phrase: 'Copy left of registration' })
        results.push({ scenario: `${viewport.width}x${viewport.height} ${motion} motion reflow and targets`, passed: true, layout })
      } finally { await closePage(page) }
    }
  }
  {
    const viewport = { width: 320, height: 740 }
    const page = await openPage({ viewport, mobile: true })
    try {
      await reachRound5(page)
      await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
      await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '32px')
      const layout = await assertLayout(page, viewport, '320x740 at 200 percent text')
      await assertRegistration(page, { value: 50, tolerance: 8, phrase: 'Copy left of registration' })
      results.push({ scenario: '320x740 at 200 percent text remains reflowed and operable', passed: true, layout })
    } finally { await closePage(page) }
  }
  {
    const viewport = { width: 320, height: 740 }
    const page = await openPage({ viewport, mobile: true })
    try {
      await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
      await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '32px')
      await reachRound5(page)
      await page.clock.runFor(1800)
      const notices = await page.locator('.popup').count()
      assert.ok(notices > 0, 'round 5 notice is present during the focus audit')
      const slider = page.getByRole('slider', { name: 'alignment slider', exact: true })
      const lock = page.getByRole('button', { name: 'Lock alignment', exact: true })
      await lock.focus()
      await lock.press('Shift+Tab')
      await slider.press('ArrowRight')
      const sliderHit = await auditFocusedHit(page, slider, '320px range with notice at 200 percent text')
      await slider.press('Home')
      for (let i = 0; i < 62; i += 1) await slider.press('ArrowRight')
      await slider.press('Tab')
      const lockHit = await auditFocusedHit(page, lock, '320px Lock with notice at 200 percent text')
      await lock.press('Enter')
      await page.waitForFunction(() => document.querySelector('.hud .stat:nth-of-type(5) strong')?.textContent === '6/10')
      results.push({ scenario: 'natural route keyboard range and Lock hit-testing with HUD and notice at 320px/200 percent text', passed: true, notices, sliderHit, lockHit })
    } finally { await closePage(page) }
  }
  {
    const page = await openPage({ viewport: { width: 390, height: 844 }, mobile: true })
    try {
      await reachRound5(page)
      const slider = page.getByRole('slider', { name: 'alignment slider', exact: true })
      const bounds = await slider.boundingBox()
      assert.ok(bounds && bounds.width > 44)
      await slider.tap({ position: { x: bounds.width * 0.62, y: bounds.height / 2 } })
      assert.notEqual(await slider.inputValue(), '50', 'touch moves the native range')
      assert.match(await page.locator('#slider-registration-status').innerText(), /Within tolerance/)
      const value = await slider.inputValue()
      await page.getByRole('button', { name: 'Lock alignment', exact: true }).tap()
      await page.waitForFunction(() => document.querySelector('.hud .stat:nth-of-type(5) strong')?.textContent === '6/10')
      results.push({ scenario: 'touch completes the same registration within tolerance', passed: true, value })
    } finally { await closePage(page) }
  }
}

const selected = mode === 'all'
  ? ['visual', 'initial-boundaries', 'shrunken-boundaries', 'lifecycle', 'accessibility']
  : [mode]

try {
  for (const selectedMode of selected) {
    if (selectedMode === 'visual') await runVisual()
    if (selectedMode === 'initial-boundaries') await runInitialBoundaries()
    if (selectedMode === 'shrunken-boundaries') await runShrunkenBoundaries()
    if (selectedMode === 'lifecycle') await runLifecycle()
    if (selectedMode === 'accessibility') await runAccessibility()
  }
  assert.deepEqual(pageErrors, [], `browser page/console errors: ${pageErrors.join('; ')}`)
  const output = { baseURL, mode, selected, results, pageErrors }
  await writeFile(path.join(evidenceDir, 'registration-results.json'), `${JSON.stringify(output, null, 2)}\n`)
  console.log(`PASS: ${results.length} registration browser scenarios, zero JavaScript/console errors. Evidence: ${evidenceDir}`)
} finally {
  await Promise.all([...pages].map((page) => page.close()))
  await browser.close()
}
