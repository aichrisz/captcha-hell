import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const playwrightModule = process.env.PLAYWRIGHT_MODULE
const baseURL = process.env.BASE_URL
const evidenceDir = process.env.EVIDENCE_DIR
assert.ok(playwrightModule, 'Set PLAYWRIGHT_MODULE to an installed Playwright module path.')
assert.ok(baseURL, 'Set BASE_URL to the running app URL, including its base path.')
assert.ok(evidenceDir, 'Set EVIDENCE_DIR to the designated artifact directory.')

const ENDINGS_KEY = 'captcha-hell.endings.v1'
const BEST_KEY = 'captcha-hell.best.v1'
const endingTitles = {
  tooPerfect: 'ANOMALY: TOO PERFECT',
  verified: 'VERIFIED: HUMAN',
  probablyHuman: 'STATUS: PROBABLY HUMAN',
  ghost: 'GHOST IN THE FORM',
  rejected: 'APPLICATION REJECTED',
  flagged: 'ACCOUNT FLAGGED',
}
const { chromium } = await import(playwrightModule)
const browser = await chromium.launch({ headless: true })
const contexts = new Set()
const pages = new Set()
const pageErrors = []
const results = []
const normalEndingIds = []
const clerkEntryTitles = []
const screenshotsDir = path.join(evidenceDir, 'screenshots')
const focusedOnly = process.env.REPLAY_CRITERION === 'focused-disclosure'
await mkdir(screenshotsDir, { recursive: true })

function pageURL(debug = false) {
  const url = new URL(baseURL)
  if (debug) url.searchParams.set('debug', '1')
  return url.toString()
}

async function openPage({ viewport = { width: 390, height: 844 }, clock = true, debug = false, mobile = false, initScript, initArg } = {}) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: 'no-preference',
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  })
  contexts.add(context)
  if (initScript) await context.addInitScript(initScript, initArg)
  const page = await context.newPage()
  pages.add(page)
  page.setDefaultTimeout(6000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()) })
  page.__captchaClockMode = clock ? 'controlled' : 'ordinary'
  if (clock) await page.clock.install()
  await page.goto(pageURL(debug))
  if (clock) await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  return { context, page }
}

async function closeContext(context) {
  contexts.delete(context)
  for (const page of context.pages()) pages.delete(page)
  await context.close()
}

async function start(page) {
  if (await page.getByRole('button', { name: 'Begin verification', exact: true }).count()) {
    await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  }
}

async function fileStampedDocuments(page) {
  for (const stamp of ['Witness', 'Copy', 'Redact']) await page.getByRole('button', { name: stamp, exact: true }).click()
  await page.getByRole('button', { name: 'File', exact: true }).click()
}

async function attachReceiptObserver(page) {
  await page.evaluate(() => {
    if (window.__receiptSemanticAudit) return
    const owner = document.querySelector('[data-receipt-announcer]')
    if (!owner) throw new Error('Persistent receipt owner missing')
    let previous = owner.textContent ?? ''
    const changes = []
    const observer = new MutationObserver(() => {
      const current = owner.textContent ?? ''
      if (current !== previous) {
        changes.push(current)
        previous = current
      }
    })
    observer.observe(owner, { childList: true, characterData: true, subtree: true })
    window.__receiptSemanticAudit = { changes, observer }
  })
}

async function receiptText(page) {
  return (await page.locator('[data-receipt-announcer]').textContent()) ?? ''
}

async function receiptChanges(page) {
  return page.evaluate(() => window.__receiptSemanticAudit.changes.slice())
}

async function waitReceipt(page, sequence) {
  await page.waitForFunction((number) =>
    document.querySelector('[data-receipt-announcer]')?.textContent?.startsWith(`Receipt ${number}:`), sequence)
}

async function readHud(page) {
  const rows = await page.locator('.hud .stat').evaluateAll((elements) =>
    elements.map((element) => element.innerText.split('\n').map((part) => part.trim())))
  return Object.fromEntries(rows.map(([label, value]) => [label.toLowerCase(), value]))
}

async function assertRound(page, round) {
  const hud = await readHud(page)
  assert.equal(hud.round, `${round}/10`, `round ${round} HUD: ${JSON.stringify(hud)}`)
}

async function expectCollectionBytes(page, expected) {
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), ENDINGS_KEY), expected)
}

async function waitForCollection(page, endingId) {
  await page.waitForFunction(({ key, id }) => {
    try { return JSON.parse(localStorage.getItem(key) ?? '[]').includes(id) } catch { return false }
  }, { key: ENDINGS_KEY, id: endingId })
}

async function inspectDossier(page, { count, titles = [], sessionOnly = false } = {}) {
  const dossier = page.locator('details.ending-dossier')
  await dossier.waitFor({ state: 'visible' })
  await page.waitForFunction((expected) =>
    document.querySelector('details.ending-dossier summary')?.textContent?.includes(`${expected} of 6`), count)
  if (!await dossier.evaluate((element) => element.open)) await dossier.locator('summary').click()
  const entries = await dossier.locator('li').allTextContents()
  assert.equal(entries.length, 6, 'fixed six-slot registry is displayed')
  for (const title of titles) assert.ok(entries.includes(title), `dossier displays discovered title ${title}`)
  if (sessionOnly) {
    const status = dossier.locator('.collection-status')
    assert.equal(await status.count(), 1, 'failed collection write has a status')
    assert.match(await status.textContent(), /session-only/i)
    assert.match(await status.textContent(), /Previously saved endings remain/i)
  } else {
    assert.equal(await dossier.locator('.collection-status').count(), 0)
  }
  return entries
}

async function assertStartDossier(page) {
  const dossier = page.locator('details.ending-dossier')
  assert.equal(await dossier.count(), 1, 'native dossier is present on start')
  assert.match(await dossier.locator('summary').textContent(), /0 of 6/i)
  const entries = await dossier.locator('li').allTextContents()
  assert.deepEqual(entries, Array(6).fill('Sealed verdict'), 'unknown ending names remain sealed')
}

async function assertNoDebug(page) {
  assert.equal(new URL(page.url()).searchParams.has('debug'), false, 'normal reachability journey has no debug query')
  assert.equal(await page.locator('.debug').count(), 0, 'normal reachability journey exposes no debug controls')
}

