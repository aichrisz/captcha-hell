import { describe, expect, it } from 'vitest'
import { attemptSlider, evalSlider, shrinkTolerance } from './slider'

const data = { target: 62, shrinkRate: 0.5, floor: 2, maxMisses: 3 }

describe('slider', () => {
  it('passes inside tolerance, including edges', () => {
    expect(evalSlider(62, 62, 8)).toBe(true)
    expect(evalSlider(54, 62, 8)).toBe(true)
    expect(evalSlider(70, 62, 8)).toBe(true)
    expect(evalSlider(53, 62, 8)).toBe(false)
  })

  it('miss shrinks tolerance by the shrink rate', () => {
    const a = attemptSlider(80, data, 8, 0)
    expect(a.passed).toBe(false)
    expect(a.tolerance).toBe(4)
    expect(a.misses).toBe(1)
    expect(a.strike).toBe(false)
  })

  it('tolerance never drops below the floor', () => {
    expect(shrinkTolerance(3, 0.5, 2)).toBe(2)
    expect(shrinkTolerance(2, 0.5, 2)).toBe(2)
  })

  it('third miss raises a strike', () => {
    const a = attemptSlider(0, data, 2, 2)
    expect(a.passed).toBe(false)
    expect(a.misses).toBe(3)
    expect(a.strike).toBe(true)
  })

  it('pass keeps tolerance and misses unchanged', () => {
    const a = attemptSlider(60, data, 4, 1)
    expect(a.passed).toBe(true)
    expect(a.tolerance).toBe(4)
    expect(a.misses).toBe(1)
  })
})
