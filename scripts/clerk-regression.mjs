import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const playwrightModule = process.env.PLAYWRIGHT_MODULE
const baseURL = process.env.BASE_URL
const evidenceDir = process.env.EVIDENCE_DIR
const mode = process.env.CLERK_MODE ?? 'all'
assert.ok(playwrightModule, 'Set PLAYWRIGHT_MODULE to the installed Playwright module.')
assert.ok(baseURL, 'Set BASE_URL to the running preview URL.')
assert.ok(evidenceDir, 'Set EVIDENCE_DIR to the Stage 3 evidence directory.')
const { chromium } = await import(playwrightModule)
const browser = await chromium.launch({ headless: true })
const contexts = new Set()
const pageErrors = []
const results = []
const failures = []
const screenshots = []
const screenshotsDir = path.join(evidenceDir, 'screenshots')
await mkdir(screenshotsDir, { recursive: true })

function urlFor(debug = false) {
  const url = new URL(baseURL)
  if (debug) url.searchParams.set('debug', '1')
  return url.toString()
}

async function openPage({ viewport = { width: 390, height: 844 }, reduced = false, debug = false, mobile = false, textScale200 = false } = {}) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  })
  contexts.add(context)
  await context.addInitScript(() => {
    const original = Storage.prototype.setItem
    window.__clerkStorageWrites = []
    Storage.prototype.setItem = function (key, value) {
      window.__clerkStorageWrites.push([String(key), String(value)])
      return original.call(this, key, value)
    }
  })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()) })
  await page.goto(urlFor(debug))
  if (textScale200) await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
  return { context, page }
}

async function closeContext(context) {
  contexts.delete(context)
  await context.close()
}

async function reachDebugEnding(page) {
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  await page.getByRole('button', { name: 'Force ending', exact: true }).click()
  await page.getByRole('heading', { name: 'STATUS: PROBABLY HUMAN', exact: true }).waitFor()
}

async function reachNaturalRejected(page) {
  assert.equal(new URL(page.url()).searchParams.has('debug'), false, 'normal clerk journey has no debug query')
  assert.equal(await page.locator('.debug').count(), 0, 'normal clerk journey has no debug panel')
  assert.equal(await page.getByRole('button', { name: 'Acting Clerk', exact: true }).count(), 0, 'desk is unavailable before an ending')
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.locator('.cell').nth(1).click()
    await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  }
  await page.getByRole('heading', { name: 'APPLICATION REJECTED', exact: true }).waitFor()
}

async function openClerk(page) {
  await page.getByRole('button', { name: 'Acting Clerk', exact: true }).click()
  await page.getByRole('heading', { name: 'Acting Clerk', exact: true }).waitFor()
  await page.getByRole('heading', { name: 'File A: Mira Vale', exact: true }).waitFor()
  assert.equal(await page.locator('.clerk-notice').textContent(), 'Training only. Your verdict and best score do not change.')
  assert.equal(await page.locator('.clerk-reset-note').textContent(), 'Training progress resets when you leave. No training result is saved.')
  assert.equal(await page.locator('[data-clerk-announcer]').count(), 1, 'one persistent desk status owner is present')
  assert.equal((await page.locator('[data-clerk-announcer]').textContent()).trim(), '', 'desk status owner starts empty')
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('clerk-case-heading')), true, 'case heading receives focus on desk mount')
}

async function storageSnapshot(page) {
  return page.evaluate(() => Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key) => key !== null).sort().map((key) => [key, localStorage.getItem(key)]),
  ))
}

async function verdictSnapshot(page) {
  return page.evaluate(() => ({
    title: document.querySelector('.ending h1')?.textContent?.trim(),
    results: [...document.querySelectorAll('.ending .result dd')].map((element) => element.textContent?.trim()),
    verdict: document.querySelector('.ending .verdict')?.textContent?.trim(),
    receipt: document.querySelector('.ending .verdict-receipt')?.textContent?.trim(),
    dossier: document.querySelector('.ending .ending-dossier')?.textContent?.trim(),
    liveReceipt: document.querySelector('[data-receipt-announcer]')?.textContent?.trim(),
  }))
}

