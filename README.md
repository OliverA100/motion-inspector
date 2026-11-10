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

## Load the extension

```bash
pnpm build:extension
```

In Chrome, open `chrome://extensions`, switch on "Developer mode", press "Load unpacked", and choose `packages/extension/dist`. Click the extension's toolbar icon to open the side panel, then press "Pick element".

The extension asks for four permissions and no access to any site up front: `activeTab`, `scripting`, `sidePanel` and `storage`. The capture script is only put into a page when you press "Pick element", and only into that tab.

## Known limits

- **Missing keyframes can be stale.** When `element.animate()` leaves out its start or end keyframe, the missing value is the element's resting style, read when you pick the element. If the page changes that resting style between your pick and the animation (for example by toggling a class first), the capture shows the old value. Pick again after the change to fix it.
- **Missing keyframes on an element that is already animating are not shown.** If the property was already animating when you picked the element, its resting value cannot be read. The animation is listed under "not shown".
- Only CSS transitions, CSS keyframe animations and Web Animations are captured. Animations driven by JavaScript frame by frame, canvas, and scroll-driven animations are not.
- **Shapes are simplified.** Text is drawn as bars and images as flat gray, because page text and image data are never copied. Icons are drawn from their outlines, part by part. Gradients are drawn in their average color. Pseudo-elements in the flow of text, and layout animations (grid, flex, margins), are not drawn. At most 40 parts are drawn.
- **An element with no transition on it when picked may have no shape.** If it paints nothing and only starts animating through a class added later, its animation is listed under "not shown".
- **Closed shadow roots cannot be reached.** Open ones are captured.
- **Access is per site.** Clicking the toolbar icon gives access to the tab you are on. On another tab, or after the tab goes to another site, "Pick element" asks for access to that one site.
- **Browser pages, the Chrome Web Store and PDF files cannot be inspected.** Chrome does not allow it. The panel says so.
- **Iframes are not looked into.** Only the top document and open shadow roots.
- **The preview has no layout.** When a panel grows, the items below it do not move down in the preview as they do on the page.
- **Images and gradients are drawn flat gray.**
