import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const playwrightModule = process.env.PLAYWRIGHT_MODULE
const baseURL = process.env.BASE_URL
const evidenceDir = process.env.EVIDENCE_DIR
const mode = process.env.EVIDENCE_MODE ?? 'all'
assert.ok(playwrightModule, 'Set PLAYWRIGHT_MODULE to the installed Playwright module path.')
assert.ok(baseURL, 'Set BASE_URL to the preview URL, including its base path.')
assert.ok(evidenceDir, 'Set EVIDENCE_DIR to the approved artifact directory.')
const { chromium } = await import(playwrightModule)
const browser = await chromium.launch({ headless: true })
const pages = new Set()
const pageErrors = []
const failures = []
const results = []
const screenshots = []
const screenshotsDir = path.join(evidenceDir, 'screenshots')
await mkdir(screenshotsDir, { recursive: true })

function pageURL(debug = false) {
  const url = new URL(baseURL)
  if (debug) url.searchParams.set('debug', '1')
  return url.toString()
}

async function openPage({ debug = false, clock = 'controlled', viewport = { width: 320, height: 740 } } = {}) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce', isMobile: viewport.width <= 520, hasTouch: viewport.width <= 520 })
  pages.add(page)
  page.setDefaultTimeout(6000)
  page.__clockMode = clock
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()) })
  if (clock === 'controlled') await page.clock.install()
  await page.goto(pageURL(debug))
  if (clock === 'controlled') await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  return page
}

async function closePage(page) {
  pages.delete(page)
  await page.close()
}

async function begin(page) {
  assert.equal(new URL(page.url()).searchParams.has('debug'), false, 'natural route must not use debug mode')
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  await assertRound(page, 1)
}

async function roundNumber(page) {
  const text = await page.locator('.hud .stat').nth(4).innerText()
  return Number(text.match(/(\d+)\/10/)?.[1])
}

async function timerNumber(page) {
  const text = await page.locator('.hud .stat').nth(5).innerText()
  return Number(text.match(/(\d+)s/)?.[1])
}

async function assertRound(page, expected) {
  await page.waitForFunction((value) => document.querySelectorAll('.hud .stat')[4]?.innerText.includes(`${value}/10`), expected)
  await page.waitForTimeout(30)
  assert.equal(await roundNumber(page), expected)
}

async function waitForTimer(page, expected) {
  for (let ticks = 0; ticks < 21; ticks += 1) {
    const current = await timerNumber(page)
    if (current === expected) return
    assert.ok(current > expected, `timer passed ${expected}s before filing: ${current}s`)
    if (page.__clockMode === 'controlled') await page.clock.runFor(1000)
    else await page.waitForTimeout(200)
  }
  assert.equal(await timerNumber(page), expected, `timer reached ${expected}s`)
}

async function dismissPopups(page) {
  while (await page.locator('.popup button').count()) await page.locator('.popup button').first().click()
}

async function waitNotice(page) {
  const notice = page.getByRole('alert', { name: 'FINAL NOTICE', exact: true })
  if (page.__clockMode === 'controlled') await page.clock.runFor(1700)
  else await page.waitForTimeout(1700)
  await notice.waitFor({ state: 'visible' })
  return notice
}

async function readHud(page) {
  const cells = await page.locator('.hud .stat').evaluateAll((nodes) => nodes.map((node) => node.innerText.split('\n').map((part) => part.trim())))
  return Object.fromEntries(cells.map(([label, value]) => [label.toLowerCase(), value]))
}

function gameplayHud(hud) {
  const { timer, ...gameplay } = hud
  return gameplay
}

async function receiptText(page) {
  return (await page.locator('[data-receipt-announcer]').textContent())?.trim() ?? ''
}

async function capture(page, name) {
  const destination = path.join(screenshotsDir, `${name}.png`)
  await page.screenshot({ path: destination, fullPage: false })
  screenshots.push(destination)
  return destination
}

async function scenario(name, run) {
  try {
    const detail = await run()
    results.push({ name, passed: true, ...(detail ?? {}) })
    console.log(`PASS: ${name}`)
  } catch (error) {
    failures.push({ name, error: error.message })
    results.push({ name, passed: false, error: error.message })
    console.error(`FAIL: ${name}: ${error.message}`)
  }
}

