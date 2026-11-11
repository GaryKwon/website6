// Shared, browser-local filesystem. All public mutations validate before committing.
export const LIMITS = Object.freeze({ nodes: 600, depth: 8, textBytes: 256 * 1024, backupBytes: 2 * 1024 * 1024 });
export const DEFAULT_SETTINGS = Object.freeze({ theme: 'classic', background: '#008080', iconSize: 40, animations: true, muted: true, hour24: false, autoArrange: true });
const SYSTEM_IDS = new Set(['root', 'documents', 'pictures', 'games', 'trash']);
const DANGEROUS = new Set(['__proto__', 'prototype', 'constructor']);
const encoder = new TextEncoder();
const fail = message => { throw new Error(message); };
const bytes = value => encoder.encode(value).byteLength;
const cloneNode = node => node ? { ...node } : undefined;

export function createInitialState() {
  return {
    version: 1,
    nodes: [
      { id: 'root', parentId: null, name: '내 컴퓨터', type: 'folder' },
      { id: 'documents', parentId: 'root', name: 'Documents', type: 'folder' },
      { id: 'pictures', parentId: 'root', name: 'Pictures', type: 'folder' },
      { id: 'games', parentId: 'root', name: 'Games', type: 'folder' },
      { id: 'trash', parentId: 'root', name: 'Trash', type: 'folder' },
      { id: 'welcome', parentId: 'documents', name: 'Welcome.txt', type: 'text', content: 'RETRO OS에 오신 것을 환영합니다!\n\n1998년의 바탕화면이 브라우저 안으로 돌아왔습니다.\n아이콘을 두 번 클릭하거나 시작 메뉴에서 프로그램을 실행해 보세요.\n\n메모장에서는 Ctrl+S로 저장할 수 있습니다.\n파일과 설정은 이 브라우저에만 저장됩니다.\n설정에서 JSON 백업을 다운로드하면 다른 브라우저로 옮길 수 있습니다.\n\n오늘은 무엇을 만들어 볼까요?\n' },
      { id: 'about', parentId: 'documents', name: 'About.txt', type: 'text', content: 'RETRO OS · A little window into 1998\n\n외부 서버와 연결하지 않는 작은 가상 운영체제입니다.\n모든 파일은 가상 파일이며 실제 컴퓨터의 파일과 다릅니다.\n\n숨겨진 명령을 찾고 싶다면 터미널에서: nostalgia\n' },
      { id: 'secret', parentId: 'games', name: 'secret.txt', type: 'text', content: 'YOU FOUND IT!\n\n그때의 인터넷은 느렸지만, 상상력에는 속도 제한이 없었습니다.\n오늘의 비밀번호: stay-curious-1998\n' }
    ],
    settings: { ...DEFAULT_SETTINGS },
    iconPositions: {}
  };
}

function inspectStructure(input) {
  const seen = new WeakSet();
  const pending = [{ value: input, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) fail('백업에 순환 구조 또는 공유 객체가 있습니다.');
    seen.add(value);
    if (++count > 5000 || depth > 30) fail('백업 구조가 너무 복잡합니다.');
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) fail('지원하지 않는 백업 객체입니다.');
    for (const key of Object.keys(value)) {
      if (DANGEROUS.has(key.toLowerCase())) fail('백업에 허용되지 않는 속성 이름이 있습니다.');
      pending.push({ value: value[key], depth: depth + 1 });
    }
  }
}

