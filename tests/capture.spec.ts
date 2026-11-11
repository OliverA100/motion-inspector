// The real capture script, run on the fixtures page with real pointer
// input. No extension is needed: the script is injected as a plain file,
// the same file the extension injects.

import { expect, test, type Page } from '@playwright/test';
import { describeCapture } from '../packages/core/src/describe';
import { captureToCss } from '../packages/core/src/exportCss';
import { parseCapture } from '../packages/core/src/parse';
import { sampleTrack } from '../packages/core/src/sample';
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

test('a pseudo-element in the flow of text is drawn just before its text (D158)', async ({
  page,
}) => {
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
  expect(capture.notShown).toEqual([]);
  const shapes = flattenShapes(capture.root);
  const before = shapes.find((shape) => shape.label === 'span.in-flow::before');
  const text = shapes.find((shape) => shape.kind === 'text');
  expect(before?.box.width).toBe(8);
  expect((before?.box.x ?? 0) + 8).toBeLessThanOrEqual((text?.box.x ?? 0) + 0.5);
  expect(capture.tracks.find((item) => item.shapeId === before?.id)?.property).toBe('transform');
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
  const capture = captureOf(
    raw[0] ?? { capture: null, problems: ['no take'], raw: null, replaces: false },
  );
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
  expect(describeCapture(capture)).toContain('widens from nothing to its full width');
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
    tile: null,
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

test('parts that appear during a take never share an id', async ({ page }) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      .late-root { position: fixed; left: 20px; top: 20px; width: 160px; padding: 8px; background: #eee }
      .late-root .late-child { display: none; height: 20px; background: #2f6fed }
      .late-root.open .late-child { display: block; animation: late-in 300ms }
      .late-root.open::after { content: ""; position: absolute; left: 0; bottom: 0; width: 100%; height: 2px; background: red; animation: late-in 300ms }
      @keyframes late-in { from { opacity: 0 } }`;
    document.head.append(style);
    const root = document.createElement('div');
    root.className = 'late-root';
    root.innerHTML = 'Menu<div class="late-child"></div>';
    document.body.append(root);
    window.MotionCapture.record(root);
    root.classList.add('open');
  });
  await page.waitForTimeout(700);
  const capture = captureOf((await page.evaluate(() => window.MotionCapture.stop()))[0]);
  const ids = flattenShapes(capture.root).map((shape) => shape.id);
  expect(new Set(ids).size).toBe(ids.length);
  // Both parts that appeared are drawn, each with its fade.
  expect(capture.tracks.filter((item) => item.property === 'opacity')).toHaveLength(2);
});

test('a loop that only turns a registered variable is filmed for one turn and drawn', async ({
  page,
}) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      @property --turn { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
      .var-ring { position: fixed; left: 20px; top: 20px; width: 40px; height: 40px;
        background: conic-gradient(from var(--turn), red, blue); animation: var-spin 1s linear infinite }
      @keyframes var-spin { to { --turn: 360deg } }`;
    document.head.append(style);
    const ring = document.createElement('div');
    ring.className = 'var-ring';
    document.body.append(ring);
  });
  await page.evaluate(() =>
    window.MotionCapture.record(document.querySelector('.var-ring') as Element),
  );
  await page.waitForTimeout(1600);
  const capture = captureOf((await page.evaluate(() => window.MotionCapture.stop()))[0]);
  // Chrome lists no values for --turn: the ring is filmed, one whole turn,
  // and drawn as its conic gradient turning.
  const [track] = capture.tracks;
  expect(capture.tracks).toHaveLength(1);
  expect(track?.property).toBe('background-image');
  const angles = (track?.keyframes ?? []).map((keyframe) =>
    Number(/from (-?[\d.]+)deg/.exec(keyframe.value)?.[1]),
  );
  const turned = (angles[angles.length - 1] ?? 0) - (angles[0] ?? 0);
  expect(turned).toBeGreaterThan(330);
  expect(turned).toBeLessThan(480);
  expect(capture.notShown.join(' ')).not.toContain('only changes CSS variables');
});

test('text that shows a background through its letters, and a gradient border', async ({
  page,
}) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      .shine-root { position: fixed; left: 20px; top: 20px; display: flex; gap: 12px; padding: 8px; background: #111 }
      .shine-text { background: linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 0, 255)); -webkit-background-clip: text; background-clip: text; color: transparent }
      .glow { position: relative; width: 100px; height: 40px }
      .glow::before { content: ""; position: absolute; inset: 0; padding: 2px; border-radius: 8px;
        background: radial-gradient(rgb(0, 255, 0), rgb(0, 0, 255));
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor; mask-composite: exclude }`;
    document.head.append(style);
    const root = document.createElement('div');
    root.className = 'shine-root';
    root.innerHTML = '<span class="shine-text">Loading</span><div class="glow"></div>';
    document.body.append(root);
    window.MotionCapture.record(root);
    root.animate({ opacity: [1, 0.5] }, 100);
  });
  await page.waitForTimeout(500);
  const capture = captureOf((await page.evaluate(() => window.MotionCapture.stop()))[0]);
  const shapes = flattenShapes(capture.root);
  // The text is drawn in the gradient's colors; the box behind it is not.
  const text = shapes.find((shape) => shape.kind === 'text');
  expect(text?.fill).toBe('rgba(128, 0, 128, 1)');
  // The masked glow keeps its gradient, and its mask cuts it to a 2 px
  // ring: the padding box's inside excluded from the whole (D155).
  const glow = shapes.find((shape) => shape.label === 'div.glow::before');
  expect(glow?.gradient?.kind).toBe('radial');
  expect(glow?.mask?.map((layer) => [layer.composite, layer.area])).toEqual([
    ['exclude', { x: 2, y: 2, width: 96, height: 36 }],
    ['exclude', { x: 0, y: 0, width: 100, height: 40 }],
  ]);
});

test('a skeleton shimmer keeps its gradient tile', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'skeleton', nothing, 500));
  // background-size 200% of a 200 px bar.
  expect(capture.root.gradient?.tile?.width).toBe(400);
  expect(capture.tracks.map((item) => item.property).sort()).toContain('background-position-x');
});

test('an SVG group that moves is a shape holding its parts', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'svg-group', nothing, 500));
  const group = flattenShapes(capture.root).find((shape) => shape.kind === 'group');
  expect(group?.label).toBe('g.fx-train');
  // The carriage and both wheels move with it; the rail does not.
  expect(group?.children.map((child) => child.label)).toEqual(['rect', 'circle', 'circle']);
  expect(track(capture, 'transform').shapeId).toBe(group?.id);
  expect(capture.notShown).toEqual([]);
});

test('items pushed down by a panel opening get layout tracks, which are not exported', async ({
  page,
}) => {
  const capture = onlyCapture(await captureFixture(page, 'reflow', click('reflow', 'toggle'), 700));
  const layout = capture.tracks.filter((item) => item.origin === 'layout');
  const moved = layout.filter((item) => item.property === 'top');
  // The second and third items, each 60 px further down at the end.
  expect(moved).toHaveLength(2);
  for (const item of moved) {
    const [first, last] = [item.keyframes[0], item.keyframes.at(-1)];
    const distance =
      (last?.parsed?.kind === 'length' ? last.parsed.px : 0) -
      (first?.parsed?.kind === 'length' ? first.parsed.px : 0);
    expect(distance).toBeCloseTo(60, 0);
  }
  expect(describeCapture(capture)).toContain('parts move with the layout');
  expect(captureToCss(capture)).not.toMatch(/\btop\b/);
});

test('a transition restarted every frame by a script is one take, with a note', async ({
  page,
}) => {
  await openFixtures(page);
  await page.evaluate(async () => {
    const box = document.createElement('div');
    box.className = 'nudged';
    box.style.cssText =
      'position: fixed; left: 20px; top: 20px; width: 40px; height: 40px; background: #2f6fed; transition: transform 150ms';
    document.body.append(box);
    window.MotionCapture.record(box);
    for (let frame = 1; frame <= 20; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      box.style.transform = `translateX(${frame}px)`;
    }
  });
  await page.waitForTimeout(600);
  const takes = await page.evaluate(() => window.MotionCapture.stop());
  expect(takes.length).toBeLessThanOrEqual(2);
  const notes = takes.flatMap((take) => take.capture?.notShown ?? []);
  expect(notes.join(' ')).toMatch(/restarted \d+ times in a row/);
});

test('an SVG group that starts moving during the take gets a shape then', async ({ page }) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      .late-svg.go .late-wheel { animation: late-roll 400ms linear }
      .late-svg.go .masked { animation: late-roll 400ms linear }
      @keyframes late-roll { to { transform: translateX(20px) } }`;
    document.head.append(style);
    const host = document.createElement('div');
    host.style.cssText = 'position: fixed; left: 20px; top: 20px';
    host.innerHTML =
      '<svg class="late-svg" width="100" height="40" viewBox="0 0 100 40">' +
      '<defs><mask id="late-mask"><g class="masked"><rect width="50" height="40" fill="#fff" /></g></mask></defs>' +
      '<g class="late-wheel"><circle cx="10" cy="20" r="6" fill="#111" /><circle cx="30" cy="20" r="6" fill="#111" /></g>' +
      '<rect x="60" y="10" width="30" height="20" fill="#2f6fed" mask="url(#late-mask)" /></svg>';
    document.body.append(host);
    const svg = host.querySelector('.late-svg') as Element;
    window.MotionCapture.record(svg);
    svg.classList.add('go');
  });
  await page.waitForTimeout(800);
  const capture = captureOf((await page.evaluate(() => window.MotionCapture.stop()))[0]);
  const group = flattenShapes(capture.root).find((shape) => shape.kind === 'group');
  expect(group?.label).toBe('g.late-wheel');
  expect(group?.children.map((child) => child.label)).toEqual(['circle', 'circle']);
  expect(track(capture, 'transform').shapeId).toBe(group?.id);
  // The group inside the mask is a cut-out, listed with its reason.
  expect(capture.notShown.join(' ')).toContain('part of an SVG mask or clip');
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

