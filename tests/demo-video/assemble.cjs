// Joins the recorded clips (stripe, vercel, apple) into docs/demo.mp4, each
// fading into the next, and the README GIF from the Stripe part.
// Run with: node tests/demo-video/assemble.cjs
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const CLIPS = ['stripe', 'vercel', 'apple'];
const OUT = { width: 1920, height: 1200 };
const FPS = 30;
const FADE = 0.5;
const here = __dirname;
const work = join(here, 'out');
mkdirSync(work, { recursive: true });

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

// The crop for each frame of a clip, in the recording's pixels (twice the
// window's points): eased toward each action noted while recording.
function zoomPlan(meta, length) {
  const W = meta.window.width * 2;
  const H = meta.window.height * 2;
  const win = meta.window;
  const events = meta.input.map((e) => ({ ...e, at: (e.t - meta.start) / 1000 })).sort((x, y) => x.at - y.at);
  // Where to look at a moment: around the pointer's destination, closer
  // over the panel; the whole window while an address is typed and the page
  // loads, while scrolling, and at the start and end.
  const targetAt = (t) => {
    const full = { cx: W / 2, cy: H / 2, zoom: 1 };
    if (t < 1.6 || t > length - 1.6) return full;
    const last = [...events].reverse().find((e) => e.at <= t);
    if (!last) return full;
    if (last.kind === 'type' || last.kind === 'scroll') return full;
    const typed = [...events].reverse().find((e) => e.kind === 'type' && e.at <= t);
    if (typed && t - typed.at < 4.5) return full;
    const x = (last.x - win.x) * 2;
    const y = (last.y - win.y) * 2;
    const inPanel = last.x > win.x + win.width - 600;
    const inToolbar = last.y < win.y + 90;
    const zoom = inPanel ? 1.7 : inToolbar ? 1.35 : 1.5;
    return { cx: x, cy: y, zoom };
  };
  const frames = [];
  let now = { cx: W / 2, cy: H / 2, zoom: 1 };
  for (let i = 0; i < Math.round(length * FPS); i += 1) {
    const t = i / FPS;
    const target = targetAt(t);
    const k = 0.06; // about 0.8 s to settle: calm, like a person's camera
    now = {
      cx: now.cx + (target.cx - now.cx) * k,
      cy: now.cy + (target.cy - now.cy) * k,
      zoom: now.zoom + (target.zoom - now.zoom) * k,
    };
    const w = W / now.zoom;
    const h = H / now.zoom;
    const x = Math.min(Math.max(now.cx - w / 2, 0), W - w);
    const y = Math.min(Math.max(now.cy - h / 2, 0), H - h);
    frames.push({ t, x, y, w, h });
  }
  return frames;
}

const parts = { plain: [], zoom: [] };
for (const name of CLIPS) {
  const meta = JSON.parse(readFileSync(join(here, `${name}.json`), 'utf8'));
  const from = 0.4;
  const length = (meta.end - meta.start) / 1000 + 0.8 - from;
  const source = join(here, `${name}.mp4`);
  // The whole window.
  const plain = join(work, `${name}-plain.mp4`);
  if (!require('node:fs').existsSync(plain)) ffmpeg([
    '-ss', String(from), '-i', source, '-t', length.toFixed(2),
    '-vf', `fps=${FPS},scale=${OUT.width}:${OUT.height}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', plain,
  ]);
  parts.plain.push({ file: plain, length });
  console.log(name, length.toFixed(1), 's');
}

// One after another, each fading into the next.
for (const kind of ['plain']) {
  const list = parts[kind];
  const inputs = list.flatMap((part) => ['-i', part.file]);
  const chain = [];
  let offset = 0;
  let label = '[0:v]';
  list.slice(1).forEach((part, index) => {
    offset += list[index].length - FADE;
    const out = index === list.length - 2 ? '[v]' : `[x${index}]`;
    chain.push(`${label}[${index + 1}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(2)}${out}`);
    label = out;
  });
  const file = join(here, '../../docs/demo.mp4');
  ffmpeg([
    ...inputs, '-filter_complex', chain.join(';'), '-map', '[v]',
    '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file,
  ]);
  // The README GIF: the Stripe part, from opening the panel through the
  // pick, the hover and the replay looping beside the page.
  ffmpeg([
    '-ss', '9.6', '-t', '26', '-i', file, '-filter_complex',
    'fps=10,scale=1000:-1:flags=lanczos,split[x][y];[x]palettegen=max_colors=128:stats_mode=diff[p];' +
      '[y][p]paletteuse=dither=none:diff_mode=rectangle',
    join(here, '../../docs/demo.gif'),
  ]);
  const total = list.reduce((sum, part) => sum + part.length, 0) - FADE * (list.length - 1);
  console.log(kind, total.toFixed(1), 's ->', file);
}
