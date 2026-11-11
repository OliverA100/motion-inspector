import { describe, expect, test } from 'vitest';
import { aboutMotion, previewBadge, type ShapeCheck } from '../src/selfCheck';

const close: ShapeCheck = {
  shapeId: 's0' as ShapeCheck['shapeId'],
  label: 'div',
  px: 0.2,
  opacity: 0,
  worstAtMs: 0,
  frames: 10,
};
const far: ShapeCheck = { ...close, px: 12, worstAtMs: 300 };
const none = { missed: null, notDrawn: [], leftOut: 0 };

describe('the preview badge', () => {
  test('green only when nothing is known to differ', () => {
    expect(previewBadge([close], none)).toMatchObject({
      close: true,
      text: 'Matches the page · 0.2 px',
    });
  });

  test('a missed part comes first, whatever the distance says', () => {
    const badge = previewBadge([close], {
      ...none,
      missed: [{ label: 'rect', what: 'moved' }],
    });
    expect(badge).toMatchObject({ close: false, text: '1 part missing' });
    expect(badge?.detail).toContain('1 part changed on the page and is not in this preview: rect.');
  });

  test('then properties the preview does not draw, then distance, then what is left out', () => {
    expect(previewBadge([far], { ...none, notDrawn: ['letter-spacing'] })?.text).toBe(
      'Not drawn: letter-spacing',
    );
    expect(previewBadge([far], { ...none, leftOut: 2 })?.text).toBe('Off by 12 px');
    expect(previewBadge([close], { ...none, leftOut: 2 })).toMatchObject({
      close: false,
      text: '2 things left out',
    });
  });

  test('with nothing filmed, a missed part still shows', () => {
    expect(previewBadge([], { ...none, missed: [{ label: 'rect', what: 'look' }] })?.detail).toBe(
      '1 part changed on the page and is not in this preview: rect (its look).',
    );
    expect(previewBadge([], none)).toBeNull();
  });

  test('notes about the drawing, not about motion, do not count', () => {
    expect(aboutMotion('7 more parts were left out of the drawing, to keep it simple.')).toBe(
      false,
    );
    expect(aboutMotion('The backdrop behind dialog is not shown: it covers the whole page.')).toBe(
      true,
    );
  });
});
