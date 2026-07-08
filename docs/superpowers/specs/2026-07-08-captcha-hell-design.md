# Captcha Hell - Design Spec

Date: 2026-07-08. Status: approved for build. Doc only, no code.

## 1. Premise

Player fills mundane web form ("Create Account"). CAPTCHA widget guards submit. Widget starts normal, escalates into absurd existential puzzles. CAPTCHA stops proving player is human, starts questioning what human means. Tone: funny, tense, tactile, bureaucratic-uncanny. No gore, no jumpscares, no neon cyberpunk.

## 2. Core Loop

1. Round starts. Widget shows challenge + instruction text + timer.
2. Player interacts (tap cells, drag slider, click, type, recall).
3. Submit or timer expiry.
4. Result: pass (score up, next round) or fail (strike, suspicion up, retry or advance per round rules).
5. HUD updates: score, strikes, suspicion meter, round indicator.
6. After round 10 or fail condition: ending screen. Best score saved to localStorage.

Session target: 5-10 minutes per run. Replay encouraged by endings + best score.

## 3. Screens

- **Start**: fake signup form, "Verify you are human" checkbox begins run. Sound toggle, best score shown.
- **Play**: verification widget center, HUD strip (round x/10, score, strikes, suspicion bar, timer).
- **Ending**: one of 4+ endings, score, best score, restart button.
- **Debug panel** (?debug=1): jump to round, set suspicion/strikes, force ending, disable timer.

## 4. Stages

| Stage | Rounds | Vibe |
|---|---|---|
| 1 Normal | 1-3 | Standard CAPTCHA. Clean widget. Player feels safe. |
| 2 Off | 4-6 | Small wrongness. Instructions drift, UI misbehaves slightly. |
| 3 Absurd | 7-9 | Puzzles about player, not images. Widget openly suspicious. |
| 4 Existential | 10 | Final judgment. Widget asks player to prove humanity means anything. |

Visual mutation per stage: font drift, palette desaturation, widget border decay, copy tone shift from corporate to accusatory. All via CSS class per stage, reduced-motion safe.

## 5. Rounds (10)

| # | Type | Challenge | Pass | Twist |
|---|---|---|---|---|
| 1 | Grid select | "Select all traffic lights" 3x3 image grid | Correct cells | None. Honest round. Tutorial by stealth. |
| 2 | Fake checkbox | "I am not a robot" checkbox | Click it | Checkbox dodges cursor twice, then allows. Misses count as suspicion +5, not strike. |
| 3 | Grid select | "Select all bicycles" | Correct cells | One tile ambiguous (bicycle poster). Either interpretation passes, choice logged, feeds ending flavor. |
| 4 | Timed click | "Click verify button when it turns green" | Click within window (1.2s) | Button flashes green fake-out once first. Early click = strike. |
| 5 | Slider align | "Align slider to complete image" | Land in tolerance zone | Tolerance shrinks after each miss. 3 misses = strike. |
| 6 | Grid select | "Select all images containing humans" | Correct cells | Grid includes mirror tile ("you?") and robot-with-hat. Mirror tile is correct answer. First self-referential beat. |
| 7 | Word/logic | "Which of these would a human choose?" 4 text options | Pick the flawed-human option (e.g. "cry at song", not "optimize response latency") | Wrong pick = suspicion +20, no retry. |
| 8 | Memory recall | "In round 1, how many traffic lights did you select?" 4 choices | Actual recorded count | Game recorded real answer. Uses player's own history against them. |
| 9 | Grid select inverted | "Select all cells that do NOT contain proof you exist" blank/abstract 3x3 | Select all 9 (nothing proves it) | Partial select = retry with mocking copy. Second wrong = strike. |
| 10 | Composite final | "Final verification: prove you are human" - fake checkbox that runs away, then freezes; then one word choice: "I am human" / "I am trying" / "Does it matter" | Any choice passes round; choice picks ending branch | Timer counts UP not down. Suspicion carried into ending selection. |

Retry rules: rounds 1-6 allow retry after fail (with strike). Rounds 7-10 single attempt (fail = strike + advance).

