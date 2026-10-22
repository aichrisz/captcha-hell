import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const playwrightModule = process.env.PLAYWRIGHT_MODULE
const baseURL = process.env.BASE_URL
const evidenceDir = process.env.EVIDENCE_DIR
assert.ok(playwrightModule, 'Set PLAYWRIGHT_MODULE to an installed Playwright module path.')
assert.ok(baseURL, 'Set BASE_URL to the running app URL, including its base path.')
assert.ok(evidenceDir, 'Set EVIDENCE_DIR to the designated artifact directory.')

const { chromium } = await import(playwrightModule)
const browser = await chromium.launch({ headless: true })
const pages = new Set()
const pageErrors = []
const results = []
const screenshotsDir = path.join(evidenceDir, 'screenshots')
const bestKey = 'captcha-hell.best.v1'
const endingsKey = 'captcha-hell.endings.v1'
await mkdir(screenshotsDir, { recursive: true })

function appURL(debug = false) {
  const url = new URL(baseURL)
  if (debug) url.searchParams.set('debug', '1')
  return url.toString()
}

async function openPage({ viewport = { width: 390, height: 844 }, motion = 'reduced', debug = false, clock = true, mobile = false } = {}) {
  const page = await browser.newPage({
    viewport,
    reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference',
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  })
  pages.add(page)
  page.setDefaultTimeout(6000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()) })
  if (clock) await page.clock.install()
  await page.goto(appURL(debug))
  if (clock) await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  return page
}

async function closePage(page) {
  pages.delete(page)
  await page.close()
}

async function hud(page) {
  const rows = await page.locator('.hud .stat').evaluateAll((elements) =>
    elements.map((element) => element.innerText.split('\n').map((part) => part.trim())))
  return Object.fromEntries(rows.map(([label, value]) => [label.toLowerCase(), value]))
}

async function assertRound(page, round) {
  const values = await hud(page)
  assert.equal(values.round, `${round}/10`)
}

async function dismissPopups(page) {
  while (await page.locator('.popup button').count()) await page.locator('.popup button').first().click()
}

async function readStorage(page) {
  return page.evaluate(([best, endings]) => [localStorage.getItem(best), localStorage.getItem(endings)], [bestKey, endingsKey])
}

async function reachRound6Normally(page, { motion = 'reduced', popup = false } = {}) {
  await page.getByRole('button', { name: 'Begin verification', exact: true }).click()
  for (const index of [0, 4, 7]) await page.locator('.cell').nth(index).click()
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  const checkboxClicks = motion === 'reduced' ? 2 : 3
  for (let click = 0; click < checkboxClicks; click += 1) await page.locator('.checkbox').first().click()
  for (const index of [1, 3, 8]) await page.locator('.cell').nth(index).click()
  await page.getByRole('button', { name: 'Verify selection', exact: true }).click()
  await page.clock.runFor(3450)
  await page.locator('.verify').dispatchEvent('click')
  const slider = page.getByRole('slider', { name: 'alignment slider' })
  await slider.press('Home')
  for (let step = 0; step < 62; step += 1) await slider.press('ArrowRight')
  if (popup) {
    await page.clock.runFor(1800)
    await page.locator('.popup').waitFor()
  }
  await page.getByRole('button', { name: 'Lock alignment', exact: true }).click()
  await assertRound(page, 6)
}

async function enterRound6ByDebug(page, { popup = false } = {}) {
  const begin = page.getByRole('button', { name: 'Begin verification', exact: true })
  if (await begin.count()) await begin.click()
  const current = Number((await hud(page)).round.split('/')[0])
  for (let round = current; round < (popup ? 5 : 6); round += 1) {
    await page.getByRole('button', { name: 'Next round', exact: true }).click()
  }
  if (popup) {
    await page.clock.runFor(1800)
    await page.locator('.popup').waitFor()
    await page.getByRole('button', { name: 'Next round', exact: true }).click()
  }
  await assertRound(page, 6)
}

async function capture(page, name) {
  const file = path.join(screenshotsDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

async function auditFocusedHit(page, button, label) {
  const result = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hud = document.querySelector('.hud').getBoundingClientRect()
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      focused: document.activeElement === element,
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
      hud: { top: hud.top, bottom: hud.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      hit: Boolean(target && (target === element || element.contains(target))),
    }
  })
  assert.ok(result.focused, `${label}: keyboard focus was lost: ${JSON.stringify(result)}`)
  assert.ok(result.rect.width >= 44 && result.rect.height >= 44, `${label}: target below 44px: ${JSON.stringify(result)}`)
  assert.ok(result.rect.left >= -1 && result.rect.right <= result.viewport.width + 1, `${label}: target exceeds viewport: ${JSON.stringify(result)}`)
  assert.ok(result.rect.top >= result.hud.bottom - 1 && result.rect.bottom <= result.viewport.height + 1, `${label}: target under HUD or outside viewport: ${JSON.stringify(result)}`)
  assert.equal(result.hit, true, `${label}: target is not the actual center hit after keyboard focus: ${JSON.stringify(result)}`)
  return result
}

