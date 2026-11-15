const assert=require('assert');const {COPY,pick,fill}=require('../wk-copy.js');   // copied from alfred-archive; only this path changed (tests/ lives one level down)
const ALLOWED=new Set('name day time unlock countdown last target pr elapsed duration sets setN exN exTotal n mins'.split(' '));
const SAMPLE={name:'אימון B',day:'שלישי',time:'18:00',unlock:'17:30',countdown:'01:42:10',last:'חזה 28×3, 24×8',target:'28×3',pr:'חזה 30×3',elapsed:'24:10',duration:'52',sets:'14',setN:'3',exN:'2',exTotal:'6',n:'3',mins:'20'};
const BAN=/אשם|עצלן|עצלות|כישלון|נכשלת|פספסת|התבטלת|בושה|חבל שלא|למה לא|אכזבת/;
const emoji=s=>(s.match(/\p{Extended_Pictographic}/gu)||[]).length;
const limit=(path,k)=>/headline|^coach|linePR/.test(path)?(/coach/.test(path)?62:40):/title/.test(path)?28:/body/.test(path)?112:60;
let lists=0,errs=[],totalEmoji=0;
(function walk(o,p){for(const k in o){const v=o[k],q=p+'.'+k;
 if(Array.isArray(v)){lists++;if(new Set(v).size<3)errs.push('few variants '+q);
  v.forEach(t=>{(t.match(/\{(\w+)\}/g)||[]).forEach(m=>{if(!ALLOWED.has(m.slice(1,-1)))errs.push('bad var '+m+' '+q)});
   let r;try{r=fill(t,SAMPLE)}catch(e){errs.push(q+': '+e.message);return}
   const L=/coach/.test(q)?62:/\.title/.test(q)?28:/\.body/.test(q)?112:/headline|linePR/.test(q)?40:60;
   if(r.length>L)errs.push(`too long(${r.length}>${L}) ${q}: ${r}`);
   if(BAN.test(r))errs.push('banned '+q+': '+r);
   if(emoji(r)>2)errs.push('emoji '+q);totalEmoji+=emoji(r);});}
 else if(v&&typeof v==='object')walk(v,q);}})(COPY,'COPY');
['far','tomorrow','locked','open','inProgress','done'].forEach(s=>assert(COPY.card[s],s));
['start','afterFirstSet','lastSet','pr','finish','comebackPostponed','comebackGap'].forEach(s=>assert(COPY.coach[s],s));
['eveningBefore','morning','warmup','unlock','rescue','fridayTeaser'].forEach(s=>assert(COPY.notify[s],s));
let last=-1;for(let i=0;i<20000;i++){const r=pick(COPY.coach.start,last);assert(r.index!==last);last=r.index;}
assert.throws(()=>fill('{x}',{}));
console.log(errs.length?errs.join('\n'):'OK',lists,'lists, emoji total',totalEmoji);process.exit(errs.length?1:0);
