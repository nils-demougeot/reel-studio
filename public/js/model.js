// Modèle de données d'un projet et calculs de timing.
//
// Les durées des médias sont stockées en « temps » (beats) : changer le tempo
// recale automatiquement tout le montage sur la musique.

import { uid } from './util.js';

export const FRAME_W = 1080;
export const FRAME_H = 1920;

// lineHeight : interligne propre à chaque police (les scripts ont de grandes boucles).
export const FONTS = [
  { id: 'montserrat', family: 'Montserrat', label: 'Montserrat', weights: [400, 700, 800, 900] },
  { id: 'inter', family: 'Inter', label: 'Inter', weights: [400, 700, 800, 900] },
  { id: 'bebas', family: 'Bebas Neue', label: 'Bebas Neue', weights: [400], lineHeight: 1.02 },
  { id: 'bungee', family: 'Bungee', label: 'Bungee', weights: [400], lineHeight: 1.1 },
  { id: 'abril', family: 'Abril Fatface', label: 'Abril', weights: [400], lineHeight: 1.12 },
  { id: 'cinzel', family: 'Cinzel', label: 'Cinzel', weights: [400, 700, 900] },
  { id: 'pacifico', family: 'Pacifico', label: 'Pacifico', weights: [400], lineHeight: 1.35 },
  { id: 'greatvibes', family: 'Great Vibes', label: 'Great Vibes', weights: [400], lineHeight: 1.3 },
  { id: 'marker', family: 'Permanent Marker', label: 'Marker', weights: [400], lineHeight: 1.2 },
];

// Anciennes polices remplacées : les textes existants prennent leur remplaçante.
const FONT_ALIASES = { anton: 'abril', playfair: 'cinzel', caveat: 'pacifico' };
export const fontById = (id) => FONTS.find((f) => f.id === (FONT_ALIASES[id] || id)) || FONTS[0];

export const BEAT_CHOICES = [
  { beats: 0.25, label: '¼' },
  { beats: 0.5, label: '½' },
  { beats: 1, label: '1' },
  { beats: 2, label: '2' },
  { beats: 4, label: '4' },
];

// « Adapter » garde l'image entière (bandes noires) ; « Recadrer » remplit tout l'écran.
export const FIT_MODES = [
  { id: 'contain', label: 'Adapter', title: 'Image entière, bandes noires si besoin' },
  { id: 'cover', label: 'Recadrer', title: 'Remplit l’écran, coupe les bords' },
  { id: 'blur', label: 'Fond flou', title: 'Image entière sur un fond flouté' },
];

export const MOTIONS = [
  { id: 'none', label: 'Fixe' },
  { id: 'zoomIn', label: 'Zoom avant' },
  { id: 'zoomOut', label: 'Zoom arrière' },
];

export const TEXT_STYLES = [
  { id: 'none', label: 'Simple' },
  { id: 'box', label: 'Bloc' },
  { id: 'lines', label: 'Surligné' },
  { id: 'outline', label: 'Contour' },
];

export const ANIMATIONS = [
  { id: 'none', label: 'Aucune' },
  { id: 'fade', label: 'Fondu' },
  { id: 'pop', label: 'Pop' },
  { id: 'rise', label: 'Montée' },
];

export const TEXT_PRESETS = {
  title: { label: 'Titre', font: 'montserrat', weight: 900, size: 120, style: 'none', uppercase: true, y: 0.42, anim: 'pop', spacing: 0 },
  subtitle: { label: 'Sous-titre', font: 'montserrat', weight: 700, size: 64, style: 'none', uppercase: false, y: 0.52, anim: 'rise', spacing: 0 },
  label: { label: 'Étiquette', font: 'inter', weight: 800, size: 58, style: 'lines', uppercase: false, y: 0.7, anim: 'pop', spacing: 0 },
  impact: { label: 'Impact', font: 'bungee', weight: 400, size: 120, style: 'outline', uppercase: true, y: 0.42, anim: 'pop', spacing: 0 },
  hand: { label: 'Manuscrit', font: 'pacifico', weight: 400, size: 100, style: 'none', uppercase: false, y: 0.45, anim: 'fade', spacing: 0 },
  vintage: { label: 'Vintage', font: 'abril', weight: 400, size: 120, style: 'none', uppercase: false, y: 0.44, anim: 'fade', spacing: 1 },
  elegant: { label: 'Élégant', font: 'greatvibes', weight: 400, size: 140, style: 'none', uppercase: false, y: 0.45, anim: 'fade', spacing: 0 },
};

