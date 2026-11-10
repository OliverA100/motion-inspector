// The real capture script, run on the fixtures page with real pointer
// input. No extension is needed: the script is injected as a plain file,
// the same file the extension injects.

import { expect, test, type Page } from '@playwright/test';
import { describeCapture } from '../packages/core/src/describe';
import { captureToCss } from '../packages/core/src/exportCss';
import { parseCapture } from '../packages/core/src/parse';
import { flattenShapes } from '../packages/core/src/shapes';
import type { Capture, Track } from '../packages/core/src/types';
import { captureFixture, openFixtures, rootSelector, type Take } from './capture-helpers';

// ---------- Triggers and small readers ----------

const hover = async (page: Page, selector: string): Promise<void> => {
  await page.hover(selector);
};
const click =
  (fixture: string, trigger: string) =>
  async (page: Page): Promise<void> => {
    await page.click(`[data-fixture="${fixture}"] [data-trigger="${trigger}"]`);
  };
const nothing = async (): Promise<void> => {};

// The capture of a take, checked: it must have passed core's checks in the
// page, and must come back unchanged from JSON.
function captureOf(take: Take | undefined): Capture {
  expect(take?.problems ?? ['no take']).toEqual([]);
  const capture = take?.capture;
  if (capture === null || capture === undefined) throw new Error('No capture');
  expect(parseCapture(JSON.parse(JSON.stringify(capture)))).toEqual({ ok: true, value: capture });
  return capture;
}

function onlyCapture(takes: Take[]): Capture {
  expect(takes).toHaveLength(1);
  return captureOf(takes[0]);
}

function track(capture: Capture, property: string): Track {
  const found = capture.tracks.filter((candidate) => candidate.property === property);
  expect(found).toHaveLength(1);
  return found[0] as Track;
}

const EASE_OUT = { kind: 'cubic-bezier', x1: 0, y1: 0, x2: 0.58, y2: 1 };

// ---------- One test per fixture ----------

test('button hover: two transitions, shapes for the button and its text', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'button-hover', hover, 500));

  expect(capture.source.selector).toBe('button.fx-button');
  expect(capture.root).toMatchObject({ label: 'button.fx-button', kind: 'box' });
  expect(capture.root.box).toEqual({ x: 0, y: 0, width: 96, height: 36 });
  // The label is a bar. No text is copied from the page.
  expect(capture.root.children.map((shape) => shape.kind)).toEqual(['text']);
  expect(JSON.stringify(capture)).not.toContain('Hover me');

  const move = track(capture, 'transform');
  expect(move).toMatchObject({ origin: 'css-transition', groupId: null, startOffset: 0 });
  expect(move.timing).toMatchObject({
    delay: 0,
    duration: 180,
    fill: 'backwards',
    easing: EASE_OUT,
  });
  expect(move.keyframes.map((keyframe) => keyframe.parsed)).toEqual([
    { kind: 'transform', functions: [] },
    { kind: 'transform', functions: [{ fn: 'translate', x: 0, y: -2 }] },
  ]);
  // A shadow has no numeric reading. Its CSS value is still kept.
  expect(track(capture, 'box-shadow').keyframes[1]).toMatchObject({
    value: 'rgba(0, 0, 0, 0.25) 0px 6px 16px 0px',
    parsed: null,
  });
  expect(capture.notShown).toEqual([]);
  expect(describeCapture(capture)).toBe(
    'The element moves up 2 px and changes its shadow over 180 ms. It starts fast and slows down.',
  );
});

test('card lift: the overshoot curve, and a shape for each part of the card', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'card-lift', hover, 800));
  expect(flattenShapes(capture.root).map((shape) => shape.label)).toEqual([
    'div.fx-card',
    'div.fx-card__image',
    'div.fx-card__line',
    'div.fx-card__line',
  ]);
  expect(track(capture, 'transform').timing.easing).toEqual({
    kind: 'cubic-bezier',
    x1: 0.34,
    y1: 1.56,
    x2: 0.64,
    y2: 1,
  });
  expect(describeCapture(capture)).toBe(
    'The element moves up 6 px and scales to 1.03 over 400 ms. It starts fast, overshoots by 10%, then settles.',
  );
});

