export interface TimedClickData {
  prompt: string
  fakeoutDelayMs: number   // idle time before the fake green flash
  fakeoutFlashMs: number   // how long the fake flash lasts
  realDelayMs: number      // gap between fakeout end and real window open
  windowMs: number         // real window length (1200)
}

export type ClickResult = 'pass' | 'early' | 'late'

// Pure window math. Timestamps come from the caller (performance.now),
// never read inside this module.
export function evalClick(
  clickMs: number,
  windowOpenMs: number,
  windowCloseMs: number,
  fakeoutDone: boolean,
): ClickResult {
  if (!fakeoutDone) return 'early'
  if (clickMs < windowOpenMs) return 'early'
  if (clickMs <= windowCloseMs) return 'pass'
  return 'late'
}
