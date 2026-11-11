import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, createFileSystem, normalizeState, LIMITS } from '../dist/src/state.js';
import { parseBackup, exportState, loadState, saveState, createAutosave, STORAGE_KEY } from '../dist/src/storage.js';

const make = () => { const state = createInitialState(); return { state, fs: createFileSystem(state) }; };
const snapshot = value => JSON.parse(JSON.stringify(value));

test('default filesystem and nested paths resolve consistently', () => {
  const { fs } = make();
  assert.equal(fs.list('root').length, 4);
  assert.equal(fs.resolve('/Documents/Welcome.txt').id, 'welcome');
  assert.equal(fs.resolve('C:\\Documents\\Welcome.txt').id, 'welcome');
  assert.equal(fs.resolve('../Games', 'documents').id, 'games');
  assert.equal(fs.path('welcome'), '/Documents/Welcome.txt');
  assert.throws(() => fs.resolve('/missing/file.txt'), /경로/);
  assert.throws(() => fs.resolve('/Documents/Welcome.txt/no'), /폴더/);
});

test('100 folders and 200 files survive moves, trash, restore, and 50 backup cycles', () => {
  const { state, fs } = make();
  const folders = Array.from({ length: 100 }, (_, i) => fs.create('documents', `folder-${i}`, 'folder'));
  const files = Array.from({ length: 200 }, (_, i) => fs.create(folders[i % 100].id, `file-${i}.txt`, 'text', `내용 ${i}`));
  for (let i = 0; i < files.length; i++) fs.move(files[i].id, folders[(i + 1) % 100].id);
  for (const folder of folders) fs.trash(folder.id);
  assert.equal(fs.list('trash').length, 100);
  for (const folder of folders) fs.restore(folder.id);
  assert.equal(fs.list('trash').length, 0);
  assert.equal(state.nodes.length, 308);
  let restored = state;
  for (let i = 0; i < 50; i++) restored = parseBackup(exportState(restored));
  assert.deepEqual(restored, state);
});

test('Unicode and XSS-like strings remain literal in 100KB round-trip', () => {
  const { state, fs } = make();
  const content = '<img src=x onerror="alert(1)">\n한글 😀 & <script>evil()</script>\n' + 'a'.repeat(100 * 1024);
  fs.write('welcome', content);
  const restored = createFileSystem(parseBackup(exportState(state)));
  assert.equal(restored.get('welcome').content, content);
  assert.throws(() => fs.write('welcome', 'x'.repeat(LIMITS.textBytes + 1)), /256KB/);
  assert.equal(fs.get('welcome').content, content);
});

test('duplicate names, invalid names, cyclic moves, depth and capacity failures are atomic', () => {
  const { state, fs } = make();
  const parent = fs.create('documents', 'outer', 'folder');
  const child = fs.create(parent.id, 'inner', 'folder');
  const before = snapshot(state);
  for (const operation of [
    () => fs.create('documents', 'Welcome.txt'),
    () => fs.rename('welcome', '../escape'),
    () => fs.create('documents', '__proto__'),
    () => fs.move(parent.id, child.id),
    () => fs.trash('documents'),
    () => fs.move('welcome', 'welcome')
  ]) { assert.throws(operation); assert.deepEqual(state, before); }
  let current = child.id;
  for (let depth = 4; depth <= LIMITS.depth; depth++) current = fs.create(current, `d${depth}`, 'folder').id;
  const fullDepth = snapshot(state);
  assert.throws(() => fs.create(current, 'too-deep', 'folder'), /8단계/);
  assert.deepEqual(state, fullDepth);
  // Deleting a deep folder must stay possible even though Trash adds a path segment.
  fs.trash(parent.id);
  fs.restore(parent.id);
});

test('trash allows identically named roots, restore collision preserves all files, permanent delete removes subtree', () => {
  const { state, fs } = make();
  const a = fs.create('documents', 'same.txt');
  const b = fs.create('pictures', 'same.txt');
  fs.trash(a.id); fs.trash(b.id);
  assert.equal(fs.list('trash').length, 2);
  fs.create('documents', 'same.txt');
  const before = snapshot(state);
  assert.throws(() => fs.restore(a.id), /중복/);
  assert.deepEqual(state, before);
  fs.restore(b.id);
  const folder = fs.create('documents', 'delete-me', 'folder');
  const child = fs.create(folder.id, 'nested.txt');
  fs.trash(folder.id); fs.remove(folder.id);
  assert.equal(fs.get(child.id), undefined);
  assert.throws(() => fs.remove(b.id), /휴지통/);
});

