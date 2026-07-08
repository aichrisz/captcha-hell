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

## Features

- 10 escalating CAPTCHA rounds
- Grid, checkbox, timed click, slider, word choice, recall, and final statement puzzles
- Score, strikes, suspicion, timer, and branching endings
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
