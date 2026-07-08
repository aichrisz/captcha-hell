import { describe, expect, it } from 'vitest'
import { validateGrid } from './grid'

describe('validateGrid', () => {
  it('passes on exact match and reports count', () => {
    const r = validateGrid([0, 4, 7], [0, 4, 7])
    expect(r.passed).toBe(true)
    expect(r.count).toBe(3)
  })

  it('fails when a required cell is missing', () => {
    expect(validateGrid([0, 4], [0, 4, 7]).passed).toBe(false)
  })

  it('fails when an extra cell is selected', () => {
    expect(validateGrid([0, 4, 7, 1], [0, 4, 7]).passed).toBe(false)
  })

  it('ambiguous cell passes unselected and reports poster', () => {
    const r = validateGrid([1, 3, 8], [1, 3, 8], [5])
    expect(r.passed).toBe(true)
    expect(r.ambiguousChoice).toBe('poster')
  })

  it('ambiguous cell passes selected and reports bicycle', () => {
    const r = validateGrid([1, 3, 8, 5], [1, 3, 8], [5])
    expect(r.passed).toBe(true)
    expect(r.ambiguousChoice).toBe('bicycle')
  })

  it('ambiguous cell does not replace a required cell', () => {
    expect(validateGrid([1, 3, 5], [1, 3, 8], [5]).passed).toBe(false)
  })

  it('inverted round 9 mode passes only with all nine selected', () => {
    const all = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    expect(validateGrid(all, all).passed).toBe(true)
    expect(validateGrid(all.slice(0, 8), all).passed).toBe(false)
  })
})
