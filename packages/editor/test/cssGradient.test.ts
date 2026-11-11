import { describe, expect, test } from 'vitest';
import { cssLinearGradient, cssRadialColors, stopPlaces } from '../src/draw/cssGradient';

describe('cssLinearGradient', () => {
  test('reads the angle and the stops of a computed gradient', () => {
    // Vercel's peeled corner, mid-peel, as the browser computes it.
    const gradient = cssLinearGradient(
      'linear-gradient(-53.01deg, rgb(255, 255, 255) 209.1px, rgb(235, 235, 235) 247.1px, rgb(255, 255, 255) 262.1px, rgb(235, 235, 235) 265.1px)',
    );
    expect(gradient?.angle).toBe(-53.01);
    expect(gradient?.stops).toEqual([
      { color: 'rgb(255, 255, 255)', px: 209.1, share: null },
      { color: 'rgb(235, 235, 235)', px: 247.1, share: null },
      { color: 'rgb(255, 255, 255)', px: 262.1, share: null },
      { color: 'rgb(235, 235, 235)', px: 265.1, share: null },
    ]);
  });

  test('sides, no direction, percentages and two places on one stop', () => {
    expect(cssLinearGradient('linear-gradient(to right, red, blue)')?.angle).toBe(90);
    const plain = cssLinearGradient('linear-gradient(rgba(0, 0, 0, 0.5) 10%, blue 20% 40%)');
    expect(plain?.angle).toBe(180);
    expect(plain?.stops).toEqual([
      { color: 'rgba(0, 0, 0, 0.5)', px: null, share: 0.1 },
      { color: 'blue', px: null, share: 0.2 },
      { color: 'blue', px: null, share: 0.4 },
    ]);
  });

  test('only the first layer, and only linear gradients', () => {
    expect(
      cssLinearGradient('linear-gradient(red, blue), linear-gradient(green, black)')?.stops[0]
        ?.color,
    ).toBe('red');
    expect(cssLinearGradient('radial-gradient(red, blue)')).toBeNull();
    expect(cssLinearGradient('none')).toBeNull();
  });
});

describe('stopPlaces', () => {
  test('missing places spread evenly, and never go back', () => {
    const gradient = cssLinearGradient('linear-gradient(red, green, blue 50px, black 20px)');
    if (gradient === null) throw new Error('gradient');
    // red at 0, green halfway to blue, black held at blue's place.
    expect(stopPlaces(gradient, 100)).toEqual([0, 25, 50, 50]);
  });
});

describe('cssRadialColors', () => {
  test('the colors of each stop, without the shape or the places', () => {
    expect(
      cssRadialColors(
        'radial-gradient(at 50% -10%, rgb(32, 33, 36) 0%, rgba(10, 10, 10, 0.5) 100%)',
      ),
    ).toEqual(['rgb(32, 33, 36)', 'rgba(10, 10, 10, 0.5)']);
    expect(cssRadialColors('radial-gradient(circle, red, blue 40px)')).toEqual(['red', 'blue']);
  });

  test('null for anything that is not a radial gradient', () => {
    expect(cssRadialColors('linear-gradient(red, blue)')).toBeNull();
    expect(cssRadialColors('none')).toBeNull();
  });
});
