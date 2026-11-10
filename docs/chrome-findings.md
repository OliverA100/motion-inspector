# What Chrome reports for animations

Recorded by the spike (`packages/capture/src/spike.ts`) on the fixtures page in M1, with three more recordings at the start of M2 (negative delays, a CSS animation with no end keyframe, start times). Browsers: installed Chrome 157 and Playwright's Chromium 158. Both gave the same results. The raw data is in `spike-output/`. Every row marked "tested" has an assertion in `tests/spike.spec.ts`, so a Chrome change will fail a test.

To record again: `pnpm test:spike`.

## Where the easing lives (tested)

| Kind | Object | Effect easing (`getTiming().easing`) | Keyframe easing (`getKeyframes()[i].easing`) |
| --- | --- | --- | --- |
| CSS transition | `CSSTransition` | The `transition-timing-function` | Always `linear` |
| CSS animation | `CSSAnimation` | Always `linear` | The `animation-timing-function`, per keyframe |
| `element.animate()` | `Animation` | The `easing` option | The `easing` of each keyframe |

Details:
- In a CSS animation, a timing function set on the element (`animation: x 1s steps(5, end)`) is copied onto every keyframe, including the last one. The last keyframe's easing has no segment after it and means nothing.
- Only `element.animate()` can have a real easing on both levels at once.
- Chrome rewrites easings into a normal form: `steps(5, end)` becomes `steps(5)`, and every `linear()` stop gets a percentage (`linear(0 0%, 0.22 9%, ..., 1 100%)`).

What this means for the format: `Timing.easing` and `Keyframe.easing` both stay. The curve editor edits the effect easing for transitions and the keyframe easing for CSS animations.

## Property names and values (tested)

- Names from `getKeyframes()` are camelCase (`boxShadow`, `borderTopLeftRadius`). Capture converts them to CSS names.
- One keyframe can hold several properties (`transform` and `opacity` in one `element.animate()` call). Capture splits them into one track per property.
- A transition on a shorthand arrives as one `CSSTransition` per longhand. `border-radius` gives four, one per corner.
- Values are in computed form: `0` is `0px`, colors are `rgb()` or `rgba()` with `var()` resolved, `box-shadow` is `rgba(0, 0, 0, 0.25) 0px 6px 16px 0px` (color first, spread added).
- Units are not unified. A radius going from `8px` to `50%` keeps both units.
- `offset` is `null` unless the author set it. `computedOffset` is always a number. Capture uses `computedOffset`.

## Transforms (tested)

The question from the M0 review: can transforms be read as a list of functions, with no matrix?

**Yes, for every kind, transitions included.**

| Source | Keyframe value |
| --- | --- |
| Transition, button hover | `none` to `translateY(-2px)` |
| Transition, card lift | `none` to `translateY(-6px) scale(1.03)` |
| CSS animation, loader | `none` to `rotate(360deg)` |
| `element.animate()` | `translateX(0px) scale(1)` to `translateX(48px) scale(1.2)` |
| Interrupted transition (starts mid-way) | `translateY(-1.65694px)` to `none` |

- `CSSStyleValue.parse('transform', value)` returns a `CSSTransformValue`: a list of `CSSTranslate`, `CSSScale`, `CSSRotate` and so on, with numbers and units. The loader's end keyframe parses to one `CSSRotate` with angle `360 deg`. This is asserted.
- `none` parses to a `CSSKeywordValue`, not an empty list. Capture treats it as an empty function list.
- The matrix only appears in `getComputedStyle(el).transform`. Capture never needs it. `el.computedStyleMap().get('transform')` gives the function list even mid-animation (`rotate(13.3352deg)`).

## Missing keyframes (tested)

| Case | What `getKeyframes()` returns |
| --- | --- |
| CSS animation with only `to` (the loader) | Two keyframes. Chrome adds the start keyframe itself, with the element's own value (`none`) and `composite: "replace"`. |
| CSS animation with only `from` (pop in) | Two keyframes. Chrome adds the end keyframe itself, with the resting values (`transform: none`, `opacity: 0.9`) and `composite: "replace"`. |
| `element.animate()` with only an end keyframe | One keyframe, `computedOffset: 1`. Nothing is added. |
| `element.animate()` with only a start keyframe | One keyframe, `computedOffset: 0`. Nothing is added. |

So only `element.animate()` needs a keyframe filled in by capture. Where the resting value can be read, on the end-missing fixture (resting `opacity: 0.9`, animating from `0.2`):

| When it is read | Value | Correct? |
| --- | --- | --- |
| At pick time, before the trigger | `0.9` | Yes |
| When the animation is first seen | `0.2` | No. This is the animated value. |
| After the animation finished | `0.9` | Yes (this is the reference) |