function validateName(name) {
  if (typeof name !== 'string' || name.length < 1 || name.length > 80 || name !== name.trim() || /[\\/:*?"<>|\u0000-\u001f]/u.test(name) || name === '.' || name === '..' || DANGEROUS.has(name.toLowerCase())) fail('이름은 1~80자이며 경로 문자와 특수 예약어를 사용할 수 없습니다.');
  return name;
}

function validateContent(content) {
  if (typeof content !== 'string') fail('텍스트 파일에는 문자열만 저장할 수 있습니다.');
  if (bytes(content) > LIMITS.textBytes) fail('텍스트 파일 하나는 256KB를 넘을 수 없습니다.');
  return content;
}

export function normalizeState(input) {
  inspectStructure(input);
  if (!input || input.version !== 1) fail('지원하지 않는 백업 버전입니다. 버전 1 백업을 선택하세요.');
  if (!Array.isArray(input.nodes) || input.nodes.length > LIMITS.nodes || input.nodes.length < 5) fail('파일 목록이 올바르지 않습니다. 최대 600개까지 저장할 수 있습니다.');
  const ids = new Set();
  const nodes = input.nodes.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('파일 항목이 올바르지 않습니다.');
    if (typeof raw.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(raw.id) || DANGEROUS.has(raw.id.toLowerCase()) || ids.has(raw.id)) fail('파일 ID가 중복되거나 올바르지 않습니다.');
    ids.add(raw.id);
    if (raw.parentId !== null && (typeof raw.parentId !== 'string' || raw.parentId.length > 80)) fail('상위 폴더가 올바르지 않습니다.');
    if (!['folder', 'text'].includes(raw.type)) fail('지원하지 않는 파일 형식입니다.');
    const node = { id: raw.id, parentId: raw.parentId, name: validateName(raw.name), type: raw.type };
    if (raw.type === 'text') node.content = validateContent(raw.content ?? '');
    if (raw.trashed !== undefined && typeof raw.trashed !== 'boolean') fail('휴지통 상태가 올바르지 않습니다.');
    if (raw.trashed) node.trashed = true;
    if (raw.originalParentId !== undefined) {
      if (typeof raw.originalParentId !== 'string' || raw.originalParentId.length > 80) fail('복원 경로가 올바르지 않습니다.');
      node.originalParentId = raw.originalParentId;
    }
    return node;
  });
  const map = new Map(nodes.map(node => [node.id, node]));
  for (const id of SYSTEM_IDS) {
    const node = map.get(id);
    if (!node || node.type !== 'folder' || node.trashed || node.parentId !== (id === 'root' ? null : 'root')) fail('필수 시스템 폴더가 없거나 변경되었습니다.');
  }
  const siblingNames = new Set();
  for (const node of nodes) {
    if (node.id === 'root') continue;
    const key = `${node.parentId}\u0000${node.name.toLocaleLowerCase()}`;
    if (node.parentId !== 'trash' && siblingNames.has(key)) fail('같은 폴더에 중복된 이름이 있습니다.');
    siblingNames.add(key);
    const visited = new Set([node.id]);
    let parent = map.get(node.parentId);
    let depth = 1;
    let underTrash = false;
    while (parent) {
      if (parent.type !== 'folder') fail('상위 항목이 폴더가 아닙니다.');
      if (visited.has(parent.id)) fail('폴더를 자기 자신의 하위 폴더로 이동할 수 없습니다.');
      visited.add(parent.id);
      if (parent.id === 'trash') underTrash = true;
      if (parent.id === 'root') break;
      parent = map.get(parent.parentId);
      if (++depth > LIMITS.depth + 1) fail('폴더는 최대 8단계까지 만들 수 있습니다.');
    }
    if (!parent || parent.id !== 'root') fail('존재하지 않는 상위 폴더입니다.');
    if (depth - (underTrash ? 1 : 0) > LIMITS.depth) fail('폴더는 최대 8단계까지 만들 수 있습니다.');
    if (Boolean(node.trashed) !== underTrash) fail('휴지통 파일 경로가 올바르지 않습니다.');
    if (node.parentId === 'trash' && !node.originalParentId) fail('휴지통 파일의 복원 경로가 없습니다.');
  }
  const rawSettings = input.settings ?? {};
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) fail('설정이 올바르지 않습니다.');
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(settings)) if (rawSettings[key] !== undefined) settings[key] = rawSettings[key];
  if (!['classic', 'midnight', 'olive'].includes(settings.theme)) fail('지원하지 않는 테마입니다.');
  if (typeof settings.background !== 'string' || !/^#[\da-f]{6}$/i.test(settings.background)) fail('배경색이 올바르지 않습니다.');
  if (![32, 40, 48, 56, 64].includes(settings.iconSize)) fail('아이콘 크기가 올바르지 않습니다.');
  for (const key of ['animations', 'muted', 'hour24', 'autoArrange']) if (typeof settings[key] !== 'boolean') fail('설정 값이 올바르지 않습니다.');
  const rawPositions = input.iconPositions ?? {};
  if (!rawPositions || typeof rawPositions !== 'object' || Array.isArray(rawPositions) || Object.keys(rawPositions).length > 32) fail('아이콘 배치가 올바르지 않습니다.');
  const iconPositions = {};
  for (const [id, position] of Object.entries(rawPositions)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !position || typeof position !== 'object') fail('아이콘 위치가 올바르지 않습니다.');
    const { x, y } = position;
    if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 20000)) fail('아이콘 좌표가 범위를 벗어났습니다.');
    iconPositions[id] = { x, y };
  }
  const normalized = { version: 1, nodes, settings, iconPositions };
  if (bytes(JSON.stringify(normalized)) > LIMITS.backupBytes) fail('전체 저장 데이터는 2MB를 넘을 수 없습니다.');
  return normalized;
}

