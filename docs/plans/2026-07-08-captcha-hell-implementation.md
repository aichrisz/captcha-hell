# Captcha Hell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one-day browser game: 10 escalating CAPTCHA rounds, 5 endings, HUD with score/strikes/suspicion, mobile friendly, testable pure logic, GitHub Pages ready.

**Architecture:** Single-page React app. All game rules live in pure TypeScript modules under `src/game/` (reducer + per-puzzle validators), fully covered by Vitest without DOM. React components are thin views that dispatch actions. CSS class per stage drives visual decay. No backend; localStorage for best score, endings found, sound pref.

**Tech Stack:** Vite, React 18, TypeScript strict, native CSS, Vitest, WebAudio (no assets), localStorage.

**Constraint:** No em-dash or en-dash characters anywhere in copy or code strings. Hyphen only. Applies to this plan, all source, all UI copy.

**Spec:** `docs/superpowers/specs/2026-07-08-captcha-hell-design.md`. This plan intentionally contains signatures, data shapes, test case lists, and commands, not full source bodies. Executor writes bodies per spec sections referenced in each task.

---

## File Map (exact)

```
captcha-hell/
  index.html                      Vite entry, viewport meta, root div
  package.json                    scripts: dev, build, preview, test
  vite.config.ts                  react plugin, base: '/captcha-hell/' for Pages
  tsconfig.json                   strict: true
  .github/workflows/deploy.yml    Pages deploy on push to main
  src/
    main.tsx                      mount App
    App.tsx                       phase switch: start | play | ending; reducer host
    game/
      types.ts                    all shared types (below)
      state.ts                    reducer(state, action) -> state; initialState
      rounds.ts                   ROUNDS: RoundDef[10], data-driven per spec section 5
      scoring.ts                  scorePass(timeLeftSec, retried, round10Bonus) -> number
      suspicion.ts                applySuspicion(current, event) -> number (clamp 0-100)
      strikes.ts                  applyStrike(state, source) -> state fragment
      endings.ts                  selectEnding(input) -> EndingId
      history.ts                  recordAnswer / getRecall helpers for round 8
      puzzles/
        grid.ts                   validateGrid(selected, correct, ambiguous?) -> GridResult
        timedClick.ts             evalClick(clickMs, windowOpenMs, windowCloseMs, fakeoutDoneFlag) -> ClickResult
        checkbox.ts               nextCheckboxState(state, pointerEvent) -> CheckboxState (dodge count, freeze)
        slider.ts                 evalSlider(value, target, tolerance) -> boolean; shrinkTolerance(t) -> number
        wordChoice.ts             evalChoice(index, correctIndex | branchMap) -> ChoiceResult
        recall.ts                 buildRecallOptions(actualCount) -> number[4]; evalRecall(pick, actual) -> boolean
    audio/
      sound.ts                    initAudio(), play(cue: 'pass'|'strike'|'tick'|'sting'), setEnabled(bool)
    storage/
      persist.ts                  loadBest(), saveBest(n), loadEndings(), addEnding(id), loadSoundPref(), saveSoundPref(b)
    components/
      StartScreen.tsx             fake signup form, verify checkbox, sound toggle, best score
      PlayScreen.tsx              widget frame + HUD + active puzzle by round type
      EndingScreen.tsx            ending copy, score, best, endings found, restart
      Hud.tsx                     round x/10, score, strikes, timer
      SuspicionMeter.tsx          bar + numeric label, color bands 40/75
      DebugPanel.tsx              only rendered when ?debug=1
      puzzles/
        GridPuzzle.tsx            3x3 buttons, emoji/CSS tiles
        CheckboxPuzzle.tsx        dodging checkbox (pointer events)
        TimedClickPuzzle.tsx      verify button with fakeout
        SliderPuzzle.tsx          range input, oversized thumb
        WordChoicePuzzle.tsx      4 text option buttons
        RecallPuzzle.tsx          4 number choices
        FinalPuzzle.tsx           round 10 composite (checkbox phase then word phase)
    styles/
      base.css                    reset, layout, 44px targets, 320px min, widget max-width 420px
      stages.css                  .stage-1 .. .stage-4 mutation (font drift, desaturation, border decay)
      hud.css                     HUD strip, suspicion bar colors + numeric
      reduced.css                 prefers-reduced-motion overrides (no dodge anim, no shake)
  tests/
    grid.test.ts
    timedClick.test.ts
    checkbox.test.ts
    slider.test.ts
    wordChoice.test.ts
    recall.test.ts
    suspicion.test.ts
    strikes.test.ts
    scoring.test.ts
    endings.test.ts
    reducer.test.ts
```

