// The side panel: "Pick element", "Stop", the list of takes, and the
// editor for the selected take.
//
// All of the panel's state is in panelState.ts, as a pure function. This
// file does the things that touch the browser (injecting the capture
// script, messages, storage) and reports what happened as messages.

import { StrictMode, useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseCapture } from '@motion-inspector/core';
import { Editor } from '@motion-inspector/editor';
import { FROM_PAGE, type FromPage, type ToPage } from './messages';
import './panel.css';
import {
  initialPanel,
  selectedTake,
  showTip,
  updatePanel,
  whyNotInspectable,
  type Panel,
  type StoredTake,
} from './panelState';

const STORAGE_KEY = 'takes';
// "Copy debug report" is for development: it shows only when the extension
// is loaded unpacked. A copy from the Web Store has an update_url.
const IS_DEVELOPMENT = !('update_url' in chrome.runtime.getManifest());

// ---------- Talking to the browser ----------

// The tab to inspect: the one the panel sits beside. If the panel itself is
// open as a tab (as in tests), the tab that was used most recently.
async function findTargetTab(): Promise<chrome.tabs.Tab | null> {
  const own = chrome.runtime.getURL('');
  const isOwn = (tab: chrome.tabs.Tab): boolean => (tab.url ?? '').startsWith(own);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active !== undefined && !isOwn(active)) return active;
  const others = (await chrome.tabs.query({ currentWindow: true })).filter((tab) => !isOwn(tab));
  return others.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0] ?? null;
}

// The capture script is injected here and nowhere else: only when
// "Pick element" is pressed, and only into that one tab.
async function inject(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['capture.iife.js', 'bridge.js'],
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Chrome refused to inject. Is it a page nobody may inspect, or a page this
// extension has no access to yet?
function isForbiddenPage(error: unknown): boolean {
  return /chrome:\/\/|chrome-extension:\/\/|extensions gallery|cannot be scripted|edge:\/\//i.test(
    messageOf(error),
  );
}