test('staggered list: delays, and shapes placed without their resting transform', async ({
  page,
}) => {
  const capture = onlyCapture(
    await captureFixture(page, 'stagger-list', click('stagger-list', 'toggle'), 900),
  );
  expect(capture.tracks).toHaveLength(8);
  expect(capture.tracks.map((item) => item.timing.delay)).toEqual([
    0, 0, 60, 60, 120, 120, 180, 180,
  ]);
  // They all started in the same frame. The stagger is only in the delay.
  expect(capture.tracks.map((item) => item.startOffset)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  // The items rest at translateX(-12px). Their shapes are at x 0: the
  // transform belongs to the animation, not to the shape.
  expect(capture.root.children.map((shape) => [shape.box.x, shape.box.y])).toEqual([
    [0, 0],
    [0, 22],
    [0, 44],
    [0, 66],
  ]);
  expect(describeCapture(capture)).toBe(
    'Each of the 4 "li" shapes moves right 12 px and fades from 20% to 100% over 300 ms, one after another, 60 ms apart. Each starts fast and slows down.',
  );
});

test('loader: already running when picked, repeats forever, a full turn is 360 degrees', async ({
  page,
}) => {
  // Nothing is triggered. An animation that is already running is the first take.
  const capture = onlyCapture(await captureFixture(page, 'loader', nothing, 500));
  // It was mid-spin when measured, and is still 32 by 32.
  expect(capture.root.box).toEqual({ x: 0, y: 0, width: 32, height: 32 });

  const spin = track(capture, 'transform');
  expect(spin.origin).toBe('css-animation');
  expect(spin.timing).toMatchObject({ duration: 900, iterations: { kind: 'infinite' } });
  // The CSS has only "to". Chrome added the start, so it is marked.
  expect(spin.keyframes.map((keyframe) => keyframe.implicit)).toEqual([true, false]);
  expect(spin.keyframes[1]?.parsed).toEqual({
    kind: 'transform',
    functions: [{ fn: 'rotate', deg: 360 }],
  });
  // The spinner has one blue side. Each side keeps its own color, so the
  // turning shows in the preview (it was once a full ring in one color).
  const sides = capture.root.stroke?.sides ?? [];
  expect(new Set(sides).size).toBe(2);
  expect(capture.notShown).toEqual([]);
  expect(describeCapture(capture)).toBe(
    'The element rotates 360 degrees over 900 ms. It moves at a steady speed. It repeats forever.',
  );
});

test('bounce: six keyframes, each with its own easing', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'bounce', click('bounce', 'play'), 1300));
  const bounce = track(capture, 'transform');
  expect(bounce.keyframes.map((keyframe) => keyframe.offset)).toEqual([0, 0.4, 0.6, 0.8, 0.9, 1]);
  expect(bounce.keyframes.map((keyframe) => keyframe.easing.kind)).toEqual([
    'cubic-bezier',
    'cubic-bezier',
    'cubic-bezier',
    'cubic-bezier',
    'cubic-bezier',
    'linear',
  ]);
  expect(bounce.timing.easing).toEqual({ kind: 'linear' });
  expect(describeCapture(capture)).toBe(
    'The "div.fx-ball" shape moves down 56 px through 6 keyframes over 900 ms.',
  );
});

test('steps and linear() easings are read into their own kinds', async ({ page }) => {
  const steps = onlyCapture(await captureFixture(page, 'steps', click('steps', 'play'), 1400));
  expect(track(steps, 'transform').keyframes[0]?.easing).toEqual({
    kind: 'steps',
    count: 5,
    position: 'end',
  });

  const spring = onlyCapture(await captureFixture(page, 'linear-easing', hover, 1100));
  const easing = track(spring, 'transform').timing.easing;
  expect(easing.kind).toBe('linear-points');
  if (easing.kind === 'linear-points') {
    expect(easing.points).toHaveLength(8);
    expect(easing.points[4]).toEqual({ input: 0.42, output: 1.16 });
  }
});

test('element.animate(): properties from one call are one group', async ({ page }) => {
  const capture = onlyCapture(
    await captureFixture(page, 'web-animation', click('web-animation', 'both-ends'), 1600),
  );
  const move = track(capture, 'transform');
  const fade = track(capture, 'opacity');
  expect(move.origin).toBe('web-animation');
  expect(move.groupId).not.toBeNull();
  expect(fade.groupId).toBe(move.groupId);
  expect(move.timing).toMatchObject({
    duration: 600,
    direction: 'alternate',
    iterations: { kind: 'count', count: 2 },
    fill: 'none',
  });
  // Easing on both levels, as the author wrote it.
  expect(move.timing.easing.kind).toBe('cubic-bezier');
  expect(move.keyframes[0]?.easing).toEqual({
    kind: 'cubic-bezier',
    x1: 0.42,
    y1: 0,
    x2: 1,
    y2: 1,
  });
});

test('element.animate() with a missing keyframe: filled from the resting value read at pick time', async ({
  page,
}) => {
  const startMissing = onlyCapture(
    await captureFixture(page, 'web-animation', click('web-animation', 'start-missing'), 1000),
  );
  expect(track(startMissing, 'transform').keyframes).toMatchObject([
    { offset: 0, value: 'none', implicit: true },
    { offset: 1, value: 'translateX(48px)', implicit: false },
  ]);

  const endMissing = onlyCapture(
    await captureFixture(page, 'web-animation', click('web-animation', 'end-missing'), 1000),
  );
  // The resting opacity is 0.9. Read while animating, it would have been 0.2.
  expect(track(endMissing, 'opacity').keyframes).toMatchObject([
    { offset: 0, value: '0.2', implicit: false },
    { offset: 1, value: '0.9', implicit: true, parsed: { kind: 'number', value: 0.9 } },
  ]);
});

test('morph: colors and radii are read as numbers, and four corners read as one', async ({
  page,
}) => {
  const capture = onlyCapture(await captureFixture(page, 'morph', hover, 900));
  expect(capture.tracks).toHaveLength(5);
  expect(track(capture, 'background-color').keyframes.map((keyframe) => keyframe.parsed)).toEqual([
    { kind: 'color', r: 212, g: 212, b: 212, a: 1 },
    { kind: 'color', r: 47, g: 111, b: 237, a: 1 },
  ]);
  expect(
    track(capture, 'border-top-left-radius').keyframes.map((keyframe) => keyframe.parsed),
  ).toEqual([
    { kind: 'length', px: 8 },
    { kind: 'percent', value: 50, of: null },
  ]);
  expect(describeCapture(capture)).toContain('rounds its corners from 8 px to 50%');
});