async function capture(page, name) {
  const file = path.join(screenshotsDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  screenshots.push(file)
  return file
}

async function choose(page, decision, reason) {
  await page.getByRole('radio', { name: decision === 'accept' ? 'Accept' : 'Return', exact: true }).check()
  const reasonPattern = reason === 'no-defect' ? /No procedural defect/ : reason === 'copy-before-certification' ? /Copy made before certification/ : /Copy made after redaction/
  await page.getByRole('radio', { name: reasonPattern }).check()
}

async function submitReview(page, decision, reason, doubleClick = false) {
  const caseLabel = (await page.locator('.clerk-case-heading').innerText()).split(':', 1)[0]
  await choose(page, decision, reason)
  const record = page.getByRole('button', { name: 'Record decision', exact: true })
  assert.equal(await record.isDisabled(), false)
  if (doubleClick) await record.evaluate((button) => { button.click(); button.click() })
  else await record.click()
  await page.locator('[data-clerk-announcer] h3').waitFor()
  const status = await page.locator('[data-clerk-announcer]').innerText()
  const caseIdentity = `${caseLabel}: review recorded.`
  assert.equal(status.split(caseIdentity).length - 1, 1, `${caseLabel} identity must appear exactly once in the outcome status: ${status}`)
  assert.equal(await page.locator('.clerk-options input:not(:disabled)').count(), 0, 'recorded review locks both radio groups')
  assert.equal(await page.getByRole('button', { name: 'Next file', exact: true }).count() + await page.getByRole('button', { name: 'Finish shift', exact: true }).count(), 1, 'one advance control appears only after feedback')
  const nextAction = page.locator('.clerk-feedback + button')
  await assertFocused(page, nextAction, `${caseLabel} next action after production focus`)
  await assertFeedbackVisible(page, caseLabel)
  return status
}

async function advanceFile(page, last = false) {
  await page.getByRole('button', { name: last ? 'Finish shift' : 'Next file', exact: true }).click()
  if (!last) assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('clerk-case-heading')), true, 'next file heading receives focus')
  else assert.equal(await page.evaluate(() => document.activeElement?.id === 'clerk-summary-title'), true, 'summary heading receives focus')
}

async function completeSession(page, answers, { doubleFirst = false } = {}) {
  const feedback = []
  for (let index = 0; index < answers.length; index += 1) {
    const answer = answers[index]
    feedback.push(await submitReview(page, answer[0], answer[1], doubleFirst && index === 0))
    if (index < answers.length - 1) await advanceFile(page)
  }
  await advanceFile(page, true)
  return feedback
}

async function snapshotNoOverflow(page, label) {
  const measured = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const desk = document.querySelector('.clerk-desk')?.getBoundingClientRect()
    const text = [...document.querySelectorAll('.clerk-option span, .clerk-evidence dt, .clerk-evidence dd, .clerk-rules li, .clerk-feedback p, .clerk-summary-list p')].map((element) => {
      const rect = element.getBoundingClientRect()
      return { text: element.textContent?.trim().slice(0, 70), left: rect.left, right: rect.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
    })
    return { width, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, desk: desk && { left: desk.left, right: desk.right }, text }
  })
  const requested = page.viewportSize().width
  assert.ok(measured.document <= requested + 1 && measured.body <= requested + 1, `${label}: horizontal overflow ${JSON.stringify(measured)}`)
  for (const item of measured.text) {
    assert.ok(item.left >= (measured.desk?.left ?? 0) - 1 && item.right <= (measured.desk?.right ?? requested) + 1, `${label}: text escapes desk: ${JSON.stringify(item)}`)
    assert.ok(item.scrollWidth <= item.clientWidth + 1, `${label}: text box clips: ${JSON.stringify(item)}`)
  }
  return measured
}

