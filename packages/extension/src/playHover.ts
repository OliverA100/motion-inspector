// "Play the hover" and "Play the click": the extension moves a pointer over
// the picked element itself, so a hover or a click can be recorded without
// doing it by hand.
//
// Events made by a script on the page do not set CSS :hover. A real pointer
// does, and so does Chrome's debugger, which can send the page the same
// pointer events a mouse would. So this attaches the debugger to the tab
// (Chrome shows a "started debugging this browser" bar while it is
// attached), moves the pointer in, across and out, and detaches. It only
// moves the pointer: nothing on the page is paused, changed or restyled, and
// the page reacts as it would to a person.

type Rect = { x: number; y: number; width: number; height: number };

const PROTOCOL = '1.3';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type Point = { x: number; y: number; ms: number };

// The path, in three parts: wait outside and come in from the left to the
// middle; a small, slow sweep round the middle, well inside the element
// (parts that follow the pointer get something to follow), back to the
// middle; then leave on the right, and go on to the corner of the window
// farthest from it. Between them the panel waits for the
// hover to settle. Points in the page's CSS pixels; ms is the pause after
// each.
export function hoverPath(
  rect: Rect,
  viewport: { width: number; height: number },
): { comeIn: Point[]; follow: Point[]; leave: Point[] } {
  const clampX = (x: number): number => Math.min(Math.max(x, 1), viewport.width - 2);
  const clampY = (y: number): number => Math.min(Math.max(y, 1), viewport.height - 2);
  const middleY = rect.y + rect.height / 2;
  const at = (fractionX: number, fractionY: number, ms: number) => ({
    x: clampX(rect.x + rect.width * fractionX),
    y: clampY(rect.y + rect.height * fractionY),
    ms,
  });
  const outsideLeft = { x: clampX(rect.x - 24), y: clampY(middleY), ms: 300 };
  const outsideRight = { x: clampX(rect.x + rect.width + 24), y: clampY(middleY), ms: 300 };
  // Off whatever is around the element too. A card whose hover moves the
  // arrow inside it (Tailwind's group-hover, found on oliverhassan.dev) goes
  // back only when the pointer leaves the card: 24 px past the arrow was
  // still on it, and only the hover in was recorded. One jump, so nothing is
  // crossed on the way.
  const middleX = rect.x + rect.width / 2;
  const away = {
    x: middleX < viewport.width / 2 ? viewport.width - 2 : 1,
    y: middleY < viewport.height / 2 ? viewport.height - 2 : 1,
    ms: 0,
  };
  // Into the middle in a few steps, as a hand would.
  const comeIn = [0.1, 0.25, 0.4, 0.5].map((fraction) => at(fraction, 0.5, 30));
  // Round the middle, slowly, a fifth of the way to the edges.
  const sweep = Array.from({ length: 20 }, (_item, step) =>
    at(0.5 + 0.2 * Math.cos(step / 3), 0.5 + 0.2 * Math.sin(step / 2.5), 45),
  );
  const leave = [0.7, 0.9].map((fraction) => at(fraction, 0.5, 30));
  return {
    comeIn: [outsideLeft, ...comeIn],
    follow: [...sweep, at(0.5, 0.5, PAUSE_MS)],
    leave: [...leave, outsideRight, away],
  };
}

// A held moment in the hover, before and after the sweep: the take shows
// the hovered state, not a way out that starts as the way in ends.
const PAUSE_MS = 500;

// The click's path: wait outside, come in to the middle, and rest there so
// the hover it sets off is over before the press; after the click, leave.
export function clickPath(
  rect: Rect,
  viewport: { width: number; height: number },
): {
  comeIn: { x: number; y: number; ms: number }[];
  press: { x: number; y: number };
  leave: { x: number; y: number; ms: number }[];
} {
  const path = hoverPath(rect, viewport);
  const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  return {
    comeIn: [...path.comeIn, { ...middle, ms: HOVER_SETTLES_MS }],
    press: middle,
    leave: path.leave.slice(-1),
  };
}

// Long enough for a hover's transition to end before the press.
const HOVER_SETTLES_MS = 700;

type Debuggee = { tabId: number };

