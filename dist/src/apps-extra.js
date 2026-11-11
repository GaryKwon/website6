const PALETTE = ['#000000','#808080','#800000','#808000','#008000','#008080','#000080','#800080','#ffffff','#c0c0c0','#ff0000','#ffff00','#00ff00','#00ffff','#0000ff','#ff00ff'];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, label = text) {
  const node = element('button', 'bevel-button', text);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  return node;
}

function listen(node, type, handler, signal, options = {}) {
  node.addEventListener(type, handler, { ...options, signal });
}

function approved(value) { return value !== null && value !== false && value !== undefined; }

function createPaintApp() {
  let controller, observer, canvas, context, services, history = [], active = null, alive = false;
  let tool = 'brush', color = '#000000', lineWidth = 4, width = 0, height = 0, dpr = 1, dirty = false;
  let status, undoButton, toolButtons = [], colorButtons = [];

  function setDirty(value = true) { dirty = value; services.setDirty(value); }
  function saveSnapshot() {
    if (!width || !height) return;
    history.push(context.getImageData(0, 0, canvas.width, canvas.height));
    if (history.length > 8) history.shift();
    undoButton.disabled = history.length === 0;
  }
  function restoreSnapshot(snapshot) { if (snapshot) context.putImageData(snapshot, 0, 0); }
  function updateStatus(message) { status.textContent = message || `${width} × ${height} 픽셀`; }
  function coordinates(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(width, (event.clientX - bounds.left) * width / Math.max(1, bounds.width))), y: Math.max(0, Math.min(height, (event.clientY - bounds.top) * height / Math.max(1, bounds.height))) };
  }
  function draw(from, to, dot = false) {
    context.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    context.fillStyle = context.strokeStyle;
    context.lineWidth = tool === 'eraser' ? lineWidth * 4 : lineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (tool === 'rect') {
      context.strokeRect(from.x, from.y, to.x - from.x, to.y - from.y);
    } else if (dot) {
      context.beginPath(); context.arc(to.x, to.y, context.lineWidth / 2, 0, Math.PI * 2); context.fill();
    } else {
      context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke();
    }
  }
  function endPointer(event, cancel = false) {
    if (!active || (event && event.pointerId !== active.id)) return;
    if (cancel) { restoreSnapshot(history.pop()); undoButton.disabled = history.length === 0; }
    else setDirty();
    const pointerId = active.id;
    active = null;
    if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    updateStatus();
  }
  function resize() {
    if (!alive || active) return;
    const targetWidth = Math.max(96, Math.min(640, Math.floor(canvas.parentElement.clientWidth - 14)));
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetHeight = Math.round(targetWidth * 0.5625);
    if (targetWidth === width && targetHeight === height && nextDpr === dpr) return;
    const copy = document.createElement('canvas');
    if (width && height) { copy.width = canvas.width; copy.height = canvas.height; copy.getContext('2d').drawImage(canvas, 0, 0); }
    width = targetWidth; height = targetHeight; dpr = nextDpr;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
    if (copy.width) context.drawImage(copy, 0, 0, width, height);
    copy.width = 0; copy.height = 0;
    history.length = 0;
    undoButton.disabled = true;
    updateStatus();
  }

  return {
    mount(container, inputServices) {
      services = inputServices; alive = true; controller = new AbortController();
      const signal = controller.signal;
      container.classList.add('paint-app');
      const menu = element('div', 'app-menu');
      const exportButton = button('PNG로 저장', '그림을 PNG 파일로 다운로드');
      undoButton = button('실행 취소', '마지막 그리기 취소'); undoButton.disabled = true;
      const clearButton = button('새 그림');
      menu.append(exportButton, undoButton, clearButton);
      const main = element('div', 'paint-workspace');
      const tools = element('div', 'paint-tools'); tools.setAttribute('aria-label', '그림 도구');
      for (const [id, glyph, label] of [['brush','✎','브러시'],['eraser','▱','지우개'],['line','╱','직선'],['rect','□','사각형']]) {
        const node = button(glyph, label); node.title = label; node.dataset.tool = id; node.setAttribute('aria-pressed', String(id === tool));
        listen(node, 'click', () => { tool = id; toolButtons.forEach(item => item.setAttribute('aria-pressed', String(item.dataset.tool === id))); updateStatus(`${label} 선택됨`); }, signal);
        toolButtons.push(node); tools.append(node);
      }
      const widthLabel = element('label', 'paint-width', '굵기');
      const widthSelect = element('select'); widthSelect.setAttribute('aria-label', '브러시 굵기');
      for (const value of [1,2,4,8,16]) { const option = element('option', '', `${value}px`); option.value = String(value); option.selected = value === lineWidth; widthSelect.append(option); }
      listen(widthSelect, 'change', () => { lineWidth = Number(widthSelect.value); }, signal);
      widthLabel.append(widthSelect); tools.append(widthLabel);
      const stage = element('div', 'paint-stage recessed');
      canvas = element('canvas', 'paint-canvas'); canvas.setAttribute('aria-label', '그림판 캔버스. 도구와 색상을 선택한 뒤 포인터로 그립니다.'); canvas.tabIndex = 0;
      context = canvas.getContext('2d', { willReadFrequently: true });
      stage.append(canvas); main.append(tools, stage);
      const palette = element('div', 'paint-palette'); palette.setAttribute('aria-label', '색상 팔레트');
      const swatch = element('span', 'paint-current recessed'); swatch.style.background = color; swatch.setAttribute('aria-label', '현재 색상');
      palette.append(swatch);
      const colors = element('div', 'paint-colors');
      for (const value of PALETTE) {
        const node = button('', `색상 ${value}`); node.classList.add('paint-color'); node.style.backgroundColor = value; node.setAttribute('aria-pressed', String(value === color));
        listen(node, 'click', () => { color = value; swatch.style.background = value; colorButtons.forEach(item => item.setAttribute('aria-pressed', String(item === node))); }, signal);
        colorButtons.push(node); colors.append(node);
      }
      const custom = element('input'); custom.type = 'color'; custom.value = color; custom.setAttribute('aria-label','사용자 지정 색상');
      listen(custom, 'input', () => { color = custom.value; swatch.style.background = color; colorButtons.forEach(item => item.setAttribute('aria-pressed', 'false')); }, signal);
      palette.append(colors, custom);
      status = element('div','statusbar'); status.setAttribute('aria-live','polite');
      container.append(menu, main, palette, status);
      listen(canvas, 'pointerdown', event => {
        if (event.button !== 0 || active || !width) return;
        event.preventDefault(); canvas.focus(); saveSnapshot();
        const point = coordinates(event);
        active = { id: event.pointerId, start: point, previous: point };
        canvas.setPointerCapture(event.pointerId);
        if (tool === 'brush' || tool === 'eraser') draw(point, point, true);
      }, signal);
      listen(canvas, 'pointermove', event => {
        if (!active || active.id !== event.pointerId) return;
        const point = coordinates(event);
        if (tool === 'line' || tool === 'rect') { restoreSnapshot(history.at(-1)); draw(active.start, point); }
        else draw(active.previous, point);
        active.previous = point;
      }, signal);
      listen(canvas,'pointerup', event => endPointer(event), signal);
      listen(canvas,'pointercancel', event => endPointer(event, true), signal);
      listen(canvas,'lostpointercapture', event => { if (active?.id === event.pointerId) endPointer(event, true); }, signal);
      listen(undoButton,'click', () => { restoreSnapshot(history.pop()); undoButton.disabled = history.length === 0; setDirty(); }, signal);
      listen(clearButton,'click', async () => {
        const result = await services.modal({title:'새 그림',message:'현재 그림을 지우고 새로 시작할까요? PNG로 저장하지 않은 그림은 사라집니다.',confirmText:'지우기',cancelText:'취소'});
        if (!alive || !approved(result)) return;
        saveSnapshot(); context.fillStyle = '#ffffff'; context.fillRect(0,0,width,height); setDirty();
      }, signal);
      listen(exportButton,'click', () => {
        canvas.toBlob(blob => {
          if (!alive || !blob) return;
          services.download('retro-paint.png', blob, 'image/png'); setDirty(false); services.notify('그림을 PNG 파일로 내보냈습니다.');
        }, 'image/png');
      }, signal);
      listen(container,'keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (!undoButton.disabled) undoButton.click(); } }, signal);
      resize();
      observer = new ResizeObserver(resize); observer.observe(stage);
    },
    async beforeClose() {
      if (!dirty) return true;
      return approved(await services.modal({title:'그림판',message:'저장하지 않은 그림이 있습니다. 창을 닫으면 그림이 사라집니다.',confirmText:'닫기',cancelText:'계속 그리기'}));
    },
    unmount() {
      if (!alive) return;
      alive = false; endPointer(null, true); controller.abort(); observer?.disconnect(); history.length = 0;
      canvas.width = 0; canvas.height = 0; context = null; canvas = null; toolButtons.length = 0; colorButtons.length = 0;
    }
  };
}

