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

## Editor, after the first feel test (M3 feedback)

### D41. The timeline is the only scrubber
**Chose:** the separate slider is gone. Pressing or dragging anywhere on the timeline's bars moves the playhead, and the play controls sit in the timeline's header. This replaces D36.
**Why:** two controls for one thing (a slider and a playhead) made it unclear which was the real one.
**Gave up:** the free keyboard and screen-reader support of a native slider. The timeline now sets `role="slider"` and its values by hand, and Home and End are handled in code.

### D42. Space is reserved for everything that can change
**Chose:** the description keeps room for three lines. The curve readout is three lines of fixed height that cut long text with an ellipsis. "Play" and "Pause" share one width. The time readout reserves its widest value. The curve and speed panels sit in slots of fixed height. The page always keeps room for the scrollbar.
**Why:** each of these moved the page while it was being used. A browser test (`nothing shifts while the editor is used`) now records where every block is, plays, drags, picks presets, toggles and selects, and fails if any block moved by a pixel.
**Gave up:** some empty space, most visible under a short description on a narrow panel. The slot heights are numbers measured from the tallest real content at each width, so they need another look if the content of those panels changes.

### D43. The curve chart's scale only widens
**Chose:** the chart starts with room for a normal overshoot, widens in quarter steps when a curve needs more, and never narrows while the same track is selected. This replaces D35.
**Why:** rescaling to fit after every release made the chart jump each time a handle was let go.
**Gave up:** after one extreme curve the chart stays zoomed out until another track is selected.

### D44. The original is optional, and only drawn where it differs
**Chose:** one toggle, "Show the original (dashed)", for the dashed outline over my version on the preview (in both "Mine only" and "Side by side") and the dashed curve, speed line and timeline bars. When it is on, a dashed line is still only drawn where the original is not the same as mine. Side by side is a separate choice and is not affected: the first version of this toggle also closed side by side, which was a surprise, because that view has no dashed lines.
**Why:** before any edit the two are identical, so the dashed lines sat exactly on the solid ones and only added noise.
**Gave up:** with nothing edited there is no dashed line to show that the feature exists. The toggle's label says what it is.

### D45. A track can be left out without deleting it
**Chose:** each timeline row has a checkbox. Unticking it takes the track out of the preview and the description. The track stays in the Model, as an index in `hiddenTracks`.
**Why:** real captures include tracks that are not interesting. Hiding is reversible and keeps `edited` and `original` the same length, which every other part relies on.
**Gave up:** nothing is ever removed from the capture. Whether hidden tracks are left out of the exports is decided in M4.

### D46. The curve is explained in words
**Chose:** the handles are labeled "start" and "end" on the chart. Under it, one line says what the curve does ("Starts fast, ends gentle, overshoots by 10%"), and a short guide says what moving each handle does. Presets are named by effect ("Slow start"), not by CSS keyword. Each panel has a one-line hint, and timeline rows show a plain name before the CSS term.
**Why:** a bezier chart is not self-explanatory, and CSS keywords like `ease-in` do not say what they do.
**Gave up:** more text on screen, against the brief's "show less by default". The CSS terms are still there, in mono, beside the plain words.

### D47. Unticking a row leaves the original alone, unless asked
**Chose:** a row that is unticked is left out of my version only. The original's preview keeps every track. A toggle, "Unticked rows also leave the original", makes it apply to both.
**Why:** the first version removed the track from both previews, so a change to my version changed the original, which is meant to be the fixed reference.
**Gave up:** with the toggle off, the two previews can show different sets of tracks, so a difference between them may be a hidden row and not an edit.

### D48. Three things can be dragged on the timeline, told apart by where the press lands
**Chose:** on a bar, the drag moves its delay. On a bar's right edge, it changes its duration. Anywhere else (the ruler, an empty spot) it moves the playhead. The cursor shows which one it will be. This narrows D41, where a press anywhere scrubbed.
**Why:** timing has to be editable where it is shown, and one area cannot do two things with the same gesture.
**Gave up:** scrubbing by pressing directly on a bar. The whole ruler and every gap still scrub.

### D49. The timeline's scale only grows, and never during a drag
**Chose:** the time at the right edge starts at the longer of mine and the original, and widens only after a drag ends.
**Why:** a bar's own length changes the length of the take. If the scale followed, the bar would rescale under the pointer while being dragged.
**Gave up:** a bar dragged past the right edge runs off the canvas until the drag ends.

### D50. Nothing that appears during use may change a width or height
**Chose:** the "edited" marker on a row always keeps its space. The selected row is shown by color and a bar at its left edge, not bold text. The layout test now also watches the parts a pointer aims at (the bars, the label column, the curve, the fields), not only the page's blocks.
**Why:** both were real bugs found while testing a drag. The marker made the label column wider the moment a row was edited, which shrank the bars under the pointer, so the bar drifted away from the cursor. Bold text did the same on selection.
**Gave up:** nothing.

### D51. Resets come in three sizes, and are disabled when there is nothing to reset
**Chose:** "Reset curve", "Reset this row" (curve and timing), and "Reset everything". Double-clicking a handle or a bar resets that one thing. Which rows are ticked is not an edit, so no reset changes it.
**Why:** each matches one thing that can be edited. A disabled button stays in place, so nothing moves when it wakes up.
**Gave up:** there is still no undo. That is M4.

### D52. Hand-set timing has a limit
**Chose:** a delay or duration set in the editor is held within ten minutes.
**Why:** one typo (30000000) made every other bar too small to see or grab.
**Gave up:** an animation longer than ten minutes cannot be made by hand. A captured one is not changed.

### D53. The probe sets every time first, then reads every value
**Chose:** sampling is two passes: `currentTime` on every active track, then the computed style of every track.
**Why:** reading a style makes the browser recalculate if anything changed. Interleaved, that was one recalculation per track per frame. Measured with 100 tracks under 4x CPU slowdown: 32 ms per frame before, 19.5 ms after.
**Gave up:** nothing. Before any edit, the original's poses are also reused from mine, since it is the same capture.

### D54. A long timeline is folded
**Chose:** the first 8 rows are shown, with "Show N more rows".
**Why:** 100 rows made the page several screens long.
**Gave up:** the first 8 are simply the first 8. Ordering by importance comes with "select the biggest change" in M4.

### D55. One error boundary around the editor
**Chose:** if drawing throws, the editor shows a short message with the error, not a blank page.
**Why:** a tool that fails silently cannot be trusted with real captures.
**Gave up:** React only offers this as a class, so it is the one class in the project.

### D56. Tests that try to break it
**Chose:** `tests/robust.spec.ts` opens every sample at 360 and 1280 px and fails on any console error, page error, or content wider than the window. It also covers 100 tracks, a capture with nothing to play, absurd typed values, and six runs of 80 random actions each (clicks on any button or checkbox, drags that leave the page, key presses, bad numbers) with fixed seeds so a failure can be replayed.
**Why:** the bugs found in this pass were all in combinations nobody would write a test for by hand.
**Gave up:** about 12 seconds of test time.

### D57. Timeline bars are drawn as clips, and a drag cannot leave the timeline
**Chose:** each row is a lane with a lighter block for the delay and a solid bar for the duration, each with its value written on it, and a grip at the bar's right end. A drag stops at both edges: the delay cannot go below zero and the bar cannot pass the right edge. The timeline shows a quarter more time than the take needs, so there is always room to move a bar later or make it longer, and it makes more room after a drag that used it up. This replaces the thin line and thin bar of D48.
**Why:** the first version looked unfinished, and a bar could be dragged off the canvas or to a negative delay, where it could no longer be seen or grabbed.
**Gave up:** a negative delay cannot be made by hand. A captured one is kept and can be restored by reset: the lowest delay a row may be given is zero or its original delay, whichever is lower. Such a bar is drawn cut off at the left edge, with "already 320 ms in" written on it when there is room.

### D58. The timing settings are called Delay and Duration
**Chose:** "Delay" and "Duration", with the CSS term under each, and a title that names the row they belong to.
**Why:** "Starts after" and "Lasts" were my attempt at plainer words, and they hid the two settings people look for by name.
**Gave up:** nothing. Delay and duration are plain words already.

### D59. A steps easing is edited with a number and a choice
**Chose:** for `steps()`, the curve panel shows the number of steps and when each jump happens (end of each step, start, both, neither). A "Steps" button beside the ready-made curves turns a smooth curve into steps, and "Change to a smooth curve" goes back. `linear()` is still read-only with a convert button.
**Why:** a steps easing has no handles, but it has two settings, and both are easy to offer.
**Gave up:** "Neither" needs at least 2 steps, so choosing it with 1 step sets 2.

### D60. The timeline's rows scroll inside a box, with the ruler pinned
**Chose:** the rows live in a box that is at most about eight rows tall, and never so tall that the whole timeline panel cannot fit in the window. More rows scroll inside it. The ruler is a second canvas pinned to the top of that box.
**Why:** with many rows the page grew to several screens. The play controls scrolled away above and the Delay and Duration fields below, so editing a row far down meant scrolling back and forth.
**Gave up:** two canvases where there was one. They share one scale function, so a tick in the ruler lines up with its grid line in the rows.

### D61. On a narrow panel, a row's label sits above its bar
**Chose:** below 560 px of panel width, each label is on top of its row and the bar is drawn underneath, across the full width. Above that, labels sit beside the bars as before. The panel's own width decides, not the window's.
**Why:** at 360 px, the width of the browser side panel, the labels took more than half the row and left the bars about 50 px wide: unreadable and impossible to drag. This was the main target width, and I had only looked closely at the wide layout.
**Gave up:** rows are taller on a narrow panel (84 px against 52), so fewer fit in the box.

### D62. A number field shows what was typed until it is left
**Chose:** while a number field has focus it shows the typed text as it is. A valid number is applied at once. On leaving the field it shows the real value, which may have been held to a limit.
**Why:** the field used to snap back to the last valid value on every keystroke, so it could not be cleared with backspace to type a new number.
**Gave up:** for a moment the field can show a number larger than the limit that was applied.

## Editor, part 2 (M4)

### D63. Undo and redo are a stack around update
**Chose:** `updateHistory` in `state/history.ts` wraps `update`. Every message goes through `update` first. If the edits changed, the state from before goes on a stack. Undo and redo restore only the edits: the edited capture and which rows are ticked. The playhead, the selection and the view choices are left as they are.
**Why:** `update` stays unaware of history, so each can be read and tested alone. Undo that also moved the playhead or changed the selection would feel like losing your place.
**Gave up:** a view choice (ghost trail, side by side) cannot be undone. Those are one click to change back.

### D64. One drag is one undo step
**Chose:** edits that arrive many times for one change (a handle drag, a bar drag, typing in a field) carry a key. While the key repeats, they are one step. The pieces say when a change is finished (pointer up, field left), and the next change starts a new step.
**Why:** without this, undoing a drag would take a hundred presses.
**Gave up:** the pieces have to report the end of a change. A property test checks that undo then redo always gives back the same edits.

### D65. The exports use what is shown
**Chose:** "Copy CSS" and "Copy for AI" are written by core from my version without the unticked rows, and the CSS is shown live in the Export panel.
**Why:** what you see is what you copy. A row that was taken out of the preview should not come back in the export.
**Gave up:** the JSON inside "Copy for AI" does not contain the unticked tracks, so it is not a full copy of the capture.

### D66. A copy that fails says so and offers the text
**Chose:** if the clipboard refuses, the Export panel says "Could not copy" and shows the text in a field, already selected, to copy by hand.
**Why:** the clipboard can be refused (no permission, a page that is not secure). A copy button that silently does nothing is worse than none.
**Gave up:** nothing.

### D67. The hovered shape is in the Model
**Chose:** `hoveredShapeId` is set by pointing at a shape on the preview or at a row on the timeline. Both views read it and light up.
**Why:** it is shared by two pieces, so it cannot be local to either.
**Gave up:** moving the pointer over the preview sends messages. They are only sent when the shape under the pointer changes, not on every pixel.

### D68. Finding the shape under the pointer
**Chose:** `shapeAt` in `draw/stage.ts` uses the same fitting function as the drawing, then walks the shapes in reverse drawing order, bringing the point into each shape's own space with the inverse of its transform.
**Why:** a shape that is scaled or moved by the animation is hit where it is drawn, not where it rests.
**Gave up:** it uses `DOMMatrix`, so it runs only in a browser, like the rest of the drawing.

### D69. The ghost trail is worked out when the edits change, not every frame
**Chose:** seven copies of the selected shape at equal time steps through its track, read from the probe when the edits or the selection change.
**Why:** equal time steps make the spacing show speed: far apart is fast, close together is slow. Seven extra probe reads per edit cost nothing. Seven per frame would.
**Gave up:** seven is a fixed number. A long, complex motion could use more.

### D70. Bars snap to each other before they snap to 10 ms
**Chose:** while dragging, a bar's start or end snaps to another bar's start or end when within 6 px. Otherwise it snaps to 10 ms. Alt turns both off.
**Why:** lining things up with each other is the common case in a stagger.
**Gave up:** with many bars close together, the nearest edge wins, which may not be the one meant.

### D71. The first selection is the biggest visible change
**Chose:** each track gets a rough score from the numbers in `Keyframe.parsed` (pixels moved, scale and opacity change, degrees turned, color difference), comparing the first keyframe with every other. The highest is selected when a capture loads.
**Why:** the brief asks for it, and it puts the curve most worth looking at on screen first.
**Gave up:** the score compares unlike things (pixels with opacity) by fixed weights. It is only used to pick a starting point.

### D72. A computed radius is read in every form Chrome uses
**Chose:** `radiusPx` reads a percentage part and a px part with their own signs, from `8px`, `50%`, `calc(25% + 4px)` or `calc(-3.92px + 50%)`, and never returns a negative number. The stage also holds radii and sizes at zero before drawing.
**Why:** a real crash, found by the test that opens every sample. Part-way through a morph from `8px` to `50%`, Chrome reports the px part first and negative. The first version read only up to the first space, got -3.92, and the canvas threw.
**Gave up:** nothing. It has a unit test for each form.