async function reachRound9Naturally(page, { slow = [], wrongRound1 = false, earlyRound4 = false, wrongRound7 = false, strikeAppeal = false } = {}) {
  await begin(page)
  let strikeAppealReceipt
  if (wrongRound1) {
    await page.locator('.cell').nth(1).click()
    await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.hud .stat')[3]?.innerText.endsWith('\n1'))
    assert.equal(await roundNumber(page), 1)
    assert.equal(await timerNumber(page), 20, 'round-one retry gets its real timer window')
  }
  for (const index of [0, 4, 7]) await page.locator('.cell').nth(index).click()
  if (wrongRound1) await page.locator('.cell').nth(1).click()
  if (slow.includes(1)) await waitForTimer(page, 3)
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await assertRound(page, 2)

  if (slow.includes(2)) await waitForTimer(page, 3)
  const robot = page.locator('.checkbox').first()
  await robot.click(); await robot.click()
  await assertRound(page, 3)

  for (const index of [1, 3, 8]) await page.locator('.cell').nth(index).click()
  if (slow.includes(3)) await waitForTimer(page, 3)
  if (slow.includes(3)) await dismissPopups(page)
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await assertRound(page, 4)

  if (earlyRound4) {
    const before = Number((await readHud(page)).strikes)
    await page.locator('.verify').click({ force: true })
    await page.waitForFunction((expected) => document.querySelectorAll('.hud .stat')[3]?.innerText.endsWith(`\n${expected}`), before + 1)
    assert.equal(await roundNumber(page), 4, 'early timed click retries the real round-four challenge')
    assert.equal(await timerNumber(page), 15)
  }
  if (page.__clockMode === 'controlled') await page.clock.runFor(3450)
  else await page.getByText('Verification window open. Click VERIFY now.', { exact: true }).waitFor()
  await page.getByText('Verification window open. Click VERIFY now.', { exact: true }).waitFor()
  await page.locator('.verify').click({ force: true })
  await assertRound(page, 5)

  if (strikeAppeal) {
    const suspicion = page.getByRole('button', { name: 'Appeal: suspicion relief', exact: true })
    const strike = page.getByRole('button', { name: 'Appeal: strike relief', exact: true })
    assert.equal(await suspicion.isEnabled(), true, 'suspicion relief is eligible before shared Appeal use')
    assert.equal(await strike.isEnabled(), true, 'strike relief is eligible at exactly two strikes')
    const before = await readHud(page)
    assert.equal(before.strikes, '2')
    await capture(page, 'natural-strike-appeal-both-purposes-eligible')
    await strike.click()
    const after = await readHud(page)
    assert.equal(after.score, String(Number(before.score) - 50))
    assert.equal(after.strikes, '1')
    assert.equal(after.suspicion, before.suspicion)
    assert.equal(after.round, before.round)
    assert.equal(after.timer, before.timer, 'strike Appeal does not replace the current timer')
    strikeAppealReceipt = await receiptText(page)
    assert.match(strikeAppealReceipt, /^Receipt \d+: Appeal accepted: strike relief\. Round 5\. Score -50\. Strikes -1\.$/)
    assert.equal(await suspicion.isDisabled(), true, 'strike relief consumes the shared suspicion Appeal')
    assert.equal(await strike.isDisabled(), true, 'strike relief cannot be reused')
    assert.match(await page.locator('#appeal-strike-status').innerText(), /already used/)
    await capture(page, 'natural-strike-appeal-shared-use-receipt')
    await page.clock.runFor(1000)
    assert.equal(await timerNumber(page), Number(before.timer.replace('s', '')) - 1, 'strike Appeal keeps the timer ticking from 15s to 14s')
  }

  const slider = page.getByRole('slider', { name: 'alignment slider' })
  await slider.focus(); await slider.press('Home')
  for (let step = 0; step < 62; step += 1) await slider.press('ArrowRight')
  assert.equal(await slider.inputValue(), '62')
  if (slow.includes(5)) await waitForTimer(page, 2)
  if (slow.includes(5)) await dismissPopups(page)
  await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
  await assertRound(page, 6)

  for (const stamp of ['Witness', 'Copy', 'Redact']) await page.getByRole('button', { name: stamp, exact: true }).click()
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await assertRound(page, 7)

  if (slow.includes(7)) {
    await waitForTimer(page, 3)
    await dismissPopups(page)
  }
  await page.getByRole('button', { name: wrongRound7 ? 'Optimize response latency' : 'Cry at a song from 2009', exact: true }).click()
  if (wrongRound7) {
    if (!strikeAppeal) {
      await page.getByRole('heading', { name: 'APPLICATION REJECTED', exact: true }).waitFor()
      const result = await page.locator('.result').innerText()
      assert.match(result, /Strikes\s+3\/3/)
      return { stoppedAt: 'round 7 third strike', result }
    }
    await assertRound(page, 8)
    assert.equal((await readHud(page)).strikes, '2', 'the shared strike Appeal rescues the next failure')
  }
  await assertRound(page, 8)

  if (slow.includes(8)) await waitForTimer(page, 3)
  await page.getByRole('button', { name: 'I treated it as a poster', exact: true }).click()
  await assertRound(page, 9)
  return { beforeEvidence: await readHud(page), clock: page.__clockMode, strikeAppealReceipt }
}

