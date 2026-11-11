import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextApp } from '../dist/src/apps-text.js';
import { createInitialState, createFileSystem } from '../dist/src/state.js';

// A narrow DOM harness exercises bounded terminal output without claiming browser QA.
class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.listeners = new Map();
    this.style = {};
    this.classList = { add() {} };
    this.parentElement = null;
    this.textContent = '';
    this.value = '';
  }
  setAttribute() {}
  append(...nodes) {
    for (const node of nodes) { node.parentElement = this; this.children.push(node); }
  }
  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    options.signal?.addEventListener('abort', () => listeners.delete(listener), { once: true });
  }
  dispatch(type, fields = {}) {
    const event = { preventDefault() {}, ...fields };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
  }
  focus() {}
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
}

globalThis.document = { createElement: tag => new FakeNode(tag) };
function mountTerminal() {
  const state = createInitialState();
  const vfs = createFileSystem(state);
  const container = new FakeNode('main');
  const settings = [];
  const effects = { closed: 0 };
  const app = createTextApp('terminal');
  app.mount(container, { vfs, saveSettings: value => settings.push(value), close: () => effects.closed++ });
  const output = container.children[1];
  const form = container.children[2];
  const input = form.children[1];
  return { app, container, output, form, input, vfs, settings, effects };
}
const lines = output => output.children.map(node => node.textContent);

test('terminal caps output to 500 lines after 1000 help commands', () => {
  const { app, output } = mountTerminal();
  for (let index = 0; index < 1000; index++) app.runCommand('help');
  assert.equal(output.childElementCount, 500);
  assert.ok(lines(output).at(-1).includes('따옴표'));
  app.unmount();
});

test('cat renders HTML-like content as literal text and caps large output', () => {
  const { app, output, vfs } = mountTerminal();
  const payload = '<script>globalThis.terminalTestExecuted = true</script>\n<img src=x onerror=alert(1)>';
  vfs.create('documents', 'xss.txt', 'text', payload);
  app.runCommand('cat /Documents/xss.txt');
  assert.deepEqual(lines(output).slice(-2), payload.split('\n'));
  assert.equal(globalThis.terminalTestExecuted, undefined);
  assert.equal(output.children.at(-1).innerHTML, undefined);
  vfs.create('documents', 'large.txt', 'text', 'line\n'.repeat(10000));
  app.runCommand('cat /Documents/large.txt');
  assert.equal(output.childElementCount, 500);
  app.unmount();
});

test('explicit parser rejects executable and malformed input without breaking later commands', () => {
  const { app, output } = mountTerminal();
  for (const source of ['eval globalThis.terminalTestExecuted=true', 'Function alert(1)', 'unknown', 'cat "unclosed']) {
    app.runCommand(source);
    assert.match(lines(output).at(-1), /^오류:/);
  }
  assert.equal(globalThis.terminalTestExecuted, undefined);
  app.runCommand('echo "한글 emoji 🚀 <b>literal</b>"');
  assert.equal(lines(output).at(-1), '한글 emoji 🚀 <b>literal</b>');
  app.runCommand('cd /Documents');
  app.runCommand('cd ..');
  app.runCommand('echo still works');
  assert.equal(lines(output).at(-1), 'still works');
  app.unmount();
});

test('command history retains the newest 100 entries and clear does not retain output nodes', () => {
  const { app, output, input } = mountTerminal();
  for (let index = 0; index < 150; index++) app.runCommand(`echo ${index}`);
  for (let index = 0; index < 120; index++) input.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(input.value, 'echo 50');
  for (let index = 0; index < 120; index++) input.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(input.value, '');
  app.runCommand('clear');
  assert.equal(output.childElementCount, 0);
  app.unmount();
});

test('theme alias, hidden command, exit and unmount respect integration contracts', () => {
  const { app, container, output, input, form, settings, effects } = mountTerminal();
  app.runCommand('theme night');
  assert.deepEqual(settings, [{ theme: 'midnight' }]);
  app.runCommand('theme olive');
  assert.equal(settings.at(-1).theme, 'olive');
  app.runCommand('theme sand');
  assert.equal(settings.at(-1).theme, 'olive');
  app.runCommand('nostalgia');
  assert.match(lines(output).at(-1), /작은 우주/);
  app.runCommand('exit');
  assert.equal(effects.closed, 1);
  app.unmount();
  assert.equal(container.childElementCount, 0);
  assert.equal(form.listeners.get('submit').size, 0);
  assert.equal(input.listeners.get('keydown').size, 0);
  app.unmount();
  assert.equal(container.childElementCount, 0);
});

test('deleted working directory safely falls back to root', () => {
  const { app, output, vfs } = mountTerminal();
  const folder = vfs.create('documents', 'temporary', 'folder');
  app.runCommand('cd /Documents/temporary');
  vfs.trash(folder.id);
  app.runCommand('dir');
  assert.ok(lines(output).some(line => line.includes('Documents')));
  app.unmount();
});