## Capture (M5)

### D73. Shapes are measured by their layout box, not as drawn
**Chose:** a shape's position and size come from `offsetLeft`, `offsetTop`, `offsetWidth` and `offsetHeight`, added up to the picked element. Text bars, which have no layout offsets, are placed by their distance from their parent as drawn, added to the parent's layout box.
**Why:** `getBoundingClientRect` reports the box as it is drawn right now. A 32 px loader measured 41 px mid-spin. List items resting at `translateX(-12px)` had that offset built into their shape, and the preview then applied it a second time.
**Gave up:** an SVG element has no layout offsets and falls back to the drawn box. A resting scale or rotation on a parent is not removed from its text bars.

### D74. Which elements get a shape
**Chose:** the picked element always does. A descendant does if it paints something (a background color, a background image, a border, or it is an image), or if it looks set up to animate (it has a transition, an animation or `will-change`). At most 40 shapes. What is inside an image is not drawn.
**Why:** an element that paints nothing but carries a transform still needs a shape, or its children would not move with it. There is no way to know at pick time what will animate, so "set up to animate" is the hint.
**Gave up:** an element animated only by a class added later, with no transition on it at pick time, has no shape, and its animation is listed under "not shown" with that reason.

### D75. A take ends after 200 ms of quiet, and an endless animation does not keep it open
**Chose:** a take is "active" while a finite animation in it is running. After 200 ms with none, it ends. An animation that repeats forever never counts as running for this.
**Why:** a loader would otherwise keep its take open for ever, and nothing would reach the editor.
**Gave up:** a finite animation that starts more than 200 ms after the previous one ended begins a new take, even if a person would call it the same motion.

### D76. New animations in one frame are compared with the take as it was
**Chose:** on each frame every new animation is read first. Then each is checked against the take from before that frame, to see whether it replaced something still running.
**Why:** a real bug. On hover-out, two transitions arrive in one frame (one per property). The first ended the old take, so the second no longer found the transition it replaced and was not marked as shortened.
**Gave up:** nothing.

### D77. Keyframes that Chrome added are marked too
**Chose:** `implicit` is true for a keyframe capture filled in (for `element.animate()`) and also for one Chrome added to a CSS animation with a missing `from` or `to`. Chrome marks its own with `composite: "replace"`.
**Why:** in both cases the author did not write it, and the CSS export should not either.
**Gave up:** this depends on a detail of how Chrome reports generated keyframes. A test asserts it, so a change will be noticed.

### D78. A resting value is not read from a property that is animating
**Chose:** a shape's opacity is 1 when the opacity was already animating at pick time.
**Why:** the sample of the staggered dots came out different on every run, because each dot's "resting" opacity was wherever its animation happened to be.
**Gave up:** a shape whose real resting opacity is below 1, and which is also animating opacity when picked, is drawn too opaque when its track is not running.

### D79. The demo's samples are real captures, checked on every run
**Chose:** the capture script is run on the fixtures page and its output is saved as JSON in `packages/demo/src/captured`. `tests/samples.spec.ts` records them again on every test run and fails if they differ. `pnpm samples:update` rewrites them.
**Why:** the brief asks for real samples, and a saved file that nothing checks would go stale without anyone knowing.
**Gave up:** the check runs in installed Chrome only, because text is measured a hair differently in each browser. The interrupted hover is saved but not compared, since how far it gets before being interrupted differs each time. Core's unit tests still use the hand-written samples, where every number is known.

### D80. "Not shown" also lists what is drawn more simply
**Chose:** the list holds animations that cannot be drawn and also drawing notes: parts left out, a gradient drawn as flat gray, a multi-colored border drawn in one color. The description counts them as "things left out of this preview".
**Why:** each of these makes the preview differ from the page, and the brief asks that limits are explained and never hidden. A spinner with one colored edge is drawn as a uniform ring, so its rotation cannot be seen: that has to be said.
**Gave up:** the format's `notShown` was meant for animations only. One list is simpler than two, but its name is now a little narrow.

## Extension (M6)

### D81. The side panel's state is a pure function too
**Chose:** `panelState.ts` has one `Panel`, one `PanelMsg` and one pure `updatePanel`, like the editor. `panel.tsx` does the things that touch the browser and reports what happened as messages.
**Why:** every state in the brief (first open, picking, listening, the tip after 5 seconds, nothing found, captured, a page that cannot be inspected, a save that fails) can be tested without a browser.
**Gave up:** the panel has two layers where one component with effects would be shorter.

### D82. Try to inject first, then ask for one site
**Chose:** "Pick element" tries to inject the capture script. If Chrome refuses, and the page is not one nobody may inspect, it asks for access to that one site (`chrome.permissions.request` with that origin). The manifest lists `*://*/*` only under `optional_host_permissions`, which grants nothing until asked.
**Why:** Chrome's documentation says clicking the toolbar icon grants `activeTab` for that tab, lost when the tab goes to another site, and not carried to other tabs. It says nothing about the case where the click opens a side panel. This order works whichever way that turns out.
**What I could not verify:** whether the icon click really grants `activeTab` when it opens a side panel. A test cannot click a toolbar icon. `REAL_SITES.md` has a one-minute check.
**Gave up:** when the extension has no access to a tab, Chrome hides the tab's address, so there is no site to ask for. The panel then says to click the toolbar icon on that tab first.

### D83. Nothing runs on a page until "Pick element" is pressed
**Chose:** no `content_scripts` in the manifest. The capture script and a small bridge are injected with `chrome.scripting.executeScript` on each press.
**Why:** the brief asks for it, and it means the extension has no presence on any page you have not pointed it at. A test checks the built manifest for this.
**Gave up:** each press injects both files again. The bridge ends the previous session first, or the page would be watched twice.

### D84. The panel checks every capture again
**Chose:** a capture passes core's `parseCapture` in the page, travels as plain JSON, and is parsed again in the panel before it is shown or saved. Saved takes are parsed again when loaded.
**Why:** a page can send anything to an extension. The panel does not trust it.
**Gave up:** the same check runs twice on the happy path. It takes well under a millisecond.

### D85. Recording moves to a parent when that is what animates
**Chose:** while nothing has been found on the picked element, the recorder also watches for an animation on one of its four nearest parents (never `body`). If one runs, recording moves to that parent, and the panel says which element is now being watched. The animation that was noticed is still running, so it is captured without triggering it again.
**Why:** clicking the middle of a card picks the image inside it, the deepest element under the pointer. The animation is on the card. Without this, the most natural click gives "No animation was found".
**Gave up:** the snapshot of the parent is taken while it is already animating. Shapes come from layout boxes, so they are still right, but resting values read at that moment are not trusted.

### D86. The test build has access to the fixtures page, the real build has none
**Chose:** `build.mjs --test` writes a second copy of the extension whose manifest adds `host_permissions` for `http://localhost:5173`. Browser tests load that copy, and open the panel as a tab.
**Why:** a test cannot click the toolbar icon or answer a permission prompt. Without this the tests could not get past "Pick element".
**Gave up:** the tests do not cover the permission flow itself. Everything after it is covered: injection, the picker, messages, takes, the editor, storage.

### D87. "Copy debug report" shows only in an unpacked extension
**Chose:** the button is shown when the manifest has no `update_url`, which is true for an extension loaded from a folder and false for one installed from the Web Store.
**Why:** it is a development tool for the real-site pass, and this needs no build flag.
**Gave up:** a developer who loads a packed build cannot see it.

### D88. The extension handles the toolbar click itself
**Chose:** `openPanelOnActionClick` is off. `chrome.action.onClicked` opens the side panel with `chrome.sidePanel.open`, and tells an open panel that the tab in front can now be inspected. This corrects D82.
**Why:** the first real test. With Chrome opening the panel by itself, every page said "Motion Inspector has no access to this tab yet". The icon click that Chrome handles does not grant `activeTab`. A click the extension handles does. This was the one thing M6 could not test, and it was wrong.
**Gave up:** access is per tab. To inspect a different tab, the icon has to be clicked once on that tab too. The panel says so when it happens.
**Verified by hand, not by a test:** a test cannot click a toolbar icon. Confirmed working in installed Chrome on 2026-11-13: after clicking the icon on a tab, "Pick element" works on that tab.

### D89. Shape.clip
**Chose:** a boolean on every shape, true when CSS `overflow` is not `visible`. The preview clips the shape's children to it. A shape whose width or height is animating clips too, even when `clip` is false.
**Why:** found on real sites: carousels and accordions depend on it, and without it the preview showed content the page hides. The second rule is because frameworks add `overflow: hidden` only during the animation, after the element was picked.
**Gave up:** the format changed after it was locked, for the second time (after `label`). Saved takes from before this change no longer load.

### D90. Shapes are added when a take ends, for parts that had none
**Chose:** see REAL_SITES.md, problem 2. A part that was visible at pick time gets a shape where it was then, and the shapes of its content move inside it. A part that was hidden is measured when the take ends.
**Why:** the main animation of accordions, tabs, carousels, dropdowns and modals is on a part that is hidden or paints nothing when picked.
**Gave up:** a part measured when the take ends is measured at its end state. Resting values are not read for it, so a missing keyframe on such a part is listed under "not shown".

### D91. The take starts with the first new animation
**Chose:** see REAL_SITES.md, problem 4. An animation that was already running keeps its phase as a negative delay.
**Why:** a loader running beside a hovered button put seconds of nothing at the start of the timeline.
**Gave up:** nothing.

### D92. The real-site pass is run by scripts, and judged by looking
**Chose:** `tests/real-sites.cjs` for breadth, `tests/compare.cjs` to put the page's frames beside the preview's. Both stay out of the regular test run: they depend on sites that change, and the comparison needs eyes.
**Why:** tests that only check data passed while the preview drew fades at a fifth of their strength. Looking at the frames found it in the first minute.
**Gave up:** the comparison is not automatic. A regression test was added for each bug it found, on a fixture that does not change.

### D93. The same property starting again is always a new take
**Chose:** when an animation starts on an element and property that the take already has, the take ends and a new one begins, whether or not the earlier animation had finished. This narrows D11 and the M0 note "animations that follow each other without overlap stay in one take": that still holds for different properties.
**Why:** found walking the flow as a user. The pointer is on the element while picking it, so leaving and coming back quickly gave one take with "moves down 0.3 px, moves up 2 px": two tracks for one value, which the preview cannot show sensibly.
**Gave up:** a keyframe-free sequence such as "move right, then move back" written as two transitions on one property is now two takes. It was never one coherent track anyway.

### D94. A new take is shown unless the pointer is in the panel
**Chose:** each take that arrives is shown at once, except while the pointer is over the side panel, when it is only added to the list. Each take in the list shows a one-line summary ("Moves up 6 px and scales to 1.03 over 400 ms").
**Why:** found walking the flow. Moving from the page to the panel plays the element's hover-out, which replaced the hover that had just been captured. A first attempt (keep the first take of a recording) failed too: picking leaves the pointer on the element, so the first take is often a leftover hover-out.
**Gave up:** while the pointer is in the panel, new takes do not appear on their own; the user picks them from the list.

### D95. The panel puts what comes next on screen
**Chose:** in the side panel, Copy CSS and Copy for AI sit at the top with Undo, Redo and Reset, and show "Copied" on the button. "Show the original" moved into the Preview panel, "Unticked rows also leave the original" into the Timeline. The description is smaller and reserves four lines, the preview is shorter, and the hints are one or two lines.
**Why:** walking the flow at 360 px, after a capture the preview started at the bottom edge of the panel and the copy buttons were 2,700 px down. Now the preview starts in view and copying is one click away.
**Gave up:** the Export panel no longer has its own buttons inside the editor (it still does when shown alone, on the pieces page).

### D96. A hover and its leave are one take
**Chose:** when a take is the exact reverse of the one before it (same elements and properties, each ending where the earlier one began), capture adds it to that take and sends the take again to replace it. The way back is placed after a rest of at most 400 ms, not after however long the pointer stayed. The way there and the way back of each property share a group, so editing the curve or timing of one edits both, as a single CSS `transition` does. In the preview the track that started most recently decides the value. The CSS export writes one transition per property. The timeline marks the second row "back", and the description ends "Then it goes back."
**Why:** asked for after the first real use: "hover in and out is read as two separate motions". In CSS they are one transition that runs both ways. This also replaces the case D94 was working around: moving to the panel now completes the shown take instead of adding another.
**Gave up:** the timeline does not show how long the pointer really stayed. A take now holds two tracks for one value, which D93 had ruled out; it is allowed exactly when the second undoes the first. An asymmetric hover (different timing in and out) is still captured right, but starts linked; "Unlink this row" separates the two.

### D97. On one column, the preview stays at the top
**Chose:** below 960 px wide the preview sticks to the top of the page (under the extension's own bar) while the timeline, curve, speed graph and export scroll underneath. There, its title and hint are hidden and its canvas is 140 px tall. The columns become `display: contents` so the preview stays stuck past the timeline. Keyboard focus is kept below it with `scroll-padding-top`.
**Why:** asked for: "I scroll to tweak something and I can't see the motion anymore". Tweaking is pointless without seeing the result.
**Gave up:** about a third of a side panel is always the preview. The layout test now measures from the top of the page, where nothing is stuck.

### D98. Icons are drawn from their own outlines
**Chose:** a new field, `Shape.icon`: for an SVG icon, the outline of each part (`path`, `circle`, `rect`, `line`, `polyline`, `polygon`, `ellipse`) as path data, the matrix from the part to the icon's box (Chrome's `getCTM()`, which includes the viewBox), and its fill, stroke, line cap and join. Parts colored with `currentColor` follow an animated text color. Path data may hold only path commands and numbers, at most 8,000 characters and 16 parts; anything beyond that, or an icon built with `<use>`, a nested `<svg>` or an embedded image, is drawn as a dot or ring in the icon's own color. This is a change to the locked format.
**Why:** a user's screen recording of their own site: the arrows of a round button were gray squares, and they asked for "arrows should look like arrows on the preview". The outline is geometry, so it stays within "shapes only": no text and no image data is copied.
**Gave up:** gradient fills inside icons are drawn in the text color. Animations inside an SVG (on its paths) are still not drawn. Takes saved before this have no `icon` field; the parser reads a missing field as `null` so they still open. The type itself has no optional field.

