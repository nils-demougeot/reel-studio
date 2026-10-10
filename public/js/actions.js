// Actions de montage, appelées depuis les différents panneaux et raccourcis clavier.

import * as api from './api.js';
import { store, commit, select, selectedClips, emit, setTime } from './store.js';
import {
  newClip, newTextOverlay, newLogoOverlay, snapToBeat, beatLength, clipIndexAt, musicSegments, songTimeAt,
} from './model.js';
import { importFiles, uploadLogo } from './media.js';
import { decodeAudio, computePeaks, detectTempo, findBestPassage, Player } from './audio.js';
import { applyTemplate, captureTemplate } from './templates.js';
import { imageSize } from './library.js';
import { toast, pickFiles, uid, naturalCompare } from './util.js';

export const player = new Player();

// Musique décodée (non enregistrée dans le projet : recalculée à l'ouverture).
export const music = { file: null, buffer: null, peaks: null };

export async function loadProjectMusic() {
  const m = store.project?.music;
  if (!m) { music.file = null; music.buffer = null; music.peaks = null; player.buffer = null; emit('music'); return; }
  if (music.file === m.file && music.buffer) return;
  try {
    const buffer = await decodeAudio(api.fileUrl(store.project.id, 'media', m.file));
    music.file = m.file;
    music.buffer = buffer;
    music.peaks = computePeaks(buffer);
    player.buffer = buffer;
    emit('music');
  } catch (err) {
    console.error(err);
    toast('Impossible de lire la musique.', { type: 'warn' });
  }
}

// ---------- import ----------

// Insère après la sélection courante, sinon à la fin.
function insertionIndex() {
  const p = store.project;
  if (store.sel.type === 'clips' && store.sel.ids.length) {
    const idx = p.clips.map((c, i) => (store.sel.ids.includes(c.id) ? i : -1)).filter((i) => i >= 0);
    return Math.max(...idx) + 1;
  }
  return p.clips.length;
}

export async function importInto(files, { ignoreAudio = false } = {}) {
  const p = store.project;
  const key = uid('import');
  let at = insertionIndex();
  await importFiles(p.id, files, {
    onMedia: (list) => {
      commit((proj) => {
        const clips = list.map((m) => { proj.media[m.id] = m; return newClip(proj, m); });
        proj.clips.splice(at, 0, ...clips);
        at += clips.length;
      }, { key });
    },
    onAudio: ignoreAudio ? null : (file) => setMusicFile(file),
  });
}

export async function pickAndImport(directory) {
  const files = await pickFiles({ directory, accept: directory ? '' : 'image/*,video/*,audio/*' });
  if (files.length) await importInto(files);
}

// ---------- musique ----------

export async function setMusicFile(file) {
  const p = store.project;
  const t = toast('Analyse de la musique…', { timeout: 0 });
  try {
    const buffer = await decodeAudio(file);
    const name = await api.uploadFile(p.id, 'media', file.name, file, { unique: true });
    const tempo = detectTempo(buffer);
    music.file = name;
    music.buffer = buffer;
    music.peaks = computePeaks(buffer);
    player.buffer = buffer;
    commit((proj) => {
      proj.music = { file: name, name: file.name, duration: buffer.duration, start: 0, volume: 1, cuts: [], removed: [] };
      if (tempo) {
        proj.rhythm.bpm = tempo.bpm;
        proj.rhythm.offset = tempo.offset;
        proj.music.start = snapToBeat(proj, 0);
      }
    });
    emit('music');
    t.close();
    toast(tempo ? `Musique ajoutée — tempo détecté : ${tempo.bpm} BPM` : 'Musique ajoutée', { type: 'ok' });
    // Rangée aussi dans la bibliothèque, pour la retrouver dans les prochains projets.
    api.copyToLibrary(p.id, 'musiques', name)
      .then((libFile) => api.setLibraryMeta('musiques', libFile, {
        name: file.name.replace(/\.[^.]+$/, ''), duration: buffer.duration, ...(tempo || {}),
      }))
      .catch(() => {});
  } catch (err) {
    console.error(err);
    t.close();
    toast(`Musique illisible : ${file.name}`, { type: 'warn' });
  }
}

