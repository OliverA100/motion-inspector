// A linear-gradient() as the browser computes it, read for drawing: what a
// script writes into background-image frame by frame (the shading that
// moves with Vercel's peeled corner). Capture reads resting gradients in
// the page; this reads the ones that change, from their text.

export type CssStop = {
  color: string;
  // Where the stop is along the gradient line: px, or a share of its
  // length. null when the text gives no place (spread out evenly).
  px: number | null;
  share: number | null;
};

export type CssLinearGradient = { angle: number; stops: CssStop[] };

// Splits at commas that are not inside brackets.
function topLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

const SIDES: Record<string, number> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
  'to top right': 45,
  'to right top': 45,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom left': 225,
  'to left bottom': 225,
  'to top left': 315,
  'to left top': 315,
};

const PLACE = /\s+(-?\d*\.?\d+)(px|%)$/;

// The first layer of a background-image, when it is a linear-gradient().
// null for anything else: a radial or conic gradient, "none".
export function cssLinearGradient(text: string): CssLinearGradient | null {
  const layer = topLevel(text)[0] ?? '';
  const match = /^linear-gradient\((.*)\)$/s.exec(layer);
  if (match === null) return null;
  const parts = topLevel(match[1] ?? '');
  let angle = 180;
  const first = parts[0] ?? '';
  const degrees = /^(-?\d*\.?\d+)deg$/.exec(first);
  if (degrees !== null) {
    angle = Number(degrees[1]);
    parts.shift();
  } else if (first in SIDES) {
    angle = SIDES[first] ?? 180;
    parts.shift();
  }
  const stops: CssStop[] = [];
  for (const part of parts) {
    // A color, then up to two places ("red 10px 20px" is two stops).
    let rest = part;
    const places: { px: number | null; share: number | null }[] = [];
    for (
      let found = PLACE.exec(rest);
      found !== null && places.length < 2;
      found = PLACE.exec(rest)
    ) {
      const value = Number(found[1]);
      places.unshift(
        found[2] === 'px' ? { px: value, share: null } : { px: null, share: value / 100 },
      );
      rest = rest.slice(0, found.index);
    }
    const color = rest.trim();
    // A place with no color is a hint for the midpoint: left out.
    if (color === '' || /^-?\d*\.?\d+(px|%)?$/.test(color)) continue;
    if (places.length === 0) stops.push({ color, px: null, share: null });
    for (const place of places) stops.push({ color, ...place });
  }
  return stops.length >= 2 && Number.isFinite(angle) ? { angle, stops } : null;
}

// Where the first layer of a conic-gradient() starts, in degrees: what a
// registered variable turns frame by frame. null when it is not conic.
export function cssConicAngle(text: string): number | null {
  const layer = topLevel(text)[0] ?? '';
  if (!layer.startsWith('conic-gradient(')) return null;
  const from = /^conic-gradient\(from (-?\d*\.?\d+)(deg|turn|rad)/.exec(layer);
  if (from === null) return 0;
  const amount = Number(from[1]);
  return from[2] === 'turn' ? amount * 360 : from[2] === 'rad' ? (amount * 180) / Math.PI : amount;
}

// The colors of a radial gradient's stops, in order, from its first layer: a
// variable or a script changing them (Attio's button, lit on hover). null
// when the first layer is not a radial-gradient().
export function cssRadialColors(text: string): string[] | null {
  const layer = topLevel(text)[0] ?? '';
  const match = /^radial-gradient\((.*)\)$/s.exec(layer);
  if (match === null) return null;
  const parts = topLevel(match[1] ?? '');
  // A first part with no color in it is the shape, size and place.
  const isColor = (part: string): boolean =>
    /^(rgba?|hsla?|oklab|oklch|lab|lch|color|hwb)\(|^#|^[a-z]+(\s|$)/.test(part) &&
    !/^(circle|ellipse|closest|farthest|at)\b/.test(part);
  return parts.filter(isColor).map((part) => part.replace(/(\s+-?\d*\.?\d+(px|%))+$/, ''));
}

// Every stop's place in px along a line `length` long, as CSS places them:
// missing ones spread evenly between their neighbors, and none before the
// one ahead of it.
export function stopPlaces(gradient: CssLinearGradient, length: number): number[] {
  const given = gradient.stops.map((stop) =>
    stop.px !== null ? stop.px : stop.share !== null ? stop.share * length : null,
  );
  if (given[0] === null) given[0] = 0;
  if (given[given.length - 1] === null) given[given.length - 1] = length;
  let highest = -Infinity;
  const places = given.map((place) => {
    if (place === null) return null;
    highest = Math.max(highest, place);
    return highest;
  });
  for (let index = 0; index < places.length; index += 1) {
    if (places[index] !== null) continue;
    const before = index - 1;
    let after = index;
    while (places[after] === null) after += 1;
    const from = places[before] ?? 0;
    const to = places[after] ?? from;
    for (let fill = index; fill < after; fill += 1) {
      places[fill] = from + ((to - from) * (fill - before)) / (after - before);
    }
  }
  return places.map((place) => place ?? 0);
}