test('a box moved by a script spring gets script tracks that match the film', async ({ page }) => {
  const capture = onlyCapture(
    await captureFixture(
      page,
      'spring',
      async (p) => {
        await click('spring', 'toggle')(p);
        // However slow the frames, until it has settled.
        await p.waitForFunction(
          () =>
            document.querySelector<HTMLElement>('.fx-spring__box')?.style.transform ===
            'translateX(160px)',
        );
      },
      400,
    ),
  );
  const scripts = capture.tracks.filter((item) => item.origin === 'script');
  expect(scripts.map((item) => item.property)).toEqual(['transform']);
  const translate = scripts[0];
  if (translate === undefined) throw new Error('no track');
  const xOf = (value: string): number => parseFloat(value.replace('translate(', ''));
  // It ends 160 px along and overshoots on the way.
  expect(xOf(translate.keyframes.at(-1)?.value ?? '')).toBeCloseTo(160, 0);
  expect(Math.max(...translate.keyframes.map((item) => xOf(item.value)))).toBeGreaterThan(161);
  // The fitted track comes within half a pixel of every filmed frame.
  const film = capture.measured?.find((item) => item.shapeId === translate.shapeId);
  expect(film?.frames.length).toBeGreaterThan(10);
  for (const frame of film?.frames ?? []) {
    const at = sampleTrack(translate, frame.t);
    if (at.kind !== 'active') continue;
    const from = xOf(translate.keyframes[at.segmentIndex]?.value ?? '');
    const next = translate.keyframes[at.segmentIndex + 1];
    const to = next === undefined ? from : xOf(next.value);
    expect(Math.abs(from + (to - from) * at.segmentProgress - frame.matrix[4])).toBeLessThan(0.55);
  }
  expect(describeCapture(capture)).toMatch(/was measured from the page/);
});

