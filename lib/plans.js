// Offres HYPECUT. Les prix sont en centimes d'euro.
const LAUNCH_END = new Date(process.env.LAUNCH_END || '2026-11-30T23:59:59+01:00');
const LAUNCH_BONUS_END = new Date(process.env.LAUNCH_BONUS_END || '2026-11-26T23:59:59+01:00');
// Pass lancement GTA VI : toutes les fonctions Pro offertes aux comptes gratuits pendant la semaine de sortie
const LAUNCH_PASS_START = new Date(process.env.LAUNCH_PASS_START || '2026-11-17T00:00:00+01:00');
const LAUNCH_PASS_END = new Date(process.env.LAUNCH_PASS_END || '2026-11-26T23:59:59+01:00');
const LAUNCH_PASS_CREDITS = +process.env.LAUNCH_PASS_CREDITS || 10;

const PLANS = {
  free: {
    id: 'free',
    name: 'Essai gratuit',
    price: 0,
    credits: 3,
    launchCredits: 5,
    res: 720,
    fps: 30,
    crf: 23,
    watermark: true,
    maxDurationMin: 20,
    maxUploadMb: 600,
    ai: 'top1', // titre IA sur le meilleur clip seulement
    camLayouts: false,
    smartCrop: false,
    batch: false,
    priority: 0,
    perks: ['3 clips offerts (5 pendant la semaine de sortie)', '720p avec filigrane', 'Vidéos jusqu’à 20 min', 'Formats 9:16, 1:1 et 16:9'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 799,
    launchPrice: 399,
    credits: 100,
    res: 1080,
    fps: 30,
    crf: 20,
    watermark: false,
    maxDurationMin: 120,
    maxUploadMb: 4096,
    ai: 'all',
    camLayouts: true,
    smartCrop: true,
    batch: false,
    priority: 1,
    perks: ['100 clips par mois', '1080p sans filigrane', 'Vidéos jusqu’à 2 h', 'Titres, légendes et hashtags IA', 'Tous les formats caméra', 'Recadrage IA qui suit l’action'],
  },
  creator: {
    id: 'creator',
    name: 'Créateur',
    price: 1999,
    credits: 400,
    res: 1080,
    fps: 60,
    crf: 18,
    watermark: false,
    maxDurationMin: 360,
    maxUploadMb: 8192,
    ai: 'all',
    camLayouts: true,
    smartCrop: true,
    batch: true,
    priority: 2,
    perks: ['400 clips par mois', '1080p 60 i/s, qualité maximale', 'VOD jusqu’à 6 h', 'Tout Pro inclus', 'File d’attente prioritaire', 'Export de tous les clips en un clic', 'Sous-titres automatiques (bientôt)'],
  },
};

const PACKS = {
  pack20: { id: 'pack20', name: 'Pack 20 clips', price: 299, credits: 20 },
};

function isLaunch(now = new Date()) { return now <= LAUNCH_END; }
function isLaunchPass(now = new Date()) { return process.env.LAUNCH_PASS !== 'off' && now >= LAUNCH_PASS_START && now <= LAUNCH_PASS_END; }
function isLaunchBonus(now = new Date()) { return now <= LAUNCH_BONUS_END; }
function signupCredits() { return isLaunchPass() ? LAUNCH_PASS_CREDITS : isLaunchBonus() ? PLANS.free.launchCredits : PLANS.free.credits; }
function planOf(user) {
  const p = PLANS[(user && user.plan) || 'free'] || PLANS.free;
  if (p.id === 'free' && isLaunchPass()) {
    return { ...PLANS.pro, id: 'free', name: 'Pass lancement GTA VI', priority: 0, maxUploadMb: 2048, launchPass: true };
  }
  return p;
}

function publicPlans() {
  const launch = isLaunch();
  return {
    launch: { active: launch, ends: LAUNCH_END.toISOString(), code: 'GTAVI', bonusActive: isLaunchBonus(),
      pass: { active: isLaunchPass(), ends: LAUNCH_PASS_END.toISOString(), credits: LAUNCH_PASS_CREDITS } },
    plans: Object.values(PLANS).map((p) => ({
      id: p.id, name: p.name, price: p.price,
      launchPrice: launch && p.launchPrice ? p.launchPrice : null,
      credits: p.id === 'free' ? signupCredits() : p.credits,
      perks: p.perks, res: p.res, fps: p.fps, watermark: p.watermark,
      maxDurationMin: p.maxDurationMin, camLayouts: p.camLayouts, smartCrop: p.smartCrop, batch: p.batch, ai: p.ai,
    })),
    packs: Object.values(PACKS),
  };
}

module.exports = { PLANS, PACKS, isLaunch, isLaunchBonus, isLaunchPass, signupCredits, planOf, publicPlans, LAUNCH_END };