test('staggered dots: negative delays, one group per dot, shapes at their real size', async ({
  page,
}) => {
  const capture = onlyCapture(await captureFixture(page, 'dots', nothing, 500));
  expect(capture.tracks.map((item) => item.timing.delay)).toEqual([-320, -320, -160, -160, 0, 0]);
  expect(new Set(capture.tracks.map((item) => item.groupId)).size).toBe(3);
  expect(capture.tracks.map((item) => item.startOffset)).toEqual([0, 0, 0, 0, 0, 0]);
  // The dots were scaled down when measured. Their shapes are still 10 px.
  expect(capture.root.children.map((shape) => [shape.box.x, shape.box.width])).toEqual([
    [0, 10],
    [18, 10],
    [36, 10],
  ]);
});

test('a keyframe Chrome added is marked, and left out of the CSS export', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'pop', click('pop', 'play'), 900));
  expect(track(capture, 'opacity').keyframes).toMatchObject([
    { offset: 0, value: '0.3', implicit: false },
    { offset: 1, value: '0.9', implicit: true },
  ]);
  // The author wrote only "from". The export does the same.
  const css = captureToCss(capture);
  expect(css).toContain('0% {');
  expect(css).not.toContain('100% {');
});

// ---------- What cannot be drawn ----------

test('an animation on an absolutely positioned pseudo-element is drawn on its own shape', async ({
  page,
}) => {
  const capture = onlyCapture(await captureFixture(page, 'pseudo', hover, 700));
  const line = flattenShapes(capture.root).find((shape) => shape.label === 'span.fx-pseudo::after');
  expect(line?.box.height).toBe(2);
  expect(track(capture, 'transform').shapeId).toBe(line?.id);
  expect(capture.notShown).toEqual([]);
});

test('a pseudo-element in the flow of text is listed, not drawn', async ({ page }) => {
  await openFixtures(page);
  const takes = await page.evaluate(async () => {
    const style = document.createElement('style');
    style.textContent =
      '.in-flow::before { content: ""; display: inline-block; width: 8px; height: 8px; background: red; transition: transform 200ms; } .in-flow:hover::before { transform: rotate(45deg); }';
    document.head.append(style);
    const host = document.createElement('span');
    host.className = 'in-flow';
    host.style.cssText = 'position: fixed; left: 20px; top: 20px; padding: 4px; background: #eee';
    host.textContent = 'Next';
    document.body.append(host);
    window.MotionCapture.record(host);
    return true;
  });
  expect(takes).toBe(true);
  await page.hover('.in-flow');
  await page.waitForTimeout(500);
  const capture = captureOf((await page.evaluate(() => window.MotionCapture.stop()))[0]);
  expect(capture.notShown).toEqual([
    'An animation on ::before of span.in-flow is not shown, because that pseudo-element sits in the flow of text, so its box cannot be measured. Only absolutely positioned ones are drawn.',
  ]);
});

test('an animation inside an open shadow root is captured', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'shadow', hover, 700));
  expect(flattenShapes(capture.root).map((shape) => shape.label)).toEqual([
    'fx-shadow-card',
    'div.card',
  ]);
  const lift = track(capture, 'transform');
  expect(lift.shapeId).toBe(capture.root.children[0]?.id);
  expect(lift.keyframes[1]?.value).toBe('translateY(-4px)');
});

test('a scroll-driven animation is listed, not drawn', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'scroll', nothing, 500));
  expect(capture.tracks).toEqual([]);
  expect(capture.notShown).toEqual([
    'A scroll-driven animation on div.fx-scroll__bar is not shown, because it follows the scroll position, not time.',
  ]);
});

// ---------- Parts that appear and disappear (found on real sites) ----------

test('a panel that was hidden when picked gets a shape when it opens', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'panel', click('panel', 'toggle'), 900));
  const panelShape = flattenShapes(capture.root).find((shape) => shape.label === 'div.fx-panel');
  expect(panelShape).toBeDefined();
  // Its lines are inside it, so they are cut off as it grows.
  expect(panelShape?.children.map((shape) => shape.label)).toEqual([
    'div.fx-panel__line',
    'div.fx-panel__line',
    'div.fx-panel__line',
  ]);
  const height = capture.tracks.find((item) => item.property === 'height');
  expect(height?.shapeId).toBe(panelShape?.id);
  expect(height?.keyframes.map((keyframe) => keyframe.value)).toEqual(['0px', '64px']);
  // Nothing about the panel is left out.
  expect(capture.notShown).toEqual([]);
});