test('a card that tilts toward the pointer is captured as following it, with its lag', async ({
  page,
}) => {
  const takes = await captureFixture(
    page,
    'tilt',
    async (p) => {
      const card = p.locator('[data-fixture="tilt"] [data-root]');
      // Far down the page: scrolled to while recording, which must not matter.
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox();
      if (box === null) throw new Error('no card');
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await p.mouse.move(box.x - 30, cy);
      // Around the card, then off it.
      for (let step = 0; step <= 60; step += 1) {
        await p.mouse.move(
          cx + Math.cos(step / 6) * box.width * 0.4,
          cy + Math.sin(step / 4) * box.height * 0.4,
        );
        await p.waitForTimeout(16);
      }
      await p.mouse.move(box.x + box.width + 40, cy, { steps: 4 });
    },
    1200,
  );
  const captures = takes.flatMap((take) => (take.capture === null ? [] : [take.capture]));
  // The way in, which follows the pointer, and the way out, which settles
  // back: two takes (D137).
  expect(captures.map((item) => item.trigger)).toEqual(['hover', 'leave']);
  expect(captures[1]?.follows).toBeNull();
  const capture = captures[0];
  const follow = capture?.follows?.[0];
  expect(follow).toBeDefined();
  if (follow === undefined || capture === undefined) return;
  // The script covers 18% of the way each frame: about 85 ms to 63%.
  expect(follow.lagMs).toBeGreaterThan(40);
  expect(follow.lagMs).toBeLessThan(160);
  // Turning about y tapers it left to right with the pointer's x.
  const g = follow.channels.find((channel) => channel.name === 'g');
  expect(Math.abs(g?.perX ?? 0)).toBeGreaterThan(0.0001);
  expect(capture.tracks.filter((track) => track.origin === 'script')).toEqual([]);
  expect(capture.notShown).toEqual([]);
  expect(describeCapture(capture)).toMatch(/follows the pointer/);
});