// Injects into a tab, asking for access to that one site if needed.
// Returns null on success, or why it could not be done, in plain words.
async function startPicking(tab: chrome.tabs.Tab): Promise<string | null> {
  if (tab.id === undefined) return 'There is no tab to inspect.';
  // The address is only visible when the extension has access to the tab.
  const known = tab.url === undefined ? null : whyNotInspectable(tab.url);
  if (known !== null) return known;

  try {
    await inject(tab.id);
    return null;
  } catch (error) {
    if (isForbiddenPage(error)) {
      return 'Chrome does not let extensions into its own pages or the Web Store.';
    }
    if (tab.url === undefined) {
      // No access, and so no address to ask for access to.
      return 'Motion Inspector has no access to this tab yet. Access is given one tab at a time, by clicking the Motion Inspector icon in the toolbar while that tab is in front. Click the icon once now (the panel stays open), then press Pick element.';
    }
    // Access to the current tab was not granted, or has lapsed (after going
    // to another site, or switching tabs). Ask for this one site only.
    const origin = `${new URL(tab.url).origin}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!granted) {
      return 'Access to this site was not given, so it cannot be inspected. Press Pick element to be asked again.';
    }
    try {
      await inject(tab.id);
      return null;
    } catch (retryError) {
      return `This page cannot be inspected (${messageOf(retryError)}).`;
    }
  }
}

function toPage(tabId: number, message: ToPage): Promise<void> {
  return chrome.tabs.sendMessage(tabId, message).then(
    () => {},
    () => {},
  );
}

// Reads saved takes, keeping only those that still pass core's checks.
async function loadTakes(): Promise<StoredTake[]> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEY);
  const saved: unknown = stored[STORAGE_KEY];
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((item: unknown): StoredTake[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, capture } = item as { id?: unknown; capture?: unknown };
    const parsed = parseCapture(capture);
    return typeof id === 'string' && parsed.ok ? [{ id, capture: parsed.value }] : [];
  });
}

// ---------- What the panel says ----------

function statusText(panel: Panel): string {
  const status = panel.status;
  switch (status.kind) {
    case 'idle':
      return panel.takes.length === 0
        ? 'Ready when you are.'
        : 'Pick another element, or keep editing below.';
    case 'picking':
      return 'Click an element on the page. Esc cancels. The up and down arrows move to its parent or first child.';
    case 'listening': {
      // Say so when the thing being watched is not the thing that was clicked.
      const moved =
        status.movedTo === null
          ? ''
          : ` The animation is on a parent of what you picked, ${status.movedTo}, so that is now being watched.`;
      if (status.found > 0) {
        return `Listening… ${status.found} ${status.found === 1 ? 'take' : 'takes'} captured.${moved} Trigger it again for another, or press Stop.`;
      }
      return showTip(panel)
        ? `Listening…${moved} Nothing yet. Try hovering or clicking the element.`
        : `Listening…${moved} Now trigger the animation on the page.`;
    }
    case 'nothing-found':
      return 'Stopped. No animation was found.';
    case 'cannot-inspect':
      return 'This page cannot be inspected.';
  }
}

function takeTime(take: StoredTake): string {
  const time = new Date(take.capture.source.capturedAt);
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString();
}

// ---------- The panel ----------

function PanelApp() {
  const [panel, dispatch] = useReducer(updatePanel, initialPanel);
  // The tab being inspected, and what the capture script sent, as it sent it.
  const tabId = useRef<number | null>(null);
  const rawTakes = useRef<unknown[]>([]);
  const loaded = useRef(false);
  const [copied, setCopied] = useState('');

  // Saved takes, once, when the panel opens.
  useEffect(() => {
    loadTakes().then(
      (takes) => {
        loaded.current = true;
        dispatch({ kind: 'takesLoaded', takes });
      },
      () => {
        loaded.current = true;
      },
    );
  }, []);

  // Save the takes whenever they change. A failure is shown, never hidden.
  useEffect(() => {
    if (!loaded.current) return;
    chrome.storage.local.set({ [STORAGE_KEY]: panel.takes }).catch((error: unknown) => {
      dispatch({ kind: 'saveFailed', why: messageOf(error) });
    });
  }, [panel.takes]);

  // What the page reports.
  useEffect(() => {
    const onMessage = (
      message: { from?: string } & Partial<FromPage>,
      sender: chrome.runtime.MessageSender,
    ): void => {
      // The toolbar icon was clicked: the tab in front can now be inspected.
      if (message.from === 'motion-inspector-icon') {
        dispatch({ kind: 'accessGiven' });
        return;
      }
      if (message.from !== FROM_PAGE || sender.tab?.id !== tabId.current) return;
      if (message.type === 'picked') dispatch({ kind: 'elementPicked' });
      if (message.type === 'cancelled') dispatch({ kind: 'pickCancelled' });
      if (message.type === 'stopped') dispatch({ kind: 'stopped' });
      if (message.type === 'moved' && typeof message.label === 'string') {
        dispatch({ kind: 'movedToParent', label: message.label });
      }
      if (message.type === 'take') {
        rawTakes.current = [...rawTakes.current, message.raw].slice(-20);
        // Checked again here. The panel does not trust what a page sends.
        const parsed = parseCapture(message.capture);
        if (parsed.ok) {
          dispatch({
            kind: 'takeArrived',
            take: { id: crypto.randomUUID(), capture: parsed.value },
          });
        } else {
          dispatch({
            kind: 'takeRejected',
            problems: [...(message.problems ?? []), ...parsed.errors],
          });
        }
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  // If the inspected tab goes to another page, the capture script is gone.
  useEffect(() => {
    const onUpdated = (updatedId: number, change: { status?: string }): void => {
      if (updatedId === tabId.current && change.status === 'loading') dispatch({ kind: 'stopped' });
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => chrome.tabs.onUpdated.removeListener(onUpdated);
  }, []);

  // Count the time spent listening, for the tip after 5 seconds.
  const listening = panel.status.kind === 'listening';
  useEffect(() => {
    if (!listening) return;
    const timer = window.setInterval(() => dispatch({ kind: 'waited', ms: 1000 }), 1000);
    return () => window.clearInterval(timer);
  }, [listening]);

  const pick = async (): Promise<void> => {
    dispatch({ kind: 'pickStarted' });
    const tab = await findTargetTab();
    const problem = tab === null ? 'There is no tab to inspect.' : await startPicking(tab);
    if (problem !== null) {
      dispatch({ kind: 'cannotInspect', why: problem });
      return;
    }
    tabId.current = tab?.id ?? null;
  };

  const tellPage = (message: ToPage): void => {
    if (tabId.current === null) {
      dispatch({ kind: 'stopped' });
      return;
    }
    // If the page does not answer (it was closed), stop on this side anyway.
    void toPage(tabId.current, message).then(() => {
      if (message.type === 'stop') window.setTimeout(() => dispatch({ kind: 'stopped' }), 300);
    });
  };

  const copyDebugReport = (): void => {
    const report = JSON.stringify(
      {
        version: chrome.runtime.getManifest().version,
        userAgent: navigator.userAgent,
        status: panel.status,
        problems: panel.problems,
        takesHeld: panel.takes.length,
        // The data as the capture script produced it, before core's checks.
        rawTakes: rawTakes.current,
      },
      null,
      2,
    );
    navigator.clipboard.writeText(report).then(
      () => setCopied('Debug report copied.'),
      () => setCopied('Could not copy the debug report.'),
    );
  };

  const status = panel.status;
  const shown = selectedTake(panel);

  return (
    <div className="xp">
      <header className="xp__bar">
        <span className="xp__name">Motion Inspector</span>
        <div className="xp__buttons">
          {status.kind === 'picking' ? (
            <button type="button" className="btn" onClick={() => tellPage({ type: 'cancel' })}>
              Cancel
            </button>
          ) : status.kind === 'listening' ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => tellPage({ type: 'stop' })}
            >
              Stop
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => void pick()}>
              Pick element
            </button>
          )}
        </div>
        <p className="xp__status" role="status">
          {statusText(panel)}
        </p>
      </header>

      {panel.notice !== null ? (
        <div className="xp__notice" role="alert">
          <span>{panel.notice}</span>
          <button
            type="button"
            className="btn"
            onClick={() => dispatch({ kind: 'noticeDismissed' })}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {status.kind === 'cannot-inspect' ? (
        <section className="xp__message">
          <h2>This page cannot be inspected</h2>
          <p>{status.why}</p>
        </section>
      ) : null}

      {status.kind === 'nothing-found' ? (
        <section className="xp__message">
          <h2>No animation was found</h2>
          <p>
            Motion Inspector sees CSS transitions, CSS keyframe animations and Web Animations. This
            one may be driven by JavaScript frame by frame, drawn on a canvas, or tied to scrolling.
            Things to try: pick a parent of the element, pick the part that actually moves, or
            trigger it again after pressing Pick element.
          </p>
        </section>
      ) : null}

      {panel.takes.length === 0 && status.kind === 'idle' ? (
        <section className="xp__message">
          <h2>Three steps</h2>
          <ol>
            <li>
              <strong>Pick.</strong> Press Pick element, then click the part of the page that moves.
            </li>
            <li>
              <strong>Trigger.</strong> Hover or click it on the page, so it animates.
            </li>
            <li>
              <strong>Tweak.</strong> Change its curve and timing here, then copy the result.
            </li>
          </ol>
        </section>
      ) : null}

      {panel.takes.length > 0 ? (
        <section className="xp__takes">
          <div className="xp__takes-head">
            <h2>Takes</h2>
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ kind: 'takesCleared' })}
            >
              Clear all
            </button>
          </div>
          <ul className="xp__take-list">
            {panel.takes.map((take) => (
              <li key={take.id}>
                <button
                  type="button"
                  className="xp__take"
                  aria-pressed={take.id === panel.selectedId}
                  onClick={() => dispatch({ kind: 'takeSelected', id: take.id })}
                >
                  <code>{take.capture.source.selector}</code>
                  <span>
                    {take.capture.tracks.length}{' '}
                    {take.capture.tracks.length === 1 ? 'track' : 'tracks'} · {takeTime(take)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* A new take replaces the editor, so it plays once as it arrives. */}
      {shown !== null ? <Editor key={shown.id} capture={shown.capture} /> : null}

      {IS_DEVELOPMENT ? (
        <div className="xp__debug">
          <button type="button" className="btn" onClick={copyDebugReport}>
            Copy debug report
          </button>{' '}
          <span role="status">{copied}</span>
        </div>
      ) : null}
    </div>
  );
}

const container = document.getElementById('app');
if (container === null) throw new Error('Missing #app');
createRoot(container).render(
  <StrictMode>
    <PanelApp />
  </StrictMode>,
);
