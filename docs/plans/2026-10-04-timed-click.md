# Timed Click Window Implementation Plan

> **For Hermes:** Luna implements; Sol verifies and releases with Astra review.

**Goal:** Connect round 4 UI to its existing configured timing and evalClick validator, restarting timing on retry.
**Architecture:** Pass TimedClickData and attempt identity to existing TimedClick. Use performance.now-relative timestamps and existing evalClick; native button remains accessible. Minimal attempt-local effect cleanup/reset, no blanket puzzle remount, dependencies or abstraction.
**Tech Stack:** Existing React/TS/Vitest and external Playwright regression.

User approved continuation through deployment after identifying timed-click as remaining bug.

1. Trace full timedClick pure config/evaluator/UI/reducer flow and strike sources. Write scripts/timed-click-regression.mjs (PLAYWRIGHT_MODULE/BASE_URL as other regression scripts). RED against UI accepting 2500ms and 6000ms and readiness not reset on retry, before source changes.
2. Use configured fakeout delay/flash, real gap/window: fake 1600..2050ms, real inclusive 3450..4650ms for current config. Fake flash must be textually distinguished (not color-only), real ready text and expired status. Validation authoritative via elapsed time/evalClick, not React display state. Early/fakeout -> earlyClick strike; late -> existing wrongSubmit strike. Both cause existing reducer retry handling. Reset schedule on attempt change; clear phase timeouts on retry/unmount. Preserve countdown, scoring, humanity/suspicion, reduced motion and sound/appeal behavior.
3. Browser GREEN: early 1000/2500, fake flash, inclusive open/close boundaries, late6000, retry restarts fake/real schedule; pointer/touch and keyboard valid activation. Timer expiry remains one strike. Reduced motion no pulse; no overflow 320/390. Pure eval tests preserved/extended only if necessary.
4. npm test/build/diff check, all timer/motion regressions and new browser script against build preview, read-only review, then parent commit/push main, Pages success, and live browser readback.

Owned src/App.tsx, scripts/timed-click-regression.mjs, README; existing timedClick.test.ts only if needed. Do not change config/other puzzle mechanics/slider/permissions/intrusion/dependencies. Worker no commit/push/deploy. Parent owns release.
