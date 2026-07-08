import { describe, expect, it } from 'vitest'
import { evalClick } from './timedClick'

const open = 3450
const close = 4650

describe('evalClick', () => {
  it('is early before the fakeout completes', () => {
    expect(evalClick(100, open, close, false)).toBe('early')
  })

  it('is early after the fakeout but before the window opens', () => {
    expect(evalClick(3000, open, close, true)).toBe('early')
  })

  it('passes inside the window including the close edge', () => {
    expect(evalClick(3450, open, close, true)).toBe('pass')
    expect(evalClick(4000, open, close, true)).toBe('pass')
    expect(evalClick(4650, open, close, true)).toBe('pass')
  })

  it('is late after the window closes', () => {
    expect(evalClick(4651, open, close, true)).toBe('late')
  })
})