async function assertNoHorizontalOverflow(page, label) {
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))
  const requested = page.viewportSize().width
  assert.ok(geometry.scrollWidth <= requested + 1 && geometry.bodyWidth <= requested + 1,
    `${label}: horizontal overflow ${JSON.stringify(geometry)} at ${requested}px`)
}

async function capture(page, name) {
  const destination = path.join(screenshotsDir, `${name}.png`)
  await page.screenshot({ path: destination, fullPage: true })
  return destination
}

async function captureViewport(page, name) {
  const destination = path.join(screenshotsDir, `${name}.png`)
  await page.screenshot({ path: destination, fullPage: false })
  return destination
}

async function assertHitTarget(page, locator, label) {
  await locator.scrollIntoViewIfNeeded()
  const geometry = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight, hit: Boolean(hit && (hit === element || element.contains(hit))) }
  })
  assert.ok(geometry.width > 0 && geometry.height > 0, `${label} is rendered: ${JSON.stringify(geometry)}`)
  assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewportWidth + 1, `${label} is horizontally visible: ${JSON.stringify(geometry)}`)
  assert.ok(geometry.top >= -1 && geometry.bottom <= geometry.viewportHeight + 1, `${label} is vertically visible after scrolling: ${JSON.stringify(geometry)}`)
  assert.equal(geometry.hit, true, `${label} is not obscured at its center: ${JSON.stringify(geometry)}`)
  if (await locator.evaluate((element) => element.tagName === 'BUTTON')) {
    assert.ok(geometry.width >= 44 && geometry.height >= 44, `${label} meets the 44px target: ${JSON.stringify(geometry)}`)
  }
  return geometry
}

