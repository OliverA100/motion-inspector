# Real-site pass

The extension has only been run on this project's own fixtures page. This file is for testing it on real sites: what to do, what to send back, and a log of what was found.

## Before you start

```bash
pnpm build:extension
```

Then in Chrome: open `chrome://extensions`, switch on "Developer mode", press "Load unpacked", and choose `packages/extension/dist`. Pin the extension so its icon is on the toolbar.

## First, one check about permissions (about a minute)

I could not test this myself, because a test cannot click the toolbar icon or answer Chrome's permission prompt. Please tell me what happens at each step.

1. Open any ordinary site in a new tab. Click the Motion Inspector icon. The side panel opens.
2. Press "Pick element". **Does the picker appear on the page straight away, or does Chrome first ask to allow access to the site?**
3. With the panel still open, switch to a different tab on a different site. Press "Pick element" there. **Same question.** I expect Chrome to ask here, or the panel to say it has no access to this tab yet.
4. Go back to the first tab and navigate it to a different site. Press "Pick element". **Same question.**

What I expect after the fix for problem 1 below: step 2 works straight away. In step 3 the panel says it has no access to that tab yet; click the toolbar icon once on that tab and try again. In step 4 Chrome asks to allow that site, or the panel says the same as in step 3.

## The checklist, for each of ten sites

Pick sites with different kinds of motion: a marketing page with hover cards, a menu or dropdown, a modal or drawer, a button with a press effect, a loading spinner, a toast or notification, a tab switch, an accordion, a carousel, and something you already know is driven by JavaScript.

For each site:

1. **Pick.** Does the outline follow the pointer? Is the label readable? Do the up and down arrows help you reach the right element? Does Escape cancel?
2. **Trigger.** Does the page still behave normally after picking (hover, click)?
3. **Capture.** Does a take arrive? How many? Is the plain-words description true?
4. **Preview.** Does the simplified drawing look like the element? Does it move like the real thing?
5. **Not shown.** Is anything listed? Does the reason make sense?
6. **Edit.** Change the curve and a duration. Does the preview follow? Does "Copy CSS" give something you could use?
7. **If anything is wrong:** press "Copy debug report" at the bottom of the panel and paste it into your notes for that site.

## What to send back

For each site: the address, what you picked, what you expected, what happened, and the debug report if something was wrong. One line is enough when it worked.

## How Claude ran the pass

Two scripts do what the checklist above asks, without a person at the keyboard. They inject the same capture script the extension injects.

- `node tests/real-sites.cjs` opens twenty pages, finds elements set up to animate, records each while hovering or clicking it, and saves the takes. It checks that nothing crashes and every capture passes core's checks.
- `node tests/compare.cjs` (needs `pnpm dev`) is the visual check. For each element it pauses the page's own animation at six moments and photographs it, then opens the capture in the editor at the same six moments and photographs the preview, and puts the two rows side by side in `real-sites-output/compare/`. Pausing the page is fine here: this is a test harness, not the tool.

What they cannot do: click the toolbar icon, or judge feel. Those were checked by hand.

## Log

Run on 2026-11-13. "Matches" means the preview's frames were looked at beside the page's and move the same way.

