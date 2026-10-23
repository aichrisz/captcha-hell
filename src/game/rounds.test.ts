import { describe, expect, it } from 'vitest'
import { ROUNDS, getRound } from './rounds'
import { ENDING_COPY } from './endings'

describe('rounds data', () => {
  it('has 10 rounds with ids 1-10', () => {
    expect(ROUNDS).toHaveLength(10)
    ROUNDS.forEach((r, i) => expect(r.id).toBe(i + 1))
  })

  it('maps stages 1-3, 4-6, 7-9, 10', () => {
    for (const r of ROUNDS) {
      const want = r.id <= 3 ? 1 : r.id <= 6 ? 2 : r.id <= 9 ? 3 : 4
      expect(r.stage).toBe(want)
    }
  })

  it('allows retry only on rounds 1-6', () => {
    for (const r of ROUNDS) expect(r.allowRetry).toBe(r.id <= 6)
  })

  it('covers all required puzzle types', () => {
    const types = new Set(ROUNDS.map((r) => r.type))
    for (const t of ['grid', 'checkbox', 'timedClick', 'slider', 'stamps', 'wordChoice', 'recall', 'evidence', 'final']) {
      expect(types.has(t as never)).toBe(true)
    }
  })

  it('keeps round 6 as an untimed retryable stage 2 stamp puzzle', () => {
    expect(getRound(6)).toMatchObject({ id: 6, stage: 2, type: 'stamps', timerSec: 0, allowRetry: true })
    expect(ROUNDS).toHaveLength(10)
    expect(getRound(7)).toMatchObject({ id: 7, type: 'wordChoice', timerSec: 20, allowRetry: false })
    expect(getRound(10).type).toBe('final')
  })

  it('getRound is 1-indexed', () => {
    expect(getRound(1).id).toBe(1)
    expect(getRound(10).type).toBe('final')
  })

  it('contains no em dash or en dash in any copy', () => {
    const blob = JSON.stringify(ROUNDS) + JSON.stringify(ENDING_COPY)
    expect(blob.includes('\u2013')).toBe(false)
    expect(blob.includes('\u2014')).toBe(false)
  })
})
