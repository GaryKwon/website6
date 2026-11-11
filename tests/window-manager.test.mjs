// Deterministic DOM surface for WindowManager state/lifecycle tests.
// This verifies JS transitions; real layout, rendering and browser events require browser QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { WindowManager } from '../dist/src/window-manager.js';
setMaxListeners(0);

class FakeTarget {
  static instances = new Set();
  constructor() { this.listeners = new Map(); FakeTarget.instances.add(this); }
  addEventListener(type, callback, options = {}) {
    const signal = options?.signal;
    if (signal?.aborted) return;
    let records = this.listeners.get(type);
    if (!records) this.listeners.set(type, records = new Map());
    if (records.has(callback)) return;
    const record = { callback, once: options?.once };
    records.set(callback, record);
    if (signal) {
      record.signal = signal;
      record.abort = () => this.removeEventListener(type, callback);
      signal.addEventListener('abort', record.abort, { once: true });
    }
  }
  removeEventListener(type, callback) {
    const records = this.listeners.get(type), record = records?.get(callback);
    if (!record) return;
    record.signal?.removeEventListener('abort', record.abort);
    records.delete(callback);
    if (!records.size) this.listeners.delete(type);
  }
  dispatchEvent(event) {
    event.target ??= this; event.currentTarget = this;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    for (const record of [...(this.listeners.get(event.type)?.values() || [])]) {
      if (record.once) this.removeEventListener(event.type, record.callback);
      record.callback.call(this, event);
    }
    return !event.defaultPrevented;
  }
  static listenerCount() {
    let count = 0;
    for (const target of FakeTarget.instances) for (const records of target.listeners.values()) count += records.size;
    return count;
  }
}
class FakeElement extends FakeTarget {
  constructor(tagName = 'div') {
    super(); this.tagName = tagName.toUpperCase(); this.children = []; this.parentNode = null;
    this.className = ''; this.style = {}; this.attributes = {}; this.dataset = {}; this.captured = new Set();
    const apply = (name, enabled) => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(' '); return enabled;
    };
    this.classList = {
      add: (...names) => names.forEach(name => apply(name, true)),
      remove: (...names) => names.forEach(name => apply(name, false)),
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => apply(name, force ?? !this.className.split(/\s+/).includes(name))
    };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(...elements) {
    for (const element of elements) { element.remove(); element.parentNode = this; this.children.push(element); }
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  closest(selector) {
    const matches = node => selector.split(',').some(part => {
      const trimmed = part.trim();
      if (trimmed.startsWith('.')) return node.classList.contains(trimmed.slice(1));
      return node.tagName.toLowerCase() === trimmed;
    });
    let current = this;
    while (current) { if (matches(current)) return current; current = current.parentNode; }
    return null;
  }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) {
    if (!this.captured.delete(id)) return;
    this.dispatchEvent({ type: 'lostpointercapture', pointerId: id });
  }
}
function fixture(options = {}) {
  FakeTarget.instances = new Set();
  globalThis.window = new FakeTarget();
  globalThis.innerWidth = 1440; globalThis.innerHeight = 900;
  let modalOpen = false;
  globalThis.document = {
    createElement: tag => new FakeElement(tag),
    querySelector: selector => selector === 'dialog[open]' && modalOpen ? new FakeElement('dialog') : null
  };
  const layer = new FakeElement(), taskbar = new FakeElement();
  const errors = [], mounted = new Set(), services = new Map(), lifecycle = [];
  const manager = new WindowManager({
    layer, taskbar,
    createApp(type, appOptions) {
      const app = {
        mount(container, api) { mounted.add(app); lifecycle.push(['mount', type]); services.set(app, api); container.append(new FakeElement('p')); options.onMount?.(type, appOptions, app, api); },
        unmount() { mounted.delete(app); lifecycle.push(['unmount', type]); },
        visibility(value) { lifecycle.push(['visibility', value]); }
      };
      if (options.beforeClose) app.beforeClose = () => options.beforeClose(type, appOptions);
      return app;
    },
    makeServices: () => ({}), onError: error => errors.push(error)
  });
  return { manager, layer, taskbar, errors, mounted, services, lifecycle, modal: value => { modalOpen = value; } };
}
const handle = (state, className) => state.element.children.find(node => node.classList.contains(className));
const pointer = (target, type, values = {}) => target.dispatchEvent({ type, pointerId: 1, button: 0, clientX: 200, clientY: 150, ...values });

