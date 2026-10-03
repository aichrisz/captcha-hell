# Captcha Hell

A browser game where CAPTCHA stops proving you are human and starts questioning what human means.

## Play

Live after GitHub Pages deploy:

https://aichrisz.github.io/captcha-hell/

## Local

```bash
npm install
npm test
npm run build
npm run dev
```

## Timer regression

With the app available at `http://127.0.0.1:4193/captcha-hell/` and Playwright installed separately, run:

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs BASE_URL=http://127.0.0.1:4193/captcha-hell/ node scripts/timer-regression.mjs
```

`PLAYWRIGHT_MODULE` must point to an installed Playwright module; this regression adds no project dependency.

## Reduced-motion regression

With the app available at `http://127.0.0.1:4193/captcha-hell/` and Playwright installed separately, run:

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs BASE_URL=http://127.0.0.1:4193/captcha-hell/ node scripts/motion-regression.mjs
```

`PLAYWRIGHT_MODULE` must point to an installed Playwright module; this regression adds no project dependency.

## Features

- 10 escalating CAPTCHA rounds
- Grid, checkbox, timed click, slider, word choice, recall, and final statement puzzles
- Score, strikes, suspicion, timer, and branching endings
- Once-per-run appeal: trade 50 points to remove up to 20 suspicion
- Sound toggle with WebAudio cues
- Best score in localStorage
- Debug controls via `?debug=1`
- Mobile friendly controls and reduced motion support

### v2 polish

- Humanity meter that trusts mistakes more than precision
- Secret ending for runs that look too perfect
- Fake intrusion theater: in-app popups, webcam analysis text, consulted file names
- All intrusions are copy only: no camera, no file system, no permissions, no real windows
- Cursor lag trail and CRT glitch treatment when motion is full, calm fallback when reduced
- Copy result button with a shareable plain text ending card
- Rotating bureaucratic flavor copy in the notes panel
