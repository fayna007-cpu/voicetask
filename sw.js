const V = 'vt-v2';
const ASSETS = ['./manifest.json', './icon.svg'];

// On install: cache only static assets (not HTML — so updates reach the user)
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

// On activate: delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Push from server (works when app is closed)
self.addEventListener('push', e => {
  let data={title:'VoiceTask 🔔',body:''};
  try{data={...data,...e.data.json()};}catch(_){}
  e.waitUntil(self.registration.showNotification(data.title,{
    body:data.body,icon:'./icon.svg',badge:'./icon.svg',
    dir:'rtl',vibrate:[200,100,200],tag:data.tag||'vt-push'
  }));
});

// Notification click — open/focus the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window'}).then(cs=>{
    const c=cs.find(x=>x.url.includes(self.location.origin)&&'focus'in x);
    return c?c.focus():clients.openWindow('/');
  }));
});

// Push notification via message from main thread (fallback when app is open)
self.addEventListener('message', event => {
  if(event.data&&event.data.type==='SHOW_NOTIFICATION'){
    self.registration.showNotification(event.data.title,{
      body:event.data.body,icon:'./icon.svg',badge:'./icon.svg',
      tag:event.data.tag,dir:'rtl',vibrate:[200,100,200]
    });
  }
});

// Strategy:
//   HTML  → network first (always get latest), fallback to cache
//   Assets → cache first (icon, manifest don't change often)
self.addEventListener('fetch', e => {
  const isHTML = e.request.destination === 'document' ||
                 e.request.url.endsWith('.html') ||
                 e.request.url.endsWith('/');

  if (isHTML) {
    // Network first → always get fresh app, fallback offline
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(V).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Cache first for assets
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
  }
});
