import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { reducer, initialState } from './game/state'
import { getRound, type FinalData } from './game/rounds'
import { ENDING_COPY } from './game/endings'
import { humanityLabel, humanityScore } from './game/humanity'
import { filesForStage, popupsForRound, webcamLine, type PopupEvent } from './game/intrusions'
import { pickFlavor } from './game/flavor'
import { buildShareText } from './game/share'
import type { CheckboxData } from './game/puzzles/checkbox'
import { initCheckbox, nextCheckboxState } from './game/puzzles/checkbox'
import type { GridData } from './game/puzzles/grid'
import { validateGrid } from './game/puzzles/grid'
import type { RecallData } from './game/puzzles/recall'
import { buildRecallOptions, evalRecall } from './game/puzzles/recall'
import type { SliderData } from './game/puzzles/slider'
import { attemptSlider } from './game/puzzles/slider'
import type { WordChoiceData } from './game/puzzles/wordChoice'
import { evalChoice } from './game/puzzles/wordChoice'
import type { EndingId, GameState, RoundResult } from './game/types'

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

function readBest() {
  try {
    const raw = localStorage.getItem('captcha-hell.best.v1')
    return raw ? JSON.parse(raw) as { score: number; ending: EndingId; at: string } : null
  } catch {
    return null
  }
}