async function debugRound9(page) {
  assert.equal(new URL(page.url()).searchParams.has('debug'), true, 'this fixture is explicitly debug-only')
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  for (let round = 1; round < 9; round += 1) {
    await page.getByRole('button', { name: 'Next round', exact: true }).click()
    await assertRound(page, round + 1)
  }
  assert.equal(await timerNumber(page), 20)
}

async function evidenceGeometry(page, label) {
  const measurements = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const evidence = document.querySelector('.evidence-puzzle')
    const labels = [...document.querySelectorAll('.evidence-option')].map((element) => {
      const box = element.getBoundingClientRect()
      const text = element.querySelector('span')
      const textBox = text.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(text)
      const rangeBox = range.getBoundingClientRect()
      const style = getComputedStyle(text)
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (context) context.font = style.font
      const widestWord = (text.textContent.match(/\S+/g) ?? []).reduce((max, word) => Math.max(max, context?.measureText(word).width ?? 0), 0)
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return { text: text.textContent.trim(), width: box.width, height: box.height, textWidth: textBox.width, scrollWidth: text.scrollWidth, range: { left: rangeBox.left, right: rangeBox.right }, widestWord, hit: Boolean(hit && (hit === element || element.contains(hit))) }
    })
    const timer = document.querySelectorAll('.hud .stat')[5]
    const timerBox = timer.getBoundingClientRect()
    const timerHit = document.elementFromPoint(timerBox.left + timerBox.width / 2, timerBox.top + timerBox.height / 2)
    return { width, docWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, puzzle: evidence && { left: evidence.getBoundingClientRect().left, right: evidence.getBoundingClientRect().right }, labels, timer: { text: timer.textContent.trim(), y: timerBox.y, bottom: timerBox.bottom, hit: Boolean(timerHit && (timerHit === timer || timer.contains(timerHit))) } }
  })
  assert.ok(measurements.docWidth <= measurements.width + 1 && measurements.bodyWidth <= measurements.width + 1, `${label}: horizontal overflow ${JSON.stringify(measurements)}`)
  assert.equal(measurements.labels.length, 3)
  for (const item of measurements.labels) {
    assert.ok(item.width >= 44 && item.height >= 44, `${label}: evidence target below 44px: ${JSON.stringify(item)}`)
    assert.ok(item.textWidth > 70 && item.widestWord <= item.textWidth + 1, `${label}: evidence label word does not fit: ${JSON.stringify(item)}`)
    assert.ok(item.scrollWidth <= item.textWidth + 1 && item.range.left >= -1 && item.range.right <= measurements.width + 1, `${label}: label text range clipped: ${JSON.stringify(item)}`)
    assert.equal(item.hit, true, `${label}: label center is obscured: ${JSON.stringify(item)}`)
  }
  assert.ok(measurements.timer.y >= -1 && measurements.timer.bottom <= 740 + 1 && measurements.timer.hit, `${label}: timer is hidden or not hit-testable: ${JSON.stringify(measurements.timer)}`)
  return measurements
}