test('100 complete window lifecycles return Map, DOM, app and listener counts to baseline', async () => {
  const { manager, layer, taskbar, mounted } = fixture();
  const baselineListeners = FakeTarget.listenerCount();
  assert.equal(baselineListeners, 1);
  for (let i = 0; i < 100; i++) {
    const id = manager.openWindow('paint'); const state = manager.windows.get(id);
    const title = handle(state, 'window-titlebar');
    pointer(title, 'pointerdown'); pointer(title, 'pointermove', { clientX: 280, clientY: 200 }); pointer(title, 'pointerup');
    const resize = handle(state, 'resize-se');
    pointer(resize, 'pointerdown'); pointer(resize, 'pointermove', { clientX: 250, clientY: 210 }); pointer(resize, 'pointerup');
    manager.focusWindow(id); manager.minimizeWindow(id); assert.equal(state.element.hidden, true);
    manager.restoreWindow(id); assert.equal(state.element.hidden, false);
    manager.maximizeWindow(id); assert.equal(state.maximized, true);
    manager.maximizeWindow(id); assert.equal(state.maximized, false);
    assert.equal(await manager.closeWindow(id), true);
    assert.equal(await manager.closeWindow(id), false);
    assert.equal(manager.windows.size, 0); assert.equal(manager.order.length, 0);
    assert.equal(layer.children.length, 0); assert.equal(taskbar.children.length, 0); assert.equal(mounted.size, 0);
    assert.equal(FakeTarget.listenerCount(), baselineListeners);
  }
  await manager.destroy(); await manager.destroy();
  assert.equal(FakeTarget.listenerCount(), 0);
});

test('100 rapid opens are singletons and reopening restores a minimized window', async () => {
  const { manager, mounted, layer, taskbar } = fixture();
  const ids = Array.from({ length: 100 }, () => manager.openWindow('notepad', { fileId: 'welcome' }));
  assert.equal(new Set(ids).size, 1); assert.equal(manager.windows.size, 1); assert.equal(mounted.size, 1);
  assert.equal(layer.children.length, 1); assert.equal(taskbar.children.length, 1);
  manager.minimizeWindow(ids[0]); manager.openWindow('notepad', { fileId: 'welcome' });
  assert.equal(manager.windows.get(ids[0]).minimized, false);
  await manager.destroy();
});

test('global 12-window and explorer 4-window limits enforce bounds', async () => {
  const { manager, errors } = fixture();
  for (let i = 0; i < 4; i++) assert.ok(manager.openWindow('explorer', { folderId: `folder-${i}` }));
  assert.equal(manager.openWindow('explorer', { folderId: 'folder-5' }), null);
  assert.match(errors.at(-1), /4개/);
  for (let i = 0; i < 8; i++) assert.ok(manager.openWindow('notepad', { fileId: `file-${i}` }));
  assert.equal(manager.windows.size, 12);
  assert.equal(manager.openWindow('terminal'), null); assert.match(errors.at(-1), /12개/);
  await manager.destroy(); assert.equal(manager.windows.size, 0);
});