## Core Types (locked, use exactly these names)

```ts
type Phase = 'start' | 'play' | 'ending'
type PuzzleType = 'grid' | 'checkbox' | 'timedClick' | 'slider' | 'wordChoice' | 'recall' | 'final'
type EndingId = 'verified' | 'probablyHuman' | 'ghost' | 'rejected' | 'flagged'
type SuspicionEvent = 'retry' | 'slowAnswer' | 'dodgeMiss' | 'round7Wrong' | 'idle' | 'cleanFastPass'
type StrikeSource = 'wrongSubmit' | 'singleAttemptFail' | 'timerExpiry' | 'earlyClick'

interface RoundDef {
  id: number            // 1-10
  stage: 1 | 2 | 3 | 4
  type: PuzzleType
  timerSec: number      // round 10: counts up, timerSec ignored
  allowRetry: boolean   // true rounds 1-6, false 7-10
  data: unknown         // per-puzzle config object, typed per puzzle module
}

interface GameState {
  phase: Phase
  round: number         // 1-10
  score: number
  strikes: number       // lose at 3
  suspicion: number     // 0-100, lose at 100
  history: RoundAnswer[]  // answers per round; round 8 reads round 1 count
  soundOn: boolean
  ambiguousChoice?: 'bicycle' | 'poster'   // round 3 flavor
  finalChoice?: 'human' | 'trying' | 'matter'  // round 10
}

type Action =
  | { type: 'START_RUN' }
  | { type: 'SUBMIT_ROUND'; result: RoundResult }
  | { type: 'STRIKE'; source: StrikeSource }
  | { type: 'SUSPICION'; event: SuspicionEvent }
  | { type: 'TIMER_EXPIRED' }
  | { type: 'FINAL_CHOICE'; choice: 'human' | 'trying' | 'matter' }
  | { type: 'END_RUN'; ending: EndingId }
  | { type: 'RESTART' }
  | { type: 'DEBUG_SET'; patch: Partial<GameState> }
```

## Rules Reference (from spec, encode in logic modules)

- Score: +100 per pass, +1 per full second remaining, +50 no-retry bonus, round 10 ending bonus 0-200 (ghost +200).
- Suspicion: retry +10, slow answer (under 20% time left) +5, dodge miss +5, round 7 wrong +20, idle over 10s +5, clean fast pass -5. Clamp 0-100. 100 = flagged ending immediately.
- Strikes: 3 = rejected ending immediately. Sources per spec section 7.
- Retry: rounds 1-6 retry with strike. Rounds 7-10 single attempt, fail = strike + advance.
- Endings matrix: verified (clear 10, suspicion < 40, chose human), probablyHuman (clear 10, suspicion 40-99 or chose trying), ghost (chose matter), rejected (3 strikes), flagged (suspicion 100). Ghost overrides suspicion band; test both orders.

---

### Task 1: Scaffold

**Files:** Create `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx` (placeholder shell), `src/styles/base.css`.

- [ ] **Step 1:** `npm create vite@latest . -- --template react-ts` (or manual equivalent inside existing repo). Add Vitest: `npm i -D vitest`.
- [ ] **Step 2:** Set `package.json` scripts: `"test": "vitest run"`, `"dev"`, `"build": "tsc -b && vite build"`, `"preview"`.
- [ ] **Step 3:** `vite.config.ts`: react plugin, `base: '/captcha-hell/'` (Pages readiness; keep `base: '/'` fallback via env if repo name differs).
- [ ] **Step 4:** Run `npm run build`. Expected: pass, empty app.
- [ ] **Step 5:** Commit: `chore: scaffold vite react ts with vitest`

