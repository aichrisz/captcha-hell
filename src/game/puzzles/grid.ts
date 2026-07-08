import type { AmbiguousChoice } from '../types'

export interface GridCell {
  icon: string
  label?: string
}

export interface GridData {
  prompt: string
  cells: GridCell[]
  correct: number[]
  ambiguous?: number[]
  failCopy?: string
  freeRetries?: number
}

export interface GridResult {
  passed: boolean
  count: number
  ambiguousChoice?: AmbiguousChoice
}

// Exact set match on required cells. Ambiguous cells pass selected or not.
// Round 9 inverted mode is plain data: correct = all nine indices.
export function validateGrid(
  selected: number[],
  correct: number[],
  ambiguous: number[] = [],
): GridResult {
  const sel = new Set(selected)
  const count = sel.size

  for (const c of correct) {
    if (!sel.has(c)) return { passed: false, count }
  }
  for (const s of sel) {
    if (!correct.includes(s) && !ambiguous.includes(s)) {
      return { passed: false, count }
    }
  }

  const result: GridResult = { passed: true, count }
  if (ambiguous.length > 0) {
    result.ambiguousChoice = ambiguous.some((a) => sel.has(a)) ? 'bicycle' : 'poster'
  }
  return result
}
