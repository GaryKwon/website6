/**
 * Development-only browser verification; this file is not shipped by the site.
 * Start static server: npm run dev
 * Install runner: npm install --no-save playwright && npx playwright install chromium
 * Run: node tests/browser-e2e.mjs
 * Engines: BROWSER=firefox|webkit (install that Playwright browser first).
 * Subpath: BASE_URL=http://localhost:4173/repo-name/ node tests/browser-e2e.mjs
 * Long run: SOAK_MINUTES=60 node tests/browser-e2e.mjs
 * The 8-hour visibility test below is simulated, never a claim of real background testing.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(project,'test-results');
await mkdir(output,{recursive:true});
const baseURL = new URL(process.env.BASE_URL || 'http://localhost:4173/');
const engineName = process.env.BROWSER || 'chromium';
const soakMinutes = Math.max(0,Number(process.env.SOAK_MINUTES || 0));
if (!Number.isFinite(soakMinutes) || soakMinutes > 480) throw new Error('SOAK_MINUTES must be between 0 and 480.');
const report = {
  startedAt:new Date().toISOString(), baseURL:baseURL.href, browser:engineName,
  status:'running',tests:[],samples:[],screenshots:[],pageErrors:[],consoleErrors:[],failedRequests:[],externalRequests:[],
  limitations:[
    'A short requestAnimationFrame sample measures delivery cadence, not a sustained application FPS guarantee.',
    'JS heap and DOM counters do not measure total browser, GPU or operating-system memory.',
    'Visibility/date jump is a mock; real 1h/8h background, machine sleep and mobile process suspension are not covered.',
    'The responsive screenshot uses a 390×844 viewport; physical touch hardware and high-refresh displays need manual verification.'
  ]
};
let browser,context,page,cdp;
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function saveReport() {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
}
async function run(name,action) {
  const start = performance.now();
  try {
    const detail = await action();
    report.tests.push({name,status:'PASS',durationMs:Math.round(performance.now()-start),detail:detail ?? null});
    console.log(`PASS ${name}`);
  } catch (error) {
    report.tests.push({name,status:'FAIL',durationMs:Math.round(performance.now()-start),error:String(error.stack || error)});
    console.error(`FAIL ${name}: ${error.message}`);
  }
  await saveReport();
}
async function closeAll() {
  await page.evaluate(async()=>{for(const id of [...window.retroOS.wm.windows.keys()])await window.retroOS.wm.closeWindow(id,true);});
}
async function boot() {
  await page.waitForFunction(()=>Boolean(window.retroOS));
  await page.locator('#boot-screen').waitFor({state:'hidden'});
}
async function sample(label) {
  const basic = await page.evaluate(()=>({
    timestamp:new Date().toISOString(),nodes:document.querySelectorAll('*').length,
    windows:window.retroOS.wm.windows.size,windowElements:document.querySelectorAll('.os-window').length,
    canvasElements:document.querySelectorAll('canvas').length,
    runtime:window.__retroTestRuntime?.(),
    jsHeap:performance.memory ? {used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize,limit:performance.memory.jsHeapSizeLimit}:null
  }));
  const result = {label,...basic};
  if(cdp) {
    try {
      await cdp.send('HeapProfiler.collectGarbage');
      result.afterGC = await cdp.send('Runtime.getHeapUsage');
      result.domCounters = await cdp.send('Memory.getDOMCounters');
    }catch(error){result.cdpError=error.message;}
  }
  report.samples.push(result);
  return result;
}

try {
  let playwright;
  try { playwright = await import('playwright'); }
  catch {
    report.status='NOT RUN';
    report.tests.push({name:'browser suite',status:'NOT RUN',reason:'Playwright is not installed. Run npm install --no-save playwright && npx playwright install chromium.'});
    await saveReport();
    console.error('Playwright is missing. See test-results/report.json for the installation command.');
    process.exitCode=2;
  }
  if(playwright) {
    if(!['chromium','firefox','webkit'].includes(engineName))throw new Error('BROWSER must be chromium, firefox or webkit.');
    browser = await playwright[engineName].launch({headless:process.env.HEADFUL !== '1'});
    report.browserVersion=browser.version();report.nodeVersion=process.version;report.platform=process.platform;
    context = await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce',acceptDownloads:true});
    await context.route('**/*',async route=>{
      const requestURL=new URL(route.request().url());
      if(requestURL.origin===baseURL.origin || ['data:','blob:'].includes(requestURL.protocol))return route.continue();
      report.externalRequests.push(route.request().url());
      await route.abort('blockedbyclient');
    });
    // Instrument only scheduling handles; event listeners are measured by CDP when available.
    await context.addInitScript(()=>{
      const intervals=new Set(),timeouts=new Set(),rafs=new Set();
      const original={setInterval:window.setInterval.bind(window),clearInterval:window.clearInterval.bind(window),setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),requestAnimationFrame:window.requestAnimationFrame.bind(window),cancelAnimationFrame:window.cancelAnimationFrame.bind(window)};
      window.setInterval=(callback,ms,...args)=>{const id=original.setInterval(callback,ms,...args);intervals.add(id);return id;};
      window.clearInterval=id=>{intervals.delete(id);return original.clearInterval(id);};
      window.setTimeout=(callback,ms,...args)=>{let id;id=original.setTimeout((...values)=>{timeouts.delete(id);callback(...values);},ms,...args);timeouts.add(id);return id;};
      window.clearTimeout=id=>{timeouts.delete(id);return original.clearTimeout(id);};
      window.requestAnimationFrame=callback=>{let id;id=original.requestAnimationFrame(time=>{rafs.delete(id);callback(time);});rafs.add(id);return id;};
      window.cancelAnimationFrame=id=>{rafs.delete(id);return original.cancelAnimationFrame(id);};
      window.__retroTestRuntime=()=>({intervals:intervals.size,timeouts:timeouts.size,rafs:rafs.size});
    });
    page=await context.newPage();
    page.on('pageerror',error=>report.pageErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
    page.on('response',response=>{if(response.status()>=400)report.failedRequests.push({url:response.url(),status:response.status()});});
    if(engineName==='chromium'){cdp=await context.newCDPSession(page);}
    await run('static load with external network blocked',async()=>{
      const response=await page.goto(baseURL.href,{waitUntil:'networkidle'});
      assert.equal(response.status(),200);await boot();
      assert.equal(await page.title(),'RETRO OS');
      assert.equal(await page.locator('.desktop-icon').count(),8);
      assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.failedRequests,[]);
    });
    await run('desktop 1440×900 screenshot',async()=>{
      const file=path.join(output,'desktop-1440x900.png');await page.screenshot({path:file,fullPage:true});report.screenshots.push(file);
      return {viewport:page.viewportSize(),file};
    });
    await closeAll();await sample('clean baseline');
    await run('notepad UI save, Unicode/HTML text safety and reload',async()=>{
      const text='한글과 이모지 🖥️\n<img src=x onerror="window.__e2eInjected=true">\n'+ '가나다 abc 🌟\n'.repeat(7500);
      const data=await page.evaluate(()=>{const node=window.retroOS.vfs.create('documents','browser-test.txt','text','');return {fileId:node.id,windowId:window.retroOS.openApp('notepad',{fileId:node.id})};});
      const editor=page.locator(`#${data.windowId} textarea`);
      await editor.fill(text);
      await page.locator(`#${data.windowId}`).getByRole('button',{name:'저장',exact:true}).click();
      await page.waitForFunction(({fileId,text})=>window.retroOS.vfs.get(fileId).content===text,{fileId:data.fileId,text});
      await page.waitForTimeout(850);
      await page.reload({waitUntil:'networkidle'});await boot();
      const loaded=await page.evaluate(fileId=>({content:window.retroOS.vfs.get(fileId)?.content,injected:Boolean(window.__e2eInjected)}),data.fileId);
      assert.equal(loaded.content,text);assert.equal(loaded.injected,false);
      return {bytes:Buffer.byteLength(text),fileId:data.fileId};
    });
    await run('dirty close cancellation and modal Escape/focus return',async()=>{
      const id=await page.evaluate(()=>window.retroOS.openApp('notepad'));
      await page.locator(`#${id} textarea`).fill('닫지 말아 주세요');
      await page.locator(`#${id} .window-close`).click();
      await page.locator('#system-dialog').waitFor({state:'visible'});await page.keyboard.press('Escape');
      assert.equal(await page.locator(`#${id}`).count(),1);
      assert.equal(await page.locator('#system-dialog').evaluate(node=>node.open),false);
      await page.locator(`#${id} .window-close`).click();await page.locator('#dialog-confirm').click();
      await page.locator(`#${id}`).waitFor({state:'detached'});
    });
    await run('real mouse title drag, resize and pointer cancellation',async()=>{
      await closeAll();const id=await page.evaluate(()=>window.retroOS.openApp('paint'));
      const header=page.locator(`#${id} .window-titlebar`),before=await header.boundingBox();
      await page.mouse.move(before.x+70,before.y+12);await page.mouse.down();await page.mouse.move(before.x+140,before.y+48,{steps:6});await page.mouse.up();
      const after=await header.boundingBox();assert.ok(Math.abs(after.x-before.x)>10 || Math.abs(after.y-before.y)>10);
      const corner=await page.locator(`#${id} .resize-se`).boundingBox();
      await page.mouse.move(corner.x+3,corner.y+3);await page.mouse.down();await page.mouse.move(corner.x+42,corner.y+30,{steps:4});await page.mouse.up();
      await page.mouse.move(after.x+60,after.y+12);await page.mouse.down();
      await header.dispatchEvent('pointercancel',{pointerId:1,button:0});await page.mouse.up();
      assert.equal(await page.locator(`#${id}`).evaluate(node=>node.classList.contains('dragging')),false);
      return {before,after};
    });
    await run('paint stroke, undo and PNG download',async()=>{
      const id=await page.evaluate(()=>window.retroOS.openApp('paint'));
      const canvas=page.locator(`#${id} canvas`);await canvas.waitFor({state:'visible'});
      const bounds=await canvas.boundingBox();
      const before=await canvas.evaluate(node=>node.toDataURL());
      await page.mouse.move(bounds.x+30,bounds.y+30);await page.mouse.down();await page.mouse.move(bounds.x+100,bounds.y+70,{steps:8});await page.mouse.up();
      assert.notEqual(await canvas.evaluate(node=>node.toDataURL()),before);
      await page.locator(`#${id}`).getByRole('button',{name:'마지막 그리기 취소',exact:true}).click();
      assert.equal(await canvas.evaluate(node=>node.toDataURL()),before);
      const downloadPromise=page.waitForEvent('download');
      await page.locator(`#${id}`).getByRole('button',{name:'그림을 PNG 파일로 다운로드',exact:true}).click();
      const download=await downloadPromise;assert.equal(download.suggestedFilename(),'retro-paint.png');
      await download.saveAs(path.join(output,'paint-export.png'));
      await closeAll();
    });
    await run('100 mixed window lifecycles and 100 Paint lifecycles',async()=>{
      await closeAll();const result=await page.evaluate(async()=>{
        const wm=window.retroOS.wm,types=['welcome','explorer','notepad','paint','terminal','settings','mines'];
        for(const category of ['mixed','paint'])for(let i=0;i<100;i++){
          const id=window.retroOS.openApp(category==='paint'?'paint':types[i%types.length]);
          const state=wm.windows.get(id);state.x+=4;state.y+=3;state.width+=10;state.height+=8;wm.constrain(state);wm.paint(state);
          wm.minimizeWindow(id);wm.restoreWindow(id);wm.maximizeWindow(id);wm.maximizeWindow(id);
          await wm.closeWindow(id,true);await wm.closeWindow(id,true);
        }
        return {windows:wm.windows.size,windowElements:document.querySelectorAll('.os-window').length,taskButtons:document.querySelectorAll('.task-button').length,canvasElements:document.querySelectorAll('canvas').length,runtime:window.__retroTestRuntime()};
      });
      assert.equal(result.windows,0);assert.equal(result.windowElements,0);assert.equal(result.taskButtons,0);assert.equal(result.canvasElements,0);assert.equal(result.runtime.intervals,1);assert.equal(result.runtime.rafs,0);return result;
    });
    await sample('after 200 lifecycles');
    await run('12-window cap, rapid singleton opens and 200 focus changes',async()=>{
      await closeAll();const result=await page.evaluate(async()=>{
        const {wm,vfs}=window.retroOS;
        for(let i=0;i<14;i++){const file=vfs.create('documents',`window-limit-${i}.txt`,'text','');window.retroOS.openApp('notepad',{fileId:file.id});}
        const maximum=wm.windows.size,ids=[...wm.windows.keys()];
        for(let i=0;i<200;i++)wm.focusWindow(ids[i%ids.length]);
        const indexes=[...wm.windows.values()].map(state=>state.zIndex);
        for(const id of ids)await wm.closeWindow(id,true);
        const singleton=window.retroOS.openApp('paint');for(let i=0;i<100;i++)window.retroOS.openApp('paint');
        const singletonCount=wm.windows.size;await wm.closeWindow(singleton,true);
        return {maximum,indexes,singletonCount};
      });
      assert.equal(result.maximum,12);assert.equal(new Set(result.indexes).size,12);assert.ok(Math.max(...result.indexes)<=12);assert.equal(result.singletonCount,1);return result;
    });
    await run('terminal 1000 help commands stay at 500 lines and reject code',async()=>{
      const result=await page.evaluate(()=>{
        const id=window.retroOS.openApp('terminal'),state=window.retroOS.wm.windows.get(id);
        for(let i=0;i<1000;i++)state.app.runCommand('help');
        state.app.runCommand('eval window.__e2eInjected=true');state.app.runCommand('echo <img src=x onerror="window.__e2eInjected=true">');
        return {lines:state.body.querySelector('.terminal-output').childElementCount,injected:Boolean(window.__e2eInjected),renderedImages:state.body.querySelectorAll('img').length};
      });
      assert.equal(result.lines,500);assert.equal(result.injected,false);assert.equal(result.renderedImages,0);await closeAll();return result;
    });
    await run('50 storage and JSON backup round trips preserve exact data',async()=>{
      const result=await page.evaluate(async()=>{
        const storage=await import(new URL('src/storage.js',document.baseURI).href);
        const initial=storage.exportState(window.retroOS.getState());let next=window.retroOS.getState();
        for(let i=0;i<50;i++){
          next=storage.parseBackup(storage.exportState(next));
          const saved=storage.saveState(next);if(!saved.ok)throw new Error(saved.error);
          const loaded=storage.loadState();if(loaded.warning)throw new Error(loaded.warning);next=loaded.state;
          if(storage.exportState(next)!==initial)throw new Error(`Round trip mismatch at ${i}`);
        }
        return {iterations:50,bytes:new TextEncoder().encode(initial).byteLength};
      });return result;
    });
    await run('malformed, oversized, dangerous and versioned imports preserve existing data',async()=>{
      const result=await page.evaluate(async()=>{
        const initial=JSON.stringify(window.retroOS.getState()),copy=JSON.parse(initial);
        const duplicate=JSON.parse(initial);duplicate.nodes.push({...duplicate.nodes[0]});
        const invalid=[['broken.json','{'],['large.json',' '.repeat(2*1024*1024+1)],['version.json',JSON.stringify({...copy,version:999})],['duplicate.json',JSON.stringify(duplicate)],['prototype.json','{"__proto__":{"polluted":true},"version":1}']];
        for(const [name,text]of invalid){await window.retroOS.importBackup(new File([text],name,{type:'application/json'}));if(JSON.stringify(window.retroOS.getState())!==initial)throw new Error(`${name} changed existing state`);}
        return {rejected:invalid.map(([name])=>name),prototypePolluted:Boolean({}.polluted)};
      });assert.equal(result.prototypePolluted,false);return result;
    });
    await run('100 viewport changes keep titlebars accessible and bounds finite',async()=>{
      await page.evaluate(()=>{window.retroOS.openApp('notepad');window.retroOS.openApp('settings');});
      for(let i=0;i<100;i++)await page.setViewportSize(i%2?{width:1440,height:900}:{width:390,height:844});
      const result=await page.evaluate(()=>[...window.retroOS.wm.windows.values()].map(state=>({id:state.id,x:state.x,y:state.y,width:state.width,height:state.height,title:state.element.querySelector('header').getBoundingClientRect().toJSON()})));
      for(const item of result){assert.ok([item.x,item.y,item.width,item.height].every(Number.isFinite));assert.ok(item.title.x>=0 && item.title.y>=0);assert.ok(item.title.bottom<=900-42);}
      await closeAll();return result;
    });
    await run('390×844 responsive screenshot and bounds',async()=>{
      await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.retroOS.openApp('welcome'));
      const file=path.join(output,'mobile-390x844.png');await page.screenshot({path:file,fullPage:true});report.screenshots.push(file);
      const dimensions=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,width:innerWidth,title:document.querySelector('.os-window header').getBoundingClientRect().toJSON()}));
      assert.equal(dimensions.scrollWidth,dimensions.width);assert.ok(dimensions.title.right<=390);return {file,...dimensions};
    });
    await run('mock hidden→8-hour date jump→visible restores one current clock',async()=>{
      const result=await page.evaluate(()=>{
        const RealDate=Date,now=RealDate.now(),hiddenDescriptor=Object.getOwnPropertyDescriptor(document,'hidden');
        const visibilityDescriptor=Object.getOwnPropertyDescriptor(document,'visibilityState');let hidden=true;
        Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
        Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
        try {
          document.dispatchEvent(new Event('visibilitychange'));const stopped=!window.retroOS.clock().active;
          window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now+8*60*60*1000]));}static now(){return now+8*60*60*1000;}};
          hidden=false;document.dispatchEvent(new Event('visibilitychange'));
          for(let i=0;i<100;i++)document.dispatchEvent(new Event('visibilitychange'));
          return {simulated:true,hours:8,stopped,resumed:window.retroOS.clock().active,clockEpoch:new RealDate(document.querySelector('#clock').dateTime).getTime(),expectedEpoch:now+8*60*60*1000,runtime:window.__retroTestRuntime()};
        } finally {
          window.Date=RealDate;
          if(hiddenDescriptor)Object.defineProperty(document,'hidden',hiddenDescriptor);else delete document.hidden;
          if(visibilityDescriptor)Object.defineProperty(document,'visibilityState',visibilityDescriptor);else delete document.visibilityState;
          document.dispatchEvent(new Event('visibilitychange'));
        }
      });assert.equal(result.stopped,true);assert.equal(result.resumed,true);assert.equal(result.clockEpoch,result.expectedEpoch);assert.equal(result.runtime.intervals,1);assert.equal(result.runtime.rafs,0);return result;
    });
    await page.setViewportSize({width:1440,height:900});await closeAll();
    await run('short foreground requestAnimationFrame cadence sample',async()=>{
      const result=await page.evaluate(()=>new Promise(resolve=>{
        const times=[];const frame=time=>{times.push(time);if(times.length<90)requestAnimationFrame(frame);else{const duration=times.at(-1)-times[0];resolve({frames:times.length,durationMs:duration,fps:1000*(times.length-1)/duration});}};requestAnimationFrame(frame);
      }));assert.ok(Number.isFinite(result.fps) && result.fps>0);return result;
    });
    if(soakMinutes>0) {
      await run(`${soakMinutes}-minute soak after 2-minute warm-up`,async()=>{
        console.log('Soak warm-up: 2 minutes.');
        const warmEnd=Date.now()+120000;
        while(Date.now()<warmEnd){await delay(Math.min(10000,warmEnd-Date.now()));await page.evaluate(()=>window.retroOS.clock());}
        await sample('soak start after 2min warm-up');const start=Date.now(),end=start+soakMinutes*60000;let nextSample=start+300000,round=0;
        while(Date.now()<end){
          await page.evaluate(async round=>{const type=['paint','explorer','notepad','mines','terminal','settings'][round%6];const id=window.retroOS.openApp(type);window.retroOS.wm.minimizeWindow(id);window.retroOS.wm.restoreWindow(id);await window.retroOS.wm.closeWindow(id,true);},round++);
          if(Date.now()>=nextSample){await sample(`soak ${Math.round((Date.now()-start)/60000)}min`);nextSample+=300000;await saveReport();}
          await delay(Math.max(1,Math.min(10000,end-Date.now())));
        }
        await sample('soak end');return {minutes:soakMinutes,warmupMinutes:2,cycles:round,sampleIntervalMinutes:5};
      });
    } else report.tests.push({name:'30–60 minute soak with 2-minute warm-up',status:'NOT RUN',reason:'SOAK_MINUTES was not set. Run SOAK_MINUTES=60 node tests/browser-e2e.mjs.'});
    report.tests.push({name:'real 1h/8h background, OS sleep and physical mobile resume',status:'NOT RUN',reason:'Requires dedicated manual hardware/background testing; mock date jump is reported separately.'});
    await sample('final clean baseline');
    await run('no runtime errors, missing assets or external requests',async()=>{
      assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);assert.deepEqual(report.externalRequests,[]);
    });
    report.status=report.tests.some(item=>item.status==='FAIL')?'FAIL':'PASS';
    process.exitCode=report.status==='FAIL'?1:0;
  }
}catch(error){
  report.status='FAIL';report.fatalError=String(error.stack || error);process.exitCode=1;console.error(error.message);
}finally{
  if(context)await context.close().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  await saveReport();
  console.log(`Report: ${path.join(output,'report.json')}`);
}
