// Styles des sous-titres (inspirés des styles de texte TikTok), partagés entre l'aperçu (navigateur) et le rendu (serveur).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SubStyles = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // family : nom utilisé par libass (rendu ffmpeg) ; css : nom déclaré en @font-face pour l'aperçu
  const FONTS = [
    { id: 'classic', label: 'Classique', family: 'Poppins Black', css: 'HC Poppins', file: 'Poppins-Black.ttf', size: 0.86, upper: true },
    { id: 'impact', label: 'Impact', family: 'Anton', css: 'HC Anton', file: 'Anton-Regular.ttf', size: 1, upper: true },
    { id: 'tall', label: 'Élancé', family: 'Bebas Neue', css: 'HC Bebas', file: 'BebasNeue-Regular.ttf', size: 1.16, upper: true },
    { id: 'gaming', label: 'Gaming', family: 'Luckiest Guy', css: 'HC Luckiest', file: 'LuckiestGuy-Regular.ttf', size: 0.86, upper: true },
    { id: 'comic', label: 'BD', family: 'Bangers', css: 'HC Bangers', file: 'Bangers-Regular.ttf', size: 1.06, upper: true },
    { id: 'marker', label: 'Marqueur', family: 'Permanent Marker', css: 'HC Marker', file: 'PermanentMarker-Regular.ttf', size: 0.84, upper: false },
    { id: 'typewriter', label: 'Machine à écrire', family: 'Courier Prime', css: 'HC Courier', file: 'CourierPrime-Bold.ttf', size: 0.86, upper: false, bold: true },
    { id: 'serif', label: 'Élégant', family: 'DM Serif Display', css: 'HC DMSerif', file: 'DMSerifDisplay-Regular.ttf', size: 0.95, upper: false },
  ];
  // Palette proche de celle de TikTok
  const COLORS = [
    { id: 'white', label: 'Blanc', hex: '#FFFFFF' }, { id: 'yellow', label: 'Jaune', hex: '#FFD23D' },
    { id: 'orange', label: 'Orange', hex: '#FF8A1F' }, { id: 'red', label: 'Rouge', hex: '#FF3B30' },
    { id: 'pink', label: 'Rose', hex: '#FF3D8B' }, { id: 'purple', label: 'Violet', hex: '#8B5CF6' },
    { id: 'blue', label: 'Bleu', hex: '#2F7BFF' }, { id: 'cyan', label: 'Cyan', hex: '#2EE6D6' },
    { id: 'green', label: 'Vert', hex: '#3DDC5A' }, { id: 'black', label: 'Noir', hex: '#000000' },
  ];
  const STYLES = [
    { id: 'outline', label: 'Contour' }, { id: 'box', label: 'Fond' },
    { id: 'neon', label: 'Néon' }, { id: 'shadow', label: 'Ombre' },
  ];
  const SIZES = { s: 0.8, m: 1, l: 1.22 };
  const DEFAULT = { font: 'impact', style: 'outline', color: 'white', hi: 'yellow', size: 'm', upper: true };

  const byId = (list, id) => list.find((x) => x.id === id);
  function sanitize(o) {
    const s = Object.assign({}, DEFAULT);
    if (!o || typeof o !== 'object') return s;
    if (byId(FONTS, o.font)) s.font = o.font;
    if (byId(STYLES, o.style)) s.style = o.style;
    if (byId(COLORS, o.color)) s.color = o.color;
    if (o.hi === 'none' || byId(COLORS, o.hi)) s.hi = o.hi;
    if (SIZES[o.size]) s.size = o.size;
    if (typeof o.upper === 'boolean') s.upper = o.upper;
    return s;
  }
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
  /** Couleurs effectives : texte, mot en cours, contour / fond. */
  function resolve(st) {
    st = sanitize(st);
    const font = byId(FONTS, st.font), col = byId(COLORS, st.color).hex;
    let text = col, hi = st.hi === 'none' ? null : byId(COLORS, st.hi).hex, edge = lum(col) < 0.25 ? '#FFFFFF' : '#000000';
    if (st.style === 'box') { edge = col; text = lum(col) > 0.6 ? '#000000' : '#FFFFFF'; if (hi && hi.toUpperCase() === col.toUpperCase()) hi = text === '#000000' ? '#FFFFFF' : '#000000'; }
    if (st.style === 'neon') { edge = col; text = '#FFFFFF'; if (hi && hi.toUpperCase() === '#FFFFFF') hi = col; }
    if (hi && hi.toUpperCase() === text.toUpperCase()) hi = null;
    return { st, font, text, hi, edge, scale: font.size * SIZES[st.size] };
  }
  const assColor = (hex, alpha = 0) => { const n = hex.replace('#', ''); return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${n.slice(4, 6)}${n.slice(2, 4)}${n.slice(0, 2)}`.toUpperCase(); };

  /** Ligne « Style: » ASS et préfixe de chaque événement. fs : taille de base. */
  function assStyle(st, fs, W) {
    const r = resolve(st), f = Math.round(fs * r.scale), m = Math.round(W * 0.06), bold = r.font.bold ? -1 : 0;
    let border = 1, outline = Math.max(3, Math.round(f * 0.09)), shadow = Math.round(outline * 0.6), back = assColor('#000000', 0x96), pre = '';
    if (r.st.style === 'box') { border = 3; outline = Math.max(4, Math.round(f * 0.16)); shadow = 0; back = assColor(r.edge); }
    if (r.st.style === 'neon') { outline = Math.max(3, Math.round(f * 0.075)); shadow = 0; pre = `{\\blur${Math.max(4, Math.round(f * 0.09))}}`; }
    if (r.st.style === 'shadow') { outline = 0; shadow = Math.max(3, Math.round(f * 0.07)); back = assColor('#000000', 0x50); }
    const line = `Style: Sub,${r.font.family},${f},${assColor(r.text)},${assColor(r.text)},${assColor(r.edge)},${back},${bold},0,0,0,100,100,1,0,${border},${outline},${shadow},5,${m},${m},0,1`;
    return { line, pre, fs: f, hi: r.hi ? assColor(r.hi) : null, text: assColor(r.text), upper: r.st.upper, grow: r.st.style !== 'box' };
  }

  /** Aperçu dans un canvas : mots sur une ligne, centrés en (cx, y), le mot d'indice hiIdx mis en avant. */
  function drawCanvas(ctx, words, cx, y, fs, st, hiIdx) {
    const r = resolve(st), f = fs * r.scale;
    words = words.map((w) => (r.st.upper ? w.toUpperCase() : w));
    ctx.save();
    ctx.font = `${r.font.bold ? 'bold ' : ''}${f}px "${r.font.css}", Impact, sans-serif`; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.textAlign = 'left';
    const sp = f * 0.36, ws = words.map((w) => ctx.measureText(w).width), total = ws.reduce((a, b) => a + b, 0) + sp * (words.length - 1);
    if (r.st.style === 'box') { const p = f * 0.22; ctx.fillStyle = r.edge; const x0 = cx - total / 2 - p, h = f * 1.2 + p; if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x0, y - h / 2, total + p * 2, h, f * 0.12); ctx.fill(); } else ctx.fillRect(x0, y - h / 2, total + p * 2, h); }
    let x = cx - total / 2;
    words.forEach((w, i) => {
      const isHi = i === hiIdx && r.hi, fill = isHi ? r.hi : r.text;
      ctx.save();
      if (isHi && r.st.style !== 'box') { const k = 1.08, mx = x + ws[i] / 2; ctx.translate(mx, y); ctx.scale(k, k); ctx.translate(-mx, -y); }
      if (r.st.style === 'outline') { ctx.lineWidth = Math.max(4, f * 0.18); ctx.strokeStyle = r.edge; ctx.strokeText(w, x, y); }
      if (r.st.style === 'neon') { ctx.shadowColor = r.edge; ctx.shadowBlur = f * 0.45; ctx.lineWidth = Math.max(3, f * 0.12); ctx.strokeStyle = r.edge; ctx.strokeText(w, x, y); ctx.strokeText(w, x, y); ctx.shadowBlur = f * 0.2; }
      if (r.st.style === 'shadow') { ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowOffsetX = ctx.shadowOffsetY = f * 0.06; ctx.shadowBlur = f * 0.08; }
      ctx.fillStyle = fill; ctx.fillText(w, x, y);
      ctx.restore();
      x += ws[i] + sp;
    });
    ctx.restore();
    return { w: total, h: f * 1.6 };
  }

  return { FONTS, COLORS, STYLES, SIZES, DEFAULT, sanitize, resolve, assStyle, drawCanvas };
});