| Site | Element | Before fixes | After fixes |
| --- | --- | --- | --- |
| Fixtures | Card lift, bounce, color and radius morph | Matches | Matches |
| Fixtures | Staggered list | Rows stay faint (1) | Matches |
| getbootstrap.com | Primary button hover | Color matches; text color not shown (3) | Matches |
| getbootstrap.com | Border spinner | Captured, rotation invisible: one-colored ring (known limit) | Same, listed under "not shown" |
| getbootstrap.com | Growing spinner | Matches, plus a stray bar (8) | Matches |
| getbootstrap.com | Accordion | Panels not shown (2) | Both panels animate; siblings do not reflow (limit) |
| getbootstrap.com | Carousel | Next slide not shown (2), not cut off (7) | Matches; slides both drawn flat gray (limit) |
| getbootstrap.com | Tabs | Pane not shown (2) | Shown |
| getbootstrap.com | Dropdown toggle | Captured | Captured |
| getbootstrap.com | Progress stripes, switch | `background-position`: timing and curve only, not previewed | Same |
| daisyui.com | Buttons | `oklab` colors not read (5) | Read as rgb |
| daisyui.com | Loading spinner | Nothing found: it is an SVG animation, not CSS | Same (out of scope) |
| mui.com | Contained button | Matches | Matches |
| linear.app | Nav link | 2.5 s of empty timeline (4) | Starts at 0 |
| stripe.com | Nav, buttons | Captured; recording moved to the nav when a link was picked | Same |
| github.com | Buttons | `oklab` background not read (5) | Read |
| vercel.com | Expanding card | Captured, height and fade | Same |
| animate.style | Heading entrance | Transform not read (6) | "Moves down 1000 px and scales from 0.1 to 1" |
| css-tricks.com, web.dev | Links, buttons | Captured | Captured |
| tailwindcss.com, developer.mozilla.org | (none found in view) | — | — |

No crash on any page, and every capture passed core's checks before and after.

## Problems found and fixed

### 1. No page could be inspected (found on the first load)
**What happened:** on every page, "Pick element" gave "Motion Inspector has no access to this tab yet."
**Cause:** the toolbar click was left to Chrome, to open the side panel by itself. Chrome does not grant `activeTab` for that click, so the extension had access to nothing. It also hides the tab's address in that case, so the fallback had no site to ask for.
**Fix:** the extension now handles the toolbar click itself, which is the gesture that grants access, and opens the panel from there (DECISIONS.md, D88).
**To use it:** rebuild, reload the extension, and click the icon on the tab you want to inspect.
**Confirmed:** working in installed Chrome on 2026-11-13.

### 2. Parts that appear or disappear were not drawn
**What happened:** an accordion's panel, a tab pane, the next carousel slide: "not shown, because that part was left out of the simplified drawing". On those components, that is the main animation.
**Cause:** hidden when picked, so no shape. Or visible but painting nothing, so no shape either.
**Fix:** when a take ends, any animated part without a shape gets one. If it was visible when picked, it uses where it was then, and the shapes of its content are moved inside it. If it was hidden, it is measured now.

### 3. Text color changes were not previewed
**Fix:** `color` is now previewed, on the text bars inside the shape.

### 4. An already-running animation pushed the timeline
**What happened:** on linear.app, a hover started 2.5 s into the timeline.
**Cause:** an animation that was already running when picked counted as the start of the take.
**Fix:** the take starts with the first new animation. One that began earlier keeps its phase through a negative delay.

### 5. Modern colors were not read
**Fix:** `oklab()`, `oklch()` and similar are turned into sRGB numbers by painting one pixel.

### 6. Flat 3D transforms were not read
**Fix:** `translate3d(x, y, 0)`, `translateZ(0)`, `scale3d()` and `rotate3d(0, 0, 1, a)` are read as their 2D forms.

### 7. Content was not cut off by its container
**Fix:** a new field, `Shape.clip`, from CSS `overflow`. Elements that clip get a shape even if they paint nothing. A shape whose size is animating also clips, because CSS often adds `overflow: hidden` only while it moves. This is a change to the locked format.

### 8. Screen-reader text was drawn
**Fix:** elements of 2 by 2 px or less are skipped.

### 1b. Fades were drawn faint (problem 1 in the table)
**Cause:** the preview multiplied the resting opacity by the animated one. My hand-made samples all rested at opacity 1, so it never showed until a real capture.
**Fix:** the animated opacity replaces the resting one. The test for it was first written wrong (it passed with the bug); it now checks that it fails when the bug is put back.

## Second pass: a user's own site (oliverhassan.dev)

Found from a screen recording the user sent of the extension on their portfolio: a round arrow button on a tilted card. The preview showed gray boxes, no circles, misplaced icons, and several identical takes for one hover. Checked afterwards with `node tests/compare.cjs oliverhassan`, which photographs the real page and the preview at the same six moments: they now match frame for frame. A fixture shaped like the button (`icon-button`) and tests cover each fix.