test('a panel that closes keeps its content inside it, drawn once', async ({ page }) => {
  await openFixtures(page);
  await page.click('[data-fixture="panel"] [data-trigger="toggle"]');
  await page.waitForTimeout(500);
  await page.evaluate((target) => window.MotionCapture.record(target), rootSelector('panel'));
  await page.click('[data-fixture="panel"] [data-trigger="toggle"]');
  await page.waitForTimeout(800);
  const capture = captureOf((await page.evaluate(() => window.MotionCapture.stop()))[0]);

  const height = capture.tracks.find((item) => item.property === 'height');
  expect(height?.keyframes.map((keyframe) => keyframe.value)).toEqual(['64px', '0px']);
  const panelShape = flattenShapes(capture.root).find((shape) => shape.id === height?.shapeId);
  expect(panelShape?.label).toBe('div.fx-panel');
  expect(panelShape?.box.height).toBe(64);
  expect(panelShape?.children).toHaveLength(3);
  // The lines appear once in the whole drawing, inside the panel.
  const lines = flattenShapes(capture.root).filter((shape) => shape.label === 'div.fx-panel__line');
  expect(lines).toHaveLength(3);
});

test('modern colors and flat 3D transforms are read as numbers', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'panel', click('panel', 'toggle'), 900));
  const slide = capture.tracks.find((item) => item.property === 'transform');
  // translate3d(-12px, 0, 0) scale3d(0.8, 0.8, 0.8) is a 2D move and scale.
  expect(slide?.keyframes[0]?.parsed).toEqual({
    kind: 'transform',
    functions: [
      { fn: 'translate', x: -12, y: 0 },
      { fn: 'scale', x: 0.8, y: 0.8 },
    ],
  });
  // The panel's oklch background is read as an sRGB color.
  const panelShape = flattenShapes(capture.root).find((shape) => shape.label === 'div.fx-panel');
  expect(panelShape?.fill).toMatch(/^oklch\(/);
  expect(describeCapture(capture)).toContain('moves right 12 px and scales from 0.8 to 1');
});

test('text kept only for screen readers is not drawn', async ({ page }) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const hidden = document.createElement('span');
    hidden.textContent = 'Loading...';
    hidden.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
    document.querySelector('.fx-loader')?.append(hidden);
  });
  const capture = onlyCapture(await captureFixture(page, 'loader', nothing, 500, false));
  expect(flattenShapes(capture.root).map((shape) => shape.kind)).toEqual(['box']);
});

// ---------- Takes ----------

// A hover and its leave are one motion: one take, with the way there and
// the way back (asked for after the first real use).

test('a hover and its leave are one take, with the way there and the way back', async ({
  page,
}) => {
  const takes = await captureFixture(
    page,
    'button-hover',
    async (page, selector) => {
      await page.hover(selector);
      // Stay well past the 180 ms, then leave.
      await page.waitForTimeout(1200);
      await page.mouse.move(0, 0);
    },
    700,
  );

  expect(takes).toHaveLength(1);
  const capture = captureOf(takes[0]);
  const moves = capture.tracks.filter((item) => item.property === 'transform');
  expect(moves.map((item) => [item.keyframes[0]?.value, item.keyframes[1]?.value])).toEqual([
    ['none', 'translateY(-2px)'],
    ['translateY(-2px)', 'none'],
  ]);
  // The pointer stayed about a second. The way back is placed after a short
  // rest instead, so the timeline is not mostly empty.
  const [there, back] = moves;
  expect((back?.startOffset ?? 0) - ((there?.startOffset ?? 0) + 180)).toBeLessThanOrEqual(401);
  // The two directions are one transition: linked.
  expect(back?.groupId).not.toBeNull();
  expect(back?.groupId).toBe(there?.groupId);
  expect(describeCapture(capture)).toBe(
    'The element moves up 2 px and changes its shadow over 180 ms. It starts fast and slows down. Then it goes back.',
  );
  // Exported as one transition, as it was written.
  expect(captureToCss(capture).match(/transform 180ms/g)).toHaveLength(1);
});

test('a leave before the hover finished: one take, and the shortened way back is marked', async ({
  page,
}) => {
  const takes = await captureFixture(
    page,
    'button-hover',
    async (page, selector) => {
      await page.hover(selector);
      // Leave part-way through the 180 ms transition.
      await page.waitForFunction(
        (target) =>
          (document.querySelector(target)?.getAnimations()[0]?.effect?.getComputedTiming()
            .progress ?? 0) > 0.2,
        selector,
        { polling: 'raf' },
      );
      await page.mouse.move(0, 0);
    },
    600,
  );

  expect(takes).toHaveLength(1);
  const capture = captureOf(takes[0]);
  const [there, back] = capture.tracks.filter((item) => item.property === 'transform');
  expect(there).toMatchObject({ interrupted: false });
  expect(there?.timing.duration).toBe(180);
  expect(back?.interrupted).toBe(true);
  expect(back?.timing.duration).toBeGreaterThan(0);
  expect(back?.timing.duration).toBeLessThan(180);
  // It starts from where the first one had got to.
  expect(back?.keyframes[0]?.value).toMatch(/^translateY\(-[\d.]+px\)$/);
  expect(back?.keyframes[1]?.value).toBe('none');
  expect(describeCapture(capture)).toContain('The browser shortened the way back');
});

test('a hover already under way when recording starts still ends as one take with its leave', async ({
  page,
}) => {
  await openFixtures(page);
  // The pointer is on the button while it is picked, as with a real click.
  await page.hover('.fx-button');
  await page.evaluate(
    (target) => window.MotionCapture.record(target),
    rootSelector('button-hover'),
  );
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const takes = await page.evaluate(() => window.MotionCapture.stop());
  // Never a take holding two tracks for one value that are not a way there
  // and its way back.
  for (const take of takes) {
    const moves = captureOf(take).tracks.filter((item) => item.property === 'transform');
    expect(moves.length).toBeLessThanOrEqual(2);
    if (moves.length === 2)
      expect(moves[1]?.keyframes.at(-1)?.value).toBe(moves[0]?.keyframes[0]?.value);
  }
});