async function contrastRatios(page) {
  return page.evaluate(() => {
    const parse = (color) => {
      const values = color.match(/[\d.]+/g)?.map(Number) ?? []
      return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1]
    }
    const blend = (front, back) => front.map((value, index) => value * front[3] + back[index] * (1 - front[3])).concat(1)
    const luminance = (color) => color.slice(0, 3).map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
    const backdrop = (element) => {
      const ancestors = []
      for (let node = element; node instanceof HTMLElement; node = node.parentElement) ancestors.push(node)
      let color = [255, 255, 255, 1]
      for (const node of ancestors.reverse()) {
        const background = parse(getComputedStyle(node).backgroundColor)
        if (background[3] > 0) color = blend(background, color)
      }
      return color
    }
    const text = [...document.querySelectorAll('.evidence-puzzle h2, .evidence-puzzle p, .evidence-options legend, .evidence-option span')]
      .filter((node) => node.textContent.trim())
      .map((node) => ({ text: node.textContent.trim().slice(0, 60), ratio: ratio(parse(getComputedStyle(node).color), backdrop(node)) }))
    const controls = [...document.querySelectorAll('.evidence-option')].map((node) => {
      const style = getComputedStyle(node)
      return { border: ratio(parse(style.borderTopColor), backdrop(node.parentElement)), text: ratio(parse(style.color), backdrop(node)) }
    })
    const checks = [...document.querySelectorAll('.evidence-option input')].map((node) => ratio(parse(getComputedStyle(node).accentColor), backdrop(node.parentElement)))
    return { text, controls, checks }
  })
}

async function assertEvidenceContrast(page, label) {
  const metrics = await contrastRatios(page)
  for (const item of metrics.text) assert.ok(item.ratio >= 4.5, `${label}: text contrast below 4.5:1: ${JSON.stringify(item)}`)
  for (const item of metrics.controls) {
    assert.ok(item.border >= 3, `${label}: evidence border contrast below 3:1: ${JSON.stringify(item)}`)
    assert.ok(item.text >= 4.5, `${label}: evidence control text contrast below 4.5:1: ${JSON.stringify(item)}`)
  }
  for (const value of metrics.checks) assert.ok(value >= 3, `${label}: checkbox accent contrast below 3:1: ${value}`)
  return metrics
}

function documentName(id) {
  return ({ 'existence-declaration': 'Existence declaration (required)', 'fern-reference': 'Fern reference (optional)', 'queue-receipt': 'Queue receipt (optional)' })[id]
}

async function assertPreview(page, count, label) {
  const text = await page.locator('.evidence-preview').innerText()
  assert.match(text, new RegExp(`Selected optional extras: ${count} of 2\\.`), `${label}: truthful attachment count`)
  assert.ok(text.includes(`+${count * 40} score and +${count * 15} suspicion`), `${label}: preview matches reducer bonuses: ${text}`)
  assert.match(text, /on top of the ordinary pass and timing effects/i)
  return text
}

async function submitFiling(page, ids, expectedScore, expectedSuspicion, label, terminal = false) {
  const beforeReceipt = await receiptText(page)
  const before = await readHud(page)
  for (const id of ids) await page.getByRole('checkbox', { name: documentName(id), exact: true }).check()
  await assertPreview(page, ids.filter((id) => id !== 'existence-declaration').length, label)
  assert.deepEqual(gameplayHud(await readHud(page)), gameplayHud(before), `${label}: checkbox selection has no game-state effect`)
  assert.equal(await receiptText(page), beforeReceipt, `${label}: checkbox selection creates no receipt`)
  await page.getByRole('button', { name: 'File evidence', exact: true }).click()
  if (terminal) await page.getByRole('heading', { name: 'ACCOUNT FLAGGED', exact: true }).waitFor()
  else await assertRound(page, 10)
  const receipt = await receiptText(page)
  assert.match(receipt, new RegExp(`Evidence filed with ${ids.length - 1} optional attachment${ids.length === 2 ? '' : 's'}(?:; run flagged)?\\.`))
  assert.match(receipt, /Round 9\. Score \+\d+\./)
  if (expectedScore !== undefined) assert.equal((await readHud(page)).score, String(expectedScore), `${label}: score includes exact attachment value`)
  if (expectedSuspicion !== undefined) assert.equal((await readHud(page)).suspicion, String(expectedSuspicion), `${label}: suspicion includes exact attachment value`)
  return receipt
}

