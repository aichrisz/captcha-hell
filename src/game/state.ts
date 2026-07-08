import type { Action, GameState, RoundResult } from './types'
import { getRound } from './rounds'
import { FINAL_BONUS, scorePass } from './scoring'
import { applyStrike } from './strikes'
import { applySuspicion } from './suspicion'
import { selectEnding } from './endings'
import { recordAnswer } from './history'

export const initialState: GameState = {
  phase: 'start',
  round: 1,
  score: 0,
  strikes: 0,
  suspicion: 0,
  history: [],
  soundOn: true,
  attempt: 0,
}

function endRun(state: GameState): GameState {
  const ending = selectEnding({
    suspicion: state.suspicion,
    strikes: state.strikes,
    finalChoice: state.finalChoice,
    score: state.score,
    roundsCleared: state.history.length,
  })
  return { ...state, phase: 'ending', ending }
}

function advance(state: GameState): GameState {
  return { ...state, round: Math.min(10, state.round + 1), attempt: 0 }
}

function passRound(state: GameState, result: RoundResult): GameState {
  const def = getRound(state.round)
  const retried = state.attempt > 0
  const score = state.score + scorePass(result.timeLeftSec, retried)

  let suspicion = state.suspicion
  if (def.timerSec > 0) {
    const frac = result.timeLeftSec / def.timerSec
    if (frac < 0.2) suspicion = applySuspicion(suspicion, 'slowAnswer')
    else if (!retried && frac >= 0.5) suspicion = applySuspicion(suspicion, 'cleanFastPass')
  }

  const history = recordAnswer(state.history, {
    round: def.id,
    passed: true,
    count: result.count,
  })
  const next: GameState = {
    ...state,
    score,
    suspicion,
    history,
    ambiguousChoice: result.ambiguousChoice ?? state.ambiguousChoice,
  }
  if (next.suspicion >= 100) return endRun(next)
  if (def.id >= 10) return endRun(next)
  return advance(next)
}

function failRound(state: GameState, result: RoundResult): GameState {
  const def = getRound(state.round)
  const { strikes, lost } = applyStrike(state, result.strikeSource ?? 'wrongSubmit')

  let suspicion = state.suspicion
  if (def.allowRetry) suspicion = applySuspicion(suspicion, 'retry')
  else if (def.id === 7) suspicion = applySuspicion(suspicion, 'round7Wrong')

  const next: GameState = { ...state, strikes, suspicion }
  if (next.suspicion >= 100 || lost) return endRun(next)
  if (def.allowRetry) return { ...next, attempt: state.attempt + 1 }

  const history = recordAnswer(state.history, {
    round: def.id,
    passed: false,
    count: result.count,
  })
  return advance({ ...next, history })
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'START_RUN':
      return { ...initialState, soundOn: state.soundOn, phase: 'play' }

    case 'SUBMIT_ROUND': {
      if (state.phase !== 'play') return state
      return action.result.passed
        ? passRound(state, action.result)
        : failRound(state, action.result)
    }

    case 'STRIKE': {
      if (state.phase !== 'play') return state
      const { strikes, lost } = applyStrike(state, action.source)
      const next = { ...state, strikes }
      return lost ? endRun(next) : { ...next, attempt: state.attempt + 1 }
    }

    case 'SUSPICION': {
      if (state.phase !== 'play') return state
      const suspicion = applySuspicion(state.suspicion, action.event)
      const next = { ...state, suspicion }
      return suspicion >= 100 ? endRun(next) : next
    }

    case 'TIMER_EXPIRED': {
      if (state.phase !== 'play') return state
      const def = getRound(state.round)
      const { strikes, lost } = applyStrike(state, 'timerExpiry')
      const next = { ...state, strikes }
      if (lost) return endRun(next)
      if (def.allowRetry) return { ...next, attempt: state.attempt + 1 }
      const history = recordAnswer(state.history, { round: def.id, passed: false })
      return advance({ ...next, history })
    }

    case 'FINAL_CHOICE': {
      if (state.phase !== 'play') return state
      const score = state.score + 100 + FINAL_BONUS[action.choice]
      const history = recordAnswer(state.history, { round: 10, passed: true })
      return endRun({ ...state, score, history, finalChoice: action.choice })
    }

    case 'END_RUN':
      return { ...state, phase: 'ending', ending: action.ending }

    case 'RESTART':
      return { ...initialState, soundOn: state.soundOn }

    case 'SOUND_TOGGLE':
      return { ...state, soundOn: !state.soundOn }

    case 'DEBUG_SET':
      return { ...state, ...action.patch }

    default:
      return state
  }
}