test('200 focus changes keep unique bounded z-indices and matching active task state', async () => {
  const { manager } = fixture();
  const ids = Array.from({ length: 12 }, (_, i) => manager.openWindow('notepad', { fileId: `file-${i}` }));
  for (let i = 0; i < 200; i++) {
    const active = ids[(i * 7) % ids.length]; manager.focusWindow(active);
    const states = [...manager.windows.values()];
    assert.equal(new Set(states.map(state => state.zIndex)).size, 12);
    assert.ok(states.every(state => state.zIndex >= 1 && state.zIndex <= 12));
    assert.equal(manager.order.at(-1), active);
    assert.deepEqual(states.filter(state => state.element.classList.contains('active')).map(state => state.id), [active]);
    assert.deepEqual(states.filter(state => state.task.classList.contains('active')).map(state => state.id), [active]);
  }
  await manager.destroy();
});

test('modal prevents focus changes and minimize selects the next visible task', async () => {
  const { manager, modal } = fixture();
  const a = manager.openWindow('paint'), b = manager.openWindow('terminal');
  modal(true); manager.focusWindow(a); assert.equal(manager.order.at(-1), b);
  modal(false); manager.minimizeWindow(b); assert.equal(manager.order.at(-1), a);
  assert.equal(manager.windows.get(a).task.classList.contains('active'), true);
  assert.equal(manager.windows.get(b).task.classList.contains('active'), false);
  manager.restoreWindow(b); assert.equal(manager.order.at(-1), b);
  await manager.destroy();
});

test('100 viewport changes clamp bounds and keep titlebars accessible on mobile', async () => {
  const { manager } = fixture();
  const id = manager.openWindow('paint'), state = manager.windows.get(id);
  for (let i = 0; i < 100; i++) {
    globalThis.innerWidth = i % 2 ? 390 : 844; globalThis.innerHeight = i % 2 ? 844 : 390;
    state.x = 100000; state.y = 100000; state.width = 100000; state.height = 100000;
    window.dispatchEvent({ type: 'resize' });
    assert.ok(state.width <= innerWidth - 8); assert.ok(state.height <= innerHeight - 50);
    assert.ok(state.x >= 0 && state.x <= innerWidth - 100);
    assert.ok(state.y >= 0 && state.y <= innerHeight - 74);
  }
  await manager.destroy();
  const mobile = fixture(); globalThis.innerWidth = 390; globalThis.innerHeight = 844;
  const mobileId = mobile.manager.openWindow('notepad'); const mobileState = mobile.manager.windows.get(mobileId);
  assert.equal(mobileState.maximized, true); assert.equal(mobileState.element.style.left, '0px');
  assert.equal(mobileState.element.style.width, '390px');
  await mobile.manager.destroy();
});

test('unsaved close cancellation preserves state; duplicate pending closes and forced teardown are safe', async () => {
  let approve = false, resolveClose;
  const fixtureA = fixture({ beforeClose: () => approve });
  const id = fixtureA.manager.openWindow('notepad'), state = fixtureA.manager.windows.get(id);
  fixtureA.services.get(state.app).setDirty(true); assert.equal(state.dirty, true);
  assert.equal(await fixtureA.manager.closeWindow(id), false);
  assert.equal(state.closing, false); assert.equal(fixtureA.manager.windows.size, 1); assert.equal(fixtureA.mounted.size, 1);
  approve = true; assert.equal(await fixtureA.manager.closeWindow(id), true); await fixtureA.manager.destroy();
  const fixtureB = fixture({ beforeClose: () => new Promise(resolve => { resolveClose = resolve; }) });
  const pendingId = fixtureB.manager.openWindow('notepad');
  const pending = fixtureB.manager.closeWindow(pendingId);
  assert.equal(await fixtureB.manager.closeWindow(pendingId), false);
  resolveClose(true); assert.equal(await pending, true); await fixtureB.manager.destroy();
  const fixtureC = fixture({ beforeClose: () => false });
  fixtureC.manager.openWindow('notepad'); await fixtureC.manager.destroy();
  assert.equal(fixtureC.manager.windows.size, 0); assert.equal(FakeTarget.listenerCount(), 0);
});

