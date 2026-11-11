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

// The path: wait outside, come in from the left to the middle, sweep
// across (parts that follow the pointer get something to follow), rest,
// then leave on the right. Points in the page's CSS pixels; ms is the
// pause after each.
export function hoverPath(
  rect: Rect,
  viewport: { width: number; height: number },
): {
  x: number;
  y: number;
  ms: number;
}[] {
  const clampX = (x: number): number => Math.min(Math.max(x, 1), viewport.width - 2);
  const clampY = (y: number): number => Math.min(Math.max(y, 1), viewport.height - 2);
  const middleY = rect.y + rect.height / 2;
  const at = (fractionX: number, fractionY: number, ms: number) => ({
    x: clampX(rect.x + rect.width * fractionX),
    y: clampY(rect.y + rect.height * fractionY),
    ms,
  });
  const outsideLeft = { x: clampX(rect.x - 24), y: clampY(middleY), ms: 300 };
  const outsideRight = { x: clampX(rect.x + rect.width + 24), y: clampY(middleY), ms: 0 };
  // Into the middle in a few steps, as a hand would.
  const comeIn = [0.1, 0.25, 0.4, 0.5].map((fraction) => at(fraction, 0.5, 30));
  // Across: around the middle, then the corners' way, slowly.
  const across = Array.from({ length: 24 }, (_item, step) =>
    at(0.5 + 0.35 * Math.cos(step / 4), 0.5 + 0.35 * Math.sin(step / 3), 40),
  );
  const rest = [at(0.5, 0.5, 700)];
  const leave = [0.7, 0.9].map((fraction) => at(fraction, 0.5, 30));
  return [outsideLeft, ...comeIn, ...across, ...rest, ...leave, outsideRight];
}

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
  const outside = path[0] ?? { x: 1, y: 1, ms: 300 };
  const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const last = path[path.length - 1] ?? outside;
  return {
    comeIn: [outside, ...path.slice(1, 5), { ...middle, ms: HOVER_SETTLES_MS }],
    press: middle,
    leave: [{ ...last, ms: 0 }],
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

// Moves the pointer along the hover's path. Resolves when done; rejects
// with what went wrong (no access to the tab, another debugger attached).
export async function playHover(tabId: number, rect: Rect): Promise<void> {
  await withDebugger(tabId, async (target) => {
    await moveAlong(target, hoverPath(rect, await viewportOf(target)));
  });
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
