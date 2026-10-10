// Bibliothèque partagée entre projets : musiques (avec tempo analysé) et logos.

import * as api from './api.js';
import { analyzeTrack } from './audio.js';
import { h, icon, modal, toast, pickFiles, fmtTime, confirmDialog } from './util.js';

// ---------- musiques ----------

export async function addMusicToLibrary(files) {
  const added = [];
  for (const f of files) {
    try {
      const file = await api.uploadToLibrary('musiques', f);
      const { meta } = await analyzeTrack(api.libUrl('musiques', file));
      const name = f.name.replace(/\.[^.]+$/, '');
      await api.setLibraryMeta('musiques', file, { ...meta, name });
      added.push({ file, name, ...meta });
    } catch (err) {
      console.error(err);
      toast(`Musique illisible : ${f.name}`, { type: 'warn' });
    }
  }
  return added;
}

// Analyse (une seule fois) le tempo d'une musique ajoutée directement dans le dossier.
export async function ensureAnalyzed(item) {
  if (item.bpm) return item;
  const { meta } = await analyzeTrack(api.libUrl('musiques', item.file));
  await api.setLibraryMeta('musiques', item.file, meta).catch(() => {});
  return Object.assign(item, meta);
}

const preview = new Audio();
let previewFile = null;

function togglePreview(item, btn) {
  document.querySelectorAll('.lib-play.is-on').forEach((b) => { b.classList.remove('is-on'); b.replaceChildren(icon('play', 14)); });
  if (previewFile === item.file && !preview.paused) { preview.pause(); previewFile = null; return; }
  preview.src = api.libUrl('musiques', item.file);
  preview.currentTime = item.start || 0;
  preview.play().catch(() => {});
  previewFile = item.file;
  btn.classList.add('is-on');
  btn.replaceChildren(icon('pause', 14));
}

// Fenêtre de gestion de la bibliothèque. `onPick(item)` ajoute un bouton « Utiliser ».
export function openMusicLibrary({ onPick } = {}) {
  const list = h('div', { class: 'lib-list' }, h('p', { class: 'muted' }, 'Chargement…'));
  let alive = true;

  async function refresh() {
    const items = await api.listLibrary('musiques');
    if (!items.length) {
      list.replaceChildren(h('div', { class: 'lib-empty' },
        icon('music', 22),
        h('p', {}, 'Aucune musique pour l\'instant.'),
        h('p', { class: 'muted' }, 'Ajoutez vos fichiers MP3 : le tempo est analysé une fois pour toutes, et ils seront proposés dans chaque projet et chaque modèle.')));
      return;
    }
    const rows = items.map((item) => {
      const bpm = h('span', { class: 'lib-bpm' }, item.bpm ? `${item.bpm} BPM` : 'analyse…');
      const play = h('button', { class: 'btn btn-icon btn-sm lib-play', title: 'Écouter', onclick: () => togglePreview(item, play) }, icon('play', 14));
      const row = h('div', { class: 'lib-row' },
        play,
        h('div', { class: 'lib-name' }, item.name),
        bpm,
        h('span', { class: 'muted lib-dur' }, item.duration ? fmtTime(item.duration, false) : ''),
        onPick ? h('button', { class: 'btn btn-sm btn-accent-soft', onclick: () => { preview.pause(); close(); onPick(item); } }, 'Utiliser') : null,
        h('button', {
          class: 'btn btn-icon btn-sm btn-danger-text', title: 'Retirer de la bibliothèque',
          onclick: async () => {
            if (!(await confirmDialog(`Retirer « ${item.name} » de la bibliothèque ? (Le fichier est déplacé dans bibliotheque/_corbeille.)`, { confirmLabel: 'Retirer', danger: true }))) return;
            await api.deleteLibraryFile('musiques', item.file);
            refresh();
          },
        }, icon('trash', 14)));
      return { row, item, bpm };
    });
    list.replaceChildren(...rows.map((r) => r.row));
    // Analyse en arrière-plan des musiques déposées directement dans le dossier.
    for (const r of rows) {
      if (!alive) break;
      if (r.item.bpm) continue;
      try { await ensureAnalyzed(r.item); r.bpm.textContent = `${r.item.bpm} BPM`; } catch { r.bpm.textContent = 'illisible'; }
    }
  }

  const body = h('div', { class: 'lib' },
    h('div', { class: 'btn-row lib-actions' },
      h('button', {
        class: 'btn btn-primary btn-sm',
        onclick: async () => {
          const files = await pickFiles({ accept: 'audio/*' });
          if (!files.length) return;
          const t = toast(`Analyse de ${files.length} musique(s)…`, { timeout: 0 });
          await addMusicToLibrary(files);
          t.close();
          refresh();
        },
      }, icon('plus', 15), 'Ajouter des musiques'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => api.revealLibrary('musiques') }, icon('folder', 15), 'Ouvrir le dossier'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: refresh }, 'Actualiser')),
    list,
    h('p', { class: 'insp-hint' }, 'Astuce : vous pouvez aussi copier vos MP3 directement dans le dossier « bibliotheque/musiques » de l\'application.'));

  const { close } = modal({
    title: 'Bibliothèque musicale', body, width: 620,
    onClose: () => { alive = false; preview.pause(); previewFile = null; },
    actions: [{ label: 'Fermer', onClick: (c) => c() }],
  });
  refresh();
}

