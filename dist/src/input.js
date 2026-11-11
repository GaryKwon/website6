// All pointer listeners belong to a window AbortController. No per-drag global listener.
export function bindPointer(handle,{signal,start,move,end}){
 let active=null;
 const finish=e=>{if(!active||e.pointerId!==active.id)return;const previous=active;active=null;try{if(handle.hasPointerCapture(previous.id))handle.releasePointerCapture(previous.id);}catch{}end?.(e,previous.data);};
 handle.addEventListener('pointerdown',e=>{if(active)return;const control=e.target.closest('button,input,textarea,select');if(e.button!==0||(control&&control!==handle))return;const data=start(e);if(data===false)return;active={id:e.pointerId,data};handle.setPointerCapture(e.pointerId);e.preventDefault();},{signal});
 handle.addEventListener('pointermove',e=>{if(active&&active.id===e.pointerId)move(e,active.data);},{signal});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,finish,{signal});
 signal.addEventListener('abort',()=>{if(active){try{handle.releasePointerCapture(active.id);}catch{}active=null;}},{once:true});
}