async function assertWordsFit(page, selector, label) {
  const columns = await page.locator(selector).evaluateAll((elements) => {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return []
    return elements.map((element) => {
      const style = getComputedStyle(element)
      context.font = style.font
      const words = (element.textContent?.trim().match(/\S+/g) ?? []).map((word) => ({ word, width: context.measureText(word).width }))
      const longest = words.reduce((largest, item) => item.width > largest.width ? item : largest, { word: '', width: 0 })
      return { text: element.textContent?.trim().replace(/\s+/g, ' '), width: element.getBoundingClientRect().width, fontSize: style.fontSize, longestWord: longest.word, longestWordWidth: longest.width }
    })
  })
  const failures = columns.filter((item) => item.width + 1 < item.longestWordWidth)
  assert.ok(columns.length > 0, `${label}: no text columns measured`)
  assert.deepEqual(failures, [], `${label}: each meaningful word must fit its text column: ${JSON.stringify(failures)}`)
  return columns
}

async function contrastMetrics(page) {
  return page.evaluate(() => {
    const rgb = (value) => {
      const numbers = value.match(/[\d.]+/g)?.map(Number) ?? []
      return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1]
    }
    const blend = (front, back) => front.map((value, index) => value * front[3] + back[index] * (1 - front[3])).concat(1)
    const luminance = (color) => {
      const channels = color.slice(0, 3).map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
    }
    const ratio = (a, b) => {
      const first = luminance(a)
      const second = luminance(b)
      return (Math.max(first, second) + .05) / (Math.min(first, second) + .05)
    }
    const background = (element) => {
      const chain = []
      for (let node = element; node && node instanceof HTMLElement; node = node.parentElement) chain.push(node)
      let color = [255, 255, 255, 1]
      for (const node of chain.reverse()) {
        const next = rgb(getComputedStyle(node).backgroundColor)
        if (next[3] > 0) color = blend(next, color)
      }
      return color
    }
    const textNodes = [...document.querySelectorAll('.clerk-desk .micro, .clerk-desk h1, .clerk-desk h2, .clerk-desk h3, .clerk-desk p, .clerk-desk li, .clerk-desk dt, .clerk-desk dd, .clerk-desk legend, .clerk-option span')]
      .filter((element) => element.textContent?.trim())
      .map((element) => ({ text: element.textContent.trim().slice(0, 50), ratio: ratio(rgb(getComputedStyle(element).color), background(element)) }))
    const controls = [...document.querySelectorAll('.clerk-desk button, .clerk-option')].map((element) => {
      const style = getComputedStyle(element)
      const color = rgb(style.borderTopColor)
      const back = background(element.parentElement ?? element)
      return { text: element.textContent.trim().slice(0, 50), borderRatio: ratio(color, back), textRatio: ratio(rgb(style.color), rgb(style.backgroundColor)) }
    })
    const radios = [...document.querySelectorAll('.clerk-option input')].map((element) => ({ accent: getComputedStyle(element).accentColor, ratio: ratio(rgb(getComputedStyle(element).accentColor), background(element.parentElement)) }))
    return { textNodes, controls, radios }
  })
}

async function assertContrast(page, label) {
  const metrics = await contrastMetrics(page)
  for (const item of metrics.textNodes) assert.ok(item.ratio >= 4.5, `${label}: text contrast below 4.5:1: ${JSON.stringify(item)}`)
  for (const item of metrics.controls) {
    assert.ok(item.borderRatio >= 3, `${label}: control border contrast below 3:1: ${JSON.stringify(item)}`)
    assert.ok(item.textRatio >= 4.5, `${label}: control text contrast below 4.5:1: ${JSON.stringify(item)}`)
  }
  for (const item of metrics.radios) assert.ok(item.ratio >= 3, `${label}: radio accent contrast below 3:1: ${JSON.stringify(item)}`)
  return metrics
}

async function assertFocused(page, locator, label) {
  const measured = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      focused: document.activeElement === element,
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight },
      hit: Boolean(hit && (hit === element || element.contains(hit))),
    }
  })
  assert.ok(measured.focused && measured.hit, `${label}: actual focused target is not hit-testable: ${JSON.stringify(measured)}`)
  assert.ok(measured.rect.left >= -1 && measured.rect.right <= measured.viewport.width + 1 && measured.rect.top >= -1 && measured.rect.bottom <= measured.viewport.height + 1, `${label}: actual focus is outside viewport: ${JSON.stringify(measured)}`)
  return measured
}