test('two separate triggers are two takes', async ({ page }) => {
  const takes = await captureFixture(
    page,
    'bounce',
    async (page) => {
      await click('bounce', 'play')(page);
      // Well after the 900 ms bounce and the 200 ms of quiet that ends a take.
      await page.waitForTimeout(1300);
      await click('bounce', 'play')(page);
    },
    1300,
  );
  expect(takes).toHaveLength(2);
  expect(captureOf(takes[1]).tracks).toHaveLength(1);
});

test('the page is left alone: nothing is paused, changed or restyled', async ({ page }) => {
  await openFixtures(page);
  const selector = rootSelector('loader');
  const read = (target: string) =>
    page.evaluate((query) => {
      const element = document.querySelector(query);
      const animation = element?.getAnimations()[0];
      return {
        style: element?.getAttribute('style') ?? null,
        classes: element?.getAttribute('class') ?? null,
        playState: animation?.playState,
        rate: animation?.playbackRate,
        childCount: document.body.childElementCount,
      };
    }, target);
  const before = await read(selector);
  await page.evaluate((target) => window.MotionCapture.record(target), selector);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.MotionCapture.stop());
  expect(await read(selector)).toEqual(before);
  expect(before.playState).toBe('running');
});

test('picking a part inside the thing that moves still captures it, from its parent', async ({
  page,
}) => {
  await openFixtures(page);
  // The image inside the card does not animate. The card does.
  await page.evaluate(() => {
    window.movedTo = new Promise<string>((resolve) => {
      window.MotionCapture.record('.fx-card__image', undefined, resolve);
    });
  });
  await page.hover('.fx-card__image');
  expect(await page.evaluate(() => window.movedTo)).toBe('div.fx-card');

  // And the hover that was already under way is captured. Nothing has to be
  // triggered a second time.
  await page.waitForTimeout(800);
  const takes = await page.evaluate(() => window.MotionCapture.stop());
  const capture = captureOf(takes[0]);
  expect(capture.source.selector).toBe('div.fx-card');
  expect(track(capture, 'transform').keyframes[1]?.value).toBe('translateY(-6px) scale(1.03)');
});

test('recording moves to the parent only when the picked element has nothing of its own', async ({
  page,
}) => {
  await openFixtures(page);
  const selector = rootSelector('card-lift');
  await page.evaluate((target) => window.MotionCapture.record(target), selector);
  await page.hover(selector);
  await page.waitForTimeout(800);
  const takes = await page.evaluate(() => window.MotionCapture.stop());
  expect(captureOf(takes[0]).source.selector).toBe('div.fx-card');
});

test('icon button: the circles next to the picked arrows come in, the arrows are drawn as arrows, and hover and leave are one take', async ({
  page,
}) => {
  // Shaped like a button found on a real site, where the preview showed
  // gray squares, no circles, and the leave as a separate take.
  await openFixtures(page);
  const selector = rootSelector('icon-button');
  await page.evaluate((target) => {
    window.movedTo = new Promise<string>((resolve) => {
      window.MotionCapture.record(target, undefined, resolve);
    });
  }, selector);
  await page.hover(selector);
  // The arrows have animations of their own. The circles next to them start
  // at the same moment, so recording moves to the button that holds both.
  expect(await page.evaluate(() => window.movedTo)).toBe('span.fx-icon-button');
  await page.waitForTimeout(900);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1200);
  const takes = await page.evaluate(() => window.MotionCapture.stop());

  // The outgoing arrow rests at "translate(0px) rotate(0deg)" before the
  // hover and at "none" after it. Compared by meaning, they match, so the
  // leave joins the hover.
  const capture = onlyCapture(takes);
  const shapes = flattenShapes(capture.root);
  const out = capture.tracks.filter(
    (item) => item.property === 'transform' && item.keyframes[0]?.value.includes('rotate'),
  );
  expect(out.length).toBeGreaterThan(0);
  expect(capture.tracks.some((item) => item.keyframes.at(-1)?.value === 'none')).toBe(true);

  // Both circles are in the drawing.
  expect(shapes.map((shape) => shape.fill)).toEqual(
    expect.arrayContaining(['rgba(0, 0, 0, 0.7)', 'rgb(255, 255, 255)']),
  );

  // Each arrow is drawn from its own outline, in layout size and place,
  // although the card it sits on is tilted and scaled. Each stroke of an
  // arrow is a shape of its own, inside the arrow's SVG shape.
  const icons = shapes.filter((shape) => shape.children.some((child) => child.kind === 'path'));
  expect(icons).toHaveLength(2);
  for (const icon of icons) {
    const parts = icon.children.filter((child) => child.kind === 'path');
    expect(parts.flatMap((part) => part.icon ?? []).map((part) => part.d)).toEqual([
      // As Chrome reports it: the same path, written out in full.
      'M 4 12 H 16',
      'M 12 6 L 18 12 L 12 18',
    ]);
    const outline = parts[0]?.icon?.[0];
    expect(outline?.stroke).toEqual({
      color: expect.any(String),
      width: 1.75,
      cap: 'square',
      join: 'miter',
    });
    expect(outline?.matrix).toEqual([1, 0, 0, 1, 0, 0]);
    expect(outline?.followsText).toBe(true);
    expect(icon.box.width).toBeCloseTo(24, 0);
    expect(icon.box.height).toBeCloseTo(24, 0);
  }
  const arrowParts = shapes.filter((shape) =>
    shape.children.some((child) => icons.includes(child)),
  );
  expect(arrowParts.map((shape) => [Math.round(shape.box.x), Math.round(shape.box.y)])).toEqual([
    [16, 16],
    [16, 16],
  ]);
  // The arrow waiting to slide in is hidden at rest, even though recording
  // moved to the button after its fade had begun.
  expect(arrowParts.map((shape) => shape.opacity)).toEqual([1, 0]);

  // The card behind the button is the backdrop.
  expect(capture.backdrop).toBe('rgb(232, 226, 216)');
});

