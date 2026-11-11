import { describe, expect, test } from 'vitest';
import { cardLift, loader } from '@motion-inspector/core/src/samples';
import {
  initialPanel,
  MOST_TAKES,
  selectedTake,
  showTip,
  updatePanel,
  whyNotInspectable,
  type Panel,
  type PanelMsg,
  type StoredTake,
} from '../src/panelState';

function run(messages: PanelMsg[], start: Panel = initialPanel): Panel {
  return messages.reduce(updatePanel, start);
}

const take = (id: string): StoredTake => ({ id, capture: cardLift });

describe('the states of the side panel', () => {
  test('first open: idle, with no takes', () => {
    expect(initialPanel).toMatchObject({ status: { kind: 'idle' }, takes: [], selectedId: null });
  });

  test('picking, then ready once an element is picked, then listening once recording starts', () => {
    const picking = run([{ kind: 'pickStarted' }]);
    expect(picking.status).toEqual({ kind: 'picking' });
    const ready = updatePanel(picking, { kind: 'elementPicked', label: 'div.card', draws: null });
    // Picking records nothing: what reaching for it set off is not a take.
    expect(ready.status).toEqual({ kind: 'ready', nothingFound: false });
    expect(ready.picked).toBe('div.card');
    expect(updatePanel(ready, { kind: 'recordingStarted' }).status).toEqual({
      kind: 'listening',
      waitedMs: 0,
      found: 0,
      movedTo: null,
    });
  });

  test('a picked canvas is remembered, and forgotten when the page changes', () => {
    const ready = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.chart', draws: 'canvas' },
    ]);
    expect(ready.pickedDraws).toBe('canvas');
    expect(updatePanel(ready, { kind: 'tabChanged' }).pickedDraws).toBeNull();
  });

  test('a picked element the page took away asks to be picked again', () => {
    const gone = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'span.label', draws: null },
      { kind: 'pickedGone' },
    ]);
    expect(gone.status).toEqual({ kind: 'idle' });
    expect(gone.picked).toBeNull();
    expect(gone.notice).toBe('The element you picked is no longer on the page. Pick it again.');
  });

  test('recording that could not start says why', () => {
    const failed = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div', draws: null },
      {
        kind: 'cannotRecord',
        why: 'The picked element has no size or is hidden, so it cannot be drawn.',
      },
    ]);
    expect(failed.notice).toBe(
      'Recording could not start. The picked element has no size or is hidden, so it cannot be drawn. Pick another element.',
    );
  });

  test('Escape during picking goes back to idle', () => {
    expect(run([{ kind: 'pickStarted' }, { kind: 'pickCancelled' }]).status).toEqual({
      kind: 'idle',
    });
  });

  test('listening: after 5 seconds with nothing found, a tip is offered', () => {
    const listening = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
    ]);
    expect(showTip(listening)).toBe(false);
    expect(showTip(updatePanel(listening, { kind: 'waited', ms: 4000 }))).toBe(false);
    const waited = run(
      [
        { kind: 'waited', ms: 4000 },
        { kind: 'waited', ms: 1000 },
      ],
      listening,
    );
    expect(showTip(waited)).toBe(true);
    // Once something has been found, no tip.
    expect(
      showTip(
        run(
          [
            { kind: 'takeArrived', take: take('a'), replaced: false },
            { kind: 'waited', ms: 9000 },
          ],
          waited,
        ),
      ),
    ).toBe(false);
  });

  test('a take that completes the shown one replaces it, and is not counted again', () => {
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
      { kind: 'takeArrived', take: take('hover'), replaced: false },
      { kind: 'pointerMoved', inPanel: true },
      { kind: 'takeArrived', take: { id: 'hover', capture: loader }, replaced: true },
    ]);
    expect(panel.takes.map((item) => item.id)).toEqual(['hover']);
    expect(selectedTake(panel)?.capture).toBe(loader);
    expect(panel.status).toMatchObject({ kind: 'listening', found: 1 });
  });

  test('the first take of a new recording is shown, even with the pointer in the panel', () => {
    // Play the load is pressed in the panel; the pointer stays there. A take
    // left from the element picked before must not stay selected.
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.flex', draws: null },
      { kind: 'recordingStarted' },
      { kind: 'takeArrived', take: take('earlier'), replaced: false },
      { kind: 'pointerMoved', inPanel: true },
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'h1', draws: null },
      // Back in the panel, to press Load.
      { kind: 'pointerMoved', inPanel: true },
      { kind: 'recordingStarted' },
      { kind: 'takeArrived', take: take('letters'), replaced: false },
    ]);
    expect(selectedTake(panel)?.id).toBe('letters');
  });

  test('a take that arrives while the pointer is in the panel is listed, not shown', () => {
    // The hover-out that plays as the user moves to the panel must not
    // replace the hover they just captured.
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
      { kind: 'takeArrived', take: take('hover'), replaced: false },
      { kind: 'pointerMoved', inPanel: true },
      { kind: 'takeArrived', take: take('hover-out'), replaced: false },
    ]);
    expect(panel.takes.map((item) => item.id)).toEqual(['hover-out', 'hover']);
    expect(selectedTake(panel)?.id).toBe('hover');
    // With nothing shown yet, a take is shown wherever the pointer is.
    const empty = run([
      { kind: 'pointerMoved', inPanel: true },
      { kind: 'takeArrived', take: take('x'), replaced: false },
    ]);
    expect(selectedTake(empty)?.id).toBe('x');
  });

  test('picking on the page counts as leaving the panel', () => {
    const panel = run([
      { kind: 'pointerMoved', inPanel: true },
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
    ]);
    expect(panel.pointerInPanel).toBe(false);
  });

  test('captured: each new take is shown while the pointer is on the page, and listening goes on', () => {
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
      { kind: 'takeArrived', take: take('a'), replaced: false },
      { kind: 'takeArrived', take: take('b'), replaced: false },
    ]);
    expect(panel.takes.map((item) => item.id)).toEqual(['b', 'a']);
    expect(selectedTake(panel)?.id).toBe('b');
    expect(panel.status).toEqual({ kind: 'listening', waitedMs: 0, found: 2, movedTo: null });
  });

  test('recording that moves to a parent is remembered, so the panel can say so', () => {
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
      { kind: 'movedToParent', label: 'div.card' },
      { kind: 'takeArrived', take: take('a'), replaced: false },
    ]);
    expect(panel.status).toEqual({ kind: 'listening', waitedMs: 0, found: 1, movedTo: 'div.card' });
  });

  test('stop with nothing found says so', () => {
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
      { kind: 'stopped', auto: false },
    ]);
    expect(panel.status).toEqual({ kind: 'ready', nothingFound: true });
  });

  test('"nothing found" stays when stop is confirmed a second time', () => {
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
      { kind: 'stopped', auto: false },
      { kind: 'stopped', auto: false },
    ]);
    expect(panel.status).toEqual({ kind: 'ready', nothingFound: true });
  });

  test('a page that cannot be inspected stays so when a late stop arrives', () => {
    const panel = run([
      { kind: 'cannotInspect', why: 'A browser page.' },
      { kind: 'stopped', auto: false },
    ]);
    expect(panel.status.kind).toBe('cannot-inspect');
  });

  test('stop after a take goes back to the picked element, ready again', () => {
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
      { kind: 'takeArrived', take: take('a'), replaced: false },
      { kind: 'stopped', auto: false },
    ]);
    expect(panel.status).toEqual({ kind: 'ready', nothingFound: false });
  });

  test('a take flushed just after Stop clears "nothing found"', () => {
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
      { kind: 'stopped', auto: false },
      { kind: 'takeArrived', take: take('late'), replaced: false },
    ]);
    expect(panel.status).toEqual({ kind: 'ready', nothingFound: false });
    expect(selectedTake(panel)?.id).toBe('late');
  });

  test('a page that cannot be inspected', () => {
    const panel = run([{ kind: 'cannotInspect', why: 'This is a browser page.' }]);
    expect(panel.status).toEqual({ kind: 'cannot-inspect', why: 'This is a browser page.' });
  });

  test('clicking the toolbar icon clears "cannot be inspected", so Pick element can be tried again', () => {
    const blocked = run([{ kind: 'cannotInspect', why: 'No access to this tab yet.' }]);
    expect(updatePanel(blocked, { kind: 'accessGiven' }).status).toEqual({ kind: 'idle' });
    // It changes nothing while something else is going on.
    const picking = run([{ kind: 'pickStarted' }]);
    expect(updatePanel(picking, { kind: 'accessGiven' }).status).toEqual({ kind: 'picking' });
  });

  test('a save that fails leaves a message, and the take stays open', () => {
    const panel = run([
      { kind: 'takeArrived', take: take('a'), replaced: false },
      { kind: 'saveFailed', why: 'storage is full' },
    ]);
    expect(panel.notice).toContain('could not be saved (storage is full)');
    expect(selectedTake(panel)?.id).toBe('a');
    expect(updatePanel(panel, { kind: 'noticeDismissed' }).notice).toBeNull();
  });
});

