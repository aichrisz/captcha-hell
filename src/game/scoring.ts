import type { FinalChoice } from './types'

// Base 100 per pass, +1 per full second remaining, +50 no-retry bonus,
// round 10 adds an ending bonus (0-200).
export function scorePass(timeLeftSec: number, retried: boolean, round10Bonus = 0): number {
  const speed = Math.max(0, Math.floor(timeLeftSec))
  const clean = retried ? 0 : 50
  return 100 + speed + clean + round10Bonus
}

export const FINAL_BONUS: Record<FinalChoice, number> = {
  human: 100,
  trying: 50,
  matter: 200,
}