// ---------- logos ----------

export async function addLogoToLibrary(file) {
  const name = await api.uploadToLibrary('logos', file);
  const size = await imageSize(api.libUrl('logos', name));
  await api.setLibraryMeta('logos', name, size);
  return { file: name, ...size };
}

export function imageSize(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ iw: img.naturalWidth, ih: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

// ---------- listes déroulantes ----------

// Liste déroulante de musiques. `extra` : options placées en tête ({ value, label }).
export async function musicSelect({ extra = [], selected = null } = {}) {
  const select = h('select', { class: 'select' });
  let items = [];
  const fill = async (sel) => {
    items = await api.listLibrary('musiques');
    select.replaceChildren(
      ...extra.map((o) => h('option', { value: o.value }, o.label)),
      items.length ? h('optgroup', { label: 'Bibliothèque' }, items.map((it) => h('option', { value: `lib:${it.file}` }, `${it.name}${it.bpm ? ` · ${it.bpm} BPM` : ''}`))) : null,
      h('option', { value: 'add' }, '+ Ajouter une musique…'));
    // Par défaut : la musique demandée, sinon la première de la bibliothèque.
    select.value = sel ?? (items[0] ? `lib:${items[0].file}` : extra[0]?.value ?? '');
    if (!select.value) select.value = items[0] ? `lib:${items[0].file}` : extra[0]?.value ?? '';
  };
  await fill(selected);
  let last = select.value;
  select.addEventListener('change', async () => {
    if (select.value !== 'add') { last = select.value; return; }
    const files = await pickFiles({ accept: 'audio/*' });
    if (!files.length) { select.value = last; return; }
    const t = toast('Analyse de la musique…', { timeout: 0 });
    const [added] = await addMusicToLibrary(files);
    t.close();
    await fill(added ? `lib:${added.file}` : last);
    last = select.value;
  });
  return {
    el: select,
    get value() {
      const v = select.value;
      if (v.startsWith('lib:')) return { kind: 'library', item: items.find((it) => `lib:${it.file}` === v) };
      return { kind: v };
    },
  };
}

export async function logoSelect({ selected = null } = {}) {
  const select = h('select', { class: 'select' });
  let items = [];
  const fill = async (sel) => {
    items = await api.listLibrary('logos');
    select.replaceChildren(
      h('option', { value: '' }, 'Aucun logo'),
      ...items.map((it) => h('option', { value: it.file }, it.name)),
      h('option', { value: 'add' }, '+ Ajouter un logo…'));
    select.value = items.some((it) => it.file === sel) ? sel : (items[0]?.file ?? '');
  };
  await fill(selected ?? localStorage.getItem('reel-last-logo'));
  let last = select.value;
  select.addEventListener('change', async () => {
    if (select.value !== 'add') { last = select.value; localStorage.setItem('reel-last-logo', last); return; }
    const [file] = await pickFiles({ accept: 'image/png,image/svg+xml,image/webp,image/jpeg', multiple: false });
    if (!file) { select.value = last; return; }
    const added = await addLogoToLibrary(file);
    await fill(added.file);
    last = select.value;
    localStorage.setItem('reel-last-logo', last);
  });
  return {
    el: select,
    get value() {
      const it = items.find((x) => x.file === select.value);
      return it ? { file: it.file, iw: it.iw, ih: it.ih } : null;
    },
  };
}
