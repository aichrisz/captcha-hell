import { describe, expect, it } from 'vitest'
import { MAX_STRIKES, applyStrike } from './strikes'

describe('strikes', () => {
  it('increments and carries the source', () => {
    const o = applyStrike({ strikes: 0 }, 'wrongSubmit')
    expect(o.strikes).toBe(1)
    expect(o.lost).toBe(false)
    expect(o.source).toBe('wrongSubmit')
  })

  it('third strike loses', () => {
    expect(applyStrike({ strikes: 2 }, 'timerExpiry').lost).toBe(true)
    expect(MAX_STRIKES).toBe(3)
  })

  it('every source counts the same', () => {
    for (const source of ['wrongSubmit', 'singleAttemptFail', 'timerExpiry', 'earlyClick'] as const) {
      expect(applyStrike({ strikes: 1 }, source).strikes).toBe(2)
    }
  })
})