### Task 2: Types + Reducer

**Files:** Create `src/game/types.ts`, `src/game/state.ts`. Test `tests/reducer.test.ts`.

- [ ] **Step 1:** Write failing tests covering: initialState shape; START_RUN sets phase play round 1; SUBMIT_ROUND pass advances round and adds score; STRIKE increments and 3rd strike dispatches END_RUN rejected; SUSPICION event reaching 100 ends run flagged; TIMER_EXPIRED = strike; RESTART returns initial but keeps soundOn; DEBUG_SET patches state.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement `types.ts` exactly per Core Types above; implement reducer minimal to pass.
- [ ] **Step 4:** `npm test` green.
- [ ] **Step 5:** Commit: `feat: game state reducer with strike and suspicion lose paths`

### Task 3: Puzzle Logic Modules (pure, TDD each)

**Files:** Create `src/game/puzzles/{grid,timedClick,checkbox,slider,wordChoice,recall}.ts`. Tests: matching `tests/*.test.ts`.

One sub-cycle per module, same rhythm: failing test, run, implement, run, commit.

- [ ] **grid**: cases: exact match passes; missing cell fails; extra cell fails; ambiguous tile counts as correct with either interpretation and result carries `ambiguousChoice`; round 9 inverted mode passes only when all 9 selected. Commit: `feat: grid validation with ambiguous and inverted modes`
- [ ] **timedClick**: cases: click inside 1.2s window passes; click before window (fakeout not done) = earlyClick strike; click during fakeout flash = earlyClick; click after close fails; window math uses ms timestamps passed in (no Date.now inside logic). Commit: `feat: timed click window eval`
- [ ] **checkbox**: cases: first two pointer attempts dodge (state returns new position, dodgeCount++), third attempt allows check; dodge miss emits suspicion event not strike; reduced-motion variant: single "try again" then allow; round 10 freeze mode: dodges then frozen unclickable, phase advances to word choice. Commit: `feat: dodging checkbox state machine`
- [ ] **slider**: cases: value inside tolerance passes; miss shrinks tolerance by shrink rate; 3rd miss returns strike flag; tolerance never below minimum floor. Commit: `feat: slider tolerance shrink`
- [ ] **wordChoice**: cases: round 7 correct index passes, wrong = suspicion +20 no retry; round 10 branch map maps 3 choices to finalChoice values, all pass. Commit: `feat: word choice eval with branch map`
- [ ] **recall**: cases: buildRecallOptions includes actual count plus 3 distractors, all distinct, shuffle deterministic via seed param; evalRecall true only on actual. Commit: `feat: memory recall from run history`

### Task 4: Scoring, Suspicion, Strikes, Endings

**Files:** Create `src/game/{scoring,suspicion,strikes,endings,history}.ts`. Tests: `tests/{scoring,suspicion,strikes,endings}.test.ts`.

- [ ] **scoring** tests: base 100; +1 per full second left; +50 no-retry; ghost bonus +200. Commit: `feat: score calc`
- [ ] **suspicion** tests: each event delta per Rules Reference; clamp at 0 and 100; decay -5 on cleanFastPass. Commit: `feat: suspicion accrual and decay`
- [ ] **strikes** tests: each StrikeSource increments; 3 = lose. Commit: `feat: strike rules`
- [ ] **endings** tests: full matrix, all 5 endings reachable; precedence: rejected/flagged before round-10 branch; ghost beats suspicion band; verified requires suspicion < 40 AND choice human; probablyHuman covers 40-99 or trying. Table-driven test over input tuples. Commit: `feat: ending selection matrix`

### Task 5: Round Data

**Files:** Create `src/game/rounds.ts`.