async function runJourney(page, options) {
  const {
    endingId,
    mistakeRound1 = false,
    poster = 'poster',
    wrongHearing = false,
    finalAction = 'human',
    round8Method = 'click',
    auditNoop = false,
    textScale200 = false,
    debugSession = false,
    seededCollection = false,
    storageBlocked = false,
    blockedBytes = null,
    stopAfterHearing = false,
    finalPresentationAudit = false,
    ordinaryClock = false,
  } = options
  const clockMode = page.__captchaClockMode ?? 'controlled'
  assert.equal(clockMode, ordinaryClock ? 'ordinary' : 'controlled', 'journey clock configuration matches the executed clock path')
  const trace = []
  let sequence = 0
  const ownerHandle = options.ownerHandle ?? await page.locator('[data-receipt-announcer]').elementHandle()
  if (!debugSession) await assertNoDebug(page)
  if (await page.getByRole('button', { name: 'Begin verification', exact: true }).count()) {
    if (!debugSession && !seededCollection) {
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), ENDINGS_KEY), null,
        'normal six-ending journey starts without a seeded discovery')
      await assertStartDossier(page)
    }
    await attachReceiptObserver(page)
  }
  await start(page)
  await assertRound(page, 1)

  if (mistakeRound1) {
    await page.locator('.cell').nth(1).click()
    await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
    await waitReceipt(page, ++sequence)
    assert.match(await receiptText(page), /Rejected; retry available/)
    assert.equal(await page.locator('.cell').nth(1).getAttribute('aria-pressed'), 'true', 'grid selection remains intact across a retry')
    trace.push({ round: 1, action: 'wrong submission', selected: [1] })
    await page.locator('.cell').nth(1).click()
  }
  for (const index of [0, 4, 7]) await page.locator('.cell').nth(index).click()
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await waitReceipt(page, ++sequence)
  trace.push({ round: 1, action: 'submit', selected: [0, 4, 7], passed: true })
  await assertRound(page, 2)

  if (auditNoop) {
    const previousReceipt = await receiptText(page)
    const before = await receiptChanges(page)
    const appeal = page.locator('.appeal button')
    assert.equal(await appeal.isDisabled(), true, 'appeal is unavailable with no suspicion')
    await appeal.evaluate((button) => button.click())
    const flavorBefore = await page.locator('.flavor').textContent()
    await page.getByRole('button', { name: 'Sound on', exact: true }).click()
    await page.clock.runFor(5000)
    await page.waitForFunction((previous) => document.querySelector('.flavor')?.textContent !== previous, flavorBefore)
    assert.equal(await receiptText(page), previousReceipt, 'denied appeal, sound toggle, timer ticks and flavor rotation do not alter receipt')
    assert.deepEqual(await receiptChanges(page), before, 'non-verdict updates create no semantic receipt announcement')
    const hud = await readHud(page)
    assert.equal(hud.timer, '15s', 'five controlled seconds advanced the ordinary round timer')
    trace.push({ action: 'sound, disabled appeal and five-second flavor/timer update; receipt unchanged' })
  }

  const checkbox = page.locator('.checkbox').first()
  for (let click = 0; click < 3; click += 1) await checkbox.click()
  await waitReceipt(page, ++sequence)
  await page.getByRole('heading', { name: 'Select all squares with bicycles.' }).waitFor()
  trace.push({ round: 2, action: 'complete checkbox' })

  assert.equal(await page.getByText('Your interpretation will be kept on file.', { exact: true }).count(), 1)
  for (const index of [1, 3, 8]) await page.locator('.cell').nth(index).click()
  if (poster === 'bicycle') await page.locator('.cell').nth(5).click()
  const selectedRound3 = poster === 'bicycle' ? [1, 3, 5, 8] : [1, 3, 8]
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await waitReceipt(page, ++sequence)
  trace.push({ round: 3, action: 'submit interpretation', poster, selected: selectedRound3 })
  await assertRound(page, 4)

  if (ordinaryClock) await page.waitForTimeout(3450)
  else await page.clock.runFor(3450)
  await page.getByText('Verification window open. Click VERIFY now.', { exact: true }).waitFor()
  // This verified state intentionally pulses forever; force skips Playwright's stability wait, not the real pointer event.
  await page.locator('.verify').click({ force: true })
  await waitReceipt(page, ++sequence)
  trace.push({ round: 4, action: 'click VERIFY in real window', clockMode })
  await assertRound(page, 5)

  const slider = page.getByRole('slider', { name: 'alignment slider' })
  await slider.focus()
  await slider.press('Home')
  for (let step = 0; step < 62; step += 1) await slider.press('ArrowRight')
  assert.equal(await slider.inputValue(), '62')
  await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
  await waitReceipt(page, ++sequence)
  trace.push({ round: 5, action: 'align slider at target' })
  await assertRound(page, 6)

  await fileStampedDocuments(page)
  await waitReceipt(page, ++sequence)
  trace.push({ round: 6, action: 'witness, copy, redact and file' })
  await assertRound(page, 7)

  await page.getByRole('button', { name: 'Cry at a song from 2009', exact: true }).click()
  await waitReceipt(page, ++sequence)
  trace.push({ round: 7, action: 'choose human answer' })
  await assertRound(page, 8)

  const semanticOptions = page.locator('.semantic-choices button')
  assert.equal(await semanticOptions.count(), 2, 'round 8 with recorded round-3 interpretation renders exactly two semantic answers')
  assert.equal(await page.locator('.number-choices button').count(), 0, 'normal round 8 does not use the numeric fallback')
  const correctOption = poster === 'bicycle' ? 'I counted the poster as a bicycle' : 'I treated it as a poster'
  const wrongOption = poster === 'bicycle' ? 'I treated it as a poster' : 'I counted the poster as a bicycle'
  const hearingAnswer = wrongHearing ? wrongOption : correctOption
  const hearingButton = page.getByRole('button', { name: hearingAnswer, exact: true })
  if (round8Method === 'touch') await hearingButton.tap()
  else if (round8Method === 'keyboard') { await hearingButton.focus(); await hearingButton.press('Enter') }
  else await hearingButton.click()
  await waitReceipt(page, ++sequence)
  trace.push({ round: 8, action: 'semantic hearing answer', answer: hearingAnswer, correct: !wrongHearing, input: round8Method })
  if (wrongHearing) {
    assert.match(await receiptText(page), /Rejected; advanced after failure/)
    assert.match(await receiptText(page), /Strikes \+1/)
  }
  await assertRound(page, 9)
  const hudAfterHearing = await readHud(page)
  assert.equal(hudAfterHearing.strikes, wrongHearing ? '1' : mistakeRound1 ? '1' : '0',
    'semantic answer submits once; a wrong answer causes exactly one strike and advances')
  if (stopAfterHearing) {
    results.push({ scenario: 'wrong semantic hearing submits once and advances', passed: true, trace, receipt: await receiptText(page) })
    return { trace, receiptSequence: sequence }
  }

  for (let index = 0; index < 9; index += 1) await page.locator('.cell').nth(index).click()
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await waitReceipt(page, ++sequence)
  trace.push({ round: 9, action: 'submit all nine tiles' })
  await assertRound(page, 10)

  if (textScale200) await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
  const finalBox = page.locator('.final-box')
  assert.equal(await page.locator('.choices button').count(), 0, 'normal choices are unavailable before checkbox freeze')
  assert.equal(await page.getByRole('button', { name: 'Refuse verification', exact: true }).count(), 0, 'refusal is unavailable before checkbox freeze')
  const beforeFreezeReceipt = await receiptText(page)
  const beforeFreezeChanges = await receiptChanges(page)
  for (let click = 0; click < 3; click += 1) await finalBox.click()
  await page.locator('.choices button').first().waitFor()
  assert.equal(await page.locator('.choices button').count(), 3, 'all three existing final choices remain intact')
  const warning = page.locator('#refusal-warning')
  const refusal = page.getByRole('button', { name: 'Refuse verification', exact: true })
  assert.equal(await warning.textContent(), 'Sets suspicion to 100 and ends this run as ACCOUNT FLAGGED.')
  assert.equal(await refusal.getAttribute('aria-describedby'), 'refusal-warning')
  await finalBox.click()
  assert.equal(await receiptText(page), beforeFreezeReceipt, 'readiness and a frozen-checkbox no-op do not create receipts')
  assert.deepEqual(await receiptChanges(page), beforeFreezeChanges, 'readiness is not announced as a verdict')

  if (textScale200) {
    await warning.scrollIntoViewIfNeeded()
    const warningBox = await warning.boundingBox()
    const refusalBox = await refusal.boundingBox()
    assert.ok(warningBox && warningBox.width > 0 && warningBox.height > 0, '200% refusal warning remains visible and wraps')
    assert.ok(refusalBox && refusalBox.width >= 44 && refusalBox.height >= 44, 'refusal control remains a 44px target at 200% text')
    await assertNoHorizontalOverflow(page, '200% refusal disclosure')
  }

  let freezeScreenshot
  let freezeLayoutAudit
  if (finalPresentationAudit) {
    while (await page.locator('.popup button').count()) await page.locator('.popup button').first().click()
    const targets = []
    for (const [index, label] of ['I am human', 'I am trying', 'Does it matter'].entries()) {
      const choice = page.getByRole('button', { name: label, exact: true })
      targets.push({ label, geometry: await assertHitTarget(page, choice, `normal final statement ${index + 1} at ${page.viewportSize().width}px`) })
    }
    targets.push({ label: 'Refusal warning', geometry: await assertHitTarget(page, warning, `refusal warning at ${page.viewportSize().width}px`) })
    targets.push({ label: 'Refuse verification', geometry: await assertHitTarget(page, refusal, `secondary refusal at ${page.viewportSize().width}px`) })
    const panelOrder = await page.evaluate(() => {
      const choices = document.querySelector('.final-choice-actions')?.previousElementSibling?.classList.contains('choices')
      const panel = document.querySelector('.final-choice-actions')
      const warning = document.querySelector('#refusal-warning')
      const button = panel?.querySelector('button')
      const style = panel && warning && button ? {
        panelBackground: getComputedStyle(panel).backgroundColor,
        panelBorder: getComputedStyle(panel).borderColor,
        warningColor: getComputedStyle(warning).color,
        warningWeight: getComputedStyle(warning).fontWeight,
        refusalBackground: getComputedStyle(button).backgroundColor,
      } : null
      return { normalChoicesBeforeRefusal: choices === true, warningBeforeButton: Boolean(warning && button && (warning.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING)), style }
    })
    assert.equal(panelOrder.normalChoicesBeforeRefusal, true, 'secondary refusal follows the normal statement group in the DOM')
    assert.equal(panelOrder.warningBeforeButton, true, 'warning is adjacent and precedes the refusal control')
    if (textScale200) {
      const metrics = await warning.evaluate((element) => ({ height: element.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(element).fontSize), lineHeight: parseFloat(getComputedStyle(element).lineHeight) }))
      assert.ok(metrics.height >= metrics.fontSize * 1.5, `200% warning remains readable and wraps: ${JSON.stringify(metrics)}`)
    }
    await finalBox.focus()
    await page.keyboard.press('Tab')
    const keyboardOrder = []
    for (const label of ['I am human', 'I am trying', 'Does it matter', 'Refuse verification']) {
      const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim())
      assert.equal(focusedText, label, `keyboard order after freeze: expected ${label}, got ${focusedText}`)
      keyboardOrder.push(focusedText)
      if (label !== 'Refuse verification') await page.keyboard.press('Tab')
    }
    const warningAndControl = await page.evaluate(() => {
      const hud = document.querySelector('.hud')
      const warning = document.querySelector('#refusal-warning')
      const button = document.querySelector('.refusal-choice')
      if (!hud || !warning || !button) return null
      const rect = (element) => {
        const { left, right, top, bottom, width, height } = element.getBoundingClientRect()
        return { left, right, top, bottom, width, height }
      }
      const hudRect = rect(hud)
      const warningRect = rect(warning)
      const buttonRect = rect(button)
      const hit = (element, box) => {
        const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return Boolean(target && (target === element || element.contains(target)))
      }
      const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      const hudPosition = getComputedStyle(hud).position
      const effectiveTop = ['sticky', 'fixed'].includes(hudPosition) && hudRect.top <= 1 && hudRect.bottom > 0 ? hudRect.bottom : 0
      return {
        active: document.activeElement?.textContent?.trim(),
        hud: hudRect,
        hudPosition,
        effectiveTop,
        warning: warningRect,
        control: buttonRect,
        warningHit: hit(warning, warningRect),
        controlHit: hit(button, buttonRect),
        warningOverlapsHud: overlaps(warningRect, hudRect),
        controlOverlapsHud: overlaps(buttonRect, hudRect),
        viewport: { width: innerWidth, height: innerHeight },
      }
    })
    freezeScreenshot = await captureViewport(page, `frozen-final-${page.viewportSize().width}x${page.viewportSize().height}${textScale200 ? '-200-text' : ''}`)
    assert.ok(warningAndControl, 'warning and refusal are both present in focused frozen view')
    assert.equal(warningAndControl.active, 'Refuse verification', 'disclosure audit runs after actual Tab traversal')
    assert.ok(warningAndControl.warning.top >= warningAndControl.effectiveTop - 1 && warningAndControl.warning.bottom <= warningAndControl.viewport.height + 1, `warning is inside the HUD-clear viewport with focused refusal: ${JSON.stringify(warningAndControl)}`)
    assert.ok(warningAndControl.control.top >= warningAndControl.effectiveTop - 1 && warningAndControl.control.bottom <= warningAndControl.viewport.height + 1, `refusal is inside the HUD-clear viewport with its warning: ${JSON.stringify(warningAndControl)}`)
    assert.equal(warningAndControl.warningOverlapsHud, false, `warning overlaps the HUD: ${JSON.stringify(warningAndControl)}`)
    assert.equal(warningAndControl.controlOverlapsHud, false, `refusal overlaps the HUD: ${JSON.stringify(warningAndControl)}`)
    assert.equal(warningAndControl.warningHit, true, `warning is obscured at its center after focus: ${JSON.stringify(warningAndControl)}`)
    assert.equal(warningAndControl.controlHit, true, `refusal is obscured at its center after focus: ${JSON.stringify(warningAndControl)}`)
    assert.ok(warningAndControl.warning.bottom <= warningAndControl.control.top + 2, `warning stays adjacent above refusal: ${JSON.stringify(warningAndControl)}`)
    freezeLayoutAudit = { viewport: page.viewportSize(), normalChoicesBeforeRefusal: panelOrder.normalChoicesBeforeRefusal, warningBeforeButton: panelOrder.warningBeforeButton, panelStyle: panelOrder.style, keyboardOrder, warningAndControl, targets, screenshot: freezeScreenshot }
  }

  const beforeFinal = await readHud(page)
  let expectedTitle
  if (finalAction === 'refuse') {
    if (options.finalKeyboard) {
      await finalBox.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      assert.equal(await refusal.evaluate((element) => document.activeElement === element), true, 'keyboard focus reaches refusal after frozen checkbox')
      await page.keyboard.press('Enter')
    } else {
      await refusal.click()
    }
    expectedTitle = endingTitles.flagged
  } else {
    const choices = {
      human: ['I am human', endingId === 'tooPerfect' ? endingTitles.tooPerfect : endingTitles.verified],
      trying: ['I am trying', endingTitles.probablyHuman],
      matter: ['Does it matter', endingTitles.ghost],
    }
    const [label, title] = choices[finalAction]
    const choice = page.getByRole('button', { name: label, exact: true })
    if (options.finalInput === 'keyboard') { await choice.focus(); await choice.press('Enter') }
    else if (options.finalInput === 'touch') await choice.tap()
    else await choice.click()
    expectedTitle = title
  }
  trace.push({ round: 10, action: 'final action', answer: finalAction, input: finalAction === 'refuse' ? (options.finalKeyboard ? 'keyboard' : 'pointer') : (options.finalInput ?? 'pointer'), classification: expectedTitle })
  await waitReceipt(page, ++sequence)
  await page.locator('.ending h1').waitFor()
  const actualTitle = await page.locator('.ending h1').innerText()
  assert.equal(actualTitle, expectedTitle, `actual reducer-selected ending for ${endingId}`)
  assert.equal(await page.locator('[data-receipt-announcer]').count(), 1, 'one receipt owner remains across terminal phase')
  const owner = page.locator('[data-receipt-announcer]')
  const liveText = await receiptText(page)
  assert.match(liveText, new RegExp(`^Receipt ${sequence}:`))
  assert.ok((await page.locator('.ending .verdict-receipt').innerText()).includes(`Round 10: ${finalAction === 'refuse' ? 'Verification refused; account flagged' : `Final classification: ${expectedTitle}`}`))
  if (finalAction === 'refuse') {
    assert.ok(liveText.includes('Verification refused; account flagged'), 'live receipt identifies the refusal outcome')
    assert.match(liveText, new RegExp(`Suspicion \\+${100 - Number(beforeFinal.suspicion)}\\.`))
    assert.doesNotMatch(liveText, /Score|Strikes/)
    assert.equal(await page.locator('.result dd').nth(0).innerText(), beforeFinal.score, 'refusal leaves score unchanged')
    assert.equal(await page.locator('.result dd').nth(1).innerText(), `${beforeFinal.strikes}/3`, 'refusal leaves strikes unchanged')
  }
  assert.equal(await page.locator('[data-receipt-announcer]').evaluate((element, original) => element === original, ownerHandle), true,
    'the existing live-region owner persists from start through play to ending')

  if (textScale200) {
    const layout = await page.evaluate(() => {
      const width = document.documentElement.clientWidth
      const items = [...document.querySelectorAll('body *')].map((element) => {
        const rect = element.getBoundingClientRect()
        return { tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', text: element.textContent?.trim().slice(0, 70), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX }
      })
      const offenders = items.filter((element) => element.left < -1 || element.right > width + 1 || (element.clientWidth && element.scrollWidth > element.clientWidth + 1)).slice(0, 20)
      return { width, bodyWidth: document.body.clientWidth, bodyScrollWidth: document.body.scrollWidth, scrollWidth: document.documentElement.scrollWidth, offenders }
    })
    await page.screenshot({ path: path.join(screenshotsDir, 'flagged-200-percent-debug.png'), fullPage: true })
    assert.ok(layout.scrollWidth <= page.viewportSize().width + 1, `ending layout reflows at 200% text without horizontal overflow: ${JSON.stringify(layout)}`)
  }

  let durableBytes = await page.evaluate((key) => localStorage.getItem(key), ENDINGS_KEY)
  if (storageBlocked) {
    assert.equal(durableBytes, blockedBytes, 'failed write preserves exact previous durable bytes')
    await inspectDossier(page, { count: 2, titles: [endingTitles.ghost, expectedTitle], sessionOnly: true })
  } else if (debugSession) {
    assert.equal(durableBytes, blockedBytes, 'debug session cannot mutate collection bytes')
    await inspectDossier(page, { count: 1, titles: [endingTitles.ghost] })
  } else {
    await waitForCollection(page, endingId)
    durableBytes = await page.evaluate((key) => localStorage.getItem(key), ENDINGS_KEY)
    const durableIds = JSON.parse(durableBytes)
    assert.deepEqual(durableIds, [endingId], 'normal terminal outcome persists one unique ending ID')
    await inspectDossier(page, { count: 1, titles: [expectedTitle] })
  }
  assert.equal((await receiptChanges(page)).at(-1), liveText, 'collection persistence rerender does not duplicate the receipt update')

  if (!debugSession && !seededCollection && !storageBlocked) await assertClerkRoundTrip(page, expectedTitle)

  if (auditNoop) {
    const expectedChanges = await receiptChanges(page)
    assert.equal(expectedChanges.length, sequence, 'only accepted verdicts create semantic receipt text updates')
  }
  const screenshotPrefix = debugSession ? 'debug-ordinary' : storageBlocked ? 'storage-blocked' : 'normal'
  const screenshot = await capture(page, `${screenshotPrefix}-${endingId}`)
  const scores = await page.locator('.result dd').allTextContents()
  const result = { endingId, title: expectedTitle, clockMode, trace, receipt: liveText, receiptSequence: sequence, collectionBytes: durableBytes, resultValues: scores, screenshot, freezeScreenshot, freezeLayoutAudit }
  results.push(result)
  if (!debugSession && !seededCollection) normalEndingIds.push(endingId)
  return result
}

