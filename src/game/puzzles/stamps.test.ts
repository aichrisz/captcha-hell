import { describe, expect, it } from 'vitest'
import { evaluateDocuments, type StampAction } from './stamps'

const validSequence: StampAction[] = ['witness', 'copy', 'redact']

function evaluate(actions: readonly StampAction[]) {
  return evaluateDocuments(actions)
}

describe('document stamp evaluation', () => {
  it('accepts only a witnessed readable original copied before redaction', () => {
    expect(evaluate(validSequence)).toEqual({
      originalReadable: false,
      witness: 'valid',
      copyPresent: true,
      copyReadable: true,
      copyCertified: true,
      missing: [],
      valid: true,
      invalidSequence: false,
    })
  })

  it('rejects every other ordering of the three unique stamps with reasons', () => {
    const permutations: StampAction[][] = [
      ['witness', 'redact', 'copy'],
      ['copy', 'witness', 'redact'],
      ['copy', 'redact', 'witness'],
      ['redact', 'witness', 'copy'],
      ['redact', 'copy', 'witness'],
    ]
    for (const actions of permutations) {
      const result = evaluate(actions)
      expect(result.valid, actions.join(',')).toBe(false)
      expect(result.missing.length, actions.join(',')).toBeGreaterThan(0)
    }
  })

  it('treats empty and partial filings as invalid and lists the missing conditions', () => {
    for (const actions of [[], ['witness'], ['witness', 'copy'], ['copy', 'redact']] as StampAction[][]) {
      const result = evaluate(actions)
      expect(result.valid).toBe(false)
      expect(result.missing.length).toBeGreaterThan(0)
    }
  })

  it('keeps the copy readability and certification snapshots after later stamps', () => {
    expect(evaluate(['witness', 'copy', 'redact'])).toMatchObject({
      originalReadable: false,
      witness: 'valid',
      copyPresent: true,
      copyReadable: true,
      copyCertified: true,
    })
    expect(evaluate(['copy', 'witness', 'redact'])).toMatchObject({
      witness: 'valid',
      copyReadable: true,
      copyCertified: false,
    })
    expect(evaluate(['redact', 'witness', 'copy'])).toMatchObject({
      originalReadable: false,
      witness: 'invalid',
      copyReadable: false,
      copyCertified: false,
    })
  })

  it('rejects duplicate, unknown, and overlong sequences without throwing', () => {
    for (const actions of [
      ['witness', 'witness'],
      ['unknown'],
      ['witness', 'copy', 'redact', 'unknown'],
    ] as unknown as StampAction[][]) {
      expect(() => evaluate(actions)).not.toThrow()
      expect(evaluate(actions)).toMatchObject({ valid: false, invalidSequence: true })
    }
  })

  it('re-evaluates undo and reset from the remaining action sequence', () => {
    const filed = evaluate(validSequence)
    const undone = evaluate(validSequence.slice(0, -1))
    const reset = evaluate([])
    expect(filed.valid).toBe(true)
    expect(undone).toMatchObject({ originalReadable: true, valid: false })
    expect(reset).toMatchObject({ originalReadable: true, witness: 'none', copyPresent: false, valid: false })
    expect(validSequence).toEqual(['witness', 'copy', 'redact'])
  })
})