async function assertFeedbackVisible(page, label) {
  const measured = await page.evaluate(() => {
    const status = document.querySelector('[data-clerk-announcer]')
    const next = document.querySelector('.clerk-feedback + button')
    const targets = [...(status?.querySelectorAll('h3, p') ?? []), ...(next ? [next] : [])]
    return targets.map((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        text: element.textContent?.trim(), left: rect.left, right: rect.right,
        top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
      }
    })
  })
  assert.ok(measured.length >= 5, `${label}: outcome, identity, required decision/reason, explanation, and Next must exist: ${JSON.stringify(measured)}`)
  for (const item of measured) {
    assert.ok(item.visible && item.left >= -1 && item.right <= item.viewportWidth + 1 && item.top >= -1 && item.bottom <= item.viewportHeight + 1, `${label}: feedback or Next is outside the actual focused viewport: ${JSON.stringify(item)}`)
    assert.ok(item.scrollWidth <= item.clientWidth + 1, `${label}: feedback or Next text is clipped: ${JSON.stringify(item)}`)
  }
}

async function scenario(name, action) {
  try {
    const details = await action()
    results.push({ name, passed: true, ...(details ?? {}) })
    console.log(`PASS: ${name}`)
  } catch (error) {
    const failure = { name, error: error.message }
    failures.push(failure)
    results.push({ ...failure, passed: false })
    console.error(`FAIL: ${name}: ${error.message}`)
  }
}

async function runEntryRed() {
  const { context, page } = await openPage({ debug: true })
  try {
    await reachDebugEnding(page)
    await page.getByRole('button', { name: 'Acting Clerk', exact: true }).waitFor()
    return { ending: 'probablyHuman', entry: 'Acting Clerk' }
  } finally { await closeContext(context) }
}

