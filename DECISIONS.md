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
**Where it comes from:** `animation.startTime`, read after `animation.ready` resolves, minus the earliest start time in the take. Measured in M2: for a running animation this equals "timeline time minus `currentTime`", and for a new one it is up to two frames more accurate than the time it was first seen.
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
**Gave up:**
- If the property was already animating at pick time, the resting value cannot be known, and the track goes to `notShown`.
- The stale case: if the page changes the element's resting style between pick and trigger (for example a class is toggled first), the filled keyframe shows the old resting value. Nothing detects this. It is listed in the README's known limits.

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

## Core (M2)

### D16. `Shape.label` added after the format was locked
**Chose:** each shape carries a short name built from its tag and first class, such as `button.primary`.
**Why:** writing the description, the "Copy for AI" table and the CSS export all needed a way to name a shape, and an id like `item-2` means nothing to a reader. It is never text content from the page.
**Gave up:** the format grew by one field one milestone after it was locked. A label is not a reliable selector for child shapes, so the CSS export says "number 2 of 4" when several shapes share one.

### D17. Sampling returns a position, not a value
**Chose:** `sampleTrack(track, timeMs)` returns the segment and the progress within it. It does not return a CSS value.
**Why:** working out a value between `translateY(-6px) scale(1.03)` and `none` needs a CSS engine. The browser has one, so the editor's probe does that part. Core stays free of the DOM and small enough to port to Elm.
**Gave up:** core alone cannot say "the box is at -3.2 px at 150 ms". Only the editor can.

### D18. Results are kept finite by saturating
**Chose:** every number that leaves the easing and sampling code is passed through `saturate`: NaN becomes 0, and anything beyond plus or minus 1e9 is clamped.
**Why:** valid data can be extreme (a bezier handle at 1e300, two keyframes 1e-300 apart), and the math then overflows. The alternative was to add upper limits to every constructor, which would reject data Chrome accepts.
**Gave up:** for absurd inputs the result is a clamped number, not the mathematically right one. No real animation gets near the limit.

### D19. Speed is measured between two nearby points
**Chose:** `easingSpeed` evaluates the easing just before and just after the input and divides.
**Why:** it works the same way for every easing kind, and never divides by zero. The exact derivative of a bezier divides by a slope that can be zero.
**Gave up:** the result is an approximation (step 0.001). It is used to draw a graph, where that cannot be seen.

### D20. Reference values come from Chrome, not from memory
**Chose:** `tests/reference-values.cjs` asks Chrome what the named easings return, inside and outside 0 to 1, and the easing tests pin those numbers.
**Why:** the first version of the tests used values written from memory, and two of them were wrong. The implementation was right.
**Gave up:** nothing. The script is kept so the numbers can be reproduced.

### D21. What the CSS export does when CSS cannot say it
**Chose:**
- A transition is written as a `transition` declaration, with the start and end values in a comment. The tool does not know the trigger (hover, a class), so it does not invent a selector for the end state.
- `startOffset` is added to the delay, because CSS has no other way to start one animation after another.
- An easing over the whole effect is written as the keyframe easing when the track has 2 keyframes, where the two mean the same. With more keyframes CSS cannot express it, and the export says so in a comment.
- `@keyframes` rules are named `motion-1`, `motion-2`. Rules with the same content are written once and shared.
**Why:** each of these keeps the export honest about what it knows.
**Gave up:** the export is not always paste-and-run. The original animation names are not kept, because the format does not store them.

### D22. The description is built from fixed rules
**Chose:** one sentence per shape from `Keyframe.parsed`, one about pacing from sampling the curve at 101 points, one about repeats. Shapes that do the same thing are merged ("Each of the 4 ... one after another, 60 ms apart").
**Why:** the output is predictable and testable. The tests pin the full sentence for every sample capture.
**Gave up:** it reads plainly, and a shape is named by its label, not by a word like "card". When a value has no parsed reading, the sentence only names the property.

### D23. Compound values are built by the parse functions
**Chose:** small values (a duration, a bezier) have constructor functions. A Track, a Shape or a Capture is built by `parseTrack`, `parseShape` and `parseCapture`, which take any value.
**Why:** one path into the format. Data from the capture script, from storage and from pasted JSON all go through the same checks, and the fast-check generators do too.
**Gave up:** building a Capture in code means writing a plain object and parsing it, as the sample captures do.

### D24. One `try`/`catch` in core
**Chose:** `parseCaptureJson` catches the error from `JSON.parse`. Nothing else in core can throw.
**Why:** `JSON.parse` is the platform's only way to read JSON, and it throws.
**Gave up:** nothing.

### D25. Recursion in place of loops in the bezier solver
**Chose:** Newton's method and bisection are small recursive functions with a step counter.
**Why:** the rule for core is no mutation, and this form ports to Elm line for line. The depth is at most 50.
**Gave up:** a `for` loop would be more familiar to most TypeScript readers.

## Editor (M3)

### D26. Draw functions get the theme as a plain object
**Chose:** `readTheme()` reads the CSS tokens once into an object, and every draw function receives it in its data.
**Why:** a canvas cannot use CSS variables, and a draw function that read them itself would not be pure. The tokens file stays the only place a color is defined.
**Gave up:** the theme is read again only when the system switches light and dark. A token edited in dev tools does not reach the canvases until a reload.

