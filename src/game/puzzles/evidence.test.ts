import { describe, expect, it } from 'vitest'
import { EVIDENCE_DOCUMENTS, evaluateEvidence } from './evidence'

const ids = EVIDENCE_DOCUMENTS.map(({ id }) => id)

function subsets<T>(items: readonly T[]): T[][] {
  return Array.from({ length: 1 << items.length }, (_, mask) => items.filter((_, index) => mask & (1 << index)))
}

describe('minimum necessary evidence', () => {
  it('accepts exactly the four subsets containing the required declaration', () => {
    const results = subsets(ids).map(evaluateEvidence)
    expect(results.filter((result) => result.valid)).toHaveLength(4)
    expect(results.filter((result) => !result.valid)).toHaveLength(4)
    expect(results.filter((result) => result.valid).map(({ attachmentCount }) => attachmentCount).sort()).toEqual([0, 1, 1, 2])
    expect(results.filter((result) => !result.valid).every(({ attachmentCount }) => attachmentCount === 0)).toBe(true)
  })

  it.each([
    ['unknown', ['existence-declaration', 'unknown']],
    ['duplicate', ['existence-declaration', 'fern-reference', 'fern-reference']],
    ['sparse array', Object.assign(new Array(2), { 0: 'existence-declaration' })],
    ['non-string member', ['existence-declaration', 3]],
    ['empty selection', []],
    ['non-array', 'existence-declaration'],
    ['null', null],
    ['undefined', undefined],
  ])('fails closed for %s payloads', (_label, value) => {
    expect(evaluateEvidence(value)).toMatchObject({ valid: false, attachmentCount: 0 })
  })
})