describe('the list of takes', () => {
  test('keeps the last 20, newest first', () => {
    const many = Array.from({ length: 25 }, (_item, index): PanelMsg => ({
      kind: 'takeArrived',
      take: take(`take-${index}`),
      replaced: false,
    }));
    const panel = run(many);
    expect(panel.takes).toHaveLength(MOST_TAKES);
    expect(panel.takes[0]?.id).toBe('take-24');
    expect(panel.takes[19]?.id).toBe('take-5');
  });

  test('saved takes are loaded, and the newest is shown', () => {
    const panel = run([
      { kind: 'takesLoaded', takes: [take('new'), { id: 'old', capture: loader }] },
    ]);
    expect(selectedTake(panel)?.id).toBe('new');
  });

  test('selecting a take that is not there is ignored', () => {
    const panel = run([
      { kind: 'takeArrived', take: take('a'), replaced: false },
      { kind: 'takeSelected', id: 'gone' },
    ]);
    expect(panel.selectedId).toBe('a');
  });

  test('clearing removes them all', () => {
    const panel = run([
      { kind: 'takeArrived', take: take('a'), replaced: false },
      { kind: 'takesCleared' },
    ]);
    expect(panel).toMatchObject({ takes: [], selectedId: null });
  });
});

describe('pages that cannot be inspected', () => {
  test.each([
    ['chrome://extensions', 'browser page'],
    ['chrome-extension://abc/panel.html', 'browser page'],
    ['about:blank', 'browser page'],
    ['https://chromewebstore.google.com/detail/x', 'Chrome Web Store'],
    ['https://example.com/report.pdf', 'PDF file'],
    ['https://example.com/report.PDF?page=2', 'PDF file'],
    ['', 'no page'],
  ])('%s: says why', (url, expected) => {
    expect(whyNotInspectable(url)).toContain(expected);
  });

  test('an ordinary page can be inspected', () => {
    expect(whyNotInspectable('https://example.com/pricing')).toBeNull();
    expect(whyNotInspectable('http://localhost:5173/fixtures.html')).toBeNull();
    expect(whyNotInspectable('file:///Users/me/page.html')).toBeNull();
    expect(whyNotInspectable(undefined)).toContain('no page');
  });
});

describe('switching pages and stopping by itself', () => {
  test('a message about another page is cleared when the tab changes', () => {
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'cannotInspect', why: 'No access.' },
      { kind: 'tabChanged' },
    ]);
    expect(panel.status).toEqual({ kind: 'idle' });
  });

  test('a recording that stopped by itself says so, and can be recorded again', () => {
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
      { kind: 'takeArrived', take: take('a'), replaced: false },
      { kind: 'stopped', auto: true },
    ]);
    expect(panel.status).toEqual({ kind: 'ready', nothingFound: false });
    expect(panel.stoppedByItself).toBe(true);
    expect(panel.picked).toBe('div.card');
  });

  test('after the tab changes, the last element cannot be recorded again', () => {
    const panel = run([
      { kind: 'pickStarted' },
      { kind: 'elementPicked', label: 'div.card', draws: null },
      { kind: 'recordingStarted' },
      { kind: 'tabChanged' },
    ]);
    expect(panel.picked).toBeNull();
    expect(panel.status).toEqual({ kind: 'idle' });
  });
});
