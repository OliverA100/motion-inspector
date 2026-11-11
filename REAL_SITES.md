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

## Eighth pass: speed while recording, the parent's perspective, Vercel's peel, and new kinds of sites (D135 to D146)

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
| 58 | Sonner | A toast's button take was named "Focus" | A press inside the element names its take "Click" (D139) |
| 59 | NumberFlow | Digits rolled by animating CSS variables: 415 px and 100% opacity off | Parts moved through a variable are filmed and measured: within 1.2 px (D139) |
| 60 | MUI | The tab's click ripple stayed drawn after it was taken off the page: 100% opacity off | Parts taken off the page are hidden from then on (D139) |
| 61 | Fine | Hamburger icons (spin, elastic), Radix and Mantine switches, GSAP hover | All within 0.1 px of the page |
| 62 | shadcn, MUI | A dropdown or dialog opens in a portal at the end of the page: picking its button captured nothing of it | Recording moves to what the press opened; each is one "Click" take within 0 px (D141) |
| 63 | shadcn | The portal's host is an empty box: moving to it failed, and recording stopped without a word | The outermost new part with a size is recorded; a failed move goes on where it was (D141) |
| 64 | MUI | An empty "nothing to see" take after the menu's real one | Not sent once a take with motion is in (D141) |
| 65 | scroll-driven-animations.style | Scroll-driven animations were listed as "not shown" | Listed when picked, shown over a nominal second, exported with their timeline and range (D142) |
| 66 | Magic UI | A spinning border light (conic gradient) was a flat color; the button's label hid under a black panel after it (z-index); a marquee read "changes transform to translateX(calc(-100% - 16px))"; loops were "Already running" | Conic gradients, stacking order, calc() lengths, "Loops" (D143) |
| 67 | Aceternity | The 3D card's hover was dropped after recording moved to its parent, and its leave was fitted as a follow from rest (5.8 px) | A moved recording keeps what is happening; a follow needs the pointer on it (D143). 2.2 px and 0 px |
| 68 | Mantine, Ant Design | Accordions, collapse, modal | Within 0 px. Ant's modal is followed by its dialog (74) |
| 69 | MUI | The removed ripple made six "moved by layout" rows (read at -385 px, 0 wide after it left) | Removed parts are not sampled (D144) |
| 70 | GitHub | A dialog checked 8 px off: the page played its 200 ms animation late and in steps over a second | The self-check is right; parts are now filmed only once their animations are on screen (D144) |
| 71 | Editor | Playing NumberFlow's capture (30 tracks) with the CPU slowed four times: frames of 83 ms | The description is worked out per edit, not per frame: 33 ms (D145) |
| 72 | Stripe | The nav caret, 2 px off in every sweep: translate set apart from an animated transform was dropped | translate, rotate and scale are kept with transform (D147): 0 px |
| 73 | Magic UI | The rotating word's outgoing heading was "left out of the drawing": text only, and gone by the end of the take | Shaped as soon as it animates (D144) |
| 74 | Ant Design, shadcn | The modal was followed by its backdrop; the dialog, centered by translate -50%, drawn 245 px off | The opened part with content is chosen; translate kept in px, and kept at rest (D149): 0 px |

