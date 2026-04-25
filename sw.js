const V = 'vt-v25';
const STATIC = ['./manifest.json', './icon.svg'];

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
  let data={title:'VoiceTask 🔔',body:''};
  try{data={...data,...e.data.json()};}catch(_){}
  e.waitUntil(self.registration.showNotification(data.title,{
    body:data.body,icon:'./icon.svg',badge:'./icon.svg',
    dir:'rtl',vibrate:[200,100,200],tag:data.tag||'vt-push'
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window'}).then(cs=>{
    const c=cs.find(x=>x.url.includes(self.location.origin)&&'focus'in x);
    return c?c.focus():clients.openWindow('/');
  }));
});

self.addEventListener('message', event => {
  if(event.data&&event.data.type==='SHOW_NOTIFICATION'){
    self.registration.showNotification(event.data.title,{
      body:event.data.body,icon:'./icon.svg',badge:'./icon.svg',
      tag:event.data.tag,dir:'rtl',vibrate:[200,100,200]
    });
  }
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

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
