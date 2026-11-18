window.hcGet = function (id) {
  return new Promise((res, rej) => {
    const go = () => {
      const h = ev => {
        if (ev.origin !== 'https://hypecut-h6pu.onrender.com' || !ev.data || ev.data.type !== 'hc-file' || ev.data.id !== id) return;
        window.removeEventListener('message', h);
        if (ev.data.error) rej(new Error(ev.data.error)); else res(new File([ev.data.buf], 'HYPECUT_' + id + '.mp4', { type: 'video/mp4' }));
      };
      window.addEventListener('message', h);
      window.__hcFrame.contentWindow.postMessage({ type: 'hc-get', id, url: 'https://raw.githubusercontent.com/okcdyz-alt/hypecut/promo-videos/HYPECUT_' + id + '.mp4' }, 'https://hypecut-h6pu.onrender.com');
      setTimeout(() => rej(new Error('timeout')), 90000);
    };
    if (window.__hcFrame && window.__hcReady) return go();
    const f = document.createElement('iframe');
    f.style.display = 'none';
    f.src = 'https://hypecut-h6pu.onrender.com/relay.html';
    f.onload = () => { window.__hcReady = true; go(); };
    document.body.appendChild(f);
    window.__hcFrame = f;
  });
};
if (!window.__hcClickPatched) {
  const orig = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file' && window.__hcPending) { const f = window.__hcPending; window.__hcPending = null;
      const dt = new DataTransfer(); dt.items.add(f); this.files = dt.files;
      this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); window.__hcDone = true; return; }
    if (this.type === 'file') return;
    return orig.apply(this, arguments);
  };
  window.__hcClickPatched = true;
}
window.hcSleep = ms => new Promise(r => setTimeout(r, ms));
window.hcBtn = (label, root) => [...(root || document).querySelectorAll('[role=button], button, div[tabindex], span')].filter(e => e.offsetParent && e.textContent.trim() === label).pop();
window.hcClick = el => { const b = el.closest('[role=button]') || el; b.click(); return true; };
window.hcCaption = function (text) {
  const ed = document.querySelector('[contenteditable=true][aria-label^="Describe your reel"]');
  ed.focus();
  const dt = new DataTransfer(); dt.setData('text/plain', text);
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return ed.innerText.length;
};
window.hcStep1 = async function (id, caption) {
  window.__hcPending = await hcGet(id); window.__hcDone = false;
  hcClick(hcBtn('Add Video'));
  await hcSleep(800);
  if (!window.__hcDone) throw new Error('inject failed');
  for (let i = 0; i < 120; i++) { await hcSleep(1000); if (document.body.innerText.includes('100%')) break; }
  await hcSleep(500);
  hcCaption(caption);
  await hcSleep(500);
  document.body.click();
  for (let i = 0; i < 60; i++) { if (/safe to publish|No copyright issues/.test(document.body.innerText)) break; await hcSleep(1000); }
  return document.body.innerText.includes('100%') ? 'uploaded' : 'not-100';
};
window.hcSpin = async function (label, target) {
  const el = document.querySelector('input[role=spinbutton][aria-label="' + label + '"]');
  el.focus();
  const val = () => label === 'meridiem' ? el.getAttribute('aria-valuetext') : +el.getAttribute('aria-valuenow');
  for (let i = 0; i < 70 && val() !== target; i++) {
    let key = 'ArrowUp';
    if (label !== 'meridiem' && val() > target) key = 'ArrowDown';
    const kc = key === 'ArrowUp' ? 38 : 40;
    el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode: kc, which: kc, bubbles: true, cancelable: true }));
    await hcSleep(30);
  }
  return val();
};
window.hcTime = async function (h24, m) {
  const mer = h24 >= 12 ? 'PM' : 'AM'; let h = h24 % 12; if (h === 0) h = 12;
  const a = await hcSpin('hours', h); const b = await hcSpin('minutes', m); const c = await hcSpin('meridiem', mer);
  return [a, b, c];
};
window.hcToShare = async function () {
  hcClick(hcBtn('Next')); await hcSleep(2500); hcClick(hcBtn('Next')); await hcSleep(2500);
  hcClick(hcBtn('Schedule')); await hcSleep(1500);
  return !!document.querySelector('input[role=spinbutton]');
};
window.hcSubmit = async function () {
  const bs = [...document.querySelectorAll('[role=button]')].filter(e=>e.offsetParent && e.textContent.trim()==='Schedule');
  const b = bs.sort((a,c)=>c.getBoundingClientRect().y - a.getBoundingClientRect().y)[0];
  b.click();
  for (let i=0;i<30;i++){ await hcSleep(1000); if (/scheduled_posts|published_posts/.test(location.href)) return location.pathname; }
  return 'stuck: ' + (document.body.innerText.match(/(error|wrong|try again)[^\n]*/i)||[''])[0];
};
window.hcPrep = function (id, caption) {
  window.__hcStatus = 'running';
  (async () => { try { const u = await hcStep1(id, caption); const s = await hcToShare(); window.__hcStatus = u + '/' + s; } catch (e) { window.__hcStatus = 'ERR ' + e.message; } })();
  return 'started';
};

