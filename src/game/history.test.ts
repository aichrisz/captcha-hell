import { describe, expect, it } from 'vitest'
import { getRecallCount, recordAnswer } from './history'

describe('history', () => {
  it('recordAnswer does not mutate the input', () => {
    const base = [{ round: 1, passed: true, count: 3 }]
    const next = recordAnswer(base, { round: 2, passed: true })
    expect(base).toHaveLength(1)
    expect(next).toHaveLength(2)
  })

  it('getRecallCount returns the latest count for a round', () => {
    let h = recordAnswer([], { round: 1, passed: false, count: 2 })
    h = recordAnswer(h, { round: 1, passed: true, count: 3 })
    h = recordAnswer(h, { round: 2, passed: true })
    expect(getRecallCount(h, 1)).toBe(3)
  })

  it('getRecallCount is undefined when the round has no count', () => {
    const h = recordAnswer([], { round: 2, passed: true })
    expect(getRecallCount(h, 1)).toBeUndefined()
    expect(getRecallCount(h, 2)).toBeUndefined()
  })
})
