// The messages between the page and the side panel. Plain data only.

// From the page (bridge.ts) to the panel.
export type FromPage =
  // An element was picked. It is not recorded until the panel asks.
  // label names it, such as "button.cta". draws: it is or holds a canvas
  // or a video, whose pictures are made frame by frame and cannot be read.
  | { type: 'picked'; label?: string; draws?: 'canvas' | 'video' | null }
  // Recording of the picked element has begun.
  | { type: 'recording' }
  // Recording could not begin: the picked element is no longer on the page,
  // and nothing stands where it was.
  | { type: 'gone' }
  // Picking was cancelled with Escape.
  | { type: 'cancelled' }
  // One take. `capture` has already passed core's checks in the page, and
  // the panel checks it again: it does not trust what a page sends.
  // replaces: true when it is the previous take with its way back added.
  | { type: 'take'; capture: unknown; problems: string[]; raw: unknown; replaces: boolean }
  // Recording moved to a parent of what was picked, because that is the
  // element that animates. `label` names it, such as "div.card".
  | { type: 'moved'; label: string }
  // Recording has stopped. auto: it stopped by itself, a take being
  // complete; otherwise Stop was pressed.
  | { type: 'stopped'; auto?: boolean };

// From the panel to the page.
// again: record the element picked last, without picking.
// where: the page answers with the recorded element's box in the window
// (a PageRect, or null), for "Play the hover" and "Play the click".
// whereabouts: the page answers with how to find the picked element again
// after a reload (Whereabouts, or null), for "Play the load".
export type ToPage =
  | { type: 'stop' }
  | { type: 'cancel' }
  | { type: 'again' }
  | { type: 'where' }
  | { type: 'whereabouts' };

// How the capture script finds an element again after the page reloads.
export type Whereabouts = { path: string; short: string; index: number; label: string };

export type PageRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  // True when something on the page sits over its middle (a fixed header).
  covered?: boolean;
  // Inside a frame: where that frame's top left is in the tab's window, so
  // the pointer can be moved there. null when a frame on the way is from
  // another site, which does not say where it is.
  frame?: { x: number; y: number } | null;
};

// Every message from the page carries this, so the panel can tell them
// apart from anything else that uses chrome.runtime messages.
export const FROM_PAGE = 'motion-inspector';

// The page keeps a connection open to the panel under this name. When the
// panel closes, Chrome ends it, and the page stops picking and recording.
export const PANEL_PORT = 'motion-inspector-panel';
