// Undo and redo: a history stack on top of update.
//
// update knows nothing about history. This file wraps it: every message
// goes through update first, and if that changed the edits, the state from
// before is pushed onto a stack. Undo and redo move between those states.
// Like update, it is pure and has no React or DOM in it.

import type { Model, Msg } from './model';
import { editsOf, init, update, withEdits, type Edits } from './update';
import type { Capture } from '@motion-inspector/core';

export type History = {
  model: Model;
  // Earlier states, oldest first, and states that were undone, nearest first.
  past: Edits[];
  future: Edits[];
  // The edit in progress, if any. Dragging a handle sends many messages for
  // one change. While they keep this same key they are one undo step.
  openEdit: string | null;
};

export type HistoryMsg =
  | Msg
  | { kind: 'undone' }
  | { kind: 'redone' }
  // A drag was let go, or a field was left: the next change is a new step.
  | { kind: 'editEnded' };

const MOST_STEPS = 100;

export function initHistory(capture: Capture): History {
  return { model: init(capture), past: [], future: [], openEdit: null };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

// Messages that can be sent many times for one change get a key. Two in a
// row with the same key are one undo step. null means "always its own step".
function editKey(model: Model, msg: Msg): string | null {
  switch (msg.kind) {
    case 'easingChanged':
      return `easing ${model.selectedTrack} ${model.selectedSegment}`;
    case 'delayChanged':
      return `delay ${msg.trackIndex}`;
    case 'durationChanged':
      return `duration ${msg.trackIndex}`;
    default:
      return null;
  }
}

function sameEdits(first: Edits, second: Edits): boolean {
  return first.edited === second.edited && first.hiddenTracks === second.hiddenTracks;
}

export function updateHistory(history: History, msg: HistoryMsg): History {
  if (msg.kind === 'editEnded') return { ...history, openEdit: null };

  if (msg.kind === 'undone') {
    const previous = history.past[history.past.length - 1];
    if (previous === undefined) return history;
    return {
      model: withEdits(history.model, previous),
      past: history.past.slice(0, -1),
      future: [editsOf(history.model), ...history.future],
      openEdit: null,
    };
  }

  if (msg.kind === 'redone') {
    const next = history.future[0];
    if (next === undefined) return history;
    return {
      model: withEdits(history.model, next),
      past: [...history.past, editsOf(history.model)],
      future: history.future.slice(1),
      openEdit: null,
    };
  }

  const model = update(history.model, msg);
  // A new capture starts a new history.
  if (msg.kind === 'captureLoaded') return { model, past: [], future: [], openEdit: null };
  // Playback, selection and view choices are not edits. Nothing to record.
  if (sameEdits(editsOf(model), editsOf(history.model))) return { ...history, model };

  const key = editKey(history.model, msg);
  // More of the change already in progress: the step was recorded when it began.
  if (key !== null && key === history.openEdit) return { ...history, model };
  return {
    model,
    past: [...history.past, editsOf(history.model)].slice(-MOST_STEPS),
    future: [],
    openEdit: key,
  };
}
