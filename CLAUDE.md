# Captcha Hell

## Goal
Build a polished one-day browser game where CAPTCHA challenges escalate from normal image picking into absurd existential UI puzzles.

## Core hook
A puzzle game where CAPTCHA stops proving you are human and starts questioning what human means.

## Visual direction
Clean verification widget plus bureaucratic web form, slowly mutating into uncanny absurdity. Not neon cyberpunk. No gore. No jumpscares. Funny, tense, tactile.

## Stack
Vite + React + TypeScript. Native CSS. Pure game logic tests with Vitest. No backend. localStorage for best run.

## MVP acceptance criteria
- Single-page game with start, play, ending screens.
- 9+ CAPTCHA rounds across escalating stages.
- Multiple puzzle types: grid selection, timed click, fake checkbox, slider alignment, word/logic choice, memory recall.
- Score, strikes, suspicion meter, timer, round indicator.
- Lose condition after too many strikes or suspicion reaches 100.
- Win condition after clearing final absurd challenge.
- At least 4 endings.
- Touch/mobile friendly, 44px targets.
- Reduced motion support.
- Sound toggle with simple WebAudio cues.
- localStorage best score.
- Debug panel via ?debug=1.
- npm test and npm run build pass.
- Browser smoke test has zero JS errors.

## Copy constraints
No visible em-dash or en-dash characters. Use hyphen only.

## Reporting
Concise Indonesian summary for Abel. Include real verification output only.