test('icons too complex to copy are drawn as a mark in their own color', async ({ page }) => {
  await openFixtures(page);
  const raw = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;left:20px;top:20px;width:40px;height:40px;color:rgb(200, 0, 0)';
    // An embedded picture is image data, which is never copied, so the
    // icon is drawn as a mark in the color of its first part.
    host.innerHTML =
      '<svg width="40" height="40" viewBox="0 0 10 10"><image href="data:," width="4" height="4" /><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>';
    document.body.append(host);
    window.MotionCapture.record(host);
    host.animate({ opacity: [1, 0.5] }, 200);
    await new Promise((resolve) => setTimeout(resolve, 700));
    return window.MotionCapture.stop();
  });
  const capture = captureOf(raw[0] ?? { capture: null, problems: ['no take'], raw: null });
  const icon = flattenShapes(capture.root).find((shape) => shape.kind === 'image');
  expect(icon?.icon).toBeNull();
  expect(icon?.fill ?? icon?.stroke?.color).toBe('rgb(200, 0, 0)');
});

// ---------- Found in a sweep of real sites ----------

const shapeLabelled = (capture: Capture, label: string) => {
  const shape = flattenShapes(capture.root).find((item) => item.label === label);
  if (shape === undefined) throw new Error(`No shape labelled ${label}`);
  return shape;
};
const tracksOn = (capture: Capture, shapeId: string) =>
  capture.tracks.filter((item) => item.shapeId === shapeId);

test('a ::before underline is drawn, and its left and right are measured against the link', async ({
  page,
}) => {
  const capture = onlyCapture(await captureFixture(page, 'underline', hover, 600));
  const line = shapeLabelled(capture, 'a.fx-underline::before');
  expect(line.fill).toBe('rgb(32, 152, 209)');
  expect(line.box.height).toBe(4);
  expect(line.box.y + line.box.height).toBeCloseTo(capture.root.box.height, 0);
  const moves = tracksOn(capture, line.id);
  expect(moves.map((item) => item.property).sort()).toEqual(['left', 'right']);
  // 51% of the link's width, so the preview can draw it.
  const start = moves[0]?.keyframes[0]?.parsed;
  expect(start).toEqual({ kind: 'percent', value: 51, of: capture.root.box.width });
  expect(capture.notShown).toEqual([]);
});

test('a ::before fill sweeps behind the label, drawn before it', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'sweep', hover, 600));
  const fill = shapeLabelled(capture, 'a.fx-sweep::before');
  expect(capture.root.children[0]).toBe(fill);
  // offsetWidth, used for elements, is rounded to whole pixels.
  expect([fill.box.x, fill.box.y]).toEqual([0, 0]);
  expect(fill.box.width).toBeCloseTo(capture.root.box.width, 0);
  expect(fill.box.height).toBeCloseTo(capture.root.box.height, 0);
  expect(tracksOn(capture, fill.id).map((item) => item.keyframes.map((k) => k.value))).toEqual([
    ['scaleX(0)', 'scaleX(1)'],
  ]);
});

test('perspective(1px) translateZ(0) is read as flat, so a grow reads as a scale', async ({
  page,
}) => {
  const capture = onlyCapture(await captureFixture(page, 'grow-layer', hover, 600));
  expect(describeCapture(capture)).toBe(
    'The element scales to 1.1 over 300 ms. It starts fast and slows down.',
  );
});

test('a resting rotation is kept', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'ribbon', hover, 800));
  const [a = 0, b = 0, c = 0, d = 0] = capture.root.transform ?? [];
  expect([a, b, c, d].map((n) => Math.round(n * 1000) / 1000)).toEqual([
    0.707, 0.707, -0.707, 0.707,
  ]);
});

test('each SVG stroke is a shape, turning about its own box', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'chevron', hover, 600));
  const left = shapeLabelled(capture, 'path.fx-chevron__left');
  const right = shapeLabelled(capture, 'path.fx-chevron__right');
  expect([left.kind, right.kind]).toEqual(['path', 'path']);
  // The middle of each stroke's box, in the SVG's own units.
  expect(left.transformOrigin).toEqual({ x: 4, y: 6 });
  expect(right.transformOrigin).toEqual({ x: 8, y: 6 });
  expect(tracksOn(capture, left.id)[0]?.keyframes.at(-1)?.parsed).toEqual({
    kind: 'transform',
    functions: [{ fn: 'rotate', deg: -90 }],
  });
  expect(tracksOn(capture, right.id)).toHaveLength(1);
});