async function runNaturalReadingAndMandatory() {
  const page = await openPage({ clock: 'ordinary' })
  try {
    await reachRound9Naturally(page)
    assert.equal(new URL(page.url()).searchParams.has('debug'), false)
    const beforeNotice = await timerNumber(page)
    assert.equal(beforeNotice, 20)
    const notice = await waitNotice(page)
    const afterNotice = await timerNumber(page)
    assert.ok(afterNotice < beforeNotice && afterNotice > 0, `ordinary clock continues during Final Notice (${beforeNotice}s to ${afterNotice}s)`)
    const noticeText = await notice.innerText()
    assert.match(noticeText, /The form knows you can read this/)
    await assertRound(page, 9)
    await capture(page, 'natural-round9-final-notice-ordinary-clock')
    await dismissPopups(page)

    const headings = await page.locator('.evidence-puzzle h2').allTextContents()
    assert.match(headings[0], /minimum evidence needed to establish that you exist/i)
    const fieldset = page.getByRole('group', { name: 'Available fictional documents', exact: true })
    assert.equal(await fieldset.count(), 1)
    for (const id of ['existence-declaration', 'fern-reference', 'queue-receipt']) {
      const checkbox = page.getByRole('checkbox', { name: documentName(id), exact: true })
      assert.equal(await checkbox.count(), 1)
      assert.equal(await checkbox.isChecked(), false)
    }
    assert.match(await page.locator('.evidence-disclaimer').innerText(), /Theater only.*fictional.*no device files, camera, clipboard, or permissions/i)
    const startHud = await readHud(page)
    const startReceipt = await receiptText(page)
    await capture(page, 'natural-round9-evidence-initial')
    const geometry = await evidenceGeometry(page, 'natural round 9 initial')
    const contrast = await assertEvidenceContrast(page, 'natural round 9 initial')
    assert.equal(await page.locator('.evidence-preview').getAttribute('aria-live'), 'polite')

    const required = page.getByRole('checkbox', { name: documentName('existence-declaration'), exact: true })
    await required.check()
    assert.deepEqual(gameplayHud(await readHud(page)), gameplayHud(startHud), 'required selection remains local until filing')
    assert.equal(await receiptText(page), startReceipt)
    await assertPreview(page, 0, 'mandatory-only preview')
    await required.uncheck()
    assert.deepEqual(gameplayHud(await readHud(page)), gameplayHud(startHud), 'unchecking required declaration also remains local')
    await required.check()
    const filingReceipt = await submitFiling(page, ['existence-declaration'], undefined, undefined, 'natural mandatory-only filing')
    assert.match(filingReceipt, /Evidence filed with 0 optional attachments/)
    assert.equal(await page.locator('[data-receipt-announcer]').count(), 1, 'persistent receipt owner remains present')
    await capture(page, 'natural-round9-mandatory-receipt')
    return { route: 'no-debug normal puzzle play', clock: 'ordinary', finalNotice: noticeText, beforeNotice, afterNotice, hudAfterFiling: await readHud(page), receipt: filingReceipt, geometry, contrast }
  } finally { await closePage(page) }
}

async function runDebugEvidenceSubset(ids, label) {
  const page = await openPage({ debug: true })
  try {
    await debugRound9(page)
    const receiptOwner = await page.locator('[data-receipt-announcer]').elementHandle()
    const before = await readHud(page)
    const initialReceipt = await receiptText(page)
    const count = ids.length - 1
    const extras = ids.filter((id) => id !== 'existence-declaration')
    if (count === 0) await assertPreview(page, 0, `${label} base preview`)
    else {
      for (let index = 0; index < extras.length; index += 1) {
        const id = extras[index]
        await page.getByRole('checkbox', { name: documentName(id), exact: true }).check()
        const invalidPreview = await page.locator('.evidence-preview').innerText()
        assert.match(invalidPreview, /valid filing must include the required existence declaration/i)
        const selectedExtras = index + 1
        assert.ok(invalidPreview.includes(`+${selectedExtras * 40} score and +${selectedExtras * 15} suspicion`), `${label}: extras shown before mandatory item`)
      }
      await page.getByRole('checkbox', { name: documentName('existence-declaration'), exact: true }).check()
      await assertPreview(page, count, label)
    }
    assert.deepEqual(gameplayHud(await readHud(page)), gameplayHud(before), `${label}: local selections do not mutate score/strikes/suspicion`)
    assert.equal(await receiptText(page), initialReceipt)
    await capture(page, `debug-${label.replaceAll(' ', '-')}-preview`)
    const receipt = await submitFiling(page, ids, Number(before.score) + 170 + count * 40, Number(before.suspicion) + count * 15, label)
    assert.equal(await page.locator('[data-receipt-announcer]').evaluate((element, owner) => element === owner, receiptOwner), true, `${label}: persistent live receipt owner`)
    assert.match(receipt, new RegExp(`Evidence filed with ${count} optional attachment${count === 1 ? '' : 's'}`))
    return { fixture: 'debug-only evidence reducer/UI integration', ids, count, receipt, hud: await readHud(page) }
  } finally { await closePage(page) }
}

