(() => {
  let job = null;
  const pendingPageFetches=new Map();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => (s || "").replace(/\u200e|\u200f/g, "").replace(/[ \t]+\n/g, "\n").trim();
  const esc = s => String(s ?? "").replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const safe = s => clean(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.+$/g, "").slice(0, 80) || "Bale chat";
  const visible = el => { const r=el.getBoundingClientRect(); return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight; };

  window.addEventListener('message',event=>{
    const response=event.data;
    if(event.source!==window||response?.channel!=='BALE_EXPORT_MEDIA_RESPONSE')return;
    const pending=pendingPageFetches.get(response.id);if(!pending)return;
    pendingPageFetches.delete(response.id);clearTimeout(pending.timer);
    if(response.ok&&response.buffer instanceof ArrayBuffer)pending.resolve({bytes:new Uint8Array(response.buffer),mime:response.mime||''});
    else pending.reject(new Error(response.error||'Bale could not read this media'));
  });

  function fetchInBalePage(url) {
    return new Promise((resolve,reject)=>{
      const id=crypto.randomUUID(),timer=setTimeout(()=>{pendingPageFetches.delete(id);reject(new Error('Media request timed out'));},30000);
      pendingPageFetches.set(id,{resolve,reject,timer});
      window.postMessage({channel:'BALE_EXPORT_MEDIA_REQUEST',id,url},'*');
    });
  }

  function beginMediaCapture(item) {
    if(!job||!job.includeMedia||!item.url||job.mediaCache.has(item.url))return;
    const capture=fetchInBalePage(item.url).catch(async pageError=>{
      try{const response=await fetch(item.url,{credentials:'include'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return{bytes:new Uint8Array(await response.arrayBuffer()),mime:response.headers.get('content-type')||''};}
      catch{throw pageError;}
    });
    job.mediaCache.set(item.url,capture);
  }

  function notify(message, progress, done=false, error=false) {
    let t=document.getElementById("bale-export-toast");
    if(!t){t=document.createElement("div");t.id="bale-export-toast";document.documentElement.append(t)}
    t.innerHTML=`<div>${esc(message)}</div>${done||error?'':`<progress max="100" value="${progress||0}"></progress>`}`;
    chrome.runtime.sendMessage({type:"BALE_EXPORT_PROGRESS",message,progress,done,error}).catch(()=>{});
    if(done||error)setTimeout(()=>t.remove(),6000);
  }

  function findConversation() {
    const baleScroller=document.getElementById('message_list_scroller_id');
    if(baleScroller&&baleScroller.querySelector('[data-sid][data-date]'))return baleScroller;
    const candidates=[...document.querySelectorAll('[role="main"],main,[class*="chat" i],[class*="message" i]')].filter(visible);
    let best=null,score=0;
    for(const el of candidates){
      const messageHints=el.querySelectorAll('[data-message-id],[class*="message" i],[class*="bubble" i],time').length;
      const r=el.getBoundingClientRect(),s=messageHints*20+(r.width*r.height)/(innerWidth*innerHeight);
      if(messageHints>=1&&s>score){best=el;score=s}
    }
    if(!best) throw new Error("No open conversation found. Select a Bale chat and try again.");
    return best;
  }

  function scrollParent(root) {
    if(root.id==='message_list_scroller_id')return root;
    const all=[root,...root.querySelectorAll('*')];
    return all.filter(el=>{const c=getComputedStyle(el);return /(auto|scroll)/.test(c.overflowY)&&el.scrollHeight>el.clientHeight+50})
      .sort((a,b)=>(b.clientHeight*b.clientWidth)-(a.clientHeight*a.clientWidth))[0] || root;
  }

  function titleOf(root) {
    const baleTitle=document.querySelector('[aria-label="ChatAppBar"] p');
    if(baleTitle&&clean(baleTitle.textContent))return clean(baleTitle.textContent);
    const headers=[...document.querySelectorAll('header,h1,h2,[class*="header" i],[class*="title" i]')].filter(visible);
    const near=headers.filter(el=>{const r=el.getBoundingClientRect(),q=root.getBoundingClientRect();return r.left<q.right&&r.right>q.left&&r.top<q.top+180});
    return clean((near.sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0]||{}).innerText)||"Bale chat";
  }

  function messageNodes(root) {
    const bale=[...root.querySelectorAll('[data-sid][data-date][aria-label="message-item"]')];
    if(bale.length)return bale;
    const exact=[...root.querySelectorAll('[data-message-id],[data-mid],[id^="message" i],[class*="message-container" i],[class*="message-item" i]')];
    const pool=exact.length?exact:[...root.querySelectorAll('[class*="message" i],[class*="bubble" i]')];
    return pool.filter((el,i)=>{
      if(!clean(el.innerText)&&!el.querySelector('img,video,audio,a[href]'))return false;
      return !pool.some((other,j)=>j!==i&&el.contains(other)&&other.getBoundingClientRect().height>20);
    });
  }

  async function loadHistory(root, timeoutMinutes) {
    const scroller=scrollParent(root),start=Date.now(),limit=timeoutMinutes?timeoutMinutes*60000:Infinity;
    let stable=0,last="",round=0,collected=[],seen=new Set();
    while(!job.cancelled&&Date.now()-start<limit&&stable<5){
      const nodes=messageNodes(root),signature=`${nodes.length}:${clean(nodes[0]?.innerText).slice(0,100)}`;
      const batch=nodes.map(parseMessage),fresh=batch.filter(m=>{const key=m.id+"|"+m.date+"|"+m.from+"|"+m.text.slice(0,120);if(seen.has(key))return false;seen.add(key);return true});
      if(fresh.length)collected=[...fresh,...collected];
      stable=signature===last?stable+1:0;last=signature;round++;
      notify(`Loading older messages… ${collected.length} collected`,Math.min(45,5+round));
      scroller.scrollTop=0;
      scroller.dispatchEvent(new Event('scroll',{bubbles:true}));
      scroller.dispatchEvent(new WheelEvent('wheel',{deltaY:-1200,bubbles:true}));
      scroller.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',code:'Home',bubbles:true}));
      await sleep(900+Math.min(stable,3)*400);
    }
    if(job.cancelled)throw new Error("Export cancelled.");
    if(Date.now()-start>=limit)notify("Time limit reached; exporting everything loaded so far.",48);
    return collected;
  }

  function mediaFrom(node) {
    const items=[];
    for(const el of node.querySelectorAll('img,video,audio,source,a[href]')){
      let url=el.currentSrc||el.src||el.href;if(!url||url.startsWith('data:')||url.startsWith('javascript:'))continue;
      if(el.tagName==='IMG'&&(el.closest('[aria-label="avatar"]')||el.closest('[data-sentry-component="DocumentIcon"],[data-testid="document-message"]')||/avatar|emoji|sticker|\bfile\b/i.test(el.className+' '+el.alt)||el.width<40&&el.height<40))continue;
      const type=el.tagName==='IMG'?'photo':el.tagName==='VIDEO'?'video':el.tagName==='AUDIO'||el.closest('audio')?'voice':'file';
      if(!items.some(x=>x.url===url)){const item={type,url,name:clean(el.download||el.title||el.alt||url.split('/').pop().split('?')[0])};items.push(item);beginMediaCapture(item);}
    }
    for(const preview of node.querySelectorAll('[data-testid="document-message"],[data-sentry-component="DocumentPreview"]')){
      const card=preview.closest('a')||preview.parentElement;
      const name=[...card.querySelectorAll('p,[dir="auto"]')].map(el=>clean(el.textContent)).find(s=>/\.[a-z0-9]{1,8}$/i.test(s));
      if(name&&!items.some(x=>x.name===name))items.push({type:'file',url:'',name,error:'Bale did not expose a downloadable URL in the page'});
    }
    return items;
  }

  function parseMessage(node,index) {
    const raw=clean(node.innerText), own=!!node.querySelector('[aria-label="RightBubble-icon"],use[href="#bi-RightBubble"],use[xlink\\:href="#bi-RightBubble"]')||!!node.closest('[class*="outgoing" i],[class*="out-message" i],[class*="own" i],[data-outgoing="true"]')||/outgoing|is-mine|from-me/i.test(node.className);
    const bottom=node.querySelector('[data-sentry-component="MessageBottomFC"]');
    const timeEl=bottom?.querySelector('p:last-of-type')||node.querySelector('time,[datetime],[class*="time" i],[class*="date" i]');
    const epoch=Number(node.dataset.date)||0;
    const date=epoch?new Date(epoch).toISOString():(timeEl?.getAttribute('datetime')||timeEl?.getAttribute('title')||clean(timeEl?.textContent)||"");
    const senderEl=node.querySelector('[data-sentry-component="BaseBubbleFC"] > div > div:first-child p span[dir="auto"], [class*="sender" i],[class*="author" i],[class*="name" i]');
    const sender=own?"You":(clean(senderEl?.textContent)||"Other");
    const replyEl=node.querySelector('[data-sentry-component="Preview"],[class*="reply" i],[class*="quote" i]');
    const media=mediaFrom(node);
    const baleText=[...node.querySelectorAll('[data-sentry-component="NewTextContainerFC"]')].filter(el=>!el.closest('[data-sentry-component="Preview"]')).map(el=>clean(el.innerText)).filter(Boolean);
    let text=baleText.length?baleText.join("\n"):raw;
    if(!baleText.length)for(const remove of [bottom,senderEl,replyEl])if(remove)text=text.replace(clean(remove.textContent),"").trim();
    const edited=/ویرایش شده|edited/i.test(clean(bottom?.innerText));
    return {id:node.dataset.sid||node.dataset.messageId||node.dataset.mid||node.id||String(index+1),type:"message",date,date_unixtime:epoch?String(Math.floor(epoch/1000)):"",display_time:clean(timeEl?.textContent),edited,from:sender,from_id:"",direction:own?"outgoing":"incoming",reply_to:clean(replyEl?.innerText),text,media};
  }

  async function downloadMedia(messages,zip) {
    const all=messages.flatMap(m=>m.media.map(x=>({m,x}))),used=new Set();let done=0;
    for(const {x} of all){
      if(job.cancelled)throw new Error("Export cancelled.");
      try{
        if(!x.url)throw new Error("Bale did not expose a downloadable URL in the page");
        const captured=await (job.mediaCache.get(x.url)||fetchInBalePage(x.url));
        const ext=(x.name.match(/\.[a-z0-9]{1,8}$/i)||[])[0]||({photo:'.jpg',video:'.mp4',voice:'.ogg',file:''}[x.type]);
        let base=safe(x.name||`${x.type}_${done+1}${ext}`),name=`media/${base}`;let n=2;while(used.has(name))name=`media/${base.replace(/(\.[^.]+)?$/,`_${n++}$1`)}`;used.add(name);
        zip.add(name,captured.bytes);x.path=name;x.mime_type=captured.mime;delete x.url;
      }catch(e){x.error=`Could not download: ${e.message}`;}
      done++;notify(`Downloading media… ${done} of ${all.length}`,55+Math.round(done/Math.max(all.length,1)*30));
    }
  }

  function htmlDocument(title,messages,exportedAt) {
    const cards=messages.map(m=>`<div class="message ${m.direction}"><div class="meta"><b>${esc(m.from)}</b><span>${esc(m.date)}</span></div>${m.reply_to?`<blockquote>${esc(m.reply_to)}</blockquote>`:''}${m.text?`<div class="text">${esc(m.text).replace(/\n/g,'<br>')}</div>`:''}${m.media.map(x=>x.path?`<a class="media" href="${encodeURI(x.path)}">${esc(x.type)}: ${esc(x.name||x.path)}</a>`:`<span class="failed">${esc(x.error)}</span>`).join('')}</div>`).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title><style>body{margin:0;background:#dfe8ee;font:14px/1.45 system-ui;color:#182533}.wrap{max-width:850px;margin:auto;padding:30px}.head{background:#fff;padding:22px;border-radius:14px;margin-bottom:18px}.head h1{margin:0 0 5px}.head p{color:#60717e;margin:0}.message{max-width:72%;background:#fff;margin:8px 0;padding:10px 13px;border-radius:12px;box-shadow:0 1px 2px #0002}.outgoing{margin-left:auto;background:#dcf8c6}.meta{display:flex;justify-content:space-between;gap:20px;color:#1384b1;font-size:12px}.meta span{color:#71808b}.text{white-space:normal;margin-top:4px}blockquote{margin:6px 0;padding-left:9px;border-left:3px solid #37a9d5;color:#53636e}.media{display:block;margin-top:7px}.failed{display:block;color:#a33;font-size:12px}</style></head><body><div class="wrap"><div class="head"><h1>${esc(title)}</h1><p>${messages.length} messages · Exported ${esc(exportedAt)}</p></div>${cards}</div></body></html>`;
  }

  async function run(options) {
    try{
      const root=findConversation(),title=titleOf(root),messages=await loadHistory(root,options.timeoutMinutes);
      notify("Reading messages…",50);if(!messages.length)throw new Error("No messages were found in the open conversation.");
      const zip=new BaleZipStore(),exportedAt=new Date().toISOString();
      if(options.includeMedia)await downloadMedia(messages,zip);else for(const m of messages)for(const x of m.media)delete x.url;
      notify("Building archive…",90);const result={about:"Bale Chat Export",schema_version:"1.0",exported_at:exportedAt,name:title,type:"personal_chat",id:"",messages};
      zip.add("result.json",JSON.stringify(result,null,2));zip.add("messages.html",htmlDocument(title,messages,exportedAt));zip.add("README.txt",`Bale chat export\nChat: ${title}\nMessages: ${messages.length}\nExported: ${exportedAt}\n\nOpen messages.html in a browser to read this archive.`);
      const blob=zip.blob(),url=URL.createObjectURL(blob),filename=`${safe(title)}_${exportedAt.slice(0,10)}.zip`;
      const link=document.createElement('a');link.href=url;link.download=filename;link.style.display='none';document.documentElement.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      notify(`Done — exported ${messages.length} messages.`,100,true);job=null;
    }catch(error){notify(error.message,0,false,true);job=null;}
  }

  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message.type==="BALE_EXPORT_CANCEL"){if(job)job.cancelled=true;respond({ok:true});return;}
    if(message.type!=="BALE_EXPORT_START")return;
    if(job){respond({ok:false,error:"An export is already running."});return;}
    job={cancelled:false,includeMedia:!!message.includeMedia,mediaCache:new Map()};run(message);respond({ok:true});
  });
})();
