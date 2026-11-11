import { createInitialState, normalizeState, LIMITS } from './state.js';
export const STORAGE_KEY = 'retro-os-v1';
const bytes = text => new TextEncoder().encode(text).byteLength;

export function parseBackup(text) {
  if (typeof text !== 'string' || bytes(text) > LIMITS.backupBytes) throw new Error('백업 파일은 2MB 이하의 JSON 텍스트여야 합니다.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('JSON 파일을 읽을 수 없습니다. 기존 데이터는 유지됩니다.'); }
  return normalizeState(parsed);
}

export function exportState(state) {
  return JSON.stringify(normalizeState(state));
}

export function loadState() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return { state: createInitialState(), warning: '' };
    return { state: parseBackup(raw), warning: '' };
  } catch {
    return { state: createInitialState(), warning: '이전 저장 데이터를 읽을 수 없어 기본 바탕화면을 열었습니다. 저장소 접근 권한 또는 백업 파일을 확인하세요.' };
  }
}

export function saveState(state) {
  try {
    if (!globalThis.localStorage) throw new Error('storage unavailable');
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
    return { ok: true, error: '' };
  } catch {
    return { ok: false, error: '브라우저에 저장하지 못했습니다. 저장 공간과 권한을 확인하거나 JSON 백업을 다운로드하세요.' };
  }
}

export function createAutosave(getState, onError = () => {}) {
  let timer = null;
  let destroyed = false;
  let pending = false;
  let lastError = '';
  function flush() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (destroyed || !pending) return { ok: true, error: '' };
    pending = false;
    const result = saveState(getState());
    if (!result.ok && result.error !== lastError) onError(result.error);
    lastError = result.error;
    return result;
  }
  return {
    schedule() {
      if (destroyed) return;
      pending = true;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, 700);
    },
    flush,
    destroy() { if (destroyed) return; flush(); destroyed = true; if (timer !== null) clearTimeout(timer); timer = null; }
  };
}
