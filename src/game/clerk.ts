import type { DocumentEvaluation, StampAction } from './puzzles/stamps'
import { evaluateDocuments } from './puzzles/stamps'

export type ClerkCaseId = 'file-a' | 'file-b' | 'file-c'
export type ClerkDecision = 'accept' | 'return'
export type ClerkReasonId = 'no-defect' | 'copy-before-certification' | 'copy-after-redaction'

export interface ClerkCase {
  readonly id: ClerkCaseId
  readonly label: string
  readonly applicant: string
  readonly statement: string
  readonly sequence: readonly StampAction[]
  readonly evaluation: Readonly<Omit<DocumentEvaluation, 'missing'>> & { readonly missing: readonly string[] }
  readonly correctDecision: ClerkDecision
  readonly correctReason: ClerkReasonId
  readonly explanation: string
}

export const CLERK_DECISIONS: Readonly<Record<ClerkDecision, string>> = Object.freeze({
  accept: 'Accept',
  return: 'Return',
})

export const CLERK_REASONS: readonly { readonly id: ClerkReasonId; readonly label: string }[] = Object.freeze([
  Object.freeze({ id: 'no-defect', label: 'No procedural defect.' }),
  Object.freeze({ id: 'copy-before-certification', label: 'Copy made before certification.' }),
  Object.freeze({ id: 'copy-after-redaction', label: 'Copy made after redaction.' }),
])

function makeCase(
  id: ClerkCaseId,
  label: string,
  applicant: string,
  statement: string,
  sequence: readonly StampAction[],
  correctDecision: ClerkDecision,
  correctReason: ClerkReasonId,
  explanation: string,
): ClerkCase {
  const frozenSequence = Object.freeze([...sequence])
  const evaluation = evaluateDocuments(frozenSequence)
  Object.freeze(evaluation.missing)
  Object.freeze(evaluation)
  return Object.freeze({ id, label, applicant, statement, sequence: frozenSequence, evaluation, correctDecision, correctReason, explanation })
}

export const CLERK_CASES: readonly ClerkCase[] = Object.freeze([
  makeCase(
    'file-a', 'File A', 'Mira Vale',
    'Fictional statement: I filed a witnessed original with its readable copy.',
    ['witness', 'copy', 'redact'], 'accept', 'no-defect',
    'The original was witnessed while readable, the copy captured the readable certified original, and the original was redacted before filing.',
  ),
  makeCase(
    'file-b', 'File B', 'Jon Bell',
    'Fictional statement: I attached a copy and a redacted original.',
    ['copy', 'witness', 'redact'], 'return', 'copy-before-certification',
    'The copy was made before certification. Later witnessing does not certify an earlier copy.',
  ),
  makeCase(
    'file-c', 'File C', 'Neri Sol',
    'Fictional statement: I attached a certified copy of the file.',
    ['witness', 'redact', 'copy'], 'return', 'copy-after-redaction',
    'The original was redacted before the copy was made. Its prior witness certifies that copy, but the copy is unreadable.',
  ),
])

export function isCorrectClerkReview(caseId: unknown, decision: unknown, reason: unknown): boolean {
  if (decision !== 'accept' && decision !== 'return') return false
  if (reason !== 'no-defect' && reason !== 'copy-before-certification' && reason !== 'copy-after-redaction') return false
  const clerkCase = CLERK_CASES.find((item) => item.id === caseId)
  return Boolean(clerkCase && decision === clerkCase.correctDecision && reason === clerkCase.correctReason)
}
