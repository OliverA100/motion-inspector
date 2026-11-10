// The bridge: a small script injected into the page right after the capture
// script. It starts the picker, and passes what capture finds on to the
// side panel. It is only ever injected when "Pick element" is pressed.

import { FROM_PAGE, PANEL_PORT, type FromPage, type PageRect, type ToPage } from './messages';

// The capture script, injected just before this one, puts this on window.
declare const MotionCapture: {
  pickAndRecord: (
    onTake: (take: TakeResult) => void,
    onMoved: (label: string) => void,
    onStopped: () => void,
  ) => Promise<boolean>;
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

const onMessage = (
  message: ToPage,
  _sender: chrome.runtime.MessageSender,
  answer: (response: PageRect | null) => void,
): void => {
  if (message.type === 'where') answer(capture.recordedRect());
  if (message.type === 'cancel') capture.cancelPicking();
  if (message.type === 'again') {
    send({ type: capture.recordAgain(onTake, onMoved, onStopped) ? 'picked' : 'cancelled' });
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

capture
  .pickAndRecord(onTake, onMoved, onStopped)
  .then((picked) => send({ type: picked ? 'picked' : 'cancelled' }))
  .catch(() => send({ type: 'cancelled' }));