async function runNaturalInvariantJourney() {
  const { context, page } = await openPage({ viewport: { width: 320, height: 740 }, mobile: true })
  try {
    await reachNaturalRejected(page)
    await page.waitForFunction(() => localStorage.getItem('captcha-hell.best.v1') !== null && localStorage.getItem('captcha-hell.endings.v1') !== null)
    const before = await verdictSnapshot(page)
    const storageBefore = await storageSnapshot(page)
    const receiptOwner = await page.locator('[data-receipt-announcer]').elementHandle()
    const writeCount = await page.evaluate(() => window.__clerkStorageWrites.length)
    await openClerk(page)
    await snapshotNoOverflow(page, 'natural initial 320px')
    await assertContrast(page, 'natural initial 320px')
    await capture(page, 'clerk-initial-320x740')
    assert.equal(await page.getByRole('group', { name: 'Decision' }).count(), 1)
    assert.equal(await page.getByRole('group', { name: 'Reason' }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Record decision', exact: true }).isDisabled(), true, 'both native radio groups are required')
    assert.equal(await page.getByRole('button', { name: 'Next file', exact: true }).count(), 0, 'cannot advance an unanswered case')

    await page.getByRole('radio', { name: 'Accept', exact: true }).check()
    assert.equal(await page.getByRole('button', { name: 'Record decision', exact: true }).isDisabled(), true, 'decision without reason remains incomplete')
    await page.getByRole('button', { name: 'Back to verdict', exact: true }).click()
    const trigger = page.getByRole('button', { name: 'Acting Clerk', exact: true })
    assert.equal(await trigger.evaluate((button) => document.activeElement === button), true, 'exit restores focus to the clerk trigger')
    assert.deepEqual(await verdictSnapshot(page), before, 'mid-case exit returns to the unchanged verdict')
    await openClerk(page)
    assert.equal(await page.locator('.clerk-options input:checked').count(), 0, 'reopening after mid-case exit resets both choices')
    const clerkStatus = page.locator('[data-clerk-announcer]')
    const clerkStatusOwner = await clerkStatus.elementHandle()
    assert.equal((await clerkStatus.innerText()).trim(), '', 'persistent clerk status starts empty')

    const correctAnswers = [
      ['accept', 'no-defect'],
      ['return', 'copy-before-certification'],
      ['return', 'copy-after-redaction'],
    ]
    const firstStatus = await submitReview(page, correctAnswers[0][0], correctAnswers[0][1], true)
    assert.match(firstStatus, /Correct review/)
    assert.match(firstStatus, /Required decision: Accept/)
    assert.match(firstStatus, /Required reason: No procedural defect/)
    assert.match(firstStatus, /witnessed while readable/i)
    assert.match(firstStatus, /File A: review recorded\./)
    assert.equal(await page.getByRole('heading', { name: 'File A: Mira Vale', exact: true }).count(), 1, 'feedback stays on File A until explicit Next')
    assert.equal(await clerkStatus.evaluate((element, owner) => element === owner, clerkStatusOwner), true, 'same polite status owner survives File A submission')
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Next file', 'focus moves to the available next action')
    await advanceFile(page)
    assert.equal((await clerkStatus.innerText()).trim(), '', 'status clears before the next case')
    assert.equal(await clerkStatus.evaluate((element, owner) => element === owner, clerkStatusOwner), true, 'same polite status owner remains for File B')
    const fileB = await page.locator('.clerk-evidence').innerText()
    assert.match(fileB, /Original readability\s+Redacted and unreadable/)
    assert.match(fileB, /Copy readability\s+Readable/)
    assert.match(fileB, /Copy certification\s+Not certified/)
    const feedbackB = await submitReview(page, correctAnswers[1][0], correctAnswers[1][1])
    assert.match(feedbackB, /Correct review/)
    assert.match(feedbackB, /File B: review recorded\./)
    assert.match(feedbackB, /Copy was made before certification/i)
    assert.match(feedbackB, /Required reason: Copy made before certification/)
    assert.equal(await clerkStatus.evaluate((element, owner) => element === owner, clerkStatusOwner), true, 'same polite status owner survives File B submission')
    await advanceFile(page)
    assert.equal((await clerkStatus.innerText()).trim(), '', 'status clears before File C')
    assert.equal(await clerkStatus.evaluate((element, owner) => element === owner, clerkStatusOwner), true, 'same polite status owner remains for File C')
    const fileC = await page.locator('.clerk-evidence').innerText()
    assert.match(fileC, /Copy readability\s+Unreadable/)
    assert.match(fileC, /Copy certification\s+Certified/)
    const feedbackC = await submitReview(page, correctAnswers[2][0], correctAnswers[2][1])
    assert.match(feedbackC, /Required reason: Copy made after redaction/)
    assert.match(feedbackC, /original was redacted before the copy was made/i)
    assert.equal(await clerkStatus.evaluate((element, owner) => element === owner, clerkStatusOwner), true, 'same polite status owner survives File C submission')
    await advanceFile(page, true)
    await snapshotNoOverflow(page, 'natural summary 320px')
    await assertContrast(page, 'natural summary 320px')
    await capture(page, 'clerk-summary-320x740')
    assert.match(await page.locator('.clerk-count').textContent(), /3\/3/)
    assert.equal(await page.locator('.clerk-summary-list li').count(), 3)
    for (const row of await page.locator('.clerk-summary-list li').all()) assert.match(await row.innerText(), /Your review:\s+Correct/)
    assert.equal(await page.evaluate(() => document.activeElement?.id === 'clerk-summary-title'), true, 'summary heading receives focus')

    await page.getByRole('button', { name: 'Review files again', exact: true }).click()
    await page.getByRole('heading', { name: 'File A: Mira Vale', exact: true }).waitFor()
    assert.equal(await page.locator('.clerk-options input:checked').count(), 0, 'repeat resets selections')
    assert.equal((await page.locator('[data-clerk-announcer]').textContent()).trim(), '', 'repeat clears feedback')
    await page.getByRole('radio', { name: 'Accept', exact: true }).check()
    await page.getByRole('button', { name: 'Back to verdict', exact: true }).click()
    assert.equal(await trigger.evaluate((button) => document.activeElement === button), true)
    assert.deepEqual(await verdictSnapshot(page), before, 'summary exit preserves title, exact stats, receipt, dossier, and share context')
    await openClerk(page)
    assert.equal(await page.locator('.clerk-options input:checked').count(), 0, 'summary exit and reopen starts a fresh shift')
    await page.getByRole('button', { name: 'Back to verdict', exact: true }).click()
    assert.deepEqual(await verdictSnapshot(page), before)
    assert.deepEqual(await storageSnapshot(page), storageBefore, 'clerk training does not mutate any localStorage bytes')
    assert.deepEqual(await page.evaluate((from) => window.__clerkStorageWrites.slice(from), writeCount), [], 'clerk training performs zero localStorage writes')
    assert.equal(await page.locator('[data-receipt-announcer]').evaluate((element, original) => element === original, receiptOwner), true, 'persistent game receipt owner remains the same node')
    assert.equal((await page.locator('[data-receipt-announcer]').textContent()).trim(), before.liveReceipt, 'desk never adds a global game receipt')

    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('clipboard blocked') } } }))
    await page.getByRole('button', { name: 'Copy result', exact: true }).click()
    assert.match(await page.locator('.copy-note').textContent(), /Clipboard unavailable/)
    const rawShare = await page.locator('.share-raw').textContent()
    assert.match(rawShare, /APPLICATION REJECTED/)
    assert.doesNotMatch(rawShare, /Acting Clerk|Training complete/)
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    assert.equal(await page.locator('.hud .stat').nth(4).innerText(), 'ROUND\n1/10', 'Try again still starts the existing game')
    return { ending: 'rejected', correctCount: '3/3', storageWrites: 0, screenshots: screenshots.slice(-2) }
  } finally { await closeContext(context) }
}

