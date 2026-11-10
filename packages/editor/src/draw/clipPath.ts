// A computed CSS clip-path as a canvas path, in the coordinates of the box
// it clips. Only basic shapes are read: polygon(), inset(), circle(),
// ellipse() and path(). Lengths may be calc() of px and % (Vercel's peeled
// corners: "calc(100% - 112px)"). Anything else (url()) gives null, and
// then nothing is clipped.
//
// The input is a computed value, which Chrome writes in one fixed form
// ("polygon(50% 50%, 0% 0%, 100% 0%)", "inset(0px 50% 0px 0px)"), so this
// reads that form only. It is not a CSS parser.

type Box = { x: number; y: number; width: number; height: number };

// A length or percentage, as a number of px against `size`. null for
// anything else.
function lengthOf(text: string, size: number): number | null {
  const value = text.trim();
  // calc() of px and %, as Chrome computes it: "calc(100% - 40px)",
  // "calc(-40px + 100%)". Terms are added up.
  const sum = inside(value, 'calc');
  if (sum !== null) {
    const tokens = sum.match(/[+-](?=\s)|-?[\d.]+(?:e[+-]?\d+)?(?:%|px)?/g) ?? [];
    let total = 0;
    let sign = 1;
    for (const token of tokens) {
      if (token === '+' || token === '-') {
        sign = token === '-' ? -1 : 1;
        continue;
      }
      const term = lengthOf(token, size);
      if (term === null) return null;
      total += sign * term;
      sign = 1;
    }
    return tokens.length === 0 ? null : total;
  }
  if (/^-?[\d.]+(e[+-]?\d+)?%$/.test(value)) return (parseFloat(value) / 100) * size;
  if (/^-?[\d.]+(e[+-]?\d+)?(px)?$/.test(value)) return parseFloat(value);
  return null;
}

