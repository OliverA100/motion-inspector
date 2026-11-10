// The side panel's own state: what it is doing, and the takes it holds.
//
// Like the editor's state, this is one Model, one Msg and one pure update,
// with no chrome.* and no React in it, so every state from the brief can be
// tested without a browser. panel.tsx does the side effects (injecting the
// capture script, storage) and reports what happened as messages.

import type { Capture } from '@motion-inspector/core';

export type StoredTake = {
  id: string;
  capture: Capture;
};

export type Status =
  // Nothing in progress. With no takes yet, this is the first-open screen.
  | { kind: 'idle' }
  // The picker is showing on the page.
  | { kind: 'picking' }
  // An element is picked and the page is being watched.
  // waitedMs: how long since it began, or since the last take arrived.
  // found: how many takes have arrived since listening began.
  // movedTo: set when recording moved to a parent of what was picked,
  // because the parent is what animates. It names that parent.
  | { kind: 'listening'; waitedMs: number; found: number; movedTo: string | null }
  // Stop was pressed and nothing had been found.
  | { kind: 'nothing-found' }
  // The page cannot be inspected at all, or access was not given.
  | { kind: 'cannot-inspect'; why: string };

export type Panel = {
  status: Status;
  // Newest first. At most 20.
  takes: StoredTake[];
  selectedId: string | null;
  // A short message about something that went wrong, such as saving.
  notice: string | null;
  // What the capture script reported as wrong, for the debug report.
  problems: string[];
  // True while the pointer is over the panel. The user is reading or
  // editing here, so a new take must not replace what they are looking at.
  pointerInPanel: boolean;
  // True when the element picked last can be recorded again without
  // picking (same tab, same page).
  canRecordAgain: boolean;
  // True when the last recording stopped by itself, a take being complete.
  stoppedByItself: boolean;
};

export type PanelMsg =
  | { kind: 'takesLoaded'; takes: StoredTake[] }
  | { kind: 'pickStarted' }
  | { kind: 'pickCancelled' }
  | { kind: 'elementPicked' }
  // Time passed while listening.
  | { kind: 'waited'; ms: number }
  // replaced: true when it completes a take that has already arrived (a
  // hover's leave added to the hover). It keeps that take's id.
  | { kind: 'takeArrived'; take: StoredTake; replaced: boolean }
  | { kind: 'movedToParent'; label: string }
  // The capture script sent something core rejected.
  | { kind: 'takeRejected'; problems: string[] }
  | { kind: 'stopped'; auto: boolean }
  // The tab in front changed, or its page did. A message about the old one
  // no longer applies.
  | { kind: 'tabChanged' }
  | { kind: 'cannotInspect'; why: string }
  // The toolbar icon was clicked, which gives access to the tab in front.
  | { kind: 'accessGiven' }
  | { kind: 'takeSelected'; id: string }
  | { kind: 'takesCleared' }
  | { kind: 'saveFailed'; why: string }
  // "Play the hover" could not move the pointer.
  | { kind: 'hoverFailed'; why: string }
  | { kind: 'noticeDismissed' }
  | { kind: 'pointerMoved'; inPanel: boolean };

export const MOST_TAKES = 20;
// After this long with nothing found, the panel offers a tip.
export const TIP_AFTER_MS = 5000;

export const initialPanel: Panel = {
  status: { kind: 'idle' },
  takes: [],
  selectedId: null,
  notice: null,
  problems: [],
  pointerInPanel: false,
  canRecordAgain: false,
  stoppedByItself: false,
};

export function selectedTake(panel: Panel): StoredTake | null {
  return panel.takes.find((take) => take.id === panel.selectedId) ?? null;
}

// True when the panel should suggest hovering or clicking the element.
export function showTip(panel: Panel): boolean {
  return (
    panel.status.kind === 'listening' &&
    panel.status.found === 0 &&
    panel.status.waitedMs >= TIP_AFTER_MS
  );
}

