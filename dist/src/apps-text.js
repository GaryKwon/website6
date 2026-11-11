const labelFor = type => ({folder:'폴더',text:'텍스트 문서'}[type] || type);
function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function iconElement(services, name, size = 24) {
  const node = element('span', 'app-icon');
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = services.icon(name, size);
  return node;
}
function button(text, action, signal, className = 'bevel-button') {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action, {signal});
  return node;
}
function safeAction(services, action) {
  return async () => { try { await action(); } catch (error) { services.notify(error.message || '작업을 완료하지 못했습니다.'); } };
}
function textSize(text) { return new TextEncoder().encode(text).length; }
function tokenize(source) {
  const args = [];
  let current = '', quote = '', started = false;
  for (const char of source.trim()) {
    if (quote) { if (char === quote) quote = ''; else current += char; started = true; }
    else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) { args.push(current); current = ''; started = false; } }
    else { current += char; started = true; }
  }
  if (quote) throw new Error('따옴표를 닫아 주세요.');
  if (started) args.push(current);
  return args;
}

function explorer(options) {
  let container, services, controller, unsubscribe;
  let folderId = options.folderId || 'root', selectedId = null, history = [], historyIndex = -1;
  let grid, address, status, back, forward, up, selectionLabel;
  const navigate = (id, addHistory = true) => {
    const node = services.vfs.get(id);
    if (!node || node.type !== 'folder') throw new Error('폴더를 찾을 수 없습니다.');
    folderId = id; selectedId = null;
    if (addHistory) { history = history.slice(0, historyIndex + 1); history.push(id); historyIndex = history.length - 1; }
    render();
  };
  const selected = () => {
    const node = services.vfs.get(selectedId);
    if (!node) throw new Error('먼저 파일이나 폴더를 선택해 주세요.');
    return node;
  };
  const open = node => {
    if (node.trashed || folderId === 'trash') { services.notify('휴지통의 항목을 먼저 복원해 주세요.'); return; }
    if (node.type === 'folder') navigate(node.id);
    else services.openApp('notepad', {fileId:node.id});
  };
  const refreshSelection = () => {
    for (const item of grid.children) {
      const chosen = item.dataset.id === selectedId;
      item.classList.toggle('selected', chosen); item.setAttribute('aria-selected', String(chosen));
    }
    const node = services.vfs.get(selectedId);
    selectionLabel.textContent = node ? `${node.name} · ${labelFor(node.type)}` : '';
  };
  const render = () => {
    if (!services.vfs.get(folderId)) folderId = 'root';
    else if (services.vfs.get(folderId).trashed) folderId = 'trash';
    const folder = services.vfs.get(folderId);
    const items = services.vfs.list(folderId);
    services.setTitle(`${folderId === 'root' ? '가상 디스크 (R:)' : folder.name} — 파일 탐색기`);
    address.value = services.vfs.path(folderId);
    grid.replaceChildren();
    for (const node of items) {
      const item = element('button', 'file-item'); item.type = 'button'; item.dataset.id = node.id;
      item.setAttribute('role','option'); item.title = `${node.name} · ${labelFor(node.type)}`;
      item.append(iconElement(services, node.type === 'folder' ? (node.id === 'trash' ? 'trash' : 'folder') : 'notepad', 32), element('span','file-name',node.name));
      grid.append(item);
    }
    if (!items.length) {
      const empty = element('p','empty-folder', folderId === 'trash' ? '휴지통이 비어 있습니다.' : '이 폴더는 비어 있습니다.');
      empty.style.cssText = 'grid-column:1/-1;color:#777;padding:24px;text-align:center;'; grid.append(empty);
    }
    status.textContent = `R: · ${items.length}개 항목`;
    back.disabled = historyIndex <= 0; forward.disabled = historyIndex >= history.length - 1;
    up.disabled = folderId === 'root';
    refreshSelection();
    for (const entry of container.querySelectorAll('[data-folder]')) entry.classList.toggle('selected', entry.dataset.folder === folderId);
  };
  return {
    mount(target, provided) {
      container = target; services = provided; controller = new AbortController(); const {signal} = controller;
      container.style.cssText = 'display:flex;flex-direction:column;min-height:0;height:100%;';
      const toolbar = element('div','app-toolbar');
      back = button('← 뒤로',safeAction(services,()=>{historyIndex--;navigate(history[historyIndex],false);}),signal);
      forward = button('앞으로 →',safeAction(services,()=>{historyIndex++;navigate(history[historyIndex],false);}),signal);
      up = button('↑ 상위',safeAction(services,()=>navigate(services.vfs.get(folderId).parentId || 'root')),signal);
      for(const [node,name,label] of [[back,'back','뒤로'],[forward,'forward','앞으로'],[up,'up','상위']]){node.replaceChildren(iconElement(services,name,25),element('span','',label));node.classList.add('toolbar-button');}toolbar.append(back,forward,up);
      const actions = element('div','app-menu');
      const create = type => safeAction(services,async()=>{
        if (folderId === 'trash') throw new Error('휴지통에는 새 항목을 만들 수 없습니다.');
        const name = await services.modal({title:type==='folder'?'새 폴더':'새 텍스트 문서',message:'이름을 입력해 주세요.',input:true,defaultValue:type==='folder'?'새 폴더':'새 문서.txt',confirmText:'만들기'});
        if (typeof name !== 'string') return;
        selectedId = services.vfs.create(folderId,name,type,'').id; render();
      });
      actions.append(button('새 폴더',create('folder'),signal,'menu-button'),button('새 문서',create('text'),signal,'menu-button'));
      const rename = safeAction(services,async()=>{
        const node = selected();
        const name = await services.modal({title:'이름 바꾸기',message:'새 이름을 입력해 주세요.',input:true,defaultValue:node.name,confirmText:'변경'});
        if (typeof name === 'string') services.vfs.rename(node.id,name);
      });
      const remove = safeAction(services,async()=>{
        const node = selected();
        const permanent = folderId === 'trash';
        if (await services.modal({title:permanent?'영구 삭제':'휴지통으로 이동',message:`“${node.name}”${permanent?'을(를) 영구 삭제할까요? 복구할 수 없습니다.':'을(를) 휴지통으로 이동할까요?'}`,confirmText:permanent?'영구 삭제':'이동'})) {
          if (permanent) services.vfs.remove(node.id); else services.vfs.trash(node.id);
          selectedId = null; render();
        }
      });
      actions.append(button('이름 바꾸기',rename,signal,'menu-button'),button('삭제',remove,signal,'menu-button'));
      actions.append(button('이동…',safeAction(services,async()=>{
        const node=selected();
        const path = await services.modal({title:'항목 이동',message:'대상 폴더의 가상 경로를 입력해 주세요.',input:true,defaultValue:services.vfs.path('documents'),confirmText:'이동'});
        if(typeof path !== 'string') return;
        const destination=services.vfs.resolve(path,folderId);
        if(!destination || destination.type!=='folder') throw new Error('대상 폴더가 없습니다.');
        services.vfs.move(node.id,destination.id);
      }),signal,'menu-button'));
      actions.append(button('복원',safeAction(services,()=>{const node=selected();if(folderId!=='trash')throw new Error('휴지통에서 복원할 항목을 선택해 주세요.');services.vfs.restore(node.id);selectedId=null;render();}),signal,'menu-button'));
      const addressRow=element('form','explorer-address'); addressRow.style.cssText='display:flex;gap:7px;align-items:center;padding:6px;';
      const addressLabel=element('label','','주소'); address=element('input','recessed');address.setAttribute('aria-label','가상 폴더 경로');address.style.cssText='flex:1;min-width:0;padding:4px;';
      const go=button('이동',()=>addressRow.requestSubmit(),signal);
      addressRow.append(addressLabel,address,go);
      addressRow.addEventListener('submit',event=>{event.preventDefault();safeAction(services,()=>{const node=services.vfs.resolve(address.value,folderId);if(!node)throw new Error('경로를 찾을 수 없습니다.');open(node);})();},{signal});
      const shell=element('div','explorer-shell'); shell.style.cssText='display:flex;flex:1;min-height:0;margin:0 4px 4px;';
      const sidebar=element('nav','explorer-sidebar');sidebar.setAttribute('aria-label','기본 폴더');sidebar.style.cssText='width:145px;flex-shrink:0;padding:14px 8px;background:#e6e6d9;border-right:1px solid #888;overflow:auto;';
      for(const [id,name,icon] of [['root','가상 디스크','drive'],['documents','내 문서','folder'],['pictures','그림','paint'],['games','게임','mines'],['trash','휴지통','trash']]) {
        const entry=button('',safeAction(services,()=>navigate(id)),signal,'folder-link');entry.dataset.folder=id;entry.append(iconElement(services,icon,18),element('span','',name));sidebar.append(entry);
      }
      grid=element('div','file-grid recessed');grid.style.cssText='flex:1;min-width:0;overflow:auto;align-content:start;display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:7px;background:white;padding:14px;';
      grid.setAttribute('role','listbox');grid.setAttribute('aria-label','폴더 내용');grid.tabIndex=0;
      grid.addEventListener('click',event=>{const item=event.target.closest('[data-id]');if(!item)return;selectedId=item.dataset.id;refreshSelection();if(matchMedia('(pointer: coarse)').matches)open(services.vfs.get(selectedId));},{signal});
      grid.addEventListener('dblclick',event=>{const item=event.target.closest('[data-id]');if(item)open(services.vfs.get(item.dataset.id));},{signal});
      grid.addEventListener('contextmenu',event=>{const item=event.target.closest('[data-id]');if(item){event.preventDefault();selectedId=item.dataset.id;refreshSelection();services.notify('위 메뉴에서 이름 바꾸기 · 이동 · 삭제를 선택하세요.');}},{signal});
      grid.addEventListener('keydown',event=>{const item=event.target.closest('[data-id]');if(item)selectedId=item.dataset.id;if(event.key==='Enter'&&selectedId){event.preventDefault();open(selected());}if(event.key==='Delete'){event.preventDefault();remove();}if(event.key==='F2'){event.preventDefault();rename();}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){const items=[...grid.querySelectorAll('[data-id]')];if(!items.length)return;event.preventDefault();const index=items.findIndex(node=>node.dataset.id===selectedId);const next=items[Math.max(0,Math.min(items.length-1,index+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)))];selectedId=next.dataset.id;refreshSelection();next.focus();}},{signal});
      shell.append(sidebar,grid);const footer=element('div','statusbar');status=element('span');selectionLabel=element('span');footer.append(status,selectionLabel);
      container.append(actions,toolbar,addressRow,shell,footer);
      unsubscribe=services.vfs.subscribe(render);navigate(folderId);
    },
    unmount(){controller?.abort();unsubscribe?.();container?.replaceChildren();}
  };
}

