// Click triggers for the fixtures page.
// Hover fixtures need no script. Everything here is plain DOM on purpose:
// the fixtures should look like code found on real sites.

function fixture(name: string): HTMLElement {
  const section = document.querySelector<HTMLElement>(`[data-fixture="${name}"]`);
  if (section === null) throw new Error(`Fixture not found: ${name}`);
  return section;
}

function onTrigger(section: HTMLElement, trigger: string, run: () => void): void {
  const button = section.querySelector<HTMLElement>(`[data-trigger="${trigger}"]`);
  if (button === null) throw new Error(`Trigger not found: ${trigger}`);
  button.addEventListener('click', run);
}

function inside(section: HTMLElement, selector: string): HTMLElement {
  const element = section.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Element not found: ${selector}`);
  return element;
}

// Restart a CSS animation that is started by a class.
function replayClass(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  void element.offsetWidth; // flush styles so the browser sees the class go away
  element.classList.add(className);
}

// 3. Staggered list
const list = fixture('stagger-list');
onTrigger(list, 'toggle', () => {
  inside(list, '.fx-list').classList.toggle('is-open');
});

// 5. Bounce
const bounce = fixture('bounce');
onTrigger(bounce, 'play', () => {
  replayClass(inside(bounce, '.fx-ball'), 'is-playing');
});

// 6. Steps
const steps = fixture('steps');
onTrigger(steps, 'play', () => {
  replayClass(inside(steps, '.fx-steps'), 'is-playing');
});

// 11. Pop in
const pop = fixture('pop');
onTrigger(pop, 'play', () => {
  replayClass(inside(pop, '.fx-pop'), 'is-playing');
});

// 8. element.animate(), three variants
const waapi = fixture('web-animation');
const waapiBox = inside(waapi, '.fx-waapi');

// Both keyframes given. Easing on the effect and on the first keyframe,
// so the spike shows where Chrome reports each.
onTrigger(waapi, 'both-ends', () => {
  waapiBox.animate(
    [
      { transform: 'translateX(0px) scale(1)', opacity: 0.9, easing: 'ease-in' },
      { transform: 'translateX(48px) scale(1.2)', opacity: 0.4 },
    ],
    { duration: 600, easing: 'cubic-bezier(0.2, 0, 0, 1)', direction: 'alternate', iterations: 2 },
  );
});

// Only the end keyframe. The start is the element's resting style.
onTrigger(waapi, 'start-missing', () => {
  waapiBox.animate({ transform: 'translateX(48px)' }, { duration: 600, easing: 'ease-in-out' });
});

// Only the start keyframe. The end is the element's resting style (opacity 0.9).
onTrigger(waapi, 'end-missing', () => {
  waapiBox.animate([{ opacity: 0.2, offset: 0 }], { duration: 600 });
});

// 13. Shadow root. A small custom element whose markup and styles live in
// an open shadow root, the way component libraries ship them.
class ShadowCard extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .card {
          width: 120px;
          height: 56px;
          border-radius: 8px;
          background: #2f6fed;
          transition: transform 300ms ease-out;
        }
        .card:hover {
          transform: translateY(-4px);
        }
      </style>
      <div class="card"></div>
    `;
  }
}
customElements.define('fx-shadow-card', ShadowCard);

// 15. Panel. The same steps Bootstrap's collapse takes: show it, animate
// its height from 0 to its full height with overflow hidden, then clean up.
const panelFixture = fixture('panel');
const panel = inside(panelFixture, '.fx-panel');
onTrigger(panelFixture, 'toggle', () => {
  const opening = !panel.classList.contains('is-open');
  const done = (): void => {
    panel.classList.remove('is-moving');
    if (!opening) panel.classList.remove('is-open');
    panel.style.height = '';
  };
  if (opening) {
    panel.classList.add('is-open');
    panel.style.height = '0px';
  } else {
    panel.style.height = `${panel.offsetHeight}px`;
  }
  void panel.offsetWidth;
  panel.classList.add('is-moving');
  panel.style.height = opening ? `${panel.scrollHeight}px` : '0px';
  panel.addEventListener('transitionend', done, { once: true });
});

