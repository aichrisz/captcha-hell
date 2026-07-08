import { describe, expect, it } from 'vitest'
import {
  humanityLabel,
  humanityScore,
  isTooPerfect,
  perfectionDrag,
  TOO_PERFECT_MIN_ROUNDS,
  TOO_PERFECT_MIN_SCORE,
} from './humanity'

const perfect = { score: 1600, strikes: 0, suspicion: 0, roundsCleared: 10 }

describe('isTooPerfect', () => {
  it('fires on a flawless fast full run', () => {
    expect(isTooPerfect(perfect)).toBe(true)
  })

  it('requires the documented thresholds', () => {
    expect(isTooPerfect({ ...perfect, score: TOO_PERFECT_MIN_SCORE - 1 })).toBe(false)
    expect(isTooPerfect({ ...perfect, strikes: 1 })).toBe(false)
    expect(isTooPerfect({ ...perfect, suspicion: 1 })).toBe(false)
    expect(isTooPerfect({ ...perfect, roundsCleared: TOO_PERFECT_MIN_ROUNDS - 1 })).toBe(false)
  })
})

describe('perfectionDrag', () => {
  it('is zero once any strike or suspicion exists', () => {
    expect(perfectionDrag({ ...perfect, strikes: 1 })).toBe(0)
    expect(perfectionDrag({ ...perfect, suspicion: 5 })).toBe(0)
  })

  it('grows with score and caps at 35', () => {
    expect(perfectionDrag({ ...perfect, score: 500 })).toBe(10)
    expect(perfectionDrag({ ...perfect, score: 9999 })).toBe(35)
  })
})

describe('humanityScore', () => {
  it('stays within 0-100 across a sweep', () => {
    for (let strikes = 0; strikes <= 3; strikes++) {
      for (let suspicion = 0; suspicion <= 100; suspicion += 10) {
        for (const score of [0, 400, 1200, 1800]) {
          const h = humanityScore({ score, strikes, suspicion, roundsCleared: 10 })
          expect(h).toBeGreaterThanOrEqual(0)
          expect(h).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('rewards mistakes and mild chaos', () => {
    const clean = humanityScore({ score: 500, strikes: 0, suspicion: 20, roundsCleared: 5 })
    const messy = humanityScore({ score: 500, strikes: 2, suspicion: 20, roundsCleared: 5 })
    expect(messy).toBeGreaterThan(clean)
  })

  it('drains on a robotically perfect run', () => {
    expect(humanityScore(perfect)).toBe(28)
  })

  it('punishes maxed suspicion', () => {
    const calm = humanityScore({ score: 500, strikes: 1, suspicion: 20, roundsCleared: 6 })
    const frantic = humanityScore({ score: 500, strikes: 1, suspicion: 95, roundsCleared: 6 })
    expect(frantic).toBeLessThan(calm)
  })
})

describe('humanityLabel', () => {
  it('maps bands to copy', () => {
    expect(humanityLabel(80)).toBe('convincingly organic')
    expect(humanityLabel(50)).toBe('plausibly alive')
    expect(humanityLabel(30)).toBe('worryingly smooth')
    expect(humanityLabel(10)).toBe('statistically synthetic')
  })
})
