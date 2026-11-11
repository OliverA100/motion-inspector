// The bridge: a small script injected into the page right after the capture
// script. It starts the picker, and passes what capture finds on to the
// side panel. It is only ever injected when "Pick element" is pressed.

import {
  FROM_PAGE,
  PANEL_PORT,
  type FromPage,
  type PageRect,
  type ToPage,
  type Whereabouts,
} from './messages';

// The capture script, injected just before this one, puts this on window.
declare const MotionCapture: {
  pick: () => Promise<string | null>;
  choose: (where: Whereabouts) => string | null;
  pickedWhereabouts: () => Whereabouts | null;
  pickParent: () => string | null;
  drawsItself: () => 'canvas' | 'video' | null;
  recordAgain: (
    onTake: (take: TakeResult) => void,
    onMoved: (label: string) => void,
    onStopped: () => void,
  ) => boolean;
  cancelPicking: () => void;
  stop: () => unknown[];
  recordedRect: () => PageRect | null;
};

type TakeResult = { capture: unknown; problems: string[]; raw: unknown; replaces: boolean };

type Session = { end: () => void };

declare global {
  interface Window {
    motionInspectorSession?: Session;
    // Set by the panel just before injecting, after "Play the load": the
    // element to choose again, instead of picking.
    motionInspectorChoose?: Whereabouts;
  }
}

function send(message: FromPage): void {
  // The panel may have been closed. There is then nobody to tell.
  chrome.runtime.sendMessage({ from: FROM_PAGE, ...message }).catch(() => {});
}

// Pressing "Pick element" again injects both scripts again. End what the
// earlier ones were doing first, or the page would be watched twice.
window.motionInspectorSession?.end();

// Hold on to this injection's own copy of the capture script.
const capture = MotionCapture;

const onTake = (take: TakeResult): void => send({ type: 'take', ...take });
const onMoved = (label: string): void => send({ type: 'moved', label });
// The take is complete and nothing else happened: stopped by itself.
const onStopped = (): void => send({ type: 'stopped', auto: true });

// Where this frame's top left is in the tab's window: the frames it is
// inside, each scrolled into view, added up. null when one of them is from
// another site, which does not say where it is.
function frameOffset(): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  let at: Window = window;
  while (at !== at.top) {
    const holder = at.frameElement;
    if (holder === null) return null;
    holder.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const box = holder.getBoundingClientRect();
    const style = at.parent.getComputedStyle(holder);
    x += box.left + holder.clientLeft + (parseFloat(style.paddingLeft) || 0);
    y += box.top + holder.clientTop + (parseFloat(style.paddingTop) || 0);
    at = at.parent;
  }
  return { x, y };
}

const onMessage = (
  message: ToPage,
  _sender: chrome.runtime.MessageSender,
  answer: (response: PageRect | Whereabouts | null) => void,
): void => {
  if (message.type === 'where') {
    const frame = frameOffset();
    const rect = capture.recordedRect();
    answer(rect === null ? null : { ...rect, frame });
  }
  if (message.type === 'whereabouts') answer(capture.pickedWhereabouts());
  if (message.type === 'parent') {
    const label = capture.pickParent();
    if (label !== null) send(picked(label));
  }
  if (message.type === 'cancel') capture.cancelPicking();
  if (message.type === 'again') {
    // A failure is said, not swallowed: the panel would wait in silence.
    try {
      send({ type: capture.recordAgain(onTake, onMoved, onStopped) ? 'recording' : 'gone' });
    } catch (error) {
      send({ type: 'cannotRecord', why: error instanceof Error ? error.message : String(error) });
    }
  }
  if (message.type === 'stop') {
    // stop() delivers a take that was still in progress before it returns.
    capture.stop();
    send({ type: 'stopped' });
  }
};
chrome.runtime.onMessage.addListener(onMessage);

// A connection to the panel, held open while this session lasts. Chrome
// ends it when the panel closes (or the extension is reloaded): then the
// picker goes away and recording stops, with nobody left to show it to.
const panel = chrome.runtime.connect({ name: PANEL_PORT });

const session: Session = {
  end: () => {
    capture.cancelPicking();
    capture.stop();
    chrome.runtime.onMessage.removeListener(onMessage);
    panel.onDisconnect.removeListener(onPanelClosed);
    panel.disconnect();
    if (window.motionInspectorSession === session) delete window.motionInspectorSession;
  },
};
const onPanelClosed = (): void => session.end();
panel.onDisconnect.addListener(onPanelClosed);
window.motionInspectorSession = session;

// What the panel is told about the picked element.
const picked = (label: string): FromPage => ({
  type: 'picked',
  label,
  draws: capture.drawsItself(),
});

// Picking only: recording starts when the panel asks. After "Play the
// load", the element is chosen again instead.
const chosen = window.motionInspectorChoose;
delete window.motionInspectorChoose;
if (chosen !== undefined) {
  const label = capture.choose(chosen);
  send(label === null ? { type: 'cancelled' } : picked(label));
} else {
  capture
    .pick()
    .then((label) => send(label === null ? { type: 'cancelled' } : picked(label)))
    .catch(() => send({ type: 'cancelled' }));
}
