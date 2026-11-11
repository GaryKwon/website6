const sheet=new URL('../assets/icons/saurezh/desktop.png',import.meta.url).href;
const mines=new URL('../assets/icons/haiku/mines.png',import.meta.url).href;
export const ICON_GRID={columns:10,rows:9,size:32};
export const ICON_MAP={"computer": [0, 0], "documents": [2, 6], "folder": [0, 6], "notepad": [8, 2], "paint": [5, 3], "terminal": [2, 0], "settings": [3, 5], "trash": [8, 4], "trash-full": [7, 4], "welcome": [1, 2], "help": [2, 2], "text": [7, 2], "calculator": [6, 4], "drive": [1, 5], "floppy": [8, 7], "network": [5, 0], "connect": [7, 0], "sound": [1, 8], "shortcut": [1, 6], "save": [8, 7], "download": [4, 0], "image": [4, 3], "mail": [0, 7]};
const controls={
back:`<path fill="#555" d="m2 16 11-11v7h16v9H13v7z"/><path fill="#138a3b" d="m3 15 9-9v7h16v6H12v7z"/><path fill="#69ca6a" d="m5 14 7-6v6h15v1H11v-4z"/>`,
forward:`<path fill="#555" d="m30 16-11-11v7H3v9h16v7z"/><path fill="#138a3b" d="m29 15-9-9v7H4v6h16v7z"/><path fill="#69ca6a" d="m27 14-7-6v6H5v1h16v-4z"/>`,
up:`<path fill="#7a6020" d="M2 11h11l3 3h15v15H2z"/><path fill="#ffe08b" d="M3 10h10l3 3h14v14H3z"/><path fill="#152e83" d="m17 2 9 9h-6v10h-6V11H8z"/><path fill="#658ad6" d="m17 4 5 5h-4v10h-2V9h-4z"/>`,
refresh:`<path fill="#114b23" d="M5 6h16V2l8 8-8 8v-5H8v10h15v-5h6v11H2V6z"/><path fill="#3f9f50" d="M4 8h18V5l4 5-4 5v-4H6v14h19v-5h2v7H4z"/>`,
run:`<path fill="#444" d="M2 8h22v20H2z"/><path fill="#ddd" d="M3 9h20v17H3z"/><path fill="#000080" d="M4 10h18v4H4z"/><path fill="#fff" d="M6 17h13v6H6z"/><path fill="#555" d="m18 3 12 9-5 2-4 10-5-2 4-10-4-1z"/><path fill="#eee" d="m19 5 8 6-4 2-4 9-2-1 4-10-3-1z"/>`,
restart:`<path fill="#444" d="M4 8h24v19H4z"/><path fill="#ddd" d="M5 9h22v16H5z"/><path fill="#000080" d="M7 11h18v11H7z"/><path fill="#edcf50" d="M13 3h7v12h5L16 24 7 15h6z"/><path fill="#fff49b" d="M14 4h2v13H9l7 5-4-5h3z"/>`,
disconnect:`<path fill="#777" d="M3 13h12v8H3zM19 13h11v8H19z"/><path fill="#bbb" d="M4 14h10v5H4zM20 14h9v5h-9z"/><path fill="#a22" d="m10 4 4-2 10 26-4 2z"/>`,
start:`<path fill="#111" d="m3 5 12-3v12L3 15zm14-3 12 2v11l-12-1zM3 17l12-1v13L3 26zm14-1 12 2v12l-12-1z"/><path fill="#ed4b35" d="m5 6 9-2v8l-9 1z"/><path fill="#48a04c" d="m18 4 9 2v7l-9-1z"/><path fill="#2e91c5" d="m5 19 9-1v8l-9-2z"/><path fill="#ffd643" d="m18 18 9 2v8l-9-1z"/>`,
};
export function icon(name,size=32){const n=Number(size);const s=Number.isFinite(n)?Math.min(128,Math.max(12,n)):32;const common=`class="sourced-icon" width="${s}" height="${s}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"`;if(name==='mines')return `<svg ${common} viewBox="0 0 32 32"><image href="${mines}" width="32" height="32"/></svg>`;if(controls[name])return `<svg ${common} viewBox="0 0 32 32">${controls[name]}</svg>`;const [x,y]=ICON_MAP[name]||ICON_MAP.folder;return `<svg ${common} viewBox="${x*32} ${y*32} 32 32"><image href="${sheet}" width="320" height="288" style="image-rendering:pixelated"/></svg>`;}
export function el(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