// Splits on a separator outside parentheses: "calc(100% - 4px) 0px" is
// two lengths, not four words.
function topLevel(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of text) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth === 0 && separator.test(character)) {
      if (current.trim() !== '') parts.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

function inside(value: string, name: string): string | null {
  const start = `${name}(`;
  if (!value.startsWith(start) || !value.endsWith(')')) return null;
  return value.slice(start.length, -1).trim();
}

// "at 50% 50%" or nothing, as a point. Keywords are read too.
function centerOf(text: string | undefined, box: Box): { x: number; y: number } | null {
  if (text === undefined) return { x: box.width / 2, y: box.height / 2 };
  const keyword = (word: string, size: number): string =>
    word === 'left' || word === 'top'
      ? '0%'
      : word === 'right' || word === 'bottom'
        ? '100%'
        : word === 'center'
          ? '50%'
          : word;
  const [first = 'center', second = 'center'] = text.trim().split(/\s+/);
  const x = lengthOf(keyword(first, box.width), box.width);
  const y = lengthOf(keyword(second, box.height), box.height);
  return x === null || y === null ? null : { x, y };
}

function radiusOf(text: string, size: number, center: number, box: number): number | null {
  if (text === 'closest-side') return Math.min(center, box - center);
  if (text === 'farthest-side') return Math.max(center, box - center);
  return lengthOf(text, size);
}

// The corners of a polygon() or inset() clip, in the box's coordinates:
// what can be seen of the shape, for fitting the preview around it. null
// for other shapes.
export function clipCorners(value: string, box: Box): { x: number; y: number }[] | null {
  const text = value.trim();
  const polygon = inside(text, 'polygon');
  if (polygon !== null) {
    const points = topLevel(polygon.replace(/^(nonzero|evenodd)\s*,/, ''), /,/).map((pair) => {
      const [x = '', y = ''] = topLevel(pair, /\s/);
      const px = lengthOf(x, box.width);
      const py = lengthOf(y, box.height);
      return px === null || py === null ? null : { x: box.x + px, y: box.y + py };
    });
    return points.length < 3 || points.some((point) => point === null)
      ? null
      : (points as { x: number; y: number }[]);
  }
  const inset = inside(text, 'inset');
  if (inset !== null) {
    const sides = topLevel(inset.split(' round ')[0] ?? '', /\s/);
    const [top = '0', right = top, bottom = top, left = right] = sides;
    const t = lengthOf(top, box.height);
    const r = lengthOf(right, box.width);
    const b = lengthOf(bottom, box.height);
    const l = lengthOf(left, box.width);
    if (t === null || r === null || b === null || l === null) return null;
    return [
      { x: box.x + l, y: box.y + t },
      { x: box.x + box.width - r, y: box.y + t },
      { x: box.x + l, y: box.y + box.height - b },
      { x: box.x + box.width - r, y: box.y + box.height - b },
    ];
  }
  return null;
}

export function clipPathOf(value: string, box: Box): Path2D | null {
  const text = value.trim();
  const path = new Path2D();

  const polygon = inside(text, 'polygon');
  if (polygon !== null) {
    const points = topLevel(polygon.replace(/^(nonzero|evenodd)\s*,/, ''), /,/).map((pair) => {
      const [x = '', y = ''] = topLevel(pair, /\s/);
      const px = lengthOf(x, box.width);
      const py = lengthOf(y, box.height);
      return px === null || py === null ? null : { x: box.x + px, y: box.y + py };
    });
    if (points.length < 3 || points.some((point) => point === null)) return null;
    points.forEach((point, index) => {
      if (point === null) return;
      if (index === 0) path.moveTo(point.x, point.y);
      else path.lineTo(point.x, point.y);
    });
    path.closePath();
    return path;
  }

  const inset = inside(text, 'inset');
  if (inset !== null) {
    // Rounded corners ("round 8px") are left out: the clip is square.
    const sides = topLevel(inset.split(' round ')[0] ?? '', /\s/);
    const [top = '0', right = top, bottom = top, left = right] = sides;
    const t = lengthOf(top, box.height);
    const r = lengthOf(right, box.width);
    const b = lengthOf(bottom, box.height);
    const l = lengthOf(left, box.width);
    if (t === null || r === null || b === null || l === null) return null;
    path.rect(
      box.x + l,
      box.y + t,
      Math.max(box.width - l - r, 0),
      Math.max(box.height - t - b, 0),
    );
    return path;
  }

  const circle = inside(text, 'circle');
  if (circle !== null) {
    const [size = 'closest-side', at] = circle.split(/\s*at\s+/);
    const center = centerOf(at, box);
    if (center === null) return null;
    // A circle's percentage radius is measured against the box's diagonal
    // divided by the square root of 2.
    const reference = Math.hypot(box.width, box.height) / Math.SQRT2;
    const radius =
      size.trim() === 'closest-side'
        ? Math.min(center.x, center.y, box.width - center.x, box.height - center.y)
        : size.trim() === 'farthest-side'
          ? Math.max(center.x, center.y, box.width - center.x, box.height - center.y)
          : lengthOf(size, reference);
    if (radius === null) return null;
    path.arc(box.x + center.x, box.y + center.y, Math.max(radius, 0), 0, Math.PI * 2);
    return path;
  }

  const ellipse = inside(text, 'ellipse');
  if (ellipse !== null) {
    const [sizes = '', at] = ellipse.split(/\s*at\s+/);
    const center = centerOf(at, box);
    if (center === null) return null;
    const [rx = 'closest-side', ry = 'closest-side'] = sizes.trim().split(/\s+/);
    const radiusX = radiusOf(rx, box.width, center.x, box.width);
    const radiusY = radiusOf(ry, box.height, center.y, box.height);
    if (radiusX === null || radiusY === null) return null;
    path.ellipse(
      box.x + center.x,
      box.y + center.y,
      Math.max(radiusX, 0),
      Math.max(radiusY, 0),
      0,
      0,
      Math.PI * 2,
    );
    return path;
  }

  const svgPath = inside(text, 'path');
  if (svgPath !== null) {
    const d = /^"(.*)"$/.exec(svgPath.replace(/^(nonzero|evenodd)\s*,\s*/, ''))?.[1];
    if (d === undefined) return null;
    const moved = new Path2D();
    moved.addPath(new Path2D(d), new DOMMatrix().translate(box.x, box.y));
    return moved;
  }
  return null;
}
