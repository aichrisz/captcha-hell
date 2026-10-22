import { describe, expect, it } from 'vitest'
import { CLERK_CASES, isCorrectClerkReview } from './clerk'

describe('Acting Clerk fixed file review', () => {
  it('keeps the three submitted action sequences and evaluator snapshots exact', () => {
    expect(CLERK_CASES.map(({ id, sequence, correctDecision, correctReason }) => ({ id, sequence, correctDecision, correctReason }))).toEqual([
      { id: 'file-a', sequence: ['witness', 'copy', 'redact'], correctDecision: 'accept', correctReason: 'no-defect' },
      { id: 'file-b', sequence: ['copy', 'witness', 'redact'], correctDecision: 'return', correctReason: 'copy-before-certification' },
      { id: 'file-c', sequence: ['witness', 'redact', 'copy'], correctDecision: 'return', correctReason: 'copy-after-redaction' },
    ])
    expect(CLERK_CASES.map(({ evaluation }) => evaluation)).toMatchObject([
      { originalReadable: false, witness: 'valid', copyPresent: true, copyReadable: true, copyCertified: true, valid: true, invalidSequence: false },
      { originalReadable: false, witness: 'valid', copyPresent: true, copyReadable: true, copyCertified: false, valid: false, invalidSequence: false },
      { originalReadable: false, witness: 'valid', copyPresent: true, copyReadable: false, copyCertified: true, valid: false, invalidSequence: false },
    ])
  })

  it('accepts only each file decision paired with its exact procedural reason', () => {
    expect(isCorrectClerkReview('file-a', 'accept', 'no-defect')).toBe(true)
    expect(isCorrectClerkReview('file-b', 'return', 'copy-before-certification')).toBe(true)
    expect(isCorrectClerkReview('file-c', 'return', 'copy-after-redaction')).toBe(true)
  })

  it('rejects false acceptance of defective files and false return of the clean file', () => {
    expect(isCorrectClerkReview('file-a', 'return', 'no-defect')).toBe(false)
    expect(isCorrectClerkReview('file-b', 'accept', 'copy-before-certification')).toBe(false)
    expect(isCorrectClerkReview('file-c', 'accept', 'copy-after-redaction')).toBe(false)
  })

  it('rejects the right decision with an independently wrong reason', () => {
    expect(isCorrectClerkReview('file-a', 'accept', 'copy-before-certification')).toBe(false)
    expect(isCorrectClerkReview('file-b', 'return', 'copy-after-redaction')).toBe(false)
    expect(isCorrectClerkReview('file-c', 'return', 'copy-before-certification')).toBe(false)
  })

  it('fails closed for missing or unsafe runtime IDs, decisions, and reasons', () => {
    const unsafe: unknown[][] = [
      [undefined, 'accept', 'no-defect'],
      ['file-a', undefined, 'no-defect'],
      ['file-a', 'accept', undefined],
      ['file-a', 'approve', 'no-defect'],
      ['file-a', 'accept', 'looks-fine'],
      ['file-z', 'accept', 'no-defect'],
      [null, null, null],
    ]
    for (const [id, decision, reason] of unsafe) {
      expect(isCorrectClerkReview(id, decision, reason)).toBe(false)
    }
  })

  it('exposes immutable case evidence and evaluator snapshots', () => {
    for (const item of CLERK_CASES) {
      expect(Object.isFrozen(item)).toBe(true)
      expect(Object.isFrozen(item.sequence)).toBe(true)
      expect(Object.isFrozen(item.evaluation)).toBe(true)
      expect(Object.isFrozen(item.evaluation.missing)).toBe(true)
    }
  })
})
