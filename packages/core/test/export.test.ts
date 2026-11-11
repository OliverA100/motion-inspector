import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { captureFromAiText, copyForAiText } from '../src/copyForAi';
import { captureToCss } from '../src/exportCss';
import { capture } from './arbitraries';
import { bounce, buttonHover, cardLift, dots, morph } from '../src/samples';

describe('captureToCss', () => {
  test('transitions: one declaration, with the values in a comment', () => {
    expect(captureToCss(buttonHover)).toBe(
      [
        'button.fx-button {',
        '  transition:',
        '    box-shadow 180ms ease-out,',
        '    transform 180ms ease-out;',
        '}',
        '/* The transition runs when these values change:',
        '     box-shadow: rgba(0, 0, 0, 0.2) 0px 1px 2px 0px -> rgba(0, 0, 0, 0.25) 0px 6px 16px 0px',
        '     transform: none -> translateY(-2px)',
        '*/',
      ].join('\n'),
    );
  });

  test('an animation that follows the scroll: auto, then its timeline and range', () => {
    const scrolled = {
      ...bounce,
      tracks: bounce.tracks.map((track) => ({
        ...track,
        scroll: { timeline: '--hero', range: 'entry 25% cover 50%' },
      })),
    };
    const css = captureToCss(scrolled);
    expect(css).toMatch(/animation: motion-1 auto linear 0ms/);
    // After the shorthand, which would reset them.
    expect(css.indexOf('animation-timeline: --hero;')).toBeGreaterThan(css.indexOf('animation:'));
    expect(css).toContain('animation-range: entry 25% cover 50%;');
    expect(css).toContain('--hero is a timeline named by a scroller on the page');
  });

  test('four equal corner tracks are written as border-radius', () => {
    expect(captureToCss(morph)).toContain('    border-radius 500ms ease-in-out;');
    expect(captureToCss(morph)).not.toContain('border-top-left-radius');
  });

  test('keyframe animations: easing per keyframe, none on the last', () => {
    const css = captureToCss(bounce);
    expect(css).toContain(
      [
        '  40% {',
        '    transform: translateY(0px);',
        '    animation-timing-function: ease-out;',
        '  }',
      ].join('\n'),
    );
    expect(css).toContain(['  100% {', '    transform: translateY(0px);', '  }'].join('\n'));
    expect(css).toContain('  animation: motion-1 900ms linear 0ms 1 normal none;');
  });

  test('shapes with the same keyframes share one rule, and keep their own delay', () => {
    const css = captureToCss(dots);
    expect(css.match(/@keyframes/g)).toHaveLength(1);
    expect(css).toContain('/* span, number 2 of 3 */');
    expect(css).toContain('  animation: motion-1 1200ms linear -160ms infinite normal none;');
  });

  test('never throws for any valid capture', () => {
    fc.assert(
      fc.property(capture, (value) => {
        expect(typeof captureToCss(value)).toBe('string');
      }),
    );
  });
});

describe('Copy for AI', () => {
  test('always contains Capture JSON that parses back to the same Capture', () => {
    fc.assert(
      fc.property(capture, (value) => {
        expect(captureFromAiText(copyForAiText(value))).toEqual({ ok: true, value });
      }),
    );
  });

  test('has the description, the table, the CSS and the JSON', () => {
    const text = copyForAiText(cardLift);
    expect(text).toContain('The element moves up 6 px and scales to 1.03 over 400 ms.');
    expect(text).toContain(
      '| div.fx-card | transform | none | translateY(-6px) scale(1.03) | 0 ms | 400 ms | cubic-bezier(0.34, 1.56, 0.64, 1) |',
    );
    expect(text).toContain('```css\ndiv.fx-card {');
    expect(text).toContain('```json\n{');
  });

  test('says so when the text has no capture in it', () => {
    expect(captureFromAiText('hello')).toEqual({
      ok: false,
      errors: ['No Capture JSON block was found.'],
    });
  });
});

describe('what Copy CSS says about how the page made the motion', () => {
  test('motion a script made is said to be measured', () => {
    const measured = {
      ...cardLift,
      tracks: cardLift.tracks.map((track) => ({ ...track, origin: 'script' as const })),
    };
    expect(captureToCss(measured)).toContain('a script on the page moves this, frame by frame');
  });

  test('a view transition is said to be one', () => {
    const noted = {
      ...cardLift,
      notShown: ['This is a view transition: the browser animates pictures of the part.'],
    };
    expect(captureToCss(noted)).toContain('The page plays this as a view transition');
    expect(captureToCss(cardLift)).not.toContain('view transition');
  });
});