export const SWATCHES = ['#ffffff', '#111111', '#ff5b2e', '#ffd23f', '#3aa0ff', '#22c08a', '#ff4f9a', '#7c6cff'];

export function normalizeProject(p) {
  p.settings = { width: FRAME_W, height: FRAME_H, background: '#000000', ...p.settings };
  p.rhythm = { bpm: 120, offset: 0, ...p.rhythm };
  p.defaults = { beats: 1, videoBeats: 4, fit: 'contain', motion: 'zoomIn', ...p.defaults };
  p.media = p.media || {};
  p.clips = p.clips || [];
  p.overlays = p.overlays || [];
  p.sounds = p.sounds || []; // effets sonores : { id, name, file, start, volume, duration }
  // Les anciens « logos » sont des stickers image.
  for (const ov of p.overlays) {
    if (ov.type === 'logo') { ov.type = 'sticker'; ov.kind = 'image'; }
  }
  p.music = p.music || null;
  if (p.music) { p.music.cuts ||= []; p.music.removed ||= []; p.music.fades ||= {}; }
  p.export = { fps: 30, quality: 'high', fadeIn: 0, fadeOut: 1.5, ...p.export };
  return p;
}

// ---------- timing ----------

export const beatLength = (p) => 60 / (p.rhythm.bpm || 120);
export const clipDuration = (p, clip) => Math.max(0.04, clip.beats * beatLength(p));

export function computeTimeline(p) {
  const L = beatLength(p);
  const starts = new Array(p.clips.length);
  const durs = new Array(p.clips.length);
  let t = 0;
  p.clips.forEach((c, i) => {
    starts[i] = t;
    durs[i] = Math.max(0.04, c.beats * L);
    t += durs[i];
  });
  return { starts, durs, total: t };
}

