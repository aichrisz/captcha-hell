import { describe, expect, it } from 'vitest'
import { filesForStage, POPUPS, popupsForRound, webcamLine } from './intrusions'

describe('popups', () => {
  it('are scheduled on rounds 3, 5, 7 and 9 only', () => {
    for (let round = 1; round <= 10; round++) {
      const expected = [3, 5, 7, 9].includes(round) ? 1 : 0
      expect(popupsForRound(round)).toHaveLength(expected)
    }
  })

  it('carry complete copy and unique ids', () => {
    const ids = new Set(POPUPS.map((p) => p.id))
    expect(ids.size).toBe(POPUPS.length)
    for (const p of POPUPS) {
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.body.length).toBeGreaterThan(0)
      expect(p.dismiss.length).toBeGreaterThan(0)
      expect(p.delayMs).toBeGreaterThan(0)
    }
  })
})

describe('webcamLine', () => {
  it('is deterministic and non-empty for every round', () => {
    for (let round = 1; round <= 10; round++) {
      const line = webcamLine(round, 0)
      expect(line.length).toBeGreaterThan(0)
      expect(webcamLine(round, 0)).toBe(line)
    }
  })

  it('turns accusatory above 65 suspicion', () => {
    expect(webcamLine(2, 70)).toContain('humans fidget')
    expect(webcamLine(2, 65)).not.toContain('humans fidget')
  })
})

describe('filesForStage', () => {
  it('returns at least two named files per stage', () => {
    for (const stage of [1, 2, 3, 4] as const) {
      const files = filesForStage(stage)
      expect(files.length).toBeGreaterThanOrEqual(2)
      for (const f of files) expect(f.length).toBeGreaterThan(0)
    }
  })
})
