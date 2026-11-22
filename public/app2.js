/* HYPECUT — habillage de l'application : lumières, fil d'Ariane, barre latérale, analyses récentes.
   Indépendant d'app.js : ne fait que lire l'interface et l'API publique du compte. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NAMES = { creer: 'Créer', 'mes-clips': 'Mes clips', defi: 'Défi GTA VI', revenus: 'Revenus', offres: 'Offres', compte: 'Mon compte', admin: 'Admin' };
  const EN = { Créer: 'Create', 'Mes clips': 'My clips', 'Défi GTA VI': 'GTA VI challenge', Revenus: 'Earnings', Offres: 'Pricing', 'Mon compte': 'My account', 'Moments forts': 'Highlights' };
  const en = window.HC_LANG === 'en';
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------- fil d'Ariane, onglets mobiles, éclat
  function onRoute() {
    const h = (location.hash || '#creer').slice(1);
    let v = h.startsWith('analyse-') ? 'creer' : h;
    if (!NAMES[v]) v = 'creer';
    let name = h.startsWith('analyse-') ? 'Moments forts' : NAMES[v];
    if (en) name = EN[name] || name;
    const c = $('#crumb'); if (c) c.innerHTML = `HYPECUT / <b>${esc(name)}</b>`;
    $$('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.view === v));
    const fl = $('#flash'); if (fl && !reduce) { fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on'); }
  }
  addEventListener('hashchange', onRoute); onRoute();
  $('#tabbar .fab')?.addEventListener('click', (e) => {
    e.preventDefault();
    if ((location.hash || '#creer') === '#creer') { const b = $('#btnAnalyze'); b?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else location.hash = 'creer';
  });

  // ---------------------------------------------------------- projecteur sur les cartes
  document.addEventListener('pointermove', (e) => {
    const c = e.target.closest && e.target.closest('.card'); if (!c) return;
    const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  // ---------------------------------------------------------- étincelles
  (() => {
    const cv = $('#sparks'); if (!cv || reduce) return;
    const x = cv.getContext('2d'); let W = 0, H = 0, d = 1;
    const rs = () => { d = Math.min(2, devicePixelRatio || 1); W = cv.width = innerWidth * d; H = cv.height = innerHeight * d; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px'; };
    rs(); addEventListener('resize', rs);
    const cols = ['255,173,61', '255,61,139', '139,92,246', '46,230,214'];
    const P = Array.from({ length: innerWidth < 700 ? 22 : 42 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: .6 + Math.random() * 1.8, v: .00006 + Math.random() * .00018, c: cols[i % 4], p: Math.random() * 6.28 }));
    const f = (t) => {
      if (document.hidden) { requestAnimationFrame(f); return; }
      x.clearRect(0, 0, W, H);
      for (const s of P) {
        s.y -= s.v * 16; if (s.y < -.02) { s.y = 1.02; s.x = Math.random(); }
        const a = .22 + .32 * Math.sin(t / 900 + s.p), px = (s.x + Math.sin(t / 4000 + s.p) * .01) * W, py = s.y * H, rr = s.r * d;
        const g = x.createRadialGradient(px, py, 0, px, py, rr * 5); g.addColorStop(0, `rgba(${s.c},${a})`); g.addColorStop(1, `rgba(${s.c},0)`);
        x.fillStyle = g; x.fillRect(px - rr * 5, py - rr * 5, rr * 10, rr * 10);
      }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  })();

  // ---------------------------------------------------------- carte de la barre latérale (crédits et offre)
  const pill = $('#creditPill');
  function syncSide() {
    const card = $('#sideCard'); if (!pill || !card) return;
    const txt = pill.textContent.trim();
    const m = /(\d+)\s*cr[ée]dits?\s*·\s*(.+)$/i.exec(txt) || /(\d+)\s*credits?\s*·\s*(.+)$/i.exec(txt);
    if (pill.classList.contains('hidden') || !m) { card.classList.add('hidden'); return; }
    const n = +m[1], plan = m[2].trim();
    card.classList.remove('hidden');
    $('#scPlan').textContent = plan;
    $('#scSub').textContent = en ? 'Your clip credits' : 'Tes crédits de clips';
    $('#scCred').textContent = `${n} ${en ? (n > 1 ? 'credits' : 'credit') : (n > 1 ? 'crédits' : 'crédit')}`;
    const cap = /cr[ée]ateur|creator/i.test(plan) ? 400 : /pro|pass/i.test(plan) ? 100 : Math.max(5, n);
    $('#scBar').style.width = Math.max(4, Math.min(100, (n / cap) * 100)) + '%';
    loadRecent();
  }
  if (pill) new MutationObserver(syncSide).observe(pill, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  syncSide();

  // ---------------------------------------------------------- dernières analyses
  let recentAt = 0;
  async function loadRecent() {
    if (Date.now() - recentAt < 20000) return; recentAt = Date.now();
    try {
      const r = await fetch('api/jobs', { credentials: 'same-origin', cache: 'no-store' }); if (!r.ok) return;
      const { jobs } = await r.json(); if (!jobs || !jobs.length) return;
      const list = jobs.filter((j) => j.status === 'done' || j.status === 'expired').slice(0, 3); if (!list.length) return;
      $('#recentList').innerHTML = list.map((j) => `<a class="rec" href="#analyse-${esc(j.id)}">${j.thumb ? `<img src="${esc(j.thumb)}" alt="">` : '<div class="ph"></div>'}<div><b>${esc(j.title || j.sourceUrl || 'Vidéo')}</b><span>${new Date(String(j.createdAt).replace(' ', 'T') + 'Z').toLocaleDateString(en ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short' })}${j.clipCount ? ` · ${j.clipCount} ${en ? 'highlights' : 'moments'}` : ''}</span></div></a>`).join('');
      $('#recentCard').classList.remove('hidden');
    } catch {}
  }
  addEventListener('hashchange', () => { if ((location.hash || '#creer') === '#creer') { recentAt = 0; if (!pill?.classList.contains('hidden')) loadRecent(); } });

  // ---------------------------------------------------------- compte à rebours du pass de lancement
  (() => {
    const end = new Date('2026-11-26T23:59:59+01:00').getTime();
    const box = $('#passCd'), card = $('#promoCard'); if (!box || !card) return;
    const tick = () => {
      const ms = end - Date.now(); if (ms <= 0) { card.classList.add('hidden'); return; }
      const dd = Math.floor(ms / 864e5), hh = Math.floor(ms / 36e5) % 24, mm = Math.floor(ms / 6e4) % 60;
      const L = en ? ['days', 'h', 'min'] : ['jours', 'h', 'min'];
      box.innerHTML = [dd, hh, mm].map((v, i) => `<div><b>${String(v).padStart(2, '0')}</b><span>${L[i]}</span></div>`).join('');
      setTimeout(tick, 20000);
    };
    tick();
  })();

  // ---------------------------------------------------------- courbe animée pendant l'analyse
  (() => {
    const card = $('#progressCard'); if (!card) return;
    const cv = document.createElement('canvas'); cv.className = 'prog-curve'; card.appendChild(cv);
    const N = 320, curve = new Float32Array(N); let s = 9; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N; i++) curve[i] = .18 + .1 * Math.sin(i * .07) * Math.sin(i * .021) + rnd() * .14;
    for (const [p, h] of [[.18, .82], [.41, .95], [.63, .78], [.86, .9]]) { const c = Math.round(p * N); for (let j = -14; j <= 14; j++) { const k = c + j; if (k >= 0 && k < N) curve[k] = Math.max(curve[k], h * Math.exp(-(j * j) / (2 * (j < 0 ? 5 : 3) ** 2))); } }
    let shown = 0;
    const f = () => {
      if (!card.classList.contains('hidden') && card.offsetWidth) {
        const want = (parseFloat($('#progBar')?.style.width) || 0) / 100;
        shown += (Math.max(.04, want) - shown) * .08;
        const d = Math.min(2, devicePixelRatio || 1), W = cv.width = cv.offsetWidth * d, H = cv.height = cv.offsetHeight * d, x = cv.getContext('2d');
        const n = Math.max(2, Math.floor(N * Math.min(1, shown))), base = H - 4 * d, top = 4 * d;
        const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#ffad3d'); g.addColorStop(.55, '#ff3d8b'); g.addColorStop(1, '#8b5cf6');
        x.beginPath(); x.moveTo(0, base); for (let i = 0; i < n; i++) x.lineTo(W * i / (N - 1), base - (base - top) * curve[i]); x.lineTo(W * (n - 1) / (N - 1), base); x.closePath();
        const fg = x.createLinearGradient(0, top, 0, base); fg.addColorStop(0, 'rgba(255,61,139,.4)'); fg.addColorStop(1, 'rgba(139,92,246,0)'); x.fillStyle = fg; x.fill();
        x.beginPath(); for (let i = 0; i < n; i++) { const px = W * i / (N - 1), py = base - (base - top) * curve[i]; i ? x.lineTo(px, py) : x.moveTo(px, py); }
        x.strokeStyle = g; x.lineWidth = 2 * d; x.stroke();
        const hx = W * (n - 1) / (N - 1); x.fillStyle = '#fff'; x.shadowColor = '#fff'; x.shadowBlur = 12 * d; x.beginPath(); x.arc(hx, base - (base - top) * curve[n - 1], 3.5 * d, 0, 7); x.fill(); x.shadowBlur = 0;
      } else shown = 0;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  })();
})();
