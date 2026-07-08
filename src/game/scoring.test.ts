import { describe, expect, it } from 'vitest'
import { FINAL_BONUS, scorePass } from './scoring'

describe('scorePass', () => {
  it('gives base 100 with no time left after a retry', () => {
    expect(scorePass(0, true)).toBe(100)
  })

  it('adds 1 per full second remaining', () => {
    expect(scorePass(5.9, true)).toBe(105)
  })

  it('adds 50 when passed without retry', () => {
    expect(scorePass(10, false)).toBe(160)
  })

  it('adds the round 10 ending bonus', () => {
    expect(scorePass(3, false, 200)).toBe(353)
  })

  it('never counts negative time', () => {
    expect(scorePass(-4, true)).toBe(100)
  })
})

describe('FINAL_BONUS', () => {
  it('matches the spec values', () => {
    expect(FINAL_BONUS).toEqual({ human: 100, trying: 50, matter: 200 })
  })
})