export function updatePanel(panel: Panel, msg: PanelMsg): Panel {
  switch (msg.kind) {
    case 'takesLoaded': {
      const takes = msg.takes.slice(0, MOST_TAKES);
      return { ...panel, takes, selectedId: panel.selectedId ?? takes[0]?.id ?? null };
    }

    case 'pickStarted':
      return { ...panel, status: { kind: 'picking' }, notice: null };

    case 'pickCancelled':
      return panel.status.kind === 'picking' ? { ...panel, status: { kind: 'idle' } } : panel;

    // Picking happens on the page, so the pointer has left the panel, even
    // if the browser did not say so (it may not, when the mouse moves fast).
    case 'elementPicked':
      return {
        ...panel,
        status: { kind: 'listening', waitedMs: 0, found: 0, movedTo: null },
        pointerInPanel: false,
        canRecordAgain: true,
        stoppedByItself: false,
      };

    case 'waited':
      return panel.status.kind === 'listening'
        ? { ...panel, status: { ...panel.status, waitedMs: panel.status.waitedMs + msg.ms } }
        : panel;

    case 'takeArrived': {
      // A take can arrive just after Stop, as the last one is flushed.
      const status: Status =
        panel.status.kind === 'listening'
          ? {
              ...panel.status,
              waitedMs: 0,
              found: msg.replaced ? panel.status.found : panel.status.found + 1,
            }
          : panel.status.kind === 'nothing-found'
            ? { kind: 'idle' }
            : panel.status;
      const takes = [msg.take, ...panel.takes.filter((take) => take.id !== msg.take.id)];
      // A new take is shown at once, unless the pointer is in the panel.
      // Moving the mouse from the page to the panel plays the element's
      // hover-out, and that must not replace the hover just captured. It
      // goes into the list instead (found walking the flow as a user would).
      const keep = panel.pointerInPanel && panel.selectedId !== null;
      return {
        ...panel,
        status,
        takes: takes.slice(0, MOST_TAKES),
        selectedId: keep ? panel.selectedId : msg.take.id,
      };
    }

    case 'movedToParent':
      return panel.status.kind === 'listening'
        ? { ...panel, status: { ...panel.status, movedTo: msg.label } }
        : panel;

    case 'takeRejected':
      return { ...panel, problems: [...panel.problems, ...msg.problems].slice(-50) };

    case 'stopped': {
      // Stop can be confirmed more than once: by the page, and by the panel
      // itself in case the page has gone. Only the first one changes
      // anything, or the second would wipe "nothing found" off the screen.
      if (panel.status.kind === 'picking') return { ...panel, status: { kind: 'idle' } };
      if (panel.status.kind !== 'listening') return panel;
      const status: Status =
        panel.status.found === 0 ? { kind: 'nothing-found' } : { kind: 'idle' };
      return { ...panel, status, stoppedByItself: msg.auto && panel.status.found > 0 };
    }

    case 'tabChanged': {
      // Listening on a page that is gone ends; a message about another
      // page is cleared, so Pick element is ready at once.
      const stale =
        panel.status.kind === 'cannot-inspect' ||
        panel.status.kind === 'nothing-found' ||
        panel.status.kind === 'listening' ||
        panel.status.kind === 'picking';
      return {
        ...panel,
        status: stale ? { kind: 'idle' } : panel.status,
        canRecordAgain: false,
        stoppedByItself: false,
      };
    }

    case 'cannotInspect':
      return { ...panel, status: { kind: 'cannot-inspect', why: msg.why } };

    // A tab that could not be inspected for lack of access now can be.
    case 'accessGiven':
      return panel.status.kind === 'cannot-inspect'
        ? { ...panel, status: { kind: 'idle' } }
        : panel;

    case 'takeSelected':
      return panel.takes.some((take) => take.id === msg.id)
        ? { ...panel, selectedId: msg.id }
        : panel;

    case 'takesCleared':
      return { ...panel, takes: [], selectedId: null };

    case 'hoverFailed':
      return {
        ...panel,
        notice: `The hover could not be played (${msg.why}). Move the pointer over the element yourself.`,
      };
    case 'saveFailed':
      return {
        ...panel,
        notice: `This take could not be saved (${msg.why}). It stays open here, but will be gone when the panel closes.`,
      };

    case 'noticeDismissed':
      return { ...panel, notice: null };

    case 'pointerMoved':
      return panel.pointerInPanel === msg.inPanel
        ? panel
        : { ...panel, pointerInPanel: msg.inPanel };
  }
}

// ---------- Pages that cannot be inspected ----------

// Why a page cannot be inspected, in plain words, or null if it can.
// Chrome refuses scripts on its own pages, the Web Store and PDF files.
export function whyNotInspectable(url: string | undefined): string | null {
  if (url === undefined || url === '') {
    return 'This tab has no page to inspect yet.';
  }
  if (/^(chrome|chrome-extension|edge|about|devtools|view-source|chrome-search):/.test(url)) {
    return 'This is a browser page. Chrome does not let extensions inspect its own pages.';
  }
  if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url)) {
    return 'This is the Chrome Web Store. Chrome does not let extensions inspect it.';
  }
  if (/\.pdf($|[?#])/i.test(url)) {
    return 'This is a PDF file. It has no elements to pick.';
  }
  if (!/^(https?|file):/.test(url)) {
    return 'This kind of page cannot be inspected.';
  }
  return null;
}
