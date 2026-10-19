# Rhythm Tool 4.0

Accessible rhythm practice, hosted on GitHub Pages. Buildless HTML/CSS/JavaScript; no runtime dependencies, account, tracking, or remote speech service for standard counts.

## Run

Serve this directory with `python -m http.server 8000`, then open http://localhost:8000.
Run regression tests with `node tests/regression.cjs`.

## Features

- 1–300 BPM, live tempo adjustment, tap tempo, 1–8 beats per measure, sixteenth-note editing.
- Editable symbols/text, arrow colors, beat-number display, and independent off / hear / display / both behavior for every step.
- Six synthesized sound voices with frequency, level, duration, attack, release, waveform and preview controls.
- Custom spoken text for every step; Off, Beats only, or All custom counts.
- Precisely scheduled sampled speech for 1–8, e, and, a, up, down, rest, change, ready (including numeric and arrow aliases). Words accelerate as needed to fit the next spoken step; extreme subdivision speeds reduce intelligibility.
- Other custom phrases use browser speech. This fallback is best effort: browser synthesis is not clock-schedulable and may skip while a previous phrase is speaking. It is never used for standard counts.
- Count-in, master volume, beat strip, next visible cue, calm visuals, reduced-motion support, keyboard transport, practice presets, and screen wake lock when available.
- Local automatic saving, versioned Unicode-safe sharing, and backward-compatible original compact-code import.
- WAV export includes tones and standard spoken counts, at master volume. Custom browser speech and count-in are excluded.

## Timing and accessibility decisions

Web Audio schedules both tones and sampled counts using the same timestamps, with a 25 ms scheduler and 150 ms lookahead. Visual updates use the output timestamp when supported. Stop cancels scheduled sources and visuals; async startup has a generation guard. Late scheduling skips missed events instead of catching up in a burst. Playback pauses when the page is hidden because mobile/background execution cannot guarantee timing. No unrelated pulse animations or high-frequency live-region announcements.

Changing beats per measure preserves steps that still fit. Pattern presets intentionally replace the current steps. Settings import validates the entire payload before changing state. New codes preserve custom display text, speech, full volume values, display mode and practice preferences; older codes never contained custom display text.

## Voice samples

`voice-bank.js` contains pre-rendered 16 kHz PCM counts generated with CMU Flite's SLT voice through FFmpeg, trimmed and accelerated before embedding. Playback uses Web Audio, not the operating system speech queue. No library executable is shipped. See `VOICE-NOTICE.txt` for the installed Flite distribution's notices.

## Verification

`tests/regression.cjs` exercises shared-code round trips, old fixed-padding imports, malformed settings, HTML escaping, spoken-text spaces, asynchronous audio resume, sampled speech fitting at 60/120/180/300 BPM, missed-beat recovery, matching voice/tone timestamps, stop and rapid restart cancellation, and WAV headers with a deterministic audio/DOM test double. Actual device latency and subjective intelligibility still require listening on the target device.