test('a corner peeled back by a script writing clip-path is fitted as a clip-path track', async ({
  page,
}) => {
  const takes = await captureFixture(
    page,
    'peel',
    async (p) => {
      const card = p.locator('[data-fixture="peel"] [data-root]');
      await card.scrollIntoViewIfNeeded();
      await card.hover();
      await p.waitForTimeout(1500);
    },
    300,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  const clip = capture?.tracks.find(
    (track) => track.origin === 'script' && track.property === 'clip-path',
  );
  expect(clip).toBeDefined();
  // From the 40 px cut to the 120 px one, the same polygon all the way.
  expect(clip?.keyframes[0]?.value).toContain('calc(100% - 40px)');
  expect(clip?.keyframes.at(-1)?.value).toContain('calc(100% - 120px)');
  expect(clip?.keyframes.at(-1)?.value).toMatch(/^polygon\(/);
});

test('edges: every shadow layer with its spread and inset, and a border on one side only', async ({
  page,
}) => {
  const takes = await captureFixture(
    page,
    'edges',
    (p) => p.hover('[data-fixture="edges"] [data-root]'),
    600,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  const shapes = capture === undefined || capture === null ? [] : flattenShapes(capture.root);
  const ring = shapes.find((shape) => shape.label.includes('fx-edges__ring'));
  expect(ring?.shadows).toEqual([
    { color: 'rgba(0, 0, 0, 0.6)', x: 0, y: 0, blur: 0, spread: 1, inset: false },
    { color: 'rgba(0, 0, 0, 0.25)', x: 0, y: 8, blur: 16, spread: 0, inset: false },
  ]);
  const well = shapes.find((shape) => shape.label.includes('fx-edges__well'));
  expect(well?.shadows?.[0]?.inset).toBe(true);
  const outlined = shapes.find((shape) => shape.label.includes('fx-edges__outlined'));
  expect(outlined?.outline).toEqual({
    color: 'rgb(224, 33, 138)',
    width: 2,
    offset: 4,
    style: 'dashed',
  });
  // Drawn in stacking order: the cover first, the label (higher z-index) over it.
  const order = shapes.map((shape) => shape.label);
  expect(order.indexOf('div.fx-edges__cover')).toBeGreaterThan(-1);
  expect(order.indexOf('div.fx-edges__label')).toBeGreaterThan(
    order.indexOf('div.fx-edges__cover'),
  );
  const conic = shapes.find((shape) => shape.label.includes('fx-edges__conic'));
  expect(conic?.gradient?.kind).toBe('conic');
  if (conic?.gradient?.kind === 'conic') {
    expect(conic.gradient.angle).toBe(90);
    expect(conic.gradient.center).toEqual({ x: 0.5, y: 0.5 });
    expect(conic.gradient.stops.map((stop) => stop.at)).toEqual([0, 0.5, 1]);
  }
  const tab = shapes.find((shape) => shape.label.includes('fx-edges__tab'));
  expect(tab?.stroke?.width).toBe(3);
  // Only the bottom side shows.
  expect(tab?.stroke?.sides?.map((color) => color === 'rgba(0, 0, 0, 0)')).toEqual([
    true,
    true,
    false,
    true,
  ]);
});

test("a card flip: each face carries its parent's perspective and hides its back", async ({
  page,
}) => {
  const takes = await captureFixture(
    page,
    'flip',
    (p) => p.hover('[data-fixture="flip"] [data-root]'),
    900,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  // Both are named div.fx-flip__face: the front is first, the back second.
  const [front, back] = capture?.root.children ?? [];
  // The viewer is 500 px away, looking at the middle of the card, which
  // is where each face turns about.
  expect(front?.perspective).toEqual({ distance: 500, x: 0, y: 0 });
  expect(back?.perspective).toEqual({ distance: 500, x: 0, y: 0 });
  expect(front?.backfaceHidden).toBe(true);
  expect(back?.backfaceHidden).toBe(true);
  // The parent itself is seen flat.
  expect(capture?.root.perspective).toBeNull();
  expect(capture?.root.backfaceHidden).toBe(false);
});

test('a script-moved hover and its leave are two takes, the leave starting where the hover ended', async ({
  page,
}) => {
  const takes = await captureFixture(
    page,
    'peel',
    async (p) => {
      const card = p.locator('[data-fixture="peel"] [data-root]');
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox();
      if (box === null) throw new Error('no card');
      await p.mouse.move(box.x - 30, box.y + 20);
      await p.mouse.move(box.x + 40, box.y + 40, { steps: 3 });
      // Rest on it, with the small moves a hand makes.
      for (let step = 0; step < 16; step += 1) {
        await p.mouse.move(box.x + 40 + (step % 3), box.y + 40 + (step % 2));
        await p.waitForTimeout(70);
      }
      await p.mouse.move(box.x - 30, box.y + 20, { steps: 3 });
      await p.waitForTimeout(1200);
    },
    300,
  );
  const shown = takes.filter((take) => take.capture !== null);
  expect(shown.map((take) => take.capture?.trigger)).toEqual(['hover', 'leave']);
  // Kept apart: the second does not replace the first.
  expect(shown.some((take) => take.replaces)).toBe(false);
  const clips = shown.map((take) =>
    take.capture?.tracks.find((track) => track.property === 'clip-path'),
  );
  const cut = (value: string | undefined): number =>
    Number(/calc\(100% - ([\d.]+)px\), calc/.exec(value ?? '')?.[1]);
  // In from 40 px to 120, back from 120 to 40.
  expect(cut(clips[0]?.keyframes.at(-1)?.value)).toBeCloseTo(120, 0);
  expect(cut(clips[1]?.keyframes[0]?.value)).toBeCloseTo(cut(clips[0]?.keyframes.at(-1)?.value), 1);
  expect(cut(clips[1]?.keyframes.at(-1)?.value)).toBeCloseTo(40, 0);
});

test('a button pressed inside the recorded element names its take "click", not "focus"', async ({
  page,
}) => {
  await openFixtures(page);
  // The whole fixture, its button included: the press moves focus to it.
  await page.evaluate(() => window.MotionCapture.record('[data-fixture="spring"]'));
  await page.click('[data-fixture="spring"] [data-trigger="toggle"]');
  await page.waitForTimeout(1600);
  const takes = await page.evaluate(() => window.MotionCapture.stop());
  const triggers = takes.flatMap((take) => (take.capture === null ? [] : [take.capture.trigger]));
  expect(triggers).not.toContain('focus');
  expect(triggers[0]).toBe('click');
});

test('parts moved through a CSS variable are measured, the variable itself not listed', async ({
  page,
}) => {
  const capture = onlyCapture(
    await captureFixture(
      page,
      'variable',
      (p) => p.hover('[data-fixture="variable"] [data-root]'),
      900,
    ),
  );
  // No track of the variable, and no note that it could not be shown.
  expect(capture.tracks.some((track) => track.property.startsWith('--'))).toBe(false);
  expect(capture.notShown.join(' ')).not.toContain('CSS variables');
  const moved = (id: string): number => {
    const track = capture.tracks.find(
      (item) => item.shapeId === id && item.property === 'transform',
    );
    return Number(/translate\(([-\d.]+)px/.exec(track?.keyframes.at(-1)?.value ?? '')?.[1]);
  };
  // The box by --fx-x, its dot by one and a half times it, plus the box's.
  expect(moved(capture.root.id)).toBeCloseTo(60, 0);
  expect(moved(capture.root.children[0]?.id ?? '')).toBeCloseTo(90, 0);
  expect(describeCapture(capture)).toContain('was measured from the page');
});

test('a menu a button opens at the end of the page is what gets recorded', async ({ page }) => {
  const takes = await captureFixture(
    page,
    'menu',
    (p) => p.click('[data-fixture="menu"] [data-root]'),
    700,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  // Recording moved from the button to the menu it opened.
  expect(capture?.root.label).toBe('div.fx-menu');
  expect(capture?.trigger).toBe('click');
  const properties = capture?.tracks.map((track) => track.property) ?? [];
  expect(properties).toContain('opacity');
  expect(properties).toContain('transform');
});

test('an animation that follows the scroll is listed when picked, shown over a second', async ({
  page,
}) => {
  const takes = await captureFixture(page, 'scroll', async () => {}, 600);
  const capture = takes.find((take) => take.capture !== null)?.capture;
  expect(capture?.trigger).toBe('scroll');
  const track = capture?.tracks.find((item) => item.property === 'transform');
  // Chrome writes scroll(nearest) as scroll(), its default.
  expect(track?.scroll).toEqual({ timeline: 'scroll()', range: 'normal' });
  expect(track?.timing.duration).toBe(1000);
  expect(track?.keyframes.map((keyframe) => keyframe.value)).toEqual(['scaleX(0)', 'scaleX(1)']);
  expect(capture?.notShown.join(' ')).not.toContain('scroll');
});

test('parts are named by a class that names something, not a utility variant or a hash', async ({
  page,
}) => {
  await openFixtures(page);
  const takes = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.className = 'focus-visible:outline-2 css-1ab2cd card';
    host.style.cssText =
      'position: fixed; left: 20px; top: 20px; width: 40px; height: 40px; background: #ccc';
    document.body.append(host);
    window.MotionCapture.record(host);
    host.animate({ opacity: [1, 0.5] }, 200);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return window.MotionCapture.stop();
  });
  expect(captureOf(takes[0]).root.label).toBe('div.card');
});

test('a part set to display: none during the take is hidden from then on', async ({ page }) => {
  await openFixtures(page);
  const takes = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.style.cssText =
      'position: fixed; left: 20px; top: 20px; width: 80px; height: 40px; background: #ddd';
    const part = document.createElement('div');
    part.style.cssText = 'width: 30px; height: 30px; background: #333';
    host.append(part);
    document.body.append(host);
    window.MotionCapture.record(host);
    part.animate({ opacity: [0, 1] }, { duration: 600, fill: 'forwards' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    // Hidden by a class, as pages do (a style write would be measured as a
    // script's motion instead).
    const rule = document.createElement('style');
    rule.textContent = '.gone { display: none; }';
    document.head.append(rule);
    part.classList.add('gone');
    await new Promise((resolve) => setTimeout(resolve, 500));
    return window.MotionCapture.stop();
  });
  const capture = captureOf(takes.find((take) => take.capture !== null) ?? takes[0]);
  const hidden = capture.tracks.find((track) => track.property === 'visibility');
  expect(hidden?.keyframes.at(-1)?.value).toBe('hidden');
  expect(hidden?.startOffset ?? 0).toBeGreaterThan(250);
});

test('a part a script moves with the scroll is a "scroll" take', async ({ page }) => {
  await openFixtures(page);
  const takes = await page.evaluate(async () => {
    const box = document.createElement('div');
    box.style.cssText =
      'position: fixed; left: 20px; top: 20px; width: 120px; height: 80px; overflow-y: auto; background: #eee';
    const tall = document.createElement('div');
    tall.style.cssText = 'height: 600px';
    const dot = document.createElement('div');
    dot.style.cssText = 'position: sticky; top: 0; width: 20px; height: 20px; background: #333';
    tall.append(dot);
    box.append(tall);
    document.body.append(box);
    // As ScrollTrigger does: the dot slides across as the box scrolls.
    box.addEventListener('scroll', () => {
      dot.style.transform = `translateX(${box.scrollTop / 5}px)`;
    });
    window.MotionCapture.record(box);
    for (let step = 1; step <= 25; step += 1) {
      box.scrollTop = step * 16;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    return window.MotionCapture.stop();
  });
  const capture = captureOf(takes.find((take) => take.capture !== null) ?? takes[0]);
  expect(capture.trigger).toBe('scroll');
  expect(capture.tracks.some((track) => track.origin === 'script')).toBe(true);
});

test('a text-only part that fades out and leaves keeps its fade', async ({ page }) => {
  await openFixtures(page);
  const takes = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position: fixed; left: 20px; top: 20px; width: 160px; height: 60px';
    const word = document.createElement('h3');
    word.textContent = 'Word';
    host.append(word);
    document.body.append(host);
    window.MotionCapture.record(host);
    // As Magic UI's rotating word: fade out, then taken away.
    await word.animate({ opacity: [1, 0] }, { duration: 250, fill: 'forwards' }).finished;
    word.remove();
    await new Promise((resolve) => setTimeout(resolve, 600));
    return window.MotionCapture.stop();
  });
  const capture = captureOf(takes.find((take) => take.capture !== null) ?? takes[0]);
  expect(capture.notShown.join(' ')).not.toContain('left out of the simplified drawing');
  expect(capture.tracks.map((track) => track.property)).toContain('opacity');
});

// ---------- Special kinds ----------

// Adds a style and some markup to the fixtures page, then records `pick`.
async function setUp(page: Page, css: string, html: string, pick: string): Promise<void> {
  await openFixtures(page);
  await page.evaluate(
    ([styleText, markup, selector]) => {
      const style = document.createElement('style');
      style.textContent = styleText;
      document.head.append(style);
      const holder = document.createElement('div');
      holder.innerHTML = markup;
      document.body.prepend(holder);
      window.MotionCapture.record(document.querySelector(selector) as Element);
    },
    [css, html, pick] as const,
  );
}

const takesNow = async (page: Page): Promise<Take[]> =>
  page.evaluate(() => window.MotionCapture.stop());

test('a native popover opened by its button is followed into the top layer', async ({ page }) => {
  await setUp(
    page,
    `#sp-pop { margin: 0; inset: auto; top: 60px; left: 300px; width: 160px; height: 80px; border: 0;
       opacity: 0; scale: 0.9; transition: opacity .3s, scale .3s, display .3s allow-discrete, overlay .3s allow-discrete }
     #sp-pop:popover-open { opacity: 1; scale: 1 }
     @starting-style { #sp-pop:popover-open { opacity: 0; scale: 0.9 } }`,
    '<button id="sp-open" popovertarget="sp-pop">Open</button><div popover id="sp-pop">Hi</div>',
    '#sp-open',
  );
  await page.click('#sp-open');
  await page.waitForTimeout(700);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.trigger).toBe('click');
  expect(capture.tracks.map((track) => track.property).sort()).toEqual(['opacity', 'scale']);
});

test('a modal dialog is followed, and its backdrop is drawn behind it', async ({ page }) => {
  await setUp(
    page,
    `#sp-dialog { width: 200px; height: 100px; border: 0; opacity: 0;
       transition: opacity .3s, display .3s allow-discrete, overlay .3s allow-discrete }
     #sp-dialog[open] { opacity: 1 }
     @starting-style { #sp-dialog[open] { opacity: 0 } }
     #sp-dialog::backdrop { background: rgb(0 0 0 / 0); transition: background .3s, display .3s allow-discrete, overlay .3s allow-discrete }
     #sp-dialog[open]::backdrop { background: rgb(0 0 0 / .4) }
     @starting-style { #sp-dialog[open]::backdrop { background: rgb(0 0 0 / 0) } }`,
    `<button id="sp-show" onclick="document.getElementById('sp-dialog').showModal()">Show</button>
     <dialog id="sp-dialog">Hi</dialog>`,
    '#sp-show',
  );
  await page.click('#sp-show');
  await page.waitForTimeout(700);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.root.label).toBe('dialog');
  const backdrop = capture.root.children.find((shape) => shape.label === 'dialog::backdrop');
  expect(capture.tracks.map((track) => track.property).sort()).toEqual([
    'background-color',
    'opacity',
  ]);
  expect(capture.tracks.find((track) => track.property === 'background-color')?.shapeId).toBe(
    backdrop?.id,
  );
  expect(capture.notShown).toEqual([]);
  expect(describeCapture(capture)).toContain('The backdrop dims the page behind it');
});

test('a player sped up, and one played backwards, are timed as they play', async ({ page }) => {
  await setUp(
    page,
    '.sp-box { width: 40px; height: 40px; background: blue }',
    '<div id="sp-rate"><div class="sp-box"></div></div>',
    '#sp-rate',
  );
  await page.evaluate(() => {
    const box = document.querySelector('#sp-rate .sp-box') as Element;
    const fast = box.animate({ translate: ['0px', '100px'] }, { duration: 600, fill: 'forwards' });
    fast.playbackRate = 2;
  });
  await page.waitForTimeout(700);
  const sped = onlyCapture(await takesNow(page));
  expect(sped.tracks[0]?.timing.duration).toBe(300);
  expect(sped.tracks[0]?.timing.direction).toBe('normal');

  await page.evaluate(() => {
    window.MotionCapture.record(document.querySelector('#sp-rate') as Element);
    const box = document.querySelector('#sp-rate .sp-box') as Element;
    box.getAnimations().forEach((animation) => animation.cancel());
    const back = box.animate({ translate: ['0px', '100px'] }, { duration: 400, fill: 'both' });
    back.reverse();
  });
  await page.waitForTimeout(700);
  const backwards = onlyCapture(await takesNow(page));
  expect(backwards.tracks[0]?.timing.duration).toBe(400);
  expect(backwards.tracks[0]?.timing.direction).toBe('reverse');
  expect(describeCapture(backwards)).toContain('moves left 100 px');
});

test('an animation that adds to the value under it is listed, not drawn wrong', async ({
  page,
}) => {
  await setUp(
    page,
    `.sp-add { width: 40px; height: 40px; background: blue; translate: 40px 0 }
     .sp-add.on { animation: sp-nudge .3s forwards; animation-composition: add }
     @keyframes sp-nudge { to { translate: 80px 0 } }`,
    '<div id="sp-compose"><div class="sp-add"></div></div>',
    '#sp-compose',
  );
  await page.evaluate(() => document.querySelector('.sp-add')?.classList.add('on'));
  await page.waitForTimeout(600);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks.filter((track) => track.origin !== 'layout')).toEqual([]);
  expect(capture.notShown.join(' ')).toContain('adds to the element');
});

