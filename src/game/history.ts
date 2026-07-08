import type { RoundAnswer } from './types'

export function recordAnswer(history: RoundAnswer[], answer: RoundAnswer): RoundAnswer[] {
  return [...history, answer]
}

// Latest recorded selection count for a round. Round 8 reads round 1.
export function getRecallCount(history: RoundAnswer[], round: number): number | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i]
    if (entry.round === round && entry.count !== undefined) return entry.count
  }
  return undefined
}