export function createMinefield(size = 9, mineCount = 10, safeIndex = 40, random = Math.random) {
  const cells = Array.from({length:size * size}, () => ({mine:false,count:0,revealed:false,flagged:false}));
  const neighbors = index => {
    const x = index % size, y = Math.floor(index / size), result = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || y + dy < 0 || x + dx >= size || y + dy >= size) continue;
      result.push((y + dy) * size + x + dx);
    }
    return result;
  };
  const safe = new Set([safeIndex,...neighbors(safeIndex)]);
  const candidates = cells.map((_,index) => index).filter(index => !safe.has(index));
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    [candidates[i],candidates[j]] = [candidates[j],candidates[i]];
  }
  for (const index of candidates.slice(0, Math.min(mineCount,candidates.length))) cells[index].mine = true;
  cells.forEach((cell,index) => { cell.count = neighbors(index).filter(near => cells[near].mine).length; });
  return {cells,neighbors};
}

export function createMinesGame(random = Math.random) {
  let state, neighbors;
  function reset() {
    state = { cells:Array.from({length:81}, () => ({mine:false,count:0,revealed:false,flagged:false})), started:false, ended:false, won:false, moves:0 };
    return state;
  }
  function flag(index) {
    if (!Number.isInteger(index) || index < 0 || index >= 81 || state.ended || state.cells[index].revealed) return false;
    const cell = state.cells[index];
    if (!cell.flagged && state.cells.filter(item => item.flagged).length >= 10) return false;
    cell.flagged = !cell.flagged;
    return true;
  }
  function reveal(index) {
    if (!Number.isInteger(index) || index < 0 || index >= 81 || state.ended || state.cells[index].revealed || state.cells[index].flagged) return false;
    if (!state.started) {
      const flags = state.cells.map(cell => cell.flagged);
      const field = createMinefield(9,10,index,random);
      state.cells = field.cells; neighbors = field.neighbors;
      state.cells.forEach((cell,i) => { cell.flagged = flags[i]; }); state.started = true;
    }
    state.moves++;
    if (state.cells[index].mine) {
      state.cells.forEach(cell => { if (cell.mine) { cell.revealed = true; cell.flagged = false; } });
      state.ended = true;
      return true;
    }
    const pending = [index];
    while (pending.length) {
      const current = pending.pop(), cell = state.cells[current];
      if (cell.revealed || cell.flagged || cell.mine) continue;
      cell.revealed = true;
      if (!cell.count) pending.push(...neighbors(current).filter(near => !state.cells[near].revealed));
    }
    if (state.cells.filter(cell => cell.revealed && !cell.mine).length === 71) {
      state.ended = true; state.won = true;
      state.cells.forEach(cell => { if (cell.mine) cell.flagged = true; });
    }
    return true;
  }
  reset();
  return {get state() {return state;}, reset, flag, reveal};
}