// 16. Icon button. After the first hover, the outgoing arrow rests at
// "none" instead of "translate(0px) rotate(0deg)": the same place, written
// another way.
const iconButton = inside(fixture('icon-button'), '.fx-icon-button');
iconButton.addEventListener('mouseenter', () => iconButton.classList.add('was-hovered'), {
  once: true,
});

// 27. Switches.
const switches = fixture('switches');
onTrigger(switches, 'toggle', () => {
  inside(switches, '.fx-switches').classList.toggle('is-on');
});

// 30. Reflow.
const reflow = fixture('reflow');
onTrigger(reflow, 'toggle', () => {
  inside(reflow, '.fx-reflow').classList.toggle('is-open');
});

// 31. Script spring. A damped spring, stepped every frame, written to the
// inline style, as motion libraries do.
const spring = fixture('spring');
const springBox = inside(spring, '.fx-spring__box');
let springTo = 0;
let springRunning = false;
onTrigger(spring, 'toggle', () => {
  springTo = springTo === 0 ? 160 : 0;
  if (springRunning) return;
  springRunning = true;
  let x = springTo === 160 ? 0 : 160;
  let velocity = 0;
  let last = performance.now();
  const step = (now: number): void => {
    const dt = Math.min(Math.max(now - last, 0) / 1000, 1 / 30);
    last = now;
    // Stiffness 170, damping 14: it overshoots a little and settles.
    velocity += (170 * (springTo - x) - 14 * velocity) * dt;
    x += velocity * dt;
    const settled = Math.abs(springTo - x) < 0.1 && Math.abs(velocity) < 0.1;
    if (settled) x = springTo;
    springBox.style.transform = `translateX(${x.toFixed(2)}px)`;
    if (settled) springRunning = false;
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});

// 32. Tilt card. The card turns toward where the pointer says, easing
// after it with a lag of 85 ms (63% of the way in that time, whatever the
// frame rate); off the card it turns back flat.
const tilt = inside(fixture('tilt'), '.fx-tilt');
const tiltTarget = { x: 0, y: 0 };
const tiltNow = { x: 0, y: 0 };
let tilting = false;
let tiltLast = 0;
const tiltStep = (now: number): void => {
  // A frame's time is when the frame began, which can be before the
  // pointer move that started this: never less than nothing.
  const share = 1 - Math.exp(-Math.max(now - tiltLast, 0) / 85);
  tiltLast = now;
  tiltNow.x += (tiltTarget.x - tiltNow.x) * share;
  tiltNow.y += (tiltTarget.y - tiltNow.y) * share;
  tilt.style.transform = `perspective(600px) rotateX(${(-tiltNow.y * 10).toFixed(3)}deg) rotateY(${(tiltNow.x * 10).toFixed(3)}deg)`;
  const settled =
    Math.abs(tiltTarget.x - tiltNow.x) < 0.001 && Math.abs(tiltTarget.y - tiltNow.y) < 0.001;
  if (settled) tilting = false;
  else requestAnimationFrame(tiltStep);
};
const tiltTo = (x: number, y: number): void => {
  tiltTarget.x = x;
  tiltTarget.y = y;
  if (tilting) return;
  tilting = true;
  tiltLast = performance.now();
  requestAnimationFrame(tiltStep);
};
tilt.addEventListener('pointermove', (event) => {
  const box = tilt.getBoundingClientRect();
  tiltTo(
    ((event.clientX - box.left) / box.width) * 2 - 1,
    ((event.clientY - box.top) / box.height) * 2 - 1,
  );
});
tilt.addEventListener('pointerleave', () => tiltTo(0, 0));
