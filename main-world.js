// Runs in Bale's JavaScript world so session-scoped blob: media remains readable.
window.addEventListener('message', async event => {
  const request=event.data;
  if(event.source!==window||request?.channel!=='BALE_EXPORT_MEDIA_REQUEST'||typeof request.url!=='string')return;
  try{
    const response=await fetch(request.url,{credentials:'include'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const buffer=await response.arrayBuffer();
    window.postMessage({channel:'BALE_EXPORT_MEDIA_RESPONSE',id:request.id,ok:true,buffer,mime:response.headers.get('content-type')||''},'*',[buffer]);
  }catch(error){
    window.postMessage({channel:'BALE_EXPORT_MEDIA_RESPONSE',id:request.id,ok:false,error:error?.message||String(error)},'*');
  }
});