function writeBest(state: GameState) {
  if (!state.ending) return readBest()
  const best = readBest()
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
  const [best, setBest] = useState(readBest)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [timeLeft, setTimeLeft] = useState(20)
  const [handledExpiry, setHandledExpiry] = useState('')
  const [message, setMessage] = useState('Awaiting first verification.')
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
    if (!round) return
    setTimeLeft(round.timerSec || 99)
    setHandledExpiry('')
    setMessage(`Round ${round.id}: ${round.type}`)
  }, [round?.id, state.attempt])

  useEffect(() => {
    if (state.phase !== 'ending') return
    setBest(writeBest(state))
  }, [state])

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
    const key = `${round.id}-${state.attempt}-${state.strikes}`
    if (handledExpiry === key) return
    setHandledExpiry(key)
    dispatch({ type: 'TIMER_EXPIRED' })
    beep('bad')
    setMessage('Time expired. The widget noticed.')
  }, [state.phase, state.attempt, state.strikes, round?.id, round?.timerSec, timeLeft, handledExpiry, beep])

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

  // Rotating flavor line in the notes panel.
  useEffect(() => {
    if (state.phase !== 'play') return
    const id = window.setInterval(() => setTick((t) => t + 1), 5000)
    return () => window.clearInterval(id)
  }, [state.phase])

  // Cursor lag trail: purely visual ghost dots, only with motion at full.
  useEffect(() => {
    const osReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduceMotion || osReduced || state.phase !== 'play') return
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

  const submit = (result: RoundResult) => {
    dispatch({ type: 'SUBMIT_ROUND', result })
    beep(result.passed ? 'ok' : 'bad')
    setMessage(result.passed ? 'Accepted. Suspiciously accepted.' : 'Rejected. Try to be more human.')
  }

  if (state.phase === 'start') {
    return <StartScreen best={best} state={state} dispatch={dispatch} setReduceMotion={setReduceMotion} reduceMotion={reduceMotion} />
  }

  if (state.phase === 'ending') {
    const ending = state.ending ?? 'rejected'
    return <Ending state={state} best={best} dispatch={dispatch} ending={ending} reduceMotion={reduceMotion} />
  }

  return (
    <main className={`app crt stage-${round?.stage ?? 1} ${reduceMotion ? 'reduce-motion' : ''}`}>
      <section className="shell">
        <Header state={state} humanity={humanity} timeLeft={timeLeft} roundTimer={round?.timerSec ?? 0} dispatch={dispatch} />
        <section className="widget" aria-label="Captcha challenge">
          <p className="micro">SECURE HUMAN VERIFICATION</p>
          <h1>Captcha Hell</h1>
          {round && <Puzzle round={round} state={state} timeLeft={timeLeft} submit={submit} dispatch={dispatch} reduceMotion={reduceMotion} />}
          {round && (
            <div>
              <button
                disabled={state.appealUsed || state.score < 50 || state.suspicion <= 0}
                aria-describedby="appeal-status"
                onClick={() => {
                  dispatch({ type: 'APPEAL_VERDICT' })
                  setMessage('Appeal accepted: 50 points spent; suspicion reduced by up to 20.')
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
          <p className="message" aria-live="polite">{message}</p>
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
            <div key={p.id} className="popup" role="alert" aria-label={p.title} style={{ transform: `translate(${i * 12}px, ${i * 12}px)` }}>
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
  )
}

function StartScreen({ best, state, dispatch, reduceMotion, setReduceMotion }: { best: ReturnType<typeof readBest>; state: GameState; dispatch: React.Dispatch<any>; reduceMotion: boolean; setReduceMotion: (v: boolean) => void }) {
  return (
    <main className="start">
      <section className="start-card">
        <p className="micro">HUMANITY CHECKPOINT</p>
        <h1>Captcha Hell</h1>
        <p className="lede">Pick traffic lights, dodge checkboxes, remember your own mistakes, and convince a form that you are not a beautifully scripted lie.</p>
        <div className="actions">
          <button className="primary" onClick={() => dispatch({ type: 'START_RUN' })}>Begin verification</button>
          <button onClick={() => dispatch({ type: 'SOUND_TOGGLE' })}>Sound {state.soundOn ? 'on' : 'off'}</button>
          <button onClick={() => setReduceMotion(!reduceMotion)}>Motion {reduceMotion ? 'reduced' : 'full'}</button>
        </div>
        <p className="best">Best: {best ? `${best.score} points, ${ENDING_COPY[best.ending].title}` : 'no previous human detected'}</p>
      </section>
    </main>
  )
}

function Header({ state, humanity, timeLeft, roundTimer, dispatch }: { state: GameState; humanity: number; timeLeft: number; roundTimer: number; dispatch: React.Dispatch<any> }) {
  return (
    <header className="hud">
      <Meter label="Score" value={state.score} max={500} plain />
      <Meter label="Suspicion" value={state.suspicion} max={100} />
      <Meter label="Humanity" value={humanity} max={100} blue />
      <Meter label="Strikes" value={state.strikes} max={3} danger />
      <div className="stat"><span>Round</span><strong>{state.round}/10</strong></div>
      <div className="stat"><span>Timer</span><strong>{roundTimer ? formatTime(timeLeft) : 'final'}</strong></div>
      <button onClick={() => dispatch({ type: 'SOUND_TOGGLE' })}>Sound {state.soundOn ? 'on' : 'off'}</button>
    </header>
  )
}

function Meter({ label, value, max, danger, plain, blue }: { label: string; value: number; max: number; danger?: boolean; plain?: boolean; blue?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return <div className={`stat ${danger ? 'danger' : ''} ${blue ? 'human' : ''}`}><span>{label}</span><strong>{plain ? value : Math.round(value)}</strong><i style={{ width: `${pct}%` }} /></div>
}

function Puzzle({ round, state, timeLeft, submit, dispatch, reduceMotion }: { round: ReturnType<typeof getRound>; state: GameState; timeLeft: number; submit: (r: RoundResult) => void; dispatch: React.Dispatch<any>; reduceMotion: boolean }) {
  if (round.type === 'grid') return <GridPuzzle data={round.data as GridData} timeLeft={timeLeft} submit={submit} />
  if (round.type === 'checkbox') return <CheckboxPuzzle data={round.data as CheckboxData} timeLeft={timeLeft} submit={submit} reduceMotion={reduceMotion} />
  if (round.type === 'timedClick') return <TimedClick timeLeft={timeLeft} submit={submit} />
  if (round.type === 'slider') return <SliderPuzzle data={round.data as SliderData} timeLeft={timeLeft} submit={submit} />
  if (round.type === 'wordChoice') return <WordPuzzle data={round.data as WordChoiceData} timeLeft={timeLeft} submit={submit} />
  if (round.type === 'recall') return <RecallPuzzle data={round.data as RecallData} state={state} timeLeft={timeLeft} submit={submit} />
  return <FinalPuzzle data={round.data as FinalData} dispatch={dispatch} />
}

function GridPuzzle({ data, timeLeft, submit }: { data: GridData; timeLeft: number; submit: (r: RoundResult) => void }) {
  const [selected, setSelected] = useState<number[]>([])
  const toggle = (i: number) => setSelected((s) => s.includes(i) ? s.filter((x) => x !== i) : [...s, i])
  return <div><h2>{data.prompt}</h2><div className="grid">{data.cells.map((cell, i) => <button className={selected.includes(i) ? 'cell active' : 'cell'} key={i} onClick={() => toggle(i)} aria-pressed={selected.includes(i)}><span>{cell.icon}</span><small>{cell.label ?? `tile ${i + 1}`}</small></button>)}</div><button className="primary wide" onClick={() => { const r = validateGrid(selected, data.correct, data.ambiguous); submit({ ...r, timeLeftSec: timeLeft, strikeSource: 'wrongSubmit' }) }}>Verify selection</button>{data.failCopy && <p className="hint">{data.failCopy}</p>}</div>
}

function CheckboxPuzzle({ data, timeLeft, submit, reduceMotion }: { data: CheckboxData; timeLeft: number; submit: (r: RoundResult) => void; reduceMotion: boolean }) {
  const [box, setBox] = useState(initCheckbox())
  return <div><h2>{data.prompt}</h2><button className="checkbox" style={{ transform: `translate(${box.offsetX}px, ${box.offsetY}px)` }} onClick={() => { const step = nextCheckboxState(box, data, reduceMotion); setBox(step.state); if (step.event === 'checked') submit({ passed: true, timeLeftSec: timeLeft }); }}><span>{box.checked ? '✓' : box.frozen ? '?' : ''}</span>I am not a robot</button>{box.frozen && <p className="hint">The checkbox has frozen. It wants a statement, not a click.</p>}</div>
}

function TimedClick({ timeLeft, submit }: { timeLeft: number; submit: (r: RoundResult) => void }) {
  const [ready, setReady] = useState(false)
  useEffect(() => { const id = window.setTimeout(() => setReady(true), 2200); return () => window.clearTimeout(id) }, [])
  return <div><h2>Click VERIFY when it turns green. Not before.</h2><button className={ready ? 'primary verify ready' : 'verify'} onClick={() => submit({ passed: ready, timeLeftSec: timeLeft, strikeSource: ready ? undefined : 'earlyClick' })}>{ready ? 'VERIFY' : 'wait'}</button></div>
}

function SliderPuzzle({ data, timeLeft, submit }: { data: SliderData; timeLeft: number; submit: (r: RoundResult) => void }) {
  const [value, setValue] = useState(50)
  const [tol, setTol] = useState(data.tolerance)
  const [misses, setMisses] = useState(0)
  return <div><h2>{data.prompt}</h2><div className="slider-wrap"><span style={{ left: `${data.target}%`, width: `${tol * 2}%` }} /><input aria-label="alignment slider" type="range" min="0" max="100" value={value} onChange={(e) => setValue(Number(e.target.value))} /></div><button className="primary wide" onClick={() => { const r = attemptSlider(value, data, tol, misses); if (r.passed) submit({ passed: true, timeLeftSec: timeLeft }); else if (r.strike) submit({ passed: false, timeLeftSec: timeLeft, strikeSource: 'wrongSubmit' }); else { setTol(r.tolerance); setMisses(r.misses); } }}>Lock alignment</button><p className="hint">Misses: {misses}/{data.maxMisses}</p></div>
}

function WordPuzzle({ data, timeLeft, submit }: { data: WordChoiceData; timeLeft: number; submit: (r: RoundResult) => void }) {
  return <div><h2>{data.prompt}</h2><div className="choices">{data.options.map((opt, i) => <button key={opt} onClick={() => { const r = evalChoice(i, data.correctIndex ?? 0); submit({ passed: r.passed, timeLeftSec: timeLeft, strikeSource: 'wrongSubmit' }) }}>{opt}</button>)}</div></div>
}

function RecallPuzzle({ data, state, timeLeft, submit }: { data: RecallData; state: GameState; timeLeft: number; submit: (r: RoundResult) => void }) {
  const actual = state.history.find((h) => h.round === data.sourceRound)?.count ?? data.fallbackCount
  const options = buildRecallOptions(actual, state.score + state.round)
  return <div><h2>{data.prompt}</h2><div className="choices number-choices">{options.map((n) => <button key={n} onClick={() => submit({ passed: evalRecall(n, actual), timeLeftSec: timeLeft, strikeSource: 'wrongSubmit' })}>{n}</button>)}</div></div>
}

function FinalPuzzle({ data, dispatch }: { data: FinalData; dispatch: React.Dispatch<any> }) {
  const [box, setBox] = useState(initCheckbox())
  const frozen = box.frozen
  return <div><h2>{data.prompt}</h2><button className="checkbox final-box" style={{ transform: `translate(${box.offsetX}px, ${box.offsetY}px)` }} onClick={() => setBox((s) => nextCheckboxState(s, data.checkbox, false).state)}><span>{box.frozen ? '?' : ''}</span>{data.checkbox.prompt}</button>{frozen && <div className="choices">{data.word.options.map((opt, i) => <button key={opt} onClick={() => dispatch({ type: 'FINAL_CHOICE', choice: data.word.branch?.[i] ?? 'trying' })}>{opt}</button>)}</div>}</div>
}

function Ending({ state, best, dispatch, ending, reduceMotion }: { state: GameState; best: ReturnType<typeof readBest>; dispatch: React.Dispatch<any>; ending: EndingId; reduceMotion: boolean }) {
  const copy = ENDING_COPY[ending]
  const humanity = humanityOf(state)
  const [copyNote, setCopyNote] = useState('')
  const [showRaw, setShowRaw] = useState(false)
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
        <div className="actions">
          <button className="primary" onClick={() => dispatch({ type: 'START_RUN' })}>Try again</button>
          <button onClick={copyResult}>Copy result</button>
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
