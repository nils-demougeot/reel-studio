// Modèles de reels : rythme, musique, textes, logo et cartons appliqués automatiquement
// aux photos. Tout reste modifiable ensuite dans l'éditeur.
//
// Les positions des textes / logos sont exprimées en temps musicaux, par rapport
// au début ou à la fin de la vidéo, pour s'adapter au nombre de photos.

import { beatLength, computeTimeline, newClip, newTextOverlay, newStickerOverlay, snapToBeat, TEXT_PRESETS } from './model.js';
import { uid } from './util.js';

export const DURATION_CHOICES = [
  { id: 'template', label: 'Selon le modèle' },
  { id: 15, label: '≈ 15 s' },
  { id: 30, label: '≈ 30 s' },
  { id: 60, label: '≈ 60 s' },
  { id: 'music', label: 'Toute la musique' },
];

const title = (extra = {}) => ({ type: 'text', preset: 'title', text: '{titre}', ...extra });
const subtitle = (extra = {}) => ({ type: 'text', preset: 'subtitle', text: '{sous-titre}', ...extra });
const logo = (extra = {}) => ({ type: 'logo', ...extra });

export const BUILTIN_TEMPLATES = [
  {
    id: 'builtin-express',
    builtin: true,
    name: 'Récap express',
    description: 'Une photo par demi-temps, titre percutant pendant 2 mesures, logo sur un carton final.',
    color: '#ff5b2e',
    rhythm: { beats: 0.5, pattern: [], endOnBar: true },
    fit: 'contain', motion: 'none',
    outroCard: { beats: 4, color: '#000000' },
    overlays: [
      { anchor: 'start', offset: 0, len: 8, data: title({ preset: 'impact', font: 'anton', weight: 400, size: 150, style: 'outline', bgColor: '#000000', uppercase: true, y: 0.44, anim: 'pop' }) },
      { anchor: 'start', offset: 0, len: 8, data: subtitle({ font: 'montserrat', weight: 800, size: 54, style: 'lines', bgColor: '#ff5b2e', y: 0.56, anim: 'rise' }) },
      { anchor: 'end', offset: 0, len: 4, data: logo({ x: 0.5, y: 0.5, w: 0.5, anim: 'pop' }) },
    ],
  },
  {
    id: 'builtin-classique',
    builtin: true,
    name: 'Classique',
    description: 'Une photo par temps avec un léger zoom, titre et sous-titre en intro, logo à la fin.',
    color: '#4aa8ff',
    rhythm: { beats: 1, pattern: [], endOnBar: true },
    fit: 'contain', motion: 'zoomIn',
    outroCard: { beats: 4, color: '#000000' },
    overlays: [
      { anchor: 'start', offset: 0, len: 4, data: title({ font: 'montserrat', weight: 900, size: 110, style: 'none', y: 0.43, anim: 'pop' }) },
      { anchor: 'start', offset: 0, len: 4, data: subtitle({ font: 'montserrat', weight: 700, size: 56, style: 'none', y: 0.52, anim: 'rise' }) },
      { anchor: 'end', offset: 0, len: 4, data: logo({ x: 0.5, y: 0.5, w: 0.45, anim: 'fade' }) },
    ],
  },
  {
    id: 'builtin-montee',
    builtin: true,
    name: 'Montée en puissance',
    description: '4 premières photos lentes sous le titre, puis tout s\'accélère au demi-temps.',
    color: '#8b7bff',
    rhythm: { beats: 0.5, pattern: [2, 2, 2, 2], endOnBar: true },
    fit: 'contain', motion: 'zoomIn',
    outroCard: { beats: 4, color: '#000000' },
    overlays: [
      { anchor: 'start', offset: 0, len: 8, data: title({ font: 'montserrat', weight: 900, size: 120, style: 'none', y: 0.43, anim: 'fade' }) },
      { anchor: 'start', offset: 0, len: 8, data: subtitle({ font: 'inter', weight: 800, size: 52, style: 'lines', bgColor: '#8b7bff', y: 0.53, anim: 'rise' }) },
      { anchor: 'end', offset: 0, len: 4, data: logo({ x: 0.5, y: 0.5, w: 0.45, anim: 'pop' }) },
    ],
  },
  {
    id: 'builtin-souvenirs',
    builtin: true,
    name: 'Souvenirs',
    description: 'Rythme posé (2 temps), fond flouté, titre manuscrit et « Merci à tous » à la fin.',
    color: '#ffd23f',
    rhythm: { beats: 2, pattern: [], endOnBar: true },
    fit: 'blur', motion: 'zoomIn',
    outroCard: null,
    overlays: [
      { anchor: 'start', offset: 0, len: 4, data: title({ font: 'caveat', weight: 700, size: 130, style: 'none', uppercase: false, y: 0.45, anim: 'fade' }) },
      { anchor: 'start', offset: 0, len: 4, data: subtitle({ font: 'inter', weight: 700, size: 50, y: 0.54, anim: 'fade' }) },
      { anchor: 'end', offset: 0, len: 4, data: { type: 'text', preset: 'hand', text: 'Merci à tous !', font: 'caveat', weight: 700, size: 120, y: 0.42, anim: 'fade' } },
      { anchor: 'end', offset: 0, len: 4, data: logo({ x: 0.5, y: 0.62, w: 0.3, anim: 'fade' }) },
    ],
  },
  {
    id: 'builtin-30s',
    builtin: true,
    name: 'Format 30 s',
    description: 'Le rythme s\'adapte au nombre de photos pour tenir en 30 secondes environ. Logo discret tout du long.',
    color: '#2fc48d',
    rhythm: { beats: 1, pattern: [], endOnBar: true },
    duration: 30,
    fit: 'contain', motion: 'zoomIn',
    outroCard: null,
    overlays: [
      { anchor: 'start', offset: 0, len: 4, data: title({ preset: 'label', font: 'inter', weight: 800, size: 76, style: 'lines', bgColor: '#2fc48d', color: '#ffffff', uppercase: false, y: 0.45, anim: 'pop' }) },
      { anchor: 'start', offset: 0, len: 4, data: subtitle({ font: 'inter', weight: 700, size: 46, y: 0.53, anim: 'rise' }) },
      { anchor: 'all', offset: 0, len: 0, data: logo({ x: 0.15, y: 0.07, w: 0.18, opacity: 0.9, anim: 'none' }) },
    ],
  },
];