async function runDebugOutcome(name, answers, expected, { wrongReason = false } = {}) {
  const { context, page } = await openPage({ debug: true, viewport: { width: name === 'all-wrong' ? 320 : 390, height: name === 'all-wrong' ? 740 : 844 }, mobile: name === 'all-wrong' || name === 'wrong-reason' })
  try {
    await reachDebugEnding(page)
    await openClerk(page)
    if (wrongReason) {
      const text = await submitReview(page, 'accept', 'copy-before-certification')
      assert.match(text, /Review corrected/)
      assert.match(text, /Required decision: Accept/)
      assert.match(text, /Required reason: No procedural defect/)
      assert.match(text, /not claim|procedural defect/i)
      await capture(page, 'clerk-wrong-reason-feedback-390x844')
      await advanceFile(page)
      answers = [answers[0], answers[1], answers[2]]
      for (let index = 1; index < answers.length; index += 1) {
        await submitReview(page, answers[index][0], answers[index][1])
        if (index < answers.length - 1) await advanceFile(page)
      }
      await advanceFile(page, true)
    } else if (name === 'all-wrong') {
      const firstFeedback = await submitReview(page, answers[0][0], answers[0][1])
      assert.match(firstFeedback, /Review corrected/)
      await capture(page, 'clerk-wrong-feedback-320x740')
      await advanceFile(page)
      for (let index = 1; index < answers.length; index += 1) {
        await submitReview(page, answers[index][0], answers[index][1])
        if (index < answers.length - 1) await advanceFile(page)
      }
      await advanceFile(page, true)
    } else {
      await completeSession(page, answers)
    }
    assert.match(await page.locator('.clerk-count').textContent(), new RegExp(`${expected}\\/3`))
    assert.equal(await page.locator('.clerk-summary-list li').count(), 3)
    const actionButtons = await page.locator('.clerk-summary-actions button').evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect()
      return { text: button.textContent.trim(), width: rect.width, height: rect.height }
    }))
    for (const button of actionButtons) assert.ok(button.width >= 44 && button.height >= 44, `${name}: summary action below 44px: ${JSON.stringify(button)}`)
    await snapshotNoOverflow(page, `${name} summary`)
    return { fixture: 'debug ending fixture', correctCount: expected, rows: await page.locator('.clerk-summary-list li').count(), wrongReason }
  } finally { await closeContext(context) }
}

