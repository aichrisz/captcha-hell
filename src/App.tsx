import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import ClerkDesk from './components/ClerkDesk'
import { reducer, initialState } from './game/state'
import { getRound, type FinalData } from './game/rounds'
import { ENDING_COPY } from './game/endings'
import { humanityLabel, humanityScore } from './game/humanity'
import { filesForStage, popupsForRound, webcamLine, type PopupEvent } from './game/intrusions'
import { pickFlavor } from './game/flavor'
import { buildShareText } from './game/share'
import { readBestRecord, readEndingIds, writeEndingIds } from './game/storage'
import type { CheckboxData } from './game/puzzles/checkbox'
import { initCheckbox, nextCheckboxState } from './game/puzzles/checkbox'
import type { GridData } from './game/puzzles/grid'
import { validateGrid } from './game/puzzles/grid'
import type { RecallData } from './game/puzzles/recall'
import { buildRecallOptions, evalRecall } from './game/puzzles/recall'
import type { TimedClickData } from './game/puzzles/timedClick'
import { evalClick } from './game/puzzles/timedClick'
import type { SliderData } from './game/puzzles/slider'
import { attemptSlider, evalSlider } from './game/puzzles/slider'
import type { WordChoiceData } from './game/puzzles/wordChoice'
import { evalChoice } from './game/puzzles/wordChoice'
import type { StampAction, StampsData } from './game/puzzles/stamps'
import { evaluateDocuments } from './game/puzzles/stamps'
import type { EndingId, GameState, LastVerdict, RoundResult, VerdictMeasures } from './game/types'

function formatTime(sec: number) {
  return `${Math.max(0, Math.ceil(sec))}s`
}

interface TrailDot {
  id: number
  x: number
  y: number
}

function humanityOf(state: GameState) {
  return humanityScore({
    score: state.score,
    strikes: state.strikes,
    suspicion: state.suspicion,
    roundsCleared: state.history.length,
  })
}

function verdictChanges(delta: VerdictMeasures) {
  return (['score', 'strikes', 'suspicion'] as const)
    .filter((key) => delta[key] !== 0)
    .map((key) => `${key[0].toUpperCase()}${key.slice(1)} ${delta[key] > 0 ? '+' : ''}${delta[key]}`)
}

function receiptAnnouncement(verdict: LastVerdict) {
  const changes = verdictChanges(verdict.delta)
  return `Receipt ${verdict.sequence}: ${verdict.outcome}. Round ${verdict.round}.${changes.length ? ` ${changes.join('. ')}.` : ''}`
}

function VerdictReceipt({ verdict }: { verdict?: LastVerdict }) {
  if (!verdict) return <p className="verdict-receipt empty">Awaiting first verification result.</p>
  const changes = verdictChanges(verdict.delta)
  return (
    <div className="verdict-receipt" aria-label={`Receipt ${verdict.sequence}`}>
      <strong>Receipt {verdict.sequence}</strong>
      <span>Round {verdict.round}: {verdict.outcome}</span>
      {changes.length > 0 && <span>{changes.join('; ')}</span>}
    </div>
  )
}

function writeBest(state: GameState) {
  if (!state.ending) return readBestRecord()
  const best = readBestRecord()
  if (!best || state.score > best.score) {
    const next = { score: state.score, ending: state.ending, at: new Date().toISOString() }
    try { localStorage.setItem('captcha-hell.best.v1', JSON.stringify(next)) } catch { /* no storage */ }
    return next
  }
  return best
}

