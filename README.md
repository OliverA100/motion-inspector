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

The extension asks for five permissions and no access to any site up front: `activeTab`, `scripting`, `sidePanel`, `storage` and `debugger`. `debugger` is used only by "Play the hover", which moves a real pointer over the element; Chrome shows a bar saying the tab is being debugged while it does. Chrome does not allow `debugger` to be asked for later, so it is asked for at install. The capture script is only put into a page when you press "Pick element", and only into that tab.

## Known limits

- **Missing keyframes can be stale.** When `element.animate()` leaves out its start or end keyframe, the missing value is the element's resting style, read when you pick the element. If the page changes that resting style between your pick and the animation (for example by toggling a class first), the capture shows the old value. Pick again after the change to fix it.
- **Missing keyframes on an element that is already animating are not shown.** If the property was already animating when you picked the element, its resting value cannot be read. The animation is listed under "not shown".
- **Motion a script makes is measured, not read.** CSS transitions, CSS keyframe animations and Web Animations are read exactly. A script that moves a part frame by frame (a spring, a motion library) is filmed about 25 times a second and fitted to keyframes and a curve within half a pixel; a spring becomes keyframes, not a spring. A part that follows the pointer (a tilt card) is fitted to a rule with a lag and follows the pointer in the preview. Transform, opacity, clip-path, filter, colors, box-shadow and background position are measured this way. Canvas, WebGL and scroll-driven animations are not captured.
- **Shapes are simplified.** Text is drawn as bars and images as flat gray, because page text and image data are never copied. Icons are drawn from their outlines, part by part. Layout changes are measured on the page while a take runs and replayed as "layout" tracks; they are not exported as CSS. Pseudo-elements in the flow of text, and SVG masks, are not drawn. At most 40 parts are drawn.
- **3D is drawn through one level of perspective.** A turn in 3D narrows through the element's own perspective() and its parent's `perspective`, and a face with `backface-visibility: hidden` is not drawn while it faces away. Deeper preserve-3d nesting is drawn as each parent flattens it.
- **An element with no transition on it when picked may have no shape.** If it paints nothing and only starts animating through a class added later, its animation is listed under "not shown".
- **Closed shadow roots cannot be reached.** Open ones are captured.
- **Access is per site unless you allow all sites.** Clicking the toolbar icon gives access to the tab you are on. Elsewhere, the panel offers "Allow on all sites" (asked for only on that click); without it, "Pick element" asks for access to each site.
- **Browser pages, the Chrome Web Store and PDF files cannot be inspected.** Chrome does not allow it. The panel says so.
- **Iframes are not looked into.** Only the top document and open shadow roots.
