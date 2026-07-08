// Fake system intrusion theater. Everything here is copy only: no camera,
// no filesystem, no permissions, no real windows. Deterministic by round so
// the show is testable and identical on every run.

export type IntrusionKind = 'popup' | 'webcam' | 'file'

export interface PopupEvent {
  id: string
  round: number
  delayMs: number
  title: string
  body: string
  dismiss: string
}

export const POPUPS: PopupEvent[] = [
  {
    id: 'popup-observe',
    round: 3,
    delayMs: 1400,
    title: 'SYSTEM NOTICE',
    body: 'A background process has started observing your choices. This is normal and you agreed to it in a dream.',
    dismiss: 'Acknowledge',
  },
  {
    id: 'popup-update',
    round: 5,
    delayMs: 1800,
    title: 'UPDATE AVAILABLE',
    body: 'Humanity definition v2.4 is ready. Installing without consent to save you a click.',
    dismiss: 'Fine',
  },
  {
    id: 'popup-calibration',
    round: 7,
    delayMs: 1200,
    title: 'CALIBRATION',
    body: 'Your hesitation has been sampled for training purposes. It was beautiful.',
    dismiss: 'Was it',
  },
  {
    id: 'popup-final',
    round: 9,
    delayMs: 1600,
    title: 'FINAL NOTICE',
    body: 'The form knows you can read this. Please continue as if you could not.',
    dismiss: 'Continue',
  },
]

export function popupsForRound(round: number): PopupEvent[] {
  return POPUPS.filter((p) => p.round === round)
}

// One line per round, escalating. Suspicion above 65 swaps in the accusatory
// variant. Text only: there is no feed and there never was.
const WEBCAM_LINES: string[] = [
  'feed offline. imagining you instead.',
  'posture analysis: acceptably slouched.',
  'blink rate nominal. keep it up.',
  'pupil tracking unavailable. assuming pupils.',
  'micro expression detected: mild dread. logged.',
  'you looked away. the analysis continued.',
  'breathing pattern: unverified but probable.',
  'subject resembles the concept of a person.',
  'face not found. proceeding on faith.',
  'the lens is closed. the judgment is not.',
]

const WEBCAM_SUSPICIOUS = 'movement too consistent. humans fidget. take notes.'

export function webcamLine(round: number, suspicion: number): string {
  if (suspicion > 65) return WEBCAM_SUSPICIOUS
  return WEBCAM_LINES[(round - 1) % WEBCAM_LINES.length]
}

// Fake filenames the widget pretends to consult. Names only, nothing is read.
const STAGE_FILES: Record<1 | 2 | 3 | 4, string[]> = {
  1: ['cookies_you_accepted.txt', 'terms_v0_never_read.pdf'],
  2: ['your_click_history.log', 'hesitation_map.bmp'],
  3: ['doubts_backup.zip', 'humanity_receipts.csv'],
  4: ['soul.cfg (missing)', 'exit_strategy.tmp'],
}

export function filesForStage(stage: 1 | 2 | 3 | 4): string[] {
  return STAGE_FILES[stage]
}
