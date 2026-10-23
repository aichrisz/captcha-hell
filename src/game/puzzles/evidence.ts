export const EVIDENCE_DOCUMENTS = [
  { id: 'existence-declaration', label: 'Existence declaration', required: true },
  { id: 'fern-reference', label: 'Fern reference', required: false },
  { id: 'queue-receipt', label: 'Queue receipt', required: false },
] as const

export type EvidenceId = (typeof EVIDENCE_DOCUMENTS)[number]['id']

export interface EvidenceEvaluation {
  valid: boolean
  selectedIds: EvidenceId[]
  attachmentCount: number
}

const allowedIds = new Set<string>(EVIDENCE_DOCUMENTS.map(({ id }) => id))

export function evaluateEvidence(value: unknown): EvidenceEvaluation {
  if (!Array.isArray(value) || [...value].some((id) => typeof id !== 'string' || !allowedIds.has(id))) {
    return { valid: false, selectedIds: [], attachmentCount: 0 }
  }
  const selectedIds = value as EvidenceId[]
  if (new Set(selectedIds).size !== selectedIds.length || !selectedIds.includes('existence-declaration')) {
    return { valid: false, selectedIds: [], attachmentCount: 0 }
  }
  return {
    valid: true,
    selectedIds,
    attachmentCount: selectedIds.length - 1,
  }
}