export function clipIndexAt(tl, t) {
  const { starts } = tl;
  if (!starts.length || t < 0 || t >= tl.total) return -1;
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// Position (en secondes de vidéo) du premier temps, puis tous les `beatLength`.
export function beatPhase(p) {
  const L = beatLength(p);
  const start = p.music ? p.music.start : 0;
  const ph = ((p.rhythm.offset - start) % L + L) % L;
  return ph;
}

// ---------- transitions ----------
// Une transition est portée par le média qui SORT : clip.transition = { type, dur } (secondes).
// Elle est centrée sur la coupe, sans décaler le rythme du montage.

export const TRANSITIONS = [
  { id: 'fade', label: 'Fondu', dur: 0.5, desc: 'Fondu enchaîné doux' },
  { id: 'flash', label: 'Flash blanc', dur: 0.4, desc: 'Éclair blanc sur la coupe' },
  { id: 'black', label: 'Flash noir', dur: 0.45, desc: 'Bref passage par le noir' },
  { id: 'zoom', label: 'Zoom', dur: 0.35, desc: 'Plongée rapide dans l’image' },
  { id: 'whip', label: 'Glissé', dur: 0.3, desc: 'Panoramique filé, très dynamique' },
  { id: 'blur', label: 'Flou', dur: 0.5, desc: 'L’image se floute et cède la place' },
  { id: 'leak', label: 'Lumière', dur: 0.7, desc: 'Brûlure de pellicule chaude' },
  { id: 'cutout', label: 'Silhouette', dur: 0.9, desc: 'Flash : le sujet reste un instant sur l’image suivante (photos)' },
];
export const transitionById = (id) => TRANSITIONS.find((t) => t.id === id) || TRANSITIONS[0];

// Temps couvert avant et après la coupe.
export function transitionWindow(tr) {
  return tr.type === 'cutout' ? [0.12, tr.dur] : [tr.dur / 2, tr.dur / 2];
}

// Transition en cours à l'instant t : { k (média sortant), tr, c (instant de la coupe), pre, post } ou null.
export function activeTransition(p, tl, t) {
  const i = clipIndexAt(tl, t);
  if (i < 0) return null;
  for (const k of [i - 1, i]) {
    if (k < 0 || k >= p.clips.length - 1) continue;
    const tr = p.clips[k].transition;
    if (!tr) continue;
    const c = tl.starts[k + 1];
    const [pre0, post0] = transitionWindow(tr);
    const pre = Math.min(pre0, tl.durs[k] * 0.9), post = Math.min(post0, tl.durs[k + 1] * 0.9);
    if (t >= c - pre && t < c + post) return { k, tr, c, pre, post };
  }
  return null;
}

// Médias à afficher à l'instant t (deux pendant une transition) : [{ index, local }].
export function framePlan(p, tl, t) {
  const at = activeTransition(p, tl, t);
  if (at) return [{ index: at.k, local: t - tl.starts[at.k] }, { index: at.k + 1, local: Math.max(0, t - tl.starts[at.k + 1]) }];
  const i = clipIndexAt(tl, t);
  return i >= 0 ? [{ index: i, local: t - tl.starts[i] }] : [];
}

// ---------- aimant ----------
// Distance d'attraction de l'aimant, en pixels de timeline.
export const SNAP_PX = 7;

// Finesse de la grille aimantée selon le zoom : temps entiers, ou quarts de temps
// seulement quand ils sont assez espacés à l'écran pour être visés volontairement.
export const gridSubFor = (p, pps) => ((beatLength(p) / 4) * pps >= 24 ? 4 : 1);

// Renvoie la cible la plus proche de t si elle est à moins de `tol` secondes, sinon t.
export function nearest(t, targets, tol) {
  let best = t, bd = tol;
  for (const x of targets) {
    const dist = Math.abs(x - t);
    if (dist < bd) { bd = dist; best = x; }
  }
  return best;
}

// Temps de la grille musicale (en secondes de vidéo) entre from et to ; sub = 4 pour les quarts de temps.
export function beatGrid(p, from, to, sub = 1) {
  const step = beatLength(p) / sub;
  const ph = beatPhase(p) % step;
  const out = [];
  for (let k = Math.ceil((from - ph) / step); ph + k * step <= to; k++) out.push(ph + k * step);
  return out;
}

export function snapToBeat(p, songTime) {
  const L = beatLength(p);
  let k = Math.round((songTime - p.rhythm.offset) / L);
  while (p.rhythm.offset + k * L < 0) k++;
  return p.rhythm.offset + k * L;
}

// ---------- musique découpée ----------
// music.cuts : points de coupe (en secondes dans le morceau).
// music.removed : passages supprimés [{ from, to }]. Les passages gardés s'enchaînent
// à partir de music.start, sans trou.

export function musicSegments(p) {
  const m = p.music;
  if (!m) return [];
  const eps = 1e-3;
  const bounds = [...new Set([m.start, ...(m.cuts || []).filter((c) => c > m.start + eps && c < m.duration - eps), m.duration])]
    .sort((a, b) => a - b);
  const removed = [...(m.removed || [])].sort((a, b) => a.from - b.from);
  const segs = [];
  let at = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    let pieces = [[bounds[i], bounds[i + 1]]];
    for (const r of removed) {
      pieces = pieces.flatMap(([a, b]) => (r.to <= a || r.from >= b ? [[a, b]] : [[a, r.from], [r.to, b]]))
        .filter(([a, b]) => b - a > eps);
    }
    for (const [from, to] of pieces) {
      const prev = segs[segs.length - 1];
      const key = from.toFixed(4);
      const fade = m.fades?.[key] || {};
      segs.push({
        from, to, at, key, joined: Boolean(prev && Math.abs(prev.to - from) > eps),
        fadeIn: Math.min(fade.in || 0, (to - from) / 2), fadeOut: Math.min(fade.out || 0, (to - from) / 2),
      });
      at += to - from;
    }
  }
  return segs;
}