function createMinesApp() {
  let controller, alive = false, flagMode = false;
  const game = createMinesGame();
  let board, counter, moveDisplay, status, restart, flagButton, cellButtons = [];
  function reset() {
    game.reset(); flagMode = false;
    flagButton.setAttribute('aria-pressed','false'); restart.textContent = '☺';
    status.textContent = '지뢰 10개';
    render();
  }
  function render() {
    const {cells,ended,moves} = game.state;
    const flags = cells.filter(cell => cell.flagged).length;
    counter.textContent = String(10 - flags).padStart(3,'0'); moveDisplay.textContent = String(moves).padStart(3,'0');
    cellButtons.forEach((node,index) => {
      const cell = cells[index];
      node.className = `mine-cell ${cell.revealed ? 'revealed' : ''} ${cell.revealed && cell.mine ? 'exploded' : ''}`;
      node.textContent = cell.flagged ? '⚑' : cell.revealed ? (cell.mine ? '✹' : cell.count || '') : '';
      node.dataset.count = String(cell.count);
      node.setAttribute('aria-label', `${Math.floor(index/9)+1}행 ${index%9+1}열 ${cell.flagged ? '깃발' : cell.revealed ? cell.mine ? '지뢰' : `주변 지뢰 ${cell.count}개` : '열리지 않음'}`);
      node.setAttribute('aria-disabled', String(ended));
    });
  }
  function flag(index) {
    if (!game.flag(index)) return;
    render();
  }
  function reveal(index) {
    if (!game.reveal(index)) return;
    const {cells,ended,won,moves} = game.state;
    if (won) { restart.textContent = '☀'; status.textContent = `승리! ${moves}번 만에 모든 안전한 칸을 찾았습니다.`; }
    else if (ended) { restart.textContent = '☹'; status.textContent = '지뢰를 밟았습니다. 웃는 얼굴을 눌러 다시 도전하세요.'; }
    else status.textContent = `${cells.filter(cell => cell.revealed).length} / 71개의 안전한 칸을 찾았습니다.`;
    render();
  }
  return {
    mount(container) {
      alive = true; controller = new AbortController(); const signal = controller.signal;
      container.classList.add('mines-app');
      const menu = element('div','app-menu');
      const newButton = button('새 게임'); flagButton = button('⚑ 깃발 모드'); flagButton.setAttribute('aria-pressed','false');
      menu.append(newButton, flagButton);
      const content = element('div','mines-content');
      const panel = element('div','mine-score recessed');
      counter = element('output','mine-digits','010'); counter.setAttribute('aria-label','남은 깃발');
      restart = button('☺','지뢰찾기 다시 시작'); restart.classList.add('mine-restart');
      moveDisplay = element('output','mine-digits','000'); moveDisplay.setAttribute('aria-label','진행 횟수');
      panel.append(counter,restart,moveDisplay);
      board = element('div','mine-board recessed'); board.setAttribute('role','group'); board.setAttribute('aria-label','지뢰찾기 9 × 9');
      for (let index = 0; index < 81; index++) {
        const node = button(''); node.className = 'mine-cell'; node.dataset.index = String(index);
        listen(node,'click', () => flagMode ? flag(index) : reveal(index), signal);
        listen(node,'contextmenu', event => { event.preventDefault(); flag(index); }, signal);
        listen(node,'keydown', event => {
          let target = index;
          if (event.key === 'ArrowLeft') target = Math.max(0,index-1);
          else if (event.key === 'ArrowRight') target = Math.min(80,index+1);
          else if (event.key === 'ArrowUp') target = Math.max(0,index-9);
          else if (event.key === 'ArrowDown') target = Math.min(80,index+9);
          else if (event.key.toLowerCase() === 'f') { event.preventDefault(); flag(index); return; }
          else return;
          event.preventDefault(); cellButtons[target].focus();
        }, signal);
        board.append(node); cellButtons.push(node);
      }
      const legend = element('div','mine-legend','방향키 이동 · F 깃발');
      content.append(panel,board,legend);
      status = element('div','statusbar'); status.setAttribute('aria-live','polite');
      container.append(menu,content,status);
      listen(restart,'click', reset, signal); listen(newButton,'click', reset, signal);
      listen(flagButton,'click', () => { flagMode = !flagMode; flagButton.setAttribute('aria-pressed',String(flagMode)); status.textContent = flagMode ? '깃발 모드: 칸을 눌러 깃발을 놓거나 지우세요.' : '열기 모드: 칸을 눌러 열어보세요.'; }, signal);
      reset();
    },
    unmount() { if (!alive) return; alive = false; controller.abort(); game.reset(); cellButtons.length = 0; }
  };
}