### 9. A hover and its leave were separate takes (D102)
**Cause:** values compared as text: Tailwind's spelled-out resting transform against Chrome's `none`.
**Fix:** values are compared by meaning.

### 10. Icons were gray squares, in the wrong place (D98)
**Cause:** SVG was drawn as a flat image box, placed by its on-screen position, which inside a tilted, scaled card is not its layout position.
**Fix:** icons are drawn from their outlines in their own colors. SVG and text are placed relative to their nearest HTML parent, with on-screen distances divided by how much that parent is scaled.

### 11. The circles next to the arrows were missing, or recording jumped to a huge parent (D101)
**Fix:** recording moves to the nearby parent when something next to the pick starts at the same moment, never to a parent much larger than the pick.

### 12. An arrow waiting to slide in was drawn (two causes)
**Cause 1:** after recording moved to the parent mid-hover, the arrow's resting opacity was read while it was already fading, and set to 1. **Fix:** a running transition's start value is used, which is the value before the trigger.
**Cause 2:** the preview drew each shape at its own opacity, ignoring its parents'. In CSS a parent's opacity fades everything inside it. **Fix:** opacities multiply down the tree (an animated opacity still replaces the same shape's resting one).

### 13. The button was shown on the wrong background (D99)
**Fix:** the preview is painted on the color drawn behind the element.

### 14. Bootstrap's spinner did not visibly turn (D100)
**Fix:** each border side keeps its own color.

## Third pass: an automatic sweep (D103)

`node tests/sweep.cjs` found about 150 animated elements on 33 sites by itself: loaders already running, buttons, links, cards and menu items that animate on hover, and tabs, switches and checkboxes that animate on click. Each was photographed beside its preview. What it found, each now fixed with a fixture and a test:

| # | Seen on | What was wrong | Fix |
|---|---|---|---|
| 15 | Hover.css, CSS loaders, Ant Design | ::before and ::after were never drawn: underlines, sweeps, shadows, whole loaders | Pseudo-elements are shapes (D104) |
| 16 | Stripe, MUI, GitHub | Animations on the parts of an SVG (a chevron's strokes, a circle's dashes) had nowhere to go | Each SVG part is a shape (D105) |
| 17 | Hover.css | The "Fork me" ribbon, rotated 45 degrees, was drawn flat and spilled out of the stage | Resting transforms, and the stage fits what is drawn (D106) |
| 18 | UIkit, GitHub | White cards on white were invisible: their shadow was not drawn | Resting shadows (D106) |
| 19 | CSS loaders | Rings revealed by `clip-path: polygon()` were drawn whole | Clip-paths, resting and animated (D106) |
| 20 | Bootstrap, CSS loaders | Gradient backgrounds and backdrops were gray, so white links on a violet navbar vanished | Gradients in their average color (D106) |
| 21 | Hover.css | An underline growing by `left` and `right` did not move | Size and position from px readings (D107) |
| 22 | Hover.css | "changes transform from perspective(1px) translateZ(0px) to scale(1.1)" | Readings leave out what does nothing (D108) |
| 23 | Linear | "changes background-position-x from 0 px to 0%" | Changes that change nothing are dropped (D108) |
| 24 | Linear | `filter: brightness()` not previewed | Filters are drawn (D108) |
| 25 | Fixture | A border drawn half outside its box was cut by its clip | Borders are drawn inside the box (D106) |

Not tool problems, and left alone: Bulma's and w3schools' buttons sit under a promotional banner or consent overlay, so a hover never reached them (the sweep now skips covered elements). On Stripe's menu and Bootstrap's edit button, what animates is a menu elsewhere on the page, not the element. uiverse.io blocks automated browsers.

## Fourth pass: click components and more of the page's look

`node tests/sweep.cjs c-` tried accordions, tabs, switches, checkboxes and collapses on twenty pages from nine libraries. Its own first runs were wrong (D115); after those fixes:

| # | Seen on | What was wrong | Fix |
|---|---|---|---|
| 26 | Bootstrap | The logo was missing: an evenodd path, white on a navbar colored by a pseudo-element | Fill rules; backdrops from pseudo-elements (D114) |
| 27 | Bootstrap docs | Icons drawn with `<use>` fell back to a dot | Sprites are followed (D114) |
| 28 | shadcn, Mantine | Switch thumbs moved by `calc()` did not move | calc() read in px; translate % measured (D116) |
| 29 | MUI | The tab indicator, outside the picked tab, was never captured | Parents limited by area (D116) |
| 30 | Radix | A gradient over a background color was read as the color | Gradient first (D116) |
| 31 | Everywhere | Text was one bar per line; gradients one color; dashes solid | Word bars (D111), gradient direction (D110), dashes (D112) |
| 32 | Text rolls | A line rolling out of a clipping wrapper was drawn in full | The frame (D113) |

## Fifth pass: product sites (D117)

`node tests/sweep.cjs m-` at 1440 by 900 on 23 product sites. Most of their motion is CSS transitions on hover (colors, small lifts, icon nudges, chevrons, underlines), and it is captured. Found and fixed:

| # | Seen on | What was wrong | Fix |
|---|---|---|---|
| 33 | Webflow | A take was rejected: two shapes added during it had the same id | Ids from a forward-only counter, and a last check |
| 34 | Resend | A spinning border (a CSS variable animated) passed in silence | Listed as not shown |
| 35 | Mercury | The wordmark (more than 16 SVG parts) became a dot | Icons up to 64 parts |
| 36 | Retool | Shimmering text drew a dark box; a glow drew full rings | Text-clipped backgrounds color the text; gradient-border masks are rings; tiles and resting filters |
| 37 | Fixture | A skeleton loader's highlight did not move | Gradient tiles and background-position |
| 38 | Figma | "scales to 1 wide by 1 tall" | "scales from 0 wide by 1 tall to full size" |

Script-driven motion (inline styles changing every frame, no browser animation) was found on 3 elements in 23 sites. Animated SVG groups (Railway's trains) are listed as left out.

## Sixth pass: script-driven motion and the self-check (D124 to D128)

`node tests/script-sites.cjs` records pages whose motion a script makes, moving the pointer as a person would, and opens each take in the editor, whose self-check line says how close the preview is to the film of the page. Found and fixed:

| # | Seen on | What was wrong | Fix |
|---|---|---|---|
| 39 | Fixture | A 3D tilt flattened to almost nothing: rotateY(8deg) and rotateY(-8deg) only made the card 1% narrower | The taper is filmed and drawn (D127) |
| 40 | Fixture | Filmed in capture's frame callback, a script's motion came out one frame late | Filmed right after the script writes (D124) |
| 41 | motion.dev | Parts that appear for the animation had no film, so no self-check | Filmed before they get a shape |
| 42 | vanilla-tilt | The card's tilt was a chain of restarted transitions; the take kept the last one, 17 px off | Following the pointer replaces them (D126), and the film is kept across restarts (D128) |
| 43 | vanilla-tilt | Coming on and following had different speeds; one lag could not match both | Two lags (D126) |

Results: motion.dev's rolling text (Web Animations) checks within 0 px over 10 frames. vanilla-tilt's card is found following the pointer on every run ("turns toward it in 3D and grows, catching up in about 10 ms and easing in and out over about 70 ms"); its glare, which turns with the pointer's angle, is shown as measured and checks 52 px off, and its way back checks 9 px off. Atropos and react-spring did not load within 30 s in the harness.

## Seventh pass: every element checked against the page (D133 to D135)

`node tests/sweep.cjs` now records each element twice: once paused, for the photographs, and once untouched, whose capture is shown and checked. Each line of the summary carries the editor's self-check against the page. 32 sites, about 250 elements: almost all within 0 px. Found and fixed:

| # | Seen on | What was wrong | Fix |
|---|---|---|---|
| 44 | Linear | A focus ring left by a click was not drawn | Outlines are read and drawn (D133) |
| 45 | Fixture | A card edge drawn as a "0 0 0 1px" ring shadow, layered and inner shadows, a tab with only a bottom border were missing or drawn as a box | Every shadow layer, borders per side (D133) |
| 46 | Extension | The hover that picking started began before the take: its row had a delay of -716 ms and an empty bar | A finite transition already under way starts the take (D134) |
| 47 | shadcn | The switch's thumb was filmed 86 px off: "translate: calc(100% - 2px)" was read as 100 px and 2 px | Percentages and calc() in translate are resolved against the element's box (D134) |
| 48 | MUI | The accordion was invisible: a fade-in running at pick, not part of the take, left it at its starting opacity | Each take shows such a fade where it was going, unless it has the fade (D134) |
| 49 | Chakra | A collapsed panel hidden with display: none was filmed as fully visible | A part with no box is filmed as unseen (D134) |
| 50 | daisyUI | A card flip lost its front face's turn: rotateY(180deg) to rotateY(0deg) was taken as no change, 129 px off | Transforms must also agree as 3D matrices to be "no change" (D134) |

## Eighth pass: speed while recording, the parent's perspective, and Vercel's peel (D135 to D138)

`node tests/freeze-sites.cjs` records real pages as the extension does (whole pages picked too) and times their frames; with PROFILE=1 it says which capture functions took the time.

| # | Seen on | What was wrong | Fix |
|---|---|---|---|
| 51 | framer.com, vanilla-tilt, Vercel | Reported: the page froze on hover and click while recording. The curve fit for script-driven motion took 55 ms per moving part, in the page, when each take ended | x1 and x2 searched, y1 and y2 solved exactly: 0.18 ms, and more curves found (D135) |
| 52 | daisyUI | The card flip was drawn flat: 16 px off mid-turn | A parent's perspective is part of each shape (D136). Now within 0.1 px |
| 53 | daisyUI | Both faces of the flip showed through the turn. The click itself switches which face hides its back | backface-visibility is read as each animation begins, and a face turned away is not drawn (D136) |
| 54 | Vercel | Reported: a peeling card gave "Already running" and a merged hover out, not a hover in and a hover out | Script takes are cut where the pointer crosses the edge, never merged, and start where the last ended (D137) |
| 55 | Vercel | Reported: the peeled flap had no shadow: a drop-shadow filter on its wrapper was cut by the flap's own clip | Filters act on a shape and its content once drawn (D138) |
| 56 | Vercel | The flap was grey where the page's is white: the script rewrites its gradient as it peels | background-image is filmed and drawn (D138) |
| 57 | Vercel | Reported: the grid of faint lines over the blue was missing. Only the most opaque gradient layer was drawn | Every layer is kept and drawn; repeating tiles as patterns (D138) |

## Known limits seen on real sites

- **Only the nearest parent's perspective is drawn.** Faces nested deeper inside a preserve-3d parent are drawn as their own parent flattens them.
- **Pseudo-elements are not filmed**, so a take that only moves ::before or ::after has no self-check badge.

- **Images are flat gray**, so two slides of a carousel look the same. Image data is never copied.
- **Text is drawn as bars.** Page text is never copied.
- **A toggle's knob drawn as a background image** (Bootstrap's switch) is not shown.
- **SVG animations (SMIL) are not captured.**
- **Layout is measured, not computed** (D119): parts pushed or resized by an animation move as they did on the page, but only for the take as it was recorded. A pseudo-element in the flow of text (daisyUI's toggle knob) is still not measured.
- **Click ripples** (MUI) are created and removed by script during the click, and are often gone before they can be measured.
- **Menus and dialogs that open elsewhere** (a portal at the end of the page) are not part of the picked element. Pick them when open.
- **A pseudo-element in the flow of text** (an inline arrow after a link) is listed, not drawn: its box cannot be measured.
- **Motion driven by script frame by frame** is measured, not read (D124): transform and opacity only, fitted to keyframes. A rule that is not linear in the pointer's place (a glare that turns with its angle) is shown as measured over time.
- **SVG masks and clips are not drawn.** Railway's moving trains are a mask; they are listed with that reason.
