import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './state'
import type { Action, GameState } from './types'

function run(state: GameState, ...actions: Action[]): GameState {
  return actions.reduce(reducer, state)
}

const playing = reducer(initialState, { type: 'START_RUN' })

describe('reducer', () => {
  it('initial state is the start screen', () => {
    expect(initialState.phase).toBe('start')
    expect(initialState.round).toBe(1)
    expect(initialState.strikes).toBe(0)
    expect(initialState.suspicion).toBe(0)
    expect(initialState.attempt).toBe(0)
  })

  it('START_RUN enters play at round 1 and keeps sound pref', () => {
    const muted = run(initialState, { type: 'SOUND_TOGGLE' }, { type: 'START_RUN' })
    expect(muted.phase).toBe('play')
    expect(muted.round).toBe(1)
    expect(muted.soundOn).toBe(false)
  })

  it('pass advances the round, scores, and records history', () => {
    const s = reducer(playing, {
      type: 'SUBMIT_ROUND',
      result: { passed: true, timeLeftSec: 10, count: 3 },
    })
    expect(s.round).toBe(2)
    expect(s.score).toBe(160)
    expect(s.attempt).toBe(0)
    expect(s.history).toEqual([{ round: 1, passed: true, count: 3 }])
    expect(s.suspicion).toBe(0)
  })

  it('slow pass adds suspicion', () => {
    const s = reducer(playing, {
      type: 'SUBMIT_ROUND',
      result: { passed: true, timeLeftSec: 1, count: 3 },
    })
    expect(s.suspicion).toBe(5)
  })

  it('fail on a retry round strikes, stays, and adds retry suspicion', () => {
    const s = reducer(playing, {
      type: 'SUBMIT_ROUND',
      result: { passed: false, timeLeftSec: 10, strikeSource: 'wrongSubmit' },
    })
    expect(s.round).toBe(1)
    expect(s.strikes).toBe(1)
    expect(s.attempt).toBe(1)
    expect(s.suspicion).toBe(10)
    expect(s.phase).toBe('play')
  })

  it('retried pass loses the clean bonus', () => {
    const failed = reducer(playing, {
      type: 'SUBMIT_ROUND',
      result: { passed: false, timeLeftSec: 10, strikeSource: 'wrongSubmit' },
    })
    const s = reducer(failed, {
      type: 'SUBMIT_ROUND',
      result: { passed: true, timeLeftSec: 10 },
    })
    expect(s.score).toBe(110)
    expect(s.round).toBe(2)
  })

  it('fail on round 7 strikes, adds 20 suspicion, and advances', () => {
    const at7 = reducer(playing, { type: 'DEBUG_SET', patch: { round: 7 } })
    const s = reducer(at7, {
      type: 'SUBMIT_ROUND',
      result: { passed: false, timeLeftSec: 5, strikeSource: 'singleAttemptFail' },
    })
    expect(s.round).toBe(8)
    expect(s.strikes).toBe(1)
    expect(s.suspicion).toBe(20)
    expect(s.history).toEqual([{ round: 7, passed: false, count: undefined }])
  })

  it('third strike ends the run rejected', () => {
    const at2 = reducer(playing, { type: 'DEBUG_SET', patch: { strikes: 2 } })
    const s = reducer(at2, {
      type: 'SUBMIT_ROUND',
      result: { passed: false, timeLeftSec: 5, strikeSource: 'wrongSubmit' },
    })
    expect(s.phase).toBe('ending')
    expect(s.ending).toBe('rejected')
  })

  it('suspicion reaching 100 ends the run flagged', () => {
    const hot = reducer(playing, { type: 'DEBUG_SET', patch: { suspicion: 95 } })
    const s = reducer(hot, { type: 'SUSPICION', event: 'retry' })
    expect(s.suspicion).toBe(100)
    expect(s.phase).toBe('ending')
    expect(s.ending).toBe('flagged')
  })

  it('flagged wins over rejected', () => {
    const doomed = reducer(playing, { type: 'DEBUG_SET', patch: { suspicion: 95, strikes: 2 } })
    const s = reducer(doomed, {
      type: 'SUBMIT_ROUND',
      result: { passed: false, timeLeftSec: 5, strikeSource: 'wrongSubmit' },
    })
    expect(s.phase).toBe('ending')
    expect(s.ending).toBe('flagged')
  })

  it('timer expiry strikes and retries on rounds 1-6', () => {
    const s = reducer(playing, { type: 'TIMER_EXPIRED' })
    expect(s.round).toBe(1)
    expect(s.strikes).toBe(1)
    expect(s.attempt).toBe(1)
  })

  it('timer expiry advances on rounds 7-9', () => {
    const at8 = reducer(playing, { type: 'DEBUG_SET', patch: { round: 8 } })
    const s = reducer(at8, { type: 'TIMER_EXPIRED' })
    expect(s.round).toBe(9)
    expect(s.strikes).toBe(1)
    expect(s.history).toEqual([{ round: 8, passed: false }])
  })

  it('FINAL_CHOICE matter scores 300 and ends as ghost', () => {
    const at10 = reducer(playing, { type: 'DEBUG_SET', patch: { round: 10, suspicion: 60 } })
    const s = reducer(at10, { type: 'FINAL_CHOICE', choice: 'matter' })
    expect(s.phase).toBe('ending')
    expect(s.ending).toBe('ghost')
    expect(s.score).toBe(300)
    expect(s.finalChoice).toBe('matter')
  })

  it('FINAL_CHOICE human with low suspicion verifies', () => {
    const at10 = reducer(playing, { type: 'DEBUG_SET', patch: { round: 10, suspicion: 10 } })
    const s = reducer(at10, { type: 'FINAL_CHOICE', choice: 'human' })
    expect(s.ending).toBe('verified')
    expect(s.score).toBe(200)
  })

  it('FINAL_CHOICE human with high suspicion is probablyHuman', () => {
    const at10 = reducer(playing, { type: 'DEBUG_SET', patch: { round: 10, suspicion: 60 } })
    const s = reducer(at10, { type: 'FINAL_CHOICE', choice: 'human' })
    expect(s.ending).toBe('probablyHuman')
  })

  it('RESTART resets the run but keeps sound pref', () => {
    const s = run(
      initialState,
      { type: 'SOUND_TOGGLE' },
      { type: 'START_RUN' },
      { type: 'SUBMIT_ROUND', result: { passed: true, timeLeftSec: 10 } },
      { type: 'RESTART' },
    )
    expect(s.phase).toBe('start')
    expect(s.score).toBe(0)
    expect(s.round).toBe(1)
    expect(s.soundOn).toBe(false)
  })

  it('END_RUN forces an ending and DEBUG_SET patches state', () => {
    const forced = reducer(playing, { type: 'END_RUN', ending: 'ghost' })
    expect(forced.phase).toBe('ending')
    expect(forced.ending).toBe('ghost')
    const patched = reducer(playing, { type: 'DEBUG_SET', patch: { round: 9, suspicion: 42 } })
    expect(patched.round).toBe(9)
    expect(patched.suspicion).toBe(42)
  })

  it('submits are ignored outside play', () => {
    const s = reducer(initialState, {
      type: 'SUBMIT_ROUND',
      result: { passed: true, timeLeftSec: 10 },
    })
    expect(s).toBe(initialState)
  })
})
