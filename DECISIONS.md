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
