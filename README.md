# Motion Inspector

A tool to dissect, understand and re-tune animations found on real websites. Work in progress. The full README is written in the last milestone.

## Run it

```bash
pnpm install
pnpm dev            # editor demo at http://localhost:5173/ (also /pieces.html, /fixtures.html)
pnpm test           # unit and property tests
pnpm test:browser   # browser tests: capture on the fixtures page, and the editor
pnpm samples:update # records the demo's sample captures again
pnpm screenshots    # saves screenshots of every state to screenshots/
```

## Known limits

- **Missing keyframes can be stale.** When `element.animate()` leaves out its start or end keyframe, the missing value is the element's resting style, read when you pick the element. If the page changes that resting style between your pick and the animation (for example by toggling a class first), the capture shows the old value. Pick again after the change to fix it.
- **Missing keyframes on an element that is already animating are not shown.** If the property was already animating when you picked the element, its resting value cannot be read. The animation is listed under "not shown".
- Only CSS transitions, CSS keyframe animations and Web Animations are captured. Animations driven by JavaScript frame by frame, canvas, and scroll-driven animations are not.
- **Shapes are simplified.** A border with a different color on each side is drawn in one color, so a spinner with one colored edge looks like a plain ring and its rotation cannot be seen. Gradients and background images are drawn as flat gray. At most 40 parts are drawn.
- **An element with no transition on it when picked may have no shape.** If it paints nothing and only starts animating through a class added later, its animation is listed under "not shown".
- **Closed shadow roots cannot be reached.** Open ones are captured.