window.hcDate = async function (label) {
  let b = document.querySelector('[role=button][aria-label="' + label + '"]');
  if (!b) { const inp = document.querySelector('input[placeholder="mm/dd/yyyy"]'); inp.click(); inp.focus(); await hcSleep(600); b = document.querySelector('[role=button][aria-label="' + label + '"]'); }
  if (!b) return 'no day';
  b.click(); await hcSleep(500);
  return document.querySelector('input[placeholder="mm/dd/yyyy"]').value;
};
window.HC_JOBS = [{"id": "g06", "label": "Thursday, 19 November 2026", "h": 10, "m": 30, "cap": "Streamer GTA VI ? Tes meilleurs moments dorment dans tes VOD 😴\n\nLien en bio 🎮\n\n#gta6 #gtavi #gaming #streamer #clipping #reelsfrance", "when": "Thu 19 10:30"}, {"id": "a04", "label": "Thursday, 19 November 2026", "h": 12, "m": 15, "cap": "Objectif 100 $ ce mois-ci : voilà ce que ça demande vraiment 🎯 (exemple)\n\nLien en bio pour tester gratuitement 🔗\n\n#clipping #argentenligne #sidehustle #revenuscomplementaires #reelsfrance #gta6", "when": "Thu 19 12:15"}, {"id": "g03", "label": "Thursday, 19 November 2026", "h": 13, "m": 30, "cap": "Le défi GTA VI de la semaine : 30, 15 et 5 clips à gagner 🏆 Participation gratuite\n\nLien en bio 🎮\n\n#gta6 #gtavi #gaming #streamer #clipping #reelsfrance", "when": "Thu 19 13:30"}, {"id": "f01", "label": "Thursday, 19 November 2026", "h": 14, "m": 45, "cap": "Comment l'IA trouve les moments forts d'un live ? Elle écoute ET elle regarde 👂👀\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Thu 19 14:45"}, {"id": "f03", "label": "Thursday, 19 November 2026", "h": 16, "m": 0, "cap": "Les sous-titres mot par mot, comme les gros comptes ✍️ automatiques\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Thu 19 16:00"}, {"id": "e01", "label": "Thursday, 19 November 2026", "h": 17, "m": 45, "cap": "Débuter le clipping : les 4 étapes, sans bullshit 🧭\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Thu 19 17:45"}, {"id": "m01", "label": "Thursday, 19 November 2026", "h": 19, "m": 0, "cap": "« Le clipping c'est saturé » : vraiment ? 🤔\n\nLien en bio 🔗\n\n#clipping #createurdecontenu #ia #gta6 #reelsfrance", "when": "Thu 19 19:00"}, {"id": "p07", "label": "Thursday, 19 November 2026", "h": 20, "m": 30, "cap": "100 clips par mois pour 3,99 € le premier mois (jusqu'au 30 novembre) 💸\n\nInfos et inscription : lien en bio 🔗\n\n#clipping #gta6 #bonplan #createurdecontenu #reelsfrance", "when": "Thu 19 20:30"}, {"id": "g04", "label": "Thursday, 19 November 2026", "h": 22, "m": 0, "cap": "Le format qui garde les gens jusqu'au bout : l'écran partagé satisfaisant 🌀\n\nLien en bio 🎮\n\n#gta6 #gtavi #gaming #streamer #clipping #reelsfrance", "when": "Thu 19 22:00"}, {"id": "a03", "label": "Friday, 20 November 2026", "h": 8, "m": 0, "cap": "100 000 vues sur un clip, ça paie combien ? Ça dépend de la campagne 👀 (exemples)\n\nLien en bio pour tester gratuitement 🔗\n\n#clipping #argentenligne #sidehustle #revenuscomplementaires #reelsfrance #gta6", "when": "Fri 20 08:00"}, {"id": "f05", "label": "Friday, 20 November 2026", "h": 10, "m": 30, "cap": "Ta VOD fait 8 heures ? Choisis juste le passage qui t'intéresse ⏱️\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Fri 20 10:30"}, {"id": "e03", "label": "Friday, 20 November 2026", "h": 12, "m": 15, "cap": "Clipper sans autorisation, c'est risqué. Voilà la bonne méthode ✅\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Fri 20 12:15"}, {"id": "m03", "label": "Friday, 20 November 2026", "h": 13, "m": 30, "cap": "« Le clipping c'est de l'argent facile » : non. Voilà la vérité 🙅\n\nLien en bio 🔗\n\n#clipping #createurdecontenu #ia #gta6 #reelsfrance", "when": "Fri 20 13:30"}, {"id": "p06", "label": "Friday, 20 November 2026", "h": 14, "m": 45, "cap": "Pass lancement GTA VI : 10 clips avec toutes les fonctions Pro, gratuits jusqu'au 26 novembre 🎟️\n\nInfos et inscription : lien en bio 🔗\n\n#clipping #gta6 #bonplan #createurdecontenu #reelsfrance", "when": "Fri 20 14:45"}, {"id": "g07", "label": "Friday, 20 November 2026", "h": 16, "m": 0, "cap": "3 erreurs qui tuent tes clips GTA VI ❌ (la 3e est la plus courante)\n\nLien en bio 🎮\n\n#gta6 #gtavi #gaming #streamer #clipping #reelsfrance", "when": "Fri 20 16:00"}, {"id": "f07", "label": "Friday, 20 November 2026", "h": 17, "m": 45, "cap": "Tu sèches sur le titre de ton clip ? Titre, légende et hashtags arrivent tout prêts ✨\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Fri 20 17:45"}, {"id": "p02", "label": "Friday, 20 November 2026", "h": 19, "m": 0, "cap": "Parraine un ami : 5 clips offerts pour toi ET pour lui 🤝\n\nInfos et inscription : lien en bio 🔗\n\n#clipping #gta6 #bonplan #createurdecontenu #reelsfrance", "when": "Fri 20 19:00"}, {"id": "a05", "label": "Friday, 20 November 2026", "h": 20, "m": 30, "cap": "Pourquoi tu ne gagnes rien en clipping (et comment corriger) ❌\n\nLien en bio pour tester gratuitement 🔗\n\n#clipping #argentenligne #sidehustle #revenuscomplementaires #reelsfrance #gta6", "when": "Fri 20 20:30"}, {"id": "f12", "label": "Friday, 20 November 2026", "h": 22, "m": 0, "cap": "La facecam, c'est ce qui rend un clip vivant. Place-la où tu veux 🎥\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Fri 20 22:00"}, {"id": "e06", "label": "Saturday, 21 November 2026", "h": 8, "m": 0, "cap": "3 phrases d'accroche qui marchent sur les clips de stream 🪝\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Sat 21 08:00"}, {"id": "a06", "label": "Saturday, 21 November 2026", "h": 10, "m": 30, "cap": "3 clips par jour pendant 30 jours : le calcul (exemple, les vues varient énormément) 📈\n\nLien en bio pour tester gratuitement 🔗\n\n#clipping #argentenligne #sidehustle #revenuscomplementaires #reelsfrance #gta6", "when": "Sat 21 10:30"}, {"id": "f04", "label": "Saturday, 21 November 2026", "h": 12, "m": 15, "cap": "Ton titre et tes sous-titres, tu les places OÙ TU VEUX ✋\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Sat 21 12:15"}, {"id": "m04", "label": "Saturday, 21 November 2026", "h": 13, "m": 30, "cap": "« Il faut un PC de gamer pour clipper » : faux 💻\n\nLien en bio 🔗\n\n#clipping #createurdecontenu #ia #gta6 #reelsfrance", "when": "Sat 21 13:30"}, {"id": "g01", "label": "Saturday, 21 November 2026", "h": 14, "m": 45, "cap": "GTA VI va remplir tous les lives. Les clippers prêts prendront les vues 🎮🔥\n\nLien en bio 🎮\n\n#gta6 #gtavi #gaming #streamer #clipping #reelsfrance", "when": "Sat 21 14:45"}, {"id": "p03", "label": "Saturday, 21 November 2026", "h": 16, "m": 0, "cap": "Bronze, Argent, Or, Diamant : les niveaux de clipper et leurs récompenses 💎\n\nInfos et inscription : lien en bio 🔗\n\n#clipping #gta6 #bonplan #createurdecontenu #reelsfrance", "when": "Sat 21 16:00"}, {"id": "g08", "label": "Saturday, 21 November 2026", "h": 17, "m": 45, "cap": "Tes 3 premières secondes décident de tout. Coupe ce qui précède l'action ✂️\n\nLien en bio 🎮\n\n#gta6 #gtavi #gaming #streamer #clipping #reelsfrance", "when": "Sat 21 17:45"}, {"id": "e09", "label": "Saturday, 21 November 2026", "h": 19, "m": 0, "cap": "Pourquoi tes clips ont besoin de sous-titres 🔇\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Sat 21 19:00"}, {"id": "f09", "label": "Saturday, 21 November 2026", "h": 20, "m": 30, "cap": "Pas de vidéo pour tester ? Il y a une vidéo d'exemple 🎮\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Sat 21 20:30"}, {"id": "a10", "label": "Saturday, 21 November 2026", "h": 22, "m": 0, "cap": "1 clip parfait ou 10 clips corrects ? En clipping la réponse est claire 🎯\n\nLien en bio pour tester gratuitement 🔗\n\n#clipping #argentenligne #sidehustle #revenuscomplementaires #reelsfrance #gta6", "when": "Sat 21 22:00"}, {"id": "e12", "label": "Sunday, 22 November 2026", "h": 8, "m": 30, "cap": "La semaine type d'un clipper organisé 🗓️\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Sun 22 08:30"}, {"id": "a07", "label": "Sunday, 22 November 2026", "h": 11, "m": 0, "cap": "Payé en dollars mais tu penses en euros ? L'onglet Revenus convertit tout 💱\n\nLien en bio pour tester gratuitement 🔗\n\n#clipping #argentenligne #sidehustle #revenuscomplementaires #reelsfrance #gta6", "when": "Sun 22 11:00"}, {"id": "f10", "label": "Sunday, 22 November 2026", "h": 12, "m": 30, "cap": "Pas de logiciel de montage. Pas de PC de gamer. Juste ton navigateur 💻📱\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Sun 22 12:30"}, {"id": "a01", "label": "Sunday, 22 November 2026", "h": 14, "m": 45, "cap": "Combien rapporte UN seul clip ? Le calcul honnête 🧮 (exemple, les tarifs varient selon les campagnes)\n\nLien en bio pour tester gratuitement 🔗\n\n#clipping #argentenligne #sidehustle #revenuscomplementaires #reelsfrance #gta6", "when": "Sun 22 14:45"}, {"id": "p05", "label": "Sunday, 22 November 2026", "h": 16, "m": 0, "cap": "Le règlement du défi GTA VI en 15 secondes 📜\n\nInfos et inscription : lien en bio 🔗\n\n#clipping #gta6 #bonplan #createurdecontenu #reelsfrance", "when": "Sun 22 16:00"}, {"id": "e04", "label": "Sunday, 22 November 2026", "h": 17, "m": 45, "cap": "Combien de clips poster par jour ? La régularité bat le talent 📅\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Sun 22 17:45"}, {"id": "f13", "label": "Sunday, 22 November 2026", "h": 19, "m": 0, "cap": "En vertical, l'action sort du cadre ? Le recadrage IA la suit 🎯\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Sun 22 19:00"}, {"id": "m05", "label": "Sunday, 22 November 2026", "h": 20, "m": 30, "cap": "« Les outils IA coûtent une fortune » : 0 € jusqu'au 26/11, puis 3,99 € le 1er mois 💶\n\nLien en bio 🔗\n\n#clipping #createurdecontenu #ia #gta6 #reelsfrance", "when": "Sun 22 20:30"}, {"id": "a09", "label": "Sunday, 22 November 2026", "h": 22, "m": 0, "cap": "Une campagne de clipping, comment ça marche ? Budget, tarif, vues 💡\n\nLien en bio pour tester gratuitement 🔗\n\n#clipping #argentenligne #sidehustle #revenuscomplementaires #reelsfrance #gta6", "when": "Sun 22 22:00"}, {"id": "e02", "label": "Monday, 23 November 2026", "h": 8, "m": 30, "cap": "Où trouver des campagnes de clipping ? 3 pistes 🔎\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Mon 23 08:30"}, {"id": "f06", "label": "Monday, 23 November 2026", "h": 11, "m": 0, "cap": "Tu clippes des vidéos YouTube ? Importe le fichier, le reste est automatique 📁\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Mon 23 11:00"}, {"id": "a08", "label": "Monday, 23 November 2026", "h": 12, "m": 30, "cap": "Arrête de noter tes gains de clipping dans tes notes 📒 Le tableau de bord du clipper\n\nLien en bio pour tester gratuitement 🔗\n\n#clipping #argentenligne #sidehustle #revenuscomplementaires #reelsfrance #gta6", "when": "Mon 23 12:30"}, {"id": "e10", "label": "Monday, 23 November 2026", "h": 14, "m": 45, "cap": "Ton premier clip en 4 étapes 📲\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Mon 23 14:45"}, {"id": "p04", "label": "Monday, 23 November 2026", "h": 16, "m": 0, "cap": "Niveau Or : 15 clips offerts et la file prioritaire 🥇\n\nInfos et inscription : lien en bio 🔗\n\n#clipping #gta6 #bonplan #createurdecontenu #reelsfrance", "when": "Mon 23 16:00"}, {"id": "e07", "label": "Monday, 23 November 2026", "h": 17, "m": 45, "cap": "15, 30 ou 60 secondes : quelle durée pour un clip ? ⏱️\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Mon 23 17:45"}, {"id": "f14", "label": "Monday, 23 November 2026", "h": 19, "m": 0, "cap": "10 clips à exporter ? Un seul bouton : Exporter tout 📦\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Mon 23 19:00"}, {"id": "m06", "label": "Monday, 23 November 2026", "h": 20, "m": 30, "cap": "« Je n'ai pas le temps de clipper » : l'analyse tourne pendant que tu fais autre chose ⏳\n\nLien en bio 🔗\n\n#clipping #createurdecontenu #ia #gta6 #reelsfrance", "when": "Mon 23 20:30"}, {"id": "f15", "label": "Monday, 23 November 2026", "h": 22, "m": 0, "cap": "Ta VOD vue par l'IA : chaque pic de la courbe est un moment fort 📊\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Mon 23 22:00"}, {"id": "e05", "label": "Tuesday, 24 November 2026", "h": 8, "m": 30, "cap": "À quelle heure poster tes clips ? Teste ces 3 créneaux ⏰\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Tue 24 08:30"}, {"id": "f08", "label": "Tuesday, 24 November 2026", "h": 11, "m": 0, "cap": "Ce petit détail garde les gens jusqu'à la fin de ton clip 👇\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Tue 24 11:00"}, {"id": "e08", "label": "Tuesday, 24 November 2026", "h": 12, "m": 30, "cap": "Un compte, une niche : pourquoi les clippers qui percent se spécialisent 🎯\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Tue 24 12:30"}, {"id": "m02", "label": "Tuesday, 24 November 2026", "h": 14, "m": 45, "cap": "« Il faut savoir monter pour clipper » : plus maintenant ✂️\n\nLien en bio 🔗\n\n#clipping #createurdecontenu #ia #gta6 #reelsfrance", "when": "Tue 24 14:45"}, {"id": "p01", "label": "Tuesday, 24 November 2026", "h": 16, "m": 0, "cap": "Gagne des clips gratuits en publiant des vidéos sur HYPECUT 🎁 (collaboration commerciale)\n\nInfos et inscription : lien en bio 🔗\n\n#clipping #gta6 #bonplan #createurdecontenu #reelsfrance", "when": "Tue 24 16:00"}, {"id": "e11", "label": "Tuesday, 24 November 2026", "h": 19, "m": 0, "cap": "Les 3 chiffres qu'un clipper doit suivre 📊\n\nSauvegarde ce conseil et teste HYPECUT, lien en bio 🔗\n\n#clipping #conseils #createurdecontenu #reelsfrance #clipper #gta6", "when": "Tue 24 19:00"}, {"id": "p08", "label": "Tuesday, 24 November 2026", "h": 20, "m": 30, "cap": "Pas envie d'abonnement ? 20 clips pour 2,99 € 🧾\n\nInfos et inscription : lien en bio 🔗\n\n#clipping #gta6 #bonplan #createurdecontenu #reelsfrance", "when": "Tue 24 20:30"}, {"id": "f11", "label": "Tuesday, 24 November 2026", "h": 22, "m": 0, "cap": "Twitch ou Kick : colle le lien d'une VOD ou d'un clip, l'analyse démarre 🔗\n\nTeste-le gratuitement, lien en bio 🔗\n\n#clipping #montagevideo #ia #createurdecontenu #reelsfrance #twitch", "when": "Tue 24 22:00"}];
window.__hcLog = window.__hcLog || [];
window.hcWait = async function (fn, ms) { for (let i = 0; i < ms / 250; i++) { try { if (fn()) return true; } catch (e) {} await hcSleep(250); } return false; };
window.hcOpenComposer = async function () {
  if (hcBtn('Add Video')) return true;
  const b = hcBtn('Create reel'); if (!b) return false;
  hcClick(b);
  return await hcWait(() => hcBtn('Add Video') && document.querySelector('[contenteditable=true][aria-label^="Describe your reel"]'), 20000);
};
window.hcRunOne = async function (j) {
  if (!(await hcOpenComposer())) throw new Error('composer not found');
  await hcSleep(1200);
  const up = await hcStep1(j.id, j.cap);
  if (up !== 'uploaded') throw new Error('upload ' + up);
  const ed = document.querySelector('[contenteditable=true][aria-label^="Describe your reel"]');
  if (!ed || ed.innerText.trim().length < 20) throw new Error('caption missing');
  if (!(await hcToShare())) throw new Error('no schedule panel');
  const d = await hcDate(j.label);
  const t = await hcTime(j.h, j.m);
  const mm = String(new Date(j.label.replace(/^\w+, /, '')).getMonth() + 1).padStart(2, '0');
  const want = mm + '/' + String(j.label.match(/, (\d+) /)[1]).padStart(2, '0') + '/2026';
  const mer = j.h >= 12 ? 'PM' : 'AM'; let h12 = j.h % 12 || 12;
  if (d !== want || t[0] !== h12 || t[1] !== j.m || t[2] !== mer) throw new Error('datetime mismatch ' + d + ' ' + t.join(':'));
  if (/A scheduled reel needs/.test(document.body.innerText)) throw new Error('time window error');
  const r = await hcSubmit();
  if (!/scheduled_posts/.test(r)) throw new Error('submit ' + r);
  await hcSleep(2500);
  return 'ok';
};
window.hcRunAll = function (ids) {
  window.__hcStop = false; window.__hcBusy = true;
  (async () => {
    for (const id of ids) {
      if (window.__hcStop) break;
      const j = HC_JOBS.find(x => x.id === id);
      window.__hcCur = id;
      try { const r = await hcRunOne(j); __hcLog.push(id + ':' + r); }
      catch (e) { __hcLog.push(id + ':ERR ' + e.message); window.__hcBusy = false; return; }
    }
    window.__hcBusy = false; window.__hcCur = null;
  })();
  return 'started ' + ids.length;
};
'lib ok'
