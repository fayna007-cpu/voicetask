// VoiceTask Push Notification Worker
// Deploy to Cloudflare Workers (free tier)
// Secrets needed: VAPID_PUBLIC_KEY, VAPID_PRIVATE_JWK, VAPID_SUBJECT

// ── Helpers ────────────────────────────────────────────────────────────────────
function b64u(arr){return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
function b64uDec(s){const b=s.replace(/-/g,'+').replace(/_/g,'/');const p=b.padEnd(b.length+(4-b.length%4)%4,'=');return Uint8Array.from(atob(p),c=>c.charCodeAt(0));}
function concat(...a){const t=a.reduce((s,x)=>s+x.length,0),r=new Uint8Array(t);let o=0;for(const x of a){r.set(x,o);o+=x.length;}return r;}
async function hmac(key,data){const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,data));}
async function hkdf(ikm,salt,info,len){const prk=await hmac(salt,ikm);return(await hmac(prk,concat(info,new Uint8Array([1])))).slice(0,len);}

// ── Web Push Encryption RFC 8291 ───────────────────────────────────────────────
async function encrypt(sub, payload) {
  const p256dh=b64uDec(sub.keys.p256dh), auth=b64uDec(sub.keys.auth);
  const eph=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const ephPub=new Uint8Array(await crypto.subtle.exportKey('raw',eph.publicKey));
  const recvPub=await crypto.subtle.importKey('raw',p256dh,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:recvPub},eph.privateKey,256));
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const ikm=await hkdf(shared,auth,concat(new TextEncoder().encode('WebPush: info\0'),p256dh,ephPub),32);
  const cek=await hkdf(ikm,salt,new TextEncoder().encode('Content-Encoding: aes128gcm\0'),16);
  const nonce=await hkdf(ikm,salt,new TextEncoder().encode('Content-Encoding: nonce\0'),12);
  const aes=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']);
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},aes,concat(new TextEncoder().encode(payload),new Uint8Array([2]))));
  return concat(salt,new Uint8Array([0,0,16,0]),new Uint8Array([65]),ephPub,ct);
}

// ── VAPID JWT ──────────────────────────────────────────────────────────────────
async function vapidAuth(endpoint,pub,privJwk,subject){
  const origin=new URL(endpoint).origin,now=Math.floor(Date.now()/1000);
  const e=o=>btoa(JSON.stringify(o)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const input=`${e({typ:'JWT',alg:'ES256'})}.${e({aud:origin,exp:now+43200,sub:subject})}`;
  const key=await crypto.subtle.importKey('jwk',JSON.parse(privJwk),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const sig=b64u(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(input))));
  return `vapid t=${input}.${sig},k=${pub}`;
}

// ── Send push ──────────────────────────────────────────────────────────────────
// notif shape: {title, body, actions?, payload?, requireInteraction?, tag?}
// - payload carries {type, id, stage} so the SW can filter by IDB status and
//   route notificationclick to the right deep link.
// - actions: array of {action, title} — SW passes to showNotification.
async function sendPush(sub,notif,env){
  const body={
    title:notif.title||'Alfred 🔔',body:notif.body||'',
    icon:'./icon.svg',badge:'./icon.svg',dir:'rtl',vibrate:[200,100,200]
  };
  if(notif.actions&&Array.isArray(notif.actions))body.actions=notif.actions;
  if(notif.payload)body.payload=notif.payload;
  if(notif.requireInteraction)body.requireInteraction=true;
  if(notif.tag)body.tag=notif.tag;
  const payload=JSON.stringify(body);
  const [enc,auth]=await Promise.all([encrypt(sub,payload),vapidAuth(sub.endpoint,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_JWK,env.VAPID_SUBJECT)]);
  return fetch(sub.endpoint,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm',TTL:'86400'},body:enc});
}

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};

