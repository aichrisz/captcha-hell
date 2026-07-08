export interface HumanityInput {
  score: number
  strikes: number
  suspicion: number
  roundsCleared: number
}

// Secret ending gate: a full run with zero strikes, zero suspicion and a fast
// score reads as machine behavior. Score 1600 needs roughly 50+ banked seconds
// across the nine timed rounds on top of a clean sweep.
export const TOO_PERFECT_MIN_SCORE = 1600
export const TOO_PERFECT_MIN_ROUNDS = 10

export function isTooPerfect(input: HumanityInput): boolean {
  return (
    input.strikes === 0 &&
    input.suspicion === 0 &&
    input.score >= TOO_PERFECT_MIN_SCORE &&
    input.roundsCleared >= TOO_PERFECT_MIN_ROUNDS
  )
}

// Flawless play drains the meter: the widget trusts error, not excellence.
export function perfectionDrag(input: HumanityInput): number {
  if (input.strikes > 0 || input.suspicion > 0) return 0
  return Math.min(35, Math.floor(input.score / 50))
}

// Display meter, 0-100. Not a win condition; it narrates the paradox that
// mistakes look human while precision looks scripted.
export function humanityScore(input: HumanityInput): number {
  let h = 50
  h += Math.min(24, input.strikes * 12)
  h += Math.min(15, Math.round(input.suspicion * 0.6))
  h -= Math.max(0, input.suspicion - 25)
  h += Math.min(11, input.roundsCleared)
  h -= perfectionDrag(input)
  return Math.max(0, Math.min(100, Math.round(h)))
}

export function humanityLabel(score: number): string {
  if (score >= 70) return 'convincingly organic'
  if (score >= 45) return 'plausibly alive'
  if (score >= 25) return 'worryingly smooth'
  return 'statistically synthetic'
}
