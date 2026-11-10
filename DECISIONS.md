# Decisions

One short entry per real decision: what was chosen, why, and what was given up. Newest at the bottom.

## Project

### D1. No per-package build step
**Chose:** packages import each other's TypeScript source through pnpm workspace links. Vite and Vitest compile on the fly.
**Why:** one fewer thing to run and to explain. A change in core shows up in the editor at once.
**Gave up:** packages are not publishable as they are. The demo build in M7 bundles everything, so nothing needs it yet.

### D2. The capture script is built as one plain script file
**Chose:** one IIFE file, injected the same way by Playwright tests and by the extension.
**Why:** the tests then exercise the exact file the extension ships.
**Gave up:** a build step before browser tests (`pnpm test:spike` runs it first).

### D3. Browser tests run in two browsers
**Chose:** Playwright's bundled Chromium and the installed Chrome.
**Why:** the extension runs in installed Chrome, and the two can differ by a version. In M1 they were 158 and 157 and agreed.
**Gave up:** tests take twice as long (about 6 s in total today).

## Data format (locked in M1)

The format is in `packages/core/src/types.ts`. The evidence is in `docs/chrome-findings.md`. These are the changes from the shape in the brief.

### D4. `Track.startOffset`
**Chose:** each track stores when its animation began, in ms after the start of the take.
**Why:** the CSS delay cannot say "this began 180 ms after the first one". Chrome reports `transition-delay` as `timing.delay`, which is a different thing.
**Gave up:** two numbers place a bar on the timeline (start offset and delay), not one. The timeline shows the delay as part of the bar, so both stay visible.

### D5. `Track.groupId`, with unlink
**Chose:** tracks from one animation share a group id and are retimed together. An "unlink" action sets one track's group id to `null`.
**Why:** one `@keyframes` rule or one `element.animate()` call has one timing in the real code. Moving its properties together keeps the export looking like the original. Unlink is there for the case where one property needs its own timing.
**Gave up:** a slightly more complex export. Linked tracks become one `@keyframes` rule, an unlinked track becomes its own.

### D6. `Iterations` is a union, not a number
**Chose:** `{ kind: 'count', count } | { kind: 'infinite' }`.
**Why:** Chrome returns `Infinity`, and JSON cannot hold it. A union also makes "infinite" a case the code must handle.
**Gave up:** nothing.

### D7. `Keyframe.parsed`: numbers read at capture time
**Chose:** next to the CSS string, each keyframe stores a small numeric reading (number, length, percent, color, or a list of transform functions), or `null`.
**Why:** the plain-words description and the Figma payload need numbers. Core has no DOM, and a CSS value parser in core would have to be written twice (TypeScript and Elm). The page is the one place where `var()`, `em` and `%` resolve correctly.
**Gave up:** one more field per keyframe, and a second copy of each value that must agree with the string. See D8 for why that is safe in v1.

### D8. Keyframe values are read-only in v1
**Chose:** edits change easing and timing only. They never change a keyframe's `value`.
**Why:** it keeps the editor small, and it is what "re-tune an animation" means for v1.
**What depends on this:**
- `Keyframe.parsed` stays correct after any edit, because the value it was read from never changes.
- The fallback for slow previews (sample each segment once into a lookup table) is only valid while values never change.
**Cost of adding value editing later:** `parsed` must be read again in the editor after each value edit (through the probe, or a parser), and any lookup table must be thrown away when a value changes.

### D9. Transforms are stored as a list of functions, never as a matrix
**Chose:** `{ kind: 'transform', functions: [...] }`, read with CSS Typed OM (`CSSStyleValue.parse`).
**Why:** a matrix turns `rotate(360deg)` into "no rotation", so a loader would be described as not moving. Chrome keeps the function list in keyframes for transitions, CSS animations and `element.animate()` alike, so no matrix is ever needed. A test asserts the loader's rotation reads as 360 degrees.
**Gave up:** 3D functions, `matrix()` and `perspective()` get `parsed: null`. They are still previewed (preview uses the CSS string), but the description says less about them.

### D10. `Keyframe.implicit`, filled from pick-time values
**Chose:** when `element.animate()` leaves out the start or end keyframe, capture fills it from the resting value read at pick time, and marks it `implicit: true`.
**Why:** Chrome does not add the missing keyframe for `element.animate()` (it does for CSS animations). Reading computed style while the animation runs returns the animated value: the spike read `0.2` where the resting value was `0.9`. The pick-time read gave `0.9`.
**Gave up:** if the property was already animating at pick time, the resting value cannot be known, and the track goes to `notShown`. If the page changes the resting style between pick and trigger, the value is stale.

### D11. `Track.interrupted`, and takes split on interruption
**Chose:** when a property that is still running on an element is restarted, the take ends and a new one begins. A transition is marked `interrupted` when it ends at the value the replaced one started from.
**Why:** hover-in and hover-out in one take would put two tracks on one property. The reversal case is the only one where the browser shortens the duration, so the UI can say "shortened by the browser" and not present 116 ms as the authored duration.
**Gave up:** a quick in-and-out hover produces two takes. A transition interrupted towards a third value starts mid-way but is not marked.

### D12. No `composite` in the format
**Chose:** animations with `composite: add` or `accumulate` go to `notShown`.
**Why:** no fixture produced one, and they are rare on real sites. Keeping the format small matters more.
**Gave up:** additive animations are listed, not drawn. Revisit if the real-site pass in M6 shows them.

### D13. Both easing levels stay in the format
**Chose:** `Timing.easing` (whole effect) and `Keyframe.easing` (per segment), as in the brief.
**Why:** Chrome uses the effect easing for transitions and the keyframe easing for CSS animations. `element.animate()` can use both at once.
**Gave up:** the curve editor needs a rule for which one it edits: the effect easing for transitions, the keyframe easing of the selected segment otherwise.

### D14. Tracks are per longhand property
**Chose:** a `border-radius` transition is four tracks, as Chrome reports it.
**Why:** staying true to the data. Corners can differ.
**Gave up:** the timeline and the description must group them again ("the corners round to 50%"). That grouping is a pure function in core.

### D15. `iterationStart` and `endDelay` are not in the format
**Chose:** an animation with either set to something other than zero goes to `notShown`.
**Why:** both are rare and cannot be written in CSS.
**Gave up:** those animations are listed, not drawn.
