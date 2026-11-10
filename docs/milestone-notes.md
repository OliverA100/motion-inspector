# Notes for later milestones

Things agreed in review that belong to a milestone not yet started.

## M5. Capture

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