async function runResponsive(viewport, reduced) {
  const { context, page } = await openPage({ viewport, reduced, debug: true, mobile: viewport.width <= 520 || viewport.height <= 520 })
  try {
    await reachDebugEnding(page)
    await openClerk(page)
    assert.equal(await page.locator('.clerk-desk').evaluate((element) => element.classList.contains('reduce-motion')), reduced, 'desk inherits effective reduced motion')
    await snapshotNoOverflow(page, `${viewport.width}x${viewport.height} ${reduced ? 'reduced' : 'full'}`)
    const labels = await page.locator('.clerk-option').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { text: element.textContent.trim(), width: rect.width, height: rect.height }
    }))
    for (const label of labels) assert.ok(label.width >= 44 && label.height >= 44, `radio label target below 44px: ${JSON.stringify(label)}`)
    const buttons = await page.locator('.clerk-desk button').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { text: element.textContent.trim(), width: rect.width, height: rect.height }
    }))
    for (const button of buttons) assert.ok(button.width >= 44 && button.height >= 44, `button target below 44px: ${JSON.stringify(button)}`)
    await assertContrast(page, `${viewport.width}x${viewport.height}`)
    await page.keyboard.press('Tab')
    const decisionRadio = page.locator('#file-a-decision-accept')
    await assertFocused(page, decisionRadio, `${viewport.width}x${viewport.height} real Tab to decision`)
    await page.keyboard.press('Tab')
    const reasonRadio = page.locator('#file-a-reason-no-defect')
    await assertFocused(page, reasonRadio, `${viewport.width}x${viewport.height} real Tab to reason`)
    return { viewport, motion: reduced ? 'reduced' : 'full', decisionTarget: labels[0], buttonCount: buttons.length }
  } finally { await closeContext(context) }
}

async function runTextScaleFocus() {
  const viewport = { width: 320, height: 740 }
  const { context, page } = await openPage({ viewport, reduced: false, debug: true, mobile: true, textScale200: true })
  try {
    await reachDebugEnding(page)
    await openClerk(page)
    const controls = await assertWordsFit(page, '.clerk-options legend, .clerk-option span', '320x740 200% decision, reason, and legend text')
    const targets = await page.locator('.clerk-option, .clerk-desk button').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { text: element.textContent.trim(), width: rect.width, height: rect.height }
    }))
    for (const target of targets) assert.ok(target.width >= 44 && target.height >= 44, `200% text target below 44px: ${JSON.stringify(target)}`)
    await page.keyboard.press('Tab')
    const decisionRadio = page.locator('#file-a-decision-accept')
    const decisionGeometry = await assertFocused(page, decisionRadio, '320x740 200% text real Tab to decision')
    await page.keyboard.press('Tab')
    const reasonRadio = page.locator('#file-a-reason-no-defect')
    const reasonGeometry = await assertFocused(page, reasonRadio, '320x740 200% text real Tab to reason')
    await snapshotNoOverflow(page, '320x740 200% text')
    const contrast = await assertContrast(page, '320x740 200% text')
    await capture(page, 'clerk-focused-200-text-320x740')
    await page.locator('.clerk-document').scrollIntoViewIfNeeded()
    const documentColumns = await assertWordsFit(page, '.clerk-evidence dt, .clerk-evidence dd, .clerk-history li', '320x740 200% submitted-record text')
    await snapshotNoOverflow(page, '320x740 200% submitted record')
    await capture(page, 'clerk-document-rows-200-text-read-scroll-320x740')

    const answers = [
      ['a', 'accept', 'no-defect'],
      ['b', 'return', 'copy-before-certification'],
      ['c', 'return', 'copy-after-redaction'],
    ]
    for (let index = 0; index < answers.length; index += 1) {
      const [file, decision, reason] = answers[index]
      await page.locator(`#file-${file}-decision-${decision}`).check()
      await page.locator(`#file-${file}-reason-${reason}`).check()
      await page.getByRole('button', { name: 'Record decision', exact: true }).click()
      await page.locator('[data-clerk-announcer] h3').waitFor()
      const feedback = await page.locator('[data-clerk-announcer]').innerText()
      assert.match(feedback, /Correct review/)
      assert.match(feedback, new RegExp(`File ${file.toUpperCase()}: review recorded\\.`))
      await assertWordsFit(page, '.clerk-feedback h3, .clerk-feedback p', `320x740 200% File ${file.toUpperCase()} feedback`)
      if (index === 0) {
        await page.locator('.clerk-feedback').scrollIntoViewIfNeeded()
        await capture(page, 'clerk-feedback-200-text-read-scroll-320x740')
      }
      await page.getByRole('button', { name: index === answers.length - 1 ? 'Finish shift' : 'Next file', exact: true }).click()
    }
    await page.getByRole('heading', { name: 'Training complete', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.activeElement?.id === 'clerk-summary-title'), true, '200% text summary heading receives production focus')
    const summaryColumns = await assertWordsFit(page, '.clerk-summary-list h3, .clerk-summary-list p', '320x740 200% summary text')
    await snapshotNoOverflow(page, '320x740 200% summary')
    await page.locator('.clerk-summary-list').scrollIntoViewIfNeeded()
    await capture(page, 'clerk-summary-200-text-read-scroll-320x740')
    return { viewport, textScale: '200 percent root text', decisionGeometry, reasonGeometry, controls, targets, documentColumns, summaryColumns, minimumTextContrast: Math.min(...contrast.textNodes.map((item) => item.ratio)) }
  } finally { await closeContext(context) }
}