test('an SVG circle drawing itself is captured on its own shape', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'ring', nothing, 500));
  const circle = flattenShapes(capture.root).find((shape) => shape.kind === 'path');
  expect(circle).toBeDefined();
  expect(
    tracksOn(capture, circle?.id ?? '')
      .map((item) => item.property)
      .sort(),
  ).toEqual(['stroke-dasharray', 'stroke-dashoffset']);
  expect(track(capture, 'transform').shapeId).toBe(capture.root.id);
  // Drawn from the right-hand point, as SVG starts a circle.
  expect(circle?.icon?.[0]?.d.startsWith('M64 44')).toBe(true);
});

test('a card keeps its shadow, a gradient keeps its direction, and a filter is captured', async ({
  page,
}) => {
  const capture = onlyCapture(await captureFixture(page, 'lift-card', hover, 600));
  expect(capture.root.shadow).toEqual({ color: 'rgba(0, 0, 0, 0.08)', x: 0, y: 5, blur: 15 });
  // The gradient keeps its direction and colors, with no fill under it.
  expect(capture.root.children[0]?.fill).toBeNull();
  expect(capture.root.children[0]?.gradient).toEqual({
    kind: 'linear',
    angle: 90,
    stops: [
      { color: 'rgba(32, 152, 209, 1)', at: 0 },
      { color: 'rgba(47, 111, 237, 1)', at: 1 },
    ],
  });
  expect(track(capture, 'filter').keyframes.map((k) => k.value)).toEqual([
    'none',
    'brightness(0.8)',
  ]);
});

test('a loader made only of a ::before is drawn and turns', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'pseudo-spinner', nothing, 500));
  const ring = shapeLabelled(capture, 'span.fx-pseudo-spinner::before');
  expect(ring.stroke?.sides).toEqual([
    'rgb(255, 61, 0)',
    'rgb(212, 212, 212)',
    'rgb(212, 212, 212)',
    'rgb(212, 212, 212)',
  ]);
  expect(track(capture, 'transform').shapeId).toBe(ring.id);
  expect(capture.notShown).toEqual([]);
});

test('an animation that ends where it starts is left out, and the take says so', async ({
  page,
}) => {
  await openFixtures(page);
  const takes = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.className = 'still';
    host.style.cssText =
      'position: fixed; left: 20px; top: 20px; width: 40px; height: 40px; background: #ccc';
    document.body.append(host);
    window.MotionCapture.record(host);
    host.animate({ opacity: [1, 1] }, 200);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return window.MotionCapture.stop();
  });
  const capture = captureOf(takes[0]);
  expect(capture.tracks).toEqual([]);
  expect(capture.notShown).toEqual([
    'The opacity animation on div.still ends where it starts, so there is nothing to see.',
  ]);
});

test('a parent outside the pick that cuts it off is recorded as the frame', async ({ page }) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'position: fixed; left: 20px; top: 20px; width: 120px; height: 24px; overflow: hidden; border: 2px solid #ccc';
    wrapper.innerHTML =
      '<span class="roll" style="display: block; width: 100px; height: 24px; margin-left: 10px; background: #2f6fed; transition: transform 200ms">x</span>';
    document.body.append(wrapper);
    const style = document.createElement('style');
    style.textContent = 'div:hover > .roll { transform: translateY(-24px); }';
    document.head.append(style);
    window.MotionCapture.record(wrapper.querySelector('.roll') as Element);
  });
  await page.hover('.roll');
  await page.waitForTimeout(500);
  const capture = captureOf((await page.evaluate(() => window.MotionCapture.stop()))[0]);
  // The wrapper's inside, where the line disappears as it rolls up.
  // (The page uses border-box, so its 2 px border comes off the 120 by 24.)
  expect(capture.frame).toEqual({ x: -10, y: 0, width: 116, height: 20 });
});

test('gradients: corner directions, px stops, modern colors and missing positions', async ({
  page,
}) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const root = document.createElement('div');
    root.className = 'gradients';
    root.style.cssText = 'position: fixed; left: 20px; top: 20px; display: flex; gap: 8px';
    root.innerHTML = [
      'width: 200px; height: 100px; background: linear-gradient(to top right, red, blue)',
      'width: 100px; height: 40px; background: linear-gradient(90deg, red 20px, blue 50%, lime)',
      'width: 60px; height: 60px; background: radial-gradient(circle, oklch(0.7 0.2 30), transparent)',
    ]
      .map((css) => `<div style="${css}"></div>`)
      .join('');
    document.body.append(root);
    window.MotionCapture.record(root);
    root.animate({ opacity: [1, 0.5] }, 100);
  });
  await page.waitForTimeout(500);
  const capture = captureOf((await page.evaluate(() => window.MotionCapture.stop()))[0]);
  const [corner, stops, radial] = capture.root.children.map((child) => child.gradient);
  // Toward the top right corner of a 200 by 100 box: at right angles to the
  // other diagonal, so atan(100 / 200), about 26.6 degrees.
  expect(corner?.kind === 'linear' ? Math.round(corner.angle * 10) / 10 : null).toBe(26.6);
  // 20 px along a 100 px line is 0.2; "lime" with no position is at the end.
  expect(stops?.stops.map((stop) => stop.at)).toEqual([0.2, 0.5, 1]);
  expect(radial?.kind).toBe('radial');
  // oklch is turned into numbers the canvas and core can read.
  expect(radial?.stops[0]?.color).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
  expect(radial?.stops[1]?.color).toBe('rgba(0, 0, 0, 0)');
});