async function assertClerkRoundTrip(page, expectedTitle) {
  const snapshot = async () => page.evaluate(() => ({
    title: document.querySelector('.ending h1')?.textContent?.trim(),
    results: [...document.querySelectorAll('.ending .result dd')].map((element) => element.textContent?.trim()),
    receipt: document.querySelector('.ending .verdict-receipt')?.textContent?.trim(),
    dossier: document.querySelector('.ending .ending-dossier')?.textContent?.trim(),
    liveReceipt: document.querySelector('[data-receipt-announcer]')?.textContent?.trim(),
    storage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key) => key !== null).sort().map((key) => [key, localStorage.getItem(key)])),
  }))
  const before = await snapshot()
  const trigger = page.getByRole('button', { name: 'Acting Clerk', exact: true })
  await trigger.click()
  await page.getByRole('heading', { name: 'Acting Clerk', exact: true }).waitFor()
  assert.equal(await page.locator('.clerk-notice').textContent(), 'Training only. Your verdict and best score do not change.')
  await page.getByRole('button', { name: 'Back to verdict', exact: true }).click()
  await page.getByRole('heading', { name: expectedTitle, exact: true }).waitFor()
  assert.equal(await trigger.evaluate((button) => document.activeElement === button), true, 'closing clerk restores trigger focus')
  assert.deepEqual(await snapshot(), before, `${expectedTitle}: optional clerk leaves exact verdict, stats, receipt, dossier, and storage unchanged`)
  clerkEntryTitles.push(expectedTitle)
}

