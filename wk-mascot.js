// wk-mascot.js v3.1 (calm palette, breathe() + "count" for the rest ring) - Alfred as the workout coach: a rigged SVG character (2-bone arms, spring physics, gestures, speech). No dependencies.
// m = WkMascot.mount(el, {variant:'strength'|'class', mode:'calm'|'coach'|'fire', onTap:fn})   el should have a height (e.g. 64px); width is free: the speech bubble fills it.
//   m.set(state)  idle start met exceed under pr rest wake finish nudge think shrug tap watch   (gesture + expression; a new one replaces the old)
//   m.say(text, {ms, mood})   speech bubble: words appear one by one, the mouth moves while he speaks, then fades. mood = a state to play with it
//   m.look(nx,ny,holdMs)      eyes glance toward a point in [-1,1] (the touched button), then drift back
//   m.progress(0..1)          halo grows through the workout
//   m.mode('calm'|'coach'|'fire')   spring feel + baseline expression
//   m.destroy()
// Cost: CSS does breathing; ONE requestAnimationFrame loop runs only while something moves; paused when hidden; prefers-reduced-motion = poses without motion.
(function (root) {
  'use strict';
  var uid = 0, NS = 'http://www.w3.org/2000/svg';
  var P = ['lookX', 'lookY', 'open', 'happy', 'browLA', 'browRA', 'browLift', 'mouthW', 'mouthC', 'mouthO', 'squash', 'lean', 'bob', 'hLx', 'hLy', 'hRx', 'hRy', 'thumbL', 'thumbR', 'point', 'pointAng', 'alert', 'sweat', 'glow', 'cheek', 'tail'];
  var KM = { open: 5, happy: 2, mouthO: 2.2, lookX: 2.2, lookY: 2.2, glow: .35, tail: .55, cheek: .8, thumbL: 2.5, thumbR: 2.5, point: 2.2, alert: 3, sweat: 1.2, hLx: 1.3, hLy: 1.3, hRx: 1.3, hRy: 1.3 };
  var FEEL = { calm: { k: 110, z: 1.0, amp: .8 }, coach: { k: 185, z: .72, amp: 1 }, fire: { k: 250, z: .6, amp: 1.2 } };
  var MODEBASE = { calm: { mouthC: .32, open: .93, cheek: .35 }, coach: { mouthC: .38, open: 1, cheek: .35 }, fire: { browLA: 7, browRA: 7, mouthC: .22, open: 1, cheek: .25, browLift: 1 } };
  var BASE = { lookX: 0, lookY: 0, open: 1, happy: 0, browLA: 0, browRA: 0, browLift: 0, mouthW: 12, mouthC: .38, mouthO: 0, squash: 0, lean: 0, bob: 0, hLx: 22, hLy: 98, hRx: 118, hRy: 98, thumbL: 0, thumbR: 0, point: 0, pointAng: 100, alert: 0, sweat: 0, glow: 0, cheek: .35, tail: 0 };
  var AMP = { bob: 1, squash: 1, lean: 1 };
  var UP = { hLx: 20, hLy: 26, hRx: 120, hRy: 26 }, CLAP = { hLx: 62, hLy: 90, hRx: 78, hRy: 90 }, OPEN = { hLx: 40, hLy: 86, hRx: 100, hRy: 86 };
  function m2(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  // steps are CUMULATIVE (the first one starts from the baseline); {} = back to baseline; third item 'burst' = sparkles
  var CH = {
    idle: [[0, {}]],
    watch: [[0, {}]],
    start: [[0, { squash: .07, mouthC: .75, browLift: 2 }], [200, { bob: -7, squash: -.04, hLx: 14, hLy: 36 }], [420, { bob: 0, squash: 0, hLx: 26, hLy: 32 }], [600, { hLx: 12, hLy: 34 }], [780, { hLx: 26, hLy: 32 }], [960, { hLx: 12, hLy: 34 }], [1250, {}]],
    met: [[0, { lean: 6, bob: 3, mouthC: .65, browLift: 1, hRx: 104, hRy: 74, thumbR: 1 }], [260, { lean: -1.5, bob: -1 }], [1100, {}]],
    exceed: [[0, { squash: .1 }], [110, { bob: -15, squash: -.07, hRx: 112, hRy: 32, mouthC: .95, mouthO: .5, browLift: 3, cheek: .85, lean: -3 }], [520, { bob: 0, squash: .06, hRy: 40 }], [760, { squash: 0 }], [1600, {}]],
    under: [[0, { browLA: 15, browRA: 15, mouthC: -.2, mouthW: 10, lean: -3, bob: 2, open: .8, cheek: .1 }], [380, { hRx: 108, hRy: 104, point: 1, pointAng: 112 }], [1100, { open: 1, lean: 2 }], [2100, {}]],
    pr: [[0, { squash: .15, hLx: 30, hLy: 100, hRx: 110, hRy: 100 }], [140, m2(UP, { bob: -30, squash: -.09, happy: 1, mouthC: 1, mouthO: .85, browLift: 4, cheek: 1, glow: 1 }), 'burst'], [560, { bob: 0, squash: .13, hLy: 40, hRy: 40 }], [740, { squash: -.02 }], [900, m2(CLAP, { bob: -5, squash: 0 })], [1050, m2(OPEN, { bob: 0 })], [1200, CLAP], [1350, OPEN], [1500, CLAP], [1750, { hLx: 22, hLy: 98, hRx: 118, hRy: 98 }], [3000, { happy: 0, mouthO: 0 }], [3600, {}]],
    rest: [[0, { open: .5, mouthC: .12, mouthW: 8, mouthO: .28, cheek: .5, hLx: 24, hLy: 100, hRx: 116, hRy: 100, sweat: 1 }], [2400, { sweat: 0 }]],
    wake: [[0, { open: 1.12, browLift: 3, lean: -7, lookY: .9, mouthC: .55, alert: 1, hRx: 108, hRy: 104, point: 1, pointAng: 100 }], [160, { bob: -9, lean: -4 }], [400, { bob: 0 }], [1100, { alert: 0 }]],
    finish: [[0, { squash: .1 }], [140, { bob: -16, happy: 1, mouthC: 1, mouthO: .55, cheek: 1, hRx: 104, hRy: 72, thumbR: 1, hLx: 36, hLy: 100 }, 'burst'], [640, { bob: 0, squash: .08 }], [900, { squash: 0 }], [1500, { lean: 9, bob: 3 }], [2150, { lean: 0, bob: 0 }], [3000, { happy: 0, mouthO: 0, mouthC: .8, thumbR: 0, hRx: 118, hRy: 98, hLx: 22, hLy: 98 }], [3700, {}]],
    nudge: [[0, { lookY: .95, lean: -4, hRx: 108, hRy: 104, point: 1, pointAng: 105, mouthC: .5, browLift: 2 }], [500, { bob: -4 }], [800, { bob: 0 }], [1900, {}]],
    think: [[0, { hRx: 86, hRy: 90, lookX: -.6, lookY: -.7, browLA: -6, browRA: 6, mouthC: 0, mouthW: 7, lean: 3 }], [1500, {}]],
    shrug: [[0, { hLx: 10, hLy: 78, hRx: 130, hRy: 78, browLift: 4, mouthC: -.1, mouthW: 9, bob: -2, lean: 2 }], [1300, {}]],
    count: [[0, { bob: -5, squash: -.04, open: 1.1, lookY: .8 }], [170, { bob: 0, squash: 0 }], [420, {}]],   // one beat per second of the last 3 of a rest
    tap: [[0, { squash: .1 }], [100, { bob: -12, squash: -.05, happy: .8, mouthC: .9, mouthO: .4 }], [380, { bob: 0, squash: .05 }], [600, { squash: 0 }], [1200, {}]]
  };
  var HOLD = { rest: 1, wake: 1 };

  function head(id) {
    return '<defs><radialGradient id="b' + id + '" cx="36%" cy="28%" r="85%"><stop offset="0" stop-color="#d9d3f5"/><stop offset=".45" stop-color="#958ddb"/><stop offset=".85" stop-color="#5b53b0"/><stop offset="1" stop-color="#423b8c"/></radialGradient>' +
      '<radialGradient id="h' + id + '" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#d6ccff"/><stop offset="1" stop-color="#6a58dc"/></radialGradient>' +
      '<radialGradient id="s' + id + '" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="r' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#2b1f7a" stop-opacity=".5"/></linearGradient></defs>';
  }
  function svg(id, variant) {
    var acc = variant === 'class'
      ? '<path d="M27 66 Q25 22 70 19 Q115 22 113 66" fill="none" stroke="#5b52b3" stroke-width="5.5" stroke-linecap="round"/><path d="M27 66 Q25 22 70 19 Q115 22 113 66" fill="none" stroke="#8d82ef" stroke-width="1.6" stroke-linecap="round" opacity=".7"/><g data-r="cupL"><rect x="15" y="58" width="13" height="24" rx="6.5" fill="#4a4194"/><rect x="18" y="64" width="3" height="12" rx="1.5" fill="var(--acc)" opacity=".85"/></g><g data-r="cupR"><rect x="112" y="58" width="13" height="24" rx="6.5" fill="#4a4194"/><rect x="119" y="64" width="3" height="12" rx="1.5" fill="var(--acc)" opacity=".85"/></g>'
      : '<path d="M27 43 Q70 20 113 43" fill="none" stroke="#2a2550" stroke-width="9" stroke-linecap="round"/><path d="M27 43 Q70 20 113 43" fill="none" stroke="var(--acc)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3 7" opacity=".9"/><g data-r="tail"><path d="M112 43 q9 3 12 16" fill="none" stroke="#4a4194" stroke-width="6" stroke-linecap="round"/><path d="M110 45 q2 12 -3 22" fill="none" stroke="#4a4194" stroke-width="5.5" stroke-linecap="round"/></g>';
    function arm(s) { return '<path data-r="arm' + s + 'a" fill="none" stroke="#5a49c9" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path data-r="arm' + s + 'b" fill="none" stroke="#8f7df5" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>'; }
    function hand(s) { return '<g data-r="hand' + s + '"><rect data-r="fin' + s + '" x="4" y="-2.2" width="0.01" height="4.4" rx="2.2" fill="#b6a9ff"/><ellipse data-r="th' + s + '" cx="0" cy="-9" rx="3.4" ry="5.4" fill="#b6a9ff" opacity="0"/><circle r="9.2" fill="url(#h' + id + ')"/><ellipse cx="-3" cy="-3.4" rx="3.2" ry="2" fill="#fff" opacity=".35"/></g>'; }
    return '<svg class="wkm" viewBox="-14 -26 168 176" role="img" aria-label="מאמן" style="overflow:visible;display:block;width:100%;height:100%;--acc:#9d8cff">' + head(id) +
      '<ellipse data-r="shadow" cx="70" cy="126" rx="32" ry="5.2" fill="url(#s' + id + ')"/>' +
      '<g data-r="root"><g data-r="body"><g class="wkm-breath">' +
      '<circle data-r="ring" class="wkm-ring" cx="70" cy="66" r="52" fill="none" stroke="var(--acc)" stroke-width="2"/>' + arm('L') + arm('R') +
      '<circle cx="70" cy="66" r="44" fill="url(#b' + id + ')"/><circle cx="70" cy="66" r="44" fill="url(#r' + id + ')"/>' +
      '<path d="M101 38 A44 44 0 0 1 112 70" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".16"/>' +
      '<g data-r="spec"><ellipse cx="54" cy="38" rx="15" ry="7" fill="#fff" opacity=".2" transform="rotate(-24 54 38)"/></g>' + acc +
      '<ellipse data-r="chL" cx="43" cy="79" rx="6.5" ry="3.8" fill="#e8b4cb"/><ellipse data-r="chR" cx="97" cy="79" rx="6.5" ry="3.8" fill="#e8b4cb"/>' +
      '<g data-r="eyes"><g data-r="eyeL" transform="translate(54 62)"><ellipse data-r="eL" rx="6.4" ry="8.8" fill="#1b1736"/><circle cx="2.2" cy="-3.6" r="2.1" fill="#fff"/><circle cx="-2" cy="3" r="1" fill="#fff" opacity=".6"/><path data-r="hL" d="M-8 4 Q0 -9 8 4" fill="none" stroke="#1b1736" stroke-width="3.2" stroke-linecap="round" opacity="0"/></g>' +
      '<g data-r="eyeR" transform="translate(86 62)"><ellipse data-r="eR" rx="6.4" ry="8.8" fill="#1b1736"/><circle cx="2.2" cy="-3.6" r="2.1" fill="#fff"/><circle cx="-2" cy="3" r="1" fill="#fff" opacity=".6"/><path data-r="hR" d="M-8 4 Q0 -9 8 4" fill="none" stroke="#1b1736" stroke-width="3.2" stroke-linecap="round" opacity="0"/></g></g>' +
      '<line data-r="bL" x1="44" y1="47" x2="63" y2="47" stroke="#1b1736" stroke-width="3.4" stroke-linecap="round"/><line data-r="bR" x1="77" y1="47" x2="96" y2="47" stroke="#1b1736" stroke-width="3.4" stroke-linecap="round"/>' +
      '<path data-r="mouth" d="" stroke="#1b1736" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round" fill="#1b1736" fill-opacity="0"/>' +
      '<path data-r="sweat" d="M0 -6 C4 -1 5 2 0 5 C-5 2 -4 -1 0 -6Z" fill="#bfe3ff" opacity="0"/>' +
      hand('L') + hand('R') + '</g></g>' +
      '<g data-r="alert" opacity="0"><rect x="-3.2" y="-13" width="6.4" height="14" rx="3.2" fill="var(--acc)"/><circle cx="0" cy="6" r="3.4" fill="var(--acc)"/></g><g data-r="fx"></g></g></svg>';
  }
  var css = '.wkm-wrap{display:flex;align-items:center;gap:10px;height:100%;direction:rtl;--acc:#9d8cff}.wkm-char{flex:0 0 auto;height:100%;aspect-ratio:1/1;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}' +
    '.wkm-bubble{flex:1 1 auto;min-width:0;position:relative;box-sizing:border-box;padding:9px 13px;border-radius:16px;color:#ece9ff;font-size:14px;line-height:1.35;background:linear-gradient(180deg,rgba(70,60,150,.55),rgba(36,30,84,.62));border:1px solid color-mix(in srgb,var(--acc) 40%,transparent);box-shadow:0 6px 18px rgba(8,6,30,.35);opacity:0;transform:translateY(4px) scale(.98);transition:opacity .25s ease,transform .3s cubic-bezier(.3,1.3,.5,1);pointer-events:none;overflow:hidden}' +
    '.wkm-bubble.on{opacity:1;transform:none;pointer-events:auto}.wkm-bubble:before{content:"";position:absolute;inset-inline-start:-6px;top:50%;width:10px;height:10px;margin-top:-5px;transform:rotate(45deg);background:rgba(58,50,128,.7);border-inline-start:1px solid color-mix(in srgb,var(--acc) 40%,transparent);border-block-end:1px solid color-mix(in srgb,var(--acc) 40%,transparent)}' +
    '.wkm-bubble span{opacity:0;transition:opacity .22s ease}.wkm-bubble span.on{opacity:1}' +
    '.wkm .wkm-breath{transform-origin:70px 120px;animation:wkm-b var(--bt,3.6s) ease-in-out infinite}.wkm .wkm-ring{transform-origin:70px 66px;animation:wkm-r var(--rt,3.6s) ease-in-out infinite}' +
    '.wkm.wkm-rest .wkm-breath{animation:wkm-bb 8s ease-in-out infinite}.wkm.wkm-rest .wkm-ring{animation:wkm-rb 8s ease-in-out infinite}@keyframes wkm-bb{0%,100%{transform:scale(1,1)}50%{transform:scale(1.05,1.04)}}@keyframes wkm-rb{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.14);opacity:1}}' +
    '@keyframes wkm-b{0%,100%{transform:scale(1,1)}50%{transform:scale(1.018,.982)}}@keyframes wkm-r{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}' +
    '@media (prefers-reduced-motion:reduce){.wkm .wkm-breath,.wkm .wkm-ring,.wkm.wkm-rest .wkm-breath,.wkm.wkm-rest .wkm-ring{animation:none}.wkm-bubble,.wkm-bubble span{transition:none}}';
  var injected = false; function inject() { if (injected) return; var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); injected = true; }
  var reduce = function () { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); };
  function ik(side, hx, hy) {
    var sx = side < 0 ? 32 : 108, sy = 84, a = 21, b = 21, dx = hx - sx, dy = hy - sy, d = Math.max(9, Math.sqrt(dx * dx + dy * dy)), ang = Math.atan2(dy, dx), dd = Math.min(d, a + b - .8);
    var A = Math.acos(Math.max(-1, Math.min(1, (a * a + dd * dd - b * b) / (2 * a * dd)))), sg = side < 0 ? 1 : -1;
    return { sx: sx, sy: sy, ex: sx + a * Math.cos(ang + sg * A), ey: sy + a * Math.sin(ang + sg * A), px: sx + dd * Math.cos(ang), py: sy + dd * Math.sin(ang) };
  }

  function mount(el, o) {
    o = o || {}; inject(); var id = ++uid;
    el.innerHTML = '<div class="wkm-wrap"><div class="wkm-char" role="button" tabindex="0" aria-label="מאמן">' + svg(id, o.variant || 'strength') + '</div><div class="wkm-bubble" aria-live="polite"></div></div>';
    var wrap = el.firstChild, charEl = wrap.firstChild, bubble = wrap.lastChild, node = charEl.firstChild, q = function (n) { return node.querySelector('[data-r="' + n + '"]'); };
    var R = {}; ['root', 'body', 'shadow', 'ring', 'spec', 'eyes', 'eL', 'eR', 'hL', 'hR', 'bL', 'bR', 'mouth', 'chL', 'chR', 'tail', 'fx', 'cupL', 'cupR', 'armLa', 'armLb', 'armRa', 'armRb', 'handL', 'handR', 'finL', 'finR', 'thL', 'thR', 'sweat', 'alert'].forEach(function (n) { R[n] = q(n); });
    var mode = o.mode || 'coach', S = {}, T = {}, V = {}, base = {}, running = false, last = 0, timers = [], parts = [], destroyed = false, lookUntil = 0, prog = 0, blinkT = 0, sacT = 0, talkT = 0, hideT = 0, wordT = [], talking = false;
    P.forEach(function (p) { S[p] = BASE[p]; V[p] = 0; });
    function accent(m) { return m === 'fire' ? '#c77dff' : m === 'calm' ? '#8fb4ff' : '#9d8cff'; }
    function rebase() { base = {}; for (var p in BASE) base[p] = BASE[p]; var mb = MODEBASE[mode]; for (var k in mb) base[k] = mb[k]; base.glow = prog * .85; }
    function paintMode() { node.style.setProperty('--bt', mode === 'fire' ? '2.4s' : mode === 'calm' ? '4.8s' : '3.6s'); node.style.setProperty('--rt', mode === 'fire' ? '1.8s' : mode === 'calm' ? '5s' : '3.6s'); node.style.setProperty('--acc', accent(mode)); wrap.style.setProperty('--acc', accent(mode)); }
    rebase(); P.forEach(function (p) { T[p] = base[p]; S[p] = base[p]; }); paintMode();
    function mouthD(w, c, op) { var y = 80, x1 = 70 - w, x2 = 70 + w, cy = y - c * 3, cu = y + c * 10, cl = cu + op * 26 + (op > .05 ? 2 : 0); return 'M' + x1 + ' ' + cy + ' Q70 ' + cu + ' ' + x2 + ' ' + cy + ' Q70 ' + cl + ' ' + x1 + ' ' + cy + 'Z'; }
    function apply() {
      var sq = S.squash;
      R.root.setAttribute('transform', 'translate(0 ' + S.bob.toFixed(2) + ') rotate(' + S.lean.toFixed(2) + ' 70 120)');
      R.body.setAttribute('transform', 'translate(70 120) scale(' + (1 - sq * .55).toFixed(3) + ' ' + (1 + sq).toFixed(3) + ') translate(-70 -120)');
      R.eyes.setAttribute('transform', 'translate(' + (S.lookX * 4.6).toFixed(2) + ' ' + (S.lookY * 3.4).toFixed(2) + ')'); R.spec.setAttribute('transform', 'translate(' + (S.lookX * 2.2).toFixed(2) + ' ' + (S.lookY * 1.4).toFixed(2) + ')');
      var op = Math.max(.06, Math.min(1.25, S.open)), hp = Math.max(0, Math.min(1, S.happy)), es = 'scale(1 ' + op.toFixed(3) + ')'; R.eL.setAttribute('transform', es); R.eR.setAttribute('transform', es);
      var eo = Math.max(0, 1 - hp * 2.2).toFixed(2), ao = Math.min(1, hp * 2.2).toFixed(2); R.eL.setAttribute('opacity', eo); R.eR.setAttribute('opacity', eo); R.hL.setAttribute('opacity', ao); R.hR.setAttribute('opacity', ao);
      R.bL.setAttribute('transform', 'translate(0 ' + (-S.browLift).toFixed(2) + ') rotate(' + S.browLA.toFixed(2) + ' 53.5 47)'); R.bR.setAttribute('transform', 'translate(0 ' + (-S.browLift).toFixed(2) + ') rotate(' + (-S.browRA).toFixed(2) + ' 86.5 47)');
      var mo = Math.max(0, S.mouthO); R.mouth.setAttribute('d', mouthD(S.mouthW, S.mouthC, mo)); R.mouth.setAttribute('fill-opacity', Math.min(1, mo * 3).toFixed(2));
      var L = ik(-1, S.hLx, S.hLy), Rr = ik(1, S.hRx, S.hRy), dl = 'M' + L.sx + ' ' + L.sy + ' L' + L.ex.toFixed(1) + ' ' + L.ey.toFixed(1) + ' L' + L.px.toFixed(1) + ' ' + L.py.toFixed(1), dr = 'M' + Rr.sx + ' ' + Rr.sy + ' L' + Rr.ex.toFixed(1) + ' ' + Rr.ey.toFixed(1) + ' L' + Rr.px.toFixed(1) + ' ' + Rr.py.toFixed(1);
      R.armLa.setAttribute('d', dl); R.armLb.setAttribute('d', dl); R.armRa.setAttribute('d', dr); R.armRb.setAttribute('d', dr);
      R.handL.setAttribute('transform', 'translate(' + L.px.toFixed(1) + ' ' + L.py.toFixed(1) + ')'); R.handR.setAttribute('transform', 'translate(' + Rr.px.toFixed(1) + ' ' + Rr.py.toFixed(1) + ')');
      R.thL.setAttribute('opacity', Math.max(0, Math.min(1, S.thumbL)).toFixed(2)); R.thR.setAttribute('opacity', Math.max(0, Math.min(1, S.thumbR)).toFixed(2));
      var pw = Math.max(.01, 14 * Math.max(0, Math.min(1, S.point))); R.finR.setAttribute('width', pw.toFixed(2)); R.finR.setAttribute('transform', 'rotate(' + S.pointAng.toFixed(1) + ')');
      R.chL.setAttribute('opacity', Math.max(0, S.cheek * .75).toFixed(2)); R.chR.setAttribute('opacity', Math.max(0, S.cheek * .75).toFixed(2));
      var g = Math.max(0, Math.min(1, S.glow)); R.ring.setAttribute('stroke-opacity', (.2 + .55 * g).toFixed(2)); R.ring.setAttribute('stroke-width', (1.8 + 1.6 * g).toFixed(2));
      var lift = Math.max(0, -S.bob), sh = 1 - Math.min(1, lift / 70) * .4; R.shadow.setAttribute('transform', 'translate(70 126) scale(' + sh.toFixed(3) + ') translate(-70 -126)'); R.shadow.setAttribute('opacity', (.9 - Math.min(1, lift / 70) * .5).toFixed(2));
      if (R.tail) R.tail.setAttribute('transform', 'rotate(' + S.tail.toFixed(2) + ' 112 43)'); if (R.cupL) { var cg = (.85 + g * .15).toFixed(2); R.cupL.setAttribute('opacity', cg); R.cupR.setAttribute('opacity', cg); }
      var sw = Math.max(0, Math.min(1, S.sweat)); R.sweat.setAttribute('opacity', (sw * .9).toFixed(2)); R.sweat.setAttribute('transform', 'translate(108 ' + (46 + (1 - sw) * -6 + (1 - sw) * 0).toFixed(1) + ')');
      var al = Math.max(0, Math.min(1.2, S.alert)); R.alert.setAttribute('opacity', Math.min(1, al).toFixed(2)); R.alert.setAttribute('transform', 'translate(70 -8) scale(' + (.4 + al * .6).toFixed(2) + ')');
    }
    function snap() { P.forEach(function (p) { S[p] = T[p]; V[p] = 0; }); apply(); }
    function loop(ts) {
      if (destroyed) return; var dt = Math.min(.034, (ts - (last || ts)) / 1000), f = FEEL[mode], moving = false; last = ts; T.tail = -S.lean * 1.5 + V.bob * .035;
      P.forEach(function (p) { var k = f.k * (KM[p] || 1), c = 2 * f.z * Math.sqrt(k), a = k * (T[p] - S[p]) - c * V[p]; V[p] += a * dt; S[p] += V[p] * dt; if (Math.abs(T[p] - S[p]) > .004 || Math.abs(V[p]) > .03) moving = true; });
      for (var i = parts.length - 1; i >= 0; i--) { var pt = parts[i]; pt.t += dt; pt.vy += 260 * dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.r += pt.vr * dt; var a2 = Math.max(0, 1 - pt.t / pt.life); pt.el.setAttribute('transform', 'translate(' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + ') rotate(' + pt.r.toFixed(0) + ') scale(' + (pt.s * (.5 + a2 * .5)).toFixed(2) + ')'); pt.el.setAttribute('opacity', a2.toFixed(2)); if (pt.t >= pt.life) { R.fx.removeChild(pt.el); parts.splice(i, 1); } else moving = true; }
      apply(); if (moving && !document.hidden) requestAnimationFrame(loop); else { running = false; last = 0; }
    }
    function kick() { if (!running && !destroyed) { running = true; last = 0; requestAnimationFrame(loop); } }
    function clearT() { timers.forEach(clearTimeout); timers = []; }
    function burst() { if (reduce()) return; for (var i = 0; i < 10; i++) { var e = document.createElementNS(NS, 'path'); e.setAttribute('d', 'M0 -5 L1.6 -1.6 L5 0 L1.6 1.6 L0 5 L-1.6 1.6 L-5 0 L-1.6 -1.6Z'); e.setAttribute('fill', i % 3 ? '#f6d77a' : '#fff3c4'); R.fx.appendChild(e); var ang = -Math.PI / 2 + (Math.random() - .5) * 2.8, sp = 70 + Math.random() * 90; parts.push({ el: e, x: 70 + (Math.random() - .5) * 96, y: 8 + Math.random() * 14, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: Math.random() * 90, vr: (Math.random() - .5) * 400, s: .7 + Math.random() * .9, t: 0, life: .9 + Math.random() * .5 }); } kick(); }
    function target(step, first) { var f = FEEL[mode]; if (first || !Object.keys(step).length) { P.forEach(function (p) { T[p] = base[p]; }); } for (var p in step) T[p] = AMP[p] ? step[p] * f.amp : step[p]; }
    function set(state) {
      var seq = CH[state] || CH.idle; clearT();
      if (reduce()) { target({}, true); if (HOLD[state]) { var s2 = seq[seq.length - 1][1]; for (var p in s2) T[p] = s2[p]; } snap(); return; }
      seq.forEach(function (st, i) { timers.push(setTimeout(function () { if (destroyed) return; target(st[1], i === 0); if (st[2] === 'burst') burst(); kick(); }, st[0])); });
    }
    function look(x, y, hold) { lookUntil = Date.now() + (hold || 2200); T.lookX = Math.max(-1, Math.min(1, x || 0)); T.lookY = Math.max(-1, Math.min(1, y || 0)); if (reduce()) { snap(); return; } kick(); timers.push(setTimeout(function () { if (Date.now() >= lookUntil - 20) { T.lookX = 0; T.lookY = 0; kick(); } }, (hold || 2200) + 30)); }
    function stopTalk() { clearInterval(talkT); wordT.forEach(clearTimeout); wordT = []; if (talking) { talking = false; T.mouthO = base.mouthO; T.mouthW = base.mouthW; kick(); } }
    function say(text, so) {
      so = so || {}; stopTalk(); clearTimeout(hideT); var words = String(text || '').replace(/(\d+(?:[.,]\d+)?[×xX*]\d+(?:\+\d+)*)/g, '\u2066$1\u2069').split(/\s+/).filter(Boolean); if (!words.length) return;   // set numerals like 28×8 are LTR-isolated automatically
      bubble.innerHTML = ''; var spans = words.map(function (w, i) { var s = document.createElement('span'); s.textContent = w + (i < words.length - 1 ? ' ' : ''); bubble.appendChild(s); return s; }); bubble.classList.add('on');
      if (so.mood) set(so.mood);
      if (reduce()) { spans.forEach(function (s) { s.classList.add('on'); }); } else {
        var step = 120; spans.forEach(function (s, i) { wordT.push(setTimeout(function () { s.classList.add('on'); }, 60 + i * step)); });
        talking = true; talkT = setInterval(function () { T.mouthO = .12 + Math.random() * .5; T.mouthW = 10 + Math.random() * 4; kick(); }, 130); wordT.push(setTimeout(stopTalk, 60 + words.length * step + 80));
      }
      hideT = setTimeout(function () { bubble.classList.remove('on'); }, so.ms || (2600 + String(text).length * 55 + words.length * 120));
    }
    function blink() { if (destroyed) return; if (!document.hidden && !reduce()) { var prev = T.open; T.open = .06; kick(); setTimeout(function () { T.open = prev; kick(); }, 95); } blinkT = setTimeout(blink, 2600 + Math.random() * 3600); }
    function saccade() { if (destroyed) return; if (!document.hidden && !reduce() && Date.now() > lookUntil) { T.lookX = (Math.random() - .5) * .45; T.lookY = (Math.random() - .5) * .3; kick(); } sacT = setTimeout(saccade, 1400 + Math.random() * 2400); }
    function onVis() { if (!document.hidden) kick(); } document.addEventListener('visibilitychange', onVis);
    function tap() { set('tap'); if (o.onTap) try { o.onTap(api); } catch (e) { } }
    charEl.addEventListener('click', tap); charEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
    bubble.addEventListener('click', function () { bubble.classList.remove('on'); });
    apply(); blinkT = setTimeout(blink, 1800); sacT = setTimeout(saccade, 1200);
    var api = {
      set: set, look: look, say: say,
      breathe: function (on) { node.classList.toggle('wkm-rest', !!on); },   // the rest-ring breathing guide: 4 s in, 4 s out
      progress: function (p) { prog = Math.max(0, Math.min(1, p || 0)); base.glow = prog * .85; T.glow = base.glow; kick(); },
      mode: function (m) { if (!FEEL[m]) return; mode = m; rebase(); T.browLA = base.browLA; T.browRA = base.browRA; T.mouthC = base.mouthC; T.open = base.open; T.glow = base.glow; paintMode(); kick(); },
      destroy: function () { destroyed = true; clearT(); stopTalk(); clearTimeout(blinkT); clearTimeout(sacT); clearTimeout(hideT); document.removeEventListener('visibilitychange', onVis); el.innerHTML = ''; }
    };
    return api;
  }
  root.WkMascot = { mount: mount, STATES: Object.keys(CH) };
  if (typeof module !== 'undefined') module.exports = { mount: mount };
})(typeof window !== 'undefined' ? window : this);