test('normalizer rejects corrupted, dangerous, cyclic, out-of-range, and oversized backups', () => {
  const cases = [
    '{broken',
    JSON.stringify({ ...createInitialState(), version: 2 }),
    '{"version":1,"nodes":[],"__proto__":{"polluted":true}}',
    JSON.stringify({ ...createInitialState(), nodes: [ ...createInitialState().nodes, createInitialState().nodes[0] ] }),
    JSON.stringify({ ...createInitialState(), iconPositions: { computer: { x: -1, y: 2 } } }),
    JSON.stringify({ ...createInitialState(), settings: { iconSize: -5 } }),
    JSON.stringify({ ...createInitialState(), settings: { background: 'url(javascript:alert(1))' } }),
    ' '.repeat(LIMITS.backupBytes + 1)
  ];
  const { state } = make(); const before = snapshot(state);
  for (const item of cases) { assert.throws(() => parseBackup(item)); assert.deepEqual(state, before); }
  assert.equal({}.polluted, undefined);
  const cyclic = createInitialState(); cyclic.extra = cyclic;
  assert.throws(() => normalizeState(cyclic), /순환/);
  const brokenTree = createInitialState(); brokenTree.nodes.find(node => node.id === 'welcome').parentId = 'missing';
  assert.throws(() => normalizeState(brokenTree), /상위/);
  const badNumber = createInitialState(); badNumber.iconPositions.computer = { x: Infinity, y: NaN };
  assert.throws(() => normalizeState(badNumber), /좌표/);
});

test('filesystem subscriptions unsubscribe and destroy without accumulating callbacks', () => {
  const { fs } = make(); let calls = 0;
  for (let i = 0; i < 100; i++) { const off = fs.subscribe(() => calls++); off(); }
  fs.write('welcome', 'one'); assert.equal(calls, 0);
  const off = fs.subscribe(() => calls++);
  fs.write('welcome', 'two'); assert.equal(calls, 1);
  off(); off(); fs.destroy(); fs.destroy();
  fs.write('welcome', 'three'); assert.equal(calls, 1);
});

test('node snapshots cannot silently mutate the shared filesystem', () => {
  const { fs } = make(); const node = fs.get('welcome'); node.name = 'wrong';
  const folderItems = fs.list('documents'); folderItems[0].content = 'wrong';
  assert.equal(fs.get('welcome').name, 'Welcome.txt');
  assert.notEqual(fs.get(folderItems[0].id).content, 'wrong');
});

test('storage handles missing, corrupted and quota-blocked storage; autosave errors are bounded', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
    assert.equal(loadState().warning, '');
    assert.equal(saveState(createInitialState()).ok, true);
    assert.equal(loadState().state.nodes.length, 8);
    values.set(STORAGE_KEY, '{oops'); assert.notEqual(loadState().warning, '');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.equal(saveState(createInitialState()).ok, false);
    assert.notEqual(loadState().warning, '');
    let errors = 0;
    const autosave = createAutosave(createInitialState, () => errors++);
    for (let i = 0; i < 100; i++) autosave.schedule();
    autosave.flush(); assert.equal(errors, 1);
    autosave.schedule(); autosave.flush(); assert.equal(errors, 1);
    autosave.destroy(); autosave.destroy(); autosave.schedule();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(errors, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});


test('node capacity is bounded and failed creates preserve state', () => {
  const { state, fs } = make();
  while (state.nodes.length < LIMITS.nodes) fs.create('documents', `limit-${state.nodes.length}.txt`);
  const before = snapshot(state);
  assert.throws(() => fs.create('documents', 'one-too-many.txt'), /600개/);
  assert.deepEqual(state, before);
});


test('supported themes and icon sizes match settings UI', () => {
  for (const theme of ['classic', 'midnight', 'olive']) {
    for (const iconSize of [32, 40, 48]) {
      const state = createInitialState();
      state.settings.theme = theme; state.settings.iconSize = iconSize;
      assert.equal(parseBackup(exportState(state)).settings.theme, theme);
    }
  }
  const state = createInitialState(); state.settings.theme = 'sand';
  assert.throws(() => normalizeState(state), /테마/);
});
