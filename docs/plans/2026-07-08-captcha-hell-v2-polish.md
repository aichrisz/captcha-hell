# Captcha Hell v2 Polish Plan

## Goal
Add all post-v1 polish ideas requested by Abel while keeping the app static, mobile friendly, and reliable on GitHub Pages.

## Scope
- Humanity meter in addition to suspicion.
- Secret ending for runs that are too perfect or too robotic.
- Fake system intrusion illusions that are browser-safe only:
  - fake cursor lag visual trail, not real cursor control
  - fake popups inside the app
  - fake webcam analyzing text only, no camera access
  - fake file names only, no file system access
- Stronger CRT/glitch/bureaucratic horror treatment, with reduced motion safe fallback.
- Shareable ending text with a real Copy result button.
- More weird prompt bank / rotating flavor copy.
- Tests for new pure logic where practical.

## Constraints
- No backend.
- No real browser permission prompts.
- No real webcam/file/system access.
- Keep Vite base `/captcha-hell/`.
- No visible em dash or en dash characters.
- Keep `npm test`, `npm run build`, `npm audit --audit-level=moderate` clean.
- Browser smoke test live and local with zero JS errors.

## Suggested implementation
1. Add `src/game/humanity.ts` for derived humanity score and secret ending predicate.
2. Extend `EndingId` and `ENDING_COPY` with `tooPerfect` or similar.
3. Update ending selection so a high score, zero strike, low suspicion run can unlock the secret ending.
4. Add `src/game/intrusions.ts` with deterministic fake intrusion events by round/stage.
5. Update UI to render:
   - Humanity meter
   - intrusion tray
   - fake popups
   - fake scan/file readout
   - cursor trail overlay when motion is full
   - share ending card and copy button
6. Update CSS for CRT scanlines, glitch accents, popups, and responsive layout.
7. Update README with v2 features.
8. Add/extend tests for humanity, intrusion data, ending copy, dash gate.
9. Verify and deploy.
