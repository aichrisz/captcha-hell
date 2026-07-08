import type { StrikeSource } from './types'

export const MAX_STRIKES = 3

export interface StrikeOutcome {
  strikes: number
  lost: boolean
  source: StrikeSource
}

export function applyStrike(state: { strikes: number }, source: StrikeSource): StrikeOutcome {
  const strikes = state.strikes + 1
  return { strikes, lost: strikes >= MAX_STRIKES, source }
}