test('a part moved along an offset-path carries its path, and the film sees it move', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-path { position: relative; width: 240px; height: 140px }
     .sp-dot { width: 20px; height: 20px; background: blue;
       offset-path: path('M 10 100 C 60 0, 160 0, 210 100'); offset-distance: 0% }
     .sp-dot.on { animation: sp-along .5s linear forwards }
     @keyframes sp-along { to { offset-distance: 100% } }`,
    '<div id="sp-path"><div class="sp-dot"></div></div>',
    '#sp-path',
  );
  await page.evaluate(() => document.querySelector('.sp-dot')?.classList.add('on'));
  await page.waitForTimeout(800);
  const capture = onlyCapture(await takesNow(page));
  const dot = flattenShapes(capture.root).find((shape) => shape.offset !== null);
  expect(dot?.offset?.points).toHaveLength(129);
  expect(dot?.offset?.points[0]).toEqual({ x: 10, y: 100 });
  expect(dot?.offset?.distance).toBe('0%');
  // At rest the dot sits on the path's start: its center at (10, 100).
  expect(dot?.transform?.[4]).toBeCloseTo(0, 0);
  expect(dot?.transform?.[5]).toBeCloseTo(90, 0);
  expect(capture.tracks.map((track) => track.property)).toContain('offset-distance');
  expect(describeCapture(capture)).toContain('moves along its path');
});

test('a view transition is read as its named part moving', async ({ page }) => {
  await setUp(
    page,
    '#sp-vt { width: 300px; height: 60px } .sp-moved { width: 40px; height: 40px; background: blue; view-transition-name: sp-moved }',
    '<div id="sp-vt"><button id="sp-go">Go</button><div class="sp-moved"></div></div>',
    '#sp-vt',
  );
  await page.evaluate(() =>
    document.getElementById('sp-go')?.addEventListener('click', () => {
      document.startViewTransition(() => {
        (document.querySelector('.sp-moved') as HTMLElement).style.marginLeft = '120px';
      });
    }),
  );
  await page.click('#sp-go');
  await page.waitForTimeout(1200);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.trigger).toBe('click');
  const move = capture.tracks.find((track) => track.property === 'translate');
  expect(move?.keyframes[0]?.value).toBe('0px 0px');
  expect(move?.keyframes[move.keyframes.length - 1]?.value).toBe('120px 0px');
  expect(capture.notShown.join(' ')).toContain('view transition');
});

test('a dot a script moves round its card with rect() is read as moving along its path', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-beam { position: relative; width: 200px; height: 100px; border: 2px solid #ddd }
     .sp-beam-dot { position: absolute; left: 0; top: 0; width: 12px; height: 12px; background: orange;
       offset-path: rect(0 auto auto 0 round 10px); offset-distance: 0% }`,
    '<div id="sp-beam"><div class="sp-beam-dot"></div></div>',
    '#sp-beam',
  );
  // As Motion does: the distance written every frame.
  await page.evaluate(() => {
    const dot = document.querySelector('.sp-beam-dot') as HTMLElement;
    const start = performance.now();
    const step = (now: number): void => {
      const done = Math.min((now - start) / 600, 1);
      dot.style.offsetDistance = `${done * 100}%`;
      if (done < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.waitForTimeout(1200);
  const capture = onlyCapture(await takesNow(page));
  const dot = flattenShapes(capture.root).find((shape) => shape.offset !== null);
  expect(dot?.offset?.closed).toBe(true);
  expect(capture.tracks.map((track) => `${track.origin}:${track.property}`)).toEqual([
    'script:offset-distance',
  ]);
});

test('a view transition that slides the new picture in is read as the part sliding', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-pages { width: 300px; height: 80px; view-transition-name: sp-pages; background: #eee }
     ::view-transition-new(sp-pages) { animation: sp-slide-in .4s ease-out }
     @keyframes sp-slide-in { from { translate: 300px 0 } }`,
    '<div id="sp-pages"><button id="sp-next">Next</button></div>',
    '#sp-pages',
  );
  await page.evaluate(() =>
    document.getElementById('sp-next')?.addEventListener('click', () => {
      document.startViewTransition(() => {
        (document.getElementById('sp-pages') as HTMLElement).style.background = '#ddd';
      });
    }),
  );
  await page.click('#sp-next');
  await page.waitForTimeout(1000);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks.map((track) => track.property)).toEqual(['translate']);
  expect(describeCapture(capture)).toContain('moves left 300 px');
  expect(capture.notShown.join(' ')).toContain('cross-fade');
});

test('a web component: slotted children are drawn, and a hidden popup in a nested shadow root is heard', async ({
  page,
}) => {
  await openFixtures(page);
  await page.evaluate(() => {
    class Popup extends HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML =
          '<style>.panel { display: none; width: 120px; height: 60px; background: white } :host([open]) .panel { display: block }</style><div class="panel"><slot></slot></div>';
      }
    }
    class Picker extends HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML =
          '<style>:host { display: block; width: 160px } button { width: 160px; height: 32px }</style><button><slot name="label"></slot></button><sp-popup><slot></slot></sp-popup>';
        root.querySelector('button')?.addEventListener('click', () => {
          const popup = root.querySelector('sp-popup') as HTMLElement;
          popup.setAttribute('open', '');
          popup.shadowRoot
            ?.querySelector('.panel')
            ?.animate({ opacity: [0, 1] }, { duration: 200, easing: 'ease-out' });
        });
      }
    }
    customElements.define('sp-popup', Popup);
    customElements.define('sp-picker', Picker);
    const picker = document.createElement('sp-picker');
    picker.innerHTML =
      '<span slot="label" style="display: inline-block; width: 60px; height: 12px; background: black"></span><div style="height: 20px; background: blue"></div>';
    document.body.prepend(picker);
    window.MotionCapture.record(picker);
  });
  await page.click('sp-picker');
  await page.waitForTimeout(600);
  const capture = onlyCapture(await takesNow(page));
  const labels = flattenShapes(capture.root).map((shape) => shape.label);
  // The slotted label is drawn inside the button.
  expect(labels).toContain('span');
  expect(capture.tracks.map((track) => track.property)).toEqual(['opacity']);
});

test('the clipping frame counts the translations between it and the element: nothing on screen is cut', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-bleed { position: relative; width: 400px; height: 200px; overflow: hidden }
     #sp-centred { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) }
     #sp-round { width: 80px; height: 80px; border-radius: 50%; background: black; transition: scale .2s }
     #sp-round.on { scale: 1.1 }`,
    '<div id="sp-bleed"><div id="sp-centred"><div id="sp-round"></div></div></div>',
    '#sp-round',
  );
  await page.evaluate(() => document.getElementById('sp-round')?.classList.add('on'));
  await page.waitForTimeout(500);
  const capture = onlyCapture(await takesNow(page));
  // The round part sits in the middle of its clipping parent, whole.
  expect(capture.frame).toEqual({ x: -160, y: -60, width: 400, height: 200 });
});

// ---------- What the take misses ----------

const smil = `<svg width="200" height="60"><rect id="sp-smil-rect" x="0" y="10" width="40" height="40" fill="green">
  <animate id="sp-smil" attributeName="x" from="0" to="140" dur="0.6s" begin="indefinite" fill="freeze"/>
</rect></svg>`;

test('a part that moves with no animation the browser lists is named as missed', async ({
  page,
}) => {
  await setUp(page, '#sp-miss { width: 220px }', `<div id="sp-miss">${smil}</div>`, '#sp-miss');
  await page.evaluate(() =>
    (document.getElementById('sp-smil') as unknown as { beginElement: () => void }).beginElement(),
  );
  await page.waitForTimeout(1500);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks).toEqual([]);
  expect(capture.missed).toEqual([{ label: 'rect', what: 'moved' }]);
  expect(describeCapture(capture)).toContain('1 part changed on the page that this preview misses');
});

