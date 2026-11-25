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
  // Urgency 'high' so reminders wake the device promptly (was absent -> 'normal' default, which can let
  // the push service batch/delay delivery — the ~2-min lateness owners saw). TTL 1 day keeps a sensible window.
  return fetch(sub.endpoint,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm',TTL:'86400',Urgency:'high'},body:enc});
}

// Cache-Control:no-store on EVERY response (incl. OPTIONS, /health, errors) so no client ever caches a stale version.
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
const JH={...CORS,'Content-Type':'application/json'};
const json=(obj,status)=>new Response(JSON.stringify(obj),{status:status||200,headers:JH});
// parse the body, returning {ok:false} on malformed JSON (-> 400, never a 500 for bad client input)
async function readJson(req){try{return {ok:true,data:await req.json()};}catch(_){return {ok:false};}}

// ── Worker ─────────────────────────────────────────────────────────────────────
export default {
  async fetch(req,env){
   try{
    if(req.method==='OPTIONS')return new Response(null,{headers:CORS});
    const url=new URL(req.url);
    const path=url.pathname;

    // GET /health — capability probe (no secrets); always fresh (no-store via CORS).
    if(path==='/health'){
      if(req.method!=='GET'&&req.method!=='HEAD')return json({error:'method not allowed'},405);
      return json({version:'2026-11-25b',routes:['subscribe','schedule','cleanup','send-now']});
    }

    // the POST endpoints: parse the body ONCE here -> malformed JSON is a 400, never a 500 (W3)
    const POST_ROUTES={'/subscribe':1,'/schedule':1,'/cleanup':1,'/send-now':1};
    if(POST_ROUTES[path]){
      if(req.method!=='POST')return json({error:'method not allowed, use POST'},405);
      const parsed=await readJson(req);
      if(!parsed.ok)return json({error:'invalid JSON body'},400);
      const body=parsed.data||{};

      // POST /subscribe — store push subscription
      if(path==='/subscribe'){
        if(!body.userId||!body.subscription)return json({error:'userId and subscription required'},400);
        await env.KV.put(`sub:${body.userId}`,JSON.stringify(body.subscription),{expirationTtl:86400*365});
        return json({ok:true});
      }

      // POST /schedule — store scheduled notifications (also persists actions/payload/requireInteraction/tag)
      if(path==='/schedule'){
        const {userId,notifications}=body;
        if(!userId||!Array.isArray(notifications))return json({error:'userId and notifications[] required'},400);
        let stored=0;
        for(const n of notifications){
          if(!n||!n.id||!n.fireAt)continue;                    // skip a malformed entry rather than throw
          const ttl=Math.max(60,Math.ceil((new Date(n.fireAt)-Date.now())/1000)+3600);
          const rec={userId,title:n.title,body:n.body,fireAt:n.fireAt};
          if(n.actions)rec.actions=n.actions;
          if(n.payload)rec.payload=n.payload;
          if(n.requireInteraction)rec.requireInteraction=true;
          if(n.tag)rec.tag=n.tag;
          await env.KV.put(`notif:${n.id}`,JSON.stringify(rec),{expirationTtl:ttl});
          stored++;
        }
        return json({ok:true,stored});
      }

      // POST /cleanup — delete this user's stored notifs NOT in validIds (cancels the pending unlock+rescue on start)
      if(path==='/cleanup'){
        const {userId,validIds=[]}=body;
        if(!userId)return json({error:'userId required'},400);
        const valid=new Set(Array.isArray(validIds)?validIds:[]);
        const list=await env.KV.list({prefix:'notif:'});
        let deleted=0;
        // W1 FIX: sequential + per-entry try/catch. A single non-JSON legacy value used to throw here with no
        // catch -> the bare 500 "error code 1101" + no CORS. Now one bad key is skipped, never aborting the request.
        for(const {name} of list.keys){
          try{
            const raw=await env.KV.get(name);if(!raw)continue;
            let n;try{n=JSON.parse(raw);}catch(_){continue;}
            if(n&&n.userId===userId&&!valid.has(name.slice(6))){await env.KV.delete(name);deleted++;}
          }catch(_){/* one key failing never fails the whole cleanup */}
        }
        return json({ok:true,deleted});
      }

      // POST /send-now — immediately send a push (test); accepts the optional v2 shape
      if(path==='/send-now'){
        const {userId}=body;
        if(!userId)return json({error:'userId required'},400);
        const sub=JSON.parse(await env.KV.get(`sub:${userId}`)||'null');
        if(!sub)return json({error:'no subscription for '+userId},404);
        const r=await sendPush(sub,{title:body.title||'🧪 Test',body:body.body||'immediate test',actions:body.actions,payload:body.payload,requireInteraction:body.requireInteraction,tag:body.tag},env);
        return json({status:r.status,ok:r.ok});
      }
    }

    // GET /debug?userId=... — invented data only; no raw endpoint echoed back
    if(path==='/debug'&&req.method==='GET'){
      const userId=url.searchParams.get('userId')||'anon';
      const sub=await env.KV.get(`sub:${userId}`);
      const notifList=await env.KV.list({prefix:'notif:'});
      const notifs=[];
      for(const{name}of notifList.keys){try{const v=await env.KV.get(name);if(v){const p=JSON.parse(v);if(p.userId===userId)notifs.push({key:name,...p});}}catch(_){}}
      return json({hasSubscription:!!sub,pendingNotifs:notifs});
    }

    return json({error:'not found',path},404);
   }catch(e){
    // W2: ANY unexpected failure returns JSON {error} + CORS + no-store — never a bare 1101 without CORS
    return json({error:'server error',detail:String((e&&e.message)||e)},500);
   }
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
          // Delete the subscription ONLY on 410 Gone (the spec-defined "permanently unsubscribed").
          // A 404 on one send can be transient/gateway-specific; deleting on it wiped a still-valid
          // registration, so the next /send-now answered 'no subscription' (404 'אין מנוי').
          if(r.status===410)await env.KV.delete(`sub:${notif.userId}`);
        }catch(e){console.error('sendPush failed:',e);}
      }
      await env.KV.delete(name);
    }));
  }
};