export async function pickMusic() {
  const [file] = await pickFiles({ accept: 'audio/*', multiple: false });
  if (file) await setMusicFile(file);
}

export function removeMusic() {
  commit((p) => { p.music = null; });
  loadProjectMusic();
}

export function redetectTempo() {
  if (!music.buffer) return;
  const tempo = detectTempo(music.buffer);
  if (!tempo) return toast('Tempo non détecté, saisissez-le ou tapez-le en rythme.', { type: 'warn' });
  commit((p) => {
    p.rhythm.bpm = tempo.bpm;
    p.rhythm.offset = tempo.offset;
    p.music.start = snapToBeat(p, p.music.start);
  });
  toast(`Tempo détecté : ${tempo.bpm} BPM`, { type: 'ok' });
}

export function setBpm(bpm, key = 'bpm') {
  if (!(bpm >= 30 && bpm <= 300)) return;
  commit((p) => {
    p.rhythm.bpm = Math.round(bpm * 100) / 100;
    if (p.music) p.music.start = snapToBeat(p, p.music.start);
  }, { key });
}

// Décale le début de la musique d'un nombre de temps.
export function shiftMusic(beats) {
  commit((p) => {
    if (!p.music) return false;
    const L = beatLength(p);
    p.music.start = snapToBeat(p, Math.max(0, Math.min(p.music.duration - L, p.music.start + beats * L)));
  }, { key: 'music-shift' });
}

// ---------- clips ----------

export function setBeatsForSelection(beats) {
  const ids = new Set(store.sel.ids);
  commit((p) => { for (const c of p.clips) if (ids.has(c.id)) c.beats = beats; }, { key: `beats-${[...ids].join()}` });
}

export function setBeatsForAll(beats) {
  commit((p) => {
    p.defaults.beats = beats;
    for (const c of p.clips) {
      const m = p.media[c.mediaId];
      if (m?.type !== 'video') c.beats = beats;
    }
  });
}

export function updateSelectedClips(patch, key) {
  const ids = new Set(store.sel.ids);
  // Une clé = réglage continu depuis le panneau (curseur, couleur) : pas de reconstruction du panneau.
  commit((p) => { for (const c of p.clips) if (ids.has(c.id)) Object.assign(c, typeof patch === 'function' ? patch(c) : patch); }, { key, source: key ? 'inspector' : null });
}

export function updateAllClips(patch) {
  commit((p) => {
    for (const c of p.clips) Object.assign(c, patch);
    for (const [k, v] of Object.entries(patch)) if (k in p.defaults) p.defaults[k] = v;
  });
}

export function deleteSelection() {
  const { type, ids } = store.sel;
  if (!type) return;
  const set = new Set(ids);
  if (type === 'music') { deleteMusicSegments(ids); return; }
  commit((p) => {
    if (type === 'clips') p.clips = p.clips.filter((c) => !set.has(c.id));
    else p.overlays = p.overlays.filter((o) => !set.has(o.id));
  });
  select(null);
}

// ---------- découpe ----------

// Coupe à la tête de lecture, sur la piste active (médias ou musique).
// `free` : coupe exacte, sans se caler sur la grille des temps.
export function splitAtPlayhead({ free = false } = {}) {
  if (store.activeTrack === 'music') return splitMusic(free);
  const p = store.project;
  const { starts } = store.tl;
  const i = clipIndexAt(store.tl, store.time);
  if (i < 0) return toast('Placez la tête de lecture sur un média pour le couper.');
  const clip = p.clips[i];
  const L = beatLength(p);
  const exact = (store.time - starts[i]) / L;
  // Calé sur le quart de temps le plus proche pour rester en rythme avec la musique.
  let left = free ? exact : Math.round(exact * 4) / 4;
  if (left <= 0 || left >= clip.beats) left = exact;
  if (left * L < 0.04 || (clip.beats - left) * L < 0.04) return toast('Trop près du début ou de la fin du média.');
  const right = { ...clip, id: uid('c'), beats: clip.beats - left };
  if (p.media[clip.mediaId]?.type === 'video') right.trim = (clip.trim || 0) + left * L;
  commit((proj) => {
    proj.clips.find((c) => c.id === clip.id).beats = left;
    proj.clips.splice(i + 1, 0, right);
  });
  select('clips', [right.id]);
}