// Its color, which no track and no layout measure can carry.
const smilFill = `<svg width="200" height="60"><rect x="0" y="10" width="40" height="40" fill="rgb(0, 128, 0)">
  <animate id="sp-smil-fill" attributeName="fill" from="rgb(0, 128, 0)" to="rgb(200, 0, 0)" dur="0.6s" begin="indefinite" fill="freeze"/>
</rect></svg>`;

test('alongside a transition, a look it cannot read is named and the transition is a track', async ({
  page,
}) => {
  await setUp(
    page,
    '#sp-both { width: 220px } .sp-fade { width: 40px; height: 20px; background: blue; transition: opacity .6s } .sp-fade.on { opacity: .2 }',
    `<div id="sp-both"><div class="sp-fade"></div>${smilFill}</div>`,
    '#sp-both',
  );
  await page.evaluate(() => {
    document.querySelector('.sp-fade')?.classList.add('on');
    (
      document.getElementById('sp-smil-fill') as unknown as { beginElement: () => void }
    ).beginElement();
  });
  await page.waitForTimeout(1500);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks.map((track) => track.property)).toContain('opacity');
  expect(capture.missed).toEqual([{ label: 'rect', what: 'look' }]);
});

test('a hover that changes a color at once, with no transition, is not called missed', async ({
  page,
}) => {
  await setUp(
    page,
    '#sp-flip { width: 120px; height: 40px; background: gray } #sp-flip:hover { background: black }',
    '<div id="sp-flip"></div>',
    '#sp-flip',
  );
  await page.hover('#sp-flip');
  await page.waitForTimeout(800);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(800);
  expect(await takesNow(page)).toEqual([]);
});