// ── Worker ─────────────────────────────────────────────────────────────────────
export default {
  async fetch(req,env){
    if(req.method==='OPTIONS')return new Response(null,{headers:CORS});
    const url=new URL(req.url);

    // POST /subscribe — store push subscription
    if(url.pathname==='/subscribe'&&req.method==='POST'){
      const{subscription,userId}=await req.json();
      await env.KV.put(`sub:${userId}`,JSON.stringify(subscription),{expirationTtl:86400*365});
      return new Response('OK',{headers:CORS});
    }

    // POST /schedule — store scheduled notifications (now also persists
    // actions/payload/requireInteraction/tag for Stage 2+ SW-side filtering)
    if(url.pathname==='/schedule'&&req.method==='POST'){
      const{userId,notifications}=await req.json();
      for(const n of notifications){
        const ttl=Math.max(60,Math.ceil((new Date(n.fireAt)-Date.now())/1000)+3600);
        const stored={userId,title:n.title,body:n.body,fireAt:n.fireAt};
        if(n.actions)stored.actions=n.actions;
        if(n.payload)stored.payload=n.payload;
        if(n.requireInteraction)stored.requireInteraction=true;
        if(n.tag)stored.tag=n.tag;
        await env.KV.put(`notif:${n.id}`,JSON.stringify(stored),{expirationTtl:ttl});
      }
      return new Response('OK',{headers:CORS});
    }

    // POST /cleanup — delete any stored notifs for userId NOT in validIds
    if(url.pathname==='/cleanup'&&req.method==='POST'){
      const{userId,validIds=[]}=await req.json();
      const list=await env.KV.list({prefix:'notif:'});
      await Promise.all(list.keys.map(async({name})=>{
        const raw=await env.KV.get(name);if(!raw)return;
        const n=JSON.parse(raw);
        if(n.userId===userId&&!validIds.includes(name.slice(6)))await env.KV.delete(name);
      }));
      return new Response('OK',{headers:CORS});
    }

    // GET /debug?userId=... — check what's stored for this user
    if(url.pathname==='/debug'&&req.method==='GET'){
      const userId=url.searchParams.get('userId')||'anon';
      const sub=await env.KV.get(`sub:${userId}`);
      const notifList=await env.KV.list({prefix:'notif:'});
      const notifs=[];
      for(const{name}of notifList.keys){
        const v=await env.KV.get(name);
        if(v){const p=JSON.parse(v);if(p.userId===userId)notifs.push({key:name,...p});}
      }
      return new Response(JSON.stringify({
        hasSubscription:!!sub,
        subscriptionEndpoint:sub?JSON.parse(sub).endpoint?.slice(0,60)+'...':null,
        pendingNotifs:notifs
      },{},2),{headers:{...CORS,'Content-Type':'application/json'}});
    }

    // POST /send-now — immediately send a push (test). Accepts optional
    // actions/payload/requireInteraction/tag for testing the v2 shape.
    if(url.pathname==='/send-now'&&req.method==='POST'){
      const body=await req.json();
      const{userId}=body;
      const sub=JSON.parse(await env.KV.get(`sub:${userId}`)||'null');
      if(!sub)return new Response(JSON.stringify({error:'no subscription for '+userId}),{status:404,headers:{...CORS,'Content-Type':'application/json'}});
      const r=await sendPush(sub,{
        title:body.title||'🧪 Test',body:body.body||'immediate test',
        actions:body.actions,payload:body.payload,requireInteraction:body.requireInteraction,tag:body.tag
      },env);
      return new Response(JSON.stringify({status:r.status,ok:r.ok}),{headers:{...CORS,'Content-Type':'application/json'}});
    }

    return new Response('VoiceTask Push Server',{headers:CORS});
  },

  // Runs every minute — sends due notifications
  async scheduled(_,env){
    const now=Date.now();
    const list=await env.KV.list({prefix:'notif:'});
    await Promise.all(list.keys.map(async({name})=>{
      const notif=JSON.parse(await env.KV.get(name)||'null');
      if(!notif||new Date(notif.fireAt).getTime()>now)return;
      const sub=JSON.parse(await env.KV.get(`sub:${notif.userId}`)||'null');
      if(sub){
        try{
          const r=await sendPush(sub,notif,env);
          // 410 = subscription expired, 404 = gone — delete subscription too
          if(r.status===410||r.status===404)await env.KV.delete(`sub:${notif.userId}`);
        }catch(e){console.error('sendPush failed:',e);}
      }
      await env.KV.delete(name);
    }));
  }
};
