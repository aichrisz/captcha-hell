import type { RoundDef } from './types'
import type { GridData } from './puzzles/grid'
import type { CheckboxData } from './puzzles/checkbox'
import type { TimedClickData } from './puzzles/timedClick'
import type { SliderData } from './puzzles/slider'
import type { WordChoiceData } from './puzzles/wordChoice'
import type { RecallData } from './puzzles/recall'
import type { StampsData } from './puzzles/stamps'

export interface FinalData {
  prompt: string
  checkbox: CheckboxData
  word: WordChoiceData
}

const round1: GridData = {
  prompt: 'Select all squares with traffic lights.',
  cells: [
    { icon: '\u{1F6A6}' }, { icon: '\u{1F333}' }, { icon: '\u{1F697}' },
    { icon: '\u{1F3E0}' }, { icon: '\u{1F6A6}' }, { icon: '\u{2601}\u{FE0F}' },
    { icon: '\u{1F415}' }, { icon: '\u{1F6A6}' }, { icon: '\u{1F9C1}' },
  ],
  correct: [0, 4, 7],
}

const round2: CheckboxData = {
  prompt: 'Confirm you are not a robot.',
  maxDodges: 2,
}

const round3: GridData = {
  prompt: 'Select all squares with bicycles.',
  cells: [
    { icon: '\u{1F34E}' }, { icon: '\u{1F6B2}' }, { icon: '\u{1F9F1}' },
    { icon: '\u{1F6B2}' }, { icon: '\u{1FA91}' }, { icon: '\u{1F5BC}\u{FE0F}', label: 'poster of a bicycle' },
    { icon: '\u{1F98B}' }, { icon: '\u{1F9F9}' }, { icon: '\u{1F6B2}' },
  ],
  correct: [1, 3, 8],
  ambiguous: [5],
}

const round4: TimedClickData = {
  prompt: 'Click VERIFY when it turns green. Not before.',
  fakeoutDelayMs: 1600,
  fakeoutFlashMs: 450,
  realDelayMs: 1400,
  windowMs: 1200,
}

const round5: SliderData = {
  prompt: 'Slide to align the verification image.',
  target: 62,
  tolerance: 8,
  shrinkRate: 0.5,
  floor: 2,
  maxMisses: 3,
}

const round6: StampsData = {
  prompt: 'Complete the record before sending it to the registry.',
  statement: 'Statement 06-B: The office fern has requested dependent status.',
}

const round7: WordChoiceData = {
  prompt: 'Which of these would a human choose?',
  options: [
    'Optimize response latency',
    'Recalibrate sensory inputs',
    'Cry at a song from 2009',
    'Batch process emotions overnight',
  ],
  correctIndex: 2,
}

const round8: RecallData = {
  prompt: 'In round 1, how many squares did you select? We kept a record.',
  sourceRound: 1,
  fallbackCount: 3,
}

const round10: FinalData = {
  prompt: 'Final verification: prove you are human.',
  checkbox: {
    prompt: 'Check the box.',
    maxDodges: 2,
    freezeMode: true,
  },
  word: {
    prompt: 'The box is no longer accepting input. State your claim.',
    options: ['I am human', 'I am trying', 'Does it matter'],
    branch: ['human', 'trying', 'matter'],
  },
}

export const ROUNDS: RoundDef[] = [
  { id: 1, stage: 1, type: 'grid', timerSec: 20, allowRetry: true, data: round1 },
  { id: 2, stage: 1, type: 'checkbox', timerSec: 20, allowRetry: true, data: round2 },
  { id: 3, stage: 1, type: 'grid', timerSec: 20, allowRetry: true, data: round3 },
  { id: 4, stage: 2, type: 'timedClick', timerSec: 15, allowRetry: true, data: round4 },
  { id: 5, stage: 2, type: 'slider', timerSec: 15, allowRetry: true, data: round5 },
  { id: 6, stage: 2, type: 'stamps', timerSec: 0, allowRetry: true, data: round6 },
  { id: 7, stage: 3, type: 'wordChoice', timerSec: 20, allowRetry: false, data: round7 },
  { id: 8, stage: 3, type: 'recall', timerSec: 20, allowRetry: false, data: round8 },
  { id: 9, stage: 3, type: 'evidence', timerSec: 20, allowRetry: false, data: null },
  { id: 10, stage: 4, type: 'final', timerSec: 0, allowRetry: false, data: round10 },
]

export function getRound(round: number): RoundDef {
  return ROUNDS[round - 1]
}
