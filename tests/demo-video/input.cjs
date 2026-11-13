// Drives the real pointer and keyboard at a person's pace, through driver.js.
const { spawn } = require('node:child_process');
const { join } = require('node:path');

class Input {
  constructor() {
    this.child = spawn('osascript', ['-l', 'JavaScript', join(__dirname, 'driver.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.waiting = [];
    let text = '';
    this.child.stdout.on('data', (chunk) => {
      text += chunk;
      let at;
      while ((at = text.indexOf('\n')) >= 0) {
        const line = text.slice(0, at);
        text = text.slice(at + 1);
        const done = this.waiting.shift();
        if (done) done(line.replace(/^ok ?/, ''));
      }
    });
    this.log = [];
  }
  send(cmd) {
    return new Promise((done) => {
      this.waiting.push(done);
      this.child.stdin.write(JSON.stringify(cmd) + '\n');
    });
  }
  async where() {
    return JSON.parse(await this.send({ do: 'where' }));
  }
  // A calm, slightly curved move: slower over short distances than a
  // flick, never fast. About 0.55 s plus 0.6 ms a point, at most 1.5 s.
  async move(x, y, { speed = 1, ms = null } = {}) {
    const from = await this.where();
    const distance = Math.hypot(x - from.x, y - from.y);
    if (distance < 1) return;
    // Brisk but human: about 0.3 s plus 0.36 ms a point, at most 0.9 s.
    const total = ms ?? Math.min(900, 300 + distance * 0.36) / speed;
    const steps = Math.max(8, Math.round(total / 12));
    // A gentle arc: the middle is pushed sideways a little.
    const bend = Math.min(40, distance * 0.08) * (Math.random() < 0.5 ? -1 : 1);
    const nx = -(y - from.y) / distance;
    const ny = (x - from.x) / distance;
    const cx = (from.x + x) / 2 + nx * bend;
    const cy = (from.y + y) / 2 + ny * bend;
    const points = [];
    for (let i = 1; i <= steps; i += 1) {
      const k = i / steps;
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      const px = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * cx + e * e * x;
      const py = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * cy + e * e * y;
      points.push([px, py, total / steps]);
    }
    this.log.push({ t: Date.now(), kind: 'move', x, y });
    await this.send({ do: 'path', points });
  }
  async click({ pause = 140 } = {}) {
    await new Promise((r) => setTimeout(r, pause));
    const p = await this.where();
    this.log.push({ t: Date.now(), kind: 'click', x: p.x, y: p.y });
    await this.send({ do: 'down' });
    await new Promise((r) => setTimeout(r, 95));
    await this.send({ do: 'up' });
  }
  async type(text) {
    const letters = [...text].map((letter) => [letter, 55 + Math.random() * 45]);
    this.log.push({ t: Date.now(), kind: 'type', text });
    await this.send({ do: 'type', letters });
  }
  key(code, using) {
    return this.send({ do: 'key', code, using });
  }
  keystroke(text, using) {
    return this.send({ do: 'keystroke', text, using });
  }
  // A wheel scroll by dy points, eased, over about a second.
  async scroll(dy, ms = 1100) {
    const steps = Math.max(10, Math.round(ms / 16));
    const out = [];
    let done = 0;
    for (let i = 1; i <= steps; i += 1) {
      const k = i / steps;
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const target = Math.round(dy * e);
      out.push([-(target - done), ms / steps]);
      done = target;
    }
    this.log.push({ t: Date.now(), kind: 'scroll', dy });
    await this.send({ do: 'scroll', steps: out });
  }
  close() {
    this.child.stdin.write(JSON.stringify({ do: 'quit' }) + '\n');
    this.child.stdin.end();
  }
}
module.exports = { Input };