function notepad(options) {
  let container,services,controller,textarea,status,fileId=options.fileId || null,dirty=false,savedContent='',busy=false,unsubscribe;
  const title=()=>{const file=fileId&&services.vfs.get(fileId);return `${dirty?'* ':''}${file?.name || '제목 없음'} — 메모장`;};
  const update=()=>{services.setTitle(title());services.setDirty(dirty);const before=textarea.value.slice(0,textarea.selectionStart);status.textContent=`줄 ${before.split('\n').length}, 열 ${(before.split('\n').at(-1)||'').length+1}  ·  ${textSize(textarea.value).toLocaleString()} B  ·  ${dirty?'수정됨':'저장됨'}`;};
  const load=id=>{const file=services.vfs.get(id);if(!file||file.type!=='text'||file.trashed)throw new Error('열 수 있는 텍스트 파일이 아닙니다.');fileId=id;textarea.value=file.content || '';savedContent=textarea.value;dirty=false;update();};
  const save=async asNew=>{
    if(textSize(textarea.value)>256*1024)throw new Error('문서는 256KB까지 저장할 수 있습니다. 내용을 줄여 주세요.');
    if(!fileId||asNew||!services.vfs.get(fileId)){
      const name=await services.modal({title:'다른 이름으로 저장',message:'내 문서 폴더에 저장할 파일 이름을 입력하세요.',input:true,defaultValue:services.vfs.get(fileId)?.name || '새 문서.txt',confirmText:'저장'});
      if(typeof name!=='string')return false;
      fileId=services.vfs.create('documents',name,'text',textarea.value).id;
    }else services.vfs.write(fileId,textarea.value);
    savedContent=textarea.value;dirty=false;update();services.notify('저장했습니다.');return true;
  };
  const discard=async()=>!dirty || Boolean(await services.modal({title:'저장하지 않은 변경사항',message:'저장하지 않은 변경사항을 버릴까요? 계속 편집하려면 취소하세요.',confirmText:'변경사항 버리기',cancelText:'계속 편집'}));
  const action=fn=>safeAction(services,async()=>{if(busy)return;busy=true;try{await fn();}finally{busy=false;}});
  return {
    mount(target,provided){container=target;services=provided;controller=new AbortController();const {signal}=controller;
      container.style.cssText='display:flex;flex-direction:column;min-height:0;height:100%;';
      const menu=element('div','app-menu');
      menu.append(button('새 문서',action(async()=>{if(!await discard())return;fileId=null;textarea.value='';savedContent='';dirty=false;update();textarea.focus();}),signal,'menu-button'));
      menu.append(button('열기…',action(async()=>{
        if(!await discard())return;
        const candidates=[];const visit=id=>{for(const file of services.vfs.list(id)){if(file.id==='trash')continue;if(file.type==='text')candidates.push(file);else if(!file.trashed)visit(file.id);}};visit('root');
        if(!candidates.length)throw new Error('열 수 있는 텍스트 파일이 없습니다.');
        const path=await services.modal({title:'텍스트 파일 열기',message:'파일 탐색기에 표시된 가상 파일 경로를 입력하세요.',input:true,defaultValue:services.vfs.path(candidates[0].id),confirmText:'열기'});
        if(typeof path!=='string')return;const node=services.vfs.resolve(path,'root');if(!node)throw new Error('파일을 찾을 수 없습니다.');load(node.id);
      }),signal,'menu-button'));
      menu.append(button('저장',action(()=>save(false)),signal,'menu-button'),button('다른 이름으로 저장',action(()=>save(true)),signal,'menu-button'));
      menu.append(button('다운로드',action(()=>{services.download(services.vfs.get(fileId)?.name||'새 문서.txt',textarea.value,'text/plain;charset=utf-8');}),signal,'menu-button'));
      const toolbar=element('div','app-toolbar');
      toolbar.append(button('↶ 실행 취소',()=>{textarea.focus();document.execCommand('undo');},signal),button('↷ 다시 실행',()=>{textarea.focus();document.execCommand('redo');},signal));
      textarea=element('textarea','notepad-editor recessed');textarea.setAttribute('aria-label','메모장 문서 내용');textarea.spellcheck=false;textarea.style.cssText='flex:1;resize:none;min-height:0;margin:0 4px;padding:16px;background:#fffffa;color:#171717;font:16px/1.5 "NeoDunggeunmo",monospace;border-radius:0;white-space:pre;tab-size:4;';
      textarea.addEventListener('input',()=>{dirty=textarea.value!==savedContent;update();},{signal});textarea.addEventListener('keyup',update,{signal});textarea.addEventListener('click',update,{signal});
      textarea.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();action(()=>save(event.shiftKey))();}if(event.key==='Tab'){event.preventDefault();textarea.setRangeText('  ',textarea.selectionStart,textarea.selectionEnd,'end');dirty=textarea.value!==savedContent;update();}},{signal});
      const footer=element('div','statusbar');status=element('span');footer.append(status,element('span','','텍스트 문서 · UTF-8'));container.append(menu,toolbar,textarea,footer);
      if(fileId){try{load(fileId);}catch(error){fileId=null;services.notify(error.message);update();}}else update();
      unsubscribe=services.vfs.subscribe(()=>{if(!dirty&&fileId&&services.vfs.get(fileId)&&!services.vfs.get(fileId).trashed)load(fileId);else update();});
    },
    beforeClose(){return discard();},
    unmount(){controller?.abort();unsubscribe?.();container?.replaceChildren();}
  };
}

