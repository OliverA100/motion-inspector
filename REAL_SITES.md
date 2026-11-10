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

## Log

| Site | Element | Result | Problem | Fixed |
| --- | --- | --- | --- | --- |
| (none yet) | | | | |

## Problems found and fixed

### 1. No page could be inspected (found on the first load)
**What happened:** on every page, "Pick element" gave "Motion Inspector has no access to this tab yet."
**Cause:** the toolbar click was left to Chrome, to open the side panel by itself. Chrome does not grant `activeTab` for that click, so the extension had access to nothing. It also hides the tab's address in that case, so the fallback had no site to ask for.
**Fix:** the extension now handles the toolbar click itself, which is the gesture that grants access, and opens the panel from there (DECISIONS.md, D88).
**To use it:** rebuild, reload the extension, and click the icon on the tab you want to inspect.
**Confirmed:** working in installed Chrome on 2026-11-13.