export function createFileSystem(state, onChange = () => {}) {
  const normalized = normalizeState(state);
  Object.assign(state, normalized);
  const listeners = new Set();
  const find = id => state.nodes.find(node => node.id === id) ?? fail('파일 또는 폴더를 찾을 수 없습니다.');
  const requireMutable = id => {
    const node = find(id);
    if (SYSTEM_IDS.has(id)) fail('시스템 폴더는 변경하거나 삭제할 수 없습니다.');
    return node;
  };
  const requireFolder = id => {
    const node = find(id);
    if (node.type !== 'folder' || node.trashed || id === 'trash') fail('저장 가능한 폴더를 선택하세요.');
    return node;
  };
  const descendants = id => {
    const set = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of state.nodes) if (set.has(node.parentId) && !set.has(node.id)) { set.add(node.id); changed = true; }
    }
    return set;
  };
  const commit = (nodes, resultId, action) => {
    const next = normalizeState({ ...state, nodes });
    state.nodes = next.nodes;
    const event = { action, id: resultId, state };
    try { onChange(state, event); } catch { /* A view error cannot undo a valid filesystem transaction. */ }
    for (const listener of listeners) { try { listener(event); } catch { /* Keep independent subscribers isolated. */ } }
    return cloneNode(state.nodes.find(node => node.id === resultId));
  };
  const api = {
    state,
    get(id) { return cloneNode(state.nodes.find(node => node.id === id)); },
    list(parentId = 'root') {
      const parent = find(parentId);
      if (parent.type !== 'folder') fail('폴더만 열 수 있습니다.');
      return state.nodes.filter(node => node.parentId === parentId).map(cloneNode).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ko') : a.type === 'folder' ? -1 : 1));
    },
    path(id) {
      let node = find(id);
      const parts = [];
      while (node.id !== 'root') { parts.unshift(node.name); node = find(node.parentId); }
      return '/' + parts.join('/');
    },
    resolve(path, cwd = 'root') {
      if (typeof path !== 'string' || path.length > 1000 || /\u0000/.test(path)) fail('경로가 올바르지 않습니다.');
      const clean = path.replace(/\\/g, '/').replace(/^[cC]:/, '');
      let current = find(clean.startsWith('/') ? 'root' : cwd);
      for (const part of clean.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') { current = find(current.parentId ?? 'root'); continue; }
        if (current.type !== 'folder') fail('폴더가 아닌 경로입니다.');
        const next = state.nodes.find(node => node.parentId === current.id && node.name.toLocaleLowerCase() === part.toLocaleLowerCase());
        if (!next) fail('경로를 찾을 수 없습니다.');
        current = next;
      }
      return cloneNode(current);
    },
    create(parentId, name, type = 'text', content = '') {
      requireFolder(parentId);
      validateName(name);
      if (!['folder', 'text'].includes(type)) fail('지원하지 않는 파일 형식입니다.');
      const id = globalThis.crypto?.randomUUID?.() ?? `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      const node = { id, parentId, name, type };
      if (type === 'text') node.content = validateContent(content);
      return commit([...state.nodes, node], id, 'create');
    },
    write(id, content) {
      const node = requireMutable(id);
      if (node.type !== 'text' || node.trashed) fail('사용 가능한 텍스트 파일을 선택하세요.');
      validateContent(content);
      return commit(state.nodes.map(item => item.id === id ? { ...item, content } : item), id, 'write');
    },
    rename(id, name) {
      const node = requireMutable(id);
      if (node.trashed) fail('휴지통의 파일을 먼저 복원하세요.');
      validateName(name);
      return commit(state.nodes.map(item => item.id === id ? { ...item, name } : item), id, 'rename');
    },
    move(id, parentId) {
      const node = requireMutable(id);
      if (node.trashed) fail('휴지통의 파일을 먼저 복원하세요.');
      requireFolder(parentId);
      if (descendants(id).has(parentId)) fail('자기 자신이나 하위 폴더로 이동할 수 없습니다.');
      return commit(state.nodes.map(item => item.id === id ? { ...item, parentId } : item), id, 'move');
    },
    trash(id) {
      const node = requireMutable(id);
      if (node.trashed) return cloneNode(node);
      const selected = descendants(id);
      return commit(state.nodes.map(item => !selected.has(item.id) ? item : item.id === id ? { ...item, parentId: 'trash', originalParentId: item.parentId, trashed: true } : { ...item, trashed: true }), id, 'trash');
    },
    restore(id) {
      const node = requireMutable(id);
      if (!node.trashed || node.parentId !== 'trash') fail('휴지통에서 복원할 항목을 선택하세요.');
      const oldParent = state.nodes.find(item => item.id === node.originalParentId && item.type === 'folder' && !item.trashed && item.id !== 'trash');
      const parentId = oldParent?.id ?? 'documents';
      const selected = descendants(id);
      return commit(state.nodes.map(item => {
        if (!selected.has(item.id)) return item;
        const restored = { ...item };
        delete restored.trashed;
        if (item.id === id) { restored.parentId = parentId; delete restored.originalParentId; }
        return restored;
      }), id, 'restore');
    },
    remove(id) {
      const node = requireMutable(id);
      if (!node.trashed || node.parentId !== 'trash') fail('완전 삭제는 휴지통에서만 할 수 있습니다.');
      const selected = descendants(id);
      commit(state.nodes.filter(item => !selected.has(item.id)), id, 'remove');
      return cloneNode(node);
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { listeners.clear(); }
  };
  return api;
}