test('an icon drawn from a sprite with <use> is drawn from the symbol it points to', async ({
  page,
}) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position: fixed; left: 20px; top: 20px; color: rgb(200, 0, 0)';
    host.innerHTML =
      '<svg width="0" height="0" style="position: absolute"><symbol id="sprite-dot" viewBox="0 0 10 10"><path d="M0 0H10V10H0Z" /></symbol></svg>' +
      '<svg class="sprite-icon" width="30" height="30" style="fill: currentColor"><use href="#sprite-dot" x="5" y="5" width="20" height="20" /></svg>';
    document.body.append(host);
    const icon = host.querySelector('.sprite-icon') as Element;
    window.MotionCapture.record(icon);
    icon.animate({ opacity: [1, 0.5] }, 100);
  });
  await page.waitForTimeout(500);
  const capture = captureOf((await page.evaluate(() => window.MotionCapture.stop()))[0]);
  const part = capture.root.children[0];
  expect(part?.kind).toBe('path');
  const outline = part?.icon?.[0];
  // The symbol's 10 by 10 fitted into 20 by 20, at x 5 and y 5.
  expect(outline?.matrix).toEqual([2, 0, 0, 2, 5, 5]);
  expect(outline?.fill).toBe('rgb(200, 0, 0)');
  expect(outline?.followsText).toBe(true);
});

test("a backdrop painted by a parent's ::before is found", async ({ page }) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent =
      '.violet-bar { position: fixed; left: 0; top: 0; width: 300px; height: 60px; } .violet-bar::before { content: ""; position: absolute; inset: 0; z-index: -1; background: rgb(112, 44, 249); }';
    document.head.append(style);
    const bar = document.createElement('header');
    bar.className = 'violet-bar';
    bar.innerHTML =
      '<a class="brand" style="display: inline-block; margin: 10px; width: 40px; height: 32px">B</a>';
    document.body.append(bar);
    const brand = bar.querySelector('.brand') as Element;
    window.MotionCapture.record(brand);
    brand.animate({ opacity: [1, 0.5] }, 100);
  });
  await page.waitForTimeout(500);
  const capture = captureOf((await page.evaluate(() => window.MotionCapture.stop()))[0]);
  expect(capture.backdrop).toBe('rgb(112, 44, 249)');
});

test('switch thumbs that move by calc() are read in px', async ({ page }) => {
  const capture = onlyCapture(
    await captureFixture(page, 'switches', click('switches', 'toggle'), 500),
  );
  const knob = track(capture, 'left');
  // calc(100% - 21px) of the 44 px switch is 23 px.
  expect(knob.keyframes.map((keyframe) => keyframe.parsed)).toEqual([
    { kind: 'length', px: 3 },
    { kind: 'length', px: 23 },
  ]);
  expect(track(capture, 'translate').keyframes.at(-1)?.value).toContain('100%');
});

// ---------- The picker ----------

const overlay = (page: Page) => page.locator('[data-motion-inspector="picker"]');

test('picker: click picks the element under the pointer and blocks the page from seeing the click', async ({
  page,
}) => {
  await openFixtures(page);
  await page.evaluate(() => {
    window.pickResult = window.MotionCapture.pickAndRecord();
  });
  await expect(overlay(page)).toHaveCount(1);

  // Pick the "Play" button of the bounce fixture. A real click would start
  // the bounce. While picking, it must not.
  await page.click('[data-fixture="bounce"] [data-trigger="play"]');
  expect(await page.evaluate(() => window.pickResult)).toBe(true);
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator('.fx-ball')).not.toHaveClass(/is-playing/);

  // Picking is over. Now the same click reaches the page.
  await page.click('[data-fixture="bounce"] [data-trigger="play"]');
  await expect(page.locator('.fx-ball')).toHaveClass(/is-playing/);
});

test('picker: Escape cancels and removes the overlay', async ({ page }) => {
  await openFixtures(page);
  await page.evaluate(() => {
    window.pickResult = window.MotionCapture.pickAndRecord();
  });
  await page.hover(rootSelector('card-lift'));
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.pickResult)).toBe(false);
  await expect(overlay(page)).toHaveCount(0);
});

test('picker: the up arrow moves to the parent, the down arrow to the first child', async ({
  page,
}) => {
  await openFixtures(page);
  await page.evaluate(() => {
    window.pickResult = window.MotionCapture.pickAndRecord();
  });
  // Point at the image inside the card, go up to the card, down to the
  // image again, up once more, and pick with Enter.
  await page.hover('.fx-card__image');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.pickResult)).toBe(true);

  // The pointer is still over the card, so moving it triggers the lift.
  await page.mouse.move(0, 0);
  await page.hover(rootSelector('card-lift'));
  await page.waitForTimeout(800);
  const takes = await page.evaluate(() => window.MotionCapture.stop());
  expect(captureOf(takes[0]).source.selector).toBe('div.fx-card');
});
