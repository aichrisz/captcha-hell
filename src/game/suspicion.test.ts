import { describe, expect, it } from 'vitest'
import { SUSPICION_DELTA, applySuspicion } from './suspicion'

describe('suspicion', () => {
  it('applies each event delta', () => {
    expect(applySuspicion(0, 'retry')).toBe(10)
    expect(applySuspicion(0, 'slowAnswer')).toBe(5)
    expect(applySuspicion(0, 'dodgeMiss')).toBe(5)
    expect(applySuspicion(0, 'round7Wrong')).toBe(20)
    expect(applySuspicion(0, 'idle')).toBe(5)
    expect(applySuspicion(50, 'cleanFastPass')).toBe(45)
  })

  it('clamps at 100', () => {
    expect(applySuspicion(95, 'round7Wrong')).toBe(100)
  })

  it('clamps at 0', () => {
    expect(applySuspicion(3, 'cleanFastPass')).toBe(0)
    expect(applySuspicion(0, 'cleanFastPass')).toBe(0)
  })

  it('only cleanFastPass decays', () => {
    for (const [event, delta] of Object.entries(SUSPICION_DELTA)) {
      if (event === 'cleanFastPass') expect(delta).toBeLessThan(0)
      else expect(delta).toBeGreaterThan(0)
    }
  })
})
