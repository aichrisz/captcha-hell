export type StampAction = 'witness' | 'copy' | 'redact'

export interface StampsData {
  prompt: string
  statement: string
}

export interface DocumentEvaluation {
  originalReadable: boolean
  witness: 'none' | 'valid' | 'invalid'
  copyPresent: boolean
  copyReadable: boolean
  copyCertified: boolean
  missing: string[]
  valid: boolean
  invalidSequence: boolean
}

const actions: readonly StampAction[] = ['witness', 'copy', 'redact']
const missingConditions = [
  'Witness the Original while it is readable.',
  'Make a readable Copy before redaction.',
  'The Copy must be certified when it is made.',
  'Redact the Original before filing.',
]

export function evaluateDocuments(sequence: readonly StampAction[]): DocumentEvaluation {
  const seen = new Set<unknown>()
  const invalidSequence = !Array.isArray(sequence)
    || sequence.length > actions.length
    || sequence.some((action) => {
      if (!actions.includes(action) || seen.has(action)) return true
      seen.add(action)
      return false
    })

  if (invalidSequence) {
    return {
      originalReadable: true,
      witness: 'none',
      copyPresent: false,
      copyReadable: false,
      copyCertified: false,
      missing: [...missingConditions],
      valid: false,
      invalidSequence: true,
    }
  }

  let originalReadable = true
  let witness: DocumentEvaluation['witness'] = 'none'
  let copyPresent = false
  let copyReadable = false
  let copyCertified = false

  for (const action of sequence) {
    if (action === 'witness') witness = originalReadable ? 'valid' : 'invalid'
    if (action === 'copy') {
      copyPresent = true
      copyReadable = originalReadable
      copyCertified = witness === 'valid'
    }
    if (action === 'redact') originalReadable = false
  }

  const missing = [
    witness === 'valid' ? '' : missingConditions[0],
    copyPresent && copyReadable ? '' : missingConditions[1],
    copyCertified ? '' : missingConditions[2],
    originalReadable ? missingConditions[3] : '',
  ].filter(Boolean)

  return {
    originalReadable,
    witness,
    copyPresent,
    copyReadable,
    copyCertified,
    missing,
    valid: missing.length === 0,
    invalidSequence: false,
  }
}