function createSettingsApp() {
  let controller, services, alive = false;
  return {
    mount(container,inputServices) {
      alive = true; services = inputServices; controller = new AbortController(); const signal = controller.signal;
      container.classList.add('settings-app');
      const current = () => services.getSettings?.() || services.settings;
      const heading = element('div','settings-heading');
      const preview = element('div','settings-computer');
      preview.innerHTML = '<svg viewBox="0 0 64 56" aria-hidden="true"><path fill="#222" d="M7 2h50v36H7z"/><path fill="#ddd" d="M9 4h46v32H9z"/><path fill="#008080" d="M13 8h38v24H13z"/><path fill="#000080" d="M19 12h25v5H19z"/><path fill="#c0c0c0" d="M19 17h25v12H19zM26 38h12v7H26zM17 45h30v6H17z"/><path fill="#fff" d="M11 6h42v2H11zM19 46h26v1H19z"/></svg>';
      const headingText = element('div'); headingText.append(element('strong','','디스플레이')); heading.append(preview,headingText);
      const body = element('div','settings-scroll'); body.append(heading);
      const appearance = element('fieldset','settings-fieldset'); appearance.append(element('legend','','화면 배색'));
      const themeList = element('div','theme-list');
      const themeButtons = [];
      for (const [id,label,bg,title] of [['classic','클래식','#008080','#000080'],['midnight','미드나이트','#253244','#283d65'],['olive','올리브','#53644c','#35442d']]) {
        const node = button('',label); node.classList.add('theme-choice'); node.dataset.theme = id; node.setAttribute('aria-pressed',String(current().theme === id));
        const miniature = element('span','theme-miniature'); miniature.style.background = bg;
        const miniWindow = element('span','theme-mini-window'); const miniTitle = element('span'); miniTitle.style.background = title; miniWindow.append(miniTitle); miniature.append(miniWindow);
        node.append(miniature,element('span','',label)); themeButtons.push(node); themeList.append(node);
        listen(node,'click', () => { services.saveSettings({theme:id,background:bg}); bgInput.value = bg; themeButtons.forEach(item => item.setAttribute('aria-pressed',String(item === node))); },signal);
      }
      appearance.append(themeList);
      const bgLabel = element('label','settings-row','바탕화면 색상');
      const bgInput = element('input'); bgInput.type = 'color'; bgInput.value = current().background; bgInput.setAttribute('aria-label','바탕화면 색상'); bgLabel.append(bgInput);
      listen(bgInput,'input', () => services.saveSettings({background:bgInput.value}),signal);
      const sizeLabel = element('label','settings-row','바탕화면 아이콘'); const sizeInput = element('select'); sizeInput.setAttribute('aria-label','바탕화면 아이콘 크기');
      for (const [value,label] of [[32,'작게 · 32px'],[40,'보통 · 40px'],[48,'크게 · 48px']]) { const option = element('option','',label); option.value = String(value); option.selected = current().iconSize === value; sizeInput.append(option); }
      listen(sizeInput,'change', () => services.saveSettings({iconSize:Number(sizeInput.value)}),signal); sizeLabel.append(sizeInput); appearance.append(bgLabel,sizeLabel);
      const preferences = element('fieldset','settings-fieldset'); preferences.append(element('legend','','사용 환경'));
      for (const [key,label] of [['animations','창 애니메이션 사용'],['muted','시스템 소리 음소거'],['hour24','24시간 시계 사용']]) {
        const row = element('label','settings-check'); const input = element('input'); input.type = 'checkbox'; input.checked = Boolean(current()[key]);
        listen(input,'change', () => services.saveSettings({[key]:input.checked}),signal); row.append(input,document.createTextNode(label)); preferences.append(row);
      }
      preferences.append(element('p','settings-note','즉시 적용 · 열린 창 유지 · 창 위치는 저장하지 않음'));
      const backup = element('fieldset','settings-fieldset'); backup.append(element('legend','','백업 및 복구'));
      backup.append(element('p','settings-note','가상 파일·설정은 브라우저에 저장됩니다. 그림판은 PNG로 별도 저장합니다.'));
      const backupActions = element('div','settings-actions'); const exportButton = button('백업 내보내기'); const importButton = button('백업 가져오기'); const resetButton = button('데이터 초기화');
      const file = element('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
      listen(exportButton,'click', () => services.exportBackup(),signal);
      listen(importButton,'click', () => file.click(),signal);
      listen(file,'change', async () => { const selected = file.files?.[0]; file.value = ''; if (selected && alive) await services.importBackup(selected); },signal);
      listen(resetButton,'click', async () => {
        const result = await services.modal({title:'데이터 초기화',message:'가상 파일과 개인 설정을 처음 상태로 되돌릴까요? 먼저 백업을 내보내는 것을 권장합니다.',confirmText:'초기화',cancelText:'취소'});
        if (alive && approved(result)) services.resetData();
      },signal);
      backupActions.append(exportButton,importButton,resetButton,file); backup.append(backupActions);
      body.append(appearance,preferences,backup);
      const status = element('div','statusbar','자동 저장');
      container.append(body,status);
    },
    unmount() { if (!alive) return; alive = false; controller.abort(); }
  };
}

export function createExtraApp(type, options = {}) {
  if (type === 'paint') return createPaintApp(options);
  if (type === 'mines') return createMinesApp(options);
  if (type === 'settings') return createSettingsApp(options);
  throw new Error('알 수 없는 프로그램입니다.');
}
