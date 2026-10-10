// État central de l'éditeur : projet courant, sélection, lecture,
// historique (annuler / rétablir) et sauvegarde automatique.

import * as api from './api.js';
import { normalizeProject, computeTimeline, musicSegments } from './model.js';

const HISTORY_LIMIT = 150;
const listeners = {};
const backupKey = (id) => `reel-studio-backup-${id}`;

export const store = {
  project: null,
  tl: { starts: [], durs: [], total: 0 },
  sel: { type: null, ids: [], anchor: null },
  activeTrack: 'clips', // piste visée par « Couper » : 'clips' ou 'music'
  time: 0,
  playing: false,
  saveState: 'saved',
  undoStack: [],
  redoStack: [],
  lastKey: null,
  lastKeyTime: 0,
};

let scope = null;

export function on(evt, fn) {
  (listeners[evt] ||= new Set()).add(fn);
  const off = () => listeners[evt].delete(fn);
  if (scope) scope.push(off);
  return off;
}

// Exécute `fn` en notant tous les abonnements créés, pour pouvoir les retirer ensemble.
export function collectListeners(fn) {
  const prev = scope;
  scope = [];
  try {
    const result = fn();
    return { result, offs: scope };
  } finally {
    scope = prev;
  }
}

export function emit(evt, detail) {
  for (const fn of listeners[evt] || []) fn(detail);
}

// ---------- ouverture ----------

export async function openProject(id) {
  let p = await api.getProject(id);
  // Si le navigateur a une version plus récente non enregistrée (coupure, serveur arrêté…), on la reprend.
  try {
    const raw = localStorage.getItem(backupKey(id));
    if (raw) {
      const local = JSON.parse(raw);
      if ((local.updatedAt || 0) > (p.updatedAt || 0)) {
        p = local;
        scheduleSave();
      } else localStorage.removeItem(backupKey(id));
    }
  } catch { /* stockage local indisponible */ }
  store.project = normalizeProject(p);
  store.tl = computeTimeline(store.project);
  store.sel = { type: null, ids: [], anchor: null };
  store.time = 0;
  store.playing = false;
  store.undoStack = [];
  store.redoStack = [];
  store.saveState = 'saved';
  emit('project', { source: 'open' });
  emit('select');
  emit('time');
  emit('save');
}

export function closeProject() {
  saveNow();
  store.project = null;
}

// ---------- modifications ----------

// Applique une modification au projet. `key` permet de fusionner une série de
// petites modifications (glisser un curseur…) en une seule étape d'annulation.
export function commit(mutate, { key = null, source = null } = {}) {
  const p = store.project;
  if (!p) return;
  const now = performance.now();
  const merge = key && key === store.lastKey && now - store.lastKeyTime < 1200;
  const before = merge ? null : JSON.stringify(p);
  const result = mutate(p);
  if (result === false) return; // rien n'a changé
  if (before) {
    store.undoStack.push(before);
    if (store.undoStack.length > HISTORY_LIMIT) store.undoStack.shift();
    store.redoStack = [];
  }
  store.lastKey = key;
  store.lastKeyTime = now;
  afterChange(source);
}

function afterChange(source) {
  const p = store.project;
  p.updatedAt = Date.now();
  store.tl = computeTimeline(p);
  sanitizeSelection();
  if (store.time > store.tl.total) store.time = store.tl.total;
  try { localStorage.setItem(backupKey(p.id), JSON.stringify(p)); } catch { /* quota */ }
  scheduleSave();
  emit('project', { source });
}

function restore(json) {
  store.project = normalizeProject(JSON.parse(json));
  store.lastKey = null;
  afterChange('history');
  emit('select');
}

export function undo() {
  if (!store.undoStack.length) return;
  store.redoStack.push(JSON.stringify(store.project));
  restore(store.undoStack.pop());
}

export function redo() {
  if (!store.redoStack.length) return;
  store.undoStack.push(JSON.stringify(store.project));
  restore(store.redoStack.pop());
}

// ---------- sélection ----------

export function select(type, ids = [], anchor = null) {
  store.sel = { type: ids.length ? type : null, ids: [...ids], anchor: anchor ?? ids[ids.length - 1] ?? null };
  if (type === 'music' || type === 'clips') store.activeTrack = type;
  emit('select');
}

export function setActiveTrack(track) {
  if (store.activeTrack === track) return;
  store.activeTrack = track;
  emit('select');
}

export const isSelected = (type, id) => store.sel.type === type && store.sel.ids.includes(id);

export function selectedClips() {
  if (store.sel.type !== 'clips') return [];
  const ids = new Set(store.sel.ids);
  return store.project.clips.filter((c) => ids.has(c.id));
}

export function selectedOverlay() {
  if (store.sel.type !== 'overlay') return null;
  return store.project.overlays.find((o) => o.id === store.sel.ids[0]) || null;
}

function sanitizeSelection() {
  const { sel, project } = store;
  if (!sel.type) return;
  const valid = new Set(sel.type === 'music'
    ? musicSegments(project).map((s) => s.key)
    : (sel.type === 'clips' ? project.clips : project.overlays).map((x) => x.id));
  const ids = sel.ids.filter((id) => valid.has(id));
  if (ids.length !== sel.ids.length) {
    store.sel = { type: ids.length ? sel.type : null, ids, anchor: ids.includes(sel.anchor) ? sel.anchor : ids[0] ?? null };
    queueMicrotask(() => emit('select'));
  }
}

// ---------- tête de lecture ----------

export function setTime(t, { fromPlayback = false } = {}) {
  store.time = Math.max(0, Math.min(t, store.tl.total));
  emit('time', { fromPlayback });
}

export function setPlaying(v) {
  if (store.playing === v) return;
  store.playing = v;
  emit('play');
}

// ---------- sauvegarde ----------

let saveTimer = null;
let saving = false;
let dirty = false;

function setSaveState(s) {
  store.saveState = s;
  emit('save');
}

export function scheduleSave() {
  dirty = true;
  setSaveState('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

export async function saveNow() {
  clearTimeout(saveTimer);
  const p = store.project;
  if (!p || !dirty) return;
  if (saving) { saveTimer = setTimeout(saveNow, 300); return; }
  saving = true;
  dirty = false;
  setSaveState('saving');
  try {
    await api.saveProject(p);
    if (!dirty) {
      setSaveState('saved');
      try { localStorage.removeItem(backupKey(p.id)); } catch { /* rien */ }
    }
  } catch (err) {
    console.error(err);
    dirty = true;
    setSaveState('error');
    saveTimer = setTimeout(saveNow, 4000);
  } finally {
    saving = false;
  }
}

export const hasUnsavedChanges = () => dirty || saving;

window.addEventListener('beforeunload', (e) => {
  if (store.project && hasUnsavedChanges()) {
    saveNow();
    e.preventDefault();
    e.returnValue = '';
  }
});
