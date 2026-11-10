// Reads a CSS value as numbers, in the page, at capture time.
//
// The description ("moves up 4 px") and the Figma export need numbers, and
// the page is the one place where they can be read reliably: units are
// already resolved, and percentages can be measured against the element.
// Anything that has no simple reading returns null. The CSS string is
// always kept beside it, so nothing is lost.

import type { ParsedValue, TransformFunction } from '@motion-inspector/core';

export type BoxSize = { width: number; height: number };

const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/;
const COLOR = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/;

const TRANSFORM_LIKE = ['transform', 'translate', 'rotate', 'scale'];

// ---------- Transforms ----------

// The separate translate, rotate and scale properties, written as the
// transform function that does the same thing. null for the 3D forms.
function asTransformText(property: string, value: string): string | null {
  if (property === 'transform' || value === 'none') return value;
  const parts = value.trim().split(/\s+/);
  if (property === 'rotate') return parts.length === 1 ? `rotate(${parts[0]})` : null;
  if (parts.length > 2) return null;
  return `${property}(${parts.join(', ')})`;
}

// A length in px. A percentage is measured against the element's own box,
// as CSS does for translate.
function px(value: CSSNumericValue, size: number): number | null {
  if (!(value instanceof CSSUnitValue)) return null;
  if (value.unit === 'px') return value.value;
  if (value.unit === 'percent') return (value.value / 100) * size;
  try {
    return value.to('px').value;
  } catch {
    return null;
  }
}

function plainNumber(value: CSSNumberish): number | null {
  if (typeof value === 'number') return value;
  return value instanceof CSSUnitValue && value.unit === 'number' ? value.value : null;
}

function degrees(value: CSSNumericValue): number | null {
  try {
    return value.to('deg').value;
  } catch {
    return null;
  }
}

// 3D forms that do nothing in 3D: translate3d(x, y, 0), translateZ(0),
// scale3d(x, y, 1), rotate3d(0, 0, 1, a). Animation libraries write these
// to get the browser to use the GPU. They are read as the 2D form.
function isFlat(component: CSSTransformComponent): boolean {
  if (component.is2D) return true;
  if (component instanceof CSSTranslate) return px(component.z, 0) === 0;
  // Scaling depth does nothing to a flat element: scale3d(0.1, 0.1, 0.1)
  // looks the same as scale(0.1).
  if (component instanceof CSSScale) return true;
  if (component instanceof CSSRotate) {
    return (
      plainNumber(component.x) === 0 &&
      plainNumber(component.y) === 0 &&
      (plainNumber(component.z) ?? 0) > 0
    );
  }
  return false;
}

function readFunction(component: CSSTransformComponent, box: BoxSize): TransformFunction | null {
  if (!isFlat(component)) return null;
  if (component instanceof CSSTranslate) {
    const x = px(component.x, box.width);
    const y = px(component.y, box.height);
    return x === null || y === null ? null : { fn: 'translate', x, y };
  }
  if (component instanceof CSSScale) {
    const x = plainNumber(component.x);
    const y = plainNumber(component.y);
    return x === null || y === null ? null : { fn: 'scale', x, y };
  }
  if (component instanceof CSSRotate) {
    const deg = degrees(component.angle);
    return deg === null ? null : { fn: 'rotate', deg };
  }
  if (component instanceof CSSSkew) {
    const xDeg = degrees(component.ax);
    const yDeg = degrees(component.ay);
    return xDeg === null || yDeg === null ? null : { fn: 'skew', xDeg, yDeg };
  }
  if (component instanceof CSSSkewX) {
    const xDeg = degrees(component.ax);
    return xDeg === null ? null : { fn: 'skew', xDeg, yDeg: 0 };
  }
  if (component instanceof CSSSkewY) {
    const yDeg = degrees(component.ay);
    return yDeg === null ? null : { fn: 'skew', xDeg: 0, yDeg };
  }
  // matrix() has no reading as separate numbers.
  return null;
}

function doesNothing(item: TransformFunction): boolean {
  switch (item.fn) {
    case 'translate':
      return item.x === 0 && item.y === 0;
    case 'scale':
      return item.x === 1 && item.y === 1;
    case 'rotate':
      return item.deg === 0;
    case 'skew':
      return item.xDeg === 0 && item.yDeg === 0;
  }
}

// The transform as the list of functions the author wrote, never through a
// matrix: rotate(360deg) must stay 360 degrees (DECISIONS.md, D9).
function readTransform(property: string, value: string, box: BoxSize): ParsedValue | null {
  const text = asTransformText(property, value);
  if (text === null) return null;
  try {
    const parsed = CSSStyleValue.parse('transform', text);
    if (!(parsed instanceof CSSTransformValue)) {
      // "none" comes back as a keyword: no functions at all.
      return parsed.toString() === 'none' ? { kind: 'transform', functions: [] } : null;
    }
    // perspective() changes nothing on a flat element: it only acts on
    // depth, and every other function here must already be flat. Pages
    // write "perspective(1px) translateZ(0)" to get their own GPU layer
    // (Hover.css does on every effect). It is left out of the reading.
    const flatParts = Array.from(parsed).filter(
      (component) => !(component instanceof CSSPerspective),
    );
    const functions = flatParts.map((component) => readFunction(component, box));
    const known = functions.flatMap((item) => (item === null ? [] : [item]));
    // One function that cannot be read makes the whole value unreadable.
    if (known.length !== functions.length) return null;
    // Functions that do nothing are left out: Tailwind writes a resting
    // transform as "translate(0px) rotate(0deg) skew(0deg, 0deg) skewY(0deg)
    // scaleX(1) scaleY(1)", and translateZ(0) is read as translate(0, 0).
    // Without them the reading says what moves, and it matches "none".
    return { kind: 'transform', functions: known.filter((item) => !doesNothing(item)) };
  } catch {
    return null;
  }
}