async function runDebugInvalidFiling(ids, label) {
  const page = await openPage({ debug: true })
  try {
    await debugRound9(page)
    for (const id of ids) await page.getByRole('checkbox', { name: documentName(id), exact: true }).check()
    const preview = await page.locator('.evidence-preview').innerText()
    assert.match(preview, /valid filing must include the required existence declaration/i)
    assert.match(preview, /Filing now will count as a wrong submission/i)
    const before = await readHud(page)
    await capture(page, `debug-${label.replaceAll(' ', '-')}-failed-filing`)
    await page.getByRole('button', { name: 'File evidence', exact: true }).click()
    await assertRound(page, 10)
    const receipt = await receiptText(page)
    assert.match(receipt, /^Receipt \d+: Rejected; advanced after failure\. Round 9\. Strikes \+1\.$/)
    const after = await readHud(page)
    assert.equal(after.score, before.score, `${label}: malformed evidence gets no score`)
    assert.equal(after.suspicion, before.suspicion, `${label}: malformed evidence gets no attachment suspicion`)
    assert.equal(after.strikes, String(Number(before.strikes) + 1))
    return { fixture: 'debug-only invalid payload', ids, preview, receipt, hud: after }
  } finally { await closePage(page) }
}

async function runDebugExpiry() {
  const page = await openPage({ debug: true })
  try {
    await debugRound9(page)
    for (const id of ['existence-declaration', 'fern-reference', 'queue-receipt']) await page.getByRole('checkbox', { name: documentName(id), exact: true }).check()
    await assertPreview(page, 2, 'expiry draft')
    const before = await readHud(page)
    const previousReceipt = await receiptText(page)
    await page.clock.runFor(20_000)
    await assertRound(page, 10)
    const receipt = await receiptText(page)
    assert.match(receipt, /^Receipt \d+: Time expired; advanced after failure\. Round 9\. Strikes \+1\.$/)
    const after = await readHud(page)
    assert.equal(after.score, before.score, 'expiry awards no evidence score')
    assert.equal(after.suspicion, before.suspicion, 'expiry awards no attachment suspicion')
    assert.equal(after.strikes, String(Number(before.strikes) + 1))
    assert.notEqual(receipt, previousReceipt)
    await capture(page, 'debug-round9-expiry-no-attachment-award')
    return { fixture: 'debug-only timer expiry', receipt, before, after }
  } finally { await closePage(page) }
}

async function runInitialAppealGuards() {
  const page = await openPage({ clock: 'ordinary' })
  try {
    await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
    const suspicion = page.getByRole('button', { name: 'Appeal: suspicion relief', exact: true })
    const strike = page.getByRole('button', { name: 'Appeal: strike relief', exact: true })
    assert.equal(await suspicion.isDisabled(), true)
    assert.equal(await strike.isDisabled(), true)
    assert.match(await page.locator('#appeal-suspicion-status').innerText(), /need at least 50 points/)
    assert.match(await page.locator('#appeal-strike-status').innerText(), /need at least 50 points/)
    await capture(page, 'natural-initial-appeal-guards')
    return { route: 'normal no-debug start', suspicionDisabled: true, strikeDisabled: true }
  } finally { await closePage(page) }
}

async function prepareNaturalRound9(page, label, targetTimer) {
  await assertRound(page, 9)
  const notice = await waitNotice(page)
  const noticeText = await notice.innerText()
  await capture(page, `${label}-natural-round9-final-notice`)
  await dismissPopups(page)
  await waitForTimer(page, targetTimer)
  return { notice: noticeText, hud: await readHud(page), timer: await timerNumber(page) }
}

async function finishHuman(page, expectedTitle, screenshotName) {
  const box = page.locator('.final-box')
  await box.click(); await box.click()
  await page.getByRole('button', { name: 'I am human', exact: true }).click()
  await page.getByRole('heading', { name: expectedTitle, exact: true }).waitFor()
  await capture(page, screenshotName)
  return expectedTitle
}