### D27. Timeline row labels are HTML, the bars are one canvas
**Chose:** the left column of the timeline is real text. The bars, ruler and playhead are drawn on one canvas beside it, with the same row height.
**Why:** text stays sharp, selectable and readable by screen readers, and long names can be cut off with an ellipsis by CSS.
**Gave up:** two things must agree on the row height. It is one constant, passed to both.

### D28. One `Canvas` component owns every canvas element
**Chose:** `Canvas` sizes the element, handles `devicePixelRatio` and resizing, and calls a pure `draw(context, size)`.
**Why:** the sharpness and resize logic exists once. Each piece only supplies data and a draw function.
**Gave up:** every canvas clears and redraws fully when its data changes. That is the intended model here: redraw only when the model changes.

### D29. Design: "Panels"
**Chose:** bordered panels on a gray page, blue accent. Picked from three options built as real variants (screenshots in `screenshots/m3-options/`).
**Why:** each piece has a clear edge, which also suits the pieces page where each is shown alone.
**Gave up:** the denser "Bench" layout gave the timeline the full width. That can still be borrowed.

### D30. One Model, one Msg, one update
**Chose:** all editor state is one `Model`. Every change is a `Msg` handled by the pure `update` in `state/update.ts`. React's `useReducer` runs it. Those files import no React and no DOM.
**Why:** every behavior can be tested without a browser, a property test can throw random messages at it, and it ports to Elm as it is.
**Gave up:** small things that could be local component state (which track is selected) go through a message too. The only local state left is what never leaves a piece: hover position, and the drag in progress.

### D31. The clock is a number in the Model, advanced by messages
**Chose:** while playing, a `requestAnimationFrame` loop sends `ticked` with the real time that passed. `update` moves `timeMs`. Nothing else keeps time.
**Why:** the stage, the playhead and the curve dot all read the same number, so they cannot drift apart. The loop runs only while playing.
**Gave up:** React renders the editor on every frame while playing. Measured at 16.6 ms per frame, also with 4x CPU slowdown (`tests/frame-time.cjs`).

### D32. The probe plays the whole track, not one segment
**Chose:** for each track the probe keeps a hidden element with a paused Web Animation built from all of the track's keyframes, easings and timing. To sample, it sets `currentTime` and reads the computed style.
**Why:** the browser then does the timing and easing math itself, so comparing it with core is a real test. That test passes on every sample capture (more than 1000 values, all within 0.01).
**Gave up:** an edited track needs a new animation, so dragging a handle creates one per frame for that track. It is cheap, and old ones are cancelled.

### D33. In the preview, a transition keeps its end value
**Chose:** after a transition ends, the stage keeps showing its last value.
**Why:** on the page the element stays in its new state while the hover is held. Chrome reports `fill: backwards` for transitions, and following that literally would make the shape snap back at the end.
**Gave up:** the preview treats transitions differently from keyframe animations, which do return to rest unless they fill forwards.

### D34. Curve handles are real buttons over the canvas
**Chose:** each bezier handle is drawn on the canvas, with an invisible 24 px `<button>` placed over it.
**Why:** one element gives the handle its larger hit area, hover and pressed states, focus ring, pointer capture and arrow-key control. No hit-testing code, and a screen reader can reach it.
**Gave up:** the button's position is set from the model on each render, so the piece needs to know the canvas size.

### D35. The curve's range is frozen while a handle is dragged
**Chose:** the plot scales to fit both curves and all handles, in quarter steps. During a drag that scale does not change. It is worked out again on release.
**Why:** a grid that rescales under the pointer makes the handle feel like it is slipping.
**Gave up:** a handle cannot be dragged past the current edge of the plot in one go. Let go, and the plot grows.

### D36. The scrubber is a native slider
**Chose:** `<input type="range">` with a step of one frame.
**Why:** it follows the pointer with no lag, works from the keyboard, and is announced correctly, with no code.
**Gave up:** its look is limited to what `accent-color` allows. The timeline's draggable playhead comes in M4.

### D37. Which easing the curve editor edits
**Chose:** a transition's curve is the effect easing. A keyframe animation's curve is the easing of the selected segment. An `element.animate()` call with only an effect easing counts as the first kind.
**Why:** it follows where Chrome keeps the easing (D13), so an edit lands where the author would write it.
**Gave up:** a track that uses both levels at once shows only the segment easing.

### D38. Tracks from one animation share an easing edit
**Chose:** changing the curve of a track also changes the other tracks with the same group id.
**Why:** in CSS, a keyframe's `animation-timing-function` applies to every property in that keyframe.
**Gave up:** to give one property its own curve, the track must be unlinked first (M4).

### D39. "Convert to bezier" is a coarse search
**Chose:** `fitBezier` tries every handle position on a grid of about 35,000 curves and keeps the closest.
**Why:** simple to read, no numerical method to explain, and it only runs when the button is pressed.
**Gave up:** the fit is approximate. A `steps()` easing has no good bezier match at all, and the note beside the button says so.

### D40. An animation that repeats forever is shown for two cycles
**Chose:** the take's length counts two iterations of an infinite animation.
**Why:** the timeline and the scrubber need an end, and two cycles show the repeat.
**Gave up:** the choice of two is arbitrary.