// ---------- Everything else ----------

// Newer color spaces (oklab, oklch, lab, hsl...) are turned into sRGB by
// painting one pixel with the color and reading it back. Tailwind 4 and
// daisyUI write every color this way.
const OTHER_COLOR = /^(oklab|oklch|lab|lch|hsla?|hwb|color)\(/;
let pixel: CanvasRenderingContext2D | null = null;

function colorThroughCanvas(value: string): (ParsedValue & { kind: 'color' }) | null {
  if (!OTHER_COLOR.test(value)) return null;
  pixel ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (pixel === null) return null;
  // The alpha is read from the text: read back from a pixel it is rounded
  // to 1/255, and very faint colors lose their hue.
  const alphaMatch =
    /\/\s*([\d.]+)(%?)\s*\)$/.exec(value) ??
    /^hsla\([^,]+,[^,]+,[^,]+,\s*([\d.]+)(%?)\)$/.exec(value);
  const alpha = alphaMatch === null ? 1 : Number(alphaMatch[1]) / (alphaMatch[2] === '%' ? 100 : 1);
  // Painted fully opaque, so the color itself comes back exactly.
  const opaque = alphaMatch === null ? value : value.replace(/\s*\/\s*[\d.]+%?\s*\)$/, ')');
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = '#000000';
  pixel.fillStyle = opaque;
  pixel.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = pixel.getImageData(0, 0, 1, 1).data;
  return { kind: 'color', r, g, b, a: Math.min(Math.max(alpha, 0), 1) };
}

export function readColor(value: string): (ParsedValue & { kind: 'color' }) | null {
  const match = COLOR.exec(value.trim());
  if (match === null) return colorThroughCanvas(value.trim());
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] === '%' ? 100 : 1);
  const channel = (text: string | undefined): number => Math.min(Math.max(Number(text), 0), 255);
  return {
    kind: 'color',
    r: channel(match[1]),
    g: channel(match[2]),
    b: channel(match[3]),
    a: Math.min(Math.max(alpha, 0), 1),
  };
}

// Properties whose percentages are measured against the containing
// block's width or height. For these, box is that block's size.
const PERCENT_OF_WIDTH = ['width', 'left', 'right', 'min-width', 'max-width'];
const PERCENT_OF_HEIGHT = ['height', 'top', 'bottom', 'min-height', 'max-height'];

export function readValue(property: string, value: string, box: BoxSize): ParsedValue | null {
  const text = value.trim();
  if (TRANSFORM_LIKE.includes(property)) return readTransform(property, text, box);
  if (NUMBER.test(text)) return { kind: 'number', value: Number(text) };
  if (text.endsWith('px') && NUMBER.test(text.slice(0, -2))) {
    return { kind: 'length', px: Number(text.slice(0, -2)) };
  }
  // calc() of a percentage and px, as Chrome writes it for a knob that
  // sits at the far end: "calc(100% - 16.5px)" (found on Mantine). For
  // size and position, where 100% is known, it is read as px.
  const sum = /^calc\((.*)\)$/.exec(text);
  if (sum !== null) {
    const base = PERCENT_OF_WIDTH.includes(property)
      ? box.width
      : PERCENT_OF_HEIGHT.includes(property)
        ? box.height
        : null;
    const terms = Array.from((sum[1] ?? '').matchAll(/([+-]?)\s*(-?[\d.]+(?:e[+-]?\d+)?)(%|px)/g));
    const rest = (sum[1] ?? '').replace(/([+-]?)\s*(-?[\d.]+(?:e[+-]?\d+)?)(%|px)/g, '').trim();
    if (base === null || terms.length === 0 || rest !== '') return null;
    const px = terms.reduce((total, [, sign, amount, unit]) => {
      const value = Number(amount) * (sign === '-' ? -1 : 1);
      return total + (unit === '%' ? (value / 100) * base : value);
    }, 0);
    return Number.isFinite(px) ? { kind: 'length', px } : null;
  }
  if (text.endsWith('%') && NUMBER.test(text.slice(0, -1))) {
    // What 100% is, in px, so the preview can draw it. The value itself
    // stays a percentage, as written.
    const of = PERCENT_OF_WIDTH.includes(property)
      ? box.width
      : PERCENT_OF_HEIGHT.includes(property)
        ? box.height
        : null;
    return { kind: 'percent', value: Number(text.slice(0, -1)), of };
  }
  return readColor(text);
}
