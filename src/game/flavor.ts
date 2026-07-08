// Rotating bureaucratic flavor copy for the verification notes panel.
// Deterministic pick so a given round and tick always shows the same line.

export const FLAVOR_BANK: string[] = [
  'Verification is a journey. Yours is being graded.',
  'Please remain calm. Calm is a strong indicator of guilt.',
  'This checkpoint is ISO certified in doubt.',
  'Your cursor speaks volumes. We are transcribing it.',
  'Humans blink roughly 15 times a minute. We counted.',
  'Do not attempt to be yourself. Be the applicant.',
  'Form 7B: request to feel something. Denied.',
  'The traffic lights you selected have been notified.',
  'A committee of checkboxes is reviewing your case.',
  'Your patience is being tested. Literally. This is the test.',
  'Any resemblance to a person is appreciated but unverified.',
  'The widget dreams of electric applicants.',
  'Processing... your entire deal.',
  'Reminder: the exit button was never implemented.',
]

export function pickFlavor(round: number, tick: number): string {
  const index = Math.abs(round * 7 + tick) % FLAVOR_BANK.length
  return FLAVOR_BANK[index]
}
