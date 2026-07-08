import { describe, expect, it } from 'vitest'
import { initCheckbox, nextCheckboxState } from './checkbox'

const data = { maxDodges: 2 }

describe('checkbox state machine', () => {
  it('dodges the first two attempts then allows the check', () => {
    let s = initCheckbox()
    const a1 = nextCheckboxState(s, data)
    expect(a1.event).toBe('dodge')
    expect(a1.state.dodgeCount).toBe(1)
    expect(a1.state.offsetX !== 0 || a1.state.offsetY !== 0).toBe(true)

    const a2 = nextCheckboxState(a1.state, data)
    expect(a2.event).toBe('dodge')

    const a3 = nextCheckboxState(a2.state, data)
    expect(a3.event).toBe('checked')
    expect(a3.state.checked).toBe(true)
  })

  it('freeze mode freezes instead of allowing the check', () => {
    let s = initCheckbox()
    s = nextCheckboxState(s, { maxDodges: 2, freezeMode: true }).state
    s = nextCheckboxState(s, { maxDodges: 2, freezeMode: true }).state
    const final = nextCheckboxState(s, { maxDodges: 2, freezeMode: true })
    expect(final.event).toBe('freeze')
    expect(final.state.frozen).toBe(true)
    expect(final.state.checked).toBe(false)
  })

  it('reduced motion keeps position still and needs one failed attempt', () => {
    const a1 = nextCheckboxState(initCheckbox(), data, true)
    expect(a1.event).toBe('dodge')
    expect(a1.state.offsetX).toBe(0)
    expect(a1.state.offsetY).toBe(0)
    const a2 = nextCheckboxState(a1.state, data, true)
    expect(a2.event).toBe('checked')
  })

  it('is a noop once checked or frozen', () => {
    const checked = { ...initCheckbox(), checked: true }
    expect(nextCheckboxState(checked, data).event).toBe('noop')
    const frozen = { ...initCheckbox(), frozen: true }
    expect(nextCheckboxState(frozen, data).event).toBe('noop')
  })
})
