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
  // The spinner has one blue side. A shape has one border color, so the
  // capture says what that costs instead of hiding it.
  expect(capture.notShown).toEqual([
    'A border with a different color on each side is drawn in one color, so a rotation of that shape may not be visible in the preview.',
  ]);
  expect(describeCapture(capture)).toBe(
    'The element rotates 360 degrees over 900 ms. It moves at a steady speed. It repeats forever. 1 thing is left out of this preview.',
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
    { kind: 'percent', value: 50 },
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

test('an animation on a pseudo-element is listed, not drawn', async ({ page }) => {
  const capture = onlyCapture(await captureFixture(page, 'pseudo', hover, 700));
  expect(capture.tracks).toEqual([]);
  expect(capture.notShown).toEqual([
    'An animation on ::after of span.fx-pseudo is not shown, because it runs on a pseudo-element, which has no shape of its own.',
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

test('an interrupted hover is two takes, and the shortened one is marked', async ({ page }) => {
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

  expect(takes).toHaveLength(2);
  const hoverIn = captureOf(takes[0]);
  const hoverOut = captureOf(takes[1]);
  expect(track(hoverIn, 'transform')).toMatchObject({ interrupted: false });
  expect(track(hoverIn, 'transform').timing.duration).toBe(180);

  const back = track(hoverOut, 'transform');
  expect(back.interrupted).toBe(true);
  expect(back.timing.duration).toBeGreaterThan(0);
  expect(back.timing.duration).toBeLessThan(180);
  // It starts from where the first one had got to.
  expect(back.keyframes[0]?.value).toMatch(/^translateY\(-[\d.]+px\)$/);
  expect(back.keyframes[1]?.value).toBe('none');
  expect(describeCapture(hoverOut)).toContain('The browser shortened this transition');
});

test('a hover already under way when recording starts, and its hover-out, are two takes', async ({
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
  // Never one take holding both the hover and its hover-out.
  for (const take of takes) {
    const transforms = captureOf(take).tracks.filter((item) => item.property === 'transform');
    expect(transforms.length).toBeLessThanOrEqual(1);
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
