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

function readFunction(component: CSSTransformComponent, box: BoxSize): TransformFunction | null {
  if (!component.is2D) return null;
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
  // matrix() and perspective() have no reading as separate numbers.
  return null;
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
    const functions = Array.from(parsed, (component) => readFunction(component, box));
    const known = functions.flatMap((item) => (item === null ? [] : [item]));
    // One function that cannot be read makes the whole value unreadable.
    return known.length === functions.length ? { kind: 'transform', functions: known } : null;
  } catch {
    return null;
  }
}

// ---------- Everything else ----------

export function readColor(value: string): (ParsedValue & { kind: 'color' }) | null {
  const match = COLOR.exec(value.trim());
  if (match === null) return null;
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

export function readValue(property: string, value: string, box: BoxSize): ParsedValue | null {
  const text = value.trim();
  if (TRANSFORM_LIKE.includes(property)) return readTransform(property, text, box);
  if (NUMBER.test(text)) return { kind: 'number', value: Number(text) };
  if (text.endsWith('px') && NUMBER.test(text.slice(0, -2))) {
    return { kind: 'length', px: Number(text.slice(0, -2)) };
  }
  if (text.endsWith('%') && NUMBER.test(text.slice(0, -1))) {
    return { kind: 'percent', value: Number(text.slice(0, -1)) };
  }
  return readColor(text);
}
