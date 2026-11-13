// Talks to a page Playwright does not list (the side panel) over Chrome's
// debugging port: evaluates JavaScript in it and returns the result.
const PORT = 9333;

async function targetUrl(match) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const found = list.find((target) => target.url.includes(match));
  return found ? found.webSocketDebuggerUrl : null;
}

class Session {
  static async open(match) {
    const url = await targetUrl(match);
    if (url === null) return null;
    const session = new Session(url);
    await session.ready;
    return session;
  }
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((done) => this.socket.addEventListener('open', done));
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        pending(message);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('No answer from the panel: ' + JSON.stringify(params).slice(0, 120))), 6000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        done(message);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const answer = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (answer.result?.exceptionDetails) throw new Error(answer.result.exceptionDetails.text + ' ' + expression.slice(0, 80));
    return answer.result?.result?.value;
  }
  close() {
    this.socket.close();
  }
}
module.exports = { Session };