async function runRejected() {
  const { context, page } = await openPage()
  await assertNoDebug(page)
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), ENDINGS_KEY), null, 'rejected journey begins with no seeded collection')
  await assertStartDossier(page)
  await attachReceiptObserver(page)
  await start(page)
  const owner = page.locator('[data-receipt-announcer]')
  const ownerHandle = await owner.elementHandle()
  const trace = []
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.locator('.cell').nth(1).click()
    await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
    await waitReceipt(page, attempt)
    const text = await receiptText(page)
    if (attempt < 3) assert.match(text, /Rejected; retry available/)
    else assert.match(text, /run ended/i)
    trace.push({ round: 1, action: 'actual wrong grid submission', attempt, receipt: text })
  }
  await page.getByRole('heading', { name: endingTitles.rejected, exact: true }).waitFor()
  assert.match(await receiptText(page), /^Receipt 3: Rejected; run ended\. Round 1\./, 'terminal wrong submission preserves its cause')
  assert.ok((await page.locator('.verdict-receipt').innerText()).includes('Round 1: Rejected; run ended'), 'visible terminal receipt names its source round and cause')
  assert.equal(await owner.evaluate((element, original) => element === original, ownerHandle), true)
  await waitForCollection(page, 'rejected')
  assert.deepEqual(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), ENDINGS_KEY)), ['rejected'])
  await inspectDossier(page, { count: 1, titles: [endingTitles.rejected] })
  await assertClerkRoundTrip(page, endingTitles.rejected)
  const screenshot = await capture(page, 'normal-rejected')
  const result = { endingId: 'rejected', title: endingTitles.rejected, trace, receipt: await receiptText(page), screenshot }
  results.push(result)
  normalEndingIds.push('rejected')
  await closeContext(context)
  return result
}