// Volume relatif (0 à 1) de la musique à l'instant t : fondus des passages + fondus d'ouverture et de fin.
export function musicGainAt(p, t, total, segs = musicSegments(p)) {
  let g = 1;
  const fi = p.export.fadeIn || 0, fo = p.export.fadeOut || 0;
  if (fi > 0 && t < fi) g *= t / fi;
  if (fo > 0 && t > total - fo) g *= Math.max(0, (total - t) / fo);
  for (const s of segs) {
    const len = s.to - s.from;
    if (t < s.at || t >= s.at + len) continue;
    const x = t - s.at;
    if (s.fadeIn > 0 && x < s.fadeIn) g *= x / s.fadeIn;
    if (s.fadeOut > 0 && x > len - s.fadeOut) g *= (len - x) / s.fadeOut;
    break;
  }
  return Math.max(0, Math.min(1, g));
}

// Moment du morceau joué à l'instant t de la vidéo (null après la fin de la musique).
export function songTimeAt(p, t, segs = musicSegments(p)) {
  for (const s of segs) if (t < s.at + (s.to - s.from)) return s.from + Math.max(0, t - s.at);
  return null;
}

// Fin de l'« intro » : la coupe entre deux médias la plus proche de 2 secondes.
export function introEnd(tl) {
  if (!tl?.total) return 2;
  const cuts = [...tl.starts.slice(1), tl.total].filter((c) => c >= 0.5);
  if (!cuts.length) return tl.total;
  return cuts.reduce((best, c) => (Math.abs(c - 2) < Math.abs(best - 2) ? c : best), cuts[0]);
}

// ---------- fabriques ----------

export function newClip(p, media) {
  const isVideo = media?.type === 'video';
  let beats = isVideo ? p.defaults.videoBeats : p.defaults.beats;
  if (isVideo && media.duration) {
    const maxBeats = Math.floor(media.duration / beatLength(p) * 4) / 4;
    if (maxBeats >= 0.25) beats = Math.min(beats, maxBeats);
  }
  return {
    id: uid('c'),
    kind: media ? 'media' : 'color',
    mediaId: media?.id || null,
    color: '#111111',
    beats,
    fit: p.defaults.fit,
    motion: isVideo ? 'none' : p.defaults.motion,
    zoom: 1,
    fx: 0.5,
    fy: 0.5,
    trim: 0,
  };
}

export function newTextOverlay(p, presetId = 'title', tl) {
  const preset = TEXT_PRESETS[presetId];
  return {
    id: uid('t'),
    type: 'text',
    text: presetId === 'subtitle' ? 'Sous-titre' : 'Votre texte',
    font: preset.font,
    weight: preset.weight,
    size: preset.size,
    color: '#ffffff',
    bgColor: presetId === 'label' ? '#ff5b2e' : '#000000',
    style: preset.style,
    uppercase: preset.uppercase,
    align: 'center',
    spacing: preset.spacing,
    x: 0.5,
    y: preset.y,
    maxWidth: 0.86,
    anim: preset.anim,
    start: 0,
    end: introEnd(tl),
  };
}

// Sticker : image fixe, image animée ou vidéo superposée (info : { file, kind, iw, ih, duration }).
export function newStickerOverlay(p, info, tl) {
  return {
    id: uid('s'),
    type: 'sticker',
    kind: info.kind || 'image',
    file: info.file,
    iw: info.iw,
    ih: info.ih,
    duration: info.duration || 0,
    loop: true,
    x: 0.5,
    y: 0.5,
    w: 0.5,
    opacity: 1,
    anim: 'pop',
    start: 0,
    end: introEnd(tl),
  };
}
