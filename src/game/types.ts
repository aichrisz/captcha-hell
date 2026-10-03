export type Phase = 'start' | 'play' | 'ending'

export type PuzzleType =
  | 'grid'
  | 'checkbox'
  | 'timedClick'
  | 'slider'
  | 'wordChoice'
  | 'recall'
  | 'final'

export type EndingId = 'verified' | 'probablyHuman' | 'ghost' | 'rejected' | 'flagged' | 'tooPerfect'

export type SuspicionEvent =
  | 'retry'
  | 'slowAnswer'
  | 'dodgeMiss'
  | 'round7Wrong'
  | 'idle'
  | 'cleanFastPass'

export type StrikeSource = 'wrongSubmit' | 'singleAttemptFail' | 'timerExpiry' | 'earlyClick'

export type AmbiguousChoice = 'bicycle' | 'poster'

export type FinalChoice = 'human' | 'trying' | 'matter'

export interface RoundDef {
  id: number            // 1-10
  stage: 1 | 2 | 3 | 4
  type: PuzzleType
  timerSec: number      // round 10: counts up, timerSec ignored
  allowRetry: boolean   // true rounds 1-6, false 7-10
  data: unknown         // per-puzzle config object, typed per puzzle module
}

export interface RoundAnswer {
  round: number
  passed: boolean
  count?: number        // grid selections; round 8 reads round 1 count
}

export interface RoundResult {
  passed: boolean
  timeLeftSec: number
  count?: number
  ambiguousChoice?: AmbiguousChoice
  strikeSource?: StrikeSource   // required when passed is false
}

export interface GameState {
  phase: Phase
  round: number         // 1-10
  score: number
  strikes: number       // lose at 3
  suspicion: number     // 0-100, lose at 100
  history: RoundAnswer[]
  soundOn: boolean
  attempt: number       // attempts spent on current round, 0 = first try
  appealUsed: boolean
  ending?: EndingId
  ambiguousChoice?: AmbiguousChoice
  finalChoice?: FinalChoice
}

export type Action =
  | { type: 'START_RUN' }
  | { type: 'SUBMIT_ROUND'; result: RoundResult }
  | { type: 'STRIKE'; source: StrikeSource }
  | { type: 'SUSPICION'; event: SuspicionEvent }
  | { type: 'TIMER_EXPIRED' }
  | { type: 'FINAL_CHOICE'; choice: FinalChoice }
  | { type: 'END_RUN'; ending: EndingId }
  | { type: 'RESTART' }
  | { type: 'SOUND_TOGGLE' }
  | { type: 'APPEAL_VERDICT' }
  | { type: 'DEBUG_SET'; patch: Partial<GameState> }