// ---------- application ----------

const BEAT_STEPS = [0.25, 0.5, 1, 2, 4];

// Choisit la durée (en temps) par photo pour approcher la durée visée.
function beatsForTarget(fixedBeats, count, targetBeats, base) {
  if (count <= 0) return base;
  const allowed = BEAT_STEPS.filter((b) => b >= base / 4 && b <= base * 4);
  let best = base, bestErr = Infinity;
  for (const b of allowed) {
    const err = Math.abs(fixedBeats + count * b - targetBeats);
    if (err < bestErr - 1e-9) { bestErr = err; best = b; }
  }
  return best;
}

// Applique le modèle au projet (à appeler dans un commit).
// opts : { title, subtitle, logo: { file, iw, ih } | null, target: 'template' | nombre | 'music' }
export function applyTemplate(p, tpl, opts = {}) {
  p.defaults.fit = tpl.fit || p.defaults.fit;
  p.defaults.motion = tpl.motion || p.defaults.motion;
  p.defaults.beats = tpl.rhythm?.beats ?? p.defaults.beats;
  if (tpl.background) p.settings.background = tpl.background;
  if (tpl.fadeOut != null) p.export.fadeOut = tpl.fadeOut;

  // Les cartons et calques existants sont remplacés par ceux du modèle.
  const clips = p.clips.filter((c) => c.kind !== 'color');
  const L = beatLength(p);
  const rhythm = { beats: 1, pattern: [], endOnBar: true, ...tpl.rhythm };

  let fixedBeats = 0;
  let photoCount = 0;
  for (const c of clips) {
    const isVideo = p.media[c.mediaId]?.type === 'video';
    c.fit = p.defaults.fit;
    if (!isVideo) { c.motion = p.defaults.motion; photoCount++; } else fixedBeats += c.beats;
  }
  const pattern = rhythm.pattern.slice(0, photoCount);
  fixedBeats += pattern.reduce((a, b) => a + b, 0);
  fixedBeats += (tpl.introCard?.beats || 0) + (tpl.outroCard?.beats || 0);

  let target = opts.target ?? 'template';
  if (target === 'template') target = tpl.duration ?? null;
  if (target === 'music') target = p.music ? p.music.duration - p.music.start : null;
  const beats = target ? beatsForTarget(fixedBeats, photoCount - pattern.length, target / L, rhythm.beats) : rhythm.beats;

  let k = 0;
  for (const c of clips) {
    if (p.media[c.mediaId]?.type === 'video') continue;
    c.beats = k < pattern.length ? pattern[k] : beats;
    k++;
  }

  const card = (spec) => ({ ...newClip(p, null), color: spec.color || '#000000', beats: spec.beats || 4 });
  p.clips = [
    ...(tpl.introCard ? [card(tpl.introCard)] : []),
    ...clips,
    ...(tpl.outroCard ? [card(tpl.outroCard)] : []),
  ];

  // Finir sur une mesure complète (4 temps) : la coupe finale tombe avec la musique.
  if (rhythm.endOnBar && p.clips.length) {
    const sum = p.clips.reduce((a, c) => a + c.beats, 0);
    const r = sum % 4;
    if (r > 1e-6 && 4 - r > 1e-6) p.clips[p.clips.length - 1].beats += 4 - r;
  }

  const tl = computeTimeline(p);
  p.overlays = (tpl.overlays || []).map((e) => instantiateOverlay(p, tl, e, opts)).filter(Boolean);
  return { target, beats };
}

