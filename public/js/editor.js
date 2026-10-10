// Écran d'édition : assemble la barre du haut, la médiathèque, l'aperçu,
// le panneau de réglages et la timeline. Gère les raccourcis et le glisser-déposer.

import { store, on, emit, openProject, commit, undo, redo, select, setTime, saveNow, closeProject, collectListeners } from './store.js';
import { createPreview, togglePlay, pause, sources } from './preview.js';
import { createTimeline } from './timeline.js';
import { createInspector } from './inspector.js';
import { openExportDialog, loadAllFonts } from './export.js';
import {
  importInto, pickAndImport, loadProjectMusic, addMediaClip, addText, deleteSelection, duplicateSelection,
  nudgeSelection, setBeatsForSelection, buildFromTemplate, saveAsTemplate, splitAtPlayhead, moveLayer,
} from './actions.js';
import { chooseTemplate, openTemplateDialog } from './template-ui.js';
import { filesFromDrop } from './media.js';
import { fileUrl } from './api.js';
import { BEAT_CHOICES } from './model.js';
import { h, icon, toast, promptDialog, rafThrottle, modal } from './util.js';

let cleanup = [];

export async function mountEditor(container, projectId, pending) {
  unmountEditor();
  try {
    await openProject(projectId);
  } catch (err) {
    toast(`Projet introuvable : ${err.message}`, { type: 'warn' });
    location.hash = '#/';
    return;
  }
  const p = store.project;

  // ---------- barre du haut ----------
  const nameBtn = h('button', { class: 'project-name', title: 'Renommer', onclick: rename }, p.name);
  const saveEl = h('span', { class: 'save-state' });
  const undoBtn = h('button', { class: 'btn btn-icon', onclick: undo, title: 'Annuler (Ctrl+Z)' }, icon('undo'));
  const redoBtn = h('button', { class: 'btn btn-icon', onclick: redo, title: 'Rétablir (Ctrl+Y)' }, icon('redo'));
  const topbar = h('header', { class: 'topbar' },
    h('a', { class: 'btn btn-ghost btn-sm', href: '#/', title: 'Tous les projets' }, icon('back', 16), 'Projets'),
    h('div', { class: 'topbar-title' }, nameBtn, saveEl),
    h('div', { class: 'topbar-actions' }, undoBtn, redoBtn,
      h('button', { class: 'btn btn-ghost btn-sm', onclick: templatesMenu, title: 'Appliquer ou enregistrer un modèle' }, icon('wand', 16), 'Modèles'),
      h('button', { class: 'btn btn-primary', onclick: openExportDialog, title: 'Ctrl+E' }, icon('export', 16), 'Exporter')));

  function templatesMenu() {
    const m = modal({
      title: 'Modèles',
      width: 440,
      body: h('div', { class: 'menu-list' },
        h('button', {
          class: 'menu-item',
          onclick: async () => {
            m.close();
            const tpl = await chooseTemplate();
            if (!tpl) return;
            const res = await openTemplateDialog(tpl, { mode: 'apply' });
            if (res) buildFromTemplate(res.cfg, null);
          },
        }, icon('wand', 18), h('div', {}, h('strong', {}, 'Appliquer un modèle'),
          h('span', {}, 'Rythme, musique, titre et logo appliqués aux médias de ce projet.'))),
        h('button', {
          class: 'menu-item',
          onclick: async () => {
            m.close();
            const name = await promptDialog('Nom du modèle', store.project.name, { confirmLabel: 'Enregistrer' });
            if (!name) return;
            try {
              await saveAsTemplate(name);
              toast(`Modèle « ${name} » enregistré : il apparaît sur l'accueil.`, { type: 'ok', timeout: 5000 });
            } catch (err) {
              toast(`Enregistrement impossible : ${err.message}`, { type: 'warn' });
            }
          },
        }, icon('copy', 18), h('div', {}, h('strong', {}, 'Enregistrer ce montage comme modèle'),
          h('span', {}, 'Garde la musique et son passage, le rythme, les textes (le premier devient le titre), le logo et les cartons.')))),
    });
  }

  async function rename() {
    const name = await promptDialog('Nom du projet', store.project.name, { confirmLabel: 'Renommer' });
    if (name) commit((q) => { q.name = name; });
  }

  // ---------- médiathèque ----------
  const grid = h('div', { class: 'bin-grid' });
  const binCount = h('span', { class: 'muted' });
  const left = h('aside', { class: 'bin' },
    h('div', { class: 'bin-actions' },
      h('button', { class: 'btn btn-wide btn-accent-soft', onclick: () => pickAndImport(true) }, icon('folder', 16), 'Importer un dossier'),
      h('button', { class: 'btn btn-wide btn-ghost', onclick: () => pickAndImport(false) }, icon('plus', 16), 'Ajouter des fichiers')),
    h('div', { class: 'bin-head' }, h('span', {}, 'Médiathèque'), binCount),
    grid,
    h('p', { class: 'insp-hint bin-hint' }, 'Cliquez sur un média pour l\'ajouter (à nouveau) au montage.'));

  const renderBin = rafThrottle(() => {
    const q = store.project;
    if (!q) return;
    const used = new Map();
    for (const c of q.clips) used.set(c.mediaId, (used.get(c.mediaId) || 0) + 1);
    const items = Object.values(q.media);
    binCount.textContent = String(items.length);
    grid.replaceChildren(...items.map((m) => h('button', {
      class: `bin-item ${used.get(m.id) ? '' : 'is-unused'}`,
      title: `${m.name}${used.get(m.id) ? '' : ' — non utilisé'}`,
      style: { backgroundImage: `url("${fileUrl(q.id, 'thumbs', `${m.id}.jpg`)}")` },
      onclick: () => addMediaClip(m.id),
    }, m.type === 'video' ? h('span', { class: 'bin-badge' }, icon('video', 12)) : null,
    used.get(m.id) > 1 ? h('span', { class: 'bin-count' }, `×${used.get(m.id)}`) : null)));
  });

  // ---------- assemblage ----------
  const dropOverlay = h('div', { class: 'drop-overlay' }, h('div', {}, icon('folder', 32), h('div', {}, 'Déposez pour importer')));
  const { result: panels, offs } = collectListeners(() => [createPreview(), createInspector(), createTimeline()]);
  cleanup.push(...offs);
  const root = h('div', { class: 'editor' }, topbar, left, ...panels, dropOverlay);
  container.replaceChildren(root);

  // ---------- état de sauvegarde ----------
  const renderSave = () => {
    const labels = { saved: 'Enregistré', pending: 'Modifications…', saving: 'Enregistrement…', error: 'Hors ligne — nouvel essai…' };
    saveEl.textContent = labels[store.saveState];
    saveEl.dataset.state = store.saveState;
    undoBtn.disabled = !store.undoStack.length;
    redoBtn.disabled = !store.redoStack.length;
  };

  cleanup.push(
    on('save', renderSave),
    on('project', () => { renderSave(); renderBin(); nameBtn.textContent = store.project.name; document.title = `${store.project.name} — Reel Studio`; }),
  );
  renderSave();
  renderBin();
  document.title = `${p.name} — Reel Studio`;
  emit('project', { source: 'open' });

  // ---------- glisser-déposer ----------
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const onDragEnter = (e) => { if (!hasFiles(e)) return; dragDepth++; root.classList.add('is-drop'); };
  const onDragLeave = () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) root.classList.remove('is-drop'); };
  const onDragOver = (e) => { if (hasFiles(e)) e.preventDefault(); };
  const onDrop = async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    root.classList.remove('is-drop');
    const files = await filesFromDrop(e.dataTransfer);
    if (files.length) importInto(files);
  };
  root.addEventListener('dragenter', onDragEnter);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('drop', onDrop);

  // ---------- clavier ----------
  const onKey = (e) => {
    if (!store.project || document.querySelector('.modal-overlay')) return;
    const tag = e.target.tagName;
    const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && !['range', 'button', 'color'].includes(e.target.type)) || tag === 'SELECT';
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (mod && k === 's') { e.preventDefault(); saveNow(); toast('Projet enregistré', { type: 'ok', timeout: 1500 }); return; }
    if (mod && k === 'e') { e.preventDefault(); openExportDialog(); return; }
    if (typing) { if (e.key === 'Escape') e.target.blur(); return; }

    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'a') { e.preventDefault(); select('clips', store.project.clips.map((c) => c.id)); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (mod) return;

    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); break;
      case 'Escape': select(null); break;
      case 'Home': setTime(0); break;
      case 'End': setTime(store.tl.total); break;
      case 'ArrowLeft': case 'ArrowRight': {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.altKey) { nudgeSelection(dir); break; }
        // Saute de coupe en coupe.
        const cuts = [...store.tl.starts, store.tl.total];
        const t = store.time;
        const target = dir > 0 ? cuts.find((c) => c > t + 1e-3) : [...cuts].reverse().find((c) => c < t - 1e-3);
        if (target != null) setTime(target);
        break;
      }
      case 't': case 'T': addText('title'); break;
      case 's': case 'S': splitAtPlayhead({ free: e.altKey }); break;
      case ']': case '[': case '}': case '{':
        // Ordre des calques : [ descendre, ] monter ; avec Maj : tout en bas / tout en haut.
        if (store.sel.type === 'overlay') {
          const upKey = e.key === ']' || e.key === '}';
          moveLayer(store.sel.ids[0], e.shiftKey || e.key === '}' || e.key === '{' ? (upKey ? 'top' : 'bottom') : (upKey ? 'up' : 'down'));
        }
        break;
      case 'b': case 'B': emit('tap'); break;
      default:
        if (/^[1-5]$/.test(e.key) && store.sel.type === 'clips') setBeatsForSelection(BEAT_CHOICES[Number(e.key) - 1].beats);
    }
  };
  window.addEventListener('keydown', onKey);
  cleanup.push(() => window.removeEventListener('keydown', onKey));

  loadAllFonts().then(() => emit('project', { source: 'fonts' }));
  loadProjectMusic();

  if (pending?.cfg) buildFromTemplate(pending.cfg, pending.files);
  else if (pending?.files?.length) importInto(pending.files);
}

export function unmountEditor() {
  if (!store.project) return;
  pause();
  sources.reset();
  for (const fn of cleanup) fn();
  cleanup = [];
  closeProject();
}
