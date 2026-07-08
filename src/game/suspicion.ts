import type { SuspicionEvent } from './types'

export const SUSPICION_DELTA: Record<SuspicionEvent, number> = {
  retry: 10,
  slowAnswer: 5,
  dodgeMiss: 5,
  round7Wrong: 20,
  idle: 5,
  cleanFastPass: -5,
}

export function applySuspicion(current: number, event: SuspicionEvent): number {
  const next = current + SUSPICION_DELTA[event]
  return Math.min(100, Math.max(0, next))
}