async function viewportOf(target: Debuggee): Promise<{ width: number; height: number }> {
  const layout = (await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics')) as {
    cssVisualViewport?: { clientWidth: number; clientHeight: number };
  };
  return {
    width: layout.cssVisualViewport?.clientWidth ?? 1280,
    height: layout.cssVisualViewport?.clientHeight ?? 800,
  };
}

async function moveAlong(
  target: Debuggee,
  points: { x: number; y: number; ms: number }[],
): Promise<void> {
  for (const point of points) {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      pointerType: 'mouse',
    });
    if (point.ms > 0) await wait(point.ms);
  }
}

// Runs with the debugger attached, and detaches whatever happens.
// Detaching removes Chrome's bar. It may already be gone (tab closed).
async function withDebugger(
  tabId: number,
  run: (target: Debuggee) => Promise<void>,
): Promise<void> {
  const target = { tabId };
  await chrome.debugger.attach(target, PROTOCOL);
  try {
    await run(target);
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

// Moves the pointer along the hover's path: in, then waits for the hover
// to settle (settled: the panel waits for its take) and a moment more,
// sweeps gently, holds, and leaves. Resolves when done; rejects with what
// went wrong (no access to the tab, another debugger attached).
export async function playHover(
  tabId: number,
  rect: Rect,
  settled: () => Promise<void>,
): Promise<void> {
  await withDebugger(tabId, async (target) => {
    const path = hoverPath(rect, await viewportOf(target));
    await moveAlong(target, path.comeIn);
    await settled();
    await wait(PAUSE_MS);
    await moveAlong(target, path.follow);
    await moveAlong(target, path.leave);
  });
}

// Reloads the page with the capture script put in before the page's own
// scripts (source), so what plays as it loads is recorded from its first
// frame. The script keeps its takes on window.motionInspectorLoad, read
// back here once it is done or after LOAD_LIMIT_MS. The script is taken out
// again before the debugger detaches: only this one load has it.
const LOAD_LIMIT_MS = 12000;
export type LoadResult = { found: boolean; takes: unknown[]; problem: string | null };

export async function playLoad(tabId: number, source: string): Promise<LoadResult> {
  let result: LoadResult = { found: false, takes: [], problem: null };
  await withDebugger(tabId, async (target) => {
    await chrome.debugger.sendCommand(target, 'Page.enable');
    const added = (await chrome.debugger.sendCommand(
      target,
      'Page.addScriptToEvaluateOnNewDocument',
      { source },
    )) as { identifier: string };
    try {
      await chrome.debugger.sendCommand(target, 'Page.reload', {});
      const began = Date.now();
      while (Date.now() - began < LOAD_LIMIT_MS) {
        await wait(300);
        // While the page is between documents there is nothing to ask.
        const answer = (await chrome.debugger
          .sendCommand(target, 'Runtime.evaluate', {
            expression: 'JSON.stringify(window.motionInspectorLoad ?? null)',
            returnByValue: true,
          })
          .catch(() => null)) as { result?: { value?: unknown } } | null;
        const value = answer?.result?.value;
        if (typeof value !== 'string' || value === 'null') continue;
        const state = JSON.parse(value) as LoadResult & { done: boolean };
        result = { found: state.found, takes: state.takes, problem: state.problem };
        if (state.done) break;
      }
    } finally {
      await chrome.debugger
        .sendCommand(target, 'Page.removeScriptToEvaluateOnNewDocument', {
          identifier: added.identifier,
        })
        .catch(() => {});
    }
  });
  return result;
}

// Moves the pointer onto the element, waits for its hover to be over, then
// asks for recording to start (ready), clicks, waits for what the click set
// off (clicked), and leaves: only the click is recorded.
export async function playClick(
  tabId: number,
  rect: Rect,
  steps: { ready: () => Promise<void>; clicked: () => Promise<void> },
): Promise<void> {
  await withDebugger(tabId, async (target) => {
    const path = clickPath(rect, await viewportOf(target));
    await moveAlong(target, path.comeIn);
    await steps.ready();
    const at = { ...path.press, button: 'left', clickCount: 1, pointerType: 'mouse' };
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...at,
    });
    await wait(60);
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...at,
    });
    await steps.clicked();
    await moveAlong(target, path.leave);
  });
}