async function assertStampEdit(page, count, pattern) {
  await page.waitForFunction((expected) => window.__stampLocalChanges?.length >= expected, count)
  const changes = await page.evaluate(() => window.__stampLocalChanges)
  assert.equal(changes.length, count, 'each local edit announces exactly one update')
  assert.match(changes[count - 1], pattern)
}

try {
  {
    const page = await openPage()
    await reachRound6Normally(page)
    const before = await hud(page)
    assert.equal(before.timer, 'untimed')
    assert.equal(before.strikes, '0')
    const requirements = page.locator('#stamp-rules')
    const consequence = page.locator('#stamp-consequence')
    assert.match(await requirements.textContent(), /Witness.+Original.+readable/i)
    assert.match(await requirements.textContent(), /Copy.+captures.+readable state.+witness mark/i)
    assert.match(await requirements.textContent(), /Redact.+Original.+before filing/i)
    assert.match(await consequence.textContent(), /\+1 strike and \+10 suspicion/i)
    assert.match(await consequence.textContent(), /retry.+clean-pass bonus/i)
    assert.match(await consequence.textContent(), /third strike.+ends the run/i)
    const fileControl = page.getByRole('button', { name: 'File', exact: true })
    const descriptions = (await fileControl.getAttribute('aria-describedby') ?? '').split(/\s+/)
    assert.ok(descriptions.includes('stamp-rules') && descriptions.includes('stamp-consequence'), 'File announces its rules and consequence')
    assert.equal(await requirements.evaluate((element, controls) => Boolean(element.compareDocumentPosition(controls) & 4), await page.locator('.stamp-actions').elementHandle()), true, 'filing rules appear before the controls')
    const localStatus = page.locator('.stamp-local-status')
    assert.equal(await localStatus.getAttribute('role'), 'status')
    assert.equal(await localStatus.getAttribute('aria-live'), 'polite')
    await page.evaluate(() => {
      const owner = document.querySelector('.stamp-local-status')
      window.__stampLocalChanges = []
      let previous = owner.textContent ?? ''
      new MutationObserver(() => {
        const current = owner.textContent ?? ''
        if (current !== previous) {
          window.__stampLocalChanges.push(current)
          previous = current
        }
      }).observe(owner, { childList: true, characterData: true, subtree: true })
    })
    const receiptBefore = await page.locator('[data-receipt-announcer]').textContent()
    const storageBefore = await readStorage(page)
    await page.clock.runFor(60_000)
    assert.deepEqual(await hud(page), before, 'an hour of controlled waiting leaves every round measure unchanged')
    assert.equal(await page.locator('[data-receipt-announcer]').textContent(), receiptBefore, 'untimed waiting creates no receipt')

    const original = page.locator('.document-card').nth(0)
    const copy = page.locator('.document-card').nth(1)
    assert.match(await original.innerText(), /Readable/)
    assert.match(await original.innerText(), /Not witnessed/)
    assert.match(await copy.innerText(), /Absent/)
    await page.getByRole('button', { name: 'Witness', exact: true }).click()
    await assertStampEdit(page, 1, /Witness stamp applied/i)
    await page.getByRole('button', { name: 'Copy', exact: true }).click()
    await assertStampEdit(page, 2, /Copy stamp applied.+Copy readable, certified/i)
    assert.match(await original.innerText(), /Witnessed/)
    assert.match(await copy.innerText(), /Certified/)
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await assertStampEdit(page, 3, /Reset applied.+Original readable and not witnessed.+Copy absent/i)
    assert.match(await original.innerText(), /Readable/)
    assert.match(await original.innerText(), /Not witnessed/)
    assert.match(await copy.innerText(), /Absent/)
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Reset', exact: true }).isDisabled(), true)
    assert.deepEqual(await hud(page), before, 'stamp edits, Undo and Reset do not change the run HUD')
    assert.equal(await page.locator('[data-receipt-announcer]').textContent(), receiptBefore, 'stamp edits do not change the receipt')
    assert.deepEqual(await readStorage(page), storageBefore, 'stamp edits do not write best or ending storage')
    const screenshot = await capture(page, 'stamp-documents-390x844')

    await page.evaluate(() => {
      const owner = document.querySelector('[data-receipt-announcer]')
      window.__stampReceiptChanges = []
      let previous = owner.textContent ?? ''
      const observer = new MutationObserver(() => {
        const current = owner.textContent ?? ''
        if (current !== previous) {
          window.__stampReceiptChanges.push(current)
          previous = current
        }
      })
      observer.observe(owner, { childList: true, characterData: true, subtree: true })
      window.__stampReceiptObserver = observer
    })
    const previousSequence = Number((receiptBefore.match(/^Receipt (\d+):/) ?? [])[1] ?? 0)
    const scoreBefore = Number(before.score)
    const suspicionBefore = Number(before.suspicion)
    await page.getByRole('button', { name: 'Copy', exact: true }).click()
    await assertStampEdit(page, 4, /Copy stamp applied/i)
    await page.getByRole('button', { name: 'Witness', exact: true }).click()
    await assertStampEdit(page, 5, /Witness stamp applied/i)
    const file = page.getByRole('button', { name: 'File', exact: true })
    await file.evaluate((button) => { button.click(); button.click() })
    await page.waitForFunction((sequence) => document.querySelector('[data-receipt-announcer]')?.textContent?.startsWith(`Receipt ${sequence}: Rejected; retry available.`), previousSequence + 1)
    const failedReceipt = await page.locator('[data-receipt-announcer]').textContent()
    assert.match(failedReceipt, new RegExp(`^Receipt ${previousSequence + 1}: Rejected; retry available\\. Round 6\\.`))
    assert.match(await page.locator('.stamp-feedback').textContent(), /Copy must be certified when it is made/)
    assert.match(await page.locator('.stamp-feedback').textContent(), /Redact the Original before filing/)
    const failedHud = await hud(page)
    assert.equal(failedHud.round, '6/10')
    assert.equal(Number(failedHud.score), scoreBefore)
    assert.equal(Number(failedHud.strikes), Number(before.strikes) + 1, 'double File activation adds exactly one strike')
    assert.equal(Number(failedHud.suspicion), suspicionBefore + 10, 'invalid filing adds the existing retry suspicion once')
    assert.equal(await page.getByRole('button', { name: 'Witness', exact: true }).isDisabled(), true, 'failed filing preserves used stamps')
    assert.equal(await page.getByRole('button', { name: 'Copy', exact: true }).isDisabled(), true, 'failed filing preserves the Copy snapshot')
    assert.equal(await page.getByRole('button', { name: 'Redact', exact: true }).isDisabled(), false, 'unused Redact remains available after a failed filing')
    assert.equal(await file.isEnabled(), true, 'File remains available after a failed filing')
    assert.equal(await page.evaluate(() => window.__stampReceiptChanges.length), 1, 'double File activation creates one receipt')
    assert.deepEqual(await readStorage(page), storageBefore, 'invalid File does not change best or ending storage')

    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await assertStampEdit(page, 6, /Undo applied.+Original readable and not witnessed.+Copy readable, not certified/i)
    assert.match(await original.innerText(), /Readable/)
    assert.match(await original.innerText(), /Not witnessed/)
    assert.match(await copy.innerText(), /Readable/)
    assert.match(await copy.innerText(), /Not certified/)
    assert.equal(await page.locator('.stamp-feedback').count(), 0, 'editing clears only the local filing notice')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await assertStampEdit(page, 7, /Undo applied.+Copy absent/i)
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true)
    assert.match(await copy.innerText(), /Absent/)
    for (const [index, stamp] of ['Witness', 'Copy', 'Redact'].entries()) {
      await page.getByRole('button', { name: stamp, exact: true }).click()
      await assertStampEdit(page, index + 8, new RegExp(`${stamp} stamp applied`, 'i'))
    }
    assert.match((await page.evaluate(() => window.__stampLocalChanges)).at(-1), /Original redacted/i)
    await file.evaluate((button) => { button.click(); button.click() })
    await page.waitForFunction((round) => document.querySelector('.hud .stat:nth-of-type(5) strong')?.textContent === `${round}/10`, 7)
    const passedHud = await hud(page)
    assert.equal(Number(passedHud.score), scoreBefore + 100, 'retried untimed pass earns no speed bonus')
    assert.equal(passedHud.strikes, '1')
    assert.equal(passedHud.suspicion, '10', 'untimed pass does not add slow or clean-fast suspicion')
    assert.equal(await page.evaluate(() => window.__stampReceiptChanges.length), 2, 'pass double activation creates one additional receipt')
    assert.match(await page.locator('[data-receipt-announcer]').textContent(), new RegExp(`^Receipt ${previousSequence + 2}: Accepted; next challenge opened\\. Round 6\\.`))
    await assertRound(page, 7)
    results.push({ scenario: 'normal round 5 to 6, untimed state, local edits, Reset, invalid File, retry preservation, Undo and one retried pass', passed: true, before, failedHud, passedHud, failedReceipt, receipt: await page.locator('[data-receipt-announcer]').textContent(), screenshot })
    await closePage(page)
  }

  {
    const page = await openPage({ debug: true })
    await enterRound6ByDebug(page)
    await page.getByRole('button', { name: 'Witness', exact: true }).click()
    assert.match(await page.locator('.document-card').first().innerText(), /Witnessed/)
    await page.getByRole('button', { name: 'Next round', exact: true }).click()
    await page.getByRole('button', { name: 'Force ending', exact: true }).click()
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await enterRound6ByDebug(page)
    assert.match(await page.locator('.document-card').first().innerText(), /Not witnessed/)
    assert.match(await page.locator('.document-card').last().innerText(), /Absent/)
    results.push({ scenario: 'restart clears local stamp sequence through normal run restart', passed: true })
    await closePage(page)
  }

  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 915, height: 412 },
    { width: 1440, height: 1000 },
  ]) {
    for (const motion of ['full', 'reduced']) {
      const page = await openPage({ viewport, motion, mobile: viewport.width <= 520 || viewport.height <= 520 })
      await reachRound6Normally(page, { motion })
      if (viewport.width === 320) {
        await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
        await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '32px')
      }
      assert.equal((await hud(page)).timer, 'untimed')
      assert.equal(await page.locator('.document-card').count(), 2)
      for (const id of ['stamp-rules', 'stamp-consequence']) {
        const bounds = await page.locator(`#${id}`).evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, right: rect.right, width: rect.width, height: rect.height }
        })
        assert.ok(bounds.width > 0 && bounds.height > 0 && bounds.left >= -1 && bounds.right <= viewport.width + 1, `${viewport.width}x${viewport.height} ${id} reflow: ${JSON.stringify(bounds)}`)
      }
      const columns = await page.locator('.document-pair').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
      assert.equal(columns, viewport.width <= 520 ? 1 : 2, `${viewport.width}x${viewport.height} paper layout`)
      const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
      assert.ok(size.scroll <= viewport.width + 1 && size.body <= viewport.width + 1, `${viewport.width}x${viewport.height} horizontal overflow: ${JSON.stringify(size)}`)
      const targets = await page.locator('.stamp-actions button').evaluateAll((buttons) => buttons.map((button) => {
        const rect = button.getBoundingClientRect()
        return { label: button.textContent, width: rect.width, height: rect.height }
      }))
      assert.equal(targets.length, 6)
      assert.ok(targets.every((target) => target.width >= 44 && target.height >= 44), `${viewport.width}x${viewport.height} target size: ${JSON.stringify(targets)}`)
      if (viewport.width === 320 && motion === 'reduced') {
        const witness = page.getByRole('button', { name: 'Witness', exact: true })
        await witness.focus()
        const hit = await auditFocusedHit(page, witness, '320px keyboard Witness')
        await witness.press('Enter')
        results.push({ scenario: '320px reduced motion, 200 percent text, keyboard focus and actual hit test', passed: true, hit })
      }
      await capture(page, `stamps-${viewport.width}x${viewport.height}-${motion}${viewport.width === 320 ? '-200-text' : ''}`)
      await closePage(page)
    }
  }

  {
    const page = await openPage({ viewport: { width: 390, height: 844 }, mobile: true })
    await reachRound6Normally(page)
    for (const stamp of ['Witness', 'Copy', 'Redact']) await page.getByRole('button', { name: stamp, exact: true }).tap()
    await page.getByRole('button', { name: 'File', exact: true }).tap()
    await assertRound(page, 7)
    results.push({ scenario: 'touch completes the stamp puzzle', passed: true })
    await closePage(page)
  }

  {
    const page = await openPage({ viewport: { width: 320, height: 740 }, mobile: true })
    await reachRound6Normally(page, { popup: true })
    await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
    await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '32px')
    const popupCount = await page.locator('.popup').count()
    assert.equal(popupCount, 1, 'round 5 notice remains visible at stamp round entry')
    const file = page.getByRole('button', { name: 'File', exact: true })
    await file.focus()
    const hit = await auditFocusedHit(page, file, '320px keyboard File with notice and 200% text')
    await file.press('Enter')
    await dismissPopups(page)
    results.push({ scenario: 'keyboard focus and hit testing for File with notice beneath the sticky HUD at 200% text', passed: true, hit, popupCount })
    await closePage(page)
  }

  assert.deepEqual(pageErrors, [], `browser page/console errors: ${pageErrors.join('; ')}`)
  await writeFile(path.join(evidenceDir, 'stamps-results.json'), `${JSON.stringify({ baseURL, results, pageErrors }, null, 2)}\n`)
  console.log(`PASS: ${results.length} document stamp browser scenarios, zero JavaScript/console errors. Evidence: ${evidenceDir}`)
} finally {
  await Promise.all([...pages].map((page) => page.close()))
  await browser.close()
}