async function runAppealClamp() {
  const { context, page } = await openPage()
  await assertNoDebug(page)
  await attachReceiptObserver(page)
  await start(page)
  await page.locator('.cell').nth(1).click()
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await waitReceipt(page, 1)
  await page.locator('.cell').nth(1).click()
  for (const index of [0, 4, 7]) await page.locator('.cell').nth(index).click()
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await waitReceipt(page, 2)
  const appeal = page.getByRole('button', { name: 'Appeal verdict', exact: true })
  assert.equal(await appeal.isEnabled(), true)
  await appeal.click()
  await waitReceipt(page, 3)
  const text = await receiptText(page)
  assert.match(text, /^Receipt 3: Appeal accepted\. Round 2\. Score -50\. Suspicion -10\.$/)
  const changes = await receiptChanges(page)
  await appeal.evaluate((button) => button.click())
  assert.equal(await receiptText(page), text, 'denied second appeal does not alter the receipt')
  assert.deepEqual(await receiptChanges(page), changes, 'denied second appeal does not announce a new receipt')
  results.push({ scenario: 'natural appeal clamp from 10 suspicion', passed: true, receipt: text })
  await closeContext(context)
}

async function runSliderThirdMiss() {
  const { context, page } = await openPage({ debug: true })
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  for (let round = 1; round < 5; round += 1) await page.getByRole('button', { name: 'Next round', exact: true }).dispatchEvent('click')
  const slider = page.getByRole('slider', { name: 'alignment slider' })
  await slider.press('Home')
  for (let miss = 1; miss <= 3; miss += 1) {
    await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
    if (miss < 3) await page.getByText(`Misses: ${miss}/3`, { exact: true }).waitFor()
  }
  await page.getByText('Misses: 0/3', { exact: true }).waitFor()
  const hud = await readHud(page)
  assert.equal(hud.round, '5/10')
  assert.equal(hud.strikes, '1', 'third miss creates exactly one strike and retries')
  assert.equal(hud.timer, '15s')
  assert.equal(await slider.inputValue(), '0', 'third-miss retry retains slider value')
  assert.equal(await page.locator('.slider-tolerance').evaluate((element) => element.style.width), '16%', 'third-miss retry restores initial tolerance')
  assert.match(await receiptText(page), /Rejected; retry available\. Round 5\. Strikes \+1\./)
  results.push({ scenario: 'slider third-miss retry reset', passed: true, hud, retainedValue: await slider.inputValue() })
  await closeContext(context)
}

async function runAdvancedExpiryReason() {
  const { context: expiredContext, page: expiredPage } = await openPage({ debug: true })
  await expiredPage.getByRole('button', { name: 'Begin verification', exact: true }).click()
  for (let round = 1; round < 8; round += 1) await expiredPage.getByRole('button', { name: 'Next round', exact: true }).dispatchEvent('click')
  await assertRound(expiredPage, 8)
  await expiredPage.clock.runFor(20_000)
  await waitReceipt(expiredPage, 1)
  const expiryReceipt = await receiptText(expiredPage)
  assert.equal(expiryReceipt, 'Receipt 1: Time expired; advanced after failure. Round 8. Strikes +1.')
  assert.ok((await expiredPage.locator('.verdict-receipt').innerText()).includes('Round 8: Time expired; advanced after failure'), 'visible advancing-expiry receipt retains cause and source round')
  await closeContext(expiredContext)

  const { context: submitContext, page: submitPage } = await openPage({ debug: true })
  await submitPage.getByRole('button', { name: 'Begin verification', exact: true }).click()
  for (let round = 1; round < 8; round += 1) await submitPage.getByRole('button', { name: 'Next round', exact: true }).dispatchEvent('click')
  const numericOptions = await submitPage.locator('.number-choices button').allTextContents()
  assert.equal(numericOptions.length, 4, 'debug jump retains numeric recall when history is absent')
  const wrong = numericOptions.find((value) => value !== '3')
  await submitPage.getByRole('button', { name: wrong, exact: true }).click()
  await waitReceipt(submitPage, 1)
  const submitReceipt = await receiptText(submitPage)
  assert.equal(submitReceipt, 'Receipt 1: Rejected; advanced after failure. Round 8. Strikes +1.')
  assert.notEqual(expiryReceipt, submitReceipt, 'timeout and wrong submission are distinguishable')
  results.push({ scenario: 'round-8 advancing timeout is distinguishable from wrong submission', passed: true, expiryReceipt, submitReceipt })
  await closeContext(submitContext)
}

async function runSliderExpiry() {
  const { context, page } = await openPage({ debug: true })
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  for (let round = 1; round < 5; round += 1) await page.getByRole('button', { name: 'Next round', exact: true }).dispatchEvent('click')
  const slider = page.getByRole('slider', { name: 'alignment slider' })
  await slider.press('Home')
  for (let miss = 0; miss < 2; miss += 1) await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
  assert.equal(await page.getByText('Misses: 2/3', { exact: true }).count(), 1)
  assert.equal(await page.locator('.slider-tolerance').evaluate((element) => element.style.width), '4%')
  await page.clock.runFor(15_000)
  await page.waitForFunction(() => document.querySelector('.hud .stat:nth-of-type(5) strong')?.textContent === '5/10')
  const hud = await readHud(page)
  assert.equal(hud.strikes, '1', 'slider expiry causes exactly one strike')
  assert.equal(hud.timer, '15s')
  await page.getByText('Misses: 0/3', { exact: true }).waitFor()
  assert.equal(await slider.inputValue(), '0', 'expiry retry retains slider value')
  assert.equal(await page.locator('.slider-tolerance').evaluate((element) => element.style.width), '16%', 'expiry retry restores initial tolerance')
  results.push({ scenario: 'slider timer retry reset', passed: true, hud, retainedValue: await slider.inputValue() })
  await closeContext(context)
}

