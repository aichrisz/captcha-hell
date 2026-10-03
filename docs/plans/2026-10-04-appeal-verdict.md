# Appeal Verdict Implementation Plan

> **For Hermes:** Implement this thin slice with Luna, then Sol reviews and verifies.

**Goal:** Add the user-approved once-per-run score-for-suspicion trade without changing strikes, rounds, timers, or ending rules.

**Architecture:** One reducer action and one GameState boolean; native button and existing live feedback. No new runtime dependency, abstraction, persistence, puzzle, or intrusion.

**Tech Stack:** Existing React, TypeScript, CSS, Vitest.

## Design and acceptance
- Appeal costs 50 score and removes 20 suspicion, clamped at zero.
- Available only during play, with score >= 50, suspicion > 0, and not previously used this run.
- Invalid/repeated actions return the unchanged state. Never resurrect an ended run.
- Success marks appealUsed, leaves strikes/history/round/attempt untouched, and does not restart the timer.
- START_RUN and RESTART reset availability; existing sound preference remains preserved.
- Show explicit cost/effect beside the gameplay action. Native disabled state and text explain insufficient score, no suspicion, or already-used status. Success is announced politely.
- Existing humanity is derived normally from updated score/suspicion; ending rules and fake text-only intrusion remain unchanged.
- Keep reduced-motion behavior; 44px touch target, no horizontal overflow at 390px and 320px.

## Task 1: Regression then reducer
Modify src/game/types.ts and src/game/state.ts; extend src/game/state.test.ts.
First add cases for successful appeal, clamping, insufficient score, zero suspicion, start/ending phases, repeat dispatch, timer/round/history preservation, and reset. Run npm test -- src/game/state.test.ts and capture the expected RED failure. Then add appealUsed=false, APPEAL_VERDICT action and the minimal reducer guard/update. Run focused tests GREEN.

## Task 2: Native UI
Modify src/App.tsx only (CSS only if required by measured layout). Render the appeal button near the puzzle controls, cost/effect and availability feedback. Dispatch only APPEAL_VERDICT, with success message through existing aria-live output. Do not modify timer dependencies or puzzle keys. Update README feature list.

## Task 3: Verification and release
Run npm test, npm run build, git diff --check. Sol inspects the full diff and exercises production preview on mobile: disabled before eligibility, successful trade, second use disabled, timer continuity, reset, endings and reduced-motion; smoke desktop and capture console errors/overflow/target geometry. No publish until these gates pass. Commit and push verified changes to main, then read back remote SHA and Pages workflow/live result.