- [ ] **Step 1:** Encode ROUNDS[10] per spec section 5 table: type, stage, timerSec (suggest: 20s rounds 1-3, 15s rounds 4-6, 20s rounds 7-9, count-up round 10), allowRetry, per-puzzle data (grid cell emoji sets + correct sets, fakeout config, dodge config, slider target/tolerance/shrink, word options, recall source round).
- [ ] **Step 2:** Test in `tests/reducer.test.ts` addendum: 10 rounds, stages map 1-3/4-6/7-9/10, retry flags correct, all copy strings contain no em-dash or en-dash (regex test over JSON.stringify(ROUNDS) asserting no U+2013 or U+2014 match).
- [ ] **Step 3:** Commit: `feat: 10 round definitions data-driven`

### Task 6: UI Shell + HUD + Screens

**Files:** Create `src/App.tsx` (real), `src/components/{StartScreen,PlayScreen,EndingScreen,Hud,SuspicionMeter}.tsx`, `src/styles/{base,hud}.css`.

- [ ] **Step 1:** App hosts useReducer, renders screen by phase, applies `stage-N` class from round.
- [ ] **Step 2:** StartScreen: fake signup form (name, email, password fields, decorative), "Verify you are human" checkbox starts run, sound toggle, best score from storage.
- [ ] **Step 3:** Hud: round x/10, score, strikes as dots, timer. SuspicionMeter: bar + numeric percent label, class swap at 40/75 (green/yellow/red), never color-only.
- [ ] **Step 4:** EndingScreen: copy per EndingId, score, best score, endings-found list, restart button. Round 10 ending copy per spec section 8.
- [ ] **Step 5:** base.css: single column, widget max-width 420px, min 320px, all interactive targets min 44px, WCAG AA contrast tokens.
- [ ] **Step 6:** Manual check `npm run dev`: start -> play shell -> forced ending renders. Commit: `feat: app shell, screens, hud`

### Task 7: Puzzle Components

**Files:** Create `src/components/puzzles/*.tsx` (7 files per map), `src/styles/stages.css`.

- [ ] **Step 1:** GridPuzzle: 9 buttons with emoji/CSS tiles from round data, aria-pressed toggling, submit button. Keyboard: tab + enter, arrows move focus.
- [ ] **Step 2:** CheckboxPuzzle: pointerdown handler teleports checkbox first two attempts (works on touch), dispatch dodgeMiss suspicion.
- [ ] **Step 3:** TimedClickPuzzle: state machine idle -> fakeout flash -> real green window (timestamps from performance.now passed into pure eval).
- [ ] **Step 4:** SliderPuzzle: native range input, oversized thumb via CSS, submit evaluates.
- [ ] **Step 5:** WordChoicePuzzle + RecallPuzzle: 4 buttons each. RecallPuzzle pulls options from history via recall module.
- [ ] **Step 6:** FinalPuzzle: checkbox freeze phase then 3-choice word phase; timer counts up display.
- [ ] **Step 7:** stages.css: `.stage-1` clean, `.stage-2` slight font-size jitter + 90% saturation, `.stage-3` desaturated + border decay + copy tone class, `.stage-4` heavy decay. All transitions gated behind no-preference media query.
- [ ] **Step 8:** Wire PlayScreen switch over PuzzleType. Full playthrough manually in dev. Commit: `feat: all seven puzzle components with stage decay css`

### Task 8: Timer + Suspicion Wiring

**Files:** Modify `src/components/PlayScreen.tsx`.

- [ ] **Step 1:** Round timer via requestAnimationFrame or 250ms interval; expiry dispatches TIMER_EXPIRED. Round 10 counts up.
- [ ] **Step 2:** Slow-answer detection (submit with under 20% time left) and idle detection (10s no interaction) dispatch SUSPICION events. Idle timer resets on any pointer/key event inside widget.
- [ ] **Step 3:** Manual verify in dev with debug panel (Task 10) or temporary logs. Commit: `feat: timers, slow answer and idle suspicion`

### Task 9: Sound + Persistence