function useBeep(soundOn: boolean) {
  const ref = useRef<AudioContext | null>(null)
  return (kind: 'ok' | 'bad' | 'tick') => {
    if (!soundOn) return
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = ref.current ?? new Ctx()
    ref.current = ctx
    void ctx.resume?.()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = kind === 'bad' ? 'sawtooth' : 'triangle'
    osc.frequency.value = kind === 'ok' ? 720 : kind === 'bad' ? 130 : 360
    gain.gain.value = 0.001
    osc.connect(gain)
    gain.connect(ctx.destination)
    const now = ctx.currentTime
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14)
    osc.start(now)
    osc.stop(now + 0.16)
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [best, setBest] = useState(readBestRecord)
  const [endings, setEndings] = useState(readEndingIds)
  const endingsRef = useRef(endings)
  const [collectionNotSaved, setCollectionNotSaved] = useState(false)
  const [manualReduceMotion, setManualReduceMotion] = useState(false)
  const [osReduceMotion, setOsReduceMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const reduceMotion = manualReduceMotion || osReduceMotion
  const [timeLeft, setTimeLeft] = useState(20)
  const [timerIdentity, setTimerIdentity] = useState('')
  const [handledExpiry, setHandledExpiry] = useState('')
  const beep = useBeep(state.soundOn)
  const debug = useMemo(() => new URLSearchParams(location.search).has('debug'), [])
  const round = state.phase === 'play' ? getRound(state.round) : null
  const humanity = humanityOf(state)
  const [popups, setPopups] = useState<PopupEvent[]>([])
  const seenPopups = useRef<Set<string>>(new Set())
  const [tick, setTick] = useState(0)
  const [trail, setTrail] = useState<TrailDot[]>([])
  const trailSeq = useRef(0)

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!media) return
    const update = () => setOsReduceMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!round) {
      setTimerIdentity('')
      return
    }
    const key = `${round.id}-${state.attempt}`
    setTimeLeft(round.timerSec || 99)
    setTimerIdentity(key)
    setHandledExpiry('')
  }, [round?.id, state.attempt])

  useEffect(() => {
    if (state.phase !== 'ending') return
    setBest(writeBest(state))
  }, [state])

  useEffect(() => {
    if (state.phase !== 'ending' || !state.ending || debug || endingsRef.current.includes(state.ending)) return
    const next = [...endingsRef.current, state.ending]
    endingsRef.current = next
    setEndings(next)
    setCollectionNotSaved(!writeEndingIds(next))
  }, [state.phase, state.ending, debug])

  useEffect(() => {
    if (state.phase !== 'play' || !round || round.timerSec === 0 || timeLeft <= 0) return
    const id = window.setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [state.phase, round?.id, round?.timerSec, timeLeft])

  useEffect(() => {
    if (state.phase !== 'play' || !round || round.timerSec === 0) return
    if (timeLeft > 0 && timeLeft <= 4) beep('tick')
    if (timeLeft !== 0) return
    const key = `${round.id}-${state.attempt}`
    if (timerIdentity !== key || handledExpiry === key) return
    setHandledExpiry(key)
    dispatch({ type: 'TIMER_EXPIRED' })
    beep('bad')
  }, [state.phase, state.attempt, round?.id, round?.timerSec, timeLeft, timerIdentity, handledExpiry, beep])

  // Fake popup theater: schedule this round's popups once per run. Copy only,
  // rendered inside the app, no real windows or permissions.
  useEffect(() => {
    if (state.phase !== 'play') {
      setPopups([])
      seenPopups.current = new Set()
      return
    }
    if (!round) return
    const due = popupsForRound(round.id).filter((p) => !seenPopups.current.has(p.id))
    const timers = due.map((p) => window.setTimeout(() => {
      seenPopups.current.add(p.id)
      setPopups((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]))
    }, p.delayMs))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [state.phase, round?.id])

  useLayoutEffect(() => {
    if (state.phase !== 'play') return
    const app = document.querySelector<HTMLElement>('.app')
    const hud = app?.querySelector<HTMLElement>('.hud')
    if (!app || !hud) return
    const updateClearance = () => app.style.setProperty('--mobile-hud-clearance', `${Math.ceil(hud.getBoundingClientRect().bottom + 8)}px`)
    const observer = new ResizeObserver(updateClearance)
    observer.observe(hud)
    window.addEventListener('resize', updateClearance)
    updateClearance()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateClearance)
      app.style.removeProperty('--mobile-hud-clearance')
    }
  }, [state.phase])

  // Rotating flavor line in the notes panel.
  useEffect(() => {
    if (state.phase !== 'play') return
    const id = window.setInterval(() => setTick((t) => t + 1), 5000)
    return () => window.clearInterval(id)
  }, [state.phase])

  // Cursor lag trail: purely visual ghost dots, only with motion at full.
  useEffect(() => {
    if (reduceMotion || state.phase !== 'play') {
      setTrail([])
      return
    }
    let last = 0
    const onMove = (e: PointerEvent) => {
      const now = performance.now()
      if (now - last < 40) return
      last = now
      const dot = { id: ++trailSeq.current, x: e.clientX, y: e.clientY }
      setTrail((prev) => [...prev.slice(-11), dot])
      window.setTimeout(() => setTrail((prev) => prev.filter((d) => d.id !== dot.id)), 700)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [reduceMotion, state.phase])

  const dismissPopup = (id: string) => {
    setPopups((prev) => prev.filter((p) => p.id !== id))
    beep('tick')
  }

  const submit = (result: RoundResult, identity?: { round: number; attempt: number }) => {
    dispatch({ type: 'SUBMIT_ROUND', result, identity })
    beep(result.passed ? 'ok' : 'bad')
  }

  const announcement = state.lastVerdict ? receiptAnnouncement(state.lastVerdict) : ''
  const receiptOwner = <p className="receipt-announcer" data-receipt-announcer aria-live="polite" aria-atomic="true">{announcement}</p>

  if (state.phase === 'start') {
    return <>{receiptOwner}<StartScreen best={best} state={state} dispatch={dispatch} setReduceMotion={setManualReduceMotion} manualReduceMotion={manualReduceMotion} osReduceMotion={osReduceMotion} effectiveReduceMotion={reduceMotion} endings={endings} collectionNotSaved={collectionNotSaved} /></>
  }

  if (state.phase === 'ending') {
    const ending = state.ending ?? 'rejected'
    return <>{receiptOwner}<Ending state={state} best={best} dispatch={dispatch} ending={ending} reduceMotion={reduceMotion} endings={endings} collectionNotSaved={collectionNotSaved} /></>
  }

  return (
    <>
    {receiptOwner}
    <main className={`app crt stage-${round?.stage ?? 1} ${reduceMotion ? 'reduce-motion' : ''}`}>
      <section className="shell">
        <Header state={state} humanity={humanity} timeLeft={timeLeft} roundTimer={round?.timerSec ?? 0} dispatch={dispatch} />
        <section className="widget" aria-label="Captcha challenge">
          <p className="micro">SECURE HUMAN VERIFICATION</p>
          <h1>Captcha Hell</h1>
          {round && <Puzzle round={round} state={state} timeLeft={timeLeft} submit={submit} dispatch={dispatch} reduceMotion={reduceMotion} />}
          {round && (
            <div className="appeal">
              <button
                disabled={state.appealUsed || state.score < 50 || state.suspicion <= 0}
                aria-describedby="appeal-status"
                onClick={() => {
                  dispatch({ type: 'APPEAL_VERDICT' })
                }}
              >Appeal verdict</button>
              <p className="hint">Cost: 50 points. Removes up to 20 suspicion, clamped at zero.</p>
              <p id="appeal-status" className="hint">
                {state.appealUsed
                  ? 'Already used this run.'
                  : state.score < 50 && state.suspicion <= 0
                    ? 'Unavailable: need at least 50 points and suspicion above zero.'
                    : state.score < 50
                      ? 'Unavailable: need at least 50 points.'
                      : state.suspicion <= 0
                        ? 'Unavailable: no suspicion to remove.'
                        : 'Available once per run.'}
              </p>
            </div>
          )}
          <VerdictReceipt verdict={state.lastVerdict} />
        </section>
        <aside className="terms">
          <h2>Verification notes</h2>
          <p>Do not refresh. Do not overthink. Do not resemble an automated process.</p>
          <p className="flavor" aria-live="polite">{round ? pickFlavor(round.id, tick) : ''}</p>
          <p>Current mood: {state.suspicion > 65 ? 'accusatory' : state.round > 6 ? 'philosophical' : 'corporate'}</p>
          {round && (
            <div className="readout">
              <p className="readout-title">CAM ANALYSIS</p>
              <p className="webcam-line">{webcamLine(round.id, state.suspicion)}</p>
              <p className="readout-title">CONSULTED FILES</p>
              <ul className="files">
                {filesForStage(round.stage).map((f) => <li key={f}>{f}</li>)}
              </ul>
              <p className="readout-note">Theater only. No camera, no files, no system access.</p>
            </div>
          )}
        </aside>
      </section>
      {popups.length > 0 && (
        <div className="popup-layer">
          {popups.map((p, i) => (
            <div key={p.id} className="popup" role="alert" aria-label={p.title} style={{ '--popup-offset': `${i * 12}px` } as React.CSSProperties}>
              <div className="popup-title"><span>{p.title}</span><span aria-hidden="true">x</span></div>
              <p className="popup-body">{p.body}</p>
              <button onClick={() => dismissPopup(p.id)}>{p.dismiss}</button>
            </div>
          ))}
        </div>
      )}
      {trail.length > 0 && (
        <div className="trail-layer" aria-hidden="true">
          {trail.map((d) => <span key={d.id} className="trail-dot" style={{ left: d.x, top: d.y }} />)}
        </div>
      )}
      {debug && <Debug dispatch={dispatch} state={state} />}
    </main>
    </>
  )
}

function StartScreen({ best, state, dispatch, manualReduceMotion, osReduceMotion, effectiveReduceMotion, setReduceMotion, endings, collectionNotSaved }: { best: ReturnType<typeof readBestRecord>; state: GameState; dispatch: React.Dispatch<any>; manualReduceMotion: boolean; osReduceMotion: boolean; effectiveReduceMotion: boolean; setReduceMotion: (v: boolean) => void; endings: EndingId[]; collectionNotSaved: boolean }) {
  return (
    <main className="start">
      <section className="start-card">
        <p className="micro">HUMANITY CHECKPOINT</p>
        <h1>Captcha Hell</h1>
        <p className="lede">Pick traffic lights, dodge checkboxes, remember your own mistakes, and convince a form that you are not a beautifully scripted lie.</p>
        <div className="actions">
          <button className="primary" onClick={() => dispatch({ type: 'START_RUN' })}>Begin verification</button>
          <button onClick={() => dispatch({ type: 'SOUND_TOGGLE' })}>Sound {state.soundOn ? 'on' : 'off'}</button>
          <button onClick={() => setReduceMotion(!manualReduceMotion)}>Manual motion {manualReduceMotion ? 'reduced' : 'full'}</button>
        </div>
        <p className="hint motion-status">Effective motion: {effectiveReduceMotion ? 'reduced' : 'full'}{osReduceMotion ? ' by device preference' : ''}.</p>
        <p className="best">Best: {best ? `${best.score} points, ${ENDING_COPY[best.ending].title}` : 'no previous human detected'}</p>
        <EndingDossier endings={endings} notSaved={collectionNotSaved} />
      </section>
    </main>
  )
}

function EndingDossier({ endings, notSaved }: { endings: EndingId[]; notSaved: boolean }) {
  const unlocked = new Set(endings)
  return (
    <details className="ending-dossier">
      <summary>Ending dossier: {endings.length} of 6 unlocked</summary>
      <ul>{(Object.keys(ENDING_COPY) as EndingId[]).map((ending) => <li key={ending}>{unlocked.has(ending) ? ENDING_COPY[ending].title : 'Sealed verdict'}</li>)}</ul>
      <p className="hint">Saved only in this browser.</p>
      {notSaved && <p className="collection-status" role="status">New discoveries are session-only. Previously saved endings remain; this collection is not fully saved.</p>}
    </details>
  )
}

function Header({ state, humanity, timeLeft, roundTimer, dispatch }: { state: GameState; humanity: number; timeLeft: number; roundTimer: number; dispatch: React.Dispatch<any> }) {
  const timerLabel = roundTimer ? formatTime(timeLeft) : state.round === 10 ? 'final' : 'untimed'
  return (
    <header className="hud">
      <Meter label="Score" value={state.score} max={500} plain />
      <Meter label="Suspicion" value={state.suspicion} max={100} />
      <Meter label="Humanity" value={humanity} max={100} blue />
      <Meter label="Strikes" value={state.strikes} max={3} danger />
      <div className="stat"><span>Round</span><strong>{state.round}/10</strong></div>
      <div className="stat"><span>Timer</span><strong>{timerLabel}</strong></div>
      <button onClick={() => dispatch({ type: 'SOUND_TOGGLE' })}>Sound {state.soundOn ? 'on' : 'off'}</button>
    </header>
  )
}

function Meter({ label, value, max, danger, plain, blue }: { label: string; value: number; max: number; danger?: boolean; plain?: boolean; blue?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return <div className={`stat ${danger ? 'danger' : ''} ${blue ? 'human' : ''}`}><span>{label}</span><strong>{plain ? value : Math.round(value)}</strong><i style={{ width: `${pct}%` }} /></div>
}

function Puzzle({ round, state, timeLeft, submit, dispatch, reduceMotion }: { round: ReturnType<typeof getRound>; state: GameState; timeLeft: number; submit: (r: RoundResult, identity?: { round: number; attempt: number }) => void; dispatch: React.Dispatch<any>; reduceMotion: boolean }) {
  if (round.type === 'grid') return <GridPuzzle roundId={round.id} data={round.data as GridData} timeLeft={timeLeft} submit={submit} />
  if (round.type === 'checkbox') return <CheckboxPuzzle data={round.data as CheckboxData} timeLeft={timeLeft} submit={submit} reduceMotion={reduceMotion} />
  if (round.type === 'timedClick') return <TimedClick data={round.data as TimedClickData} attempt={state.attempt} timeLeft={timeLeft} submit={submit} />
  if (round.type === 'slider') return <SliderPuzzle data={round.data as SliderData} attempt={state.attempt} timeLeft={timeLeft} submit={submit} />
  if (round.type === 'stamps') return <StampPuzzle data={round.data as StampsData} roundId={round.id} attempt={state.attempt} submit={submit} />
  if (round.type === 'wordChoice') return <WordPuzzle data={round.data as WordChoiceData} timeLeft={timeLeft} submit={submit} />
  if (round.type === 'recall') return <RecallPuzzle data={round.data as RecallData} state={state} timeLeft={timeLeft} submit={submit} />
  return <FinalPuzzle data={round.data as FinalData} state={state} dispatch={dispatch} reduceMotion={reduceMotion} />
}

function GridPuzzle({ roundId, data, timeLeft, submit }: { roundId: number; data: GridData; timeLeft: number; submit: (r: RoundResult) => void }) {
  const [selected, setSelected] = useState<number[]>([])
  const toggle = (i: number) => setSelected((s) => s.includes(i) ? s.filter((x) => x !== i) : [...s, i])
  return <div><h2>{data.prompt}</h2>{roundId === 3 && <p className="hint interpretation-cue">Your interpretation will be kept on file.</p>}<div className="grid">{data.cells.map((cell, i) => <button className={selected.includes(i) ? 'cell active' : 'cell'} key={i} onClick={() => toggle(i)} aria-pressed={selected.includes(i)}><span>{cell.icon}</span><small>{cell.label ?? `tile ${i + 1}`}</small></button>)}</div><button className="primary wide" onClick={() => { const r = validateGrid(selected, data.correct, data.ambiguous); submit({ ...r, timeLeftSec: timeLeft, strikeSource: 'wrongSubmit' }) }}>Verify selection</button>{data.failCopy && <p className="hint">{data.failCopy}</p>}</div>
}

function CheckboxPuzzle({ data, timeLeft, submit, reduceMotion }: { data: CheckboxData; timeLeft: number; submit: (r: RoundResult) => void; reduceMotion: boolean }) {
  const [box, setBox] = useState(initCheckbox())
  const [motionNotice, setMotionNotice] = useState('')
  return <div><h2>{data.prompt}</h2><button className="checkbox" style={{ transform: `translate(${box.offsetX}px, ${box.offsetY}px)`, '--dodge-x': `${box.offsetX}px`, '--dodge-y': `${box.offsetY}px` } as React.CSSProperties} onClick={() => { const step = nextCheckboxState(box, data, reduceMotion); setBox(step.state); setMotionNotice(reduceMotion && step.event === 'dodge' ? 'The checkbox stayed still. Try again.' : ''); if (step.event === 'checked') submit({ passed: true, timeLeftSec: timeLeft }); }}><span>{box.checked ? '✓' : box.frozen ? '?' : ''}</span>I am not a robot</button>{motionNotice && <p className="hint" role="status">{motionNotice}</p>}{box.frozen && <p className="hint">The checkbox has frozen. It wants a statement, not a click.</p>}</div>
}

function TimedClick({ data, attempt, timeLeft, submit }: { data: TimedClickData; attempt: number; timeLeft: number; submit: (r: RoundResult) => void }) {
  const [phase, setPhase] = useState<'waiting' | 'fakeout' | 'gap' | 'open' | 'closed'>('waiting')
  const attemptStartedAt = useRef(0)
  const fakeoutEndMs = data.fakeoutDelayMs + data.fakeoutFlashMs
  const windowOpenMs = fakeoutEndMs + data.realDelayMs
  const windowCloseMs = windowOpenMs + data.windowMs

  useEffect(() => {
    attemptStartedAt.current = performance.now()
    setPhase('waiting')
    const timers = [
      window.setTimeout(() => setPhase('fakeout'), data.fakeoutDelayMs),
      window.setTimeout(() => setPhase('gap'), fakeoutEndMs),
      window.setTimeout(() => setPhase('open'), windowOpenMs),
      window.setTimeout(() => setPhase('closed'), windowCloseMs),
    ]
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [attempt, data.fakeoutDelayMs, data.fakeoutFlashMs, data.realDelayMs, data.windowMs, fakeoutEndMs, windowOpenMs, windowCloseMs])

  const ready = phase === 'open'
  const status = phase === 'fakeout'
    ? 'Fake green flash - decoy. Do not click.'
    : phase === 'gap'
      ? 'Fake flash ended. Verification is not open.'
      : ready
        ? 'Verification window open. Click VERIFY now.'
        : phase === 'closed'
          ? 'Verification window closed.'
          : 'Waiting for the verification signal.'

  return <div>
    <h2>{data.prompt}</h2>
    <p className="hint timed-click-status" role="status">{status}</p>
    <button
      className={ready ? 'primary verify ready' : phase === 'fakeout' ? 'primary verify fakeout' : 'verify'}
      onClick={() => {
        const elapsedMs = performance.now() - attemptStartedAt.current
        const result = evalClick(elapsedMs, windowOpenMs, windowCloseMs, elapsedMs >= fakeoutEndMs)
        submit({
          passed: result === 'pass',
          timeLeftSec: timeLeft,
          strikeSource: result === 'early' ? 'earlyClick' : result === 'late' ? 'wrongSubmit' : undefined,
        })
      }}
    >{ready || phase === 'fakeout' ? 'VERIFY' : 'wait'}</button>
  </div>
}

function SliderPuzzle({ data, attempt, timeLeft, submit }: { data: SliderData; attempt: number; timeLeft: number; submit: (r: RoundResult) => void }) {
  const [value, setValue] = useState(50)
  const [tol, setTol] = useState(data.tolerance)
  const [misses, setMisses] = useState(0)
  const previousAttempt = useRef(attempt)
  const withinTolerance = evalSlider(value, data.target, tol)
  const registrationStatus = withinTolerance ? 'Within tolerance' : value < data.target ? 'Copy left of registration' : 'Copy right of registration'
  const statusText = `${registrationStatus}. target ${data.target}; tolerance plus or minus ${tol}.`
  const offsetPercent = (value - data.target) * 0.19
  useEffect(() => {
    if (previousAttempt.current === attempt) return
    previousAttempt.current = attempt
    setMisses(0)
    setTol(data.tolerance)
  }, [attempt, data.tolerance])
  return <div className="slider-puzzle">
    <h2>{data.prompt}</h2>
    <p id="slider-instructions" className="slider-instructions">Move the duplicate into the registration band, then lock alignment to submit.</p>
    <div
      className="registration-illustration"
      data-registration-illustration
      data-value={value}
      data-target={data.target}
      data-tolerance={tol}
      data-offset-percent={offsetPercent.toFixed(2)}
      aria-hidden="true"
    >
      <div className="registration-stage">
        <div className="registration-paper registration-original">
          <span className="registration-paper-label">ORIGINAL 05-C</span>
          <span className="registration-mark registration-mark-left" />
          <span className="registration-mark registration-mark-right" />
          <span className="registration-line registration-line-long" />
          <span className="registration-line registration-line-short" />
          <span className="registration-seal" />
        </div>
        <div className="registration-paper registration-copy" data-registration-copy style={{ '--registration-offset': `${offsetPercent}%` } as React.CSSProperties}>
          <span className="registration-paper-label">COPY 05-C</span>
          <span className="registration-mark registration-mark-left" />
          <span className="registration-mark registration-mark-right" />
          <span className="registration-line registration-line-long" />
          <span className="registration-line registration-line-short" />
          <span className="registration-seal" />
        </div>
      </div>
      <svg className="registration-scale" viewBox="0 0 100 20" preserveAspectRatio="none">
        <line className="registration-scale-track" x1="0" y1="10" x2="100" y2="10" />
        <rect data-tolerance-band x={data.target - tol} y="5" width={tol * 2} height="10" />
        <line className="registration-target-mark" x1={data.target} y1="1" x2={data.target} y2="19" />
      </svg>
    </div>
    <p id="slider-registration-status" className="slider-registration-status" role="status" aria-live="polite">{statusText}</p>
    <div className="slider-wrap">
      <span className="slider-tolerance" style={{ left: `${data.target}%`, width: `${tol * 2}%` }} aria-hidden="true" />
      <input
        aria-label="alignment slider"
        aria-describedby="slider-instructions slider-registration-status"
        aria-valuetext={statusText}
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
      />
    </div>
    <button className="primary wide" onClick={() => { const r = attemptSlider(value, data, tol, misses); if (r.passed) submit({ passed: true, timeLeftSec: timeLeft }); else if (r.strike) submit({ passed: false, timeLeftSec: timeLeft, strikeSource: 'wrongSubmit' }); else { setTol(r.tolerance); setMisses(r.misses); } }}>Lock alignment</button>
    <p className="hint">Misses: {misses}/{data.maxMisses}</p>
  </div>
}

function StampPuzzle({ data, roundId, attempt, submit }: { data: StampsData; roundId: number; attempt: number; submit: (r: RoundResult, identity?: { round: number; attempt: number }) => void }) {
  const [sequence, setSequence] = useState<StampAction[]>([])
  const [feedback, setFeedback] = useState('')
  const [localStatus, setLocalStatus] = useState('No stamps applied. Original readable and not witnessed; Copy absent.')
  const filedAttempt = useRef<number | null>(null)
  const documents = evaluateDocuments(sequence)
  const used = (action: StampAction) => sequence.includes(action)
  const summarize = (result: ReturnType<typeof evaluateDocuments>) => {
    const witness = result.witness === 'valid' ? 'witnessed' : result.witness === 'invalid' ? 'witnessed too late' : 'not witnessed'
    const copy = !result.copyPresent ? 'absent' : `${result.copyReadable ? 'readable' : 'unreadable'}, ${result.copyCertified ? 'certified' : 'not certified'}`
    return `Original ${result.originalReadable ? 'readable' : 'redacted'} and ${witness}; Copy ${copy}.`
  }
  const stamp = (action: StampAction) => {
    const next = [...sequence, action]
    setSequence(next)
    setLocalStatus(`${action[0].toUpperCase()}${action.slice(1)} stamp applied. ${summarize(evaluateDocuments(next))}`)
    setFeedback('')
  }
  const file = () => {
    if (filedAttempt.current === attempt) return
    filedAttempt.current = attempt
    const result = evaluateDocuments(sequence)
    setFeedback(result.valid ? '' : `File returned. ${result.missing.join(' ')}`)
    submit({ passed: result.valid, timeLeftSec: 0, strikeSource: 'wrongSubmit' }, { round: roundId, attempt })
  }

  return <div className="stamp-puzzle">
    <h2>{data.prompt}</h2>
    <p className="stamp-rules" id="stamp-rules">Witness while the Original is readable. Copy captures its readable state and witness mark at that moment. Redact the Original before filing.</p>
    <p className="stamp-consequence" id="stamp-consequence">Wrong or incomplete filing: +1 strike and +10 suspicion. A retry loses the clean-pass bonus. The third strike ends the run.</p>
    <div className="document-pair">
      <article className="document-card" aria-label="Original document">
        <div className="document-heading"><span>ORIGINAL</span><span>Record 06-B</span></div>
        <p className="document-status"><span>{documents.originalReadable ? 'Readable' : 'Redacted'}</span><span>{documents.witness === 'valid' ? 'Witnessed' : documents.witness === 'invalid' ? 'Witnessed too late' : 'Not witnessed'}</span></p>
        <p className={documents.originalReadable ? 'document-text' : 'document-text redacted'}>{documents.originalReadable ? data.statement : 'REDACTED BY ORDER OF THE REGISTRY'}</p>
      </article>
      <article className="document-card copy-card" aria-label="Certified copy">
        <div className="document-heading"><span>COPY</span><span>Duplicate 06-B</span></div>
        <p className="document-status"><span>{!documents.copyPresent ? 'Absent' : documents.copyReadable ? 'Readable' : 'Unreadable'}</span><span>{documents.copyCertified ? 'Certified' : 'Not certified'}</span></p>
        <p className={documents.copyReadable ? 'document-text' : 'document-text redacted'}>{documents.copyPresent ? documents.copyReadable ? data.statement : 'Unreadable when copied' : 'No duplicate has been issued.'}</p>
      </article>
    </div>
    <p className="stamp-local-note">Stamps stay local until filing. Editing is untimed.</p>
    <p className="stamp-local-status" role="status" aria-live="polite">{localStatus}</p>
    <div className="stamp-actions" role="group" aria-label="Document stamps">
      <button disabled={used('witness')} onClick={() => stamp('witness')}>Witness</button>
      <button disabled={used('copy')} onClick={() => stamp('copy')}>Copy</button>
      <button disabled={used('redact')} onClick={() => stamp('redact')}>Redact</button>
      <button disabled={sequence.length === 0} onClick={() => { const next = sequence.slice(0, -1); setSequence(next); setLocalStatus(`Undo applied. ${summarize(evaluateDocuments(next))}`); setFeedback('') }}>Undo</button>
      <button disabled={sequence.length === 0} onClick={() => { setSequence([]); setLocalStatus('Reset applied. Original readable and not witnessed; Copy absent.'); setFeedback('') }}>Reset</button>
      <button className="primary" aria-describedby="stamp-rules stamp-consequence" onClick={file}>File</button>
    </div>
    {feedback && <p className="stamp-feedback" role="status">{feedback}</p>}
  </div>
}

function WordPuzzle({ data, timeLeft, submit }: { data: WordChoiceData; timeLeft: number; submit: (r: RoundResult) => void }) {
  return <div><h2>{data.prompt}</h2><div className="choices">{data.options.map((opt, i) => <button key={opt} onClick={() => { const r = evalChoice(i, data.correctIndex ?? 0); submit({ passed: r.passed, timeLeftSec: timeLeft, strikeSource: 'wrongSubmit' }) }}>{opt}</button>)}</div></div>
}

function RecallPuzzle({ data, state, timeLeft, submit }: { data: RecallData; state: GameState; timeLeft: number; submit: (r: RoundResult) => void }) {
  if (state.ambiguousChoice) {
    return <div><h2>In round 3, how did you interpret the poster?</h2><div className="choices semantic-choices"><button onClick={() => submit({ passed: state.ambiguousChoice === 'bicycle', timeLeftSec: timeLeft, strikeSource: 'wrongSubmit' })}>I counted the poster as a bicycle</button><button onClick={() => submit({ passed: state.ambiguousChoice === 'poster', timeLeftSec: timeLeft, strikeSource: 'wrongSubmit' })}>I treated it as a poster</button></div></div>
  }
  const actual = state.history.find((h) => h.round === data.sourceRound)?.count ?? data.fallbackCount
  const options = buildRecallOptions(actual, state.score + state.round)
  return <div><h2>{data.prompt}</h2><div className="choices number-choices">{options.map((n) => <button key={n} onClick={() => submit({ passed: evalRecall(n, actual), timeLeftSec: timeLeft, strikeSource: 'wrongSubmit' })}>{n}</button>)}</div></div>
}

function FinalPuzzle({ data, state, dispatch, reduceMotion }: { data: FinalData; state: GameState; dispatch: React.Dispatch<any>; reduceMotion: boolean }) {
  const [box, setBox] = useState(initCheckbox())
  const [motionNotice, setMotionNotice] = useState('')
  return <div>
    <h2>{data.prompt}</h2>
    <button className="checkbox final-box" style={{ transform: `translate(${box.offsetX}px, ${box.offsetY}px)`, '--dodge-x': `${box.offsetX}px`, '--dodge-y': `${box.offsetY}px` } as React.CSSProperties} onClick={() => { const step = nextCheckboxState(box, data.checkbox, reduceMotion); setBox(step.state); setMotionNotice(reduceMotion && step.event === 'dodge' ? 'The checkbox stayed still. Try again.' : ''); if (step.event === 'freeze') dispatch({ type: 'FINAL_READY' }); }}><span>{state.finalReady ? '?' : ''}</span>{data.checkbox.prompt}</button>
    {motionNotice && <p className="hint" role="status">{motionNotice}</p>}
    {state.finalReady && <>
      <p className="hint final-frozen">The checkbox has frozen. It wants a statement, not a click.</p>
      <div className="choices">{data.word.options.map((opt, i) => <button key={opt} onClick={() => dispatch({ type: 'FINAL_CHOICE', choice: data.word.branch?.[i] ?? 'trying' })}>{opt}</button>)}</div>
      <div className="final-choice-actions"><p id="refusal-warning">Sets suspicion to 100 and ends this run as ACCOUNT FLAGGED.</p><button className="refusal-choice" aria-describedby="refusal-warning" onClick={() => dispatch({ type: 'REFUSE_VERIFICATION' })}>Refuse verification</button></div>
    </>}
  </div>
}

function Ending({ state, best, dispatch, ending, reduceMotion, endings, collectionNotSaved }: { state: GameState; best: ReturnType<typeof readBestRecord>; dispatch: React.Dispatch<any>; ending: EndingId; reduceMotion: boolean; endings: EndingId[]; collectionNotSaved: boolean }) {
  const copy = ENDING_COPY[ending]
  const humanity = humanityOf(state)
  const [copyNote, setCopyNote] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [clerkOpen, setClerkOpen] = useState(false)
  const clerkTrigger = useRef<HTMLButtonElement>(null)
  const clerkWasOpen = useRef(false)
  useLayoutEffect(() => {
    if (clerkOpen) clerkWasOpen.current = true
    else if (clerkWasOpen.current) {
      clerkWasOpen.current = false
      clerkTrigger.current?.focus()
    }
  }, [clerkOpen])
  const shareText = buildShareText({
    title: copy.title,
    score: state.score,
    strikes: state.strikes,
    suspicion: state.suspicion,
    humanity,
    win: copy.win,
  })
  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(shareText)
      setCopyNote('Copied. Paste your verdict somewhere public.')
    } catch {
      setShowRaw(true)
      setCopyNote('Clipboard unavailable. Select the text below by hand.')
    }
  }
  if (clerkOpen) {
    return <main className={`start ending crt ${reduceMotion ? 'reduce-motion' : ''}`}><ClerkDesk reduceMotion={reduceMotion} onExit={() => setClerkOpen(false)} /></main>
  }
  return (
    <main className={`start ending crt ${reduceMotion ? 'reduce-motion' : ''}`}>
      <section className="start-card">
        <p className="micro">VERIFICATION COMPLETE</p>
        <h1>{copy.title}</h1>
        <p className="lede">{copy.lines.join(' ')}</p>
        <dl className="result">
          <div><dt>Score</dt><dd>{state.score}</dd></div>
          <div><dt>Strikes</dt><dd>{state.strikes}/3</dd></div>
          <div><dt>Suspicion</dt><dd>{state.suspicion}</dd></div>
          <div><dt>Humanity</dt><dd>{humanity}%</dd></div>
          <div><dt>Best</dt><dd>{best?.score ?? state.score}</dd></div>
        </dl>
        <p className="verdict">Reading: {humanityLabel(humanity)}</p>
        <VerdictReceipt verdict={state.lastVerdict} />
        <EndingDossier endings={endings} notSaved={collectionNotSaved} />
        <div className="actions">
          <button className="primary" onClick={() => dispatch({ type: 'START_RUN' })}>Try again</button>
          <button onClick={copyResult}>Copy result</button>
          <button ref={clerkTrigger} onClick={() => setClerkOpen(true)}>Acting Clerk</button>
        </div>
        {copyNote && <p className="copy-note" aria-live="polite">{copyNote}</p>}
        {showRaw && <pre className="share-raw">{shareText}</pre>}
      </section>
    </main>
  )
}

function Debug({ dispatch, state }: { dispatch: React.Dispatch<any>; state: GameState }) {
  return <aside className="debug"><strong>Debug</strong><button onClick={() => dispatch({ type: 'DEBUG_SET', patch: { round: Math.min(10, state.round + 1) } })}>Next round</button><button onClick={() => dispatch({ type: 'DEBUG_SET', patch: { suspicion: Math.min(99, state.suspicion + 30) } })}>Suspicion +30</button><button onClick={() => dispatch({ type: 'END_RUN', ending: 'probablyHuman' })}>Force ending</button></aside>
}
