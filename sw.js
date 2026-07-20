const V = 'alfred-v22';
const STATIC = ['./manifest.json', './icon.svg'];

// ═══════════════════════════════════════════════════════════════════
// Notif v2 — IDB shadow store access (mirrors index.html Stage 1 module)
// ═══════════════════════════════════════════════════════════════════
const NOTIF_DB_NAME='vt_notif_db';
const NOTIF_DB_VERSION=1;
const NOTIF_STORE='notif_state';
function _swOpenNotifDb(){
  return new Promise((res,rej)=>{
    try{
      const req=indexedDB.open(NOTIF_DB_NAME,NOTIF_DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(NOTIF_STORE)){
          const os=db.createObjectStore(NOTIF_STORE,{keyPath:'key'});
          os.createIndex('type','type',{unique:false});
        }
      };
      req.onsuccess=()=>res(req.result);
      req.onerror=()=>rej(req.error);
    }catch(e){rej(e);}
  });
}
function _swIdbGet(key){
  return new Promise(async(res)=>{
    try{
      const db=await _swOpenNotifDb();
      const tx=db.transaction(NOTIF_STORE,'readonly');
      const req=tx.objectStore(NOTIF_STORE).get(key);
      req.onsuccess=()=>res(req.result||null);
      req.onerror=()=>res(null);
    }catch(_){res(null);}
  });
}
function _swIdbPut(record){
  return new Promise(async(res)=>{
    try{
      const db=await _swOpenNotifDb();
      const tx=db.transaction(NOTIF_STORE,'readwrite');
      tx.oncomplete=()=>res(true);
      tx.onerror=()=>res(false);
      tx.objectStore(NOTIF_STORE).put(record);
    }catch(_){res(false);}
  });
}
async function _swV2Enabled(){
  const rec=await _swIdbGet('meta:v2Enabled');
  return !!(rec&&rec.enabled);
}
// Given the payload {type, id, stage}, return true if the item is already
// resolved and the notification should be swallowed.
async function _swShouldSwallow(payload){
  if(!payload||!payload.type||payload.id==null)return false;
  if(payload.type==='task'){
    const r=await _swIdbGet('task:'+payload.id);
    return !!(r&&(r.completed===true||r.status==='done'||r.status==='skipped'));
  }
  if(payload.type==='routine'){
    // payload.id shape: "<routineId>__<isoDate>"
    const parts=String(payload.id).split('__');
    if(parts.length<2)return false;
    const rid=parts[0],dt=parts.slice(1).join('__');
    const r=await _swIdbGet('routine:'+rid);
    if(!r)return false;
    if(r.enabled===false)return true;
    if(Array.isArray(r.completedDates)&&r.completedDates.includes(dt))return true;
    if(Array.isArray(r.skippedDates)&&r.skippedDates.includes(dt))return true;
    return false;
  }
  if(payload.type==='crm'){
    const r=await _swIdbGet('crm:'+payload.id);
    return !!(r&&r.status==='done');
  }
  if(payload.type==='bill'){
    const r=await _swIdbGet('bill:'+payload.id);
    return !!(r&&r.status==='paid');
  }
  return false;
}
// Mark an item as done from within the SW (for the "בוצע" action).
async function _swMarkDone(payload){
  if(!payload||!payload.type||payload.id==null)return false;
  const now=Date.now();
  if(payload.type==='task'){
    const r=(await _swIdbGet('task:'+payload.id))||{key:'task:'+payload.id,type:'task',id:payload.id};
    r.completed=true;r.status='done';r.updatedAt=now;r.doneViaSw=true;
    return _swIdbPut(r);
  }
  if(payload.type==='routine'){
    const parts=String(payload.id).split('__');
    if(parts.length<2)return false;
    const rid=parts[0],dt=parts.slice(1).join('__');
    const r=(await _swIdbGet('routine:'+rid))||{key:'routine:'+rid,type:'routine',id:rid,completedDates:[],skippedDates:[]};
    if(!Array.isArray(r.completedDates))r.completedDates=[];
    if(!r.completedDates.includes(dt))r.completedDates.push(dt);
    r.updatedAt=now;r.doneViaSw=true;
    return _swIdbPut(r);
  }
  if(payload.type==='crm'){
    const r=(await _swIdbGet('crm:'+payload.id))||{key:'crm:'+payload.id,type:'crm',id:payload.id};
    r.status='done';r.updatedAt=now;r.doneViaSw=true;
    return _swIdbPut(r);
  }
  if(payload.type==='bill'){
    const r=(await _swIdbGet('bill:'+payload.id))||{key:'bill:'+payload.id,type:'bill',id:payload.id};
    r.status='paid';r.updatedAt=now;r.doneViaSw=true;
    return _swIdbPut(r);
  }
  return false;
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('push', e => {
  let data={title:'Alfred 🔔',body:''};
  try{data={...data,...e.data.json()};}catch(_){}
  const payload=data.payload||data.data||null;
  const opts={
    body:data.body||'',
    icon:'./icon.svg',badge:'./icon.svg',
    dir:'rtl',vibrate:[200,100,200],
    tag:data.tag||'vt-push',
    data:payload
  };
  if(data.actions&&Array.isArray(data.actions))opts.actions=data.actions;
  if(data.requireInteraction)opts.requireInteraction=true;
  // Show full body on lock screen / drawer
  if(data.body&&data.body.length>40)opts.requireInteraction=true;
  // v2: read live status from IDB and swallow if resolved.
  // If IDB read or flag lookup throws → fail-open (show the notification).
  e.waitUntil((async()=>{
    try{
      const v2=await _swV2Enabled();
      if(v2&&payload&&await _swShouldSwallow(payload)){
        // Silent swallow — no showNotification. Firefox requires *some*
        // notification to satisfy the "user visible" contract, but Chrome
        // and iOS Safari tolerate the missing call after a short grace.
        // Accept the trade-off: better to skip a stale reminder than to
        // spam. If a browser warns, the flag can be flipped off.
        return;
      }
    }catch(_){/* fail-open below */}
    return self.registration.showNotification(data.title,opts);
  })());
});

self.addEventListener('notificationclick', e => {
  const action=e.action;
  const payload=e.notification.data||{};
  e.notification.close();
  e.waitUntil((async()=>{
    const v2=await _swV2Enabled().catch(()=>false);

    // v2 "בוצע": write completion to IDB and STOP. No client open.
    if(v2&&action==='done'&&payload&&payload.type&&payload.id!=null){
      await _swMarkDone(payload).catch(()=>{});
      // Notify any already-open client so its in-memory arrays stay in sync
      // (fire-and-forget; if no client is open, next boot will re-sync from IDB in Stage 4)
      const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      cs.forEach(c=>{try{c.postMessage({type:'VT_NOTIF_ACTION',action:'done',payload});}catch(_){}});
      return;
    }

    const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    // Notify any open client about the action (or just click)
    cs.forEach(c=>{
      try{c.postMessage({type:'VT_NOTIF_ACTION',action:action||'click',payload});}catch(_){}
    });

    // v2 fallback for iOS / any browser without actions:
    // Body-tap with no action opens the snooze deep link for that item.
    // Explicit "snooze" action does the same.
    const isSnooze=action==='snooze'||(!action&&v2&&payload&&payload.type&&payload.id!=null);
    if(isSnooze&&payload&&payload.type&&payload.id!=null){
      const url=`/?action=snooze&type=${encodeURIComponent(payload.type)}&id=${encodeURIComponent(payload.id)}`;
      if(cs.length){
        const c=cs[0];
        try{c.postMessage({type:'VT_NOTIF_DEEP_LINK',action:'snooze',payload});}catch(_){}
        if('focus'in c)return c.focus();
      }
      return clients.openWindow(url);
    }

    // Legacy path (v1 / no payload): existing behavior unchanged.
    if(action&&payload&&payload.id){
      if(cs.length){
        if('focus' in cs[0])return cs[0].focus();
      }else{
        const url=`/?action=${encodeURIComponent(action)}&type=${encodeURIComponent(payload.type||'')}&id=${encodeURIComponent(payload.id||'')}`;
        return clients.openWindow(url);
      }
      return;
    }
    const c=cs.find(x=>x.url.includes(self.location.origin)&&'focus'in x);
    return c?c.focus():clients.openWindow('/');
  })());
});

self.addEventListener('message', event => {
  if(event.data&&event.data.type==='SHOW_NOTIFICATION'){
    const opts={
      body:event.data.body,icon:'./icon.svg',badge:'./icon.svg',
      tag:event.data.tag,dir:'rtl',vibrate:[200,100,200],
      data:event.data.payload||null
    };
    if(event.data.actions)opts.actions=event.data.actions;
    if(event.data.requireInteraction||(event.data.body&&event.data.body.length>40))opts.requireInteraction=true;
    self.registration.showNotification(event.data.title,opts);
  }
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Bypass SW for cross-origin requests (Gemini, Google APIs, etc)
  if (url.origin !== self.location.origin) return;
  // Bypass non-GET requests (POST/PUT/DELETE go straight to network)
  if (e.request.method !== 'GET') return;

  // Share target
  if (url.searchParams.has('share_text')) {
    e.respondWith((async () => {
      const text  = url.searchParams.get('share_text') || '';
      const title = url.searchParams.get('share_title') || '';
      const link  = url.searchParams.get('share_url') || '';
      const cs = await self.clients.matchAll({type:'window'});
      if (cs.length) {
        cs[0].postMessage({type:'VT_SHARE', text, title, url: link});
        cs[0].focus();
      } else {
        const cache = await caches.open(V);
        await cache.put('/__vt_share__', new Response(JSON.stringify({text,title,url:link})));
      }
      return Response.redirect('./index.html', 303);
    })());
    return;
  }

  // HTML, CSS, JS — always network first, fallback to cache
  const isNetworkFirst =
    e.request.destination === 'document' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js');

  if (isNetworkFirst) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) caches.open(V).then(c => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Static assets (images, icons) — cache first
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
