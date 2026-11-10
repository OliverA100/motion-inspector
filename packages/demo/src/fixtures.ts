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