async function fileNaturalEvidencePrepared(page, optionalIds, label, { terminal = false, checkFlagPreview = false } = {}) {
  const before = await readHud(page)
  const timeLeft = await timerNumber(page)
  const ids = ['existence-declaration', ...optionalIds]
  for (const id of ids) await page.getByRole('checkbox', { name: documentName(id), exact: true }).check()
  await assertPreview(page, optionalIds.length, `${label} natural preview`)
  if (checkFlagPreview) {
    assert.equal(before.suspicion, '65')
    assert.match(await page.locator('.evidence-preview').innerText(), /this valid filing would flag the run/i)
  }
  const attachments = optionalIds.length
  const expectedScore = Number(before.score) + 100 + timeLeft + 50 + attachments * 40
  const afterTiming = timeLeft < 4
    ? Math.min(100, Number(before.suspicion) + 5)
    : timeLeft >= 10
      ? Math.max(0, Number(before.suspicion) - 5)
      : Number(before.suspicion)
  const expectedSuspicion = Math.min(100, afterTiming + attachments * 15)
  await capture(page, `${label}-natural-evidence-preview`)
  const receipt = await submitFiling(page, ids, terminal ? undefined : expectedScore, terminal ? undefined : expectedSuspicion, label, terminal)
  if (terminal) {
    assert.ok(receipt.includes(`Score +${expectedScore - Number(before.score)}.`), `${label}: terminal receipt score delta matches pass and extras: ${receipt}`)
    assert.ok(receipt.includes(`Suspicion +${expectedSuspicion - Number(before.suspicion)}.`), `${label}: terminal receipt includes timing-first attachment delta: ${receipt}`)
  }
  return { before, timeLeft, expectedScore, expectedSuspicion, optionalIds, receipt }
}

async function runNear40Route({ label, optionalIds, useAppeal, ending }) {
  const page = await openPage({ clock: 'controlled' })
  try {
    const route = await reachRound9Naturally(page, { slow: [1, 2, 3, 5, 7, 8], wrongRound1: true })
    assert.equal(route.beforeEvidence.suspicion, '35', `${label}: same legal no-debug round-9 prestate`)
    assert.equal(route.beforeEvidence.strikes, '1')
    const prepared = await prepareNaturalRound9(page, label, 17)
    let appealReceipt
    if (useAppeal) {
      const suspicion = page.getByRole('button', { name: 'Appeal: suspicion relief', exact: true })
      const strike = page.getByRole('button', { name: 'Appeal: strike relief', exact: true })
      assert.equal(await suspicion.isEnabled(), true)
      assert.equal(await strike.isDisabled(), true, 'one strike cannot be removed')
      const before = await readHud(page)
      await capture(page, `${label}-appeal-guards-before-suspicion-relief`)
      await suspicion.click()
      const after = await readHud(page)
      assert.equal(after.score, String(Number(before.score) - 50))
      assert.equal(after.suspicion, '15')
      assert.equal(after.strikes, before.strikes)
      assert.equal(after.round, before.round)
      assert.equal(after.timer, '17s', 'suspicion Appeal leaves the 17-second timer identity intact')
      appealReceipt = await receiptText(page)
      assert.match(appealReceipt, /^Receipt \d+: Appeal accepted: suspicion relief\. Round 9\. Score -50\. Suspicion -20\.$/)
      assert.equal(await strike.isDisabled(), true, 'suspicion Appeal consumes the shared strike opportunity')
      await page.clock.runFor(1000)
      assert.equal(await timerNumber(page), 16, 'the same round timer continues from 17s to 16s')
      await capture(page, `${label}-appeal-suspicion-receipt-timer-16`)
    }
    const filing = await fileNaturalEvidencePrepared(page, optionalIds, label)
    const title = await finishHuman(page, ending, `${label}-final-${ending.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`)
    return { route: 'normal no-debug legal near-40 play', preEvidence: route.beforeEvidence, prepared, usedAppeal: useAppeal, appealReceipt, filing, ending: title }
  } finally { await closePage(page) }
}

