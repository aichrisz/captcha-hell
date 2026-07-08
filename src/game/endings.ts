import type { EndingId, FinalChoice } from './types'

export interface EndingInput {
  suspicion: number
  strikes: number
  finalChoice?: FinalChoice
}

// Precedence: flagged, then rejected, then the round 10 branch.
// Ghost overrides the suspicion band. Verified needs low suspicion AND "human".
export function selectEnding(input: EndingInput): EndingId {
  if (input.suspicion >= 100) return 'flagged'
  if (input.strikes >= 3) return 'rejected'
  if (input.finalChoice === 'matter') return 'ghost'
  if (input.finalChoice === 'human' && input.suspicion < 40) return 'verified'
  return 'probablyHuman'
}

export interface EndingCopy {
  title: string
  lines: string[]
  win: boolean
}

export const ENDING_COPY: Record<EndingId, EndingCopy> = {
  verified: {
    title: 'VERIFIED: HUMAN',
    win: true,
    lines: [
      'Congratulations. Your humanity has been confirmed.',
      'Certificate issued. Valid indefinitely.',
      'For now.',
    ],
  },
  probablyHuman: {
    title: 'STATUS: PROBABLY HUMAN',
    win: true,
    lines: [
      'Verification complete-ish.',
      'Provisional certificate issued.',
      'Expires: today.',
    ],
  },
  ghost: {
    title: 'GHOST IN THE FORM',
    win: true,
    lines: [
      'Interesting answer.',
      'Between us: this widget is not sure it is a program either.',
      'Bonus credited. Do not tell the form.',
    ],
  },
  rejected: {
    title: 'APPLICATION REJECTED',
    win: false,
    lines: [
      'Too many verification failures.',
      'Your form has been reset.',
      'The name field now reads: UNIT.',
    ],
  },
  flagged: {
    title: 'ACCOUNT FLAGGED',
    win: false,
    lines: [
      'Suspicious behavior detected.',
      'Your behavior has been reported to yourself.',
      'Await your own review.',
    ],
  },
}
