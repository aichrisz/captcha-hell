# Timer Expiry Ownership Implementation Plan

> **For Hermes:** Luna implements; Sol verifies exact diff and browser result, Astra reviews if needed.

**Goal:** One elapsed round timer produces exactly one penalty and never consumes the next attempt/round's time.
**Architecture:** Correct timer reset/expiry identity in existing App effects; keep reducer strike arithmetic and puzzle retention unchanged. No dependency or timer abstraction unless unavoidable.
**Tech Stack:** Existing React/TS/Vitest; external installed Playwright for a runnable browser integration regression.

## Approved scope
Fix duplicate expiry only. Existing reproduction: round 1 after 20s has 2 strikes; round 7 timeout skips round 8. Old zero captured in the same render as new round/attempt is incorrectly processed. No timed-click, reduced-motion, slider-policy or feature changes.

## Tasks
1. Read full App timer flow, all dispatch callers, reducer, tests. Add runnable real-browser regression at scripts/timer-regression.mjs using externally supplied Playwright module and target URL (do not add dependency). First run RED against current code and save actual failure evidence outside repo.
2. Minimal App.tsx lifecycle ownership fix: time belongs to current round/attempt/run; stale zero from old identity cannot expire the new one. Remove strikes from expiry identity. Preserve 1-second display/countdown and audio, full time for retry/new round, final untimed, sound/appeal re-renders, valid submission transition, ending/restart. Do not remount puzzles or alter retention.
3. Browser regression GREEN: first/second expiry round 1 each exactly one strike; third ends; round 7 goes only to 8; all timed rounds covered (debug setup allowed), no expiry from stale zero after transition; restart returns full timer; final remains untimed; appeal/sound no extra penalties. Include zero-boundary transition checks with explicit reproducible event ordering.
4. npm test, npm run build, git diff --check; Sol reruns integration against built preview, 320/390px mobile and desktop, captures JS errors and overflow. Review full diff, then commit/push main and verify SHA/Pages/live integration only after green.

## Boundaries
Owned source App.tsx; new single browser regression script and README command if useful. No runtime/build dependencies, unrelated edits, global config, permissions/camera/files/window intrusion. No worker commits/push/deploy. Parent handles release.