test('a ring mask is read as its two layers, and a repeating gradient as its stops', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-ring { position: relative; width: 200px; height: 80px; padding: 3px; border-radius: 12px;
       background: repeating-linear-gradient(90deg, rgb(0, 0, 255) 0 20px, rgb(255, 165, 0) 20px 40px);
       -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
       -webkit-mask-composite: xor; mask-composite: exclude; transition: opacity .2s }
     #sp-ring.on { opacity: .5 }`,
    '<div id="sp-ring"></div>',
    '#sp-ring',
  );
  await page.evaluate(() => document.getElementById('sp-ring')?.classList.add('on'));
  await page.waitForTimeout(600);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.root.mask?.map((layer) => [layer.composite, layer.area])).toEqual([
    ['exclude', { x: 3, y: 3, width: 194, height: 74 }],
    ['exclude', { x: 0, y: 0, width: 200, height: 80 }],
  ]);
  // Stripes, not their average: the stops repeat across the box.
  expect(capture.root.gradient?.stops.length).toBeGreaterThan(8);
  expect(capture.notShown.join(' ')).not.toContain('average of its colors');
});

test('a tooltip a hover opens at the end of the page is followed, and its take is a hover', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-tip-button { display: inline-block; width: 80px; height: 32px; background: #ddd }
     .sp-tip { position: fixed; left: 40px; top: 160px; width: 120px; height: 40px; background: #222;
       animation: sp-tip-in .3s ease-out }
     @keyframes sp-tip-in { from { opacity: 0; translate: 0 6px } }`,
    '<a id="sp-tip-button">Tip</a>',
    '#sp-tip-button',
  );
  // As Radix does: the tooltip appears a moment after the pointer arrives.
  await page.evaluate(() => {
    const button = document.getElementById('sp-tip-button') as HTMLElement;
    button.addEventListener('pointerenter', () =>
      window.setTimeout(() => {
        const tip = document.createElement('div');
        tip.className = 'sp-tip';
        document.body.append(tip);
      }, 300),
    );
  });
  await page.mouse.move(2, 2);
  await page.hover('#sp-tip-button');
  await page.waitForTimeout(900);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.root.label).toBe('div.sp-tip');
  expect(capture.trigger).toBe('hover');
  expect(capture.tracks.map((track) => track.property).sort()).toEqual(['opacity', 'translate']);
});

test('an arrow after a link, in the flow of its text, is drawn, moved and checked', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-more { font-size: 18px; color: rgb(37, 99, 235) }
     #sp-more::after { content: "→"; display: inline-block; margin-left: 6px; transition: transform .3s }
     #sp-more.on::after { transform: translateX(6px) }`,
    '<p><a id="sp-more" href="#">Learn more</a></p>',
    '#sp-more',
  );
  await page.evaluate(() => document.getElementById('sp-more')?.classList.add('on'));
  await page.waitForTimeout(700);
  const capture = onlyCapture(await takesNow(page));
  const arrow = flattenShapes(capture.root).find((shape) => shape.label === 'a::after');
  // Placed just past the text, with a bar for its glyph.
  const words = flattenShapes(capture.root).find((shape) => shape.kind === 'text');
  expect(arrow?.box.x).toBeGreaterThan((words?.box.x ?? 0) + (words?.box.width ?? 0));
  expect(arrow?.children.map((child) => child.kind)).toEqual(['text']);
  expect(capture.tracks.find((track) => track.shapeId === arrow?.id)?.property).toBe('transform');
  // Filmed, so the badge can check it.
  expect(capture.measured?.some((entry) => entry.shapeId === arrow?.id)).toBe(true);
});
