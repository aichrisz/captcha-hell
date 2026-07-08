import { describe, expect, it } from 'vitest'
import { FLAVOR_BANK, pickFlavor } from './flavor'

describe('flavor bank', () => {
  it('has a healthy rotation of lines', () => {
    expect(FLAVOR_BANK.length).toBeGreaterThanOrEqual(12)
    for (const line of FLAVOR_BANK) expect(line.length).toBeGreaterThan(0)
  })

  it('picks deterministically from the bank', () => {
    for (let round = 1; round <= 10; round++) {
      for (let tick = 0; tick < 5; tick++) {
        const line = pickFlavor(round, tick)
        expect(FLAVOR_BANK).toContain(line)
        expect(pickFlavor(round, tick)).toBe(line)
      }
    }
  })

  it('rotates as ticks advance', () => {
    const seen = new Set<string>()
    for (let tick = 0; tick < FLAVOR_BANK.length; tick++) seen.add(pickFlavor(1, tick))
    expect(seen.size).toBe(FLAVOR_BANK.length)
  })
})
