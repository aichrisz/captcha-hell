import { describe, expect, it } from 'vitest'
import { evalChoice } from './wordChoice'
import type { FinalChoice } from '../types'

describe('evalChoice', () => {
  it('round 7 passes only on the correct index', () => {
    expect(evalChoice(2, 2).passed).toBe(true)
    expect(evalChoice(0, 2).passed).toBe(false)
    expect(evalChoice(0, 2).finalChoice).toBeUndefined()
  })

  it('round 10 branch map always passes and maps the choice', () => {
    const branch: FinalChoice[] = ['human', 'trying', 'matter']
    expect(evalChoice(0, branch)).toEqual({ passed: true, finalChoice: 'human' })
    expect(evalChoice(1, branch)).toEqual({ passed: true, finalChoice: 'trying' })
    expect(evalChoice(2, branch)).toEqual({ passed: true, finalChoice: 'matter' })
  })
})
