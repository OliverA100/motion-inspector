// The side panel: "Pick element", "Stop", the list of takes, and the
// editor for the selected take.
//
// All of the panel's state is in panelState.ts, as a pure function. This
// file does the things that touch the browser (injecting the capture
// script, messages, storage) and reports what happened as messages.

import { StrictMode, useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describeCapture, parseCapture, type Trigger } from '@motion-inspector/core';
import { aboutMotion, Editor, notDrawn, takeLengthMs } from '@motion-inspector/editor';
import {
  FROM_PAGE,
  PANEL_PORT,
  type FromPage,
  type PageRect,
  type ToPage,
  type Whereabouts,
} from './messages';
import { playClick, playHover, playLoad } from './playHover';
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
// "Pick element" is pressed, and only into that one tab: into every frame
// of it, so a part shown in a frame (a component in Storybook, a docs
// demo) can be picked. If a frame cannot be reached, the page alone.
async function inject(tabId: number): Promise<void> {
  const files = ['capture.iife.js', 'bridge.js'];
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files });
  }
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

// To the frame the element was picked in, or to every frame when none is.
function toPage(tabId: number, message: ToPage, frameId: number | null): Promise<void> {
  const sent =
    frameId === null
      ? chrome.tabs.sendMessage(tabId, message)
      : chrome.tabs.sendMessage(tabId, message, { frameId });
  return sent.then(
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

// One short line, or nothing: the buttons and the page say the rest.
// What the panel says when a recording found nothing. A canvas or a video
// makes its pictures frame by frame, which no recording can read.
function nothingFoundText(draws: 'canvas' | 'video' | null): string {
  if (draws === 'canvas') {
    return 'No animation was found. It holds a canvas: what a script draws on a canvas cannot be recorded, only parts the page animates.';
  }
  if (draws === 'video') {
    return 'No animation was found. It holds a video, which plays frames rather than moving parts, so it cannot be recorded.';
  }
  return 'No animation was found. Try again, or pick its parent or the part that moves.';
}

function statusText(panel: Panel): string {
  const status = panel.status;
  switch (status.kind) {
    case 'idle':
    case 'ready':
      return panel.stoppedByItself ? 'Recording stopped by itself.' : '';
    case 'picking':
      // With no takes yet, the panel's middle says it under "Pick an element".
      return panel.takes.length === 0
        ? 'Click it on the page. Esc cancels.'
        : 'Click an element on the page. Esc cancels.';
    case 'listening': {
      // Say so when the thing being watched is not the thing that was clicked.
      const moved =
        status.movedTo === null ? '' : `Watching ${status.movedTo}, the part that moves. `;
      if (status.found > 0) {
        return `Listening… ${moved}${status.found === 1 ? '1 take' : `${status.found} takes`}.`;
      }
      // Under "Listening" in the panel's middle when nothing is captured
      // yet; in the status line, after the word, when takes are listed.
      const listening = panel.takes.length === 0 ? '' : 'Listening… ';
      return showTip(panel)
        ? `${listening}${moved}Nothing yet. Hover or click it on the page.`
        : `${listening}${moved}Hover or click it on the page.`;
    }
    case 'cannot-inspect':
      return '';
  }
}

// What set a take off, in plain words.
const TRIGGER_WORDS: { trigger: Trigger; words: string }[] = [
  { trigger: 'hover', words: 'Hover in' },
  { trigger: 'leave', words: 'Hover out' },
  { trigger: 'hover-and-leave', words: 'Hover in and out' },
  { trigger: 'click', words: 'Click' },
  { trigger: 'focus', words: 'Focus' },
  { trigger: 'blur', words: 'Focus lost' },
  { trigger: 'key', words: 'Key press' },
  { trigger: 'loop', words: 'Loops' },
  // Not sent since D151: kept for takes saved before.
  { trigger: 'running', words: 'Already running' },
  { trigger: 'scroll', words: 'On scroll' },
  { trigger: 'load', words: 'On load' },
  { trigger: 'unknown', words: 'On its own' },
];

function triggerWords(take: StoredTake): string {
  const trigger = take.capture.trigger;
  return TRIGGER_WORDS.find((item) => item.trigger === trigger)?.words ?? 'Take';
}

// What a take already knows it lacks, without playing it: parts that moved
// and are not in it, motion left out, properties not drawn. null when
// nothing. The editor's badge says the rest (how close it is).
function gapWords(take: StoredTake): string | null {
  const capture = take.capture;
  // Text that changes is never copied: said as that, not as a missing part.
  const missed = (capture.missed ?? []).filter((item) => item.what !== 'text').length;
  const textChanges = (capture.missed ?? []).some((item) => item.what === 'text');
  const leftOut = capture.notShown.filter(aboutMotion).length;
  const undrawn = notDrawn(capture).length;
  const words = [
    ...(missed === 0 ? [] : [missed === 1 ? '1 part missing' : `${missed} parts missing`]),
    ...(textChanges ? ['text not copied'] : []),
    ...(undrawn === 0
      ? []
      : [undrawn === 1 ? '1 property not drawn' : `${undrawn} properties not drawn`]),
    ...(leftOut === 0 ? [] : [leftOut === 1 ? '1 thing left out' : `${leftOut} things left out`]),
  ];
  if (words.length === 0) return null;
  // Sentence case: "Text not copied" when it comes first.
  const text = words.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lengthWords(take: StoredTake): string {
  // A part that follows the pointer has no length: it moves for as long as
  // the pointer does.
  if (take.capture.tracks.length === 0 && (take.capture.follows ?? []).length > 0) {
    return 'Follows the pointer';
  }
  const ms = Math.round(takeLengthMs(take.capture));
  return ms >= 1000 ? `${Math.round(ms / 100) / 10} s` : `${ms} ms`;
}

// Takes of the same element, one after another, are shown together under
// that element's name.
function groupsOf(
  takes: StoredTake[],
): { key: string; selector: string; host: string; takes: StoredTake[] }[] {
  const groups: { key: string; selector: string; host: string; takes: StoredTake[] }[] = [];
  for (const take of takes) {
    const { selector, url } = take.capture.source;
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // Keep the address as it is.
    }
    const last = groups[groups.length - 1];
    if (last !== undefined && last.selector === selector && last.host === host)
      last.takes.push(take);
    else groups.push({ key: take.id, selector, host, takes: [take] });
  }
  return groups;
}

// The first sentence of the description, without "The element".
function summaryOf(take: StoredTake): string {
  const first = describeCapture(take.capture).split('. ')[0] ?? '';
  const trimmed = first.replace(/^The element /, '').replace(/\.$/, '');
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
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
  // The frame of that tab the element was picked in: 0 for the page itself,
  // null while picking (every frame offers the picker).
  const frameId = useRef<number | null>(null);
  const rawTakes = useRef<unknown[]>([]);
  // The id of the last take, so a take that completes it can replace it.
  const lastTakeId = useRef<string | null>(null);
  // The bar is pinned at the top. The editor's preview pins itself just
  // under it, so it needs the bar's height, which changes with the status.
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    if (bar === null) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--mi-sticky-top', `${bar.offsetHeight}px`);
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  // The More menu closes as menus do: a press anywhere outside it, or
  // Escape, which gives focus back to its button.
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onPress = (event: PointerEvent): void => {
      const menu = menuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    const onKey = (event: KeyboardEvent): void => {
      const menu = menuRef.current;
      if (event.key !== 'Escape' || !menu?.open) return;
      menu.open = false;
      menu.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);
  const loaded = useRef(false);
  const [copied, setCopied] = useState('');
  // What the extension is playing on the page, while it moves the pointer.
  const [playing, setPlaying] = useState<'hover' | 'click' | 'load' | null>(null);
  // Waiting for the page: recording to begin, or a take to arrive.
  const waiters = useRef<{ recording: (() => void)[]; take: (() => void)[] }>({
    recording: [],
    take: [],
  });
  const waitFor = (what: 'recording' | 'take', ms: number): Promise<boolean> =>
    new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(false), ms);
      waiters.current[what].push(() => {
        window.clearTimeout(timer);
        resolve(true);
      });
    });
  const heard = (what: 'recording' | 'take'): void => {
    const waiting = waiters.current[what];
    waiters.current[what] = [];
    for (const resolve of waiting) resolve();
  };

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

  // A take from the page. Checked again here: the panel does not trust what
  // a page sends.
  const accept = (message: {
    capture?: unknown;
    problems?: string[];
    raw?: unknown;
    replaces?: boolean;
  }): void => {
    rawTakes.current = [...rawTakes.current, message.raw].slice(-20);
    const parsed = parseCapture(message.capture);
    if (parsed.ok) {
      // A take that adds a hover's leave replaces the hover's take, and
      // keeps its id, so it stays selected and in its place in the list.
      const previousId = lastTakeId.current;
      const replaced = message.replaces === true && previousId !== null;
      const id = replaced && previousId !== null ? previousId : crypto.randomUUID();
      lastTakeId.current = id;
      dispatch({ kind: 'takeArrived', take: { id, capture: parsed.value }, replaced });
      heard('take');
    } else {
      dispatch({
        kind: 'takeRejected',
        problems: [...(message.problems ?? []), ...parsed.errors],
      });
    }
  };
  // True while "Play the load" reloads the page: the page going away is
  // then expected, not a reason to forget the picked element.
  const reloading = useRef(false);

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
      // Once picked, only that frame speaks for the element.
      if (
        frameId.current !== null &&
        message.type !== 'picked' &&
        sender.frameId !== frameId.current
      ) {
        return;
      }
      if (message.type === 'picked' && frameId.current === null) {
        frameId.current = sender.frameId ?? 0;
        // The other frames stop offering the picker.
        void toPage(tabId.current ?? 0, { type: 'cancel' }, null);
      }
      if (message.type === 'cancelled' && frameId.current === null && tabId.current !== null) {
        // Escape in one frame cancels picking in all of them.
        void toPage(tabId.current, { type: 'cancel' }, null);
      }
      if (message.type === 'picked') {
        dispatch({
          kind: 'elementPicked',
          label: typeof message.label === 'string' ? message.label : 'the element',
          draws: message.draws === 'canvas' || message.draws === 'video' ? message.draws : null,
        });
      }
      if (message.type === 'recording') {
        dispatch({ kind: 'recordingStarted' });
        heard('recording');
      }
      if (message.type === 'cancelled') dispatch({ kind: 'pickCancelled' });
      if (message.type === 'stopped') dispatch({ kind: 'stopped', auto: message.auto === true });
      if (message.type === 'moved' && typeof message.label === 'string') {
        dispatch({ kind: 'movedToParent', label: message.label });
      }
      if (message.type === 'take') accept(message);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    // Accepting the page's connection is all: it is ended by Chrome when
    // this panel closes, which tells the page to stop.
    const onConnect = (port: chrome.runtime.Port): void => {
      if (port.name !== PANEL_PORT) port.disconnect();
    };
    chrome.runtime.onConnect.addListener(onConnect);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.runtime.onConnect.removeListener(onConnect);
    };
  }, []);

  // Switching tabs, or the page in front changing, needs no reopening: the
  // panel follows the tab in front. If the inspected tab goes to another
  // page, its capture script is gone.
  useEffect(() => {
    const onUpdated = (updatedId: number, change: { status?: string }): void => {
      if (change.status !== 'loading') return;
      if (updatedId === tabId.current && reloading.current) return;
      if (updatedId === tabId.current) {
        dispatch({ kind: 'stopped', auto: false });
        tabId.current = null;
      }
      dispatch({ kind: 'tabChanged' });
    };
    const onActivated = (): void => dispatch({ kind: 'tabChanged' });
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onActivated.addListener(onActivated);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  // Access to every site, asked for once, so no page needs the toolbar icon
  // again. Optional: until it is given, access is per tab.
  const [allSites, setAllSites] = useState(false);
  useEffect(() => {
    void chrome.permissions.contains({ origins: ['*://*/*'] }).then(setAllSites, () => {});
  }, []);
  const allowAllSites = (): void => {
    void chrome.permissions.request({ origins: ['*://*/*'] }).then(
      (granted) => {
        setAllSites(granted);
        if (granted) dispatch({ kind: 'accessGiven' });
      },
      () => {},
    );
  };

  // Where the pointer is: over this panel, or not (on the page).
  useEffect(() => {
    const root = document.documentElement;
    const enter = (): void => dispatch({ kind: 'pointerMoved', inPanel: true });
    const leave = (): void => dispatch({ kind: 'pointerMoved', inPanel: false });
    root.addEventListener('mouseenter', enter);
    root.addEventListener('mouseleave', leave);
    return () => {
      root.removeEventListener('mouseenter', enter);
      root.removeEventListener('mouseleave', leave);
    };
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
    frameId.current = null;
    const tab = await findTargetTab();
    const problem = tab === null ? 'There is no tab to inspect.' : await startPicking(tab);
    if (problem !== null) {
      dispatch({ kind: 'cannotInspect', why: problem });
      return;
    }
    tabId.current = tab?.id ?? null;
  };

  // Starts recording the picked element. Resolves once the page says so.
  const startRecording = async (): Promise<void> => {
    const started = waitFor('recording', 2000);
    tellPage({ type: 'again' });
    if (!(await started)) throw new Error('the page did not start recording');
  };

  const record = (): void => {
    if (tabId.current === null) return;
    void startRecording().catch(() => {});
  };

  // Where the picked element is in the window, scrolled into view.
  const whereIs = async (id: number): Promise<PageRect> => {
    const where: unknown = await chrome.tabs.sendMessage(id, { type: 'where' } satisfies ToPage, {
      frameId: frameId.current ?? 0,
    });
    if (where === null || typeof where !== 'object') {
      throw new Error('the element is no longer on the page');
    }
    if ('covered' in where && where.covered === true) {
      throw new Error('something on the page covers it');
    }
    const rect = where as PageRect;
    // In a frame, the pointer goes where the frame shows it in the tab.
    if (rect.frame === null) {
      throw new Error('it is inside a frame from another site, which does not say where it is');
    }
    const offset = rect.frame ?? { x: 0, y: 0 };
    return { ...rect, x: rect.x + offset.x, y: rect.y + offset.y };
  };

  // Moves a pointer over the picked element with Chrome's debugger, so its
  // hover and its way back are recorded without doing them by hand.
  // Recording starts first, with the pointer off the element.
  const playTheHover = async (): Promise<void> => {
    const id = tabId.current;
    if (id === null || playing !== null) return;
    setPlaying('hover');
    try {
      const rect = await whereIs(id);
      await startRecording();
      // The hover's own motion is over when its take arrives.
      await playHover(id, rect, async () => {
        await waitFor('take', 2000);
      });
    } catch (error) {
      dispatch({ kind: 'playFailed', what: 'hover', why: messageOf(error) });
    } finally {
      setPlaying(null);
    }
  };

  // Reloads the page with the recorder put in before the page's own scripts,
  // so what plays as the page loads (an entrance) is recorded from its first
  // frame. Then the scripts go back on the new page, with the same element
  // chosen again, ready to record.
  const playTheLoad = async (): Promise<void> => {
    const id = tabId.current;
    if (id === null || playing !== null) return;
    setPlaying('load');
    try {
      if ((frameId.current ?? 0) !== 0) {
        throw new Error('it is inside a frame; only the page itself can be reloaded this way');
      }
      const where = (await chrome.tabs.sendMessage(id, { type: 'whereabouts' } satisfies ToPage, {
        frameId: 0,
      })) as Whereabouts | null;
      if (where === null) throw new Error('the element is no longer on the page');
      const script = await (await fetch(chrome.runtime.getURL('capture.iife.js'))).text();
      reloading.current = true;
      const result = await playLoad(
        id,
        `${script}\n;MotionCapture.recordOnLoad(${JSON.stringify(where)});`,
      );
      for (const take of result.takes) accept(take as Parameters<typeof accept>[0]);
      if (!result.found) throw new Error(result.problem ?? 'the element was not found again');
      if (result.takes.length === 0) {
        dispatch({
          kind: 'playFailed',
          what: 'load',
          why: 'nothing on it moved as the page loaded',
        });
      }
      // The page is new: its scripts are put back, choosing the same element.
      await chrome.scripting.executeScript({
        target: { tabId: id },
        func: (chosen: Whereabouts) => {
          (window as { motionInspectorChoose?: Whereabouts }).motionInspectorChoose = chosen;
        },
        args: [where],
      });
      await chrome.scripting.executeScript({
        target: { tabId: id },
        files: ['capture.iife.js', 'bridge.js'],
      });
    } catch (error) {
      dispatch({ kind: 'playFailed', what: 'load', why: messageOf(error) });
    } finally {
      reloading.current = false;
      setPlaying(null);
    }
  };

  // Clicks the picked element with Chrome's debugger. The pointer arrives
  // and its hover settles before recording starts; recording stops once the
  // click's take is in, before the pointer leaves. One take: the click.
  const playTheClick = async (): Promise<void> => {
    const id = tabId.current;
    if (id === null || playing !== null) return;
    setPlaying('click');
    try {
      const rect = await whereIs(id);
      await playClick(id, rect, {
        ready: startRecording,
        clicked: async () => {
          await waitFor('take', 4000);
          // A take that adds a way back may follow at once.
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          tellPage({ type: 'stop' });
        },
      });
    } catch (error) {
      tellPage({ type: 'stop' });
      dispatch({ kind: 'playFailed', what: 'click', why: messageOf(error) });
    } finally {
      setPlaying(null);
    }
  };

  const tellPage = (message: ToPage): void => {
    if (tabId.current === null) {
      dispatch({ kind: 'stopped', auto: false });
      return;
    }
    // If the page does not answer (it was closed), stop on this side anyway.
    void toPage(tabId.current, message, frameId.current).then(() => {
      if (message.type === 'stop')
        window.setTimeout(() => dispatch({ kind: 'stopped', auto: false }), 300);
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
  // Nothing captured yet, and picking or listening: the panel's middle
  // says what to do, rather than a line under the toolbar.
  const waiting =
    panel.takes.length === 0 && (status.kind === 'picking' || status.kind === 'listening');
  const shown = selectedTake(panel);

  return (
    <div className="xp">
      <header className="xp__bar" ref={barRef}>
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
              disabled={playing !== null}
              onClick={() => tellPage({ type: 'stop' })}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className={status.kind === 'ready' ? 'btn' : 'btn btn--primary'}
              disabled={playing !== null}
              onClick={() => void pick()}
            >
              {status.kind === 'ready' ? 'Pick another' : 'Pick element'}
            </button>
          )}
        </div>
        <details className="xp__menu" ref={menuRef}>
          <summary aria-label="More" title="More">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
              <circle cx="8" cy="8" r="1.3" fill="currentColor" />
              <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
            </svg>
          </summary>
          <div className="xp__menu-items">
            <button
              type="button"
              disabled={panel.takes.length === 0}
              onClick={(event) => {
                dispatch({ kind: 'takesCleared' });
                event.currentTarget.closest('details')?.removeAttribute('open');
              }}
            >
              Clear all takes
            </button>
            {IS_DEVELOPMENT ? (
              <button
                type="button"
                onClick={(event) => {
                  copyDebugReport();
                  event.currentTarget.closest('details')?.removeAttribute('open');
                }}
              >
                Copy debug report
              </button>
            ) : null}
          </div>
        </details>
        {waiting ? null : (
          <p className="xp__status" role="status">
            {copied !== ''
              ? copied
              : playing !== null
                ? `Playing the ${playing}…`
                : statusText(panel)}
          </p>
        )}
      </header>

      {waiting ? (
        <section className="xp__empty xp__empty--waiting">
          <span
            className={status.kind === 'listening' ? 'xp__signal is-listening' : 'xp__signal'}
            aria-hidden="true"
          />
          <h2>{status.kind === 'listening' ? 'Listening' : 'Pick an element'}</h2>
          <p className="xp__status" role="status">
            {copied !== ''
              ? copied
              : playing !== null
                ? `Playing the ${playing}…`
                : statusText(panel)}
          </p>
        </section>
      ) : null}

      {status.kind === 'ready' && panel.picked !== null ? (
        <section className="xp__ready" aria-label="Record">
          <p className="xp__ready-name">
            <code>{panel.picked}</code>
          </p>
          <p className="xp__ready-text">
            {status.nothingFound ? nothingFoundText(panel.pickedDraws) : 'Recording starts when you choose how to set it off.'}
          </p>
          <div className="xp__ready-actions">
            <button type="button" className="btn btn--primary" onClick={record}>
              Record
            </button>
            <span className="xp__ready-or">or play it:</span>
            <div className="xp__plays" role="group" aria-label="Play it">
              <button
                type="button"
                className="btn"
                aria-label="Play the hover"
                title="Move the pointer in, hold, and out"
                onClick={() => void playTheHover()}
              >
                Hover
              </button>
              <button
                type="button"
                className="btn"
                aria-label="Play the click"
                title="Click it once"
                onClick={() => void playTheClick()}
              >
                Click
              </button>
              <button
                type="button"
                className="btn"
                aria-label="Play the load"
                title="Reload the page and record it from the start"
                onClick={() => void playTheLoad()}
              >
                Load
              </button>
            </div>
          </div>
        </section>
      ) : null}

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
          {allSites ? null : (
            <p>
              <button type="button" className="btn btn--primary" onClick={allowAllSites}>
                Allow on all sites
              </button>{' '}
              <span className="xp__hint">Then no page needs the toolbar icon again.</span>
            </p>
          )}
        </section>
      ) : null}

      {panel.takes.length === 0 && status.kind === 'idle' ? (
        <section className="xp__empty">
          <h2>Capture a motion</h2>
          <p>Pick an element on the page, then hover or click it.</p>
        </section>
      ) : null}

      {panel.takes.length > 0 ? (
        <section className="xp__takes" aria-label="Takes">
          <div className="xp__groups">
            {groupsOf(panel.takes).map((group) => (
              <div key={group.key} className="xp__group">
                <p className="xp__group-name">
                  <code>{group.selector}</code>
                  <span>{group.host}</span>
                </p>
                <ul className="xp__take-list">
                  {group.takes.map((take) => (
                    <li key={take.id}>
                      <button
                        type="button"
                        className="xp__take"
                        aria-pressed={take.id === panel.selectedId}
                        onClick={() => dispatch({ kind: 'takeSelected', id: take.id })}
                      >
                        <span className="xp__take-head">
                          <span className="xp__trigger">
                            {triggerWords(take)}
                            {gapWords(take) === null ? null : (
                              <span
                                className="xp__gap"
                                title={gapWords(take) ?? ''}
                                aria-label={gapWords(take) ?? ''}
                              >
                                !
                              </span>
                            )}
                          </span>
                          <span className="xp__take-meta" title={takeTime(take)}>
                            {lengthWords(take)}
                          </span>
                        </span>
                        {/* What it does, so two takes of one element can be told apart. */}
                        <span className="xp__take-summary">{summaryOf(take)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* A new take replaces the editor, so it plays once as it arrives. */}
      {shown !== null ? <Editor key={shown.id} capture={shown.capture} /> : null}
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