try {
  if (mode === 'entry') {
    await scenario('debug fixture sees Acting Clerk only after an ending', runEntryRed)
  } else {
    await scenario('normal no-debug ending, 3/3 correct, no global/storage mutation, exit/repeat/share/restart', runNaturalInvariantJourney)
    await scenario('debug fixture: 0/3 and wrong decision plus wrong reason', () => runDebugOutcome('all-wrong', [
      ['return', 'copy-after-redaction'],
      ['accept', 'no-defect'],
      ['accept', 'no-defect'],
    ], 0))
    await scenario('debug fixture: mixed review scores exactly 1/3', () => runDebugOutcome('mixed', [
      ['accept', 'no-defect'],
      ['accept', 'copy-before-certification'],
      ['accept', 'copy-after-redaction'],
    ], 1))
    await scenario('debug fixture: correct decision with wrong reason is independently incorrect', () => runDebugOutcome('wrong-reason', [
      ['accept', 'copy-before-certification'],
      ['accept', 'no-defect'],
      ['accept', 'no-defect'],
    ], 0, { wrongReason: true }))

    const viewports = [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 412, height: 915 },
      { width: 915, height: 412 },
      { width: 1440, height: 1000 },
    ]
    for (const viewport of viewports) for (const reduced of [false, true]) {
      await scenario(`responsive ${viewport.width}x${viewport.height} ${reduced ? 'reduced' : 'full'} motion`, () => runResponsive(viewport, reduced))
    }
    await scenario('320x740 200% text: real focus and target hit testing without test scrolling', runTextScaleFocus)
  }
  if (pageErrors.length) failures.push({ name: 'browser console/page errors', error: pageErrors.join('; ') })
} finally {
  await Promise.all([...contexts].map((context) => context.close()))
  await browser.close()
}

const summary = {
  baseURL,
  mode,
  selected: results.length,
  passed: results.filter((result) => result.passed).length,
  failed: failures.length,
  skipped: mode === 'entry' ? ['functional and responsive modes (entry RED only)'] : [],
  pageErrors,
  screenshots,
  results,
  failures,
}
await writeFile(path.join(evidenceDir, 'clerk-results.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify({ selected: summary.selected, passed: summary.passed, failed: summary.failed, pageErrors: pageErrors.length, screenshots: screenshots.length }))
if (failures.length) process.exitCode = 1