## 6. Puzzle Types (systems)

- **Grid selection**: 3x3, tap toggles cell, submit validates set. Data-driven: cell list + correct set + ambiguous set per round.
- **Timed click**: window open/close timestamps, fake-out flag.
- **Fake checkbox**: dodge count, dodge distance, freeze behavior.
- **Slider align**: target value, tolerance, shrink rate.
- **Word/logic choice**: options list, correct index or branch map.
- **Memory recall**: reads run history log (answers stored per round in state).

All puzzle logic pure functions (input state + action -> result), UI thin. Enables Vitest coverage without DOM.

## 7. Scoring, Strikes, Suspicion

- **Score**: base 100 per pass. Speed bonus: +1 per full second remaining. No-retry bonus +50. Round 10 choice adds 0-200 by ending.
- **Strikes**: 3 max. 3rd strike = instant lose ending. Strike sources: wrong submit (rounds 1-6 after retry), single-attempt fail (7-10), timer expiry, early click (round 4).
- **Suspicion**: 0-100 meter. Sources: retries +10, slow answers (under 20% time left) +5, checkbox dodge misses +5, round 7 wrong +20, idle over 10s in a round +5. Decay: -5 per clean fast pass. At 100 = instant "Flagged" lose ending regardless of strikes.
- Score, strikes, suspicion all visible in HUD at all times. Suspicion bar changes color (green/yellow/red) at 40/75.

## 8. Endings (4+)

| Ending | Trigger | Tone |
|---|---|---|
| **Verified** | Clear round 10, suspicion < 40, chose "I am human" | Win. Widget stamps approval, then quietly asks "for now". Best score highlight. |
| **Probably Human** | Clear round 10, suspicion 40-99 or chose "I am trying" | Soft win. Provisional certificate, expiry date today. |
| **Ghost in the Form** | Clear round 10, chose "Does it matter" | Secret win. Widget admits it is not sure it is a program either. Bonus +200. |
| **Rejected** | 3 strikes | Lose. Form resets, name field now reads "UNIT". |
| **Flagged** | Suspicion hits 100 | Lose. "Your behavior has been reported to yourself." |

Ending screen shows score, best score, which endings found (localStorage set), restart.

## 9. Mobile, Accessibility, Sound

- **Touch**: all targets >= 44px. Grid cells large, slider thumb oversized. No hover-dependent logic (checkbox dodge uses pointer events, works on tap: teleports on first two taps).
- **Layout**: single column, widget max-width ~420px, works 320px up.
- **Reduced motion**: prefers-reduced-motion disables dodge animation (checkbox instead shows "try again" once), disables shake/flicker effects, keeps color/state cues.
- **Contrast**: text meets WCAG AA even in decayed stages. Suspicion never conveyed by color alone (numeric label).
- **Keyboard**: all puzzles operable via tab/enter/arrows.
- **Sound**: WebAudio only, no assets. Cues: pass blip, strike buzz, suspicion tick, ending sting. Toggle in start screen + HUD, persisted to localStorage. Default off until first toggle? No: default on, muted until first user gesture (autoplay policy).

## 10. State + Persistence

Single reducer: phase (start/play/ending), round index, score, strikes, suspicion, run history (answers per round for round 8 + ending flavor), sound on/off. localStorage: bestScore, endingsFound, soundPref. No backend.

## 11. Testing

- **Vitest, pure logic**: grid validation, timed-click window math, slider tolerance shrink, suspicion accrual/decay, strike rules, ending selection matrix (all 5 endings reachable), score calc, round 8 recall correctness.
- **Build gate**: npm test and npm run build must pass.
- **Browser smoke**: full run start to any ending, zero console errors, mobile viewport check, reduced-motion check, ?debug=1 jump works.

## 12. Copy Rules

No em-dash, no en-dash anywhere in UI copy or code strings. Hyphen only. Corporate-polite early, accusatory-weird late. Short lines, fits widget.

## 13. Out of Scope

Backend, accounts, leaderboards, image assets beyond simple CSS/emoji/SVG tiles, i18n, more than 10 rounds.
