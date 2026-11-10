// "Play the hover": the extension moves a pointer over the picked element
// itself, so a hover can be recorded without doing it by hand.
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

// Moves the pointer along the path. Resolves when done; rejects with what
// went wrong (no access to the tab, another debugger attached).
export async function playHover(tabId: number, rect: Rect): Promise<void> {
  const target = { tabId };
  await chrome.debugger.attach(target, PROTOCOL);
  try {
    const layout = (await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics')) as {
      cssVisualViewport?: { clientWidth: number; clientHeight: number };
    };
    const viewport = {
      width: layout.cssVisualViewport?.clientWidth ?? 1280,
      height: layout.cssVisualViewport?.clientHeight ?? 800,
    };
    for (const point of hoverPath(rect, viewport)) {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
        pointerType: 'mouse',
      });
      if (point.ms > 0) await wait(point.ms);
    }
  } finally {
    // Detaching removes the bar. It may already be gone (tab closed).
    await chrome.debugger.detach(target).catch(() => {});
  }
}