| 75 | Shoelace | Web components: a switch and a details panel inside shadow roots | Within 0 px. (Their docs open with a promotional dialog over the page; the harness removes it.) |
| 76 | Special cases page | Popovers and dialogs gave no take; a player sped up or reversed was 22 to 51 px off; composition 40 px; paths and SVG dashes looked still; a turning registered variable was listed; a view transition gave no take | D150: all at 0 px or listed with the reason |
| 77 | Material Web | Its demos run inside an iframe | Not recorded: the recorder works in one document |
| 78 | Magic UI (border beam) | A dot a script moves round its card with offset-path: rect(): the path was not read, so it stood still; once read, the film was fitted as a turning transform, 10 px off at the corners | D150: the path is read for rect(), inset(), xywh() and circle(), and the film gives its distance: 0 px for the CSS version of our fixture, the script one within the film's step |
| 79 | Shoelace (select, dropdown) | No take: the popup animates in a shadow root inside a part hidden when picked; then its options and menu items were not drawn, being slotted | Every open shadow root is asked; slots are walked through to what is slotted (D150). Within 0 px |
| 80 | Chrome view transition demos | A page that slides in with its own animation of ::view-transition-new gave no motion | Read as the part's own (D150) |
| 81 | oliverhassan.dev | A round button drawn cut in half: its box is centred with a -640 px translate, which the clipping frame left out | D153: whole |
| 82 | vercel.com/backends | The peeled flap was left out of the drawing (the last part of a busy card); the hover was named "Loops" after the chat's typing dots, and its start "Already running" | D151, D153: flap drawn, within 1 px; "Hover in", "Hover out" |
| 83 | Radix (tooltips), Mantine (tooltip, popover) | Tooltips opened by hovering, at the end of the page, gave no take | Followed from the hovered element (D157) |
| 84 | shadcn (popover), Radix (navigation menu) | 12 to 68 px and 100% opacity off: a sub-millisecond start offset; a late part's rest read mid-animation; a closed panel left shown | D157: 0 px |
| 85 | Mantine (loader) | A full turn about y (rotateY 0 to 3600deg) dropped as no change | D157: drawn, "turns round 10 times" |
| 86 | Ant Design (tabs, spin) | A closed dropdown made 60 layout tracks; spinner dots 70% opacity off | D159: 0 px |
| 87 | Headless UI, Storybook | Components shown in a frame could not be picked | D160: picked, recorded and played inside frames |
| 88 | Carbon (Storybook) | Button, toggle: 0 px. An accordion opened by max-height and padding was called not drawn | D163: its panel is measured, 0 px |
| 89 | Magic UI, link arrows | Masked rings and fading edges drawn whole; arrows after links listed | D155, D158: drawn |
| 90 | Aceternity (logo) | 4 corner dots reported missing; the mark turned in 3D 2.8 px off | D164: 0.5 px |
| 91 | Shoelace (dropdown, tooltip, details) | Tooltip bubble not followed; its hiding said with the way in | D164: followed, 0 px |
| 92 | LottieFiles | Its players draw on a canvas: "No animation was found" sent people to a parent | D165: says a canvas cannot be recorded |
| 93 | Duolingo (Lottie characters, SVG) | Take refused (tracks named undrawn groups); layers shown and hidden read as slow fades | D166, D167: 1.2 px |
| 94 | Radix (search dialog) | Dimming drawn over the dialog; it went back to 0% opacity after its fade | D170: 0 px |
| 95 | Aceternity (logo text) | A spring set off by the pointer arriving was called following the pointer | D168: measured as motion |
| 96 | svg-spinners (10 SMIL spinners, local page) | Every part reported missed: SMIL is in no animation API | D172, D173: all match, 0 to 1.2 px |
| 97 | MUI (show code toggle, on every component page) | Nothing recorded: the click was taken for motion already running | D174: recorded as a click, 0 px |
| 98 | Library sweep (85 pages, 379 checks) | 374 matched before these fixes; the rest were Radix (D170), MUI (D174) and ones that matched when recorded again | |
| 99 | Railway (button highlight following the pointer) | Restarted 62 times; only the last restart shown, 24 px off | D176: 0 to 0.5 px |
| 100 | Product sweep (24 sites, 185 checks) | 165 matched; Railway (D176), Attio (D177) and Cal (D178) fixed since; run again: 171, and D184 fixed the 6 it got wrong | |
| 101 | Cal (menu on hover) | Shrunk by a class with no transition as it faded: 20 px off | D178: 0 px |
| 102 | Attio (buttons) | Lit by a variable in a radial gradient: listed as not drawn | D177: filmed and drawn |
| 103 | Figma (button icon) | 2.2 px off: an svg's translate: 0 -50% read from its drawing | D179: 0 px |
| 104 | Retool (link underline) | Not drawn: background-size; a 2 px tile filled the whole link | D180: drawn, 0 px |
| 105 | Arc (links) | Not drawn: text-decoration-color; no underline drawn | D181: drawn and said |
| 106 | MUI (tabs, ripple) | 81 px off: the ripple went back to nothing in the preview after its spread | D185: 0.2 px |
| 107 | GitHub (marquee item) | Called missed: the marquee carrying it along | D185: 0 px |
| 108 | Original sweep (33 pages, 331 checks) | 318 matched before D185 | |
| 109 | Library sweep again (85 pages, 390 checks) | 387 matched. shadcn's popover: 21 px and 100% at 0 ms on one run in two; Magic UI's list: 4% at 0 ms | D191: a miss the preview a frame either side does not make is not one; both 0 px |
| 110 | Ant Design (tab overflow menu) | 39 px: the sweep reopened a menu that opens on hover while the one from its first run was still open, and two menus were on the page. Recorded once on a fresh page it matches (0 px) | Not a tool problem. Found while looking: an animation made paused and run later (D192), now dated from when it runs |

Checkpoint after D149: the full sweep checks 311 elements. All within 1.4 px of the page but GitHub's dialog (the page plays it late) and, now and then, MUI's tab ripple when two clicks land on the same spot 400 ms apart (the sweep's pick and its click): two overlapping ripples, 82 px off at the end on some runs, 0 px on others.

The sweep now also runs Magic UI, Aceternity, a scroll-driven demo, and menus and dialogs that open at the end of the page (shadcn, MUI, Ant Design), and Catalyst's switch: 43 more elements, all within 1.4 px. Before them, it checked 279 elements on 32 sites: all within 1.4 px of the page but GitHub's dialog, which the page plays late. Stripe's caret, the other, is fixed (72).

## Known limits seen on real sites

- **Only the nearest parent's perspective is drawn.** Faces nested deeper inside a preserve-3d parent are drawn as their own parent flattens them.

- **Images are flat gray**, so two slides of a carousel look the same. Image data is never copied.
- **Text is drawn as bars.** Page text is never copied.
- **A toggle's knob drawn as a background image** (Bootstrap's switch) is not shown.
- **SVG animations (SMIL) are not captured.**
- **Layout is measured, not computed** (D119): parts pushed or resized by an animation move as they did on the page, but only for the take as it was recorded.
- **A pseudo-element in the flow of text** is placed from its element's text: right for one at the start or end of a line, approximate inside a flex or grid layout.
- **Motion driven by script frame by frame** is measured, not read (D124): transform and opacity only, fitted to keyframes. A rule that is not linear in the pointer's place (a glare that turns with its angle) is shown as measured over time.
- **Parts inside a frame** are recorded (D160). Play the hover and Play the click need to know where a frame from another site is, which it does not say.
- **A view transition's cross-fade** is listed, not drawn.
- **SVG masks and clips are not drawn.** Railway's moving trains are a mask; they are listed with that reason.
