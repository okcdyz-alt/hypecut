/* HYPECUT — formats de sortie et modèles caméra (partagé navigateur + serveur).
 * compose() renvoie une liste d'opérations de dessin indépendantes de l'outil :
 * le navigateur les dessine sur un <canvas>, le serveur les traduit en filtres ffmpeg.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HypeLayouts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LAYOUTS = {
    game_full:  { label: 'Jeu plein écran',        desc: 'Recadré sur le centre de l’action', ratio: '9:16', cam: false, tier: 'free' },
    game_blur:  { label: 'Jeu + fond flouté',      desc: 'Toute l’image visible, fond flou',   ratio: '9:16', cam: false, tier: 'free' },
    cam_top:    { label: 'Caméra en haut',         desc: 'Facecam en haut, jeu en bas',        ratio: '9:16', cam: true,  tier: 'pro' },
    cam_bottom: { label: 'Caméra en bas',          desc: 'Jeu en haut, facecam en bas',        ratio: '9:16', cam: true,  tier: 'pro' },
    split_half: { label: 'Moitié / moitié',        desc: '50 % caméra, 50 % jeu',              ratio: '9:16', cam: true,  tier: 'pro' },
    cam_bubble: { label: 'Caméra en bulle',        desc: 'Bulle ronde dans un coin',           ratio: '9:16', cam: true,  tier: 'pro' },
    cam_pip:    { label: 'Caméra incrustée',       desc: 'Petit cadre caméra dans un coin',    ratio: '9:16', cam: true,  tier: 'pro' },
    game_ai:    { label: 'Recadrage IA',           desc: 'Le cadre suit l’action (Cloudinary)', ratio: '9:16', cam: false, tier: 'pro', serverOnly: true },
    square:     { label: 'Carré 1:1',              desc: 'Instagram, X',                       ratio: '1:1',  cam: false, tier: 'free' },
    landscape:  { label: 'Paysage 16:9',           desc: 'YouTube classique',                  ratio: '16:9', cam: false, tier: 'free' },
  };

  function outSize(ratio, res) {
    if (ratio === '9:16') return { W: res, H: Math.round((res * 16) / 9 / 2) * 2 };
    if (ratio === '1:1') return { W: res, H: res };
    return { W: Math.round((res * 16) / 9 / 2) * 2, H: res };
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);

  /** Sous-rectangle de `src` au ratio tw/th, centré sur (fx, fy) (0-1). */
  function cover(src, tw, th, fx, fy) {
    const ta = tw / th;
    let w, h;
    if (src.w / src.h > ta) { h = src.h; w = h * ta; } else { w = src.w; h = w / ta; }
    const x = src.x + clamp((fx ?? 0.5) * src.w - w / 2, 0, src.w - w);
    const y = src.y + clamp((fy ?? 0.5) * src.h - h / 2, 0, src.h - h);
    return { x, y, w, h };
  }

  function roundRect(r, maxW, maxH) {
    const w = Math.min(even(r.w), maxW - (maxW % 2));
    const h = Math.min(even(r.h), maxH - (maxH % 2));
    return {
      x: clamp(Math.round(r.x), 0, Math.max(0, maxW - w)),
      y: clamp(Math.round(r.y), 0, Math.max(0, maxH - h)),
      w, h,
    };
  }

  /**
   * @param layout  clé de LAYOUTS
   * @param iw, ih  dimensions de la vidéo source
   * @param opts    { res: 720|1080, camRect:{x,y,w,h} (0-1), focusX (0-1), corner: 'tl'|'tr'|'bl'|'br' }
   */
  function compose(layout, iw, ih, opts) {
    opts = opts || {};
    const L = LAYOUTS[layout] || LAYOUTS.game_full;
    const { W, H } = outSize(L.ratio, opts.res || 1080);
    const full = { x: 0, y: 0, w: iw, h: ih };
    const fx = opts.focusX ?? 0.5;
    const cr = opts.camRect || { x: 0.02, y: 0.02, w: 0.28, h: 0.3 };
    const cam = { x: cr.x * iw, y: cr.y * ih, w: Math.max(16, cr.w * iw), h: Math.max(16, cr.h * ih) };
    const ops = [];
    let title = { y: Math.round(H * 0.07), anchor: 'top' };

    const game = (dst) => ops.push({ kind: 'video', role: 'game', src: cover(full, dst.w, dst.h, fx, 0.5), dst });
    const camOp = (dst, shape) => ops.push({ kind: 'video', role: 'cam', src: cover(cam, dst.w, dst.h, 0.5, 0.5), dst, shape: shape || 'rect' });
    const corner = opts.corner || 'tl';
    const cornerPos = (w, h) => {
      const mx = W * 0.05, top = H * 0.1, bottom = H * 0.2;
      return {
        x: corner.endsWith('r') ? W - w - mx : mx,
        y: corner.startsWith('b') ? H - h - bottom : top,
      };
    };

    switch (layout) {
      case 'square':
      case 'game_ai':
      case 'game_full':
        game({ x: 0, y: 0, w: W, h: H });
        break;
      case 'landscape':
      case 'game_blur': {
        ops.push({ kind: 'video', role: 'bg', src: cover(full, W, H, 0.5, 0.5), dst: { x: 0, y: 0, w: W, h: H }, effect: 'blur' });
        let dw = W, dh = (W * ih) / iw;
        if (dh > H) { dh = H; dw = (H * iw) / ih; }
        const dst = { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
        ops.push({ kind: 'video', role: 'game', src: full, dst });
        if (layout === 'game_blur') title = { y: Math.round(Math.max(H * 0.05, dst.y * 0.45)), anchor: 'top' };
        break;
      }
      case 'cam_top': {
        const ch = H * 0.38;
        camOp({ x: 0, y: 0, w: W, h: ch });
        game({ x: 0, y: ch, w: W, h: H - ch });
        ops.push({ kind: 'fill', color: '#000000', dst: { x: 0, y: ch - 3, w: W, h: 6 } });
        title = { y: Math.round(ch), anchor: 'center' };
        break;
      }
      case 'cam_bottom': {
        const gh = H * 0.62;
        game({ x: 0, y: 0, w: W, h: gh });
        camOp({ x: 0, y: gh, w: W, h: H - gh });
        ops.push({ kind: 'fill', color: '#000000', dst: { x: 0, y: gh - 3, w: W, h: 6 } });
        title = { y: Math.round(gh), anchor: 'center' };
        break;
      }
      case 'split_half': {
        camOp({ x: 0, y: 0, w: W, h: H / 2 });
        game({ x: 0, y: H / 2, w: W, h: H / 2 });
        ops.push({ kind: 'fill', color: '#000000', dst: { x: 0, y: H / 2 - 3, w: W, h: 6 } });
        title = { y: Math.round(H / 2), anchor: 'center' };
        break;
      }
      case 'cam_bubble': {
        game({ x: 0, y: 0, w: W, h: H });
        const D = W * 0.36, b = Math.max(4, W * 0.008);
        const p = cornerPos(D, D);
        ops.push({ kind: 'fill', color: '#ffffff', shape: 'circle', dst: { x: p.x - b, y: p.y - b, w: D + 2 * b, h: D + 2 * b } });
        camOp({ x: p.x, y: p.y, w: D, h: D }, 'circle');
        if (!corner.startsWith('b')) title = { y: Math.round(p.y + D + H * 0.03), anchor: 'top' };
        break;
      }
      case 'cam_pip': {
        game({ x: 0, y: 0, w: W, h: H });
        const pw = W * 0.44;
        const ph = clamp(pw * (cam.h / cam.w), pw * 0.5, pw * 1.2);
        const b = Math.max(4, W * 0.008);
        const p = cornerPos(pw, ph);
        ops.push({ kind: 'fill', color: '#ffffff', dst: { x: p.x - b, y: p.y - b, w: pw + 2 * b, h: ph + 2 * b } });
        camOp({ x: p.x, y: p.y, w: pw, h: ph });
        if (!corner.startsWith('b')) title = { y: Math.round(p.y + ph + H * 0.03), anchor: 'top' };
        break;
      }
      default:
        game({ x: 0, y: 0, w: W, h: H });
    }

    for (const op of ops) {
      op.dst = roundRect(op.dst, W, H);
      if (op.src) op.src = roundRect(op.src, iw, ih);
    }
    return { W, H, ops, title };
  }

  /** Découpe un titre en lignes courtes (sans emoji, que les polices vidéo n'affichent pas). */
  function wrapTitle(text, maxChars) {
    const clean = String(text || '')
      .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90);
    if (!clean) return [];
    const words = clean.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
      else cur = (cur + ' ' + w).trim();
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  }

  return { LAYOUTS, outSize, compose, wrapTitle };
});
