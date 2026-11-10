// The messages between the page and the side panel. Plain data only.

// From the page (bridge.ts) to the panel.
export type FromPage =
  // An element was picked. The page is now being watched.
  | { type: 'picked' }
  // Picking was cancelled with Escape.
  | { type: 'cancelled' }
  // One take. `capture` has already passed core's checks in the page, and
  // the panel checks it again: it does not trust what a page sends.
  | { type: 'take'; capture: unknown; problems: string[]; raw: unknown }
  // Recording moved to a parent of what was picked, because that is the
  // element that animates. `label` names it, such as "div.card".
  | { type: 'moved'; label: string }
  // Recording has stopped.
  | { type: 'stopped' };

// From the panel to the page.
export type ToPage = { type: 'stop' } | { type: 'cancel' };

// Every message from the page carries this, so the panel can tell them
// apart from anything else that uses chrome.runtime messages.
export const FROM_PAGE = 'motion-inspector';
