// The bridge is active only in the loopback page served by the local launcher.
export function createPCBridge(){
 const token=document.querySelector('meta[name="retro-pc-token"]')?.content;
 const available=!!token&&location.hostname==='127.0.0.1';
 return {available,async request(route,data){
  if(!available)throw new Error('Mac용 로컬 실행기로 RETRO OS를 열어 주세요.');
  if(!/^\/[a-z/-]+$/.test(route))throw new Error('지원하지 않는 작업입니다.');
  const response=await fetch('./api'+route,{method:data===undefined?'GET':'POST',headers:{'Authorization':'Bearer '+token,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store',credentials:'omit'});
  const result=await response.json();if(!response.ok){const error=new Error(result.error||'PC 연결 작업을 완료하지 못했습니다.');error.status=response.status;throw error;}return result;
 }};
}