test('pointer cancel and capture loss stop movement, and closing mid-drag releases capture', async () => {
  const { manager } = fixture();
  const id = manager.openWindow('paint'), state = manager.windows.get(id), title = handle(state, 'window-titlebar');
  pointer(title, 'pointerdown'); pointer(title, 'pointermove', { clientX: 250 }); pointer(title, 'pointercancel');
  const firstX = state.x; pointer(title, 'pointermove', { clientX: 800 }); assert.equal(state.x, firstX); assert.equal(title.captured.size, 0);
  pointer(title, 'pointerdown'); title.releasePointerCapture(1);
  const secondX = state.x; pointer(title, 'pointermove', { clientX: 900 }); assert.equal(state.x, secondX);
  pointer(title, 'pointerdown'); assert.equal(title.hasPointerCapture(1), true);
  await manager.closeWindow(id); assert.equal(title.captured.size, 0);
  await manager.destroy(); assert.equal(FakeTarget.listenerCount(), 0);
});

test('a second simultaneous pointer cannot replace or leak the active capture', async () => {
  const { manager } = fixture();
  const id = manager.openWindow('paint'), state = manager.windows.get(id), title = handle(state, 'window-titlebar');
  pointer(title, 'pointerdown', { pointerId: 11 });
  pointer(title, 'pointerdown', { pointerId: 22 });
  assert.deepEqual([...title.captured], [11]);
  const initialX = state.x;
  pointer(title, 'pointermove', { pointerId: 22, clientX: 800 });
  assert.equal(state.x, initialX);
  pointer(title, 'pointermove', { pointerId: 11, clientX: 240 });
  assert.notEqual(state.x, initialX);
  pointer(title, 'pointerup', { pointerId: 11 });
  assert.equal(title.captured.size, 0);
  pointer(title, 'pointerdown', { pointerId: 22 });
  assert.deepEqual([...title.captured], [22]);
  await manager.closeWindow(id);
  assert.equal(title.captured.size, 0);
  await manager.destroy(); assert.equal(FakeTarget.listenerCount(), 0);
});

test('destroy force-closes a window while its unsaved confirmation is pending', async () => {
  for (const approved of [true, false]) {
    let resolveClose;
    const { manager, layer, taskbar, mounted, lifecycle } = fixture({ beforeClose: () => new Promise(resolve => { resolveClose = resolve; }) });
    const id = manager.openWindow('notepad');
    const pending = manager.closeWindow(id);
    assert.equal(manager.windows.get(id).closing, true);
    await manager.destroy();
    assert.equal(manager.windows.size, 0); assert.equal(mounted.size, 0);
    assert.equal(layer.children.length, 0); assert.equal(taskbar.children.length, 0);
    assert.equal(FakeTarget.listenerCount(), 0);
    resolveClose(approved); await pending;
    assert.equal(lifecycle.filter(([action]) => action === 'unmount').length, 1);
    await manager.destroy();
  }
});

test('NaN, infinities and negative bounds normalize to finite visible window geometry', async () => {
  const { manager } = fixture();
  const id = manager.openWindow('paint'), state = manager.windows.get(id);
  for (const invalid of [
    { x: NaN, y: Infinity, width: -Infinity, height: NaN },
    { x: -Infinity, y: NaN, width: Infinity, height: -Infinity },
    { x: -1000, y: -1000, width: -1, height: -1 },
    { x: Number.MAX_VALUE, y: Number.MAX_VALUE, width: Number.MAX_VALUE, height: Number.MAX_VALUE }
  ]) {
    Object.assign(state, invalid); manager.fitAll();
    assert.ok(['x', 'y', 'width', 'height'].every(key => Number.isFinite(state[key])));
    assert.ok(state.x >= 0 && state.y >= 0 && state.width > 0 && state.height > 0);
    assert.ok(state.x + state.width <= innerWidth && state.y + state.height <= innerHeight - 42);
    assert.ok(Object.values(state.element.style).every(value => !/NaN|Infinity/.test(String(value))));
  }
  await manager.destroy();
});
