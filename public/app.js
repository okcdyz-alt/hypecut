/* HYPECUT — interface. Deux modes :
 *  - « server » : le site complet (comptes, crédits, liens, rendu HD sur le serveur, Cloudinary, Stripe)
 *  - « demo »   : aucune connexion serveur ; analyse et export directement dans le navigateur
 */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const L = window.HypeLayouts;
  const SC = window.HypeScoring;

  const S = {
    mode: 'demo', cfg: null, user: null, tab: 'link', file: null,
    jobId: null, job: null, result: null, exports: [], clips: [], pollT: null,
    local: null, ex: null, stopAt: null, lastLayout: null, camRect: null, corner: 'tl',
    claude: { sample: null, downloads: null },
  };

  // ---------------------------------------------------------------- utilitaires
  const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };
  const EN = window.HC_LANG === 'en';
  const LOC = EN ? 'en-GB' : 'fr-FR';
  const eur = (c) => (c / 100).toLocaleString(EN ? 'en-IE' : 'fr-FR', { style: 'currency', currency: 'EUR' });
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let toastT;
  function toast(msg, ms = 3800) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms); }

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const r = await fetch(path, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((window.HCt || String)(j.error || `Erreur ${r.status}`)); e.status = r.status; e.upgrade = j.upgrade; throw e; }
    return j;
  }
  function errHtml(e) {
    if (e.status === 401) return `${esc(e.message)} <button class="btn ghost xs" data-open-auth>Se connecter</button>`;
    if (e.upgrade) return `${esc(e.message)} <a href="#offres">Voir les offres</a>`;
    return esc(e.message || 'Une erreur est survenue.');
  }
  function once(el, ev, errEv) {
    return new Promise((res, rej) => {
      const ok = () => { cleanup(); res(); };
      const ko = () => { cleanup(); rej(new Error('media')); };
      const cleanup = () => { el.removeEventListener(ev, ok); if (errEv) el.removeEventListener(errEv, ko); };
      el.addEventListener(ev, ok); if (errEv) el.addEventListener(errEv, ko);
    });
  }
  function seek(v, t) {
    return new Promise((res) => {
      let done = false;
      const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); res(); };
      v.addEventListener('seeked', fin);
      v.currentTime = t;
      setTimeout(fin, 4000);
    });
  }

  // ---------------------------------------------------------------- offres (copie pour le mode démo)
  const DEMO_PLANS = {
    launch: { active: Date.now() < Date.parse('2026-11-30T23:59:59+01:00'), code: 'GTAVI', bonusActive: Date.now() < Date.parse('2026-11-26T23:59:59+01:00') },
    plans: [
      { id: 'free', name: 'Essai gratuit', price: 0, credits: 3, perks: ['3 clips offerts (5 pendant la semaine de sortie)', '720p avec filigrane', 'Vidéos jusqu’à 20 min', 'Formats 9:16, 1:1 et 16:9'] },
      { id: 'pro', name: 'Pro', price: 799, launchPrice: 399, credits: 100, perks: ['100 clips par mois', '1080p sans filigrane', 'Vidéos jusqu’à 4 h', 'Sous-titres automatiques mot par mot', 'Titres, légendes et hashtags automatiques', 'Tous les formats caméra', 'Recadrage IA qui suit l’action'] },
      { id: 'creator', name: 'Créateur', price: 1999, credits: 400, perks: ['400 clips par mois', '1080p 60 i/s, qualité maximale', 'VOD jusqu’à 8 h', 'Tout Pro inclus', 'File d’attente prioritaire', 'Export de tous les clips en un clic'] },
    ],
    packs: [{ id: 'pack20', name: 'Pack 20 clips', price: 299, credits: 20 }],
    layouts: L.LAYOUTS,
    services: {},
  };

  // ---------------------------------------------------------------- démarrage
  async function boot() {
    countdown();
    try {
      const r = await fetch('api/config', { cache: 'no-store', credentials: 'same-origin' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
        const c = await r.json();
        if (c.server) { S.mode = 'server'; S.cfg = c; }
      }
    } catch { /* mode démo */ }
    if (S.mode === 'demo') setupDemo();
    if (S.mode === 'demo') $('#waiverBox').classList.add('hidden');
    else { await refreshMe(); launchBar(); }
    renderPlans();
    bind();
    route();
    window.addEventListener('hashchange', route);
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref) {
      S.ref = ref.slice(0, 16);
      try { localStorage.setItem('hc_ref', S.ref); } catch {}
      history.replaceState(null, '', location.pathname + location.hash);
      if (S.mode === 'server' && !S.user) setTimeout(() => openAuth('signup', `Un ami t’invite sur HYPECUT : tu gagnes ${5} clips en plus après ton premier clip 🎁`), 600);
    } else { try { S.ref = localStorage.getItem('hc_ref') || null; } catch {} }
    const p = new URLSearchParams(location.search).get('paiement');
    if (p === 'ok') {
      toast('Paiement confirmé, activation de ton offre…', 6000);
      for (let i = 0; i < 5 && S.user; i++) {
        try { const r = await api('api/billing/sync', { method: 'POST', body: {} }); S.user = r.user; renderHeader(); if (r.user.plan !== 'free' || i === 4) break; } catch { break; }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (S.user && S.user.plan !== 'free') toast(`Merci ! Ton offre ${S.user.planName} est active (${S.user.credits} crédits).`, 6000);
      history.replaceState(null, '', location.pathname + location.hash);
    }
    if (p === 'annule') toast('Paiement annulé : rien n’a été débité.');
  }

  function countdown() {
    const rel = new Date(2026, 10, 19);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = Math.round((rel - today) / 86400e3);
    $('#countdown').textContent = d > 1 ? `🎮 Sortie de GTA VI dans ${d} jours` : d === 1 ? '🎮 GTA VI sort demain' : d === 0 ? '🎮 GTA VI sort aujourd’hui' : '🎮 Prêt pour GTA VI';
  }

  function launchBar() {
    const l = S.cfg.launch;
    if (!l?.active) return;
    const pro = S.cfg.plans.find((p) => p.id === 'pro');
    const bar = $('#launchBar');
    if (l.pass?.active) {
      bar.innerHTML = `🎮 Pass lancement GTA VI : toutes les fonctions Pro offertes jusqu’au ${new Date(l.pass.ends).toLocaleDateString(LOC, { day: 'numeric', month: 'long' })} · ${l.pass.credits} clips gratuits sans filigrane, avec formats caméra et titres automatiques · <a href="#creer">J’en profite</a>`;
      bar.classList.remove('hidden');
      return;
    }
    bar.innerHTML = `🎮 Offre de lancement GTA VI : Pro à ${eur(pro.launchPrice || 399)} le premier mois au lieu de ${eur(pro.price)}, jusqu’au 30 novembre · code <code>${esc(l.code)}</code>${l.bonusActive ? ' · 5 clips offerts à l’inscription' : ''} · <a href="#offres">Voir les offres</a>`;
    bar.classList.remove('hidden');
  }

  function setupDemo() {
    S.cfg = DEMO_PLANS;
    $$('.srv').forEach((el) => el.classList.add('hidden'));
    $('#demoBar').classList.remove('hidden');
    $('#linkDemo').hidden = false;
    $('#linkInput').disabled = true;
    $('#rightsCheck').closest('label').classList.add('hidden');
    $('#linkHint').classList.add('hidden');
    setTab('file');
    // Fonctions offertes par la page hôte (IA et enregistrement de fichiers), si disponibles
    (async () => {
      for (let i = 0; i < 50 && !(window.claude && window.claude.use); i++) await new Promise((r) => setTimeout(r, 100));
      if (!(window.claude && window.claude.use)) return;
      try { S.claude.downloads = await window.claude.use('downloads'); } catch {}
      try { S.claude.sample = await window.claude.use('sample'); } catch {}
      if (S.result) renderWorkspace();
    })();
  }

  async function refreshMe() {
    try { const r = await api('api/me'); S.user = r.user; } catch { S.user = null; }
    renderHeader();
  }

  function renderHeader() {
    if (S.mode !== 'server') return;
    const u = S.user;
    $('#btnLogin').classList.toggle('hidden', !!u);
    $('#btnAccount').classList.toggle('hidden', !u);
    const pill = $('#creditPill');
    pill.classList.toggle('hidden', !u);
    if (u && $('#rangeMax')) { const m = u.features?.maxDurationMin || 240; $('#rangeMax').textContent = m >= 60 ? `${m / 60} h` : `${m} min`; $('#rangeEnd').placeholder = m >= 60 ? `${m / 60}:00:00` : `0:${m}:00`; }
    if (u) pill.innerHTML = `${u.level ? `<span class="lvl-dot" title="Niveau ${esc(u.level.name)}">${u.level.emoji}</span> ` : ''}<span>${u.credits} crédit${u.credits > 1 ? 's' : ''} · ${esc(u.planName)}</span>`;
    $('#navAdmin').classList.toggle('hidden', !u?.isAdmin);
    renderPlans();
  }

  // ---------------------------------------------------------------- navigation
  function route() {
    const h = (location.hash || '#creer').slice(1);
    let view = h;
    if (h.startsWith('analyse-')) { view = 'creer'; const id = h.slice(8); if (id !== S.jobId) loadJob(id); }
    if (!['creer', 'mes-clips', 'offres', 'compte', 'admin', 'revenus', 'defi'].includes(view)) view = 'creer';
    if (view === 'admin' && !S.user?.isAdmin) view = 'creer';
    if (S.mode === 'demo' && ['mes-clips', 'compte', 'revenus', 'defi'].includes(view)) view = 'creer';
    $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + view));
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    if (view === 'mes-clips') renderHistory();
    if (view === 'compte') renderAccount();
    if (view === 'admin') renderAdmin();
    if (view === 'revenus') renderRevenue();
    if (view === 'defi') renderChallenge();
    if (view !== 'creer' || !h.startsWith('analyse-')) window.scrollTo({ top: 0 });
  }

  // ---------------------------------------------------------------- liaisons
  function bind() {
    $$('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    const drop = $('#drop');
    $('#fileInput').addEventListener('change', (e) => pickFile(e.target.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => pickFile(e.dataTransfer.files[0]));
    $('#linkInput').addEventListener('input', (e) => { $('#ytWarn').hidden = !/youtu\.?be/i.test(e.target.value); });
    $('#ytToFile')?.addEventListener('click', () => setTab('file'));
    $('#btnSample')?.addEventListener('click', startSample);
    $('#btnAnalyze').addEventListener('click', startAnalysis);
    $('#btnNew').addEventListener('click', () => { resetWorkspace(); location.hash = '#creer'; window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#btnExportAll').addEventListener('click', exportAll);
    $('#btnAiAll').addEventListener('click', demoAiTitles);
    $('#btnLogin').addEventListener('click', () => openAuth('signup'));
    $('#ctaTop')?.addEventListener('click', (e) => { e.preventDefault(); $('#sourceCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    $('#ctaSpot')?.addEventListener('click', () => $('#spot').scrollIntoView({ behavior: 'smooth', block: 'center' }));
    $('#ctaSpotGo')?.addEventListener('click', (e) => { e.preventDefault(); if (layoutAllowed('satis_split') === 'ok') S.lastLayout = 'satis_split'; $('#sourceCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-auth]')) { e.preventDefault(); openAuth('login'); }
      if (e.target.matches('[data-close]') || e.target.classList.contains('modal')) closeModals();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

    $('#btnLivePrev').addEventListener('click', () => (S.live ? stopLive() : startLive()));
    const player = $('#player');
    player.addEventListener('timeupdate', () => { if (S.stopAt && player.currentTime >= S.stopAt) { player.pause(); S.stopAt = null; } drawTimeline(); });
    player.addEventListener('seeked', drawTimeline);
    $('#timeline').addEventListener('click', (e) => {
      if (!S.result) return;
      const r = e.currentTarget.getBoundingClientRect();
      player.currentTime = ((e.clientX - r.left) / r.width) * S.result.duration;
      S.stopAt = null;
    });
    window.addEventListener('resize', drawTimeline);

    // Connexion
    $$('[data-auth]').forEach((b) => b.addEventListener('click', () => setAuthTab(b.dataset.auth)));
    $('#authForm').addEventListener('submit', submitAuth);

    // Export
    $('#focusX').addEventListener('input', (e) => { S.ex.focusX = +e.target.value; drawPreview(); });
    $('#subtitlesOn').addEventListener('change', (e) => {
      if (e.target.checked && !effectsAllowed()) { e.target.checked = false; $('#exErr').innerHTML = 'Les sous-titres automatiques sont inclus dans les offres Pro et Créateur. <a href="#offres" data-close>Voir les offres</a>'; return; }
      S.ex.subtitles = e.target.checked; syncSubStyleUI(); drawPreview();
    });
    // Style des sous-titres (police, style, couleurs) — mémorisé pour les exports suivants
    {
      const SS = window.SubStyles;
      const pick = (sel, key) => $(sel).addEventListener('click', (e) => {
        const b = e.target.closest('button[data-v]'); if (!b) return;
        S.subStyle[key] = b.dataset.v;
        if (key === 'font') S.subStyle.upper = SS.FONTS.find((f) => f.id === b.dataset.v).upper;
        S.subStyle = SS.sanitize(S.subStyle); saveSubStyle(); syncSubStyleUI(); drawPreview();
      });
      $('#subFonts').innerHTML = SS.FONTS.map((f) => `<button type="button" role="radio" data-v="${f.id}" title="${f.label}"><b style="font-family:'${f.css}',sans-serif${f.bold ? ';font-weight:700' : ''}">Aa</b><span>${f.label}</span></button>`).join('');
      $('#subStyleSeg').innerHTML = SS.STYLES.map((x) => `<button type="button" role="radio" data-v="${x.id}">${x.label}</button>`).join('');
      const sw = SS.COLORS.map((c) => `<button type="button" role="radio" data-v="${c.id}" style="background:${c.hex}" aria-label="${c.label}" title="${c.label}"></button>`).join('');
      $('#subColors').innerHTML = sw;
      $('#subHi').innerHTML = '<button type="button" role="radio" class="none" data-v="none" aria-label="Aucune mise en avant" title="Aucune mise en avant">Aucune</button>' + sw;
      pick('#subFonts', 'font'); pick('#subStyleSeg', 'style'); pick('#subColors', 'color'); pick('#subHi', 'hi'); pick('#subSize', 'size');
      $('#subUpper').addEventListener('change', (e) => { S.subStyle.upper = e.target.checked; saveSubStyle(); drawPreview(); });
      if (document.fonts) SS.FONTS.forEach((f) => document.fonts.load(`${f.bold ? 'bold ' : ''}40px "${f.css}"`).then(() => { if (S.ex && S.ex.img) drawPreview(); }).catch(() => {}));
      syncSubStyleUI();
    }
    $('#showTitle').addEventListener('change', (e) => { S.ex.showTitle = e.target.checked; drawPreview(); });
    $('#progressBar').addEventListener('change', (e) => {
      if (e.target.checked && !effectsAllowed()) { e.target.checked = false; $('#exErr').innerHTML = 'Les effets sont inclus dans les offres Pro et Créateur. <a href="#offres" data-close>Voir les offres</a>'; return; }
      S.ex.progressBar = e.target.checked; drawPreview();
    });
    $('#titleInput').addEventListener('input', (e) => { S.ex.title = e.target.value; S.clips[S.ex.idx].title = e.target.value; drawPreview(); });
    $$('#cornerSeg button').forEach((b) => b.addEventListener('click', () => { S.ex.corner = S.corner = b.dataset.c; syncCorner(); drawPreview(); }));
    $$('[data-nudge]').forEach((b) => b.addEventListener('click', () => {
      const [k, d] = b.dataset.nudge.split(':'); const dur = S.result.duration;
      if (k === 's') S.ex.start = Math.max(0, Math.min(S.ex.end - 3, S.ex.start + +d));
      else S.ex.end = Math.min(dur, Math.max(S.ex.start + 3, S.ex.end + +d));
      S.clips[S.ex.idx].start = S.ex.start; S.clips[S.ex.idx].end = S.ex.end;
      syncTimes();
    }));
    $('#btnDoExport').addEventListener('click', doExport);
    $('#exCopy').addEventListener('click', copyCaption);
    bindCamPicker();
    bindTextDrag();
  }

  function setTab(t) {
    S.tab = t;
    $$('.tab[data-tab]').forEach((b) => { b.classList.toggle('active', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
    $('#pane-link').classList.toggle('hidden', t !== 'link');
    $('#pane-file').classList.toggle('hidden', t !== 'file');
  }
  function pickFile(f) {
    if (!f) return;
    if (!/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name)) { $('#sourceErr').textContent = 'Ce fichier n’est pas une vidéo.'; return; }
    S.file = f;
    $('#fileName').textContent = `${f.name} · ${(f.size / 1048576).toFixed(0)} Mo`;
    $('#sourceErr').textContent = '';
  }

  // ---------------------------------------------------------------- comptes
  let authMode = 'signup';
  function openAuth(mode, reason) {
    setAuthTab(mode);
    if (reason) $('#authSub').textContent = reason;
    $('#authErr').textContent = '';
    $('#authModal').classList.remove('hidden');
    setTimeout(() => $('#authEmail').focus(), 50);
  }
  function setAuthTab(m) {
    authMode = m;
    $$('[data-auth]').forEach((b) => b.classList.toggle('active', b.dataset.auth === m));
    $('#authTitle').textContent = m === 'signup' ? 'Crée ton compte gratuit' : 'Content de te revoir';
    const free = S.cfg?.plans?.find((p) => p.id === 'free');
    $('#authSub').textContent = m === 'signup' ? `${free?.credits || 3} clips offerts pour essayer, sans carte bancaire.` : 'Connecte-toi pour retrouver tes clips.';
    $('#authSubmit').textContent = m === 'signup' ? 'Créer mon compte' : 'Se connecter';
    $('#authLegal')?.classList.toggle('hidden', m !== 'signup' || S.mode !== 'server');
    $('#authPass').setAttribute('autocomplete', m === 'signup' ? 'new-password' : 'current-password');
  }
  async function submitAuth(e) {
    e.preventDefault();
    const btn = $('#authSubmit'); btn.disabled = true; $('#authErr').textContent = '';
    try {
      const r = await api(`api/auth/${authMode}`, { method: 'POST', body: { email: $('#authEmail').value, password: $('#authPass').value, ref: authMode === 'signup' ? S.ref : undefined } });
      if (authMode === 'signup') { try { localStorage.removeItem('hc_ref'); } catch {} }
      S.user = r.user; renderHeader(); closeModals();
      toast(authMode === 'signup' ? `Bienvenue ! Tu as ${r.user.credits} crédits pour essayer.` : 'Connecté.');
      if (S.result) renderWorkspace();
    } catch (err) { $('#authErr').textContent = err.message; }
    btn.disabled = false;
  }
  function closeModals() { stopLive(); $$('.modal').forEach((m) => m.classList.add('hidden')); }

  // ---------------------------------------------------------------- lancement d'une analyse
  function analysisParams() { return { clipLen: +$('#clipLen').value, count: +$('#count').value, priority: $('#priority').value, lang: EN ? 'en' : 'fr', rangeStart: $('#rangeStart')?.value.trim() || '', rangeEnd: $('#rangeEnd')?.value.trim() || '' }; }

  async function startSample() {
    const err = $('#sourceErr'); err.textContent = '';
    if (S.mode !== 'server') { err.textContent = 'La vidéo d’exemple arrive avec le site complet.'; return; }
    if (!S.user) { openAuth('signup', 'Crée ton compte gratuit pour essayer avec la vidéo d’exemple : 3 clips offerts.'); return; }
    const b = $('#btnSample'); b.disabled = true;
    try {
      const { id } = await api('api/jobs/sample', { method: 'POST', body: analysisParams() });
      resetWorkspace();
      location.hash = '#analyse-' + id;
    } catch (e) { err.innerHTML = errHtml(e); }
    b.disabled = false;
  }

  async function startAnalysis() {
    const err = $('#sourceErr'); err.textContent = '';
    if (S.mode === 'demo') {
      if (!S.file) { err.textContent = 'Choisis d’abord une vidéo.'; return; }
      return localAnalyze(S.file, analysisParams()).catch((e) => { console.error(e); hideProgress(); err.textContent = e.message || 'Analyse impossible.'; });
    }
    if (!S.user) { openAuth('signup', 'Crée ton compte gratuit pour analyser ta vidéo : 3 clips offerts.'); return; }
    const btn = $('#btnAnalyze'); btn.disabled = true;
    try {
      let id;
      if (S.tab === 'link') {
        const url = $('#linkInput').value.trim();
        if (!url) throw new Error('Colle d’abord le lien de ta vidéo.');
        if (!/(^|\/\/|\.)(twitch\.tv|kick\.com)(\/|$)/i.test(url)) throw new Error(/youtu\.?be/i.test(url) ? 'Les liens YouTube ne sont pas acceptés : importe ton fichier vidéo (onglet « Importer un fichier »).' : 'Seuls les liens Twitch et Kick sont acceptés. Pour une autre vidéo, importe le fichier.');
        if (!$('#rightsCheck').checked) throw new Error('Coche la case pour confirmer que tu as le droit d’utiliser cette vidéo.');
        ({ id } = await api('api/jobs', { method: 'POST', body: { url, rights: true, ...analysisParams() } }));
      } else {
        if (!S.file) throw new Error('Choisis d’abord une vidéo.');
        id = await uploadFile(S.file);
      }
      resetWorkspace();
      location.hash = '#analyse-' + id;
    } catch (e) { err.innerHTML = errHtml(e); hideProgress(); }
    btn.disabled = false;
  }

  async function uploadFile(file) {
    const p = analysisParams();
    const { id, chunkSize } = await api('api/upload/start', { method: 'POST', body: { name: file.name, size: file.size, ...p } });
    const total = file.size;
    const mb = (b) => (b / 1048576).toFixed(0);
    let offset = 0;
    showProgress('Envoi de ta vidéo…', 0, `0 / ${mb(total)} Mo`);
    while (offset < total) {
      const end = Math.min(total, offset + chunkSize);
      const part = file.slice(offset, end);
      let tries = 0;
      for (;;) {
        try {
          const r = await fetch(`api/upload/${id}?offset=${offset}`, { method: 'PUT', body: part, credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' } });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) { const e = new Error((window.HCt || String)(j.error || `Erreur ${r.status}`)); e.status = r.status; e.upgrade = j.upgrade; throw e; }
          break;
        } catch (e) {
          if (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
          if (++tries > 4) throw new Error('La connexion a été coupée pendant l’envoi. Réessaie.');
          showProgress('Connexion instable, nouvelle tentative…', offset / total, `${mb(offset)} / ${mb(total)} Mo`);
          await new Promise((s) => setTimeout(s, 1500 * tries));
        }
      }
      offset = end;
      showProgress('Envoi de ta vidéo…', offset / total, `${mb(offset)} / ${mb(total)} Mo`);
    }
    showProgress('Vidéo reçue, démarrage de l’analyse…', 1, '');
    await api(`api/upload/${id}/finish`, { method: 'POST', body: {} });
    return id;
  }

  const STATUS = { uploading: 'Envoi incomplet', queued: 'En file d’attente', downloading: 'Récupération de la vidéo', analyzing: 'Recherche des moments forts', thumbs: 'Préparation des aperçus', preview: 'Préparation du lecteur', ai: 'L’IA écrit les titres', done: 'Terminé', error: 'Erreur', expired: 'Expirée' };

  function showProgress(title, p, msg) {
    $('#progressCard').classList.remove('hidden');
    $('#progTitle').textContent = title;
    $('#progPct').textContent = `${Math.round((p || 0) * 100)} %`;
    $('#progBar').style.width = `${Math.round((p || 0) * 100)}%`;
    $('#progMsg').textContent = msg || '';
  }
  function hideProgress() { $('#progressCard').classList.add('hidden'); }

  async function loadJob(id) {
    S.jobId = id; clearTimeout(S.pollT);
    if (S.mode !== 'server') return;
    if (!S.user) await refreshMe();
    if (!S.user) { openAuth('login'); return; }
    const poll = async () => {
      if (S.jobId !== id) return;
      try {
        const r = await api('api/jobs/' + id);
        S.job = r.job; S.exports = r.exports; S.user = r.user; renderHeader();
        const j = r.job;
        if (j.status === 'done' || j.status === 'expired') {
          hideProgress();
          if (!S.result || S.result !== j.result) { S.result = j.result; initClips(); renderWorkspace(); }
          else renderClips();
          const pending = r.exports.some((e) => !['done', 'error'].includes(e.status));
          if (pending) S.pollT = setTimeout(poll, 2500);
          return;
        }
        if (j.status === 'error') { hideProgress(); $('#sourceErr').textContent = j.message || 'L’analyse a échoué.'; if (/passage à analyser/.test(j.message || '')) $('#rangeBox').open = true; return; }
        const label = STATUS[j.status] || 'Traitement';
        showProgress(`${label}…`, j.progress, j.status === 'queued' && j.queue ? `Position dans la file : ${j.queue}` : j.message || '');
        S.pollT = setTimeout(poll, 1500);
      } catch (e) {
        if (e.status === 404) { hideProgress(); $('#sourceErr').textContent = 'Analyse introuvable.'; return; }
        if (e.status === 401) { hideProgress(); openAuth('login'); return; }
        S.pollT = setTimeout(poll, 4000);
      }
    };
    poll();
  }

  function resetWorkspace() {
    clearTimeout(S.pollT);
    S.jobId = null; S.job = null; S.result = null; S.exports = []; S.clips = [];
    $('#workspace').classList.add('hidden');
    document.body.classList.remove('has-job');
    hideProgress();
    const p = $('#player'); p.pause(); p.removeAttribute('src'); p.load();
  }

  function initClips() {
    S.clips = S.result.clips.map((c, i) => ({ start: c.start, end: c.end, title: c.ai?.titre || (EN ? `Highlight #${i + 1}` : `Moment fort n°${i + 1}`) }));
  }

  // ---------------------------------------------------------------- analyse locale (démo)
  async function localAnalyze(file, opts) {
    resetWorkspace();
    showProgress('Ouverture de la vidéo…', 0);
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
    try { await once(v, 'loadedmetadata', 'error'); } catch { throw new Error('Ton navigateur ne sait pas lire ce format. Essaie un fichier MP4 (H.264).'); }
    const duration = v.duration;
    if (!isFinite(duration) || duration <= 0) throw new Error('Durée de la vidéo illisible.');
    const step = Math.max(0.5, duration / 900);

    let audio = null;
    if (file.size < 1.2e9) {
      showProgress('Écoute du son…', 0.02);
      try {
        const buf = await file.arrayBuffer();
        const AC = window.AudioContext || window.webkitAudioContext;
        const ac = new AC();
        const ab = await ac.decodeAudioData(buf);
        if (ac.close) ac.close();
        const acc = SC.createAudioAccumulator(ab.sampleRate, step);
        const chs = []; for (let c = 0; c < ab.numberOfChannels; c++) chs.push(ab.getChannelData(c));
        const CH = ab.sampleRate * 20;
        for (let o = 0; o < ab.length; o += CH) {
          const n = Math.min(CH, ab.length - o);
          const mono = new Float32Array(n);
          for (const ch of chs) for (let i = 0; i < n; i++) mono[i] += ch[o + i] / chs.length;
          acc.push(mono);
          showProgress('Écoute du son…', 0.02 + 0.2 * (o / ab.length));
          await tick();
        }
        audio = acc.finish();
      } catch (e) { console.warn('audio', e); audio = null; }
    }

    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 36;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const frames = SC.createFrameAccumulator();
    const n = Math.ceil(duration / step);
    for (let b = 0; b < n; b++) {
      await seek(v, Math.min(duration - 0.05, (b + 0.5) * step));
      cx.drawImage(v, 0, 0, 64, 36);
      const d = cx.getImageData(0, 0, 64, 36).data;
      const lum = new Uint8Array(64 * 36);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      frames.push(lum);
      if (b % 8 === 0) showProgress('Analyse des images…', 0.22 + 0.7 * (b / n), `${fmt(b * step)} / ${fmt(duration)}`);
    }
    const vf = frames.finish();
    const res = SC.analyzeFeatures({ motion: vf.motion, flash: vf.flash, audioDb: audio?.audioDb, onset: audio?.onset }, { step, priority: opts.priority, duration, clipLen: opts.clipLen, count: opts.count });

    showProgress('Préparation des aperçus…', 0.94);
    const tc = document.createElement('canvas');
    tc.width = Math.min(640, v.videoWidth); tc.height = Math.round(tc.width * v.videoHeight / v.videoWidth);
    const tx = tc.getContext('2d');
    for (const c of res.clips) {
      await seek(v, c.peak);
      tx.drawImage(v, 0, 0, tc.width, tc.height);
      c.thumb = tc.toDataURL('image/jpeg', 0.82);
      await seek(v, c.start + (c.peak - c.start) * 0.4);
      tx.drawImage(v, 0, 0, tc.width, tc.height);
      c.pre = tc.toDataURL('image/jpeg', 0.8);
    }
    S.local = { url, file, width: v.videoWidth, height: v.videoHeight, duration };
    S.result = { duration, step: res.step || step, series: res.series, clips: res.clips, width: v.videoWidth, height: v.videoHeight, previewUrl: url, frameUrl: res.clips[0]?.thumb };
    S.job = { title: file.name.replace(/\.[^.]+$/, ''), status: 'done' };
    hideProgress();
    initClips();
    renderWorkspace();
  }

  // ---------------------------------------------------------------- espace de travail
  function renderWorkspace() {
    const r = S.result; if (!r) return;
    $('#workspace').classList.remove('hidden');
    document.body.classList.add('has-job');
    $('#wsTitle').textContent = S.job?.title ? `Moments forts · ${S.job.title}` : 'Moments forts';
    $('#wsSub').textContent = `${r.clips.length} clip${r.clips.length > 1 ? 's' : ''} proposé${r.clips.length > 1 ? 's' : ''} sur ${fmt(r.duration)} de vidéo. Modifie les titres, ajuste et exporte.`;
    $('#expiredBar').classList.toggle('hidden', S.job?.status !== 'expired');
    const p = $('#player');
    if (p.getAttribute('src') !== r.previewUrl) p.src = r.previewUrl;
    $('#btnExportAll').classList.toggle('hidden', !(S.mode === 'server' && S.user && S.job?.status === 'done'));
    $('#btnAiAll').classList.toggle('hidden', !(S.mode === 'demo' && S.claude.sample));
    renderClips();
    requestAnimationFrame(drawTimeline);
    if (location.hash.startsWith('#analyse-') || S.mode === 'demo') $('#workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderClips() {
    const box = $('#clips');
    const r = S.result;
    box.innerHTML = r.clips.map((c, i) => {
      const st = S.clips[i];
      const exps = (S.exports || []).filter((e) => e.clipIdx === i);
      const ai = c.ai;
      const aiLocked = S.mode === 'server' && !ai && S.user && S.user.features.ai === 'top1' && i > 0;
      return `<article class="clip" data-i="${i}">
        <div class="thumb" style="background-image:url('${esc(c.thumb)}')" data-play="${i}" role="button" tabindex="0" aria-label="Lire l’aperçu du clip ${i + 1}">
          <span class="badge rank">#${i + 1}</span><span class="badge hype">🔥 ${c.hype}</span>
          <span class="badge dur">${fmt(st.end - st.start)}</span>${ai ? `<span class="badge viral">Potentiel ${ai.viralite}/10</span>` : ''}
        </div>
        <div class="body">
          <input class="title" value="${esc(st.title)}" data-title="${i}" aria-label="Titre du clip ${i + 1}" maxlength="90">
          <div class="tags">${c.reasons.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}${ai?.type ? `<span class="tag">${esc(ai.type)}</span>` : ''}</div>
          ${ai?.description ? `<p class="desc">${esc(ai.description)}</p>` : ''}
          ${ai?.hashtags?.length ? `<p class="hash">${esc(ai.hashtags.join(' '))}</p>` : ''}
          ${aiLocked ? '<p class="lock">✨ Titres IA sur tous les clips avec <a href="#offres">Pro</a></p>' : ''}
          <div class="times">${fmt(st.start)} → ${fmt(st.end)}</div>
          ${exps.length ? `<div class="exports">${exps.map(exportLine).join('')}</div>` : ''}
          <div class="actions">
            <button class="btn ghost sm" data-play="${i}">▶ Aperçu</button>
            <button class="btn primary sm" data-export="${i}" ${S.job?.status === 'expired' ? 'disabled' : ''}>Créer le clip</button>
          </div>
        </div></article>`;
    }).join('');
    $$('[data-play]', box).forEach((el) => el.addEventListener('click', () => playClip(+el.dataset.play)));
    $$('[data-export]', box).forEach((el) => el.addEventListener('click', () => openExport(+el.dataset.export)));
    $$('[data-title]', box).forEach((el) => el.addEventListener('input', () => { S.clips[+el.dataset.title].title = el.value; }));
  }

  function exportLine(e) {
    const lay = L.LAYOUTS[e.options?.layout]?.label || 'Clip';
    if (e.status === 'done' && !e.url) return `<span class="hint">🗑️ ${esc(lay)} · ${esc(e.message || 'Clip supprimé après 3 jours.')}</span>`;
    if (e.status === 'done') return `<span>✅ ${esc(lay)} · <a href="${esc(e.download || e.url)}" target="_blank" rel="noopener">Télécharger</a></span>`;
    if (e.status === 'error') return `<span class="lock">⚠️ ${esc(lay)} : ${esc(e.message || 'échec')}</span>`;
    return `<span>⏳ ${esc(lay)} · ${Math.round((e.progress || 0) * 100)} %${e.queue ? ` (file : ${e.queue})` : ''}</span>`;
  }

  function playClip(i) {
    const p = $('#player'); const c = S.clips[i];
    p.currentTime = c.start; S.stopAt = c.end;
    p.play().catch(() => {});
    p.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function drawTimeline() {
    const cv = $('#timeline'); const r = S.result;
    if (!r || !cv.offsetWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.width = Math.round(cv.offsetWidth * dpr), H = cv.height = Math.round(64 * dpr);
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, '#8b5cf6'); g.addColorStop(0.55, '#ff3d8b'); g.addColorStop(1, '#ffad3d');
    const n = r.series.length, bw = W / n;
    for (const [i, c] of S.clips.entries()) {
      const x0 = (c.start / r.duration) * W, x1 = (c.end / r.duration) * W;
      ctx.fillStyle = 'rgba(46,230,214,0.18)'; ctx.fillRect(x0, 0, x1 - x0, H);
      ctx.fillStyle = 'rgba(46,230,214,0.9)'; ctx.fillRect(x0, 0, Math.max(1, 2 * dpr), H);
      ctx.font = `${11 * dpr}px Inter, sans-serif`; ctx.fillText(`#${i + 1}`, x0 + 4 * dpr, 13 * dpr);
    }
    ctx.fillStyle = g;
    for (let i = 0; i < n; i++) { const h = (r.series[i] / 100) * (H - 18 * dpr); ctx.fillRect(i * bw, H - h, Math.max(1, bw - 0.5), h); }
    const t = $('#player').currentTime || 0;
    ctx.fillStyle = '#fff'; ctx.fillRect((t / r.duration) * W - dpr, 0, 2 * dpr, H);
  }

  // ---------------------------------------------------------------- export : fenêtre
  const imgCache = new Map();
  function loadImg(src) {
    if (!src) return Promise.resolve(null);
    if (imgCache.has(src)) return imgCache.get(src);
    const p = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
    imgCache.set(src, p);
    return p;
  }

  function effectsAllowed() { return S.mode === 'demo' || !!S.user?.features?.effects; }

  function layoutAllowed(key) {
    const Lk = L.LAYOUTS[key];
    if (S.mode === 'demo') return Lk.serverOnly ? 'hide' : 'ok';
    if (key === 'game_ai' && !S.cfg.services?.cloudinary) return 'hide';
    const f = S.user?.features;
    if (!f) return Lk.tier === 'free' ? 'ok' : 'lock';
    if (key === 'game_ai') return f.smartCrop ? 'ok' : 'lock';
    if (Lk.tier === 'pro' && !f.camLayouts) return 'lock';
    return 'ok';
  }

  function layoutIcon(key) {
    const c = L.compose(key, 1600, 900, { res: 90, corner: 'tl', camRect: { x: 0.02, y: 0.03, w: 0.26, h: 0.3 } });
    const parts = c.ops.map((o) => {
      const fill = o.kind === 'fill' ? (o.color === '#ffffff' ? '#fff' : '#000') : o.kind === 'bg' ? '#ffad3d' : o.role === 'cam' ? '#2ee6d6' : o.role === 'bg' ? '#4a3b66' : '#ff3d8b';
      const d = o.dst;
      return o.shape === 'circle' ? `<circle cx="${d.x + d.w / 2}" cy="${d.y + d.h / 2}" r="${d.w / 2}" fill="${fill}"/>` : `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" fill="${fill}" ${o.role === 'game' ? 'opacity=".85"' : ''}/>`;
    }).join('');
    return `<svg viewBox="0 0 ${c.W} ${c.H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect width="${c.W}" height="${c.H}" fill="#000"/>${parts}</svg>`;
  }

  // Format proposé par défaut : le dernier choisi, sinon l'écran partagé satisfaisant s'il est disponible.
  function defaultLayout() {
    if (S.lastLayout && layoutAllowed(S.lastLayout) === 'ok') return S.lastLayout;
    if (layoutAllowed('satis_split') === 'ok' && (S.bgs || []).length) return 'satis_split';
    return 'game_full';
  }

  async function openExport(i) {
    if (S.mode === 'server' && !S.user) { openAuth('signup'); return; }
    stopLive();
    const c = S.result.clips[i], st = S.clips[i];
    if (S.mode === 'server' && !S.bgs) { try { S.bgs = (await api('api/backgrounds')).backgrounds; } catch { S.bgs = []; } }
    const layout = defaultLayout();
    S.ex = { idx: i, layout, bgId: S.lastBg || S.bgs?.[0]?.id || null, start: st.start, end: st.end, title: st.title, showTitle: true, progressBar: effectsAllowed(), subtitles: effectsAllowed() && S.mode !== 'demo', titlePos: S.titlePos || null, subPos: S.subPos || null, focusX: 0.5, corner: S.corner, camRect: S.camRect || { x: 0.02, y: 0.03, w: 0.26, h: 0.3 }, img: null, frame: null, busy: false };
    $('#titleInput').value = st.title; $('#showTitle').checked = true; $('#focusX').value = 0.5;
    $('#progressBar').checked = effectsAllowed(); $('#pbLock').classList.toggle('hidden', effectsAllowed());
    $('#subtitlesOn').checked = S.ex.subtitles; syncSubStyleUI(); $('#subLock').classList.toggle('hidden', effectsAllowed()); $('#subLabel').classList.toggle('hidden', S.mode === 'demo');
    $('#exErr').innerHTML = ''; $('#exResult').classList.add('hidden');
    ['#exDownload', '#exSave', '#exCopy', '#exVideo'].forEach((s) => $(s).classList.add('hidden'));
    $('#btnDoExport').disabled = false;
    $('#exTitle').textContent = `Créer le clip n°${i + 1}`;
    const grid = $('#layoutGrid');
    grid.innerHTML = Object.keys(L.LAYOUTS).filter((k) => layoutAllowed(k) !== 'hide').map((k) => {
      const st2 = layoutAllowed(k);
      const hot = L.LAYOUTS[k].hot;
      return `<button class="lay ${st2 === 'lock' ? 'locked' : ''} ${hot ? 'hot' : ''}" data-lay="${k}" title="${esc(L.LAYOUTS[k].desc)}">${st2 === 'lock' ? '<span class="lk">🔒 PRO</span>' : ''}${hot ? '<span class="hot-tag">🔥 Tendance TikTok</span>' : ''}${layoutIcon(k)}<b>${esc(L.LAYOUTS[k].label)}</b>${hot ? '<small>Clip en haut, vidéo satisfaisante en bas : le format qui garde les gens jusqu’à la fin.</small>' : ''}</button>`;
    }).join('');
    $$('.lay', grid).forEach((b) => b.addEventListener('click', () => {
      if (layoutAllowed(b.dataset.lay) === 'lock') { $('#exErr').innerHTML = 'Ce format est inclus dans les offres Pro et Créateur. <a href="#offres" data-close>Voir les offres</a>'; return; }
      $('#exErr').innerHTML = '';
      S.ex.layout = S.lastLayout = b.dataset.lay; syncLayout(); drawPreview(); setLiveBg();
    }));
    $('#exportModal').classList.remove('hidden');
    syncLayout(); syncTimes(); syncCorner(); syncQuality();
    S.ex.img = await loadImg(c.thumb);
    S.ex.frame = await loadImg(S.mode === 'server' ? S.result.frameUrl : c.thumb);
    $('#camImg').src = S.ex.frame?.src || '';
    drawCamRect(); drawPreview();
  }

  function renderBgPicker() {
    const grid = $('#bgGrid'); const list = S.bgs || [];
    if (!list.length) { grid.innerHTML = `<p class="hint">Aucune vidéo satisfaisante pour l’instant.${S.user?.isAdmin ? ' Ajoute-en depuis l’onglet <a href="#admin" data-close>Admin</a>.' : ''}</p>`; return; }
    grid.innerHTML = list.map((b) => `<button class="bg-item ${b.id === S.ex.bgId ? 'active' : ''}" data-bg="${esc(b.id)}" type="button" title="Survole pour voir la vidéo"><video src="${esc(b.preview)}" poster="${esc(b.thumb)}" muted loop playsinline preload="none"></video><span class="play-ic" aria-hidden="true">▶</span><span>${esc(b.name)}</span></button>`).join('');
    $$('[data-bg]', grid).forEach((el) => {
      const v = el.querySelector('video');
      el.addEventListener('mouseenter', () => v.play().catch(() => {}));
      el.addEventListener('mouseleave', () => { v.pause(); });
      el.addEventListener('click', () => { S.ex.bgId = S.lastBg = el.dataset.bg; renderBgPicker(); drawPreview(); if (S.live) setLiveBg(); else startLive(); });
    });
  }

  function syncLayout() {
    $$('.lay').forEach((b) => b.classList.toggle('active', b.dataset.lay === S.ex.layout));
    const Lk = L.LAYOUTS[S.ex.layout];
    $('#bgBox').classList.toggle('hidden', !Lk.bg);
    if (Lk.bg) renderBgPicker();
    $('#camBox').classList.toggle('hidden', !Lk.cam);
    $('#cornerBox').classList.toggle('hidden', !['cam_bubble', 'cam_pip'].includes(S.ex.layout));
    $('#focusBox').classList.toggle('hidden', ['game_blur', 'landscape', 'game_ai'].includes(S.ex.layout));
    if (!S.live) $('#exPrevHint').textContent = S.ex.layout === 'game_ai' ? 'Le cadre suivra automatiquement l’action pendant le clip' : 'Aperçu du cadrage';
  }
  function syncCorner() { $$('#cornerSeg button').forEach((b) => b.classList.toggle('active', b.dataset.c === S.ex.corner)); }
  function syncTimes() { $('#exStart').textContent = fmt(S.ex.start); $('#exEnd').textContent = fmt(S.ex.end); }
  function syncQuality() {
    const btn = $('#btnDoExport');
    if (S.mode === 'demo') { $('#exQuality').textContent = 'Démo : 720p avec filigrane, rendu en temps réel dans ton navigateur (garde l’onglet ouvert).'; btn.textContent = '⬇ Exporter le clip'; return; }
    const f = S.user.features;
    $('#exQuality').textContent = `Qualité : ${f.res}p ${f.fps} i/s${f.watermark ? ' avec filigrane' : ''} · il te reste ${S.user.credits} crédit${S.user.credits > 1 ? 's' : ''}.`;
    btn.textContent = S.user.credits > 0 ? '⬇ Exporter (1 crédit)' : 'Plus de crédits : voir les offres';
  }

  function previewOpts() {
    return { res: 720, camRect: S.ex.camRect, focusX: S.ex.focusX, corner: S.ex.corner };
  }

  /** Dessine une composition sur un canvas (aperçu avec une image, ou export avec la vidéo). */
  function drawComp(ctx, comp, src, lines, watermark, progress, subs, pos = {}) {
    drawComp.boxes = {};
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, comp.W, comp.H);
    for (const op of comp.ops) {
      ctx.save();
      if (op.shape === 'circle') { ctx.beginPath(); ctx.arc(op.dst.x + op.dst.w / 2, op.dst.y + op.dst.h / 2, op.dst.w / 2, 0, Math.PI * 2); ctx.clip(); }
      if (op.kind === 'video') {
        if (op.effect === 'blur') ctx.filter = `blur(${Math.round(comp.W / 30)}px) brightness(0.9) saturate(1.15)`;
        ctx.drawImage(src, op.src.x, op.src.y, op.src.w, op.src.h, op.dst.x, op.dst.y, op.dst.w, op.dst.h);
      } else if (op.kind === 'bg') {
        const bgImg = drawComp.bgImg;
        const bw = bgImg && (bgImg.videoWidth || bgImg.naturalWidth), bh = bgImg && (bgImg.videoHeight || bgImg.naturalHeight);
        if (bgImg && bw && bh) { const c = L.cover({ x: 0, y: 0, w: bw, h: bh }, op.dst.w, op.dst.h, 0.5, 0.5); ctx.drawImage(bgImg, c.x, c.y, c.w, c.h, op.dst.x, op.dst.y, op.dst.w, op.dst.h); }
        else { ctx.fillStyle = '#120c1f'; ctx.fillRect(op.dst.x, op.dst.y, op.dst.w, op.dst.h); }
      } else { ctx.fillStyle = op.color; ctx.fillRect(op.dst.x, op.dst.y, op.dst.w, op.dst.h); }
      ctx.restore();
    }
    const { W, H } = comp;
    if (lines && lines.length) {
      const fs = Math.round(W * (W > H ? 0.045 : 0.068)), lh = Math.round(fs * 1.32), pad = Math.round(fs * 0.28);
      const blockH = lh * lines.length;
      let y0 = pos.title ? pos.title.y * H - blockH / 2 : comp.title.anchor === 'center' ? comp.title.y - blockH / 2 : comp.title.y;
      y0 = Math.max(8, Math.min(H - blockH - 8, y0));
      ctx.font = `${fs}px "HC Anton", Anton, Impact, "Arial Black", sans-serif`; ctx.textBaseline = 'top';
      const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const cx = pos.title ? Math.max(maxW / 2 + pad + 8, Math.min(W - maxW / 2 - pad - 8, pos.title.x * W)) : W / 2;
      drawComp.boxes.title = { x0: cx - maxW / 2 - pad, x1: cx + maxW / 2 + pad, y0: y0 - pad, y1: y0 + blockH + pad, cx, cy: y0 + blockH / 2 };
      lines.forEach((line, i) => {
        const w = ctx.measureText(line).width, x = cx - w / 2, y = y0 + i * lh;
        ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(x - pad, y - pad * 0.6, w + pad * 2, fs * 1.15 + pad * 1.2);
        ctx.fillStyle = '#fff'; ctx.fillText(line, x, y);
      });
      if (pos.guides) { const b = drawComp.boxes.title; ctx.save(); ctx.setLineDash([fs * 0.25, fs * 0.2]); ctx.lineWidth = Math.max(2, W * 0.004); ctx.strokeStyle = 'rgba(255,210,61,.9)'; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.restore(); }
    }
    if (subs) {
      const SS = window.SubStyles, st = S.subStyle || SS.DEFAULT, rs = SS.resolve(st);
      const base = Math.round(W > H ? H * 0.075 : W * 0.085), fs = base * rs.scale, words = ['Tes', 'sous-titres', 'ici'];
      ctx.save(); ctx.font = `${rs.font.bold ? 'bold ' : ''}${fs}px "${rs.font.css}", Impact, sans-serif`;
      const sp = fs * 0.36, total = words.map((w) => ctx.measureText(rs.st.upper ? w.toUpperCase() : w).width).reduce((a, b) => a + b, 0) + sp * (words.length - 1);
      ctx.restore();
      const y = pos.sub ? Math.max(fs, Math.min(H - fs, pos.sub.y * H)) : L.subtitleY(comp, (lines || []).length);
      const cx = pos.sub ? Math.max(total / 2 + 8, Math.min(W - total / 2 - 8, pos.sub.x * W)) : W / 2;
      drawComp.boxes.sub = { x0: cx - total / 2 - fs * 0.3, x1: cx + total / 2 + fs * 0.3, y0: y - fs * 0.8, y1: y + fs * 0.8, cx, cy: y };
      if (pos.guides) { ctx.save(); ctx.setLineDash([fs * 0.25, fs * 0.2]); ctx.lineWidth = Math.max(2, W * 0.004); ctx.strokeStyle = 'rgba(46,230,214,.9)'; const b = drawComp.boxes.sub; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.restore(); }
      SS.drawCanvas(ctx, words, cx, y, base, st, 1);
    }
    if (progress !== undefined && progress !== null) {
      const bh = Math.max(6, Math.round(H * 0.009));
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, H - bh, W, bh);
      ctx.fillStyle = '#ff3d8b'; ctx.fillRect(0, H - bh, W * Math.max(0, Math.min(1, progress)), bh);
    }
    if (watermark) {
      const fs = Math.round(Math.min(W, H) * 0.045);
      ctx.font = `${fs}px "HC Anton", Anton, Impact, sans-serif`; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; const tw = ctx.measureText('HYPECUT').width;
      const x = W - tw - W * 0.04, y = H - H * (W < H ? 0.13 : 0.05);
      ctx.fillText('HYPECUT', x + 2, y + 2); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText('HYPECUT', x, y);
    }
  }
  function saveSubStyle() { try { localStorage.setItem('hc_substyle', JSON.stringify(S.subStyle)); } catch (e) {} }
  function syncSubStyleUI() {
    if (!S.subStyle) { let saved = null; try { saved = JSON.parse(localStorage.getItem('hc_substyle')); } catch (e) {} S.subStyle = window.SubStyles.sanitize(saved); }
    const st = S.subStyle;
    const mark = (sel, v) => $$(sel + ' button').forEach((b) => { const on = b.dataset.v === String(v); b.classList.toggle('active', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    mark('#subFonts', st.font); mark('#subStyleSeg', st.style); mark('#subColors', st.color); mark('#subHi', st.hi); mark('#subSize', st.size);
    $('#subUpper').checked = st.upper;
    $('#subStyleBox').classList.toggle('hidden', !(S.ex && S.ex.subtitles));
  }
  const titleLinesFor = (layout, title) => L.wrapTitle(title, layout === 'landscape' ? 34 : layout === 'square' ? 24 : 20);
  const wantsWatermark = () => (S.mode === 'demo' ? true : !!S.user?.features?.watermark);

  function drawPreview() {
    const ex = S.ex; if (!ex || !ex.img) return;
    if (S.live) return; // l'aperçu animé redessine déjà chaque image
    const bg = (S.bgs || []).find((b) => b.id === ex.bgId);
    drawComp.bgImg = null;
    if (L.LAYOUTS[ex.layout]?.bg && bg) {
      S._bgImgs = S._bgImgs || {};
      if (S._bgImgs[bg.thumb]) drawComp.bgImg = S._bgImgs[bg.thumb];
      else loadImg(bg.thumb).then((im) => { if (im) { S._bgImgs[bg.thumb] = im; drawPreview(); } });
    }
    const comp = L.compose(ex.layout === 'game_ai' ? 'game_full' : ex.layout, ex.img.naturalWidth, ex.img.naturalHeight, previewOpts());
    const cv = $('#exCanvas'); cv.width = comp.W; cv.height = comp.H;
    drawComp(cv.getContext('2d'), comp, ex.img, ex.showTitle ? titleLinesFor(ex.layout, ex.title) : [], wantsWatermark(), ex.progressBar ? 0.6 : null, !!ex.subtitles && ex.layout !== 'game_ai', { title: ex.titlePos, sub: ex.subPos, guides: true });
    $('#posReset').classList.toggle('hidden', !ex.titlePos && !ex.subPos);
  }

  // ---------------------------------------------------------------- aperçu animé (gratuit, avant de dépenser un crédit)
  function liveBgUrl() {
    const bg = (S.bgs || []).find((b) => b.id === S.ex?.bgId);
    return L.LAYOUTS[S.ex?.layout]?.bg && bg ? bg.preview : null;
  }
  function setLiveBg() {
    const lv = S.live; if (!lv) return;
    const url = liveBgUrl();
    if (!url) { lv.bg.pause(); lv.bg.removeAttribute('src'); lv.bgUrl = null; return; }
    if (lv.bgUrl !== url) { lv.bgUrl = url; lv.bg.src = url; }
    lv.bg.play().catch(() => {});
  }
  function startLive() {
    const ex = S.ex; if (!ex || S.live || !S.result?.previewUrl) return;
    const v = document.createElement('video');
    v.src = S.result.previewUrl; v.playsInline = true; v.preload = 'auto';
    const bg = document.createElement('video');
    bg.muted = true; bg.loop = true; bg.playsInline = true; bg.preload = 'auto';
    const lv = S.live = { v, bg, bgUrl: null, raf: 0 };
    setLiveBg();
    const btn = $('#btnLivePrev'); btn.textContent = '⏸ Arrêter l’aperçu'; btn.disabled = true;
    $('#exPrevHint').textContent = 'Chargement de l’aperçu…';
    const fail = () => { if (S.live !== lv) return; stopLive(); $('#exPrevHint').textContent = 'Aperçu animé indisponible pour cette vidéo (source expirée ?). L’image fixe reste valable.'; };
    v.addEventListener('error', fail, { once: true });
    v.addEventListener('loadedmetadata', () => {
      if (S.live !== lv) return;
      v.currentTime = S.ex.start;
      v.play().then(() => { btn.disabled = false; $('#exPrevHint').textContent = 'Aperçu animé, en qualité réduite : rien n’est décompté tant que tu n’exportes pas.'; }).catch(fail);
    }, { once: true });
    const cv = $('#exCanvas'), ctx = cv.getContext('2d');
    const tick = () => {
      if (S.live !== lv) return;
      lv.raf = requestAnimationFrame(tick);
      const e = S.ex; if (!e || !v.videoWidth) return;
      if (v.currentTime >= e.end || v.currentTime < e.start - 1) { v.currentTime = e.start; return; }
      const comp = L.compose(e.layout === 'game_ai' ? 'game_full' : e.layout, v.videoWidth, v.videoHeight, previewOpts());
      if (cv.width !== comp.W || cv.height !== comp.H) { cv.width = comp.W; cv.height = comp.H; }
      drawComp.bgImg = lv.bgUrl && bg.readyState >= 2 ? bg : null;
      const prog = e.progressBar ? (v.currentTime - e.start) / Math.max(0.1, e.end - e.start) : null;
      drawComp(ctx, comp, v, e.showTitle ? titleLinesFor(e.layout, e.title) : [], wantsWatermark(), prog, !!e.subtitles && e.layout !== 'game_ai', { title: e.titlePos, sub: e.subPos, guides: false });
    };
    lv.raf = requestAnimationFrame(tick);
  }
  function stopLive() {
    const lv = S.live; if (!lv) return;
    S.live = null;
    cancelAnimationFrame(lv.raf);
    for (const m of [lv.v, lv.bg]) { m.pause(); m.removeAttribute('src'); m.load(); }
    const btn = $('#btnLivePrev'); if (btn) { btn.textContent = '▶ Voir l’aperçu animé'; btn.disabled = false; }
    if (S.ex) { syncLayout(); drawPreview(); }
  }

  /** Glisser-déposer du titre et des sous-titres sur l'aperçu (positions libres, en proportion de l'image). */
  function bindTextDrag() {
    const cv = $('#exCanvas');
    let drag = null;
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; };
    const hit = (p) => {
      const B = drawComp.boxes || {};
      for (const k of ['sub', 'title']) { const b = B[k]; if (b && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) return k; }
      return null;
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!S.ex) return;
      const p = at(e), k = hit(p); if (!k) return;
      const b = drawComp.boxes[k];
      drag = { k, dx: b.cx - p.x, dy: b.cy - p.y };
      cv.setPointerCapture(e.pointerId); cv.classList.add('dragging'); e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      const p = at(e);
      if (!drag) { cv.style.cursor = hit(p) ? 'grab' : 'default'; return; }
      const v = { x: Math.max(0, Math.min(1, (p.x + drag.dx) / cv.width)), y: Math.max(0, Math.min(1, (p.y + drag.dy) / cv.height)) };
      if (drag.k === 'title') S.ex.titlePos = S.titlePos = v; else S.ex.subPos = S.subPos = v;
      drawPreview();
    });
    const end = () => { drag = null; cv.classList.remove('dragging'); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    $('#posReset').addEventListener('click', () => { S.ex.titlePos = S.ex.subPos = S.titlePos = S.subPos = null; drawPreview(); });
  }

  function bindCamPicker() {
    const box = $('#camPick');
    let start = null;
    const pos = (e) => { const r = box.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    box.addEventListener('pointerdown', (e) => { start = pos(e); box.setPointerCapture(e.pointerId); });
    box.addEventListener('pointermove', (e) => {
      if (!start) return;
      const p = pos(e);
      S.ex.camRect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.max(0.03, Math.abs(p.x - start.x)), h: Math.max(0.03, Math.abs(p.y - start.y)) };
      drawCamRect(); drawPreview();
    });
    const end = () => { if (start) { start = null; S.camRect = S.ex.camRect; } };
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  }
  function drawCamRect() {
    const r = S.ex.camRect, el = $('#camRect');
    Object.assign(el.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
  }

  // ---------------------------------------------------------------- export : rendu
  async function doExport() {
    const ex = S.ex; if (ex.busy) return;
    stopLive();
    $('#exErr').innerHTML = '';
    if (S.mode === 'server' && S.user.credits <= 0) { closeModals(); location.hash = '#offres'; return; }
    ex.busy = true; $('#btnDoExport').disabled = true;
    $('#exResult').classList.remove('hidden'); $('#exBar').style.width = '0%';
    ['#exDownload', '#exSave', '#exCopy', '#exVideo'].forEach((s) => $(s).classList.add('hidden'));
    try {
      if (S.mode === 'server') await serverExport(ex);
      else await demoExport(ex);
    } catch (e) {
      console.error(e);
      $('#exErr').innerHTML = errHtml(e);
      $('#exMsg').textContent = '';
    }
    ex.busy = false; $('#btnDoExport').disabled = false;
  }

  async function serverExport(ex) {
    $('#exMsg').textContent = 'Envoi de la demande…';
    if (L.LAYOUTS[ex.layout]?.bg && !ex.bgId) throw new Error('Choisis une vidéo satisfaisante pour le bas de l’écran.');
    const body = { bgId: ex.bgId, clipIdx: ex.idx, layout: ex.layout, start: ex.start, end: ex.end, camRect: ex.camRect, corner: ex.corner, focusX: ex.focusX, title: ex.title, showTitle: ex.showTitle, progressBar: !!ex.progressBar, subtitles: !!ex.subtitles, subStyle: S.subStyle, titlePos: ex.titlePos, subPos: ex.subPos };
    const r = await api(`api/jobs/${S.jobId}/export`, { method: 'POST', body });
    S.user = r.user; renderHeader(); syncQuality();
    const id = r.ids[0];
    const LBL = { queued: 'En file d’attente', fetching: 'Récupération du passage en pleine qualité', subtitles: 'Écriture des sous-titres', rendering: 'Montage du clip', uploading: 'Mise en ligne', ai_crop: 'Recadrage IA en cours' };
    let fails = 0;
    for (;;) {
      await new Promise((s) => setTimeout(s, 1500));
      let e;
      try { ({ export: e } = await api('api/exports/' + id)); fails = 0; }
      catch (err) {
        if ((!err.status || err.status >= 500) && ++fails < 40) { $('#exMsg').textContent = 'Le serveur est très sollicité, on patiente…'; continue; }
        throw err;
      }
      $('#exBar').style.width = `${Math.round((e.progress || 0) * 100)}%`;
      if (e.status === 'done') {
        $('#exMsg').innerHTML = 'Ton clip est prêt ! 🎉 <a href="#compte" data-close>Invite tes amis</a> : 5 clips offerts chacun.<br><span class="hint">Pense à le télécharger : il est gardé 3 jours, puis supprimé.</span>' + (e.message ? `<br><span class="hint">ℹ️ ${esc(e.message)}</span>` : '');
        const v = $('#exVideo'); v.src = e.url; v.classList.remove('hidden');
        const a = $('#exDownload'); a.href = e.download || e.url; a.classList.remove('hidden');
        $('#exCopy').classList.remove('hidden');
        refreshMe(); loadJob(S.jobId);
        return;
      }
      if (e.status === 'error') { refreshMe(); throw new Error(e.message || 'L’export a échoué. Ton crédit a été remboursé.'); }
      $('#exMsg').textContent = `${LBL[e.status] || 'Traitement'}…${e.queue ? ` (position ${e.queue})` : ''}`;
    }
  }

  async function exportAll() {
    try {
      if (S.mode === 'server' && !S.bgs) { try { S.bgs = (await api('api/backgrounds')).backgrounds; } catch { S.bgs = []; } }
      const layout = defaultLayout();
      const bgId = S.lastBg || S.bgs?.[0]?.id || null;
      const r = await api(`api/jobs/${S.jobId}/export`, { method: 'POST', body: { all: true, layout, bgId, camRect: S.camRect, corner: S.corner, focusX: 0.5, useAiTitles: true, progressBar: effectsAllowed(), subtitles: effectsAllowed(), subStyle: S.subStyle, titlePos: S.titlePos || null, subPos: S.subPos || null } });
      S.user = r.user; renderHeader();
      toast(`${r.ids.length} clips en cours de montage (format : ${L.LAYOUTS[layout].label}).`);
      loadJob(S.jobId);
    } catch (e) {
      if (e.upgrade) { toast(e.message, 5000); location.hash = '#offres'; } else toast(e.message);
    }
  }

  // Démo : rendu dans le navigateur (canvas + MediaRecorder), mêmes formats que le serveur.
  async function demoExport(ex) {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) throw new Error('Ton navigateur ne permet pas l’export vidéo. Essaie Chrome, Edge ou Firefox sur ordinateur.');
    const loc = S.local;
    if (!loc.v) {
      const v = document.createElement('video');
      v.src = loc.url; v.playsInline = true; v.preload = 'auto';
      Object.assign(v.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', left: '0', bottom: '0' });
      document.body.appendChild(v);
      await once(v, 'loadedmetadata');
      const AC = window.AudioContext || window.webkitAudioContext;
      loc.ac = new AC();
      loc.srcNode = loc.ac.createMediaElementSource(v);
      loc.dest = loc.ac.createMediaStreamDestination();
      loc.srcNode.connect(loc.dest);
      loc.v = v;
    }
    await loc.ac.resume();
    const v = loc.v;
    const comp = L.compose(ex.layout, v.videoWidth, v.videoHeight, { res: 720, camRect: ex.camRect, focusX: ex.focusX, corner: ex.corner });
    const cv = document.createElement('canvas'); cv.width = comp.W; cv.height = comp.H;
    const ctx = cv.getContext('2d');
    const lines = ex.showTitle ? titleLinesFor(ex.layout, ex.title) : [];
    await document.fonts?.load?.('64px Anton').catch(() => {});
    $('#exMsg').textContent = 'Préparation…';
    await seek(v, ex.start);
    drawComp(ctx, comp, v, lines, true, null, false, { title: ex.titlePos });
    const stream = cv.captureStream(30);
    loc.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = once(rec, 'stop');
    rec.start(250);
    await v.play();
    const dur = ex.end - ex.start;
    await new Promise((res) => {
      const step = () => {
        drawComp(ctx, comp, v, lines, true, ex.progressBar ? (v.currentTime - ex.start) / dur : null, false, { title: ex.titlePos });
        const p = (v.currentTime - ex.start) / dur;
        $('#exBar').style.width = `${Math.round(Math.min(1, p) * 100)}%`;
        $('#exMsg').textContent = `Montage en temps réel… ${Math.round(Math.min(1, p) * 100)} % (garde cet onglet ouvert)`;
        if (v.currentTime >= ex.end || v.ended) return res();
        requestAnimationFrame(step);
      };
      step();
    });
    v.pause(); rec.stop(); await stopped;
    stream.getVideoTracks().forEach((t) => t.stop());
    const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
    const blob = new Blob(chunks, { type });
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const name = `${(ex.title || 'hypecut-clip').normalize('NFD').replace(/[^\w-]+/g, '_').slice(0, 50) || 'hypecut-clip'}.${ext}`;
    const url = URL.createObjectURL(blob);
    const vid = $('#exVideo'); vid.src = url; vid.classList.remove('hidden');
    $('#exBar').style.width = '100%';
    $('#exMsg').textContent = `Ton clip est prêt (${(blob.size / 1048576).toFixed(1)} Mo, ${ext.toUpperCase()}) ! 🎉`;
    $('#exCopy').classList.remove('hidden');
    if (S.claude.downloads) {
      const b = $('#exSave'); b.classList.remove('hidden');
      b.onclick = async () => {
        try { await S.claude.downloads.save({ filename: name, data: blob }); toast('Clip enregistré.'); }
        catch (e) { if (e?.code !== 'declined') toast('Enregistrement impossible ici.'); }
      };
    } else {
      const a = $('#exDownload'); a.href = url; a.download = name; a.removeAttribute('target'); a.classList.remove('hidden');
    }
  }

  async function copyCaption() {
    const c = S.result.clips[S.ex.idx];
    const ai = c.ai || {};
    const txt = [S.ex.title, ai.description, (ai.hashtags || ['#GTA6', '#GTAVI', '#gaming', '#clip']).join(' ')].filter(Boolean).join('\n\n');
    try { await navigator.clipboard.writeText(txt); toast('Légende copiée.'); } catch { toast('Copie impossible : sélectionne le texte à la main.'); }
  }

  // ---------------------------------------------------------------- IA dans la démo
  async function demoAiTitles() {
    const sample = S.claude.sample; if (!sample) return;
    const btn = $('#btnAiAll'); btn.disabled = true;
    let canImg = false;
    try { canImg = !!(await sample.limits?.())?.images; } catch {}
    const toBlob = async (u) => (await fetch(u)).blob();
    for (let i = 0; i < S.result.clips.length; i++) {
      const c = S.result.clips[i];
      btn.textContent = `✨ IA ${i + 1}/${S.result.clips.length}…`;
      const prompt = `Tu es monteur de clips gaming viraux (TikTok, YouTube Shorts, Reels). La communauté prépare la sortie de GTA VI.
${canImg ? 'Les images viennent d’un moment fort détecté dans une vidéo de gameplay : la première juste avant le pic, la seconde au pic. Décris seulement ce que tu vois.' : 'Tu n’as pas les images, seulement les mesures.'}
Signaux : ${c.reasons.join(', ')} ; intensité ${c.hype}/100 ; durée ${Math.round(S.clips[i].end - S.clips[i].start)} s.
Réponds UNIQUEMENT avec un objet JSON : {"titre": "42 caractères max, sans hashtag ni emoji", "description": "une phrase de légende", "hashtags": ["#GTA6", "4 autres"], "type": "poursuite|fusillade|crash|cascade|explosion|braquage|drôle|paysage|cinématique|autre", "viralite": 1-10}`;
      try {
        const opts = { modelTier: 'quick' };
        if (canImg) opts.images = [await toBlob(c.pre || c.thumb), await toBlob(c.thumb)];
        const r = await sample(prompt, opts);
        const m = String(r.text).match(/\{[\s\S]*\}/);
        if (!m) continue;
        const j = JSON.parse(m[0]);
        c.ai = { titre: String(j.titre || '').slice(0, 60), description: String(j.description || ''), hashtags: (j.hashtags || []).slice(0, 6), type: j.type, viralite: Math.max(1, Math.min(10, +j.viralite || 5)) };
        if (c.ai.titre) S.clips[i].title = c.ai.titre;
        renderClips();
      } catch (e) {
        if (e?.code === 'not_granted') { S.claude.sample = null; break; }
        if (e?.code === 'rate_limited') { toast('L’IA est très demandée : réessaie dans un instant.'); break; }
        console.warn(e);
      }
    }
    btn.textContent = '✨ Titres IA'; btn.disabled = false;
    renderWorkspace();
  }

  // ---------------------------------------------------------------- offres, historique, compte
  function renderPlans() {
    const c = S.cfg; if (!c) return;
    const launch = c.launch?.active;
    $('#offersLead').textContent = c.launch?.pass?.active ? 'Pour la sortie de GTA VI, toutes les fonctions Pro sont offertes cette semaine. Les abonnements arrivent juste après.' : launch ? 'Offre de lancement GTA VI : Pro à moitié prix le premier mois, jusqu’au 30 novembre.' : 'Essaie gratuitement, puis passe à la vitesse supérieure.';
    const pass = c.launch?.pass?.active ? c.launch.pass : null;
    $('#plans').innerHTML = c.plans.map((p) => {
      if (pass && p.id === 'free') {
        p = { ...p, name: 'Pass lancement GTA VI', perks: [`${pass.credits} clips offerts`, 'Sans filigrane', 'Tous les formats caméra', 'Titres, légendes et hashtags automatiques', 'Vidéos jusqu’à 4 h', `Jusqu’au ${new Date(pass.ends).toLocaleDateString(LOC, { day: 'numeric', month: 'long' })}`] };
      }
      const featured = pass ? p.id === 'free' : p.id === 'pro';
      const lp = p.launchPrice;
      const price = p.price === 0 ? '<div class="price">0 €</div>' : lp ? `<div class="price"><s>${eur(p.price)}</s>${eur(lp)} <small>le 1er mois, puis ${eur(p.price)}/mois</small></div>` : `<div class="price">${eur(p.price)} <small>/ mois</small></div>`;
      const current = S.user?.plan === p.id;
      let cta;
      if (S.mode === 'demo') cta = `<button class="btn ${featured ? 'primary' : 'ghost'}" disabled>Disponible sur le site complet</button>`;
      else if (current) cta = `<button class="btn ghost" disabled>Ton offre actuelle</button>`;
      else if (p.id === 'free') cta = S.user ? `<a class="btn ${featured ? 'primary' : 'ghost'}" href="#creer">Créer un clip</a>` : `<button class="btn ${featured ? 'primary' : 'ghost'}" data-signup>${pass ? 'J’en profite gratuitement' : 'Commencer gratuitement'}</button>`;
      else cta = `<button class="btn ${featured ? 'primary' : 'ghost'}" data-buy="${p.id}">Choisir ${esc(p.name)}</button>`;
      return `<div class="card plan ${featured ? 'featured' : ''}">${featured ? `<span class="ribbon">${pass ? '🎮 Semaine de sortie GTA VI' : launch ? '🎮 Offre lancement GTA VI' : 'Le plus populaire'}</span>` : ''}
        <h3>${esc(p.name)}</h3>${price}<ul class="perks">${p.perks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${cta}</div>`;
    }).join('');
    const pack = c.packs?.[0];
    $('#earnCard')?.classList.toggle('hidden', S.mode !== 'server');
    $('#packCard').innerHTML = pack ? `<div><strong>Besoin de quelques clips en plus, sans abonnement ?</strong><p class="hint" style="margin:4px 0 0">${esc(pack.name)} : ${pack.credits} crédits valables sans limite de temps.</p></div>
      <button class="btn ghost" data-buy="${pack.id}" ${S.mode === 'demo' ? 'disabled' : ''}>${eur(pack.price)} · Acheter</button>` : '';
    $$('[data-buy]').forEach((b) => b.addEventListener('click', () => buy(b.dataset.buy, b)));
    $$('[data-signup]').forEach((b) => b.addEventListener('click', () => openAuth('signup')));
  }

  async function buy(product, btn) {
    if (!S.user) { openAuth('signup', 'Crée ton compte pour choisir une offre.'); return; }
    const w = $('#waiverCheck');
    if (!w.checked) { const box = $('#waiverBox'); box.classList.add('shake'); box.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Coche la case d’accès immédiat pour continuer.'); return; }
    btn.disabled = true;
    try { const r = await api('api/billing/checkout', { method: 'POST', body: { product, waiver: true } }); location.href = r.url; }
    catch (e) { toast(e.message, 5000); btn.disabled = false; }
  }

  async function renderHistory() {
    const box = $('#history');
    if (!S.user) { box.innerHTML = '<p class="hint">Connecte-toi pour retrouver tes vidéos. <button class="btn ghost xs" data-open-auth>Se connecter</button></p>'; return; }
    box.innerHTML = '<p class="hint">Chargement…</p>';
    try {
      const { jobs } = await api('api/jobs');
      if (!jobs.length) { box.innerHTML = '<p class="hint">Aucune vidéo pour l’instant. <a href="#creer">Analyse ta première vidéo</a>.</p>'; return; }
      box.innerHTML = jobs.map((j) => `<a class="hist" href="#analyse-${esc(j.id)}">
        ${j.thumb ? `<img src="${esc(j.thumb)}" alt="">` : '<div class="ph"></div>'}
        <div class="meta"><strong>${esc(j.title || j.sourceUrl || 'Vidéo')}</strong>
        <span class="hint">${new Date(j.createdAt.replace(' ', 'T') + 'Z').toLocaleString(LOC, { dateStyle: 'medium', timeStyle: 'short' })}${j.clipCount ? ` · ${j.clipCount} clips` : ''}${j.duration ? ` · ${fmt(j.duration)}` : ''}</span></div>
        <span class="status ${j.status === 'done' ? 'done' : j.status === 'error' ? 'error' : ''}">${esc(STATUS[j.status] || j.status)}</span></a>`).join('');
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  async function renderAccount() {
    if (S.user && S.cfg?.services?.stripe && !S._synced) {
      S._synced = true;
      try { const r = await api('api/billing/sync', { method: 'POST', body: {} }); S.user = r.user; renderHeader(); } catch {}
    }
    const box = $('#accountCard'); const u = S.user;
    if (!u) { box.innerHTML = '<p>Tu n’es pas connecté.</p><button class="btn primary" data-open-auth>Se connecter</button>'; return; }
    box.innerHTML = `
      <div class="kv"><span>E-mail</span><b>${esc(u.email)}</b></div>
      <div class="kv"><span>Offre</span><b>${esc(u.planName)}</b></div>
      <div class="kv"><span>Crédits restants</span><b>${u.credits}</b></div>
      ${u.periodEnd ? `<div class="kv"><span>Renouvellement</span><b>${new Date(u.periodEnd).toLocaleDateString(LOC)}</b></div>` : ''}
      <div class="kv"><span>Qualité d’export</span><b>${u.features.res}p ${u.features.fps} i/s${u.features.watermark ? ' · filigrane' : ''}</b></div>
      <label class="check mail-pref"><input type="checkbox" id="mailPref" ${u.emailOptOut ? '' : 'checked'}> <span>Recevoir les conseils et les annonces de défis par e-mail</span></label>
      <div class="row">
        ${u.subscribed ? '<button class="btn ghost" id="btnPortal">Gérer mon abonnement</button>' : '<a class="btn primary" href="#offres">Passer à Pro</a>'}
        <button class="btn ghost" id="btnLogout">Se déconnecter</button>
      </div>`;
    renderLevel();
    renderUgc();
    renderReferral();
    $('#mailPref').addEventListener('change', async (e) => { try { const r = await api('api/me/emails', { method: 'POST', body: { optOut: !e.target.checked } }); S.user = r.user; toast(e.target.checked ? 'C’est noté : tu recevras nos conseils et défis.' : 'C’est noté : plus de conseils ni d’annonces par e-mail.'); } catch (err) { toast(err.message); e.target.checked = !e.target.checked; } });
    $('#btnLogout').addEventListener('click', async () => { await api('api/auth/logout', { method: 'POST' }).catch(() => {}); S.user = null; renderHeader(); resetWorkspace(); location.hash = '#creer'; toast('Déconnecté.'); });
    $('#btnPortal')?.addEventListener('click', async (e) => { e.target.disabled = true; try { location.href = (await api('api/billing/portal', { method: 'POST' })).url; } catch (err) { toast(err.message); e.target.disabled = false; } });
  }

  // ---------------------------------------------------------------- revenus du clippeur
  function revMoney(v, cur) {
    const n = Number(v || 0).toLocaleString(LOC, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
    return cur === '€' ? `${n} €` : `${n} $`;
  }
  async function renderRevenue(data) {
    const box = $('#revBody'), curBox = $('#revCur');
    if (!S.user) { curBox.innerHTML = ''; box.innerHTML = '<div class="card center"><p>Connecte-toi pour suivre tes revenus de clippeur.</p><button class="btn primary" data-open-auth>Se connecter</button></div>'; return; }
    let d = data;
    try { if (!d) d = await api('api/revenue'); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    S.rev = d;
    const c = d.currency, m = (v) => revMoney(v, c), sm = d.summary;
    curBox.innerHTML = d.currencies.map((x) => `<button data-cur="${esc(x)}" class="${x === c ? 'active' : ''}">${x === '€' ? 'Euros €' : 'Dollars $'}</button>`).join('');
    $$('[data-cur]', curBox).forEach((b) => b.addEventListener('click', async () => { try { renderRevenue(await api('api/revenue/currency', { method: 'POST', body: { currency: b.dataset.cur } })); } catch (e) { toast(e.message); } }));
    const plan = (S.cfg?.plans || []).find((p) => p.id === S.user.plan);
    const camps = d.campaigns.filter((x) => !x.archived);
    const today = new Date().toISOString().slice(0, 10);
    const tiles = [[m(sm.total), 'gagnés au total'], [m(sm.received), 'déjà reçus'], [m(sm.pending), 'en attente de paiement'], [m(sm.monthTotal), 'ce mois-ci'], [nf(sm.views), 'vues au total'], [m(sm.rpm), 'en moyenne pour 1 000 vues']];
    box.innerHTML = `
      <div class="tiles">${tiles.map(([v, k]) => `<div class="tile"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join('')}</div>
      ${plan && plan.price && sm.monthTotal > 0 ? `<p class="hint rev-roi">💡 Ce mois-ci, tu as gagné ${esc(m(sm.monthTotal))} ; ton offre ${esc(plan.name)} coûte ${esc(eur(plan.price))} par mois.</p>` : ''}
      <div class="charts1">${barChart('chRev', 'Gains par semaine', '8 dernières semaines, selon la date de publication', d.weeks, m)}</div>

      <div class="rev-grid">
        <div class="card">
          <h3 class="rev-h">📋 Mes campagnes</h3>
          ${d.campaigns.length ? `<table class="adm-table rev-camps"><thead><tr><th>Campagne</th><th>Tarif / 1 000 vues</th><th>Clips</th><th>Gains</th><th></th></tr></thead><tbody>${d.campaigns.map((x) => `
            <tr data-cid="${esc(x.id)}" class="${x.archived ? 'muted-row' : ''}"><td><b>${esc(x.name)}</b><br><span class="hint">${esc(x.platform || '')}${x.archived ? ' · terminée' : ''}</span></td><td>${esc(m(x.rate))}</td><td>${nf(x.clips)}</td><td>${esc(m(x.total))}</td>
            <td class="nowrap"><button class="btn ghost xs" data-arch>${x.archived ? 'Réactiver' : 'Terminer'}</button> <button class="btn ghost xs" data-cdel aria-label="Supprimer la campagne ${esc(x.name)}">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="hint">Ajoute la campagne que tu as rejointe (par exemple sur Content Rewards ou Whop) et son tarif pour 1 000 vues.</p>'}
          <div class="rev-form">
            <input id="rcName" maxlength="60" placeholder="Nom (ex. : Clips GTA VI de Streamer X)" aria-label="Nom de la campagne">
            <select id="rcPlat" aria-label="Plateforme">${d.platforms.map((p) => `<option>${esc(p)}</option>`).join('')}</select>
            <input id="rcRate" inputmode="decimal" placeholder="Tarif pour 1 000 vues (${esc(c)})" aria-label="Tarif pour 1 000 vues">
            <button class="btn primary sm" id="rcAdd">Ajouter la campagne</button>
          </div>
        </div>

        <div class="card">
          <h3 class="rev-h">🎬 Ajouter un clip publié</h3>
          <div class="rev-form">
            <select id="rpCamp" aria-label="Campagne"><option value="">Sans campagne</option>${camps.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>
            <input id="rpUrl" type="url" placeholder="Lien du clip (TikTok, Reels, Shorts…)" aria-label="Lien du clip">
            <div class="rev-row"><label>Publié le<input id="rpDate" type="date" value="${today}" max="${today}"></label><label>Vues<input id="rpViews" inputmode="numeric" placeholder="0"></label></div>
            <div class="rev-row"><label>Montant (${esc(c)})<input id="rpAmount" inputmode="decimal" placeholder="Auto"></label><label class="check rev-paid"><input type="checkbox" id="rpPaid"> <span>Déjà payé</span></label></div>
            <p class="hint">Laisse « Montant » vide : il est estimé avec le tarif de la campagne (vues ÷ 1 000 × tarif).</p>
            <button class="btn primary sm" id="rpAdd">Ajouter le clip</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h3 class="rev-h">📈 Mes clips publiés</h3>
        ${d.posts.length ? `<div class="table-scroll"><table class="adm-table rev-posts"><thead><tr><th>Clip</th><th class="opt">Publié le</th><th>Vues</th><th>Gains</th><th>Payé</th><th></th></tr></thead><tbody>${d.posts.map((p) => `
          <tr data-pid="${esc(p.id)}"><td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title || hostOf(p.url))} ↗</a>` : esc(p.title || 'Clip')}<br><span class="hint">${esc(p.campaign || 'Sans campagne')}</span></td>
          <td class="opt">${esc(new Date(p.postedOn + 'T12:00:00').toLocaleDateString(LOC))}</td>
          <td><input class="rev-views" inputmode="numeric" value="${p.views}" aria-label="Vues"></td>
          <td>${esc(m(p.value))}${p.estimated ? '<br><span class="hint">estimé</span>' : ''}</td>
          <td><input type="checkbox" class="rev-paidbox" ${p.paid ? 'checked' : ''} aria-label="Payé"></td>
          <td><button class="btn ghost xs" data-pdel aria-label="Supprimer ce clip">✕</button></td></tr>`).join('')}</tbody></table></div>
          <p class="hint">Mets à jour les vues quand elles bougent, et coche « Payé » quand l’argent est arrivé.</p>` : '<p class="hint">Aucun clip pour l’instant. Ajoute ton premier clip publié ci-dessus.</p>'}
      </div>
      <p class="hint center">Ces chiffres sont ceux que tu saisis : HYPECUT ne connaît pas tes revenus réels. Les gains dépendent de chaque campagne et ne sont jamais garantis.</p>`;
    bindChart('chRev');
    const send = async (path, body, method = 'POST') => { try { renderRevenue(await api(path, { method, body })); return true; } catch (e) { toast(e.message, 5000); return false; } };
    $('#rcAdd').addEventListener('click', () => send('api/revenue/campaigns', { name: $('#rcName').value, platform: $('#rcPlat').value, rate: $('#rcRate').value }));
    $('#rpAdd').addEventListener('click', () => send('api/revenue/posts', { campaignId: $('#rpCamp').value, url: $('#rpUrl').value, postedOn: $('#rpDate').value, views: $('#rpViews').value || 0, amount: $('#rpAmount').value, paid: $('#rpPaid').checked }));
    $$('tr[data-cid]', box).forEach((tr) => {
      const x = d.campaigns.find((k) => k.id === tr.dataset.cid);
      $('[data-arch]', tr).addEventListener('click', () => send('api/revenue/campaigns/' + x.id, { name: x.name, platform: x.platform, rate: x.rate, archived: !x.archived }));
      $('[data-cdel]', tr).addEventListener('click', () => { if (confirm(`Supprimer la campagne « ${x.name} » ? Ses clips restent, sans campagne.`)) send('api/revenue/campaigns/' + x.id, undefined, 'DELETE'); });
    });
    $$('tr[data-pid]', box).forEach((tr) => {
      const p = d.posts.find((k) => k.id === tr.dataset.pid);
      const save = (patch) => send('api/revenue/posts/' + p.id, { campaignId: p.campaignId, url: p.url, title: p.title, postedOn: p.postedOn, views: p.views, amount: p.amount, paid: p.paid, ...patch });
      $('.rev-views', tr).addEventListener('change', (e) => save({ views: e.target.value || 0 }));
      $('.rev-paidbox', tr).addEventListener('change', (e) => save({ paid: e.target.checked }));
      $('[data-pdel]', tr).addEventListener('click', () => { if (confirm('Supprimer ce clip de ton suivi ?')) send('api/revenue/posts/' + p.id, undefined, 'DELETE'); });
    });
  }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'Clip'; } }

  // ---------------------------------------------------------------- défi GTA VI
  const RANK = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const dShort = (iso) => new Date(iso).toLocaleDateString(LOC, { day: 'numeric', month: 'long' });
  function timeLeft(iso) {
    const ms = new Date(iso) - Date.now(); if (ms <= 0) return 'terminé';
    const d = Math.floor(ms / 86400e3), h = Math.floor((ms % 86400e3) / 3600e3);
    return d ? `encore ${d} j ${h} h` : `encore ${h} h ${Math.floor((ms % 3600e3) / 60e3)} min`;
  }
  async function renderChallenge(data) {
    const box = $('#defiBody');
    let d = data;
    try { if (!d) d = await api('api/challenges'); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    const c = d.current, prizes = (p) => `<div class="ch-prizes">${p.map((n, i) => n ? `<div><span>${RANK[i + 1]}</span><b>${nf(n)} clips</b></div>` : '').join('')}</div>`;
    const mineList = (arr) => arr.length ? `<div class="ugc-list">${arr.map((e) => `<div class="ugc-item"><div class="meta"><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.title || hostOf(e.url))} ↗</a><span class="hint">Envoyé le ${esc(new Date(e.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(LOC))}</span></div>${e.rank ? `<span class="status done">${RANK[e.rank]} Gagnant</span>` : '<span class="status">✅ Participe</span>'}</div>`).join('')}</div>` : '';
    box.innerHTML = `
      ${c ? `<div class="card ch-card">
        <div class="ch-top"><span class="pill-live">● EN COURS</span><span class="hint">${esc(timeLeft(c.endsAt))} · jusqu’au ${esc(dShort(c.endsAt))} · ${nf(c.entries)} participation${c.entries > 1 ? 's' : ''}</span></div>
        <p class="ch-kicker">${esc(c.title)}</p><h3 class="ch-theme">${esc(c.theme)}</h3>
        ${c.description ? `<p class="hint">${esc(c.description)}</p>` : ''}
        ${prizes(c.prizes)}
        ${S.user ? (c.mine.length < d.maxEntries ? `
          <div class="rev-form">
            <input id="chUrl" type="url" placeholder="Lien de ton clip publié (TikTok, Reels ou Shorts)" aria-label="Lien de ton clip">
            <input id="chTitle" maxlength="80" placeholder="Titre (facultatif)" aria-label="Titre du clip">
            <label class="check"><input type="checkbox" id="chAccept"> <span>J’ai 18 ans ou plus, j’ai les droits sur ce clip et j’accepte le <a href="legal.html#defis" target="_blank">règlement du défi</a>.</span></label>
            <button class="btn primary" id="chSend">🏆 Je participe</button>
          </div>` : `<p class="hint">Tu as envoyé ${d.maxEntries} clips : c’est le maximum pour ce défi. Bonne chance !</p>`)
        : '<p><button class="btn primary" data-open-auth>Se connecter pour participer</button></p>'}
        ${mineList(c.mine)}
      </div>` : `<div class="card center"><p><b>Pas de défi en cours pour le moment.</b></p>${d.next ? `<p class="hint">Prochain défi : « ${esc(d.next.theme)} », à partir du ${esc(dShort(d.next.startsAt))}.</p>` : ''}</div>`}
      ${c && d.next ? `<p class="hint center">Ensuite : « ${esc(d.next.theme)} », à partir du ${esc(dShort(d.next.startsAt))}.</p>` : ''}
      <div class="card ch-how"><h3 class="rev-h">Comment ça marche ?</h3><ol>
        <li>Crée ton clip sur le thème de la semaine (avec HYPECUT, c’est plus rapide 😉).</li>
        <li>Publie-le sur ton compte TikTok, Instagram ou YouTube, en public.</li>
        <li>Envoie le lien ici avant la fin du défi (${d.maxEntries} clips max).</li>
        <li>Le jury choisit les 3 meilleurs clips (idée, montage, moment) : les gagnants reçoivent leurs clips et sont affichés ici.</li>
      </ol><p class="hint">Participation gratuite, sans achat. Utilise uniquement ton propre gameplay ou un clip fait avec l’accord du créateur.</p></div>
      ${d.past.length ? `<h3 class="adm-h">Défis passés</h3><div class="ch-past">${d.past.map((p) => `<div class="card"><p class="ch-kicker">${esc(p.title)} · ${esc(dShort(p.startsAt))} → ${esc(dShort(p.endsAt))}</p><b>${esc(p.theme)}</b>
        ${p.winners.length ? `<div class="ugc-list">${p.winners.map((w) => `<div class="ugc-item"><span>${RANK[w.rank]}</span><div class="meta"><a href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">${esc(w.name)} ↗</a>${w.title ? `<span class="hint">${esc(w.title)}</span>` : ''}</div></div>`).join('')}</div>` : '<p class="hint">Résultats bientôt.</p>'}</div>`).join('')}</div>` : ''}`;
    $('#chSend')?.addEventListener('click', async (e) => {
      const url = $('#chUrl').value.trim();
      if (!url) { toast('Colle d’abord le lien de ton clip.'); return; }
      e.target.disabled = true;
      try { const r = await api(`api/challenges/${c.id}/entries`, { method: 'POST', body: { url, title: $('#chTitle').value, accept: $('#chAccept').checked } }); toast('C’est envoyé : tu participes au défi ! 🏆', 5000); renderChallenge(r); }
      catch (err) { toast(err.message, 6000); e.target.disabled = false; }
    });
  }

  // admin : défis
  async function renderAdminChallenges() {
    const box = $('#admCh'); if (!box) return;
    try {
      const { challenges } = await api('api/admin/challenges');
      const toLocal = (iso) => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
      const ST = { live: '● En cours', upcoming: 'À venir', ended: 'Terminé' };
      const form = (c) => `<div class="ch-form" data-chid="${esc(c?.id || '')}">
        <input name="title" maxlength="40" placeholder="Titre (Défi n°5)" value="${esc(c?.title || '')}" aria-label="Titre">
        <input name="theme" maxlength="80" placeholder="Thème" value="${esc(c?.theme || '')}" aria-label="Thème">
        <input name="description" maxlength="300" placeholder="Description (facultatif)" value="${esc(c?.description || '')}" aria-label="Description">
        <label>Début<input name="startsAt" type="datetime-local" value="${c ? toLocal(c.startsAt) : ''}"></label>
        <label>Fin<input name="endsAt" type="datetime-local" value="${c ? toLocal(c.endsAt) : ''}"></label>
        <label>Prix 🥇 🥈 🥉 (clips)<input name="prizes" value="${esc((c?.prizes || [30, 15, 5]).join(', '))}"></label>
        <button class="btn primary xs" data-save>${c ? 'Enregistrer' : 'Créer le défi'}</button>${c ? ' <button class="btn ghost xs" data-del>Supprimer</button>' : ''}</div>`;
      box.innerHTML = `${challenges.map((c) => `<details class="ch-adm"><summary><b>${esc(c.title)} · ${esc(c.theme)}</b> <span class="hint">${esc(ST[c.status])} · ${nf(c.entries)} participation${c.entries > 1 ? 's' : ''}${c.awarded ? ' · prix attribués ✅' : ''}</span></summary>
        ${form(c)}<div class="ch-entries" data-entries="${esc(c.id)}"><p class="hint">Chargement des participations…</p></div></details>`).join('')}
        <details class="ch-adm"><summary><b>➕ Nouveau défi</b></summary>${form(null)}</details>`;
      $$('.ch-form', box).forEach((f) => {
        const val = (n) => $(`[name=${n}]`, f).value;
        $('[data-save]', f).addEventListener('click', async () => {
          const body = { title: val('title'), theme: val('theme'), description: val('description'), startsAt: val('startsAt') && new Date(val('startsAt')).toISOString(), endsAt: val('endsAt') && new Date(val('endsAt')).toISOString(), prizes: val('prizes').split(/[,;\s]+/).filter(Boolean).map(Number) };
          try { await api('api/admin/challenges' + (f.dataset.chid ? '/' + f.dataset.chid : ''), { method: 'POST', body }); toast('Défi enregistré.'); renderAdminChallenges(); } catch (e) { toast(e.message, 5000); }
        });
        $('[data-del]', f)?.addEventListener('click', async () => { if (!confirm('Supprimer ce défi et ses participations ?')) return; try { await api('api/admin/challenges/' + f.dataset.chid, { method: 'DELETE' }); renderAdminChallenges(); } catch (e) { toast(e.message); } });
      });
      $$('details.ch-adm', box).forEach((det) => det.addEventListener('toggle', () => { const el = $('[data-entries]', det); if (det.open && el) loadEntries(el, challenges.find((c) => c.id === el.dataset.entries)); }));
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  async function loadEntries(el, c) {
    try {
      const { entries } = await api(`api/admin/challenges/${c.id}/entries`);
      el.innerHTML = entries.length ? `<table class="adm-table"><thead><tr><th>Clip</th><th>Compte</th><th>Classement</th><th></th></tr></thead><tbody>${entries.map((e) => `
        <tr data-eid="${esc(e.id)}" class="${e.removed ? 'muted-row' : ''}"><td><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.title || e.name)} ↗</a></td><td>${esc(e.email)}</td>
        <td><select ${c.awarded || e.removed ? 'disabled' : ''} aria-label="Classement"><option value="">—</option>${[1, 2, 3].map((r) => `<option value="${r}" ${e.rank === r ? 'selected' : ''}>${RANK[r]} ${r}${r === 1 ? 'er' : 'e'}</option>`).join('')}</select></td>
        <td>${c.awarded ? '' : `<button class="btn ghost xs" data-rm>${e.removed ? 'Remettre' : 'Exclure'}</button>`}</td></tr>`).join('')}</tbody></table>
        ${c.awarded ? '<p class="hint">Prix attribués.</p>' : `<button class="btn primary sm" data-award ${c.status !== 'ended' ? 'disabled title="Disponible à la fin du défi"' : ''}>🏆 Attribuer les prix (${c.prizes.join(' / ')} clips)</button>`}` : '<p class="hint">Aucune participation pour l’instant.</p>';
      $$('tr[data-eid]', el).forEach((tr) => {
        const e = entries.find((x) => x.id === tr.dataset.eid);
        $('select', tr).addEventListener('change', async (ev) => { try { await api('api/admin/entries/' + e.id, { method: 'POST', body: { rank: ev.target.value } }); loadEntries(el, c); } catch (err) { toast(err.message); } });
        $('[data-rm]', tr)?.addEventListener('click', async () => { try { await api('api/admin/entries/' + e.id, { method: 'POST', body: { removed: !e.removed } }); loadEntries(el, c); } catch (err) { toast(err.message); } });
      });
      $('[data-award]', el)?.addEventListener('click', async () => {
        if (!confirm('Verser les prix aux gagnants ? C’est définitif.')) return;
        try { const r = await api(`api/admin/challenges/${c.id}/award`, { method: 'POST', body: {} }); toast(`Prix versés à ${r.paid.length} gagnant${r.paid.length > 1 ? 's' : ''}.`); renderAdminChallenges(); } catch (err) { toast(err.message, 5000); }
      });
    } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  // ---------------------------------------------------------------- niveaux de clippeur
  async function renderLevel() {
    const box = $('#levelCard'); if (!box || !S.user || S.mode !== 'server') return;
    box.classList.remove('hidden');
    try {
      const r = await api('api/levels'), l = r.level;
      box.innerHTML = `
        <div class="lvl-head"><span class="lvl-badge lvl-${esc(l.key)}">${l.emoji}</span><div><h3>Niveau ${esc(l.name)}</h3>
        <p class="hint">${nf(r.clips)} clip${r.clips > 1 ? 's' : ''} créé${r.clips > 1 ? 's' : ''}${r.next ? ` · encore ${nf(r.toNext)} pour passer ${esc(r.next.name)} ${r.next.emoji}` : ' · niveau maximum atteint 🔥'}</p></div></div>
        ${r.next ? `<div class="lvl-bar" role="progressbar" aria-valuenow="${r.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progression vers le niveau ${esc(r.next.name)}"><i style="width:${Math.max(3, r.pct)}%"></i></div>` : ''}
        <div class="lvl-list">${r.levels.map((x) => `<div class="lvl-row ${x.id <= l.id ? 'got' : ''}"><span class="e">${x.emoji}</span><div><b>${esc(x.name)}</b> <span class="hint">dès ${nf(x.min)} clips</span><br><span class="hint">${x.perks.map(esc).join(' · ')}</span></div>${x.id <= l.id ? '<span class="ok">✓</span>' : ''}</div>`).join('')}</div>`;
    } catch { box.classList.add('hidden'); }
  }

  // ---------------------------------------------------------------- programme créateur
  const UGC_STATUS = { pending: '⏳ En vérification', approved: '✅ Validée', rejected: '❌ Refusée' };
  const PLATFORM = { tiktok: 'TikTok', instagram: 'Instagram' };
  async function renderUgc() {
    const box = $('#ugcCard'); if (!box || !S.user || S.mode !== 'server') return;
    box.classList.remove('hidden');
    try {
      const r = await api('api/ugc'), c = r.config;
      const rate = c.per1000 === 1 ? '1 clip' : `${c.per1000} clips`;
      box.innerHTML = `
        <h3>📈 Gagne des clips avec tes vidéos</h3>
        <p class="hint">Publie une vidéo TikTok ou Reels qui présente HYPECUT (un clip fait avec le site, ton avis, un tuto…). Envoie le lien ici : après vérification, tu gagnes <b>${rate} pour 1 000 vues</b>, jusqu’à ${c.maxPerVideo} clips par vidéo.</p>
        <details class="ugc-rules"><summary>Les règles (à lire avant de publier)</summary><ul>
          <li>La vidéo est <b>publique</b>, publiée depuis <b>ton</b> compte, et montre ou cite HYPECUT (mets <b>#hypecut</b> et le lien hypecut-h6pu.onrender.com dans ta description ou ta bio).</li>
          <li>Tu es récompensé en clips : c’est une <b>collaboration commerciale</b>. Indique-le clairement : active « Contenu de marque » sur TikTok ou « Partenariat rémunéré » sur Instagram, ou écris « Collaboration commerciale » dans la vidéo.</li>
          <li>Uniquement des vues réelles : vues achetées, robots ou faux comptes = vidéo refusée et clips retirés.</li>
          <li>Tu respectes les droits : ta propre vidéo, ou un clip fait avec l’accord du créateur.</li>
          <li>Les vues comptent à partir de ${nf(c.minViews)}. Plafond : ${c.maxPerVideo} clips par vidéo et ${c.maxPerMonth} clips par mois. Réservé aux 18 ans et plus.</li>
          <li>Tu peux redemander un comptage ${c.recountDays} jours après chaque vérification, si ta vidéo continue de faire des vues.</li>
        </ul></details>
        <div class="ref-link"><input type="url" id="ugcUrl" placeholder="https://www.tiktok.com/@toncompte/video/…" aria-label="Lien de ta vidéo TikTok ou Reels"><button class="btn primary sm" id="ugcSend">Envoyer</button></div>
        <label class="check"><input type="checkbox" id="ugcAccept"> <span>J’ai 18 ans ou plus et ma vidéo respecte les règles ci-dessus, mention de collaboration commerciale comprise.</span></label>
        <div class="ref-stats"><div><b>${nf(r.submissions.length)}</b><span>vidéos envoyées</span></div><div><b>${nf(r.submissions.filter((x) => x.status === 'approved').length)}</b><span>validées</span></div><div><b>${nf(r.earned)}</b><span>clips gagnés</span></div></div>
        ${r.submissions.length ? `<div class="ugc-list">${r.submissions.map((x) => `<div class="ugc-item">
          <div class="meta"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(PLATFORM[x.platform] || x.platform)} · ${esc(new Date(x.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString(LOC))}</a>
          <span class="hint">${x.status === 'approved' ? `${nf(x.views)} vues comptées · ${nf(x.credits)} clips gagnés` : x.status === 'rejected' ? esc(x.note || '') : 'Vérification sous 48 h environ'}</span></div>
          <span class="status ${x.status === 'approved' ? 'done' : x.status === 'rejected' ? 'error' : ''}">${esc(UGC_STATUS[x.status] || x.status)}</span>
          ${x.canRecount ? `<button class="btn ghost xs" data-recount="${esc(x.id)}">Recompter les vues</button>` : ''}
        </div>`).join('')}</div>` : ''}`;
      $('#ugcSend').addEventListener('click', async (e) => {
        const url = $('#ugcUrl').value.trim();
        if (!url) { toast('Colle d’abord le lien de ta vidéo.'); return; }
        e.target.disabled = true;
        try { await api('api/ugc', { method: 'POST', body: { url, accept: $('#ugcAccept').checked } }); toast('Vidéo envoyée ! On vérifie ses vues et tu reçois tes clips.', 5000); renderUgc(); }
        catch (err) { toast(err.message, 6000); e.target.disabled = false; }
      });
      $$('[data-recount]', box).forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await api(`api/ugc/${b.dataset.recount}/recount`, { method: 'POST', body: {} }); toast('C’est noté : on recompte les vues de ta vidéo.'); renderUgc(); }
        catch (err) { toast(err.message, 5000); b.disabled = false; }
      }));
    } catch { box.classList.add('hidden'); }
  }

  async function renderReferral() {
    const box = $('#refCard'); if (!box || !S.user) return;
    box.classList.remove('hidden');
    try {
      const r = await api('api/referral');
      box.innerHTML = `
        <h3>🎁 Parraine tes amis</h3>
        <p class="hint">Partage ton lien : quand un ami s’inscrit et crée son premier clip, vous gagnez <b>${r.reward} clips chacun</b>.</p>
        <div class="ref-link"><input readonly value="${esc(r.link)}" id="refLink" aria-label="Ton lien de parrainage"><button class="btn primary sm" id="refCopy">Copier</button></div>
        <div class="ref-stats"><div><b>${r.invited}</b><span>inscrits</span></div><div><b>${r.validated}</b><span>validés</span></div><div><b>${r.earned}</b><span>clips gagnés</span></div></div>`;
      $('#refCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(r.link); toast('Lien copié : partage-le à tes amis !'); } catch { $('#refLink').select(); toast('Sélectionne le lien et copie-le.'); } });
    } catch { box.classList.add('hidden'); }
  }

  // ---------------------------------------------------------------- admin
  const nf = (n) => Number(n || 0).toLocaleString(LOC);
  const mb = (b) => b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} Go` : `${Math.round(b / 1048576)} Mo`;
  const LAYOUT_NAMES = () => Object.fromEntries(Object.entries(L.LAYOUTS).map(([k, v]) => [k, v.label]));

  function barChart(id, title, sub, data, fmtV = nf) {
    const W = 560, H = 150, padB = 18, padT = 8, n = data.length;
    const max = Math.max(1, ...data.map((d) => d.n));
    const step = W / n, bw = Math.max(4, step - 6);
    const y = (v) => padT + (H - padB - padT) * (1 - v / max);
    const bars = data.map((d, i) => {
      const x = i * step + (step - bw) / 2, top = y(d.n), h = H - padB - top;
      const r = Math.min(4, h / 2, bw / 2);
      const path = h > 0.5 ? `M${x},${H - padB} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${H - padB} Z` : '';
      const label = new Date(d.day + 'T12:00:00').toLocaleDateString(LOC, { day: 'numeric', month: 'short' });
      return `<g data-i="${i}" data-l="${esc(label)}" data-v="${esc(fmtV(d.n))}"><path class="bar" d="${path}"/><rect class="hit" x="${i * step}" y="0" width="${step}" height="${H}"/>${i % 3 === 0 || i === n - 1 ? `<text class="axis" x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${esc(label)}</text>` : ''}</g>`;
    }).join('');
    return `<div class="chart-card" id="${id}"><h4>${esc(title)}</h4><p class="sub">${esc(sub)}</p>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}"><line class="grid" x1="0" x2="${W}" y1="${y(max)}" y2="${y(max)}"/><text class="axis" x="0" y="${y(max) - 2}">${esc(fmtV(max))}</text><line class="grid" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>${bars}</svg>
      <div class="ctip hidden"></div></div>`;
  }
  function bindChart(id) {
    const card = $('#' + id); if (!card) return;
    const tip = $('.ctip', card);
    $$('g[data-i]', card).forEach((g) => {
      g.addEventListener('mouseenter', () => {
        $$('.bar.on', card).forEach((b) => b.classList.remove('on')); $('.bar', g).classList.add('on');
        const r = $('.hit', g).getBoundingClientRect(), c = card.getBoundingClientRect();
        tip.innerHTML = `${esc(g.dataset.l)} · <b>${esc(g.dataset.v)}</b>`;
        tip.style.left = `${r.left - c.left + r.width / 2}px`; tip.style.top = `${$('.bar', g).getBoundingClientRect().top - c.top || 60}px`;
        tip.classList.remove('hidden');
      });
    });
    card.addEventListener('mouseleave', () => { tip.classList.add('hidden'); $$('.bar.on', card).forEach((b) => b.classList.remove('on')); });
  }

  async function renderAdmin() {
    const box = $('#admBody');
    if (!S._admBound) {
      S._admBound = true;
      $('#admRefresh').addEventListener('click', renderAdmin);
      $('#admGo').addEventListener('click', searchAdminUsers);
      $('#bgAdd').addEventListener('click', addBackground);
      $$('#ugcFilter button').forEach((b) => b.addEventListener('click', () => { $$('#ugcFilter button').forEach((x) => x.classList.toggle('active', x === b)); S.ugcStatus = b.dataset.s; renderAdminUgc(); }));
      renderAdminBgs();
      $('#admQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchAdminUsers(); });
      searchAdminUsers();
    }
    renderAdminUgc();
    renderAdminChallenges();
    renderAdminMail();
    try {
      const d = await api('api/admin/stats');
      const h = d.health, names = LAYOUT_NAMES();
      const tiles = (arr) => `<div class="tiles">${arr.map(([v, k, warn]) => `<div class="tile ${warn ? 'warn' : ''}"><div class="v">${v}</div><div class="k">${esc(k)}</div></div>`).join('')}</div>`;
      box.innerHTML = `
        <h3 class="adm-h">Inscrits et activité</h3>
        ${tiles([[nf(d.users.total), 'comptes au total'], [nf(d.users.today), 'inscrits aujourd’hui'], [nf(d.users.week), 'inscrits sur 7 jours'], [nf(d.users.referred), 'venus par parrainage'], [nf(d.users.ugcPending), 'vidéos créateurs à vérifier', d.users.ugcPending > 0], [nf(d.activity.jobs), 'vidéos analysées'], [nf(d.activity.clips), 'clips créés'], [nf(d.activity.clipsWeek), 'clips sur 7 jours']])}
        <div class="charts2">${barChart('chU', 'Inscriptions par jour', '14 derniers jours', d.users.perDay)}${barChart('chC', 'Clips créés par jour', '14 derniers jours', d.activity.clipsPerDay)}</div>
        ${d.activity.topLayouts.length ? `<div class="card" style="margin-top:12px"><b>Formats les plus utilisés</b><table class="adm-table"><tbody>${d.activity.topLayouts.map((t) => `<tr><td>${esc(names[t.layout] || t.layout)}</td><td>${nf(t.n)} clip${t.n > 1 ? 's' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <h3 class="adm-h">Argent</h3>
        ${tiles([[nf(d.money.pro), 'abonnés Pro'], [nf(d.money.creator), 'abonnés Créateur'], [eur(d.money.mrr), 'revenu mensuel des abonnements (estimé)'], [nf(d.money.packsMonth), 'packs vendus ce mois'], [eur(d.money.packsRevenueMonth), 'revenu des packs ce mois']])}
        <p class="hint">Estimation au prix plein, hors réductions et frais Stripe. Les montants exacts sont dans ton tableau de bord Stripe.</p>
        <h3 class="adm-h">Santé du serveur</h3>
        ${tiles([[`${h.queue.running}/${h.queue.max}`, 'traitements en cours'], [nf(h.queue.waiting), 'en file d’attente', h.queue.waiting > 5], [nf(h.failed24h), 'exports en échec (24 h)', h.failed24h > 0], [nf(h.jobsFailed24h), 'analyses en échec (24 h)', h.jobsFailed24h > 3], [mb(h.mediaBytes), 'vidéos stockées'], [h.disk ? mb(h.disk.free) : '—', 'espace disque libre', h.disk && h.disk.free < 1073741824], [`${h.memoryMb} Mo`, 'mémoire utilisée', h.memoryMb > 400], [`${h.uptimeH} h`, 'depuis le dernier démarrage']])}
        ${h.lastJobErrors?.length ? `<div class="card" style="margin-top:12px"><b>Dernières analyses en échec</b><div class="table-scroll"><table class="adm-table"><thead><tr><th>Date</th><th>Compte</th><th>Source</th><th>Raison</th></tr></thead><tbody>${h.lastJobErrors.map((e) => `<tr><td class="bad-dot nowrap">${esc(new Date(e.at.replace(' ', 'T') + 'Z').toLocaleString(LOC))}</td><td>${esc(e.email || '—')}</td><td>${/^https?:/.test(e.source) ? `<a href="${esc(e.source)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(e.source))} ↗</a>` : esc(e.source)}</td><td>${esc(e.reason)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
        ${h.lastErrors.length ? `<div class="card" style="margin-top:12px"><b>Dernières erreurs d’export</b><table class="adm-table"><tbody>${h.lastErrors.map((e) => `<tr><td class="bad-dot">${esc(new Date(e.created_at.replace(' ', 'T') + 'Z').toLocaleString(LOC))}</td><td>${esc(e.message || '')}</td></tr>`).join('')}</tbody></table></div>` : `<p class="hint ok-dot">Aucune erreur d’export récente.</p>`}`;
      bindChart('chU'); bindChart('chC');
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  async function renderAdminMail() {
    const box = $('#admMail'); if (!box) return;
    try {
      const m = await api('api/admin/mail');
      box.innerHTML = m.enabled
        ? `<div class="tiles">${[[nf(m.today) + ' / ' + nf(m.limit), 'e-mails envoyés sur 24 h'], [nf(m.week), 'e-mails sur 7 jours'], [nf(m.optedOut), 'désinscrits des conseils']].map(([v, k]) => `<div class="tile"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join('')}</div>
           <p class="hint">Envoi depuis ${esc(m.from)} via Brevo. <button class="btn ghost xs" id="mailTest">Envoyer un e-mail de test</button></p>`
        : '<p class="hint warn-dot">E-mails désactivés : ajoute <b>BREVO_API_KEY</b> et <b>MAIL_FROM</b> dans les variables d’environnement Render pour les activer.</p>';
      $('#mailTest')?.addEventListener('click', async (e) => { e.target.disabled = true; try { const r = await api('api/admin/mail/test', { method: 'POST', body: {} }); toast(`E-mail de test envoyé à ${r.to}.`, 5000); } catch (err) { toast(err.message, 6000); } e.target.disabled = false; });
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  async function renderAdminUgc() {
    const box = $('#admUgc'); if (!box) return;
    const st = S.ugcStatus || 'pending';
    try {
      const { submissions, config: c } = await api('api/admin/ugc?status=' + st);
      if (!submissions.length) { box.innerHTML = `<p class="hint">${st === 'pending' ? 'Aucune vidéo à vérifier.' : 'Aucune vidéo.'}</p>`; return; }
      box.innerHTML = `<table class="adm-table"><thead><tr><th>Compte</th><th>Vidéo</th><th class="opt">Envoyée le</th><th>Déjà compté</th><th>Décision</th></tr></thead><tbody>${submissions.map((x) => `
        <tr data-id="${esc(x.id)}"><td>${esc(x.email)}<br><span class="hint">${nf(x.earnedMonth)} / ${nf(c.maxPerMonth)} clips ce mois</span></td>
        <td><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(PLATFORM[x.platform] || x.platform)} ↗</a>${x.recount ? '<br><span class="hint">nouveau comptage</span>' : ''}${x.note ? `<br><span class="hint">${esc(x.note)}</span>` : ''}</td>
        <td class="opt">${esc(new Date(x.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString(LOC))}</td>
        <td>${nf(x.views)} vues<br><span class="hint">${nf(x.credits)} clips versés</span></td>
        <td><div class="adm-act"><input type="number" min="0" step="100" value="${x.views || ''}" placeholder="Vues" aria-label="Nombre de vues constaté"><button class="btn primary xs" data-ok>Valider</button><button class="btn ghost xs" data-no>Refuser</button></div></td></tr>`).join('')}</tbody></table>
        <p class="hint">Barème : ${c.per1000} clip(s) pour 1 000 vues dès ${nf(c.minViews)} vues, ${c.maxPerVideo} clips max par vidéo, ${c.maxPerMonth} par compte sur 30 jours.</p>`;
      $$('tr[data-id]', box).forEach((tr) => {
        $('[data-ok]', tr).addEventListener('click', async () => {
          const views = $('input', tr).value;
          if (views === '') { toast('Indique le nombre de vues de la vidéo.'); return; }
          try { const r = await api('api/admin/ugc/' + tr.dataset.id, { method: 'POST', body: { approve: true, views: +views } }); toast(r.submission.granted ? `Validée : ${r.submission.granted} clips versés${r.submission.capped ? ' (plafond mensuel atteint)' : ''}.` : 'Validée : rien de plus à verser pour l’instant.', 5000); renderAdminUgc(); }
          catch (e) { toast(e.message); }
        });
        $('[data-no]', tr).addEventListener('click', async () => {
          const note = prompt('Raison du refus (visible par l’utilisateur) :', 'Mention de collaboration commerciale absente.');
          if (note === null) return;
          try { await api('api/admin/ugc/' + tr.dataset.id, { method: 'POST', body: { approve: false, note } }); toast('Vidéo refusée.'); renderAdminUgc(); }
          catch (e) { toast(e.message); }
        });
      });
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  async function renderAdminBgs() {
    const box = $('#admBg');
    try {
      const { backgrounds } = await api('api/admin/backgrounds');
      S.bgs = null; // la liste publique sera rechargée
      box.innerHTML = backgrounds.length ? backgrounds.map((b) => `<div class="bg-item"><button class="del" data-del="${esc(b.id)}" title="Retirer" aria-label="Retirer ${esc(b.name)}">✕</button>${b.thumb ? `<img src="${esc(b.thumb)}" alt="">` : '<div class="ph"></div>'}<span>${esc(b.name)}</span><span class="st">${b.status === 'ready' ? `✅ Prête · ${Math.round(b.duration || 0)} s` : b.status === 'error' ? `⚠️ ${esc(b.message || 'Échec')}` : '⏳ Conversion en cours…'}</span></div>`).join('') : '<p class="hint">La bibliothèque est vide.</p>';
      $$('[data-del]', box).forEach((el) => el.addEventListener('click', async () => { await api('api/admin/backgrounds/' + el.dataset.del, { method: 'DELETE' }).catch(() => {}); renderAdminBgs(); }));
      if (backgrounds.some((b) => b.status === 'processing')) { clearTimeout(S._bgT); S._bgT = setTimeout(() => { if (location.hash === '#admin') renderAdminBgs(); }, 4000); }
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  async function addBackground() {
    const url = $('#bgUrl').value.trim(), name = $('#bgName').value.trim();
    if (!url) { toast('Colle d’abord le lien de la vidéo.'); return; }
    try { await api('api/admin/backgrounds', { method: 'POST', body: { url, name: name || 'Vidéo satisfaisante', source: url } }); $('#bgUrl').value = ''; $('#bgName').value = ''; toast('Vidéo ajoutée : conversion en cours…'); renderAdminBgs(); }
    catch (e) { toast(e.message, 5000); }
  }

  async function searchAdminUsers() {
    const box = $('#admUsers');
    try {
      const { users } = await api('api/admin/users?q=' + encodeURIComponent($('#admQ').value));
      if (!users.length) { box.innerHTML = '<p class="hint">Aucun compte trouvé.</p>'; return; }
      box.innerHTML = `<table class="adm-table"><thead><tr><th>E-mail</th><th>Offre</th><th>Crédits</th><th class="opt">Clips</th><th class="opt">Inscrit le</th><th>Actions</th></tr></thead><tbody>${users.map((u) => `
        <tr data-id="${esc(u.id)}"><td>${esc(u.email)}</td><td>${esc(u.plan)}${u.subscribed ? ' 💳' : ''}</td><td>${nf(u.credits)}</td><td class="opt">${nf(u.clips)}</td><td class="opt">${esc(new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(LOC))}</td>
        <td><div class="adm-act"><input type="number" value="5" step="1" aria-label="Crédits à offrir"><select aria-label="Offre"><option value="">offre…</option><option value="free">Gratuit</option><option value="pro">Pro</option><option value="creator">Créateur</option></select><button class="btn ghost xs">Appliquer</button></div></td></tr>`).join('')}</tbody></table>
        <p class="hint">💳 = abonnement Stripe actif. Changer l’offre ici l’offre sans paiement (geste commercial).</p>`;
      $$('tr[data-id]', box).forEach((tr) => $('button', tr).addEventListener('click', async () => {
        const credits = +$('input', tr).value || 0, plan = $('select', tr).value || undefined;
        try { await api('api/admin/users/' + tr.dataset.id, { method: 'POST', body: { credits, plan } }); toast('Compte mis à jour.'); searchAdminUsers(); }
        catch (e) { toast(e.message); }
      }));
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  boot();
})();
