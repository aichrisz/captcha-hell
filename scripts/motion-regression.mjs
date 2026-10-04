import assert from 'node:assert/strict'

const playwrightModule = process.env.PLAYWRIGHT_MODULE
const baseURL = process.env.BASE_URL
assert.ok(playwrightModule, 'Set PLAYWRIGHT_MODULE to an installed Playwright module path.')
assert.ok(baseURL, 'Set BASE_URL to the running app URL, including its base path.')

const { chromium } = await import(playwrightModule)
const browser = await chromium.launch({ headless: true })
const pageErrors = []
const pages = new Set()
const debugURL = () => {
  const url = new URL(baseURL)
  url.searchParams.set('debug', '1')
  return url.toString()
}

async function openRun({ mode = 'full', round = 2, width = 390, mobile = false } = {}) {
  const page = await browser.newPage({
    viewport: { width, height: 844 },
    reducedMotion: mode === 'os' || mode === 'both' ? 'reduce' : 'no-preference',
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  })
  pages.add(page)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(debugURL())
  if (mode === 'manual' || mode === 'both') {
    await page.getByRole('button', { name: 'Motion full', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  for (let current = 1; current < round; current += 1) {
    await page.getByRole('button', { name: 'Next round', exact: true }).click()
  }
  assert.equal(await page.locator('.hud .stat').nth(4).innerText(), `ROUND\n${round}/10`)
  return page
}

async function closePage(page) {
  pages.delete(page)
  await page.close()
}

async function transformOf(locator) {
  return locator.evaluate((element) => element.style.transform)
}

async function assertTransform(locator, expected, context) {
  const actual = await transformOf(locator)
  assert.equal(actual, expected, `${context}: expected transform ${expected}, got ${actual}`)
}

async function assertCheckboxContained(locator, context) {
  await locator.page().waitForTimeout(250)
  const geometry = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const widget = element.closest('.widget')
    const area = widget.getBoundingClientRect()
    const style = getComputedStyle(widget)
    const left = area.left + parseFloat(style.paddingLeft)
    const right = area.right - parseFloat(style.paddingRight)
    const top = area.top + parseFloat(style.paddingTop)
    const bottom = area.bottom - parseFloat(style.paddingBottom)
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return {
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      area: { left, right, top, bottom },
      hit: Boolean(hit && (hit === element || element.contains(hit))),
    }
  })
  assert.ok(geometry.box.left >= geometry.area.left - 1 && geometry.box.right <= geometry.area.right + 1, `${context}: checkbox escapes padded widget: ${JSON.stringify(geometry)}`)
  assert.ok(geometry.box.top >= geometry.area.top - 1 && geometry.box.bottom <= geometry.area.bottom + 1, `${context}: checkbox escapes vertical play area: ${JSON.stringify(geometry)}`)
  assert.equal(geometry.hit, true, `${context}: checkbox center is not hit-testable`)
}

async function assertRequestedViewportWidth(page, context) {
  const requested = page.viewportSize().width
  const geometry = await page.evaluate((width) => ({
    requested: width,
    client: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }), requested)
  assert.ok(geometry.document <= requested + 1, `${context}: document scrollWidth ${geometry.document} exceeds requested ${requested}px (clientWidth ${geometry.client})`)
  assert.ok(geometry.body <= requested + 1, `${context}: body scrollWidth ${geometry.body} exceeds requested ${requested}px`)
}

async function assertReduced(page, label) {
  await page.waitForFunction(() => document.querySelector('.app')?.classList.contains('reduce-motion'))
  assert.equal(await page.locator('.app').evaluate((element) => element.classList.contains('reduce-motion')), true, `${label}: effective reduced-motion class`)
}

async function assertFullRootMotion(page, label) {
  const animation = await page.locator('.app').evaluate((element) => getComputedStyle(element, '::after').animationName)
  assert.equal(animation, 'crt-flicker', `${label}: full-motion root CRT flicker`)
}

try {
  for (const mode of ['manual', 'os', 'both', 'full']) {
    const reduced = mode !== 'full'
    const page = await openRun({ mode, round: 2 })
    const checkbox = page.locator('.checkbox').first()
    await checkbox.click()
    await assertTransform(checkbox, reduced ? 'translate(0px, 0px)' : 'translate(110px, 34px)', `round 2 ${mode}, activation 1`)
    await assertCheckboxContained(checkbox, `round 2 ${mode}, activation 1`)
    if (reduced) {
      await checkbox.click()
      assert.equal(await page.locator('.hud .stat').nth(4).innerText(), 'ROUND\n3/10', `round 2 ${mode}: reduced checkbox remains operable`)
    } else {
      await checkbox.click()
      await assertTransform(checkbox, 'translate(-96px, 58px)', `round 2 ${mode}, activation 2`)
      await assertCheckboxContained(checkbox, `round 2 ${mode}, activation 2`)
      await checkbox.click()
      assert.equal(await page.locator('.hud .stat').nth(4).innerText(), 'ROUND\n3/10', `round 2 ${mode}: full-motion checkbox remains operable`)
    }
    await closePage(page)
    console.log(`PASS: round 2 ${mode} preference and activation offsets.`)
  }

  for (const mode of ['manual', 'os', 'both', 'full']) {
    const reduced = mode !== 'full'
    const page = await openRun({ mode, round: 10 })
    const checkbox = page.locator('.final-box')
    const activations = reduced ? 2 : 3
    for (let activation = 1; activation <= activations; activation += 1) {
      await checkbox.click()
      const expected = reduced || activation === activations ? 'translate(0px, 0px)' : activation === 1 ? 'translate(110px, 34px)' : 'translate(-96px, 58px)'
      await assertTransform(checkbox, expected, `round 10 ${mode}, activation ${activation}`)
      await assertCheckboxContained(checkbox, `round 10 ${mode}, activation ${activation}`)
    }
    assert.equal(await page.getByRole('button', { name: 'I am human', exact: true }).count(), 1, `round 10 ${mode}: freezes and reveals final choices`)
    assert.equal(await page.locator('.choices button').count(), 3)
    if (reduced) {
      await assertReduced(page, `round 10 ${mode}`)
      assert.equal(await page.locator('.app').evaluate((element) => getComputedStyle(element, '::after').animationName), 'none', `round 10 ${mode}: root CRT flicker disabled`)
    }
    else await assertFullRootMotion(page, 'round 10 full')
    await closePage(page)
    console.log(`PASS: round 10 ${mode} freeze offsets, choices, and root motion.`)
  }

  for (const [choice, title] of [
    ['I am human', 'VERIFIED: HUMAN'],
    ['I am trying', 'STATUS: PROBABLY HUMAN'],
    ['Does it matter', 'GHOST IN THE FORM'],
  ]) {
    const page = await openRun({ mode: 'manual', round: 10 })
    const checkbox = page.locator('.final-box')
    await checkbox.click()
    await checkbox.click()
    await page.getByRole('button', { name: choice, exact: true }).click()
    assert.equal(await page.getByRole('heading', { name: title, exact: true }).count(), 1, `final branch ${choice} reaches ${title}`)
    await closePage(page)
  }
  console.log('PASS: all three final choices still reach their existing endings.')

  {
    const page = await openRun({ mode: 'full', round: 2 })
    const checkbox = page.locator('.checkbox').first()
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 123, clientY: 222 })))
    assert.ok(await page.locator('.trail-dot').count() > 0, 'full motion shows the cursor trail')
    await checkbox.click()
    await assertTransform(checkbox, 'translate(110px, 34px)', 'dynamic preference before OS change')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await assertReduced(page, 'dynamic OS reduction')
    await page.waitForFunction(() => !document.querySelector('.trail-dot'))
    assert.equal(await page.locator('.app').evaluate((element) => getComputedStyle(element, '::after').animationName), 'none', 'dynamic OS reduction disables root CRT flicker')
    await checkbox.click()
    assert.equal(await page.locator('.hud .stat').nth(4).innerText(), 'ROUND\n3/10', 'dynamic OS reduction updates round 2 behavior')
    await page.getByRole('button', { name: 'Next round', exact: true }).click()
    for (let current = 3; current < 10; current += 1) await page.getByRole('button', { name: 'Next round', exact: true }).click()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForFunction(() => !document.querySelector('.app')?.classList.contains('reduce-motion'))
    await assertFullRootMotion(page, 'dynamic OS preference restored')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await assertReduced(page, 'dynamic OS reduction restored')
    await page.locator('.app').waitFor({ state: 'visible' })
    assert.equal(await page.locator('.app').evaluate((element) => getComputedStyle(element, '::after').animationName), 'none')
    await closePage(page)
    console.log('PASS: live OS preference changes update effective mode and root CRT motion.')
  }

  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' })
    pages.add(page)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(debugURL())
    await page.getByRole('button', { name: 'Motion full', exact: true }).click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    assert.equal(await page.getByRole('button', { name: 'Motion reduced', exact: true }).count(), 1, 'OS changes preserve the manual setting')
    await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
    await page.getByRole('button', { name: 'Next round', exact: true }).click()
    const checkbox = page.locator('.checkbox').first()
    await checkbox.click()
    await assertTransform(checkbox, 'translate(0px, 0px)', 'manual setting retained after OS changes')
    await closePage(page)
    console.log('PASS: OS preference changes preserve the separate manual motion setting.')
  }

  {
    const page = await openRun({ mode: 'manual', round: 2 })
    const checkbox = page.locator('.checkbox').first()
    await checkbox.focus()
    await checkbox.press('Enter')
    await assertTransform(checkbox, 'translate(0px, 0px)', 'keyboard activation')
    await checkbox.press('Enter')
    assert.equal(await page.locator('.hud .stat').nth(4).innerText(), 'ROUND\n3/10', 'keyboard can complete reduced-motion checkbox')
    await closePage(page)
    console.log('PASS: keyboard activation remains operable with reduced motion.')
  }

  for (const width of [320, 390]) {
    const page = await openRun({ mode: 'os', round: 10, width, mobile: true })
    const checkbox = page.locator('.final-box')
    const box = await checkbox.boundingBox()
    assert.ok(box && box.height >= 44, `final checkbox meets 44px target at ${width}px`)
    await assertRequestedViewportWidth(page, `round 10 before choice at ${width}px`)
    await checkbox.tap()
    await assertTransform(checkbox, 'translate(0px, 0px)', `touch activation at ${width}px`)
    await checkbox.tap()
    const choices = page.locator('.choices button')
    const choiceBox = await choices.first().boundingBox()
    assert.ok(choiceBox && choiceBox.height >= 44, `final choice meets 44px target at ${width}px`)
    await choices.first().tap()
    assert.equal(await page.getByText('VERIFICATION COMPLETE', { exact: true }).count(), 1, `touch choice works at ${width}px`)
    await assertRequestedViewportWidth(page, `ending at ${width}px`)
    await closePage(page)
    console.log(`PASS: ${width}px touch targets, final interaction, and horizontal overflow.`)
  }

  {
    const page = await openRun({ mode: 'full', round: 2, width: 1440 })
    const checkbox = page.locator('.checkbox').first()
    await checkbox.click()
    await assertTransform(checkbox, 'translate(110px, 34px)', 'desktop round 2 raw dodge 1')
    await page.waitForTimeout(250)
    assert.match(await checkbox.evaluate((element) => getComputedStyle(element).transform), /matrix\(1, 0, 0, 1, 110, 34\)/, 'desktop preserves the full raw first dodge transform')
    await checkbox.click()
    await assertTransform(checkbox, 'translate(-96px, 58px)', 'desktop round 2 raw dodge 2')
    await page.waitForTimeout(250)
    assert.match(await checkbox.evaluate((element) => getComputedStyle(element).transform), /matrix\(1, 0, 0, 1, -96, 58\)/, 'desktop preserves the full raw second dodge transform')
    await closePage(page)
    console.log('PASS: desktop keeps the original raw checkbox dodge distances.')
  }

  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join('; ')}`)
  console.log('PASS: no browser page errors.')
} finally {
  await Promise.all([...pages].map((page) => page.close()))
  await browser.close()
}
