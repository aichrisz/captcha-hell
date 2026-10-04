# Mobile Play Surface Implementation Plan

> **For Hermes:** Luna implements; Sol verifies; Astra reviews the approved design against the diff.

**Goal:** Ship user-approved Approach A from the Astra mobile audit through verified deployment.
**Architecture:** CSS-first existing layout repair and narrow presentation hooks in App.tsx; no new game state/mechanics/dependencies. Existing timer/puzzle/score/intrusion logic remains unchanged.
**Tech Stack:** React, native CSS, existing Vitest and external Playwright.

## Approved spec
Authoritative detailed scope and acceptance: /root/.hermes/cache/scratch/captcha-mobile-audit/proposal.md Approach A (lines120-131) and gates163-178. User approved A through deploy. Do not implement Approach B.

## Task 1: Browser RED
Create scripts/mobile-regression.mjs using PLAYWRIGHT_MODULE and BASE_URL per current scripts. Assert actual geometry/ancestor clipping/requested viewport (not innerWidth alone), compact HUD, stable timed action, popup scrolling, all ending headings. Run against unmodified code and capture expected failures before source edits. Reuse original184 screenshots and geometry as evidence, not mocks.

## Task 2: Minimal presentation repair
Own src/styles.css and narrow src/App.tsx hooks only. Mobile HUD3 columns <=160px sticky with safe-area offset; short-landscape <=64px, keep timer visible. Compact play title/widget/grid and stable timed status, maintain labels/44px targets. Compact named Appeal wrapper <=120px keeping cost/eligibility. Both checkbox raw offsets supplied as CSS variables, mobile bounded movement with clearance, no nextCheckboxState changes. Bound scrollable popup area with no translated offscreen dismiss controls and unobscured timer. Constrain cards and wrap all ending titles. Desktop baseline unchanged. No blanket smooth scroll/puzzle remount; report natural-transition blocker if density alone insufficient.

## Task 3: Regression GREEN and compatibility
Correct motion-regression overflow comparisons to requested viewport and add computed checkbox containment; raw-offset assertions remain valid for stored state and desktop. Run mobile matrix320x740,390x844,412x915,915x412,1440x1000 full/reduced. Each grid+Verify fits390/412;320 full first row and<=200px scroll, timer visible. Timed action entire hit area on entry all portrait/landscape with<=1px phase position drift. Check natural transitions, popup accumulation/dismiss reachability, slider/choices/final, all6 endings/share fallback,200% text reflow. Save before/after screenshots and measurements. All game rules/intrusion privacy unchanged.

## Task 4: Parent release
npm test/build/diff-check; timer/motion/timed-click/mobile browser scripts against freshly built preview. Sol inspect full diff and screenshots, Astra read-only review. Correct gaps before commit/push main; verify remote SHA, Pages CI and same live regression matrix.

No packages/lockfiles/config/game logic/other features. Worker no commit/push/deploy. README optional only portable regression command if needed. Test expansion remains one browser script, not a new framework.
