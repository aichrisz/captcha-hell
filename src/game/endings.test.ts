import { describe, expect, it } from 'vitest'
import { ENDING_COPY, selectEnding } from './endings'
import type { EndingId, FinalChoice } from './types'

interface Case {
  suspicion: number
  strikes: number
  finalChoice?: FinalChoice
  want: EndingId
}

const cases: Case[] = [
  { suspicion: 100, strikes: 3, finalChoice: 'matter', want: 'flagged' },
  { suspicion: 100, strikes: 0, want: 'flagged' },
  { suspicion: 20, strikes: 3, finalChoice: 'matter', want: 'rejected' },
  { suspicion: 0, strikes: 3, want: 'rejected' },
  { suspicion: 20, strikes: 0, finalChoice: 'matter', want: 'ghost' },
  { suspicion: 99, strikes: 2, finalChoice: 'matter', want: 'ghost' },
  { suspicion: 39, strikes: 2, finalChoice: 'human', want: 'verified' },
  { suspicion: 0, strikes: 0, finalChoice: 'human', want: 'verified' },
  { suspicion: 40, strikes: 0, finalChoice: 'human', want: 'probablyHuman' },
  { suspicion: 10, strikes: 0, finalChoice: 'trying', want: 'probablyHuman' },
  { suspicion: 0, strikes: 0, want: 'probablyHuman' },
]

describe('selectEnding matrix', () => {
  for (const c of cases) {
    it(`suspicion ${c.suspicion}, strikes ${c.strikes}, choice ${c.finalChoice ?? 'none'} -> ${c.want}`, () => {
      expect(selectEnding(c)).toBe(c.want)
    })
  }

  it('all five endings are reachable and have copy', () => {
    const reached = new Set(cases.map((c) => selectEnding(c)))
    expect(reached.size).toBe(5)
    for (const id of reached) {
      expect(ENDING_COPY[id].title.length).toBeGreaterThan(0)
      expect(ENDING_COPY[id].lines.length).toBeGreaterThan(0)
    }
  })
})
