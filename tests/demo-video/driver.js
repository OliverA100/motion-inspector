// Real input for the recording: reads one JSON command per line on stdin,
// posts it as system mouse or keyboard events, answers "ok" per command.
ObjC.import('Foundation');
ObjC.import('CoreGraphics');
ObjC.import('AppKit');
ObjC.import('stdlib');
const out = $.NSFileHandle.fileHandleWithStandardOutput;
const say = (text) => out.writeData($(text + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
const sleep = (ms) => $.NSThread.sleepForTimeInterval(ms / 1000);
let down = false;
const mouse = (type, x, y) => {
  const event = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), 0);
  $.CGEventPost($.kCGHIDEventTap, event);
};
const where = () => {
  const p = $.NSEvent.mouseLocation;
  const h = $.NSScreen.screens.objectAtIndex(0).frame.size.height;
  return { x: p.x, y: h - p.y };
};
const events = Application('System Events');
function run(cmd) {
  switch (cmd.do) {
    case 'path':
      for (const [x, y, dt] of cmd.points) {
        mouse(down ? 6 : 5, x, y);
        sleep(dt);
      }
      return '';
    case 'down': {
      const p = where();
      mouse(1, p.x, p.y);
      down = true;
      return '';
    }
    case 'up': {
      const p = where();
      mouse(2, p.x, p.y);
      down = false;
      return '';
    }
    case 'scroll':
      for (const [dy, dt] of cmd.steps) {
        const event = $.CGEventCreateScrollWheelEvent(null, 0, 1, dy);
        $.CGEventPost($.kCGHIDEventTap, event);
        sleep(dt);
      }
      return '';
    case 'type':
      for (const [letter, dt] of cmd.letters) {
        events.keystroke(letter);
        sleep(dt);
      }
      return '';
    case 'key': {
      if ((cmd.using || []).length > 0) {
        events.keyCode(cmd.code, { using: cmd.using });
        return '';
      }
      const down = $.CGEventCreateKeyboardEvent(null, cmd.code, true);
      $.CGEventPost($.kCGHIDEventTap, down);
      sleep(40);
      const up = $.CGEventCreateKeyboardEvent(null, cmd.code, false);
      $.CGEventPost($.kCGHIDEventTap, up);
      return '';
    }
    case 'keystroke':
      events.keystroke(cmd.text, { using: cmd.using || [] });
      return '';
    case 'quit':
      $.exit(0);
      return '';
    case 'where':
      return JSON.stringify(where());
    default:
      return 'unknown';
  }
}
const input = $.NSFileHandle.fileHandleWithStandardInput;
let buffer = '';
while (true) {
  const data = input.availableData;
  if (data.length === 0) break;
  buffer += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
  let at;
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (line.trim() === '') continue;
    let answer = '';
    try {
      answer = run(JSON.parse(line));
    } catch (error) {
      answer = 'error ' + error;
    }
    say('ok ' + answer);
  }
}