async function runStrikeRescueRoute({ useAppeal }) {
  const label = useAppeal ? 'strike-rescue' : 'strike-no-rescue'
  const page = await openPage({ clock: 'controlled' })
  try {
    const route = await reachRound9Naturally(page, {
      slow: [1, 2, 3, 5, 7, 8], wrongRound1: true, earlyRound4: true,
      strikeAppeal: useAppeal, wrongRound7: true,
    })
    if (!useAppeal) {
      assert.equal(route.stoppedAt, 'round 7 third strike')
      assert.equal(await page.getByRole('heading', { name: 'APPLICATION REJECTED', exact: true }).count(), 1)
      await capture(page, 'natural-next-failure-without-appeal-rejected')
      return { route: 'normal no-debug two-strike state then next failure', stoppedAt: route.stoppedAt, result: route.result, ending: 'APPLICATION REJECTED' }
    }
    assert.equal(route.beforeEvidence.round, '9/10')
    assert.equal(route.beforeEvidence.suspicion, '65')
    assert.equal(route.beforeEvidence.strikes, '2')
    const prepared = await prepareNaturalRound9(page, label, 3)
    assert.equal(prepared.hud.suspicion, '65')
    assert.equal(prepared.hud.strikes, '2')
    const filing = await fileNaturalEvidencePrepared(page, ['fern-reference', 'queue-receipt'], label, { terminal: true, checkFlagPreview: true })
    await capture(page, 'natural-strike-rescue-both-attachments-terminal-receipt')
    return { route: 'normal no-debug strike relief rescues one later failure, then valid round-nine filing flags', beforeEvidence: route.beforeEvidence, appealReceipt: route.strikeAppealReceipt, prepared, filing, ending: 'ACCOUNT FLAGGED' }
  } finally { await closePage(page) }
}

async function runLegal() {
  await scenario('natural route: same suspicion-35 prestate, zero optional evidence ends VERIFIED', () => runNear40Route({ label: 'near40-zero-no-appeal', optionalIds: [], useAppeal: false, ending: 'VERIFIED: HUMAN' }))
  await scenario('natural route: one optional attachment moves the same near-40 run to PROBABLY HUMAN', () => runNear40Route({ label: 'near40-fern-no-appeal', optionalIds: ['fern-reference'], useAppeal: false, ending: 'STATUS: PROBABLY HUMAN' }))
  await scenario('natural route: suspicion Appeal shares the resource and restores the same one-extra run to VERIFIED', () => runNear40Route({ label: 'near40-fern-suspicion-appeal', optionalIds: ['fern-reference'], useAppeal: true, ending: 'VERIFIED: HUMAN' }))
  await scenario('natural route: without Appeal the next failure after two strikes is rejected', () => runStrikeRescueRoute({ useAppeal: false }))
  await scenario('natural route: strike Appeal rescues the next failure; slow two-extra Evidence route flags legally', () => runStrikeRescueRoute({ useAppeal: true }))
}

async function runCore() {
  await scenario('normal no-debug round 9, ordinary-clock FINAL NOTICE, readable local evidence preview and mandatory-only receipt', runNaturalReadingAndMandatory)
  await scenario('debug fixture: existence declaration only awards ordinary pass', () => runDebugEvidenceSubset(['existence-declaration'], 'required-only'))
  await scenario('debug fixture: Fern reference awards one optional attachment', () => runDebugEvidenceSubset(['existence-declaration', 'fern-reference'], 'fern-only'))
  await scenario('debug fixture: Queue receipt awards one optional attachment', () => runDebugEvidenceSubset(['existence-declaration', 'queue-receipt'], 'queue-only'))
  await scenario('debug fixture: both optional attachments award exactly twice', () => runDebugEvidenceSubset(['existence-declaration', 'fern-reference', 'queue-receipt'], 'both-optional'))
  await scenario('debug fixture: empty evidence filing is one ordinary wrong submission', () => runDebugInvalidFiling([], 'empty'))
  await scenario('debug fixture: optional-only evidence is invalid and receives no extras', () => runDebugInvalidFiling(['fern-reference'], 'optional-only'))
  await scenario('debug fixture: round-nine expiry awards no attachments and advances once', runDebugExpiry)
  await scenario('normal no-debug initial Appeal guards expose disabled reasons', runInitialAppealGuards)
}

try {
  if (mode === 'core' || mode === 'all') await runCore()
  if (mode === 'legal' || mode === 'all') await runLegal()
  if (pageErrors.length) failures.push({ name: 'browser page/console errors', error: pageErrors.join('; ') })
} finally {
  await Promise.all([...pages].map((page) => page.close()))
  await browser.close()
}

const summary = { baseURL, mode, selected: results.length, passed: results.filter((item) => item.passed).length, failed: failures.length, skipped: [], pageErrors, screenshots, results, failures }
await writeFile(path.join(evidenceDir, 'evidence-results.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify({ selected: summary.selected, passed: summary.passed, failed: summary.failed, pageErrors: pageErrors.length, screenshots: screenshots.length }))
if (failures.length) process.exitCode = 1