function splitMusic(free) {
  const p = store.project;
  if (!p.music) return toast('Il n’y a pas de musique à couper.');
  let song = songTimeAt(p, store.time);
  if (song == null) return toast('La tête de lecture est après la fin de la musique.');
  if (!free) song = snapToBeat(p, song);
  const segs = musicSegments(p);
  if (segs.some((s) => Math.abs(s.from - song) < 0.05 || Math.abs(s.to - song) < 0.05)) return toast('Il y a déjà une coupe à cet endroit.');
  if (!segs.some((s) => song > s.from && song < s.to)) return;
  commit((proj) => { proj.music.cuts = [...proj.music.cuts, song].sort((a, b) => a - b); });
  select('music', [song.toFixed(4)]);
}

// Supprime des passages de musique : la suite se recolle immédiatement.
export function deleteMusicSegments(keys) {
  const segs = musicSegments(store.project).filter((s) => keys.includes(s.key));
  if (!segs.length) return;
  commit((p) => {
    const ranges = [...p.music.removed, ...segs.map((s) => ({ from: s.from, to: s.to }))].sort((a, b) => a.from - b.from);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r.from <= last.to + 1e-3) last.to = Math.max(last.to, r.to);
      else merged.push({ ...r });
    }
    p.music.removed = merged;
  });
  select(null);
}

export function restoreFullMusic() {
  commit((p) => {
    if (!p.music || (!p.music.cuts.length && !p.music.removed.length)) return false;
    p.music.cuts = [];
    p.music.removed = [];
  });
  select(null);
}

export function duplicateSelection() {
  const { type, ids } = store.sel;
  if (type === 'clips') {
    const set = new Set(ids);
    const created = [];
    commit((p) => {
      const sel = p.clips.filter((c) => set.has(c.id));
      const last = Math.max(...p.clips.map((c, i) => (set.has(c.id) ? i : -1)));
      const copies = sel.map((c) => ({ ...c, id: uid('c') }));
      created.push(...copies.map((c) => c.id));
      p.clips.splice(last + 1, 0, ...copies);
    });
    select('clips', created);
  } else if (type === 'overlay') {
    const ov = store.project.overlays.find((o) => o.id === ids[0]);
    if (!ov) return;
    const copy = { ...ov, id: uid(ov.type === 'text' ? 't' : 'l'), y: Math.min(0.95, ov.y + 0.05) };
    commit((p) => { p.overlays.push(copy); });
    select('overlay', [copy.id]);
  }
}

// Déplace les clips sélectionnés vers l'index `to` (index dans la liste d'origine).
export function moveClipsTo(ids, to) {
  const set = new Set(ids);
  commit((p) => {
    const moving = p.clips.filter((c) => set.has(c.id));
    const before = p.clips.slice(0, to).filter((c) => !set.has(c.id));
    const after = p.clips.slice(to).filter((c) => !set.has(c.id));
    const next = [...before, ...moving, ...after];
    if (next.every((c, i) => c === p.clips[i])) return false;
    p.clips = next;
  });
}