The M0 plan proposed reading computed style when the animation is seen. That is wrong, as the review expected. **Proposed rule:**
1. At pick time, read the resting value of each previewed property for every element in the snapshot. The list of previewed properties is fixed and short, so this is cheap.
2. A missing keyframe is filled from that pick-time value and marked `implicit: true`.
3. If the element was already animating that property at pick time, the pick-time value is not a resting value (the loader reads `rotate(13.3352deg)` at pick time). Then the missing keyframe cannot be known. The track goes to `notShown` with a plain reason. This case needs an `element.animate()` animation with a missing keyframe that is already running at pick time, which should be rare.

Known limit: if the page changes the element's resting style between pick and trigger (for example by toggling a class), the pick-time value is stale.

## Interrupted transitions (tested)

Hovering the button, then leaving before its 180 ms transition is done:

1. Chrome fires `transitioncancel` for the running transition. Its `finished` promise rejects.
2. Chrome creates a **new** `CSSTransition` object for the same element and property.
3. The new one starts from the value the first had reached (`translateY(-1.65694px)`) and ends at the first one's start value (`none`).
4. Its duration is shortened (116 to 149 ms in our runs, from 180 ms), in proportion to how far the first one had got.

Rules for capture, based on this:
- **Split the take** when a new animation appears for an element and property that still has a running animation in the current take.
- **Mark as shortened** (`Track.interrupted: true`) when the new transition ends at the value the replaced one started from. That is the reversal case, and it is the only case where browsers shorten the duration. A transition interrupted towards a third value starts mid-way too, but keeps its full duration, so it is not marked.

## Timing (tested)

- `transition-delay` arrives as `timing.delay`. In the staggered list, all eight transitions appear in the same frame, with delays of 0, 60, 120 and 180 ms.
- Negative delays arrive as they are. The three staggered dots report `delay` of -320, -160 and 0 ms and share one start time, so the stagger is only in the delay. `currentTime` does not include the delay: the time inside the animation is `currentTime - delay`.
- Start time, measured in M2 on the document timeline:

  | Case | `startTime` when first seen | Timeline time minus `currentTime` | `startTime` after `animation.ready` |
  | --- | --- | --- | --- |
  | Already running (loader, dots) | A number | Equal to `startTime` (0.000 ms apart) | The same number |
  | Newly triggered (hover, click) | `null` (pending) | Only the time it was seen, because `currentTime` is 0 | 0 to 33 ms later than the time it was seen |

  So "first seen minus `currentTime`" keeps the phase of running animations, but for a new animation it is no better than the first-seen time. The accurate value in both cases is **`startTime` read after `animation.ready` resolves**. Capture uses that. If the animation is cancelled before it is ready, capture falls back to the time it was first seen.
- A track's `startOffset` is its start time minus the earliest start time in the take. So offsets are zero or more, and tracks that started together (the eight list transitions, the three dots) get exactly the same offset.
- `iterations` is `Infinity` for an infinite animation, and so are `endTime` and `activeDuration`. JSON cannot hold `Infinity`.
- `getTiming().fill` is `"auto"` for `element.animate()`. Only `getComputedTiming().fill` gives the real value (`"none"`). Transitions report `"backwards"`.
- Every fixture runs on a `DocumentTimeline`. Anything else is scroll-driven and goes to `notShown`.

## Composite

Never set by any fixture. The only value other than `"auto"` is the `"replace"` on the start keyframe Chrome adds to a CSS animation. Following the M0 review, `Track.composite` is dropped from the format. Animations with `add` or `accumulate` go to `notShown`.

## Pseudo-elements, shadow roots, scroll-driven animations (tested)

Recorded at the start of M5, before the real capture code.

| Case | What Chrome does | What capture does |
| --- | --- | --- |
| Animation on `::after` | `effect.target` is the element itself. `effect.pseudoElement` is `"::after"`. It is returned by `getAnimations({ subtree: true })` like any other. | Checks `pseudoElement` first. If it is set, the animation goes to `notShown`, because there is no shape for a pseudo-element. Without that check it would be drawn as if the whole element moved. |
| Animation inside an open shadow root | `host.getAnimations({ subtree: true })` does **not** return it. `host.shadowRoot.getAnimations()` does. | On every frame, also asks each open shadow root under the picked element. The snapshot walks into open shadow roots too, so the shapes exist. |
| Scroll-driven animation | `animation.timeline` is a `ScrollTimeline` (or `ViewTimeline`). `getTiming().duration` is `"auto"`. `currentTime`, `startTime` and the computed duration are percentages of the scroll range, as objects, not numbers of milliseconds. | Anything whose timeline is not a `DocumentTimeline` goes to `notShown`. Its times are never read as numbers. |

## Not covered by the spike

- `iterationStart` or `endDelay` other than zero.
- Closed shadow roots. Their content cannot be reached from outside at all.
