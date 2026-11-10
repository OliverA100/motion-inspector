# Notes for later milestones

Things agreed in review that belong to a milestone not yet started.

## M5. Capture (done)

Before writing the real capture code:
1. Add fixtures for:
   - an animation on a pseudo-element (`::before` or `::after`),
   - an animated element inside an open shadow root,
   - a scroll-driven animation (`animation-timeline: scroll()` or `view()`).
2. Record them with the spike and add one assertion per finding to `tests/spike.spec.ts`: what `effect.pseudoElement` holds, whether `getAnimations({ subtree: true })` on the host sees into the shadow root, and what `animation.timeline` is for a scroll-driven animation.
3. Write the results into `docs/chrome-findings.md`.

Rules already decided, to implement in M5:
- Take splitting and `Track.interrupted` (DECISIONS.md, D11).
- Missing keyframes filled from pick-time resting values (D10).
- `startOffset` from `startTime` after `animation.ready` (D4).
- Regenerate the sample captures in `packages/core/test/samples.ts` from real capture output, and fail a test if they drift.

## M6. Extension

The capture script already exposes what the extension needs on `window.MotionCapture`:
- `pickAndRecord(onTake)` shows the picker, then records the picked element. Resolves `true`, or `false` if picking was cancelled.
- `cancelPicking()`, `stop()`.
- Each take is `{ capture, problems, raw }`. `raw` and `problems` are for the "Copy debug report" button.

Still to decide in M6: how takes travel from the page to the side panel (the capture is plain JSON, so `chrome.runtime` messages work as they are).
