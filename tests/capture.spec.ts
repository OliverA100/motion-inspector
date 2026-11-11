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

// Found on Aceternity's logo: four 2 px corner dots were left out with the
// screen-reader text, and the check said they were missing.
test('a tiny dot that paints is drawn, unlike screen-reader text', async ({ page }) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const dot = document.createElement('span');
    dot.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px;background:#36f';
    document.querySelector('.fx-loader')?.append(dot);
  });
  const capture = onlyCapture(await captureFixture(page, 'loader', nothing, 500, false));
  expect(flattenShapes(capture.root).map((shape) => shape.kind)).toEqual(['box', 'box']);
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

// Found on MUI's demo toolbar: a click on "show code" fades in the toolbar
// beside it, so recording moves to their parent, where two buttons have
// shimmered since the page loaded. The click was named as already running
// and dropped; and the shimmer is not part of it.
test('a click that moves recording to a parent with an old loop in it is kept, without the loop', async ({
  page,
}) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      #sp-tools { display: flex; gap: 8px; padding: 8px; width: 320px }
      #sp-tools .sp-shimmer { width: 40px; height: 20px; background: linear-gradient(90deg, #eee, #ccc, #eee);
        background-size: 200% 100%; animation: sp-shimmer 2s linear infinite }
      @keyframes sp-shimmer { from { background-position: -100% 0 } to { background-position: 100% 0 } }
      #sp-tools .sp-bar { width: 60px; height: 20px; background: #36f; opacity: 0; transition: opacity .25s ease-out }
      #sp-tools.on .sp-bar { opacity: 1 }
      #sp-tools button { transition: background-color .15s } #sp-tools.on button { background-color: #ddd }`;
    document.head.append(style);
    const holder = document.createElement('div');
    holder.innerHTML =
      '<div id="sp-tools"><span class="sp-shimmer"></span><div class="sp-bar"></div><button id="sp-code">Code</button></div>';
    document.body.prepend(holder);
    document
      .getElementById('sp-code')
      ?.addEventListener('click', () => document.getElementById('sp-tools')?.classList.add('on'));
  });
  // The shimmer has run a while by the time anything is picked.
  await page.waitForTimeout(1300);
  await page.evaluate(() =>
    window.MotionCapture.record(document.getElementById('sp-code') as Element),
  );
  await page.click('#sp-code');
  await page.waitForTimeout(900);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.trigger).toBe('click');
  const properties = capture.tracks.map((track) => track.property);
  expect(properties).toContain('opacity');
  expect(properties.filter((property) => property.startsWith('background-position'))).toEqual([]);
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

// Found on Figma: an icon that is an <svg> in the page, moved by
// translate: 0 -50%, which is half its CSS box (not half its drawing).
test('a percentage on an svg in the page is of its box, in its film too', async ({ page }) => {
  await setUp(
    page,
    `#sp-icon-box { width: 60px; height: 40px; padding-top: 20px }
     #sp-icon-box svg { display: block; width: 20px; height: 20px; translate: 0 -50%; opacity: 0; transition: opacity .2s }
     #sp-icon-box.on svg { opacity: 1 }`,
    '<div id="sp-icon-box"><svg viewBox="0 0 20 20"><path d="M4 4 L16 10 L4 16 Z"></path></svg></div>',
    '#sp-icon-box',
  );
  await page.evaluate(() => document.getElementById('sp-icon-box')?.classList.add('on'));
  await page.waitForTimeout(600);
  const capture = onlyCapture(await takesNow(page));
  const film = capture.measured?.[0]?.frames ?? [];
  expect(film.length).toBeGreaterThan(1);
  for (const frame of film) expect(frame.matrix[5]).toBeCloseTo(-10, 1);
});