export function nudgeSelection(delta) {
  if (store.sel.type !== 'clips') return;
  const p = store.project;
  const set = new Set(store.sel.ids);
  const idx = p.clips.map((c, i) => (set.has(c.id) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return;
  const to = delta < 0 ? Math.max(0, idx[0] - 1) : Math.min(p.clips.length, idx[idx.length - 1] + 2);
  moveClipsTo(store.sel.ids, to);
}

// Réorganise la sélection (ou tout le montage si rien n'est sélectionné).
function reorder(fn) {
  const p = store.project;
  const set = store.sel.type === 'clips' && store.sel.ids.length > 1 ? new Set(store.sel.ids) : null;
  commit((proj) => {
    const positions = proj.clips.map((c, i) => (!set || set.has(c.id) ? i : -1)).filter((i) => i >= 0);
    const items = fn(positions.map((i) => proj.clips[i]), proj);
    positions.forEach((pos, k) => { proj.clips[pos] = items[k]; });
  });
  return p;
}

export function shuffleClips() {
  reorder((items) => {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  });
}

export const reverseClips = () => reorder((items) => [...items].reverse());

export function sortClips(by) {
  reorder((items, p) => [...items].sort((a, b) => {
    const ma = p.media[a.mediaId], mb = p.media[b.mediaId];
    if (!ma || !mb) return 0;
    return by === 'date' ? (ma.date || 0) - (mb.date || 0) : naturalCompare(ma.name, mb.name);
  }));
}

export function addColorCard() {
  const p = store.project;
  const at = insertionIndex();
  const clip = { ...newClip(p, null), beats: 4 };
  commit((proj) => { proj.clips.splice(at, 0, clip); });
  select('clips', [clip.id]);
  setTime(store.tl.starts[at] ?? 0);
}

export function addMediaClip(mediaId) {
  const p = store.project;
  const at = insertionIndex();
  const clip = newClip(p, p.media[mediaId]);
  commit((proj) => { proj.clips.splice(at, 0, clip); });
  select('clips', [clip.id]);
}

// ---------- calques ----------

export function addText(preset = 'title') {
  const ov = newTextOverlay(store.project, preset, store.tl);
  // Placé au niveau de la tête de lecture si elle n'est pas au début.
  if (store.time > 0.05 && store.time < store.tl.total) {
    const d = ov.end - ov.start;
    ov.start = store.time;
    ov.end = Math.min(store.tl.total || store.time + d, store.time + d);
    if (ov.end - ov.start < 0.3) ov.end = ov.start + d;
  }
  commit((p) => { p.overlays.push(ov); });
  select('overlay', [ov.id]);
  if (store.time < ov.start || store.time >= ov.end) setTime(ov.start + 0.4);
  emit('focus-text');
}

export async function addLogo() {
  const [file] = await pickFiles({ accept: 'image/png,image/svg+xml,image/webp,image/jpeg', multiple: false });
  if (!file) return;
  try {
    const { file: name, w, h } = await uploadLogo(store.project.id, file);
    const ov = newLogoOverlay(store.project, name, w, h, store.tl);
    commit((p) => { p.overlays.push(ov); });
    select('overlay', [ov.id]);
    if (store.time >= ov.end) setTime(0.4);
  } catch (err) {
    console.error(err);
    toast('Image de logo illisible.', { type: 'warn' });
  }
}

export async function replaceLogo(ovId) {
  const [file] = await pickFiles({ accept: 'image/*', multiple: false });
  if (!file) return;
  const { file: name, w, h } = await uploadLogo(store.project.id, file);
  commit((p) => {
    const ov = p.overlays.find((o) => o.id === ovId);
    if (ov) Object.assign(ov, { file: name, iw: w, ih: h });
  });
}

export function updateOverlay(id, patch, key) {
  commit((p) => {
    const ov = p.overlays.find((o) => o.id === id);
    if (!ov) return false;
    Object.assign(ov, patch);
  }, { key, source: key ? 'inspector' : null });
}

// ---------- bibliothèque & modèles ----------

function setDecoded(name, buffer) {
  music.file = name;
  music.buffer = buffer;
  music.peaks = computePeaks(buffer);
  player.buffer = buffer;
}

// Utilise une musique de la bibliothèque dans le projet courant.
// `start` : début souhaité dans le morceau (sinon le premier temps).
export async function useLibraryMusic(item, { start = null } = {}) {
  const p = store.project;
  const name = await api.copyFromLibrary(p.id, 'musiques', item.file);
  const buffer = await decodeAudio(api.fileUrl(p.id, 'media', name));
  let { bpm, offset } = item;
  if (!bpm) {
    ({ bpm, offset } = detectTempo(buffer) || { bpm: 120, offset: 0 });
    api.setLibraryMeta('musiques', item.file, { bpm, offset, duration: buffer.duration }).catch(() => {});
  }
  setDecoded(name, buffer);
  commit((proj) => {
    proj.music = { file: name, name: item.name, duration: buffer.duration, start: 0, volume: item.volume ?? 1, cuts: [], removed: [] };
    proj.rhythm.bpm = bpm;
    proj.rhythm.offset = offset;
    proj.music.start = snapToBeat(proj, start ?? 0);
  });
  emit('music');
}

// Place le début de la musique sur son passage le plus énergique (calé sur une mesure).
export function autoPassage() {
  const p = store.project;
  if (!p.music || !music.buffer) return;
  const s = findBestPassage(music.buffer, p.rhythm.bpm, p.rhythm.offset, Math.max(5, store.tl.total));
  commit((proj) => { proj.music.start = s; });
}

async function projectLogo(libLogo) {
  if (!libLogo) return null;
  const file = await api.copyFromLibrary(store.project.id, 'logos', libLogo.file);
  const size = libLogo.iw ? libLogo : await imageSize(api.libUrl('logos', libLogo.file));
  return { file, iw: size.iw, ih: size.ih };
}

// Construit (ou reconstruit) le montage à partir d'un modèle.
// cfg : { template, title, subtitle, music: {kind, item}, passage, target, logo }
export async function buildFromTemplate(cfg, files) {
  const t = toast('Application du modèle…', { timeout: 0 });
  try {
    const tpl = cfg.template;
    if (cfg.music?.kind === 'library' && cfg.music.item) {
      const sameAsTemplate = tpl.music && tpl.music.file === cfg.music.item.file;
      await useLibraryMusic(cfg.music.item, { start: cfg.passage === 'template' && sameAsTemplate ? tpl.music.start : null });
    } else if (cfg.music?.kind === 'none' && store.project.music) {
      commit((p) => { p.music = null; });
      await loadProjectMusic();
    }
    if (files?.length) await importInto(files, { ignoreAudio: cfg.music?.kind === 'library' });
    const logo = await projectLogo(cfg.logo);
    let info;
    commit((p) => { info = applyTemplate(p, tpl, { title: cfg.title, subtitle: cfg.subtitle, logo, target: cfg.target }); });
    if (cfg.passage === 'auto' && cfg.target !== 'music' && cfg.music?.kind !== 'keep') autoPassage();
    select(null);
    setTime(0);
    t.close();
    const p = store.project;
    toast(`Modèle « ${tpl.name} » appliqué : ${p.clips.length} médias, ${Math.round(store.tl.total)} s${info?.beats ? `, ${info.beats} temps par photo` : ''}. Tout reste modifiable.`, { type: 'ok', timeout: 6000 });
  } catch (err) {
    console.error(err);
    t.close();
    toast(`Le modèle n'a pas pu être appliqué : ${err.message}`, { type: 'warn', timeout: 8000 });
  }
}

// Enregistre le montage courant comme modèle (musique et logo copiés dans la bibliothèque).
export async function saveAsTemplate(name, description) {
  const p = store.project;
  let musicFile = null;
  if (p.music) {
    musicFile = await api.copyToLibrary(p.id, 'musiques', p.music.file);
    await api.setLibraryMeta('musiques', musicFile, {
      name: p.music.name.replace(/\.[^.]+$/, ''), bpm: p.rhythm.bpm, offset: p.rhythm.offset, duration: p.music.duration,
    }).catch(() => {});
  }
  const logoOv = p.overlays.find((o) => o.type === 'logo');
  let logoFiles = [];
  if (logoOv) {
    const file = await api.copyToLibrary(p.id, 'logos', logoOv.file);
    await api.setLibraryMeta('logos', file, { iw: logoOv.iw, ih: logoOv.ih }).catch(() => {});
    logoFiles = [{ file, iw: logoOv.iw, ih: logoOv.ih }];
  }
  const tpl = captureTemplate(p, { name, description, musicFile, logoFiles });
  await api.saveTemplate(tpl);
  return tpl;
}