function instantiateOverlay(p, tl, entry, opts) {
  const L = beatLength(p);
  const total = tl.total;
  const { type, preset, ...data } = structuredClone(entry.data);
  let ov;
  if (type === 'logo') {
    // Emplacement « logo » du modèle : sticker image avec le logo choisi.
    if (!opts.logo) return null;
    const info = { file: opts.logo.file, kind: 'image', iw: opts.logo.iw, ih: opts.logo.ih };
    ov = { ...newStickerOverlay(p, info, tl), ...data, ...info };
  } else {
    ov = { ...newTextOverlay(p, TEXT_PRESETS[preset] ? preset : 'title', tl), ...data };
    ov.text = String(ov.text || '')
      .replaceAll('{titre}', opts.title || '')
      .replaceAll('{sous-titre}', opts.subtitle || '')
      .trim();
    if (!ov.text) return null;
  }
  let start, end;
  if (entry.anchor === 'all') { start = 0; end = total; }
  else if (entry.anchor === 'end') { end = total - entry.offset * L; start = end - entry.len * L; }
  else { start = entry.offset * L; end = start + entry.len * L; }
  // Calage sur la coupe la plus proche, pour que le texte apparaisse avec une photo.
  const cuts = [...tl.starts, total];
  const snap = (t) => cuts.reduce((b, c) => (Math.abs(c - t) < Math.abs(b - t) ? c : b), t);
  start = Math.max(0, snap(start));
  end = Math.min(total, snap(end));
  if (end - start < 0.2) return null;
  return { ...ov, id: uid(type === 'logo' ? 's' : 't'), start, end };
}

// ---------- capture d'un montage existant ----------

// Transforme le projet courant en modèle réutilisable. Les fichiers (musique, logo)
// doivent avoir été copiés dans la bibliothèque : `files` donne leurs noms.
export function captureTemplate(p, { name, description, musicFile, logoFiles }) {
  const L = beatLength(p);
  const tl = computeTimeline(p);
  const totalB = tl.total / L;
  const photoBeats = p.clips.filter((c) => p.media[c.mediaId]?.type === 'image').map((c) => c.beats);
  const counts = new Map();
  for (const b of photoBeats) counts.set(b, (counts.get(b) || 0) + 1);
  const beats = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? p.defaults.beats;
  let last = -1;
  photoBeats.slice(0, 8).forEach((b, i) => { if (b !== beats) last = i; });
  const pattern = photoBeats.slice(0, last + 1);

  const first = p.clips[0], lastClip = p.clips[p.clips.length - 1];
  const introCard = first?.kind === 'color' ? { beats: first.beats, color: first.color } : null;
  const outroCard = lastClip?.kind === 'color' && lastClip !== first ? { beats: lastClip.beats, color: lastClip.color } : null;

  // Le premier texte devient {titre}, le texte suivant qui démarre en même temps devient {sous-titre}.
  const texts = p.overlays.filter((o) => o.type === 'text').sort((a, b) => a.start - b.start || a.y - b.y);
  const titleOv = texts[0];
  const subOv = texts.find((o) => o !== titleOv && Math.abs(o.start - (titleOv?.start ?? -1)) < 0.05);

  // Le premier sticker image devient l'emplacement « logo » ; les autres stickers ne sont pas repris.
  const logoOv = p.overlays.find((o) => o.type === 'sticker' && o.kind === 'image');
  const overlays = p.overlays.filter((o) => o.type === 'text' || o === logoOv || (o.type === 'sticker' && o.file === logoOv?.file)).map((o) => {
    const { id, start, end, ...data } = structuredClone(o);
    if (o === titleOv) data.text = '{titre}';
    if (o === subOv) data.text = '{sous-titre}';
    if (o.type === 'sticker') {
      for (const k of ['file', 'iw', 'ih', 'kind', 'duration', 'loop']) delete data[k];
      data.type = 'logo';
    }
    const sB = start / L, eB = end / L;
    if (start < 0.05 && end > tl.total - 0.05) return { anchor: 'all', offset: 0, len: 0, data };
    if (start <= tl.total - end) return { anchor: 'start', offset: sB, len: eB - sB, data };
    return { anchor: 'end', offset: totalB - eB, len: eB - sB, data };
  });

  return {
    id: `t${Date.now().toString(36)}`,
    name,
    description: description || `${({ 0.25: '¼', 0.5: '½' })[beats] ?? beats} temps par photo${p.music ? ` · ${p.music.name.replace(/\.[^.]+$/, '')}` : ''}`,
    createdAt: Date.now(),
    color: '#ff5b2e',
    rhythm: { beats, pattern, endOnBar: true },
    fit: p.defaults.fit,
    motion: p.defaults.motion,
    background: p.settings.background,
    fadeOut: p.export.fadeOut,
    introCard,
    outroCard,
    music: p.music && musicFile ? {
      file: musicFile, name: p.music.name, start: p.music.start, volume: p.music.volume ?? 1,
      bpm: p.rhythm.bpm, offset: p.rhythm.offset,
    } : null,
    logo: logoFiles?.[0] || null,
    overlays,
  };
}

// Début de musique : passage du modèle, passage le plus énergique, ou début du morceau.
export function musicStartFor(p, mode, tplMusic, best) {
  if (mode === 'template' && tplMusic) return snapToBeat(p, tplMusic.start);
  if (mode === 'auto' && best != null) return best;
  return snapToBeat(p, 0);
}