async function runRepeatedExpiryReceipts() {
  const { context, page } = await openPage()
  await assertNoDebug(page)
  await attachReceiptObserver(page)
  await start(page)
  const ownerHandle = await page.locator('[data-receipt-announcer]').elementHandle()
  await page.clock.runFor(20_000)
  await waitReceipt(page, 1)
  const first = await receiptText(page)
  assert.match(first, /Run ended|retry available/)
  await page.clock.runFor(20_000)
  await waitReceipt(page, 2)
  const second = await receiptText(page)
  assert.equal(second.replace('Receipt 2:', 'Receipt 1:'), first, 'identical expiry outcomes remain distinct by accessible sequence')
  await page.clock.runFor(20_000)
  await waitReceipt(page, 3)
  await page.getByRole('heading', { name: endingTitles.rejected, exact: true }).waitFor()
  const third = await receiptText(page)
  assert.match(third, /^Receipt 3: Time expired; run ended\. Round 1\. Strikes \+1\.$/)
  assert.ok((await page.locator('.ending .verdict-receipt').innerText()).includes('Round 1: Time expired; run ended'), 'visible terminal expiry retains its cause and source round')
  assert.deepEqual(await receiptChanges(page), [first, second, third], 'each expiry creates one semantic receipt update, including terminal expiry')
  assert.equal(await page.locator('[data-receipt-announcer]').evaluate((element, original) => element === original, ownerHandle), true)
  await waitForCollection(page, 'rejected')
  assert.equal((await receiptChanges(page)).at(-1), third, 'terminal collection write does not duplicate receipt')
  results.push({ scenario: 'two identical expiry receipts and terminal third-expiry receipt', passed: true, receipts: [first, second, third] })
  await closeContext(context)
}

async function runBlockedReads() {
  const { context, page } = await openPage({ initScript: () => {
    Storage.prototype.getItem = function () { throw new Error('blocked read for regression') }
  } })
  await assertNoDebug(page)
  await assertStartDossier(page)
  assert.match(await page.locator('.best').textContent(), /no previous human detected/)
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  await assertRound(page, 1)
  results.push({ scenario: 'blocked best and collection reads fall back without a crash', passed: true })
  await closeContext(context)
}

async function runBlockedCollection() {
  const savedBest = JSON.stringify({ score: 999999, ending: 'ghost', at: 'saved-before-test' })
  const oldBytes = '["ghost"]'
  const { context, page } = await openPage({
    initScript: ({ key, bestKey, bytes, best }) => {
      localStorage.setItem(key, bytes)
      localStorage.setItem(bestKey, best)
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new Error('blocked collection write for regression')
        return original.call(this, name, value)
      }
    },
    initArg: { key: ENDINGS_KEY, bestKey: BEST_KEY, bytes: oldBytes, best: savedBest },
  })
  await assertNoDebug(page)
  await inspectDossier(page, { count: 1, titles: [endingTitles.ghost] })
  const first = await runJourney(page, {
    endingId: 'verified', mistakeRound1: true, poster: 'bicycle', finalAction: 'human',
    seededCollection: true, storageBlocked: true, blockedBytes: oldBytes,
  })
  assert.equal(first.title, endingTitles.verified)
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), ENDINGS_KEY), oldBytes, 'failed write leaves exact prior collection bytes untouched')
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), BEST_KEY), savedBest, 'valid higher best record is retained')
  await inspectDossier(page, { count: 2, titles: [endingTitles.ghost, endingTitles.verified], sessionOnly: true })
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  const retry = await runJourney(page, {
    endingId: 'verified', mistakeRound1: true, poster: 'bicycle', finalAction: 'human',
    seededCollection: true, storageBlocked: true, blockedBytes: oldBytes,
  })
  assert.equal(retry.title, endingTitles.verified)
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), ENDINGS_KEY), oldBytes, 'duplicate terminal outcome does not alter blocked durable bytes')
  await inspectDossier(page, { count: 2, titles: [endingTitles.ghost, endingTitles.verified], sessionOnly: true })
  results.push({ scenario: 'blocked collection writes retain session union across retry and duplicate ending', passed: true, oldBytes, bestBytes: savedBest })
  await closeContext(context)
}

async function runDebugExclusion() {
  const oldBytes = '["ghost"]'
  const initScript = (key) => localStorage.setItem(key, '["ghost"]')
  const { context, page } = await openPage({ debug: true, initScript, initArg: ENDINGS_KEY })
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), ENDINGS_KEY), oldBytes)
  assert.match(await page.locator('.ending-dossier summary').textContent(), /1 of 6/)
  await inspectDossier(page, { count: 1, titles: [endingTitles.ghost] })
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  await page.getByRole('button', { name: 'Force ending', exact: true }).click()
  await page.getByRole('heading', { name: endingTitles.probablyHuman, exact: true }).waitFor()
  await expectCollectionBytes(page, oldBytes)
  await inspectDossier(page, { count: 1, titles: [endingTitles.ghost] })
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  for (let round = 1; round < 10; round += 1) await page.getByRole('button', { name: 'Next round', exact: true }).dispatchEvent('click')
  const finalBox = page.locator('.final-box')
  for (let click = 0; click < 3; click += 1) await finalBox.click()
  await page.getByRole('button', { name: 'I am human', exact: true }).click()
  await page.getByRole('heading', { name: endingTitles.verified, exact: true }).waitFor()
  await expectCollectionBytes(page, oldBytes)
  await inspectDossier(page, { count: 1, titles: [endingTitles.ghost] })
  await closeContext(context)

  const { context: ordinaryContext, page: ordinaryPage } = await openPage({ debug: true, initScript, initArg: ENDINGS_KEY })
  const ordinary = await runJourney(ordinaryPage, {
    endingId: 'verified', mistakeRound1: true, poster: 'bicycle', finalAction: 'human',
    debugSession: true, seededCollection: true, blockedBytes: oldBytes,
  })
  assert.equal(ordinary.title, endingTitles.verified)
  await expectCollectionBytes(ordinaryPage, oldBytes)
  await inspectDossier(ordinaryPage, { count: 1, titles: [endingTitles.ghost] })
  results.push({ scenario: 'debug collection exclusion: Force ending, DEBUG_SET-assisted ending, ordinary play in debug session', passed: true, durableBytes: oldBytes })
  await closeContext(ordinaryContext)
}

