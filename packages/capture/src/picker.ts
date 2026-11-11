// The element picker: move the pointer to outline an element, click to
// pick it, Escape to cancel. Up and down arrows move to the parent or the
// first child.
//
// The outline and its label are drawn inside a shadow root, so the page's
// own CSS cannot change how they look. While picking, the page's own click
// is blocked, so picking a link does not follow it.

import { labelOf } from './snapshot';

const OUTLINE_COLOR = '#2f6fed';
// Above anything a page is likely to use.
const TOP_LAYER = '2147483647';
// Events the page must not receive while picking.
const BLOCKED = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick'];

export type Picker = {
  // Resolves with the picked element, or null if picking was cancelled.
  picked: Promise<Element | null>;
  cancel: () => void;
};

function createOverlay(): { host: HTMLElement; box: HTMLElement; label: HTMLElement } {
  const host = document.createElement('div');
  host.setAttribute('data-motion-inspector', 'picker');
  host.style.cssText = `position:fixed;inset:0;z-index:${TOP_LAYER};pointer-events:none;`;
  const root = host.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;box-sizing:border-box;border:2px solid ${OUTLINE_COLOR};background:rgba(47,111,237,0.08);border-radius:2px;display:none;`;
  const label = document.createElement('div');
  label.style.cssText = `position:fixed;padding:2px 6px;font:12px/1.4 ui-monospace,Menlo,monospace;color:#fff;background:${OUTLINE_COLOR};border-radius:2px;white-space:nowrap;display:none;`;
  root.append(box, label);
  return { host, box, label };
}

export function startPicking(): Picker {
  const overlay = createOverlay();
  document.documentElement.appendChild(overlay.host);
  let current: Element | null = null;
  let finish: (element: Element | null) => void = () => {};

  const show = (element: Element | null): void => {
    current = element;
    if (element === null) {
      overlay.box.style.display = 'none';
      overlay.label.style.display = 'none';
      return;
    }
    const rect = element.getBoundingClientRect();
    overlay.box.style.display = 'block';
    overlay.box.style.left = `${rect.left}px`;
    overlay.box.style.top = `${rect.top}px`;
    overlay.box.style.width = `${rect.width}px`;
    overlay.box.style.height = `${rect.height}px`;
    // The tag, first class and size: enough to know what is under the pointer.
    overlay.label.textContent = `${labelOf(element)}  ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    overlay.label.style.display = 'block';
    overlay.label.style.left = `${Math.max(0, rect.left)}px`;
    // Above the element, or just inside its top when there is no room.
    overlay.label.style.top = `${rect.top >= 24 ? rect.top - 24 : rect.top + 2}px`;
  };

  const onMove = (event: MouseEvent): void => {
    // composedPath sees into open shadow roots. elementFromPoint does not.
    const target = event.composedPath()[0];
    if (target instanceof Element && target !== overlay.host) show(target);
  };

  const block = (event: Event): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    // A click with no move before it (a tap, or a page that ate the move):
    // the element clicked, not nothing.
    if (event.type === 'click') {
      const target = event.composedPath()[0];
      finish(current ?? (target instanceof Element && target !== overlay.host ? target : null));
    }
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') finish(null);
    else if (event.key === 'Enter') finish(current);
    else if (event.key === 'ArrowUp' && current?.parentElement) show(current.parentElement);
    else if (event.key === 'ArrowDown' && current?.firstElementChild)
      show(current.firstElementChild);
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  // The outline follows the element when the page scrolls or resizes.
  const onLayoutChange = (): void => show(current);

  const picked = new Promise<Element | null>((resolve) => {
    finish = (element) => {
      // Remove the overlay first, so the page gets real hover and click again.
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onLayoutChange, true);
      window.removeEventListener('resize', onLayoutChange, true);
      for (const type of BLOCKED) window.removeEventListener(type, block, true);
      overlay.host.remove();
      resolve(element);
    };
  });

  // The capture phase on window comes before anything on the page.
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onLayoutChange, true);
  window.addEventListener('resize', onLayoutChange, true);
  for (const type of BLOCKED) window.addEventListener(type, block, true);

  return { picked, cancel: () => finish(null) };
}
