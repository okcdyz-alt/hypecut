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
    local: null, ex: null, stopAt: null, lastLayout: 'game_full', camRect: null, corner: 'tl',
    claude: { sample: null, downloads: null },
  };

  // ---------------------------------------------------------------- utilitaires
  const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };
  const eur = (c) => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let toastT;
  function toast(msg, ms = 3800) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms); }

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const r = await fetch(path, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `Erreur ${r.status}`); e.status = r.status; e.upgrade = j.upgrade; throw e; }
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
      { id: 'pro', name: 'Pro', price: 799, launchPrice: 399, credits: 100, perks: ['100 clips par mois', '1080p sans filigrane', 'Vidéos jusqu’à 2 h', 'Titres, légendes et hashtags automatiques', 'Tous les formats caméra', 'Recadrage IA qui suit l’action'] },
      { id: 'creator', name: 'Créateur', price: 1999, credits: 400, perks: ['400 clips par mois', '1080p 60 i/s, qualité maximale', 'VOD jusqu’à 6 h', 'Tout Pro inclus', 'File d’attente prioritaire', 'Export de tous les clips en un clic', 'Sous-titres automatiques (bientôt)'] },
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
    const p = new URLSearchParams(location.search).get('paiement');
    if (p === 'ok') toast('Paiement confirmé, merci ! Ton offre est active.', 6000);
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
      bar.innerHTML = `🎮 Pass lancement GTA VI : toutes les fonctions Pro offertes jusqu’au ${new Date(l.pass.ends).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} · ${l.pass.credits} clips gratuits en 1080p, sans filigrane, avec formats caméra et titres IA · <a href="#creer">J’en profite</a>`;
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
    if (u) pill.textContent = `${u.credits} crédit${u.credits > 1 ? 's' : ''} · ${u.planName}`;
    renderPlans();
  }

  // ---------------------------------------------------------------- navigation
  function route() {
    const h = (location.hash || '#creer').slice(1);
    let view = h;
    if (h.startsWith('analyse-')) { view = 'creer'; const id = h.slice(8); if (id !== S.jobId) loadJob(id); }
    if (!['creer', 'mes-clips', 'offres', 'compte'].includes(view)) view = 'creer';
    if (S.mode === 'demo' && ['mes-clips', 'compte'].includes(view)) view = 'creer';
    $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + view));
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    if (view === 'mes-clips') renderHistory();
    if (view === 'compte') renderAccount();
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
    $('#btnAnalyze').addEventListener('click', startAnalysis);
    $('#btnNew').addEventListener('click', () => { resetWorkspace(); location.hash = '#creer'; window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#btnExportAll').addEventListener('click', exportAll);
    $('#btnAiAll').addEventListener('click', demoAiTitles);
    $('#btnLogin').addEventListener('click', () => openAuth('signup'));
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-auth]')) { e.preventDefault(); openAuth('login'); }
      if (e.target.matches('[data-close]') || e.target.classList.contains('modal')) closeModals();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

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
    $('#showTitle').addEventListener('change', (e) => { S.ex.showTitle = e.target.checked; drawPreview(); });
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
      const r = await api(`api/auth/${authMode}`, { method: 'POST', body: { email: $('#authEmail').value, password: $('#authPass').value } });
      S.user = r.user; renderHeader(); closeModals();
      toast(authMode === 'signup' ? `Bienvenue ! Tu as ${r.user.credits} crédits pour essayer.` : 'Connecté.');
      if (S.result) renderWorkspace();
    } catch (err) { $('#authErr').textContent = err.message; }
    btn.disabled = false;
  }
  function closeModals() { $$('.modal').forEach((m) => m.classList.add('hidden')); }

  // ---------------------------------------------------------------- lancement d'une analyse
  function analysisParams() { return { clipLen: +$('#clipLen').value, count: +$('#count').value, priority: $('#priority').value }; }

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
          if (!r.ok) { const e = new Error(j.error || `Erreur ${r.status}`); e.status = r.status; e.upgrade = j.upgrade; throw e; }
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
        if (j.status === 'error') { hideProgress(); $('#sourceErr').textContent = j.message || 'L’analyse a échoué.'; return; }
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
    hideProgress();
    const p = $('#player'); p.pause(); p.removeAttribute('src'); p.load();
  }

  function initClips() {
    S.clips = S.result.clips.map((c, i) => ({ start: c.start, end: c.end, title: c.ai?.titre || `Moment fort n°${i + 1}` }));
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
    S.result = { duration, step, series: res.series, clips: res.clips, width: v.videoWidth, height: v.videoHeight, previewUrl: url, frameUrl: res.clips[0]?.thumb };
    S.job = { title: file.name.replace(/\.[^.]+$/, ''), status: 'done' };
    hideProgress();
    initClips();
    renderWorkspace();
  }

  // ---------------------------------------------------------------- espace de travail
  function renderWorkspace() {
    const r = S.result; if (!r) return;
    $('#workspace').classList.remove('hidden');
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

  function layoutAllowed(key) {
    const Lk = L.LAYOUTS[key];
    if (S.mode === 'demo') return Lk.serverOnly ? 'hide' : 'ok';
    if (Lk.serverOnly && !S.cfg.services?.cloudinary) return 'hide';
    const f = S.user?.features;
    if (!f) return Lk.tier === 'free' ? 'ok' : 'lock';
    if (key === 'game_ai') return f.smartCrop ? 'ok' : 'lock';
    if (Lk.tier === 'pro' && !f.camLayouts) return 'lock';
    return 'ok';
  }

  function layoutIcon(key) {
    const c = L.compose(key, 1600, 900, { res: 90, corner: 'tl', camRect: { x: 0.02, y: 0.03, w: 0.26, h: 0.3 } });
    const parts = c.ops.map((o) => {
      const fill = o.kind === 'fill' ? (o.color === '#ffffff' ? '#fff' : '#000') : o.role === 'cam' ? '#2ee6d6' : o.role === 'bg' ? '#4a3b66' : '#ff3d8b';
      const d = o.dst;
      return o.shape === 'circle' ? `<circle cx="${d.x + d.w / 2}" cy="${d.y + d.h / 2}" r="${d.w / 2}" fill="${fill}"/>` : `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" fill="${fill}" ${o.role === 'game' ? 'opacity=".85"' : ''}/>`;
    }).join('');
    return `<svg viewBox="0 0 ${c.W} ${c.H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect width="${c.W}" height="${c.H}" fill="#000"/>${parts}</svg>`;
  }

  async function openExport(i) {
    if (S.mode === 'server' && !S.user) { openAuth('signup'); return; }
    const c = S.result.clips[i], st = S.clips[i];
    let layout = S.lastLayout;
    if (layoutAllowed(layout) !== 'ok') layout = 'game_full';
    S.ex = { idx: i, layout, start: st.start, end: st.end, title: st.title, showTitle: true, focusX: 0.5, corner: S.corner, camRect: S.camRect || { x: 0.02, y: 0.03, w: 0.26, h: 0.3 }, img: null, frame: null, busy: false };
    $('#titleInput').value = st.title; $('#showTitle').checked = true; $('#focusX').value = 0.5;
    $('#exErr').innerHTML = ''; $('#exResult').classList.add('hidden');
    ['#exDownload', '#exSave', '#exCopy', '#exVideo'].forEach((s) => $(s).classList.add('hidden'));
    $('#btnDoExport').disabled = false;
    $('#exTitle').textContent = `Créer le clip n°${i + 1}`;
    const grid = $('#layoutGrid');
    grid.innerHTML = Object.keys(L.LAYOUTS).filter((k) => layoutAllowed(k) !== 'hide').map((k) => {
      const st2 = layoutAllowed(k);
      return `<button class="lay ${st2 === 'lock' ? 'locked' : ''}" data-lay="${k}" title="${esc(L.LAYOUTS[k].desc)}">${st2 === 'lock' ? '<span class="lk">🔒 PRO</span>' : ''}${layoutIcon(k)}<b>${esc(L.LAYOUTS[k].label)}</b></button>`;
    }).join('');
    $$('.lay', grid).forEach((b) => b.addEventListener('click', () => {
      if (layoutAllowed(b.dataset.lay) === 'lock') { $('#exErr').innerHTML = 'Ce format est inclus dans les offres Pro et Créateur. <a href="#offres" data-close>Voir les offres</a>'; return; }
      $('#exErr').innerHTML = '';
      S.ex.layout = S.lastLayout = b.dataset.lay; syncLayout(); drawPreview();
    }));
    $('#exportModal').classList.remove('hidden');
    syncLayout(); syncTimes(); syncCorner(); syncQuality();
    S.ex.img = await loadImg(c.thumb);
    S.ex.frame = await loadImg(S.mode === 'server' ? S.result.frameUrl : c.thumb);
    $('#camImg').src = S.ex.frame?.src || '';
    drawCamRect(); drawPreview();
  }

  function syncLayout() {
    $$('.lay').forEach((b) => b.classList.toggle('active', b.dataset.lay === S.ex.layout));
    const Lk = L.LAYOUTS[S.ex.layout];
    $('#camBox').classList.toggle('hidden', !Lk.cam);
    $('#cornerBox').classList.toggle('hidden', !['cam_bubble', 'cam_pip'].includes(S.ex.layout));
    $('#focusBox').classList.toggle('hidden', ['game_blur', 'landscape', 'game_ai'].includes(S.ex.layout));
    $('#exPrevHint').textContent = S.ex.layout === 'game_ai' ? 'Le cadre suivra automatiquement l’action pendant le clip' : 'Aperçu du cadrage';
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
  function drawComp(ctx, comp, src, lines, watermark) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, comp.W, comp.H);
    for (const op of comp.ops) {
      ctx.save();
      if (op.shape === 'circle') { ctx.beginPath(); ctx.arc(op.dst.x + op.dst.w / 2, op.dst.y + op.dst.h / 2, op.dst.w / 2, 0, Math.PI * 2); ctx.clip(); }
      if (op.kind === 'video') {
        if (op.effect === 'blur') ctx.filter = `blur(${Math.round(comp.W / 30)}px) brightness(0.9) saturate(1.15)`;
        ctx.drawImage(src, op.src.x, op.src.y, op.src.w, op.src.h, op.dst.x, op.dst.y, op.dst.w, op.dst.h);
      } else { ctx.fillStyle = op.color; ctx.fillRect(op.dst.x, op.dst.y, op.dst.w, op.dst.h); }
      ctx.restore();
    }
    const { W, H } = comp;
    if (lines && lines.length) {
      const fs = Math.round(W * (W > H ? 0.045 : 0.068)), lh = Math.round(fs * 1.32), pad = Math.round(fs * 0.28);
      const blockH = lh * lines.length;
      let y0 = comp.title.anchor === 'center' ? comp.title.y - blockH / 2 : comp.title.y;
      y0 = Math.max(8, Math.min(H - blockH - 8, y0));
      ctx.font = `${fs}px Anton, Impact, "Arial Black", sans-serif`; ctx.textBaseline = 'top';
      lines.forEach((line, i) => {
        const w = ctx.measureText(line).width, x = (W - w) / 2, y = y0 + i * lh;
        ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(x - pad, y - pad * 0.6, w + pad * 2, fs * 1.15 + pad * 1.2);
        ctx.fillStyle = '#fff'; ctx.fillText(line, x, y);
      });
    }
    if (watermark) {
      const fs = Math.round(Math.min(W, H) * 0.045);
      ctx.font = `${fs}px Anton, Impact, sans-serif`; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; const tw = ctx.measureText('HYPECUT').width;
      const x = W - tw - W * 0.04, y = H - H * (W < H ? 0.13 : 0.05);
      ctx.fillText('HYPECUT', x + 2, y + 2); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText('HYPECUT', x, y);
    }
  }
  const titleLinesFor = (layout, title) => L.wrapTitle(title, layout === 'landscape' ? 34 : layout === 'square' ? 24 : 20);
  const wantsWatermark = () => (S.mode === 'demo' ? true : !!S.user?.features?.watermark);

  function drawPreview() {
    const ex = S.ex; if (!ex || !ex.img) return;
    const comp = L.compose(ex.layout === 'game_ai' ? 'game_full' : ex.layout, ex.img.naturalWidth, ex.img.naturalHeight, previewOpts());
    const cv = $('#exCanvas'); cv.width = comp.W; cv.height = comp.H;
    drawComp(cv.getContext('2d'), comp, ex.img, ex.showTitle ? titleLinesFor(ex.layout, ex.title) : [], wantsWatermark());
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
    const body = { clipIdx: ex.idx, layout: ex.layout, start: ex.start, end: ex.end, camRect: ex.camRect, corner: ex.corner, focusX: ex.focusX, title: ex.title, showTitle: ex.showTitle };
    const r = await api(`api/jobs/${S.jobId}/export`, { method: 'POST', body });
    S.user = r.user; renderHeader(); syncQuality();
    const id = r.ids[0];
    const LBL = { queued: 'En file d’attente', rendering: 'Montage du clip', uploading: 'Mise en ligne', ai_crop: 'Recadrage IA en cours' };
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
        $('#exMsg').textContent = 'Ton clip est prêt ! 🎉';
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
      const layout = layoutAllowed(S.lastLayout) === 'ok' ? S.lastLayout : 'game_full';
      const r = await api(`api/jobs/${S.jobId}/export`, { method: 'POST', body: { all: true, layout, camRect: S.camRect, corner: S.corner, focusX: 0.5, useAiTitles: true } });
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
    drawComp(ctx, comp, v, lines, true);
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
        drawComp(ctx, comp, v, lines, true);
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
        p = { ...p, name: 'Pass lancement GTA VI', perks: [`${pass.credits} clips offerts`, 'Sans filigrane', 'Tous les formats caméra', 'Titres, légendes et hashtags automatiques', 'Vidéos jusqu’à 2 h', `Jusqu’au ${new Date(pass.ends).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`] };
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
        <span class="hint">${new Date(j.createdAt.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}${j.clipCount ? ` · ${j.clipCount} clips` : ''}${j.duration ? ` · ${fmt(j.duration)}` : ''}</span></div>
        <span class="status ${j.status === 'done' ? 'done' : j.status === 'error' ? 'error' : ''}">${esc(STATUS[j.status] || j.status)}</span></a>`).join('');
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  function renderAccount() {
    const box = $('#accountCard'); const u = S.user;
    if (!u) { box.innerHTML = '<p>Tu n’es pas connecté.</p><button class="btn primary" data-open-auth>Se connecter</button>'; return; }
    box.innerHTML = `
      <div class="kv"><span>E-mail</span><b>${esc(u.email)}</b></div>
      <div class="kv"><span>Offre</span><b>${esc(u.planName)}</b></div>
      <div class="kv"><span>Crédits restants</span><b>${u.credits}</b></div>
      ${u.periodEnd ? `<div class="kv"><span>Renouvellement</span><b>${new Date(u.periodEnd).toLocaleDateString('fr-FR')}</b></div>` : ''}
      <div class="kv"><span>Qualité d’export</span><b>${u.features.res}p ${u.features.fps} i/s${u.features.watermark ? ' · filigrane' : ''}</b></div>
      <div class="row">
        ${u.subscribed ? '<button class="btn ghost" id="btnPortal">Gérer mon abonnement</button>' : '<a class="btn primary" href="#offres">Passer à Pro</a>'}
        <button class="btn ghost" id="btnLogout">Se déconnecter</button>
      </div>`;
    $('#btnLogout').addEventListener('click', async () => { await api('api/auth/logout', { method: 'POST' }).catch(() => {}); S.user = null; renderHeader(); resetWorkspace(); location.hash = '#creer'; toast('Déconnecté.'); });
    $('#btnPortal')?.addEventListener('click', async (e) => { e.target.disabled = true; try { location.href = (await api('api/billing/portal', { method: 'POST' })).url; } catch (err) { toast(err.message); e.target.disabled = false; } });
  }

  boot();
})();
