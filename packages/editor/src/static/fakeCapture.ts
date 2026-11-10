// Fake data for the static layout. A small card with a few animated parts,
// in two versions: as captured, and after some edits.

import { parseCapture, type Capture } from '@motion-inspector/core';

const EASE_OUT = { kind: 'cubic-bezier', x1: 0, y1: 0, x2: 0.58, y2: 1 };
const OVERSHOOT = { kind: 'cubic-bezier', x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 };
const SOFTER = { kind: 'cubic-bezier', x1: 0.3, y1: 1.25, x2: 0.55, y2: 1 };
const LINEAR = { kind: 'linear' };

function shape(
  id: string,
  label: string,
  kind: string,
  box: [number, number, number, number],
  fill: string,
  radius: number,
  children: unknown[] = [],
) {
  const [x, y, width, height] = box;
  return {
    id,
    label,
    kind,
    box: { x, y, width, height },
    radius: [radius, radius, radius, radius],
    fill,
    stroke: id === 'card' ? { color: '#dcdcdc', width: 1 } : null,
    opacity: 1,
    transformOrigin: { x: width / 2, y: height / 2 },
    children,
  };
}

const root = shape('card', 'div.card', 'box', [0, 0, 220, 156], '#ffffff', 12, [
  shape('image', 'img.card__image', 'image', [12, 12, 196, 76], '#dfe3ea', 6),
  shape('title', 'h3.card__title', 'text', [12, 102, 124, 10], '#c4c4c4', 3),
  shape('line', 'p.card__text', 'text', [12, 122, 184, 8], '#dcdcdc', 3),
  shape('line2', 'p.card__text', 'text', [12, 136, 96, 8], '#dcdcdc', 3),
]);

function track(
  shapeId: string,
  property: string,
  from: string,
  to: string,
  duration: number,
  delay: number,
  easing: unknown,
) {
  return {
    shapeId,
    property,
    origin: 'css-transition',
    groupId: null,
    startOffset: 0,
    interrupted: false,
    keyframes: [
      { offset: 0, value: from, parsed: null, easing: LINEAR, implicit: false },
      { offset: 1, value: to, parsed: null, easing: LINEAR, implicit: false },
    ],
    timing: {
      delay,
      duration,
      iterations: { kind: 'count', count: 1 },
      direction: 'normal',
      fill: 'backwards',
      easing,
    },
  };
}

function capture(tracks: unknown[]): Capture {
  const parsed = parseCapture({
    source: {
      url: 'https://example.com/pricing',
      selector: 'div.card',
      capturedAt: '2026-11-12T00:00:00.000Z',
    },
    root,
    tracks,
    notShown: ['A shine sweep on ::after cannot be drawn, because it runs on a pseudo-element.'],
  });
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  return parsed.value;
}

export const fakeOriginal = capture([
  track('card', 'transform', 'none', 'translateY(-6px) scale(1.03)', 400, 0, OVERSHOOT),
  track('card', 'box-shadow', 'none', '0 12px 32px rgb(0 0 0 / 0.16)', 400, 0, EASE_OUT),
  track('image', 'opacity', '0.85', '1', 300, 60, EASE_OUT),
  track('title', 'transform', 'translateX(-4px)', 'none', 300, 80, EASE_OUT),
  track('line', 'filter', 'blur(1px)', 'blur(0px)', 300, 120, EASE_OUT),
  track('line2', 'opacity', '0.6', '1', 300, 160, EASE_OUT),
  track('card', 'border-top-color', 'rgb(220, 220, 220)', 'rgb(47, 111, 237)', 400, 0, EASE_OUT),
]);

// The same capture after two edits: a softer, shorter curve on the card,
// and a later start for the image.
export const fakeEdited = capture([
  track('card', 'transform', 'none', 'translateY(-6px) scale(1.03)', 340, 0, SOFTER),
  track('card', 'box-shadow', 'none', '0 12px 32px rgb(0 0 0 / 0.16)', 400, 0, EASE_OUT),
  track('image', 'opacity', '0.85', '1', 300, 100, EASE_OUT),
  track('title', 'transform', 'translateX(-4px)', 'none', 300, 80, EASE_OUT),
  track('line', 'filter', 'blur(1px)', 'blur(0px)', 300, 120, EASE_OUT),
  track('line2', 'opacity', '0.6', '1', 300, 160, EASE_OUT),
  track('card', 'border-top-color', 'rgb(220, 220, 220)', 'rgb(47, 111, 237)', 400, 0, EASE_OUT),
]);
