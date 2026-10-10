// Modèle de données d'un projet et calculs de timing.
//
// Les durées des médias sont stockées en « temps » (beats) : changer le tempo
// recale automatiquement tout le montage sur la musique.

import { uid } from './util.js';

export const FRAME_W = 1080;
export const FRAME_H = 1920;

export const FONTS = [
  { id: 'montserrat', family: 'Montserrat', label: 'Montserrat', weights: [400, 700, 800, 900] },
  { id: 'inter', family: 'Inter', label: 'Inter', weights: [400, 700, 800, 900] },
  { id: 'bebas', family: 'Bebas Neue', label: 'Bebas Neue', weights: [400] },
  { id: 'anton', family: 'Anton', label: 'Anton', weights: [400] },
  { id: 'playfair', family: 'Playfair Display', label: 'Playfair', weights: [400, 700, 900] },
  { id: 'caveat', family: 'Caveat', label: 'Caveat', weights: [400, 700] },
];

export const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];

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
  impact: { label: 'Impact', font: 'anton', weight: 400, size: 150, style: 'outline', uppercase: true, y: 0.42, anim: 'pop', spacing: 2 },
  hand: { label: 'Manuscrit', font: 'caveat', weight: 700, size: 110, style: 'none', uppercase: false, y: 0.45, anim: 'fade', spacing: 0 },
};

export const SWATCHES = ['#ffffff', '#111111', '#ff5b2e', '#ffd23f', '#3aa0ff', '#22c08a', '#ff4f9a', '#7c6cff'];

export function normalizeProject(p) {
  p.settings = { width: FRAME_W, height: FRAME_H, background: '#000000', ...p.settings };
  p.rhythm = { bpm: 120, offset: 0, ...p.rhythm };
  p.defaults = { beats: 1, videoBeats: 4, fit: 'contain', motion: 'zoomIn', ...p.defaults };
  p.media = p.media || {};
  p.clips = p.clips || [];
  p.overlays = p.overlays || [];
  p.music = p.music || null;
  p.export = { fps: 30, quality: 'high', fadeOut: 1.5, ...p.export };
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

export function snapToBeat(p, songTime) {
  const L = beatLength(p);
  let k = Math.round((songTime - p.rhythm.offset) / L);
  while (p.rhythm.offset + k * L < 0) k++;
  return p.rhythm.offset + k * L;
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

export function newLogoOverlay(p, file, w, h, tl) {
  return {
    id: uid('l'),
    type: 'logo',
    file,
    iw: w,
    ih: h,
    x: 0.5,
    y: 0.14,
    w: 0.32,
    opacity: 1,
    anim: 'fade',
    start: 0,
    end: introEnd(tl),
  };
}
