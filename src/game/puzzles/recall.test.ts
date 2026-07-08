import { describe, expect, it } from 'vitest'
import { buildRecallOptions, evalRecall } from './recall'

describe('recall', () => {
  it('builds four distinct options including the actual count', () => {
    const opts = buildRecallOptions(3, 1)
    expect(opts).toHaveLength(4)
    expect(new Set(opts).size).toBe(4)
    expect(opts).toContain(3)
  })

  it('never emits negative options', () => {
    const opts = buildRecallOptions(0, 1)
    expect(opts).toHaveLength(4)
    for (const o of opts) expect(o).toBeGreaterThanOrEqual(0)
  })

  it('is deterministic for a given seed', () => {
    expect(buildRecallOptions(5, 7)).toEqual(buildRecallOptions(5, 7))
  })

  it('evalRecall passes only on the actual count', () => {
    expect(evalRecall(3, 3)).toBe(true)
    expect(evalRecall(4, 3)).toBe(false)
  })
})