### D99. The preview is painted on the color behind the element
**Chose:** a new field, `Capture.backdrop`: the background color of whatever is drawn under the middle of the picked element (`document.elementsFromPoint`), skipping the element itself and anything that paints nothing. A photo, image or gradient there gives a neutral gray. The stage fills its preview area with it.
**Why:** on the same site the button is dark and see-through on a light photo card, and the page itself is dark. On the stage's own background, the button's edge and its see-through dark circle were hard to read. The card is not a parent of the button, so walking up the parents found the dark page instead.
**Gave up:** the backdrop is one flat color, read once when the element is picked.

### D100. Each side of a border keeps its color
**Chose:** `Shape.stroke.sides`: the four side colors, top, right, bottom, left, when they differ. The stage draws each side separately, from the middle of one corner to the middle of the next, as CSS does. This replaces the note "a border with a different color on each side is drawn in one color".
**Why:** Bootstrap's spinner is a ring with one transparent side. In one color it was a full ring, and its turning could not be seen. Now it is a turning "C", frame for frame against the page.
**Gave up:** border styles (dashed, dotted) are still drawn solid.

### D101. Recording moves to a parent when something next to the pick starts with it
**Chose:** recording moves to the smallest nearby parent (at most four levels up) that holds a new animation outside the picked element, in two cases: the picked element has nothing of its own (as before), or the animation started within 150 ms of one inside it, so it has the same trigger. Parents more than three times as wide or tall as the picked element (at least 120 px) are never used, and animations already running when recording began never move it.
**Why:** the user picked the arrows of a round button. The dark and white circles behind them are siblings of the arrows, so the preview showed arrows with no circles. Without the size limit, recording moved to a 436 by 251 invisible hover area that faded in on the same hover.
**Gave up:** two unrelated things that happen to start together, next to each other, are recorded together.

### D102. A hover and its leave are matched by what their values mean
**Chose:** when deciding whether a take undoes the one before it (D96), values are compared after reading them: transforms as the matrix of their functions (within 0.01), other values by their parsed numbers, and as text only when they cannot be read.
**Why:** Tailwind writes a resting transform as `translate(0px) rotate(0deg) skew(0deg, 0deg) skewY(0deg) scaleX(1) scaleY(1)`, and after a hover Chrome reports the same state as `none`. Compared as text, the leave did not match, and the user saw several identical "moves left 28 px" takes for one hover.
**Gave up:** nothing that was found. Two values that differ by less than 0.01 in every matrix number count as the same.

### D103. A sweep of real sites finds what to fix, by itself
**Chose:** `tests/sweep.cjs` opens about thirty sites (component libraries, loader galleries, hover-effect galleries, product sites), finds what animates by itself (loaders already running, elements that animate on hover, tabs and switches that animate on click), and for each one puts the real page's frames beside the preview's in one image per site. It skips elements a banner or overlay covers, since a hover that never reaches them rightly captures nothing.
**Why:** asked for: "test it on many websites, many buttons, many different components and many different animations". Hand-picked elements only find the problems I already expect.
**Gave up:** like compare.cjs, it needs eyes, and stays out of the regular test run. Each problem it found has a fixture and a test that does not depend on a live site.

### D104. ::before and ::after are drawn
**Chose:** an absolutely positioned pseudo-element that paints something or is set up to animate gets a shape: its box from its computed left, top, width and height against its containing block. ::before is drawn first among its element's contents and ::after last, as the browser paints them. One added during the take (an underline that only exists on hover) is measured when the take ends. A pseudo-element in the flow of text is still listed as not shown: its box cannot be measured.
**Why:** the sweep found them everywhere: Hover.css builds its underlines, sweeps and shadows from them, and most loaders on a loader gallery are nothing but a ::before and ::after.
**Gave up:** a pseudo-element with a negative z-index is drawn over its element's background, not under it, which matches the common case (a fill sweeping behind a label).

### D105. Each part of an SVG is a shape
**Chose:** a new shape kind, `path`, for each part of an icon. Its outline is placed by its parent's CTM, and its own transform (`transform` and `transformOrigin`, in the SVG's own units, measured from its bounding box under `transform-box: fill-box`) is applied inside that, as SVG does. Animated `fill`, `stroke`, `stroke-dasharray` and `stroke-dashoffset` are drawn on it. An SVG part picked by itself (a loader made of SVG rects) is drawn the same way. A circle's outline starts at its right-hand point and runs clockwise, as SVG draws it, so dashes start in the same place. This changes D98: the outlines moved from the `<svg>` shape to its parts.
**Why:** Stripe turns the two strokes of a chevron, MUI's spinner draws its circle with dashes, GitHub's arrow grows its stem. All of these were "left out of the simplified drawing".
**Gave up:** a shape per part makes larger takes for detailed icons (up to 16 parts, as before).

### D106. Resting transforms, shadows and clip-paths are drawn; gradients in their average color
**Chose:** three new shape fields, `transform` (the resting 2D matrix), `shadow` (the first outer box-shadow) and `clipPath` (the computed CSS, for polygon, inset, circle, ellipse and path). A gradient is drawn in the average of its color stops, weighted by opacity, and a radial gradient alone (a soft shadow or glow) as an ellipse. The backdrop reads gradients the same way. The stage fits what is drawn at rest, transforms included, not only the root's box. Borders are drawn inside the box, as in CSS.
**Why:** the sweep showed a "Fork me" ribbon rotated 45 degrees drawn flat, white cards on white pages that are only seen by their shadow, loaders revealed by clip-path drawn as full rings, a violet gradient navbar behind white links read as white, and a ring cut flat at four points because its border was drawn half outside its clip.
**Gave up:** a gradient's direction and a shadow's spread are not drawn.

### D107. Size and position are drawn from capture's px numbers
**Chose:** `left`, `right`, `top`, `bottom`, `width` and `height` are previewed from the px values capture reads, interpolated with core's sample, not through the probe. A percentage keeps its value as written, and gains `of`: what 100% is in px, measured against the containing block (a change to the locked format). Moving left or top moves the shape and its content; when both opposite edges move, its size changes.
**Why:** an underline growing from its middle (`left` and `right` from 51% to 0) did not move at all, and `width: 100%` resolved against the probe's own hidden element, not the link.
**Gave up:** whether an element's width is "auto" is not known, so when only one edge moves, the shape moves rather than stretches.

### D108. Readings leave out what does nothing; changes that change nothing are dropped
**Chose:** `perspective()` and functions that do nothing (a zero move, a zero turn, a scale of 1) are left out of transform readings, so `perspective(1px) translateZ(0)` reads as no transform and Tailwind's spelled-out resting transform reads like `none`. A track whose keyframes all mean the same thing (`0px` to `0%`) is dropped. Transforms are compared as their function lists for this, never as matrices, so `rotate(0)` to `rotate(360deg)` stays a full turn. `filter` and `visibility` are now previewed.
**Why:** Hover.css puts `perspective(1px) translateZ(0)` on every effect, so its descriptions read "changes transform from perspective(1px) translateZ(0px) to scale(1.1)" instead of "scales to 1.1". Linear's buttons listed "changes background-position-x from 0 px to 0%".
**Gave up:** nothing that was seen.

### D109. The preview is easier to read
**Chose:** small elements are drawn up to four times their size (it was two). The whole component is no longer outlined when its row is selected; other shapes still are. The backdrop mixes a see-through color, or one under a faded parent, with what is behind it.
**Why:** in the sweep, a 14 px spinner was 28 px in a 240 px stage, every preview had a blue frame around it that was not part of the page, and Ant Design's loading button (at 65% opacity) was drawn on solid bright blue.
**Gave up:** at four times, a small element's edges are softer.

### D110. Gradients are drawn with their direction
**Chose:** `Shape.gradient`: a linear gradient's angle (as CSS measures it, with `to right` and corner directions worked out against the box) and its color stops, or a radial gradient's stops. Stop positions follow CSS's rules for stops without one. The stage draws them with the canvas's own gradients, over the background color. Repeating and conic gradients are still drawn in their average color. This replaces the average color of D106 for gradients the stage can draw.
**Why:** asked to keep making the preview closer to the page. Gradient buttons and banners are common, and a gradient is written in CSS, so its stops are not image data.
**Gave up:** a radial gradient's shape, size and center are not read: it is drawn as an ellipse from the middle.

### D111. Text bars have the gaps between words
**Chose:** `Shape.words`: for each line of text, where each word starts and how wide it is. The bar is drawn as one rounded segment per word, about as tall as lowercase letters (55% of the font size), not half the line.
**Why:** "Download on GitHub" drawn as one long bar did not read as a label. The words themselves are still never kept, only their boxes, as the brief requires ("no real text", confirmed by the user).
**Gave up:** a line with more than 64 words is drawn as one bar.

### D112. Dashed and dotted lines
**Chose:** a border's style (`solid`, `dashed`, `dotted`) and an SVG stroke's resting dash pattern are kept and drawn. Animated dashes (D105) replace the resting ones.
**Why:** MUI's spinner is an arc at rest through its dash pattern, and was drawn as a full ring before its animation started.
**Gave up:** the browser's exact dash lengths are not matched: dashes are three times the border's width.

### D113. A parent that cuts off the pick is the preview's frame
**Chose:** `Capture.frame`: the inside of the nearest parent outside the picked element whose overflow is not visible. The stage draws nothing outside it, and fits what is visible inside it at rest.
**Why:** a line of text rolling up inside a wrapper with `overflow: hidden`, picked by itself, was drawn sliding out in full. On the page it disappears at the wrapper's edge.
**Gave up:** only the nearest such parent is used, and only its box, not its rounded corners.

### D114. Icon sprites, fill rules, and backdrops painted by pseudo-elements
**Chose:** an icon drawn with `<use href="#icon">` is drawn from the element it points to (usually a `<symbol>` in a sprite): its parts placed by the `<use>` element's position and the symbol's viewBox, colored from the `<use>` unless a part sets its own color. Each icon part keeps its `fill-rule`, so a letter or a ring keeps its holes. The backdrop reader also looks at each element's absolutely positioned `::before` and `::after` that cover the point.
**Why:** a click sweep of component libraries showed Bootstrap's logo missing entirely: it is a path filled with `evenodd`, white on a violet navbar whose color is painted by a pseudo-element, which `elementsFromPoint` never returns. Sprites with `<use>` are how most icon sets are drawn, and they fell back to a dot.
**Gave up:** animations on the parts inside a sprite are drawn on the `<use>` as a whole, since the parts are copies.

### D115. The sweep tests click components too
**Chose:** a second list of twenty pages (accordions, tabs, switches, checkboxes and collapses from Bootstrap, MUI, Radix, shadcn, daisyUI, Headless UI, Mantine, Chakra and Flowbite), run with `node tests/sweep.cjs c-`. Three fixes to the harness itself made it see them: an element that is both a click and a hover candidate was tagged twice, so clicks pointed at nothing; wide accordion rows were skipped; and a 100 ms switch was finished before it was looked for, so new animations are now watched every frame.
**Why:** asked to test "many different components and many different animations". The first sweep was mostly hovers.
**Gave up:** nothing in the tool. The harness's own bugs are noted here because they hid real results for a run.