try {
  if (focusedOnly) {
    const flagged = await openPage({ viewport: { width: 320, height: 740 }, mobile: true })
    flagged.pageOwner = await flagged.page.locator('[data-receipt-announcer]').elementHandle()
    await runJourney(flagged.page, {
      endingId: 'flagged', mistakeRound1: true, poster: 'bicycle', finalAction: 'refuse', finalKeyboard: true,
      ownerHandle: flagged.pageOwner, textScale200: true, finalPresentationAudit: true,
    })
    await assertNoHorizontalOverflow(flagged.page, 'focused 320px refusal disclosure')
    await closeContext(flagged.context)
  } else {
  // Six fresh, unseeded normal journeys. The full clean route uses a controlled clock;
  // this proves the game route, not human-speed performance.
  const perfect = await openPage({ mobile: true })
  perfect.pageOwner = await perfect.page.locator('[data-receipt-announcer]').elementHandle()
  await runJourney(perfect.page, {
    endingId: 'tooPerfect', poster: 'poster', finalAction: 'human', round8Method: 'touch',
    auditNoop: true, ownerHandle: perfect.pageOwner, finalInput: 'keyboard', finalPresentationAudit: true,
  })
  await perfect.page.reload()
  await perfect.page.getByRole('button', { name: 'Begin verification', exact: true }).waitFor()
  assert.match(await perfect.page.locator('.ending-dossier summary').textContent(), /1 of 6/)
  await inspectDossier(perfect.page, { count: 1, titles: [endingTitles.tooPerfect] })
  results.push({ scenario: 'successful collection survives reload and starts a fresh run', passed: true })
  await closeContext(perfect.context)

  const verified = await openPage({ viewport: { width: 412, height: 915 } })
  verified.pageOwner = await verified.page.locator('[data-receipt-announcer]').elementHandle()
  await runJourney(verified.page, {
    endingId: 'verified', mistakeRound1: true, poster: 'bicycle', finalAction: 'human',
    round8Method: 'keyboard', ownerHandle: verified.pageOwner, finalInput: 'keyboard', finalPresentationAudit: true,
  })
  await closeContext(verified.context)

  const probably = await openPage({ viewport: { width: 1440, height: 1000 } })
  probably.pageOwner = await probably.page.locator('[data-receipt-announcer]').elementHandle()
  await runJourney(probably.page, {
    endingId: 'probablyHuman', mistakeRound1: true, poster: 'poster', finalAction: 'trying',
    round8Method: 'click', ownerHandle: probably.pageOwner, finalPresentationAudit: true,
  })
  await closeContext(probably.context)

  const ghost = await openPage({ clock: false })
  ghost.pageOwner = await ghost.page.locator('[data-receipt-announcer]').elementHandle()
  await runJourney(ghost.page, {
    endingId: 'ghost', poster: 'poster', finalAction: 'matter',
    ownerHandle: ghost.pageOwner, ordinaryClock: true,
  })
  const ordinaryJourney = results.find((result) => result.endingId === 'ghost')
  assert.equal(ordinaryJourney.clockMode, 'ordinary', 'one complete normal ending used the ordinary browser clock')
  assert.equal(ordinaryJourney.trace.find((entry) => entry.round === 4).clockMode, 'ordinary', 'ordinary clock mode is captured in the full journey trace')
  await closeContext(ghost.context)

  const wrongHearing = await openPage()
  await runJourney(wrongHearing.page, {
    endingId: 'probablyHuman', poster: 'bicycle', wrongHearing: true, stopAfterHearing: true,
  })
  await closeContext(wrongHearing.context)

  await runRejected()

  const flagged = await openPage({ viewport: { width: 320, height: 740 }, mobile: true })
  flagged.pageOwner = await flagged.page.locator('[data-receipt-announcer]').elementHandle()
  await runJourney(flagged.page, {
    endingId: 'flagged', mistakeRound1: true, poster: 'bicycle', finalAction: 'refuse', finalKeyboard: true,
    ownerHandle: flagged.pageOwner, textScale200: true, finalPresentationAudit: true,
  })
  await assertNoHorizontalOverflow(flagged.page, 'flagged 320px ending')
  await closeContext(flagged.context)

  assert.deepEqual([...normalEndingIds].sort(), ['flagged', 'ghost', 'probablyHuman', 'rejected', 'tooPerfect', 'verified'].sort(),
    'all six actual no-debug, unseeded terminal journeys executed exactly once')
  assert.deepEqual([...clerkEntryTitles].sort(), [endingTitles.flagged, endingTitles.ghost, endingTitles.probablyHuman, endingTitles.rejected, endingTitles.tooPerfect, endingTitles.verified].sort(),
    'Acting Clerk entry and exact-state return are proven on all six natural endings')
  await runAppealClamp()
  await runAdvancedExpiryReason()
  await runSliderThirdMiss()
  await runSliderExpiry()
  await runRepeatedExpiryReceipts()
  await runBlockedReads()
  await runBlockedCollection()
  await runDebugExclusion()
  }
  assert.deepEqual(pageErrors, [], `browser page/console errors: ${pageErrors.join('; ')}`)

  await writeFile(path.join(evidenceDir, 'replay-results.json'), `${JSON.stringify({ baseURL, results, pageErrors, clerkEntryTitles }, null, 2)}\n`)
  console.log(focusedOnly
    ? `PASS: focused keyboard refusal disclosure at 320px/200% text. Evidence: ${evidenceDir}`
    : `PASS: six natural no-debug endings, opposite semantic recall keys, wrong-answer consequence, refusal, receipt stability, collection lifecycle, appeal clamp, slider expiry and debug exclusion. Evidence: ${evidenceDir}`)
} finally {
  await Promise.all([...contexts].map((context) => context.close()))
  await browser.close()
}