// Found on Cal: a menu fades out, and at the same moment a class shrinks it
// to 0.95 with no transition. Its fade is a track; the shrink, seen only in
// its film, is measured too.
test('a jump with no transition on a part that also fades is measured from its film', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-menu-box { width: 200px; height: 120px }
     .sp-menu { width: 160px; height: 100px; background: #36f; transition: opacity .3s }
     .sp-menu.closing { opacity: 0; scale: 0.5 }`,
    '<div id="sp-menu-box"><div class="sp-menu"></div></div>',
    '#sp-menu-box',
  );
  await page.evaluate(() => document.querySelector('.sp-menu')?.classList.add('closing'));
  await page.waitForTimeout(800);
  const capture = onlyCapture(await takesNow(page));
  const properties = capture.tracks.map((item) => `${item.origin}:${item.property}`);
  expect(properties).toContain('css-transition:opacity');
  expect(properties).toContain('script:transform');
});

// Found on Attio: a button lit on hover by a registered color variable that
// a radial gradient uses. Chrome lists the variable, which cannot be drawn;
// the gradient it changes is filmed and drawn in its colors now.
test('a radial gradient lit by a variable on hover is filmed, not listed as not drawn', async ({
  page,
}) => {
  await setUp(
    page,
    `@property --sp-glow { syntax: "<color>"; inherits: false; initial-value: rgb(32, 33, 36); }
     #sp-lit { width: 120px; height: 40px; transition: --sp-glow .3s;
       background-image: radial-gradient(at 50% -10%, var(--sp-glow) 0%, rgb(10, 10, 10) 100%) }
     #sp-lit.on { --sp-glow: rgb(80, 89, 103) }`,
    '<div id="sp-lit"></div>',
    '#sp-lit',
  );
  await page.evaluate(() => document.getElementById('sp-lit')?.classList.add('on'));
  await page.waitForTimeout(800);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks.map((item) => `${item.origin}:${item.property}`)).toEqual([
    'script:background-image',
  ]);
  const last = capture.tracks[0]?.keyframes.at(-1)?.value ?? '';
  expect(last).toMatch(/^radial-gradient\(.*rgb\(80, 89, 103\)/);
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
  // The whole run of restarts, measured: not only the last one, which began
  // where the others left it (found on Railway).
  expect(notes.join(' ')).toContain('Its motion is measured from the page instead.');
  const kept = takes.flatMap((take) => (take.capture === null ? [] : [take.capture]));
  const moved = kept.flatMap((capture) => capture.tracks).find((item) => item.origin === 'script');
  expect(moved?.property).toBe('transform');
  const last = moved?.keyframes.at(-1)?.value ?? '';
  expect(Number.parseFloat(/translate\((-?[\d.]+)px/.exec(last)?.[1] ?? '0')).toBeGreaterThan(15);
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

// Found on Aceternity's logo: its text springs aside when the pointer
// arrives, and settles while the pointer is still. A lag fitted to that
// fits, but nothing follows the pointer.
test('a spring the pointer sets off by arriving is motion, not following', async ({ page }) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const holder = document.createElement('div');
    holder.innerHTML =
      '<a id="sp-spring" style="display:inline-block;padding:10px 20px;background:#eee"><span style="display:inline-block">Home</span></a>';
    document.body.prepend(holder);
    const label = holder.querySelector('#sp-spring span') as HTMLElement;
    holder.querySelector('#sp-spring')?.addEventListener('pointerenter', () => {
      let x = 0;
      const step = (): void => {
        x += (8 - x) * 0.08;
        label.style.transform = `translateX(${x}px)`;
        if (8 - x > 0.05) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    window.MotionCapture.record(document.getElementById('sp-spring') as Element);
  });
  const box = await page.locator('#sp-spring').boundingBox();
  if (box === null) throw new Error('no link');
  await page.mouse.move(box.x - 20, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.waitForTimeout(1500);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.follows).toBeNull();
  expect(capture.tracks.map((item) => `${item.origin}:${item.property}`)).toEqual([
    'script:transform',
  ]);
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

// A canvas or a video makes its pictures frame by frame: nothing the
// recorder reads. The panel says so when a recording finds nothing.
test('a picked part that holds a canvas or a video says so; a tiny one does not', async ({
  page,
}) => {
  await openFixtures(page);
  const draws = await page.evaluate(() => {
    const holder = document.createElement('div');
    holder.innerHTML =
      '<div id="sp-chart"><canvas width="200" height="80"></canvas></div><div id="sp-film"><video width="160" height="90"></video></div><div id="sp-dot"><canvas width="4" height="4"></canvas></div>';
    document.body.prepend(holder);
    const read = (id: string): unknown => {
      window.MotionCapture.record(document.getElementById(id) as Element);
      window.MotionCapture.stop();
      return window.MotionCapture.drawsItself();
    };
    return [read('sp-chart'), read('sp-film'), read('sp-dot')];
  });
  expect(draws).toEqual(['canvas', 'video', null]);
});

// Found on Shoelace: the tooltip's bubble animates in its host's shadow
// root, outside the picked button, where document.getAnimations() does not
// look.
test('a tooltip bubble in the shadow root around the picked button is followed', async ({
  page,
}) => {
  await openFixtures(page);
  await page.evaluate(() => {
    customElements.define(
      'sp-tip',
      class extends HTMLElement {
        connectedCallback(): void {
          const root = this.attachShadow({ mode: 'open' });
          root.innerHTML = `<slot></slot><div role="tooltip" style="display:none;position:absolute;top:40px;left:0;width:120px;height:30px;background:#333"></div>`;
          const bubble = root.querySelector('[role=tooltip]') as HTMLElement;
          this.addEventListener('pointerenter', () => {
            bubble.style.display = 'block';
            bubble.animate({ opacity: [0, 1], scale: [0.8, 1] }, { duration: 200 });
          });
        }
      },
    );
    const holder = document.createElement('div');
    holder.style.cssText = 'position:relative;padding:20px';
    holder.innerHTML = '<sp-tip><button id="sp-tip-button">Info</button></sp-tip>';
    document.body.prepend(holder);
    window.MotionCapture.record(document.getElementById('sp-tip-button') as Element);
  });
  await page.hover('#sp-tip-button');
  await page.waitForTimeout(700);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks.map((track) => track.property).sort()).toEqual(['opacity', 'scale']);
});

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

// Found on Radix's search dialog: an overlay dims the page with a ::after,
// and its content, a flex item at z-index 1 with no position, is drawn over
// it. The ::after, measured as its fade began, rests at full opacity.
test('a flex item with a z-index is drawn over the ::after of an overlay, which rests where it ends', async ({
  page,
}) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      #sp-overlay { position: fixed; inset: 0; display: none; justify-content: center }
      #sp-overlay.open { display: flex }
      #sp-overlay::after { content: ""; position: absolute; inset: 0; background: rgba(0, 0, 0, .4) }
      #sp-overlay.open::after { animation: sp-dim .4s ease-out }
      @keyframes sp-dim { from { opacity: 0 } }
      #sp-overlay .sp-content { z-index: 1; width: 200px; height: 40px; margin: 20px; background: white }
      #sp-overlay.open .sp-content { animation: sp-dim .2s ease-out }`;
    document.head.append(style);
    // The overlay at the end of the page, as a portal puts it.
    const holder = document.createElement('div');
    holder.innerHTML = '<button id="sp-search">Search</button>';
    document.body.prepend(holder);
    const portal = document.createElement('div');
    portal.innerHTML = '<div id="sp-overlay"><div class="sp-content" role="dialog"></div></div>';
    document.body.append(portal);
    document.getElementById('sp-search')?.addEventListener('click', () => {
      document.getElementById('sp-overlay')?.classList.add('open');
    });
    window.MotionCapture.record(document.getElementById('sp-search') as Element);
  });
  await page.click('#sp-search');
  await page.waitForTimeout(1000);
  const capture = onlyCapture(await takesNow(page));
  const labels = capture.root.children.map((child) => child.label);
  expect(labels).toEqual(['div.open::after', 'div.sp-content']);
  expect(capture.root.children[0]?.opacity).toBe(1);
  expect(capture.root.children[0]?.opacity).toBe(1);
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

// Found on Aceternity's logo: a script turns it about x and z under a
// parent's perspective. Flattened, that is a lean as well as a turn.
test('a part a script turns in 3D keeps its lean when flattened', async ({ page }) => {
  await setUp(
    page,
    `#sp-tilt { perspective: 1200px; transform-style: preserve-3d; padding: 20px; width: 80px }
     .sp-tilt-face { width: 40px; height: 40px; background: #36f }`,
    '<div id="sp-tilt"><div class="sp-tilt-face"></div></div>',
    '#sp-tilt',
  );
  await page.evaluate(() => {
    const face = document.querySelector('.sp-tilt-face') as HTMLElement;
    const start = performance.now();
    const step = (now: number): void => {
      const done = Math.min((now - start) / 500, 1);
      face.style.transform = `rotateX(${done * 40}deg) rotateZ(${-done * 40}deg)`;
      if (done < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.waitForTimeout(1200);
  const capture = onlyCapture(await takesNow(page));
  const turn = track(capture, 'transform');
  const last = turn.keyframes[turn.keyframes.length - 1]?.value ?? '';
  expect(last).toContain('skewX(');
  const seen = capture.measured?.[0]?.frames.at(-1)?.matrix ?? [];
  const drawn = await page.evaluate((value) => {
    const m = new DOMMatrix(value);
    return [m.a, m.b, m.c, m.d];
  }, last);
  drawn.forEach((value, index) => expect(Math.abs(value - (seen[index] ?? 0))).toBeLessThan(0.01));
  expect(capture.notShown).toContain(
    'A script turns div.sp-tilt-face in 3D. It is shown flat, as it looks on the page.',
  );
});

// Found on Duolingo: Lottie shows and hides layers in single writes,
// seconds apart. Between writes the part holds still; a straight line
// between them would be a slow fade the page never showed.
test('a part a script dims and restores later holds still in between', async ({ page }) => {
  await setUp(
    page,
    '.sp-held, .sp-moving { width: 40px; height: 40px; background: #36f }',
    '<div id="sp-held-box"><div class="sp-held"></div><div class="sp-moving"></div></div>',
    '#sp-held-box',
  );
  await page.evaluate(() => {
    const part = document.querySelector('.sp-held') as HTMLElement;
    setTimeout(() => (part.style.opacity = '0.3'), 50);
    setTimeout(() => (part.style.opacity = '1'), 650);
    // Another part moves all the while, as a Lottie drawing's others do.
    const moving = document.querySelector('.sp-moving') as HTMLElement;
    const start = performance.now();
    const step = (now: number): void => {
      const done = Math.min((now - start) / 800, 1);
      moving.style.transform = `translateX(${done * 80}px)`;
      if (done < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.waitForTimeout(1300);
  const capture = onlyCapture(await takesNow(page));
  const fade = track(capture, 'opacity');
  // Still dim just before it is restored.
  const late = fade.keyframes.filter((keyframe) => keyframe.offset > 0.8 && keyframe.offset < 1);
  expect(late.map((keyframe) => keyframe.value)).toContain('0.3');
});

// An icon whose outline morphs through the d property: the preview draws
// the outline as it is at each moment.
test('a path whose outline morphs is drawn as it is now', async ({ page }) => {
  await setUp(
    page,
    `#sp-morph { width: 100px }
     #sp-morph path { d: path("M10 10 L90 10 L90 90 L10 90 Z"); transition: d .4s linear }
     #sp-morph.on path { d: path("M50 5 L95 50 L50 95 L5 50 Z") }`,
    '<div id="sp-morph"><svg width="100" height="100" viewBox="0 0 100 100"><path fill="#e55"></path></svg></div>',
    '#sp-morph',
  );
  await page.evaluate(() => document.getElementById('sp-morph')?.classList.add('on'));
  await page.waitForTimeout(800);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks.map((item) => item.property)).toEqual(['d']);
  const halfway = await page.evaluate(async (taken) => {
    const path = '/src/probeCheck.ts';
    const module = (await import(/* @vite-ignore */ path)) as {
      posesOf: (capture: unknown, timeMs: number) => { d: string | null }[];
    };
    return module.posesOf(taken, 200).map((pose) => pose.d);
  }, capture);
  expect(halfway).toEqual(['M 30 7.5 L 92.5 30 L 70 92.5 L 7.5 70 Z']);
});

// Found on CSS-Tricks: an avatar brought in front of the ones it overlaps.
test('a part whose z-index rises is drawn in front of its siblings', async ({ page }) => {
  await setUp(
    page,
    `#sp-stack { display: flex; width: 160px }
     #sp-stack div { position: relative; z-index: 0; width: 60px; height: 60px; margin-right: -20px; transition: z-index .3s }
     #sp-stack .front { z-index: 5 }`,
    '<div id="sp-stack"><div style="background:#e55" id="sp-first"></div><div style="background:#36f"></div></div>',
    '#sp-stack',
  );
  await page.evaluate(() => document.getElementById('sp-first')?.classList.add('front'));
  await page.waitForTimeout(700);
  const capture = onlyCapture(await takesNow(page));
  expect(describeCapture(capture)).toContain('comes in front of the parts beside it');
  const late = await page.evaluate(async (taken) => {
    const path = '/src/probeCheck.ts';
    const module = (await import(/* @vite-ignore */ path)) as {
      posesOf: (capture: unknown, timeMs: number) => { zIndex: number | null }[];
    };
    return module.posesOf(taken, 280).map((pose) => pose.zIndex);
  }, capture);
  expect(late.some((value) => value !== null && value > 0)).toBe(true);
});

// Frosted glass: a card that blurs what is behind it on hover.
test('a backdrop blur is previewed, not listed as not drawn', async ({ page }) => {
  await setUp(
    page,
    `#sp-glass { width: 200px; height: 80px; background: rgba(255, 255, 255, 0.2);
       backdrop-filter: blur(0px); transition: backdrop-filter .4s linear }
     #sp-glass.on { backdrop-filter: blur(12px) }`,
    '<div id="sp-glass"></div>',
    '#sp-glass',
  );
  await page.evaluate(() => document.getElementById('sp-glass')?.classList.add('on'));
  await page.waitForTimeout(800);
  const capture = onlyCapture(await takesNow(page));
  const halfway = await page.evaluate(async (taken) => {
    const path = '/src/probeCheck.ts';
    const module = (await import(/* @vite-ignore */ path)) as {
      posesOf: (capture: unknown, timeMs: number) => { backdropFilter: string | null }[];
    };
    return module.posesOf(taken, 200).map((pose) => pose.backdropFilter);
  }, capture);
  expect(halfway).toEqual(['blur(6px)']);
});

// Found on Arc: a link whose underline shows on hover, by its color. The
// underline is kept with the link even while it cannot be seen.
test('an underline that shows on hover is kept, previewed and said', async ({ page }) => {
  await setUp(
    page,
    `#sp-ulink { text-decoration: underline 2px; text-decoration-color: transparent;
       transition: text-decoration-color .3s }
     #sp-ulink.on { text-decoration-color: rgb(51, 102, 255) }`,
    '<a id="sp-ulink">Pricing and plans</a>',
    '#sp-ulink',
  );
  await page.evaluate(() => document.getElementById('sp-ulink')?.classList.add('on'));
  await page.waitForTimeout(700);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.root.underline).toEqual({ color: 'rgba(0, 0, 0, 0)', thickness: 2 });
  expect(describeCapture(capture)).toContain('shows its underline in blue');
});

// Found on Retool: an underline drawn in on hover by growing the size of a
// gradient that does not repeat. Drawn only where its tile is.
test('an underline drawn in by background-size is previewed and said in words', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-uline { display: inline-block; padding-bottom: 4px; transition: background-size .4s linear;
       background: linear-gradient(#e55, #e55) no-repeat 0 100% / 0% 2px }
     #sp-uline.on { background-size: 100% 2px }`,
    '<a id="sp-uline">Read the docs</a>',
    '#sp-uline',
  );
  await page.evaluate(() => document.getElementById('sp-uline')?.classList.add('on'));
  await page.waitForTimeout(800);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.root.gradient?.tile).toMatchObject({ width: 0, height: 2 });
  expect(describeCapture(capture)).toContain('widens its background from 0% to 100%');
  const halfway = await page.evaluate(async (taken) => {
    const path = '/src/probeCheck.ts';
    const module = (await import(/* @vite-ignore */ path)) as {
      posesOf: (capture: unknown, timeMs: number) => { backgroundSize: string | null }[];
    };
    return module.posesOf(taken, 200).map((pose) => pose.backgroundSize);
  }, capture);
  expect(halfway).toEqual(['50% 2px']);
});

// GSAP and Lottie move SVG parts by writing their transform and opacity
// attributes every frame, not their style.
test('an SVG group a script turns by its transform attribute is filmed, and said as a turn in place', async ({
  page,
}) => {
  await setUp(
    page,
    '#sp-svg-turn { width: 100px }',
    `<div id="sp-svg-turn"><svg width="100" height="100" viewBox="0 0 100 100"><g id="sp-svg-g">
       <path d="M20 20 L80 20 L80 80 L20 80 Z" fill="#e55"></path></g></svg></div>`,
    '#sp-svg-turn',
  );
  await page.evaluate(() => {
    const group = document.getElementById('sp-svg-g') as Element;
    const start = performance.now();
    const step = (now: number): void => {
      const done = Math.min((now - start) / 500, 1);
      const turn = (done * Math.PI) / 2;
      const [c, s] = [Math.cos(turn), Math.sin(turn)];
      group.setAttribute(
        'transform',
        `matrix(${c},${s},${-s},${c},${50 - 50 * c + 50 * s},${50 - 50 * s - 50 * c})`,
      );
      group.setAttribute('opacity', String(1 - done / 2));
      if (done < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.waitForTimeout(1100);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks.map((track) => `${track.origin}:${track.property}`).sort()).toEqual([
    'script:opacity',
    'script:transform',
  ]);
  expect(describeCapture(capture)).toContain('"g" shape rotates 90 degrees and fades');
});

test('a script that adds translateZ(0) to get a layer is not said to turn in 3D', async ({
  page,
}) => {
  await setUp(
    page,
    '.sp-layer { width: 40px; height: 40px; background: #36f }',
    '<div id="sp-layer-box"><div class="sp-layer"></div></div>',
    '#sp-layer-box',
  );
  await page.evaluate(() => {
    const part = document.querySelector('.sp-layer') as HTMLElement;
    const start = performance.now();
    const step = (now: number): void => {
      const done = Math.min((now - start) / 400, 1);
      part.style.transform = `translateX(${done * 60}px) translateZ(0)`;
      if (done < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.waitForTimeout(1000);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks.map((track) => track.property)).toEqual(['transform']);
  expect(capture.notShown.join(' ')).not.toContain('in 3D');
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

// A script that steps a part through classes with no transition: no
// animation the browser lists, and nothing written to its style.
async function stepClasses(page: Page, selector: string, classes: string[]): Promise<void> {
  await page.evaluate(
    async ([target, names]) => {
      const part = document.querySelector(target) as HTMLElement;
      for (const name of names) {
        part.classList.remove(...names);
        part.classList.add(name);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },
    [selector, classes] as const,
  );
}

test('a part that moves with no animation the browser lists is named as missed', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-miss { width: 220px; height: 60px }
     .sp-step { width: 40px; height: 40px; background: green }
     .sp-step.a { transform: translateX(40px) } .sp-step.b { transform: translateX(80px) }
     .sp-step.c { transform: translateX(120px) }`,
    '<div id="sp-miss"><div class="sp-step"></div></div>',
    '#sp-miss',
  );
  await stepClasses(page, '.sp-step', ['a', 'b', 'c']);
  await page.waitForTimeout(800);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks).toEqual([]);
  expect(capture.missed).toEqual([{ label: 'div.sp-step', what: 'moved' }]);
  expect(describeCapture(capture)).toContain('1 part changed on the page that this preview misses');
});

test('alongside a transition, a look it cannot read is named and the transition is a track', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-both { width: 220px } .sp-fade { width: 40px; height: 20px; background: blue; transition: opacity .6s }
     .sp-fade.on { opacity: .2 }
     .sp-swatch { width: 40px; height: 40px; background: rgb(0, 128, 0) }
     .sp-swatch.a { background: rgb(100, 60, 0) } .sp-swatch.b { background: rgb(200, 0, 0) }
     .sp-swatch.c { background: rgb(200, 0, 120) }`,
    '<div id="sp-both"><div class="sp-fade"></div><div class="sp-swatch"></div></div>',
    '#sp-both',
  );
  await page.evaluate(() => document.querySelector('.sp-fade')?.classList.add('on'));
  await stepClasses(page, '.sp-swatch', ['a', 'b', 'c']);
  await page.waitForTimeout(600);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks.map((track) => track.property)).toContain('opacity');
  expect(capture.missed).toEqual([{ label: 'div.sp-swatch', what: 'look' }]);
});

// An SVG animation (SMIL) moves a part: no animation API lists it, so it is
// filmed each frame and fitted, as a script's motion is.
const smil = `<svg width="200" height="60"><rect id="sp-smil-rect" x="0" y="10" width="40" height="40" fill="green">
  <animate id="sp-smil" attributeName="x" from="0" to="140" dur="0.6s" begin="indefinite" fill="freeze"/>
</rect></svg>`;

test('a part an SVG animation (SMIL) moves is filmed, not missed', async ({ page }) => {
  await setUp(
    page,
    '#sp-smil-box { width: 220px }',
    `<div id="sp-smil-box">${smil}</div>`,
    '#sp-smil-box',
  );
  await page.evaluate(() =>
    (document.getElementById('sp-smil') as unknown as { beginElement: () => void }).beginElement(),
  );
  await page.waitForTimeout(1500);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.missed).toBeNull();
  expect(capture.tracks.map((track) => `${track.origin}:${track.property}`)).toEqual([
    'script:transform',
  ]);
  expect(describeCapture(capture)).toContain('moves right 140 px');
});

// A spinner's pulse that SMIL repeats forever: one turn is filmed, from the
// start of the turn, and shown repeating.
test('an SVG animation that repeats forever is one turn, repeating', async ({ page }) => {
  await setUp(
    page,
    '#sp-pulse { width: 120px }',
    `<div id="sp-pulse"><svg width="100" height="100"><circle cx="50" cy="50" r="20" fill="#36f">
       <animate attributeName="r" values="20;40;20" dur="0.8s" repeatCount="indefinite"/></circle></svg></div>`,
    '#sp-pulse',
  );
  await page.waitForTimeout(1600);
  const capture = onlyCapture(await takesNow(page));
  const pulse = track(capture, 'transform');
  expect(pulse.timing.iterations).toEqual({ kind: 'infinite' });
  expect(pulse.timing.duration).toBe(800);
  expect(describeCapture(capture)).toContain('scales to 2 and back over 800 ms');
});

// <animateMotion> moves a part along a path: not in the computed style, but
// in the matrix the browser places the part with.
test('a part an SVG animation moves along a path is filmed', async ({ page }) => {
  await setUp(
    page,
    '#sp-along { width: 220px }',
    `<div id="sp-along"><svg width="200" height="60"><circle cx="0" cy="30" r="8" fill="#36f">
       <animateMotion id="sp-along-move" path="M10 0 L170 0" dur="0.6s" begin="indefinite" fill="freeze"/></circle></svg></div>`,
    '#sp-along',
  );
  await page.evaluate(() =>
    (
      document.getElementById('sp-along-move') as unknown as { beginElement: () => void }
    ).beginElement(),
  );
  await page.waitForTimeout(1400);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.missed).toBeNull();
  expect(describeCapture(capture)).toContain('moves right 170 px');
});

// From svg-spinners' pulse: a circle that grows from r="0", so it has no
// outline at rest. It is drawn at the largest size its animation reaches,
// and its loop jumps back to nothing each turn.
test('an SVG pulse growing from nothing is drawn at its largest and scales from 0', async ({
  page,
}) => {
  await setUp(
    page,
    '#sp-grow { width: 60px }',
    `<div id="sp-grow"><svg width="48" height="48" viewBox="0 0 24 24"><circle cx="12" cy="12" r="0">
       <animate attributeName="r" dur="0.8s" values="0;11" repeatCount="indefinite"/>
       <animate attributeName="opacity" dur="0.8s" values="1;0" repeatCount="indefinite"/></circle></svg></div>`,
    '#sp-grow',
  );
  await page.waitForTimeout(1600);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.missed).toBeNull();
  expect(describeCapture(capture)).toContain(
    'scales from 0 to 1 and fades from 100% to 0% over 800 ms',
  );
});

// A number counting up, written by a script: the text changes, and text is
// never copied. Said as that, not as a part gone missing.
test('text a script changes is named as text, not as a missing part', async ({ page }) => {
  await setUp(
    page,
    '#sp-count { padding: 8px; font: 600 28px system-ui }',
    '<div id="sp-count"><span>0</span></div>',
    '#sp-count',
  );
  await page.evaluate(() => {
    const number = document.querySelector('#sp-count span') as HTMLElement;
    const start = performance.now();
    const step = (now: number): void => {
      const done = Math.min((now - start) / 600, 1);
      number.textContent = String(Math.round(done * 1234));
      if (done < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.waitForTimeout(1400);
  const takes = await takesNow(page);
  const missed = takes.flatMap((take) => take.capture?.missed ?? []);
  expect(missed).toEqual([{ label: 'span', what: 'text' }]);
});

// Found on GitHub: an item in a marquee, hovered. The marquee carries it
// along all the while: that is not motion of the item the preview misses.
test('an item a marquee carries along is not called missed when hovered', async ({ page }) => {
  await openFixtures(page);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      #sp-strip { width: 300px; overflow: hidden }
      #sp-track { display: flex; gap: 10px; width: max-content; animation: sp-scroll 3s linear infinite }
      @keyframes sp-scroll { to { transform: translateX(-200px) } }
      #sp-track li { list-style: none; width: 60px; height: 30px; background: #ddd; transition: background-color .2s }
      #sp-track li.on { background: #36f }`;
    document.head.append(style);
    const holder = document.createElement('div');
    holder.innerHTML =
      '<div id="sp-strip"><ul id="sp-track"><li></li><li id="sp-item"></li><li></li></ul></div>';
    document.body.prepend(holder);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const item = document.getElementById('sp-item') as Element;
    window.MotionCapture.record(item);
    item.classList.add('on');
  });
  await page.waitForTimeout(800);
  const capture = onlyCapture(await takesNow(page));
  expect(capture.tracks.map((item) => item.property)).toEqual(['background-color']);
  expect(capture.missed).toBeNull();
});

// The picked element's own text counting up, in a block that keeps its size.
test('a block whose own text counts up is named as text', async ({ page }) => {
  await setUp(
    page,
    '#sp-total { font: 600 28px system-ui }',
    '<div id="sp-total">0</div>',
    '#sp-total',
  );
  await page.evaluate(() => {
    const total = document.getElementById('sp-total') as HTMLElement;
    const start = performance.now();
    const step = (now: number): void => {
      const done = Math.min((now - start) / 600, 1);
      total.textContent = String(Math.round(done * 1234));
      if (done < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.waitForTimeout(1400);
  const takes = await takesNow(page);
  expect(takes.flatMap((take) => take.capture?.missed ?? [])).toEqual([
    { label: 'div', what: 'text' },
  ]);
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

test('a dialog on the page all along, shown by a class, is followed from its button', async ({
  page,
}) => {
  await setUp(
    page,
    `#sp-modal { position: fixed; inset: 0; background: rgb(0 0 0 / .4); opacity: 0; visibility: hidden;
       transition: opacity .25s, visibility 0s linear .25s }
     #sp-modal.show { opacity: 1; visibility: visible; transition: opacity .25s, visibility 0s }
     #sp-modal .sp-panel { width: 200px; height: 120px; margin: 60px auto; background: white;
       translate: 0 -20px; transition: translate .25s ease-out }
     #sp-modal.show .sp-panel { translate: 0 0 }`,
    `<button id="sp-launch" onclick="document.getElementById('sp-modal').classList.add('show')">Open</button>
     <div id="sp-modal"><div class="sp-panel" role="dialog" aria-modal="true">Hi</div></div>`,
    '#sp-launch',
  );
  await page.click('#sp-launch');
  await page.waitForTimeout(800);
  const capture = onlyCapture(await takesNow(page));
  // The fixed layer around the dialog, with the dialog inside it.
  expect(capture.root.label).toBe('div');
  expect(capture.tracks.map((track) => track.property).sort()).toEqual(['opacity', 'translate']);
  expect(capture.trigger).toBe('click');
});