**Files:** Create `src/audio/sound.ts`, `src/storage/persist.ts`. Modify App, StartScreen, Hud, EndingScreen.

- [ ] **Step 1:** sound.ts: lazy AudioContext created on first user gesture; oscillator cues: pass blip (short sine up), strike buzz (square low), suspicion tick, ending sting. Default on, silent until first gesture (autoplay policy).
- [ ] **Step 2:** persist.ts: keys `captchaHell.bestScore`, `captchaHell.endings`, `captchaHell.sound`. JSON parse with try/catch fallback defaults.
- [ ] **Step 3:** Wire: toggle in start + HUD; best score saved on END_RUN; ending added to found set.
- [ ] **Step 4:** Manual verify: toggle persists across reload, best score updates. Commit: `feat: webaudio cues and localstorage persistence`

### Task 10: Debug Panel

**Files:** Create `src/components/DebugPanel.tsx`. Modify App.

- [ ] **Step 1:** Render only when `new URLSearchParams(location.search).get('debug') === '1'`.
- [ ] **Step 2:** Controls: jump to round (1-10), set suspicion, set strikes, force each ending, disable timer checkbox. All via DEBUG_SET / END_RUN dispatch.
- [ ] **Step 3:** Manual verify each control. Commit: `feat: debug panel behind ?debug=1`

### Task 11: Accessibility + Reduced Motion Pass

**Files:** Create `src/styles/reduced.css`. Modify puzzle components as needed.

- [ ] **Step 1:** `prefers-reduced-motion: reduce`: disable dodge animation (checkbox shows "try again" once then allows), no shake/flicker, keep state cues.
- [ ] **Step 2:** Keyboard audit: every puzzle completable with tab/enter/arrows. Fix gaps.
- [ ] **Step 3:** Contrast audit in stage 3-4 palettes against AA.
- [ ] **Step 4:** Commit: `feat: reduced motion and keyboard support`

### Task 12: Verification Gate + QA

- [ ] **Step 1:** `npm test` all green. `npm run build` passes clean.
- [ ] **Step 2:** Browser smoke (Chrome devtools or Playwright manual): full run start to win ending, zero console errors.
- [ ] **Step 3:** Force each of 5 endings via debug panel, screenshot each.
- [ ] **Step 4:** Mobile viewport 320px and 390px: no overflow, all targets tappable, checkbox dodge works via touch (teleport on tap).
- [ ] **Step 5:** Emulate reduced motion (devtools rendering tab): dodge replaced, no shake.
- [ ] **Step 6:** Grep gate: `grep -rnP '[\x{2013}\x{2014}]' src/ index.html` returns nothing.
- [ ] **Step 7:** Commit: `test: qa pass, smoke verified`

### Task 13: Pages Deploy Readiness

**Files:** Create `.github/workflows/deploy.yml`.

- [ ] **Step 1:** Workflow: on push main, `npm ci && npm test && npm run build`, upload `dist/` via `actions/upload-pages-artifact` + `actions/deploy-pages`. Permissions: `pages: write, id-token: write`.
- [ ] **Step 2:** Confirm `base` in vite.config matches repo path. SPA, no router, so no 404 fallback needed.
- [ ] **Step 3:** `npm run preview` locally against built dist, verify asset paths under base.
- [ ] **Step 4:** Commit: `ci: github pages deploy workflow`

---

## Self-Review Notes

- Spec coverage: sections 1-13 all mapped. Section 5 rounds -> Tasks 3/5/7. Section 7 -> Task 4. Section 8 -> Task 4 endings + Task 6 copy. Section 9 -> Tasks 6/7/9/11. Section 10 -> Tasks 2/9. Section 11 -> Tasks 2-5 tests + Task 12 gate. Section 12 -> Task 5 regex test + Task 12 grep.
- Type names consistent across tasks (GameState, RoundDef, EndingId, SuspicionEvent, StrikeSource used verbatim).
- All 5 endings reachable asserted by table-driven test in Task 4.
