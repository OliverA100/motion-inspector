# Motion Inspector

A tool to dissect, understand and re-tune animations found on real websites. Work in progress. The full README is written in the last milestone.

## Run it

```bash
pnpm install
pnpm dev          # fixtures page at http://localhost:5173/fixtures.html
pnpm test         # unit and property tests
pnpm test:spike   # records what Chrome reports for each fixture
```

## Known limits

- **Missing keyframes can be stale.** When `element.animate()` leaves out its start or end keyframe, the missing value is the element's resting style, read when you pick the element. If the page changes that resting style between your pick and the animation (for example by toggling a class first), the capture shows the old value. Pick again after the change to fix it.
- **Missing keyframes on an element that is already animating are not shown.** If the property was already animating when you picked the element, its resting value cannot be read. The animation is listed under "not shown".
- Only CSS transitions, CSS keyframe animations and Web Animations are captured. Animations driven by JavaScript frame by frame, canvas, and scroll-driven animations are not.