function terminal() {
  let container,services,controller,output,input,prompt,cwd='root',history=[],historyIndex=0;
  const print=(message='')=>{
    for(const text of String(message).split('\n').slice(-500)){const line=element('div','terminal-line',text || '\u00a0');output.append(line);}
    while(output.childElementCount>500)output.firstElementChild.remove();output.scrollTop=output.scrollHeight;
  };
  const command=source=>{
    if(!source.trim())return;
    if(!services.vfs.get(cwd) || services.vfs.get(cwd).trashed) cwd='root';
    history.push(source.slice(0,4096));if(history.length>100)history.shift();historyIndex=history.length;
    print(`${services.vfs.path(cwd)}> ${source}`);
    const [raw,...args]=tokenize(source), cmd=(raw || '').toLowerCase(), joined=args.join(' ');
    const target=()=>{const file=services.vfs.resolve(joined,cwd);if(!file||file.trashed)throw new Error('경로를 찾을 수 없습니다.');return file;};
    switch(cmd){
      case 'help':print('사용할 수 있는 명령어\nhelp                  도움말\ndir / ls              현재 폴더 목록\ncd <경로>             폴더 이동 (.. / 지원)\ncat / type <파일>     텍스트 읽기\necho <내용>           텍스트 출력\ndate / time           현재 날짜 / 시간\ntheme classic|midnight|olive  테마 변경\nclear                 화면 지우기\nabout                 RETRO OS 정보\nexit                  터미널 닫기\n공백이 있는 경로는 "따옴표"로 감싸세요.');break;
      case 'date':print(new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'}));break;
      case 'time':print(new Date().toLocaleTimeString('ko-KR'));break;
      case 'dir':case 'ls':{const node=joined?target():services.vfs.get(cwd);if(node.type!=='folder')throw new Error('폴더 경로를 입력해 주세요.');print(` ${services.vfs.path(node.id)} 의 디렉터리\n`);const nodes=services.vfs.list(node.id);print(nodes.length?nodes.map(file=>`${file.type==='folder'?'<DIR>':'     '}  ${file.name}`).join('\n'):'(비어 있음)');print(`\n${nodes.length}개 항목`);break;}
      case 'cd':{if(!joined){print(services.vfs.path(cwd));break;}const node=target();if(node.type!=='folder')throw new Error('폴더가 아닙니다.');cwd=node.id;break;}
      case 'cat':case 'type':{const node=target();if(node.type!=='text')throw new Error('텍스트 파일이 아닙니다.');print(node.content||'');break;}
      case 'clear':output.replaceChildren();break;
      case 'echo':print(joined);break;
      case 'theme':{const theme=args[0]==='night'?'midnight':args[0]==='sand'?'olive':args[0];if(!['classic','midnight','olive'].includes(theme))throw new Error('theme classic, theme midnight, theme olive 중 하나를 입력하세요.');services.saveSettings({theme});print(`테마가 ${theme}(으)로 변경되었습니다.`);break;}
      case 'about':print('RETRO OS [Version 98.11]\n가상 파일 시스템 · 명령 프롬프트');break;
      case 'nostalgia':case 'stargaze':print('      ✦         .         *\n .         /\\       ✧\n      ____/  \\____\n      \\        /    .\n       /  /\\  \\       ✦\n   *   \\/    \\/\n\n당신의 작은 우주에 오신 것을 환영합니다.');break;
      case 'exit':services.close();break;
      default:throw new Error(`알 수 없는 명령: ${raw}. help를 입력해 보세요.`);
    }
    if(prompt)prompt.textContent=`${services.vfs.path(cwd)}> `;
  };
  return {
    mount(target,provided){container=target;services=provided;controller=new AbortController();const {signal}=controller;
      container.classList.add('terminal-shell');container.style.cssText='display:flex;flex-direction:column;min-height:0;height:100%;background:#101311;color:#d3e8d0;font:16px/1.5 "NeoDunggeunmo",monospace;';
      const menu=element('div','app-menu');menu.style.cssText='background:#c0c0c0;color:#111;';menu.append(button('도움말',()=>command('help'),signal,'menu-button'),button('화면 지우기',()=>command('clear'),signal,'menu-button'));
      output=element('div','terminal-output');output.style.cssText='flex:1;min-height:0;overflow:auto;padding:15px;white-space:pre-wrap;overflow-wrap:anywhere;';output.setAttribute('role','log');output.setAttribute('aria-label','터미널 출력');output.setAttribute('aria-live','off');
      const form=element('form','terminal-command');form.style.cssText='display:flex;gap:5px;padding:0 15px 15px;align-items:center;';prompt=element('label','','/> ');prompt.htmlFor=`terminal-input-${Math.random().toString(36).slice(2)}`;
      input=element('input');input.id=prompt.htmlFor;input.setAttribute('aria-label','가상 터미널 명령');input.autocomplete='off';input.spellcheck=false;input.maxLength=4096;input.style.cssText='flex:1;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;';
      form.append(prompt,input);form.addEventListener('submit',event=>{event.preventDefault();const source=input.value;input.value='';try{command(source);}catch(error){print(`오류: ${error.message}`);}input.focus();},{signal});
      input.addEventListener('keydown',event=>{if(event.key==='ArrowUp'){event.preventDefault();historyIndex=Math.max(0,historyIndex-1);input.value=history[historyIndex]||'';}if(event.key==='ArrowDown'){event.preventDefault();historyIndex=Math.min(history.length,historyIndex+1);input.value=history[historyIndex]||'';}},{signal});
      container.append(menu,output,form);print('RETRO OS 명령 프롬프트\n');prompt.textContent=`${services.vfs.path(cwd)}> `;
    },
    runCommand(source){try{command(String(source).slice(0,4096));}catch(error){print(`오류: ${error.message}`);}},
    unmount(){controller?.abort();history=[];container?.replaceChildren();}
  };
}

export function createTextApp(type,options={}) {
  if(type==='explorer')return explorer(options);
  if(type==='notepad')return notepad(options);
  if(type==='terminal')return terminal(options);
  throw new Error(`지원하지 않는 앱: ${type}`);
}