### D116. Switches, tabs and calc()
**Chose:** a `calc()` of a percentage and px in a size or position (`left: calc(100% - 16.5px)`) is read as px against the containing block. A `translate` in % or `calc()` is measured by the probe on its own hidden element, which has the shape's size. Recording moves to a parent of at most nine times the picked element's **area**, replacing D101's "three times as wide and as tall". The backdrop reader takes a gradient before the color under it.
**Why:** the click sweep: Mantine's and shadcn's switch thumbs did not move, and MUI's tab indicator, which slides under a tab list 5.6 times as wide as one tab, was never captured from a tab. Your portfolio button's hover area (33 times the button's area) is still left out.
**Gave up:** a `calc()` with other units (em, vw) is still not read.

### D117. What product sites showed
**Chose:** from a sweep of 23 product sites (Stripe, Vercel, Mercury, Linear, Framer, Raycast, Arc, Notion, Resend, Clerk, Supabase, Railway, Ramp, Retool, Webflow, Apple, Figma, Airbnb, Loom, Lemon Squeezy, Cal.com, Attio), run with `node tests/sweep.cjs m-`:
- Shapes added during a take are numbered by a counter that only moves forward, and a last check renames any repeated id. Two shapes had the same id on Webflow, so core rejected the take and nothing reached the editor.
- An animation that only changes CSS variables (a registered `--angle` turning a conic gradient on Resend) is listed, not passed over in silence.
- An icon may have up to 64 parts (logos, such as Mercury's).
- A background clipped to text (`background-clip: text`) colors the text bars instead of filling the box. The "gradient border" mask (a content-box layer excluded from the whole box) is drawn as a ring in the gradient's average color.
- A gradient keeps its tile (`background-size`, `background-position`, `background-repeat`), so a skeleton shimmer's highlight slides across and comes back in from the other side. `background-position` is now previewed, worded "moves its background".
- A shape's resting `filter` is drawn (blur, grayscale).
- A non-uniform scale toward full size reads "scales from 0 wide by 1 tall to full size".
The sweep also counts motion driven by script frame by frame (inline styles changing every frame, with no browser animation): three elements in 23 sites (on Framer, Figma and Airbnb). These sites animate almost everything with CSS.
**Why:** asked to "try it on websites like stripe, vercel, mercury".
**Gave up:** script-driven motion is still not captured. Animations of SVG groups (`<g>`, Railway's trains) are listed as left out. A canvas blur is not scaled with the preview's zoom.

### D118. Animated SVG groups
**Chose:** a new shape kind, `group`, for a `<g>` that animates. It holds the parts inside it. Its `transform` is its whole transform when it was measured, and `inSvg` maps its parent's coordinates to the SVG's box. Its parts keep the positions they had then. The stage applies only the change, the animated transform times the inverse of the measured one, in the SVG's coordinates, so a group already moving when picked is not moved twice. A group that only starts animating during the take (a class added on hover) gets its shape then: its existing parts move into it, measured against its base transform; new parts are measured together with it. An animation inside an SVG `<mask>` or `<clipPath>` is listed as a cut-out the preview cannot draw.
**Why:** asked for, after Railway's trains were "left out of the simplified drawing". On Railway itself they turned out to be a mask (a cut-out that reveals the logo), which the note now says. Groups that are drawn content (illustrations, icons whose parts move together) are drawn.
**Gave up:** masks themselves are still not drawn.

### D119. Layout animations, measured
**Chose:** while a take animates anything that can affect layout (not only colors, transforms, opacity and the like), capture reads each part's layout box every frame (offsets, without transforms; it only reads). When the take ends, a part's movement relative to its parent shape, and its change in size, become tracks with a new origin, `layout`: `left`, `top`, `width` and `height` in px, with up to 30 keyframes (Ramer-Douglas-Peucker, half a pixel). Changes a part's own animations already describe are left to them. The stage draws them like any size or position track and fits where they take things. Descriptions add one sentence ("2 parts move with the layout."), the timeline names them "Moved by layout" and "Resized by layout", and the CSS export leaves them out: they are what the browser did, not CSS to write.
**Why:** asked for. The preview has no layout engine, so an accordion opening did not push the items below it down, and margin and grid animations moved nothing. Measuring the page is exact where a layout engine would be a guess.
**Gave up:** a layout track is linked to the take's own timing but not to its curve: editing an animation's curve does not reshape the layout's response. A pseudo-element in the flow of text is still not measured (daisyUI's toggle knob).

### D120. A transition restarted every frame is one take
**Chose:** a take cut off by a restart of the same property within 100 ms is held back. A run of three or more becomes one take, the last, with a note ("restarted N times in a row, most likely by a script"); fewer are sent as usual, so a quick hover-out is still its own take.
**Why:** on Railway, a script nudged a transitioned element every frame and one hover made 91 takes, which would have filled the extension's list.
**Gave up:** the motion the script makes is not reconstructed.

### D121. The compare harness captures from an untouched run
**Chose:** compare.cjs photographs the page during a paused, seeked run, and takes its capture from a second run of the same trigger that nothing pauses.
**Why:** layout is measured every frame; on the paused run it recorded the seeking itself.
**Gave up:** each case takes a few seconds longer.

### D122. The panel: following tabs, takes named by trigger, stopping by itself
**Chose:**
- The panel follows the tab in front: switching tabs or going to another page clears a stale message, so Pick element is ready without reopening the panel. Where access is missing, the panel offers "Allow on all sites" (the optional host permission that was already declared, asked for only on that click), so pages never need the toolbar icon again. Not asking leaves access per tab, as before.
- Each take records what set it off (`Capture.trigger`): hover in, hover out, hover in and out, click, focus, focus lost, key press, loops, already running, or on its own, from pointer, press, key and focus events the capture script listens to passively. A transition already under way when recording began, with the pointer on the element, is the hover that picking started. The list groups takes under the element they belong to and names each by its trigger, with its length and time, and its summary in full.
- Recording stops by itself 1.5 s after a take is complete, once the pointer is off the element (a hover's way back may still come). "Record again" records the same element without picking it.
**Why:** asked for: "annoying that I need to close and open the extension every time I switch pages", "hover in and out and other states get mashed together… takes looks like a mess", "can't the tool activate the animation for me, listen and then stop on its own?"
**Gave up:** the tool does not set off a hover by itself. Synthetic events do not set CSS :hover; only a real pointer or Chrome's debugger does, and the debugger needs a permission the brief excludes and shows a "being debugged" bar. Picking by click already leaves the pointer on the element, so its hover is captured.

### D123. Play is always in view; sections are tabs on one column
**Chose:** Play, the time, loop and speed sit under the preview, which stays pinned at the top on one column and on two. On one column, the sections below it are tabs (Timeline, Curve, Export, Not shown) instead of one long page. Speed is a small menu, so the controls fit one row in the side panel. The time reads "117 of 400 ms". Notes that were cut short wrap instead.
**Why:** asked for: "need to scroll up to have the play button", "the UI looks messy". The side panel was over 2,700 px of stacked sections.
**Gave up:** on one column, the curve and the timeline are not seen at the same time.

### D124. Motion a script makes is filmed and fitted
**Chose:** while a take is open, capture films the parts that move, about 25 times a second: each one's whole transform (translate, rotate, scale and transform, in 3D) and its opacity, read with `getComputedStyle` (it only reads). A part whose inline style a script changes (seen by a MutationObserver on the picked element) is filmed right after each change, in the same frame: filming in capture's own frame callback could run before the script's and see every frame one frame late. When a part moved with no browser animation of its own, its film is fitted (core `fitMotion`): first one cubic-bezier for the whole motion, as a person would write it; if that misses the film by more than the tolerance anywhere (half a pixel, a tenth of a degree, half a percent of size, a percent of opacity), keyframes are added where it misses most, linear between them, up to 30. That is one `transform` track and one `opacity` track with a new origin, `script`, which play, edit and export like any other. A script that never stops is cut at 4 s, with a note. The film is kept with the take (`Capture.measured`).
**Why:** asked for ("measure script-driven motion"). Springs and motion libraries that step values in JavaScript left nothing for `getAnimations()` to find, so the preview showed nothing.
**Gave up:** a spring becomes keyframes, not a spring: its stiffness and damping are not recovered, so editing its duration stretches the measured shape. Motion made by changing a CSS variable or a class that is not a transition is still not seen.

### D125. The preview checks itself against the page
**Chose:** the editor plays the original capture to every filmed moment and measures where each corner of each filmed part lands against the page, and the difference in opacity. One line under the source says the result: "Checked against the page: within 0.4 px and 0% opacity over 38 frames", or "off by up to 6 px and 0% opacity, most on div.card at 220 ms". Under 1.5 px counts as within; the number is always given.
**Why:** asked for ("compare the editor preview's numbers with the measured film frame by frame and report the error"). It turns "looks close" into a number, for every take, on real pages.
**Gave up:** it checks the transform and opacity, not colors, sizes or shadows, and it checks the capture, not my edits.

### D126. Parts that follow the pointer
**Chose:** capture listens passively for pointer moves and keeps their path in the picked element's coordinates. A part a script moves while the pointer is on it is fitted to a rule (core `fitFollow`). Three drivers are eased toward where the pointer says: on (1 on the part, 0 off it, over onLagMs) and x and y (where the pointer is across the part, -1 to 1, over lagMs). Each number of its transform and its opacity is rest + on × (base − rest + perX × x + perY × y). Two lags, because many scripts ease in and out slowly but follow moves at once: vanilla-tilt sets a CSS transition only for coming and going. For given lags the rule is linear, so it is solved by least squares; the lags are searched. A part with transform transitions of its own is still tried: tilt scripts restart one with every move, and when the rule matches the film, it replaces them. When the rule matches the film (within 2 px of move, 3% of size or lean, 5% of opacity) and the part does lean with the pointer, it becomes a `Follow` (`Capture.follows`) instead of script tracks. A take stays open while the pointer is on a part a script moves. In the editor, moving the pointer over the preview moves those parts by the same rule and lag; the self-check plays the rule along the recorded path. Copy for AI writes the rule out, the CSS export says it needs a script, and the description says what it does ("div.card follows the pointer: it turns toward it in 3D, catching up in about 80 ms.").
**Why:** asked for ("pointer-following motion, tilt cards"). These have no duration to put on a timeline: what is worth keeping is how they follow.
**Gave up:** the rule is linear in the pointer's place: a glare that turns with the pointer's angle (vanilla-tilt's) cannot follow it and is shown as measured over time, which the self-check reports as far off. A spring that overshoots is matched by the lags alone. A glare drawn through a CSS variable is not seen. vanilla-tilt's way back, a transition its script starts as the pointer leaves, is its own take and its card is not yet in it (the self-check says 9 px).

### D128. A restart does not cut the film
**Chose:** takes cut off by a quick restart (D120) no longer take the film with them: it goes on with the take still running, which starts at its first frame of a script's film when that came first.
**Why:** on vanilla-tilt every pointer move restarted a transition, the chain was dropped as "restarted N times", and the first 430 ms of film, the whole arrival, went with it. The rule could not be found without it.
**Gave up:** a short chain sent as separate takes (fewer than three) has no film of its own.

### D127. A turn in 3D is drawn tapered
**Chose:** the 3D transform is no longer only flattened. A flat element under a 3D transform with perspective is seen through a projective map: the six numbers of matrix() plus two more, g and h (w = g x + h y + 1). Capture films them (`taper` on each measured frame), including a parent's `perspective`, and the probe reads them from animated transforms. The stage draws a turned shape once on its own canvas, then puts that picture down in a 6 by 6 grid of triangles, each with the canvas transform that puts its three corners exactly where the turn puts them.
**Why:** flattening threw away the direction of a tilt: rotateY(8deg) and rotateY(-8deg) both only made the card 1% narrower, so a tilt card barely moved in the preview. Canvas 2D has no perspective transform, and drawing each half's layers separately let them blend along the seam.
**Gave up:** the picture is drawn at the stage's resolution, then mapped, so a strongly turned shape is a little softer than the rest. A shape turned past edge-on is drawn flat.

### D129. Play the hover, with Chrome's debugger
**Chose:** the `debugger` permission is required, used only by "Play the hover": while recording, the panel attaches the debugger to the tab, moves a pointer in from the left, across the element and out to the right (`Input.dispatchMouseEvent`), and detaches. CSS :hover and the page's own pointer handlers react as they would to a person. The page is only pointed at: nothing is paused, changed or restyled.
**Why:** asked for: "when I pick an element can't the tool activate the animation for me". Events made by a script never set :hover; a pointer from the debugger does. The brief's permission list left `debugger` out; asked, and chosen: required for everyone, because Chrome does not allow `debugger` as an optional permission (its permissions page names it among the eight that cannot be).
**Gave up:** Chrome warns about the permission when installing, and shows "started debugging this browser" while the hover plays. The extension asks for five permissions, not four.

### D130. Closing the panel stops the page
**Chose:** the injected bridge keeps a connection open to the panel. Chrome ends it when the panel closes, and the page then cancels picking and stops recording.
**Why:** asked for: "when I close the extension the picker should stop". The picker stayed on the page with nothing to report to.

### D131. Drawn properties a script changes are filmed too
**Chose:**
- Besides transform and opacity, the film keeps the computed text of clip-path, filter, background-color, background-position, box-shadow and color. Where a script changes one and the text around its numbers stays the same, each number is fitted (D124) and the keyframes are written back as CSS text: one track per property.
- A wrapper that only clips with a clip-path gets a shape, so its cut is drawn.
- The preview reads clip-path lengths written as calc() of px and %.
- A script's transform track keeps a turn or a mirror that holds still: it replaces the whole transform.
- A hover merged with its way back keeps its film in order: the way back starts where the film shows the part moving again.
- With several background layers, the most opaque one is drawn.
- The preview fits around what clip-paths leave visible and what is drawn, not around empty wrappers.
**Why:** Vercel's cards peel their corner back on hover: a spring writes clip-path polygons on two layers, and a mirrored flap carries a gradient. Nothing of it was captured. Now it checks within about 2.5 px against the page.
**Gave up:** a gradient a script changes (the flap's shading) is drawn as it was when picked. Background images other than gradients, and other properties, are not filmed.

### D132. A quieter interface
**Chose:** fewer words and fewer boxes, nothing taken away.
- The panel has one toolbar: Pick element (or Play the hover and Stop), and a "More" menu for clearing takes and the debug report. The status is one short line, and none when there is nothing to say. First open shows one heading and one sentence.
- Takes are compact rows; the time of day is in a tooltip.
- In the editor, the self-check is a small badge ("Matches the page · 0.3 px", green, or "Off by 8.5 px", amber) whose tooltip has the full sentence. Undo, redo and reset are icons. The view's options (original, ghost trail, single or side by side) are icons above a larger preview. Play is a round button.
- Help that was paragraphs (how the timeline, the curve and the speed graph work, and the keys) is behind a "?" beside each title. CSS terms under the fields are their tooltips.
- Colors, type and shapes follow the system's own (gray fills instead of outlines, cards with a soft shadow, the system blue), in light and dark. The fixtures page keeps its own fixed look: it is test data.
**Why:** asked for: "too messy, too much text; minimal, intuitive and easy to use".
**Gave up:** the help is one step further away: pointed at, not read at a glance.

### D133. Edges as designed: every shadow, borders per side
**Chose:**
- Capture keeps every box-shadow layer, top first, with its spread and whether it is inset (`Shape.shadows`, a new optional field; `shadow` stays for older takes). The probe reads every layer of an animated one too.
- The stage draws outer shadows under the shape and only outside its box, as CSS does, and inner shadows over the fill inside it, each from a shape drawn far off whose shadow is cast back.
- Borders are read side by side: a side with no width or no style is transparent. An element counts as drawn when any side has a border, or when it has a box-shadow or an outline.
- Outlines (a focus ring left by a click, an outlined button) are read (`Shape.outline`, new and optional) and drawn at their offset, dashed or dotted as on the page. Found on Linear: its nav buttons keep a focus ring after a click.
- The test fixtures keep their own fixed look, apart from the tool's design tokens.
**Why:** asked for: "make sure the previews show CSS elements that are important to the design, like shadows". Many cards' edge is a "0 0 0 1px" ring shadow, with layered soft shadows under it; a tab or a field often has only a bottom border. These were missing or drawn as a full box.
**Gave up:** with different widths per side, the widest is used. An outline that animates is drawn as it was when picked. Backdrop blur is not drawn.

### D134. Found by checking every element against the page
**Chose:**
- A finite transition already under way when recording began (the hover that picking by click started) starts the take, like any other; only endless ones keep a negative delay.
- translate's percentages and calc() are resolved against the element's own box, when filming and when reading the resting transform.
- A part fading when picked keeps both ends of the fade: a take with the fade draws it from the start, a take without it shows it where the fade was going.
- A part with no box (display: none) or hidden is filmed as unseen, whatever its opacity says.
- A transform track is "no change" only when its functions and the browser's own 3D matrix both agree, so 3D turns are kept.
**Why:** the sweep now runs every element twice, once untouched, and reads the editor's self-check for each. Each of these showed as a large miss on a real site (see REAL_SITES.md, pass seven).
**Gave up:** a parent's perspective is still not carried into the preview.

### D135. Fitting stays out of the page's way
**Chose:**
- A curve for filmed motion is found by searching only x1 and x2 (121 points, then finer steps). For each pair the best y1 and y2 are solved exactly: the progress is a straight sum of them once x1 and x2 are known, so two unknowns are a least squares in closed form. The five curves CSS names are tried first, and kept when they fit.
- The follow fit skips numbers that never leave rest, and gives up on a pair of lags as soon as it scores worse than the best so far.
- Both have tests that time them, and one that 95 of 100 random cubic-beziers, overshoot included, are found again as one curve.
- `tests/freeze-sites.cjs` records real pages, as the extension does, and times their frames; with PROFILE=1 it says which capture functions took the time.
**Why:** reported: "it keeps freezing the page when I record", on hover and click. Both fits run in the page when a take ends. The old curve search tried 6,400 curves at every frame of the film: 55 ms for each moving part, one fit per moved property, so a hover on a card a script moves held the page for 100 ms or more, in and out. Now: 0.18 ms per fit (295 of 300 random curves found as one curve, against 66 before), and the follow fit is three times faster.
**Gave up:** nothing measured. The fits still run in the page's frame when a take ends: a few ms, not spread over several frames.

### D136. A parent's perspective, and faces that hide their backs
**Chose:**
- Two new optional shape fields. `perspective` is the parent's CSS perspective as it acts on the shape: the distance and where the viewer looks from, relative to the shape's transform origin (null when the parent has none). `backfaceHidden` is CSS backface-visibility: hidden (false in older takes).
- The probe puts the perspective in front of the shape's own transform, as capture's film already did, so a turn in 3D narrows as on the page. A face with a hidden back is not drawn while it faces away, decided as Chrome does: the turned normal points away from the viewer.
- backface-visibility is read when each animation begins, not when the element was picked: what set it off may change it. daisyUI's flip hides one face's back and shows the other's in the same click.
- The film counts a face turned away as unseen, so the self-check agrees.
**Why:** the last large miss of the seventh pass: daisyUI's flip was drawn flat (16 px off mid-turn), and both faces showed through the turn. It is now within 0.1 px and 0% opacity. A fixture (35, card flip) and tests cover it.
**Gave up:** only the nearest parent's perspective, as filmed. A resting 3D turn with no animation is still drawn from its flat 2D matrix.

### D137. Script-moved hovers: one take in, one take out
**Chose:**
- Where a script moves parts, the pointer crossing the picked element's edge cuts the takes: the motion on the way in is one take ("Hover in"), the motion on the way out another ("Hover out"). Film is split at the crossing; the second take starts with the last frame before it, so it starts exactly where the first ended. A take that ended earlier leaves each part's resting frame for the next take to start from.
- A hovered take ends once the part has been still for 400 ms while the pointer kept moving over it: it has arrived, it does not follow the pointer. A tilt card keeps moving with the pointer, so its take stays open. A still end (the pointer resting) is trimmed off a cut take.
- Takes with script motion are never merged into one "hover and leave" take. CSS-only hovers still are (D96).
- When picking left the pointer on the element, the script motion before it first leaves is dropped: it began before recording, so its start was missed. It used to come out as "Already running" (a CSS transition from the pick in the same take decided the name).
**Why:** reported on Vercel's peeling card: "Already running" and a merged hover out; asked for hover in and hover out cleanly separated, the hover out starting at the hover in's end. Now: Hover out 550 ms, Hover in 550 ms, Hover out 567 ms, each matching the page within about 1 px.
**Gave up:** with the pointer held perfectly still on a part, a settled part cannot be told from a tilt card waiting for the next move: its hover in arrives when the pointer leaves.

### D138. The preview draws what makes Vercel's peel: grouped filters, moving gradients
**Chose:**
- A CSS filter acts on the shape and everything inside it after they are drawn: they are drawn on a canvas of their own and put down once through the filter, its lengths scaled to the stage. A drop shadow on a wrapper now falls outside the clip of the part inside it, as in CSS (the peeled flap's shadow).
- background-image is filmed when a script rewrites it, as text, gradients only: a URL is page image data and is read as none. The probe reads it, and the stage draws a linear-gradient() from its text, with stops in px or %, as CSS places them.
- The selected part is no longer outlined in blue all the time. It read as an edge of the design (around the peeled corner). Pointing at a part, here or on the timeline, still outlines it.
- Every gradient layer of a background is kept (`Shape.gradients`, a new optional field, top first, each with its own tile; `gradient` stays the one layer that shows most, for older readers) and drawn bottom first. A repeating tile is drawn once and laid over the shape as a pattern, at no less than one canvas pixel per CSS pixel: a 1 px line drawn at the preview's scale is narrower than half a pixel and would vanish; shrunk smoothly, it fades, as on a small screen. The grid over Vercel's blue is drawn.
- The panel's More menu closes on a press outside it and on Escape, which returns focus to its button.
**Why:** reported: "look how the shadows are wrong here" (the flap had no shadow, wrong shading and a hard blue edge), "also draw the grid lines on the blue", and "three dot menu won't close unless I click the three dots again".
**Gave up:** a moving gradient is drawn from its first layer, and only when it is linear; a moving radial or conic one keeps its resting look. A stop past 100% (Vercel's blue ends at 160%) is drawn at 100%.

### D139. What CSS variables move, parts that leave, and a calmer start
**Chose:**
- An animation of CSS variables only (custom properties) moves whatever uses them through var(): the element and the drawn parts inside it are filmed while it runs, and each part that moves is measured, as a script's part is. The variable's own tracks and the note that it could not be shown are then left out: the measured motion shows what it does. NumberFlow's rolling digits went from 415 px off to within 1.2 px.
- A filmed background-image becomes a track only when it is a linear gradient the preview can draw; a conic one turned by a variable is still listed as not shown.
- The description no longer says "A script moves N parts": the motion of N parts "was measured from the page", by a script or a variable.
- A part taken off the page during a take (MUI's click ripple, a toast that leaves) is hidden from that moment: a measured visibility track, from the frame that saw it gone to the end of the film, held only forwards. A part made after the pick is measured as soon as it animates, since it may be gone before the take ends; parts that were there but hidden are still measured at the end, when their size is known.
- The self-check counts a hidden part as opacity 0, and ignores where a part is while it is unseen both on the page and in the preview.
- A press inside the element names its take "Click", even though the press also moved focus (Sonner's toast button was named "Focus").
- The panel, while picking or listening with nothing captured yet, shows one sign, one word and one line in its middle ("Listening", "Hover or click it on the page."), instead of a small line under the toolbar over an empty panel. With reduced motion the sign does not pulse.
- On wide screens, Export and the notes sit under the timeline, so the two columns end near each other; the export text wraps instead of running past the panel's edge.
**Why:** a pass over new kinds of sites (Sonner, NumberFlow, hamburger icons, Radix, Mantine, GSAP) and the full sweep: 221 elements, all within 1.4 px but MUI's ripple (100% opacity off) and Stripe's caret (2 px).
**Gave up:** NumberFlow's digits are columns of numbers behind a CSS mask, which is not drawn: the motion is right, the picture does not read as numbers. Only parts inside the element are filmed for a variable, at most 80.

### D140. Fewer, plainer words: one row per shorthand, colors named, a short headline
**Chose:**
- Longhands of one shorthand (border color, border width, corners, padding, margin) on one part that start together with the same timing are linked at capture, with their ways back. The timeline shows them as one row named by the shorthand ("Border color", border-color); its checkbox shows or hides all of them, and timing edits reach all of them through the link. The table of shorthands is core's, shared by capture, the description and the export; padding and margin were added to it.
- Every property a capture can hold has a plain name in the timeline ("Clip", "Background image", "Shown or hidden", "Margin, left"...).
- The description speaks as a person would: sizes and angles of 10 or more in whole numbers, smaller ones to a tenth (311.34 px is 311 px); times in whole ms; delays under 1 ms left out. "Through N keyframes" is kept for keyframes an author wrote (a bounce has stages) and left out for measured motion, where it only says how closely the film was followed.
- Color changes are named, not quoted: the color as seen over the page's backdrop, roughly named (gray, blue, purple...): "turns its background from gray to blue", "darkens its border". The exact values stay in the timeline, Copy CSS and Copy for AI.
- A description longer than about three lines shows its first three, and More. The whole text stays in the page for screen readers.
**Why:** the side panel on Vercel's card read "changes clip-path through 22 keyframes over 549.9 ms... moves 311.34 px left... from rgba(0, 0, 0, 0.08) to rgba(0, 0, 0, 0.21)", over eight rows, four of them one border.
**Gave up:** a color's name is approximate, by hue ranges.

### D141. Menus and dialogs that open at the end of the page
**Chose:**
- When a press or a key on the picked element is followed, within 600 ms, by an animation on a part that was not in the page when the element was picked, that part was opened by it: a menu, a dialog or a popover put at the end of the body (a portal). Recording moves to it, as it moves to a nearby parent, and the panel says "Watching div.isolate, the part that moves." The part recorded is the outermost new one that has a size: a portal's host is often an empty box with the menu fixed inside it (shadcn).
- A take whose animations were already running when recording moved is named by a press or key just before them ("Click"), ahead of hover: a menu often opens under the pointer.
- If recording cannot move after all (the part cannot be drawn), it goes on where it was, instead of stopping without a word.
- A take whose only content is "ends where it starts, nothing to see" is not sent once a take with motion has been: it only adds a row (MUI's menu paper settling back).
- A filter of functions that change nothing (blur(0px), brightness(1)) is none: "changes filter from blur(0px) to none" is no change.
- The parts of a movement join the list of changes ("moves down 8 px, scales from 0.95 to 1 and fades"), instead of "and ... and ...".
**Why:** shadcn's dropdown and dialog, and MUI's menu, open in a portal: picking their button captured nothing of them. Now each is one "Click" take, within 0 px of the page. Fixture 38 covers it.
**Gave up:** a portal that existed at pick time and was only hidden (a Bootstrap dropdown kept in the page) is not followed this way; it is usually inside the picked element's parent, where the nearby-parent rule finds it.

### D142. Animations that follow the scroll
**Chose:**
- A track may follow the scroll instead of time: `Track.scroll`, a new optional field, holds its CSS animation-timeline ("scroll()", "view()", or a name such as "--page-scroll") and animation-range ("entry 25% cover 50%"), as computed. null for time (and in older takes). A new trigger, "scroll", names a take of them ("On scroll" in the panel).
- They exist from the moment the page loads, so they are listed as soon as the element is picked, as one take. Their progress, 0 to 100% of their range, is shown over a nominal second: the preview, the timeline and the curve all work on that second. Delay and duration are shown but cannot be changed (they do not exist for scroll); the curve can. A row says "scroll", and its timing line says what the second stands for. Dragging its bar moves the playhead.
- The CSS export writes duration "auto", then animation-timeline and animation-range after the animation shorthand, which would otherwise reset them. A named timeline gets a comment: the scroller that names it is elsewhere on the page.
- The description says "as the page scrolls" or "as it scrolls into view" instead of a duration. They are not filmed: they stand still while the take runs.
- A scale in one direction only is said as such: "widens from nothing to its full width", not "scales from 0 wide by 1 tall to full size".
**Why:** scroll-driven animations were listed as "not shown". Checked on scroll-driven-animations.style: a reading-progress bar on a named timeline, an image revealed over "entry 25% cover 50%", a contact list fading in and out with view().
**Gave up:** the preview does not scroll; it plays the range over time. A timeline made by script (a ScrollTimeline object) is written as scroll() or view(), without its source or axis.

### D143. Decorative loops: conic gradients, stacking order, plain sizes
**Chose:**
- Conic gradients are read and drawn: a new gradient kind, "conic", with its start angle (as CSS: 0 up, clockwise), its center as a share of the image, and stops as shares of a turn. Canvas draws it from 3 o'clock, CSS from 12: a quarter turn back. A spinning border light (Magic UI's shimmer button) was a flat average color.
- Parts are drawn in their stacking order: each part's children are sorted by the z-index of the outermost positioned element they belong to (0 when none), keeping document order otherwise. Magic UI's label (z-index 10) was hidden under the black panel after it (-30).
- Lengths in calc() are worked out against the box when a value is read, as they already were when filming: a marquee's translateX(calc(-100% - 16px)) "moves left 816 px".
- Animations running when picked that never end are named "Loops", not "Already running".
- Times from a second up are said in seconds ("over 1.2 s", "over 20 s"). Width and height changes are said as "widens", "narrows", "grows taller", "gets shorter"; visibility as "appears" and "disappears".
**Why:** Magic UI's components (shimmer button, marquee, animated gradient text, ripple) and product sites' navigation (Apple's flyout). All matched the page; what they said and showed did not.
- Parts are named by a class that names something: utility variants and arbitrary values ("focus-visible:outline-2") and hashes ("css-1lf4hs") are passed over for the next class. The name is still a real class, so it still works as a selector in the export.
- A take cut where the pointer crosses the edge is named by how it ended: the pointer leaving ends a hover, coming back ends a leave. The nearest event to its start had named a hover "leave".
- Recording that moved to a parent (because that is what moves) keeps what is already happening: only a recording started by a pick drops the pick's own hover.
- A part follows the pointer only if the pointer was on it while the take ran: a way out with the pointer gone is motion settling back, measured as it is. A follow fitted to it started at rest, where the card was still turned.
**Gave up:** a negative z-index part is drawn above its parent's own background, not under it. Aceternity's 3D card: its hover follows the pointer (2.2 px), its leave settles back (0 px).

### D144. Parts that come and go, read honestly
**Chose:**
- A part taken off the page is no longer sampled for layout, and where a sample has no box, the part is where it was last seen. MUI's removed ripple was read as moving to -385 px and shrinking to nothing: six "moved by layout" rows of noise.
- A part is filmed from the first frame its animations are on screen: in the frame it appears, they may still be waiting to start, and it shows as it would at rest.
- The self-check leaves out frames from before the take starts: the preview shows nothing there to compare.
- A part that was seen when picked but had no shape of its own (a heading of text only) is given its shape as soon as it animates, from the box measured then, as a part made after the pick is. Measured at the end, it could be gone: Magic UI's rotating word fades out and is removed, and was "left out of the drawing".
- A part still on the page but no longer drawn at the end of the take (display: none, by a class) is hidden from when it went, as a removed one is.
**Why:** the full sweep, now 278 elements, all within 1.4 px but three: MUI's ripple (fixed), GitHub's dialog, and Stripe's caret (2 px). GitHub's dialog plays its 200 ms animation late and in steps over a second on that heavy page: the self-check is right to say the page did not play what its CSS says.

### D145. The description is not worked out on every frame
**Chose:** the editor works out the plain-words description when the capture or an edit changes, as it already did for the exports and the self-check, not on every render. It samples every track's curve, and during playback every frame renders.
**Why:** measured with the CPU slowed four times, playing NumberFlow's capture (about 30 tracks): one frame in twenty took 83 ms, the worst 100 ms, and the description was a third of all the time. Now 33 ms at worst, the rest React's development overhead.

### D146. Motion a script ties to the scroll is named "On scroll"
**Chose:** scrolling is noted on the page, at most every 100 ms. A take during which the page keeps scrolling after it starts (two scroll events or more within 600 ms of its start) is named "scroll", as a scroll-driven CSS animation is. Scrolling that ends before it starts (a card scrolled into view, then hovered or clicked) does not count.
**Why:** a script that moves parts with the scroll (GSAP's ScrollTrigger) was named by whatever crossed under the pointer as the page moved: "Hover in". The first rule, any scroll just before, named an ordinary click "scroll": a click scrolls its button into view first.

### D147. translate, rotate and scale apart from transform
**Chose:** each moving part keeps its CSS translate, rotate and scale (the properties apart from transform) as computed when its first animation in the take began: `Shape.individual`, a new optional field. The preview applies them with an animated transform, as CSS does, unless the motion was measured (the film already has them in).
**Why:** Stripe's nav caret checked 2 px off in every sweep: its two halves are set apart by "translate: ±2px", set by the class that also turns them, and only the turn animates. The preview dropped the translate. Tailwind 4 writes its translate, rotate and scale utilities this way, so a part centered with -translate-x-1/2 and scaled on hover would have been drawn half its width off. Fixture 39 covers it; Stripe's caret now checks at 0 px.

### D148. Measured motion has a path, not a curve
**Chose:** when the selected row is measured (a script's motion or the layout's) and followed by more than two keyframes, the curve and speed panels say what it is ("Measured from the page, frame by frame: this motion has no curve of its own, only the path it took. Change its timing on the timeline.") instead of offering a curve per stretch between keyframes. Measured motion fitted to one curve still shows that curve, to edit.
**Why:** Vercel's peel offered 22 chips, "0 to 3%" to "73 to 100%", each a straight line: not curves anyone wrote, and editing one would only put a kink in the path.

### D149. Dialogs: the part with content, centered as on the page
**Chose:**
- When several parts open elsewhere at once, the one holding the most of what moves is recorded, and between equals one with content, not an empty backdrop. While all that has opened is empty (a backdrop alone), the choice waits up to 60 ms for the rest; a part with content is followed at once, before a short motion is over.
- A part's translate is kept in px (its % worked out against its own box), so the preview, which has no element, places it right.
- A part whose transform was animating when picked keeps its resting translate, rotate and scale, if those do not animate: only the transform's own value was mid-motion.
**Why:** Ant Design's modal was followed by its backdrop, beside the dialog in an empty container; shadcn's dialog, centered by "translate: -50% -50%", was drawn 245 px off once its opening was over. Both now check at 0 px.

### D150. Special kinds of motion
Tested on a page of 24 special cases and on Shoelace's web components.
**Chose:**
- **Popovers and dialogs.** A native popover or `<dialog>` is on the page all along and only shown in the top layer when opened. One that was closed when picked and opens after a press on the picked element is followed, as a part opened elsewhere is (D143). A dialog's `::backdrop` is listed: it covers the whole page, not a part of it.
- **Speed and direction of the player.** A Web Animation's playbackRate is applied to its timing: every length divides by the rate. One played backwards (`reverse()`) has its direction flipped, its delays and fills swapped, and starts where it is now. A pending player reports its old rate until it is ready, so the timing is read again then. The description says backwards motion in the order it is seen, with its curve mirrored.
- **Composition.** An effect that adds to the value under it (`animation-composition: add`, `composite` in `element.animate()`) is listed, as keyframes that add already were. The underlying value would have to be read without the animation, which would mean pausing the page's animation.
- **SVG lines drawn by their dash offset.** Only the offset animates; the dash length kept at rest is used with it. The line was drawn whole.
- **Motion along a path.** `offset-path: path()` is sampled once, with an SVG path the page never sees, into 129 points evenly spaced by length: `Shape.offset`, a new optional field. Core places the part on them (`offsetMatrix`): its anchor on the point, turned with the path unless `offset-rotate` says. The film and the resting transform include it, so the self-check sees it too. A basic shape (inset(), which rect() and xywh() compute to, and circle()) is turned into the same path, the way Chrome walks it: on the containing block's border box, from the end of the top-left corner (a circle from its rightmost point), clockwise. A script that writes the distance every frame (Motion's border beam on Magic UI) is filmed by that distance when the path explains all of its transform, and by the transform otherwise. ray() and url() are drawn where the box is.
- **A conic gradient turned by a registered variable** (`@property --angle`). It is filmed, as other motion a variable drives is. Chrome writes "from 0deg" out of the text at 0 degrees; it is written back, and angles that wrap (350 then 10) are read as going on (370). The probe blends gradient texts number by number, as CSS does not blend background images. A loop of it keeps its take open for one whole turn, so the preview loops as the page does.
- **View transitions.** Each named part moves as a picture in `::view-transition-group(name)` on the page's root. That group's animation is read as the part's: translate from where it was at pick, and its size. Pointer crossings during a view transition (its pictures cover the page) and just after it (the pointer is found over the page again) are not crossings. The part's own film is left out of the self-check: the part is already at its new place while its picture moves. The cross-fade between old and new looks is listed.
- **Border widths** are drawn as they animate, blended from their px numbers (the probe's element has no border style, so the browser computes 0). Inset shadows are drawn inside the border, as CSS does: a ring that fills a box left a bar as tall as its two borders.
- **Plain words** for clip-path reveals ("is revealed from left to right", "in a growing circle"), skew ("slants"), turns in depth ("tilts back", "flips over"), borders ("thickens its border"), outlines ("moves its outline out"), blur ("comes into focus"), paths ("moves along its path"), dashes ("draws its line"), turning gradients and sizes to fit the content.
**Why:** each was wrong or missing on the test page: popovers and dialogs gave no take; a doubled rate checked 51 px off, `reverse()` 22 px, composition 40 px; the path and the dashes looked still while the self-check, which compares boxes, said 0 px; the variable's ring was listed; a view transition gave no take, then was named "Leave". All now check at 0 px, or are listed with the reason.

### D151. Picking does not record
**Chose:** Pick element only picks. The panel then names the element and offers three ways to start: Record (the user sets it off), Play the hover, and Play the click. Recording starts only then. Play the click moves the pointer onto the element and waits for its hover to settle before recording starts, clicks, waits for the click's take, stops recording, and only then moves the pointer away: one take, the click. When recording stops, the panel goes back to the picked element, ready to record it again ("Record again" is gone). A take made only of what was already moving when recording began, and not a loop, is not listed.
**Why:** recording began the moment the element was picked, so the hover that reaching for it started was recorded halfway, as "Already running" (reported on vercel.com). The user asked for recording to start when they choose.

Also for Play the hover: the element is scrolled into view at once, even on a page that scrolls smoothly (the pointer moved while the page was still gliding, and the take was named "On scroll"), and when something covers its middle (a fixed header) the panel says so rather than playing into the cover.

### D152. Play the load: animations that play as the page loads
**Chose:** a fourth way to start, beside Record, Play the hover and Play the click. With the debugger (already asked for, D129), the panel puts the capture script into the page before the page's own scripts (`Page.addScriptToEvaluateOnNewDocument`) and reloads it. The script finds the picked element again (by a path of child positions from the nearest parent with an id, or by its short selector and its place among what that matches), waits frame by frame until it is drawn, and records it from that frame: what is already running then is what the load set off, not something running before the pick. Its takes are named "load" ("On load"), a new optional trigger. The panel reads the takes back through the debugger once recording stops by itself (at most 12 seconds), takes the script out again, detaches, and puts its usual scripts back on the new page with the same element chosen.
**Why:** asked for by the user: entrances were over before anything could be picked. Nothing in Chrome lets an extension's script run before a page's own without asking for access to every site up front, or for the debugger, which the extension already has.

### D153. What the preview cuts, what it draws, how a take is named
**Chose:**
- The clipping frame adds back the translations of the parts between it and the picked element (layout leaves transforms out). One that turns, scales or tilts leaves no frame: nothing the page shows is cut.
- A part with no shape (past the 40 drawn, which are taken in page order) that a script writes to during a take gets a shape then, as one that appears does.
- A take is named by when its own motion began: loops already running when picked are left out of that.
- The note says "more parts were left out", not "smaller": they are the ones later in the page.
**Why:** a round button on oliverhassan.dev was drawn cut in half: it sits in a box centred with left: 50% and a -640 px translate. Vercel's backends card left out its peeled flap, the last part of a busy card, and its hover was named "Loops" by the chat's typing dots, running since long before.

### D154. The preview says when it differs from the page
**Chose:**
- While a take runs, every part under the picked element that draws something (up to 300) is looked at about eight times a second: its place, size and opacity, and its look (colors, clip, filter, dashes). A part that changed step by step, with two different changed values or more, and that nothing in the take explains (a track or rule of its own or of a part around it, or an animation the browser lists) is named in a new optional field, `Capture.missed`. An instant change, such as a :hover color with no transition, is one step and is not named.
- Between takes it is watched more slowly (about three times a second). Something that moves with nothing the browser lists and no style a script writes (an SVG `<animate>`) gives a take with no tracks that names it, once it settles or when recording stops, instead of nothing at all.
- The badge is green only when nothing is known to differ. Otherwise it says the first of: parts missing, properties not drawn, the distance, things left out. Its tooltip says all of them. Notes about the drawing, not about motion (parts that do not move left out to keep it simple, a gradient drawn as its average), do not count.
- The description ends by naming what the take misses.
- A clipping frame that would hide more of the element than its clipping parent does on screen is dropped.
**Why:** the self-check compared only where drawn parts were and how opaque, so it said "Matches the page · 0 px" with Vercel's flap missing, a button cut in half, and a line that never drew. Problems were found by eye, one site at a time.

### D155. Masks and repeating gradients are drawn
**Chose:**
- A CSS mask made of gradients (`mask-image`, or `-webkit-mask-image`) is read as layers, top first, in a new optional field, `Shape.mask`: each layer's gradient (its alpha is what shows), the area it covers (`mask-clip`: the border, padding or content box) and how it combines with the layers under it (`mask-composite`, or the `-webkit-` names). The editor draws the shape, after its filter, on a canvas of its own, builds the mask from the bottom layer up (add, subtract, intersect and exclude are the canvas's source-over, source-out, source-in and xor), and keeps what the mask covers. Every layer must be read, or how they combine cannot be: then there is no mask. A mask from an image is not copied; it is listed.
- The "gradient border" trick (a mask that keeps the ring of padding round the content) is drawn by its mask, with its gradient, no longer as a solid ring in its average color.
- `repeating-linear-gradient`, `repeating-radial-gradient` and `repeating-conic-gradient` are drawn: one period of stops, repeated over the gradient, up to 32 stops (the average color past that).
**Why:** Magic UI's border beam and shine borders, marquees that fade at their edges, and number tickers are masked; they were drawn whole. Stripes were flat gray.

### D156. Play the hover holds the hover
**Chose:** the pointer comes in, then waits for the hover's take (its own motion is over), at most 2 seconds, and half a second more; then a small, slow sweep round the middle, well inside the element, for parts that follow the pointer; back to the middle for another half second; then out.
**Why:** asked for by the user: the way out began as the way in ended, or before (a sweep across most of the element, and a fixed 0.7 s rest, could leave a slow hover unfinished or the element when it moved under the pointer).

### D157. Found by the component sweep
**Chose:**
- A part that opens elsewhere while the pointer is on the picked element, having come onto it in the last 2 seconds, is followed, as one a press opens is: a tooltip or a hover card (Radix opens them 700 ms after the pointer arrives). The crossings of the element's edge decide, not :hover, which can lag a page that just changed. Once recording has moved, takes are named by what the pointer did to the element that was picked.
- Track start offsets are whole milliseconds, rounded down: 0.066 ms past the take's start left the first frame, which already showed the animation, drawn at rest (shadcn's popover, 21 px and 100% opacity off).
- A part that appeared during the take is read again for its resting opacity and transform once nothing animates it: an animation that does not fill left Radix's navigation panel drawn at its first frame, see-through and tilted.
- A part a script writes to, whose opacity a browser animation owns, is hidden from when it goes, as any part taken off the page is (the same panel stayed shown after closing).
- Transforms that differ only by whole turns (rotateY(0deg) to rotateY(3600deg)) are a change: their matrices are the same, their written angles are not (Mantine's loader was dropped). Whole turns past one are said as such: "turns round 10 times".
- A part taken off the page "disappears".
**Why:** the first 115 lines of the 85-page sweep: Radix's tooltips gave no take on every page; shadcn's popovers and Radix's navigation menu were 12 to 68 px off; Mantine's loader was listed as changing nothing.

### D158. Pseudo-elements in the flow of text are drawn, and pseudo-elements are checked
**Chose:**
- A ::before or ::after that is not absolutely positioned is placed from the element's own text: ::after just past the end of its last line, ::before just before the start of its first, centered on that line. Its size is its own width and height, or, for text it shows (an arrow), the text's width measured with its font on a canvas (the text is only measured, never kept) and its line's height. Text it shows is drawn as a bar in its color.
- The ::before and ::after a take animates are filmed (their computed transform and opacity), so the badge checks them too; a hover's way back shifts their film as it does the rest.
**Why:** "Learn more →" arrows that slide on hover, and Mantine's spinner ring (an ::after), were listed and not drawn; and a take of pseudo-elements had no badge at all, so a wrong one could not be told from a right one.

### D159. More from the component sweep
**Chose:**
- Layout is not sampled for a part that is not drawn (display: none, or inside one that is): when a dropdown closed, every part in it read 0 wide and 0 tall, a layout track each (Ant Design's tabs: 60 tracks for a menu fading out). It keeps its last box.
- A part whose opacity animation waits on a delay is drawn, until then, at the opacity the film shows: read in the page it may have been the animation's (Ant Design's spinner dots, read at 1 for a rest of 0.3, 70% off). The film is applied last, after the rule for parts fading when picked.
**Why:** the component sweep, on Ant Design's tabs and spin pages.

### D160. Elements inside frames
**Chose:** "Pick element" puts the capture script into every frame of the tab, not only the page, so a part shown in a frame can be picked: a component in Storybook, a demo on a docs site (Headless UI, Material Web). Each frame offers the picker; the first to pick is the one the panel talks to from then on, and the others stop offering it. Play the hover and Play the click move the pointer to where the frame shows the element, found by adding up the frames it is inside (each scrolled into view); a frame from another site does not say where it is, and the panel says so. Play the load reloads only the page itself, so it is offered for an element of the page, not of a frame. If a frame cannot be reached, the page alone is used.
**Why:** the component sweep found Headless UI's demos in a frame, with nothing to pick; Storybook shows every story in one.

### D161. Copy CSS says how the page made the motion
**Chose:** keyframes measured from a script are followed by a comment that says so, and a take read from a view transition ends with a comment saying how the page plays it (a view-transition-name, and the change inside document.startViewTransition()), since the keyframes draw the same motion on the element itself instead.
**Why:** both export as plain keyframes, which a reader would take for CSS the page wrote.

### D162. A dialog's backdrop is drawn
**Chose:** when the recorded element is a dialog open as a modal, its ::backdrop is a shape over the whole window, in the dialog's coordinates, with its own color and animations, filmed like other pseudo-elements. The stage draws it before everything else and not moved by the dialog's own transform (a dialog that scales in does not scale its backdrop), and fits the view to the rest.
**Why:** the dimming of the page behind a dialog is most of what opening one looks like (daisyUI's and Pico's modals); it was listed, not drawn.

### D163. Dialogs opened by a class; parts measured before they have a shape
**Chose:**
- After a press or a hover, an animation inside a part marked as a dialog, menu, listbox or tooltip (role, or aria-modal), outside the picked element and not showing when picked, opens elsewhere: the recording follows the outermost part around it fixed to the window (a modal's dimmed layer), or the part itself. Bootstrap's and Carbon's modals are on the page all along, hidden, and shown by a class; only new parts and the top layer were followed.
- Layout is sampled for the parts the take's animations move even before they have a shape: a panel hidden when picked gets its shape when the take ends, and its growing is then a layout track (Carbon's accordion opens by max-height and padding).
- Properties that only change layout (min and max sizes, padding, margin, gap, flex and grid sizing, inset) count as drawn when the take has layout tracks: their effect is the boxes the page measured. The badge, the Not shown tab and the take list agree.
**Why:** Carbon's Storybook, recorded through its preview frame (D160).

### D164. Shadow roots around the pick; tiny dots; a flattened 3D turn keeps its lean
**Chose:**
- What opens elsewhere is also looked for in the shadow roots of the components the picked element sits in or is slotted into (up to four levels up), and those inside them. Animations in the picked element's own shadow roots stay its own.
- A part 2 px or smaller is left out only when it cuts off what overflows it (screen-reader text). One that paints and cuts nothing off is drawn.
- Motion a script makes is written as translate, rotate, skewX and scale. The lean is what a turn in 3D looks like once flattened. A part whose own transform turns it out of the page's plane gets a note saying it is shown flat; the badge does not count it, because the check measures the picture. translateZ(0) does not count as a turn.
- A change that first happens once a hover's way back has begun is said with the way back ("Then it goes back and disappears").
**Why:** Shoelace's tooltip was not followed: its bubble animates in the tooltip's shadow root, and document.getAnimations() leaves shadow roots out. Aceternity's logo: four corner dots were reported missing, and the turned mark was 2.8 px off; now 0.5 px.

### D165. A canvas or a video is named when nothing is found
**Chose:** when the picked element is or holds a canvas or a video at least 8 px wide and tall, and a recording finds nothing, the panel says that what a script draws on a canvas, or what a video plays, cannot be recorded, instead of suggesting a parent. Only the tag and size are read; no pixel is.
**Why:** a chart or a Lottie animation drawn on a canvas left "No animation was found. Try again, or pick its parent", which sent people looking for something the tool cannot read. Reading the canvas to notice it changing would read image data from the page.

### D166. SVG parts moved by their attributes; films start from where the part was
**Chose:**
- The film also listens to the transform and opacity attributes of SVG parts, which GSAP and Lottie write every frame instead of a style. A group written to gets a shape then, and the parts inside it move into it.
- Each part's look is read when recording starts (its shape, and up to 600 SVG groups), and again where it comes to rest when a take ends. A film's first frame is that look, one frame before the script's first write, once a second write shows the part is moving (one write is a jump).
- A transform that both moves and turns (or scales) about a point away from the shape's middle is described by where its middle goes. A turn about an SVG group's corner with the move that keeps it in place reads "rotates 90 degrees", not "moves 100 px right and rotates". A turn with no move (a hinge) is said as before.
**Why:** a group turned in place by its transform attribute was not recorded at all (the check said a part was missing). Every film began one step into its motion, because a write is heard only once it is made: fades from 99%, turns of 89 degrees.

### D167. A script's film holds still between writes
**Chose:** when two writes to a part are more than 50 ms apart, a frame holding the earlier look goes one frame before the later write, so the part stays as it was until the script changes it. Parts the browser also moves (a transition the script set) are not held: they keep moving between writes. An SVG group whose shape could not be made (nothing in it is drawn) keeps no id, so no track can name it.
**Why:** Duolingo's Lottie characters turn layers on and off by display, seconds apart. The two frames were joined by a straight line, a slow fade the page never showed, and the check said 100% opacity off. Before that, tracks named groups that were never drawn and the take was refused as invalid.

### D168. Following needs the pointer moving
**Chose:** a part is fitted as following the pointer only when the pointer moves on it for at least 30% of the time the part is changing. Otherwise its motion is measured as it is.
**Why:** Aceternity's logo text springs aside when the pointer arrives and settles while the pointer is still. A rule with a lag fitted it, and Copy for AI said a script made it follow the pointer.

### D169. Text that changes is named as text
**Chose:** the watch counts how often the text inside each watched part changes (from the page's own change records: the text is never read or kept). A part whose text changed twice or more and that nothing explains is missed as 'text', a new value of Missed.what. The description says the text changes and is never copied; the badge and the take list say "Text not copied" instead of a part missing.
**Why:** a number counting up (Magic UI's number ticker, a stats strip) was reported as "1 part changed on the page that this preview misses", which read as a fault to fix. It is the rule that text is never copied.
**Format:** Missed.what is now 'moved', 'look' or 'text'. Older captures stay valid.

### D170. Flex and grid items stack by z-index; a pseudo-element rests where it ends
**Chose:**
- A z-index orders a part among its siblings when it is positioned, and also when it is a flex or grid item, as CSS does, whatever its position.
- When nothing runs on a ::before or ::after any more, its resting opacity is read again. One measured while its animation ran (a recording that moved to its element as it opened) had taken its first frame as its rest.
**Why:** Radix's search dialog: the dimming ::after of its overlay was drawn over the dialog (a flex item at z-index 1), and once its fade ended the preview put it back to 0% opacity. 100% opacity off; now 0 px.

### D171. An SVG path's morphing outline is drawn
**Chose:** the d property is previewed. The probe reads the outline the browser blends at each moment, and the stage draws a path part from it instead of its resting outline. The description says the shape "morphs its outline".
**Why:** an icon that morphs (a square into a diamond, a play button into a pause) was listed as "Not drawn: d", though the browser blends it like any other property.

### D172. SVG animations (SMIL) are filmed
**Chose:**
- Parts an <animate>, <animateTransform> or <set> inside the picked element moves are found when recording starts, and their look is read then. Each frame they are filmed as a script's parts are: their transform and opacity as computed (Chrome computes SMIL's values into the style), their colors and dashes, and a change of their geometry (a circle's r, a rect's x or width) as the scale and move that take the outline they were drawn with to the one they have now.
- A loop (repeatCount="indefinite") is filmed for one turn, put in the order of the turn from its start (SMIL says how far into its turn it is), closed so it repeats without a seam, and shown repeating forever. A negative delay keeps the preview in step with the page.
- The CSS export says a script or an SVG animation moves such a part, not a CSS rule. The descriptions say a measured loop goes "and back" when it ends within 5% of where it began.
**Why:** SVG spinners are often SMIL. Their parts were reported as changed and missed. A pulsing circle now reads "scales to 2 and back over 1.5 s. It repeats forever." and matches the page.
**Not done:** SMIL that changes a path's d or a line's ends is still reported as missed (<animateMotion> was added in D175).

### D173. SVG spinners, checked against a real set
**Chose:**
- A part whose resting size is 0 (r="0", a pulse growing from nothing) is drawn at the largest size its SVG animation reaches, and scales from there.
- A loop's one turn is carried to its very start and end from the frames beside each, as a move, a turn, a lean and a scale, never blended across the turn: a loop may jump back each turn. Where SVG animation's clock and the page's disagree by a few ms, a jump many times the usual step within three frames of the turn's start or end marks where the turn really ends.
- Films thinned to 120 frames keep the frames a hold put in, and those beside them.
- The check against the page counts as right any opacity the page passed through between two frames: at a jump, which side a frame falls on is when it was taken.
- Descriptions of measured motion leave out moves under half a pixel, the measuring's own tolerance.
**Why:** ten spinners from svg-spinners (MIT), recorded on a local page: all match the page, 0 to 1.2 px. A loop made of a chain of animations (begin="a.end") is measured as a stretch and not said to repeat; hearing the browser's begin events to find its turn was tried and split the recording into takes, so it was taken out.

### D174. A loop running since before a take is not part of it
**Chose:**
- When a take holds animations that end and loops that were running long before them (a second or more), the loops are left out of it: they belong to something else on the page.
- What set a take off is looked for around when its animations that end began, not its loops.
**Why:** MUI's "show code" toggle: the click fades in the demo toolbar beside it, so recording moved to their parent, where two buttons have shimmered since the page loaded. The take was named as already running (its earliest start was the shimmer's, seconds before the click) and dropped, so nothing was recorded; with the naming fixed, the shimmer led the description.

### D175. SVG animation films under load; moving along a path
**Chose:**
- Films of parts an SVG animation moves are never held between frames: they are polled every frame, so a gap is a frame the browser did not draw.
- A loop's turn is blended across its ends when the step there is like the others (a spin, a pulse out and back), and carried on from each side only at a jump. Each end is carried from a frame at least 8 ms off, never more than a few steps past it.
- <animateMotion> is filmed: a part's own transform is read from the matrix the browser places it with, relative to its parent's, when it moves along a path.
**Why:** under load (twelve runs at once) a loop read "moves 211 px right and scales to 0", or "scales to 0.92", where it pulses out and back. Now 96 runs out of 96 read right.

### D176. A run of restarts is shown as measured motion
**Chose:** when a script restarts a part's transition three times or more in a row, the part has been filmed all along, and the whole run is shown as measured motion instead of only its last restart. The note says so, and neither the badge nor the description counts it as something left out. Which notes leave nothing out is now one rule in core, used by the description, the badge and the take list.
**Why:** Railway's button highlight is restarted with every pointer move. Only the last restart was shown, beginning 1.2 s in, where the others had left it: 24 px off. Now 0 to 0.5 px.

### D177. A radial gradient whose colors change is drawn
**Chose:** films keep a background-image that is a radial-gradient(), as they keep linear and conic ones. The stage draws the resting radial layer in the colors the film gives, when it has as many stops.
**Why:** Attio's buttons are lit on hover by a registered color variable that a radial gradient uses: the variable was listed as not drawn.

### D178. What a page changes with no animation, on a part it also animates, is measured
**Chose:** parts the browser animates are filmed for the check. Their film is now also fitted, as a script's is, for what none of their own animations change (their own properties are left to their tracks): a class flip with no transition. Every filmed part's film starts from its look before the take, and that look is kept where each take ends.
**Why:** Cal's menu fades out, and in the same moment a class shrinks it to 0.95 with no transition: the preview kept it full size, 20 px off. Now 0 px.

### D179. A film's first look is from before the part's first animation; an svg in the page is a box
**Chose:**
- The look a part had before a take goes into its film just before its first animation began, not a frame before it was first filmed (which may be some frames later).
- An <svg> in the page (not inside another svg) takes percentages in its film from its CSS box, as the snapshot does, not from its drawing.
**Why:** Figma's button: its icon's fade looked 29% off in its first frame (the look before the take sat inside the fade), and its translate: 0 -50% was read as 7.8 px instead of 10. Now 0 px.

### D180. A background image that does not repeat is drawn only on its tile; background-size is previewed
**Chose:**
- The stage clips every gradient tile to its own area, a single one too. A background image that does not repeat is painted only where its tile is, as in CSS.
- background-size is previewed: the probe reads it, and the tile takes that size (px, a share of the box, or auto for the resting size). The description says the background widens or grows, from what to what.
**Why:** Retool's links draw their underline in on hover by growing a gradient's size. It was listed as not drawn, and at rest a 2 px underline of 0 width filled the whole link.

### D181. Underlines are drawn
**Chose:**
- A shape keeps the underline its element draws under its text (text-decoration: underline): its color and thickness. **Format:** Shape.underline, { color, thickness } or null; captures made before it read as null. It is kept while it cannot be seen (transparent), since its color may animate in.
- The stage draws it under each line of text inside the shape, as one line under the spaces too, in its color now (text-decoration-color is previewed).
- A color that goes from nothing to something is said as "shows its underline in blue", and the other way as "hides its background", rather than naming the page's color behind it.
**Why:** Arc's links show their underline on hover by its color: "Not drawn: text-decoration-color", and links were drawn with no underline at all.

### D182. An animated backdrop blur is drawn
**Chose:** backdrop-filter is previewed. Before a shape is filled, what is already drawn behind it is drawn again within it through the filter, its lengths scaled as the stage is. A backdrop filter at rest is not kept yet: only one that animates is drawn.
**Why:** frosted glass that blurs in on hover (common on product sites) was listed as not drawn.

### D183. A block's own text counting up is seen; the empty timeline says why
**Chose:**
- A change of text seen between takes counts as a change for the watch, though no box moved: a block keeps its size while its number counts up.
- When a take has nothing to play, the timeline says what the take saw: only text changing (never copied), or parts changing in a way the preview cannot draw, named above. The canvas and scroll hint stays for a take that saw nothing.
**Why:** checking the panel with a counter picked whole: it said "No animation was found" while the number counted to 1234, and once found, "it may be drawn on a canvas" under a take about text.
**Not done:** in the panel, a played hover over a counter named its take "On its own"; recorded directly, the same take is named a hover. Looked at again (D194): a counter that counts on hover is named a hover when recorded (tested). The panel case was seen only in the test harness, which opens the panel as a tab: the page sat behind it and its clock stood still (the change was dated 244 ms, the pointer's arrival 1061 ms).

### D184. The look before a take helps the fit, and is not checked
**Chose:** the look a part had before a take, put at the start of its film, is used to fit what no animation explains, and left out of the film the preview is checked against. Read where an earlier take ended, it may be out of date by the next one.
**Why:** the product sweep, run again: 171 of 185 matched (165 before today), but Railway, Cal and Figma showed 100% opacity off at 0 ms, all from that look being out of date. Without it in the check, all three match.

### D185. A part gone from the page rests where it was last seen; carried is not moved
**Chose:**
- A part that appeared during a take and is gone (or running its way out) when the take ends cannot be read again: its rest is the last look its film shows of it, not the one it had as it appeared.
- The watch measures the parts inside the picked element from its corner, and the picked element from its parent's. Being carried along by a parent outside it (a marquee) is not motion the preview misses.
- The sweep takes CAPTURE=path, to run another build of the capture script, so two can be compared on the same pages.
**Why:** the original sweep, run again (318 of 331 matched): MUI's tabs were 81 px off (the ripple went back to nothing once its spread ended, while the page held it until it was removed), and GitHub's marquee item was called missed. Both match now. Bisected by sweeping three builds of the day.

### D186. A z-index that animates reorders the siblings
**Chose:** z-index is previewed. A shape whose z-index animates above 0 is drawn after its siblings, and below 0 before them; the others keep the order capture gave them. The description says it "comes in front of the parts beside it" or "goes behind" them.
**Why:** CSS-Tricks brings an avatar in front of the ones it overlaps on hover: "Not drawn: z-index".

### D187. A focus ring is kept while it cannot be seen, and animates
**Chose:** an outline with a style but transparent or 0 wide is kept on its shape (it does not make the part one that paints), and its color, width and offset are previewed. One 0 wide is not drawn.
**Why:** Catalyst's switch shows a focus ring by its outline color, from transparent: "Not drawn: outline-color". The click sweep, run again: 80 of 83 matched; the others were Radix pages where nothing ran on the clicked part and a dialog whose result changes with what the sweep left open.

### D188. A gradient mask that moves is drawn
**Chose:**
- A prefixed property keeps its leading dash: Chrome reports -webkit-mask-position-x as webkitMaskPositionX, which was named "webkit-mask-position-x".
- The mask's position is previewed. Chrome animates it through element.animate() only as the mask-position shorthand, so the probe plays one side that way, the other held at 0%, and reads the side back. The stage moves a mask's tile by the mask's position, no longer by the background's.
**Why:** a shimmer over text, a gradient mask swept across by its position, was listed as not drawn.

### D189. A font-size transition Chrome cannot report is said to be unreadable
**Found in Chrome:** a font-size transition's getKeyframes() gives 0px for both ends, whatever the real sizes. It was taken for an animation that ends where it starts, and a link whose text grows on hover read "No animations were captured".
**Chose (for now):** it is listed as not shown, saying Chrome does not report its values; the box it grows is measured by layout tracks, so the preview's box matches the page. A take with only layout tracks no longer begins "No animations were captured". Asserted in tests/spike.spec.ts, and in docs/chrome-findings.md.
**Options, for the owner to choose:** (a) leave it listed, as now; (b) read the two ends from the page itself, its font size before the take and where it rests after, which is right for a transition between two states; (c) film the font size every frame, as a script's motion is, and fit a measured track. (b) and (c) would also need the text bars to grow with it, which the preview does not do yet.

### D190. Letters spreading out; the view takes in what layout reaches
**Chose:**
- letter-spacing is previewed. Letters are never copied, so they are not counted: the text inside a part whose letter-spacing animates is drawn wider by the same share as the box the layout measured, from the box's left edge. A box that simply widens does not stretch its text.
- The stage is framed to where layout tracks take their parts at any keyframe, not only at their last one: a box that widens on hover and back on leave is widest in the middle.
**Why:** a link whose letters spread on hover was "Not drawn: letter-spacing", and once drawn, its text ran off the edge of the view.

### D191. The check allows a frame either way
**Chose:** where a frame of the page and the preview differ, the preview a frame (16.7 ms) earlier and later is tried too, and the smallest miss is kept, for position and for opacity each on its own. A frame the preview matches either side of is not a miss.
**Why:** a frame's time on the page is known to within a frame. Chrome draws a new animation's first keyframe the frame it is made and starts its clock the frame after, so shadcn's popover was "Off by 21 px" at 0 ms on one sweep run in two, and Magic UI's list, whose fade (run by the browser) is a frame ahead of its scale (moved by a script), was "Off by 4% opacity". A miss of a frame cannot be seen; a real one is still a miss a frame either side.

### D192. An animation made paused starts when it runs
**Chose:** an animation that is paused when first seen is dated from when it starts to run, not from when it was seen.
**Why:** some libraries put an animation on paused and let it run a few frames later (Ant Design's motion classes: animation-play-state: paused, then running). Its keyframes were placed at the frame it was seen, ahead of the page.

### D193. A filmed value is read in one color space
**Chose:** where a filmed property's text changes shape between frames, every color in it is written as rgba() and it is read again.
**Why:** Chrome writes a color at rest as it was given (lab() on Attio's button) and a color between two others in oklab(). The film of its gradient had two shapes of text, could not be blended, and the way back was listed as "Not drawn: --button-primary-bg-from".

### D194. Recording keeps going while the pointer is on what it hovered; the panel minds only its own tab
**Chose:**
- Recording stops by itself only once the pointer is off the element, off the one picked (a tooltip's button), and off the part around it whose hover set the take off (a card hovered away from the picked image inside it), for up to 10 s.
- The pointer crossing onto or off a part around the element is a hover or a leave.
- The panel goes back to "Pick element" only when the tab in front of its own window changes or starts a new page. A tab loading behind it, a tab chosen in another window, or coming back to the tab being inspected change nothing.
- A click while picking with no move before it picks the element clicked; it used to cancel.
**Why:** reported: recording a hover by hand kept only the hover in. With the pointer on a card around the picked part, recording stopped 1.5 s after the hover, before the way back. And any tab loading anywhere (a mail tab refreshing) stopped listening and forgot the picked element, so Play the click and Play the load could end with nothing.

### D195. Testing through the real side panel, on real sites
**Chose:** a harness (kept outside the repository, in the session's scratch folder) opens a visible Chromium with the real extension and its real side panel (opened by a click in an extension page, which counts as a user's), finds what animates on a site as the sweep does, and for each element picks it in the panel, then records it by hand (hover in, wait, out; or a click) or plays the load, saving the panel's text and a screenshot. Run on oliverhassan.dev, stripe.com and vega.io. What it found is D196 to D201.

### D196. A style write that only changes how a part moves is not a script moving it
**Chose:** a change to a part's style attribute that differs only in transition-* or will-change does not mark the part as moved by a script.
**Why:** oliverhassan.dev's rolling "Available for work" button: React writes a new transition-delay inline on each hover for the stagger. The part was taken for script-moved, and a hover moved by a script is never joined with its way back: the panel showed "Hover in" alone.

### D197. Keyframes in em
**Chose:** lengths in em are read against the part's own font size (rem against the page's), and a part whose keyframes use em keeps its font size: `Shape.fontSize`, null otherwise and in older captures. The preview gives its element that font size.
**Why:** Framer Motion writes keyframes in em when the page does (oliverhassan.dev's rolling letters, translate3d(0, -9em, 0)). The description fell back to "changes transform … through 370 keyframes", and the preview worked the em out at its own font size: 94 px off.
**Format change:** `Shape.fontSize: number | null`.

### D198. A part the element names with aria-controls is followed once it expands
**Chose:** when the element, or a part inside it, goes from aria-expanded false to true and names with aria-controls a part that animates, away from the element (more than two parents up to one that holds both), recording follows that part. For 400 ms after such an expansion, the parent beside the element is not taken instead.
**Why:** Stripe's "Products" menu is in the nav all along, has no role, and is not added to the page: a click recorded only the chevron, or the nav's other buttons changing color. Now it records the menu opening (a clip-path revealing it from the top).

### D199. A resting value read when the animation is first seen
**Chose:** an animation that leaves out its start or end keyframe gets the resting value it needs from the moment it is first seen, when it has no effect yet (idle, or at its very start with no start keyframe), and failing that from the computed style once it has finished, when it holds no last keyframe of its own.
**Why:** Play the load on Stripe's heading gave seven empty takes, "On load! 1 ms, No animations were captured": its words rise from keyframes with only an end, and on a load the parts are already moving when recording begins, so the value read at pick was not at rest.

### D200. Plain ids only, and the tab is known before the scripts are in
**Chose:** a label or a selector uses an element's id only when it is a plain name (React's ":r4:" is left out). The panel knows which tab it is inspecting before the capture script is in every frame of it.
**Why:** "nav#:r4:" is not a valid selector, so finding the element again after Play the load would throw. And on vega.io, whose page holds eight frames from another site, a pick made before the last frame had the script was not heard: picking did nothing.

### D201. One verb for changes said the same way
**Chose:** "darkens its background and darkens its border" reads "darkens its background and border".

### D202. A part opened by a hover stays followed, and named by the hover
**Chose:**
- A part with no size is never offered as a parent to move recording to; if moving fails all the same, recording goes on where it was and still knows the element it came from.
- When a take was already under way as recording moved, its start is taken from animations of its own, not from one that follows the scroll.
**Why:** Stripe's nav menu, opened by a hover: its recorder tried to move to a wrapper with no size when the nav's arrows moved, failed, and started again without knowing it came from the button. The take was named "already running" and left out: nothing was recorded. And Stripe's nav runs a scroll-driven animation for as long as the page is open, which put the take's start at the page's load.

### D203. Moved by a script means written frame after frame, with no animation of its own
**Chose:** a part counts as moved by a script, for keeping a hover and its way back apart and for cutting a take where the pointer crosses the edge, only when it was written at least three times and has no browser animation of its own in the take.
**Why:** on Framer's and Linear's sites a hover writes the part's inline style (opacity: 0.6, its own variables) and a CSS transition carries it out. Any write made it "scripted", so every hover was cut in two at the pointer's crossing: "Hover in" and "Hover out", never "Hover in and out".

### D204. Menus opened by a hover: followed only when it is theirs, and closed in the same take
**Chose:**
- A part added to the page while the pointer rests on the element is taken as opened by that hover only when it is named as a tooltip, menu or dialog, named by the element (aria-controls, aria-describedby, aria-owns), or within 240 px of it. A press is followed as before.
- A part counts as moved by a script only when its film changes: a script that writes a menu's position every frame without moving it (Floating UI) moves nothing.
- A way back that undoes all of the way there is joined to it even when it moves a few parts besides (links in a closing menu fading).
- A joined take that began with a hover is "Hover in and out", whatever the pointer crossed on the way out.
- Recording asks to move to a parent before it stops: a move that fails leaves it recording where it was, with the take it holds.
**Why:** on Linear, hovering a nav item followed the chat in the hero, which adds messages on its own. On Linear and Stripe, a nav menu opened by a hover came out as two takes, "Hover in" twice: the menu's position written by a script counted as script motion, the close faded links the open had not, and a failed move to a hidden wrapper restarted recording, losing the first take.

### D205. Recording does not stop by itself as the pointer leaves
**Chose:** recording stops by itself only once the pointer has been still for half a second, and, after a hover, not while the pointer is where the element was when recording began (a hover can move or narrow it from under a pointer that has not moved).
**Why:** tested through the real side panel, a hover held longer than recording waits to stop came out as "Hover in" alone, on oliverhassan.dev's rolling button and on Stripe's nav. Recording stopped in the very frame the pointer left, before the page began its way back: a script (React) answers a frame or more later. Recorded by a test harness, which leaves sooner, it had not shown.
