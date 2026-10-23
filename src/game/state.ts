import type { Action, GameState, LastVerdict, RoundResult, VerdictAction, VerdictMeasures } from './types'
import { getRound } from './rounds'
import { FINAL_BONUS, scorePass } from './scoring'
import { applyStrike } from './strikes'
import { applySuspicion } from './suspicion'
import { ENDING_COPY, selectEnding } from './endings'
import { recordAnswer } from './history'
import { evaluateEvidence } from './puzzles/evidence'

export const initialState: GameState = {
  phase: 'start',
  round: 1,
  score: 0,
  strikes: 0,
  suspicion: 0,
  history: [],
  soundOn: true,
  attempt: 0,
  appealUsed: false,
  finalReady: false,
}

function measures(state: GameState): VerdictMeasures {
  return { score: state.score, strikes: state.strikes, suspicion: state.suspicion }
}

function verdictOutcome(before: GameState, after: GameState, action: VerdictAction, passed?: boolean, detail?: string): string {
  if (detail) return detail
  if (action === 'APPEAL_VERDICT') return 'Appeal accepted'
  if (action === 'FINAL_CHOICE') return after.ending ? `Final classification: ${ENDING_COPY[after.ending].title}` : 'Final choice recorded'
  if (action === 'REFUSE_VERIFICATION') return 'Verification refused; account flagged'
  if (after.phase === 'ending') {
    if (action === 'TIMER_EXPIRED') return 'Time expired; run ended'
    return passed ? 'Accepted; run ended' : 'Rejected; run ended'
  }
  if (action === 'SUBMIT_ROUND' && passed) return 'Accepted; next challenge opened'
  if (after.round !== before.round) return action === 'TIMER_EXPIRED'
    ? 'Time expired; advanced after failure'
    : 'Rejected; advanced after failure'
  return action === 'TIMER_EXPIRED' ? 'Time expired; retry available' : 'Rejected; retry available'
}

function recordVerdict(before: GameState, after: GameState, action: VerdictAction, passed?: boolean, detail?: string): GameState {
  const beforeValues = measures(before)
  const afterValues = measures(after)
  const lastVerdict: LastVerdict = {
    sequence: (before.lastVerdict?.sequence ?? 0) + 1,
    action,
    round: before.round,
    outcome: verdictOutcome(before, after, action, passed, detail),
    before: beforeValues,
    after: afterValues,
    delta: {
      score: afterValues.score - beforeValues.score,
      strikes: afterValues.strikes - beforeValues.strikes,
      suspicion: afterValues.suspicion - beforeValues.suspicion,
    },
  }
  return { ...after, lastVerdict }
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

function passRound(state: GameState, result: RoundResult, evidenceAttachments = 0): GameState {
  const def = getRound(state.round)
  const retried = state.attempt > 0
  const timeLeftSec = def.timerSec === 0 ? 0 : result.timeLeftSec
  const score = state.score + scorePass(timeLeftSec, retried) + evidenceAttachments * 40

  let suspicion = state.suspicion
  if (def.timerSec > 0) {
    const frac = timeLeftSec / def.timerSec
    if (frac < 0.2) suspicion = applySuspicion(suspicion, 'slowAnswer')
    else if (!retried && frac >= 0.5) suspicion = applySuspicion(suspicion, 'cleanFastPass')
  }
  suspicion = Math.min(100, suspicion + evidenceAttachments * 15)

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
      const resultObject = action.result && typeof action.result === 'object' ? action.result : undefined
      const hasEvidencePayload = Boolean(resultObject && Object.prototype.hasOwnProperty.call(resultObject, 'evidenceIds'))
      if (state.round !== 9 && hasEvidencePayload) return state
      if (state.round === 9) {
        const identity = action.identity
        if (!identity || !Number.isInteger(identity.round) || !Number.isInteger(identity.attempt) || identity.round !== 9 || identity.attempt !== state.attempt) return state
        const evaluated = evaluateEvidence(resultObject && Object.prototype.hasOwnProperty.call(resultObject, 'evidenceIds') ? resultObject.evidenceIds : undefined)
        const normalized: RoundResult = {
          passed: evaluated.valid,
          timeLeftSec: typeof resultObject?.timeLeftSec === 'number' ? resultObject.timeLeftSec : 0,
          ...(evaluated.valid ? {} : { strikeSource: 'wrongSubmit' as const }),
        }
        const next = evaluated.valid
          ? passRound(state, normalized, evaluated.attachmentCount)
          : failRound(state, normalized)
        const detail = evaluated.valid
          ? `Evidence filed with ${evaluated.attachmentCount} optional attachment${evaluated.attachmentCount === 1 ? '' : 's'}${next.phase === 'ending' && next.ending === 'flagged' ? '; run flagged' : ''}`
          : undefined
        return recordVerdict(state, next, action.type, evaluated.valid, detail)
      }
      if (action.identity && (action.identity.round !== state.round || action.identity.attempt !== state.attempt)) return state
      const next = action.result.passed
        ? passRound(state, action.result)
        : failRound(state, action.result)
      return recordVerdict(state, next, action.type, action.result.passed)
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

    case 'APPEAL_VERDICT': {
      const relief = action.relief === undefined ? 'suspicion' : action.relief
      if (relief !== 'suspicion' && relief !== 'strike') return state
      if (state.phase !== 'play' || state.appealUsed || state.score < 50) return state
      if (relief === 'suspicion' && state.suspicion <= 0) return state
      if (relief === 'strike' && state.strikes !== 2) return state
      const next = relief === 'suspicion'
        ? { ...state, score: state.score - 50, suspicion: Math.max(0, state.suspicion - 20), appealUsed: true }
        : { ...state, score: state.score - 50, strikes: state.strikes - 1, appealUsed: true }
      return recordVerdict(state, next, action.type, undefined, `Appeal accepted: ${relief} relief`)
    }

    case 'TIMER_EXPIRED': {
      if (state.phase !== 'play') return state
      const def = getRound(state.round)
      if (def.timerSec === 0) return state
      const { strikes, lost } = applyStrike(state, 'timerExpiry')
      const next = { ...state, strikes }
      const resolved = lost
        ? endRun(next)
        : def.allowRetry
          ? { ...next, attempt: state.attempt + 1 }
          : advance({ ...next, history: recordAnswer(state.history, { round: def.id, passed: false }) })
      return recordVerdict(state, resolved, action.type)
    }

    case 'FINAL_READY':
      if (state.phase !== 'play' || state.round !== 10 || state.finalReady) return state
      return { ...state, finalReady: true }

    case 'FINAL_CHOICE': {
      if (state.phase !== 'play' || state.round !== 10 || !state.finalReady) return state
      const score = state.score + 100 + FINAL_BONUS[action.choice]
      const history = recordAnswer(state.history, { round: 10, passed: true })
      return recordVerdict(state, endRun({ ...state, score, history, finalChoice: action.choice }), action.type)
    }

    case 'REFUSE_VERIFICATION': {
      if (state.phase !== 'play' || state.round !== 10 || !state.finalReady) return state
      return recordVerdict(state, endRun({ ...state, suspicion: 100 }), action.type)
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
