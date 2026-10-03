# Reduced Motion Propagation Implementation Plan

> **For Hermes:** Luna implements, Sol verifies and releases.

**Goal:** Honor manual or OS reduced motion consistently in checkbox rounds and root CRT effects.
**Architecture:** Derive effective reduced preference = manual OR OS using native matchMedia subscription; propagate through existing Puzzle and FinalPuzzle and reuse existing stationary nextCheckboxState branch. Minimal CSS root pseudo selector correction. No dependencies or refactor.
**Tech Stack:** Existing React/TypeScript/CSS; external Playwright regression.

User said continue after timer release; select next audited accessibility bug, not new mechanics. Timed-click remains separate future slice.

1. Read all touched App/CSS and nextCheckboxState callers. Create scripts/motion-regression.mjs using PLAYWRIGHT_MODULE and BASE_URL as existing timer script. RED before source edits on final manual reduced and round2 OS reduced.
2. Derive live OS preference safely, subscribe to changes/cleanup. Manual OR OS reduction controls all motion behavior including final checkbox, cursor trail and root CSS class. Preserve user's manual choice if OS toggles. Pass effective preference into FinalPuzzle instead of hardcoded false. Update CSS to disable root ::before/::after in manual reduced mode.
3. Regression GREEN matrix manual/OS/both/full, round2 and10: reduced offsets zero for every activation; final freezes/three choices and endings still reachable; full mode retains original dodges. Runtime OS changes update behavior; root flicker animation none under reduction. Keyboard/native touch activation, no horizontal overflow at 320/390 widths.
4. npm test/build/diff check; timer regression unchanged green; parent production preview mobile/full/motion QA and review, then commit/push main and verify Pages + live.

Owned App.tsx/styles.css, scripts/motion-regression.mjs, README runnable command. No puzzle timings, slider policy, score/endings logic, dependency, permission/camera/files/windows changes. No worker commit/push/deploy.
