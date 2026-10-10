// Interface des modèles : cartes de choix et fenêtre de configuration.

import * as api from './api.js';
import { BUILTIN_TEMPLATES, DURATION_CHOICES } from './templates.js';
import { musicSelect, logoSelect, previewButton, stopPreview } from './library.js';
import { filesFromDrop } from './media.js';
import { h, icon, modal, pickFiles, confirmDialog } from './util.js';

export async function allTemplates() {
  let mine = [];
  try { mine = await api.listTemplates(); } catch { /* serveur indisponible */ }
  return [...mine, ...BUILTIN_TEMPLATES];
}

// Petite visualisation du rythme : une barre par photo, largeur = durée.
function rhythmStrip(tpl) {
  const r = tpl.rhythm || { beats: 1, pattern: [] };
  const seq = [...(tpl.introCard ? [{ b: tpl.introCard.beats, card: true }] : []),
    ...(r.pattern || []).map((b) => ({ b })),
    ...Array.from({ length: Math.max(4, 14 - (r.pattern || []).length) }, () => ({ b: r.beats })),
    ...(tpl.outroCard ? [{ b: tpl.outroCard.beats, card: true }] : [])];
  return h('div', { class: 'tpl-strip' }, seq.map((s) => h('span', {
    class: s.card ? 'is-card' : '', style: { flexGrow: String(s.b) },
  })));
}

export function templateCard(tpl, { onClick, onDelete } = {}) {
  return h('button', { class: 'tpl-card', style: { '--tpl': tpl.color || '#ff5b2e' }, onclick: () => onClick?.(tpl) },
    h('div', { class: 'tpl-top' }, rhythmStrip(tpl)),
    h('div', { class: 'tpl-body' },
      h('div', { class: 'tpl-name' }, tpl.name, tpl.builtin ? null : h('span', { class: 'tpl-badge' }, 'Perso')),
      h('div', { class: 'tpl-desc' }, tpl.description || ''),
      tpl.music ? h('div', { class: 'tpl-music' }, icon('music', 13), tpl.music.name) : null),
    onDelete && !tpl.builtin ? h('span', {
      class: 'tpl-delete', title: 'Supprimer ce modèle',
      onclick: async (e) => {
        e.stopPropagation();
        if (await confirmDialog(`Supprimer le modèle « ${tpl.name} » ?`, { confirmLabel: 'Supprimer', danger: true })) onDelete(tpl);
      },
    }, icon('trash', 14)) : null);
}

// Choix d'un modèle dans une fenêtre (depuis l'éditeur).
export async function chooseTemplate() {
  const templates = await allTemplates();
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: 'Appliquer un modèle',
      width: 760,
      body: h('div', { class: 'tpl-grid' }, templates.map((t) => templateCard(t, { onClick: () => { done = true; m.close(); resolve(t); } }))),
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

function seg(options, value, onChange) {
  const buttons = options.map((o) => h('button', {
    class: `seg ${o.id === value ? 'is-on' : ''}`,
    onclick: () => { buttons.forEach((b) => b.classList.remove('is-on')); btn(o).classList.add('is-on'); onChange(o.id); },
  }, o.label));
  const btn = (o) => buttons[options.indexOf(o)];
  return h('div', { class: 'segmented segmented-sm' }, buttons);
}

const usesText = (tpl, key) => (tpl.overlays || []).some((o) => o.data.type === 'text' && String(o.data.text).includes(key));
const usesLogo = (tpl) => (tpl.overlays || []).some((o) => o.data.type === 'logo');

// Fenêtre de configuration. mode 'create' : se termine par le choix des photos.
// Renvoie { cfg, files } ou null.
export async function openTemplateDialog(tpl, { mode = 'create' } = {}) {
  const lastMusic = localStorage.getItem('reel-last-music');
  const extra = mode === 'apply'
    ? [{ value: 'keep', label: 'Garder la musique actuelle' }, { value: 'none', label: 'Aucune musique' }]
    : [{ value: 'none', label: 'Celle du dossier de photos (s\'il y en a une)' }];
  const musicSel = await musicSelect({
    extra,
    selected: tpl.music ? `lib:${tpl.music.file}` : mode === 'apply' ? 'keep' : (lastMusic ? `lib:${lastMusic}` : null),
  });
  const logoSel = usesLogo(tpl) ? await logoSelect({ selected: tpl.logo?.file }) : null;

  const state = { passage: tpl.music ? 'template' : 'auto', target: 'template' };
  const titleInput = h('input', { class: 'input', placeholder: 'Nom de l\'événement', value: localStorage.getItem('reel-last-title') || '' });
  const subInput = h('input', { class: 'input', placeholder: 'Date, lieu… (facultatif)' });
  const passageOpts = [
    { id: 'auto', label: 'Le plus énergique' },
    { id: 'start', label: 'Début du morceau' },
    ...(tpl.music ? [{ id: 'template', label: 'Celui du modèle' }] : []),
  ];

  const field = (label, control, hint) => h('div', { class: 'field' }, h('span', {}, label), control, hint ? h('p', { class: 'insp-hint' }, hint) : null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (files) => {
      if (settled) return;
      settled = true;
      stopPreview();
      const music = musicSel.value;
      if (music.kind === 'library' && music.item) localStorage.setItem('reel-last-music', music.item.file);
      localStorage.setItem('reel-last-title', titleInput.value.trim());
      resolve({
        cfg: {
          template: tpl,
          title: titleInput.value.trim(),
          subtitle: subInput.value.trim(),
          music,
          passage: state.passage,
          target: state.target,
          logo: logoSel?.value ?? null,
        },
        files,
      });
      dlg.close();
    };

    const drop = mode === 'create' ? h('div', { class: 'tpl-drop' },
      icon('folder', 26),
      h('div', { class: 'tpl-drop-title' }, 'Déposez le dossier de photos ici'),
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const files = await pickFiles({ directory: true });
          if (files.length) finish(files);
        },
      }, 'Choisir le dossier de photos'),
      h('div', { class: 'muted' }, 'Le montage se fait tout seul ; vous pourrez tout ajuster ensuite.')) : null;
    if (drop) {
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', async (e) => {
        e.preventDefault();
        const files = await filesFromDrop(e.dataTransfer);
        if (files.length) finish(files);
      });
    }

    const body = h('div', { class: 'export-form tpl-form' },
      h('p', { class: 'muted tpl-intro' }, tpl.description || ''),
      usesText(tpl, '{titre}') ? field('Titre', titleInput) : null,
      usesText(tpl, '{sous-titre}') ? field('Sous-titre', subInput) : null,
      field('Musique', h('div', { class: 'select-row' }, musicSel.el,
        previewButton(() => (musicSel.value.kind === 'library' ? musicSel.value.item : null)))),
      field('Passage de la musique', seg(passageOpts, state.passage, (v) => { state.passage = v; })),
      field('Durée de la vidéo', seg(DURATION_CHOICES, state.target, (v) => { state.target = v; }),
        'Le rythme du modèle est conservé ; avec une durée, la vitesse des photos s\'adapte à leur nombre.'),
      logoSel ? field('Logo', logoSel.el) : null,
      mode === 'apply' ? h('p', { class: 'insp-hint warn' }, 'Remplace les durées, textes, logos et cartons actuels. Ctrl+Z pour revenir en arrière.') : null,
      drop);

    const dlg = modal({
      title: mode === 'create' ? `Nouveau reel — ${tpl.name}` : `Appliquer « ${tpl.name} »`,
      body,
      width: 520,
      onClose: () => { stopPreview(); if (!settled) { settled = true; resolve(null); } },
      actions: mode === 'apply'
        ? [{ label: 'Annuler', onClick: (c) => c() }, { label: 'Appliquer', primary: true, onClick: () => finish(null) }]
        : [{ label: 'Annuler', onClick: (c) => c() }],
    });
    setTimeout(() => titleInput.focus(), 0);
  });
}
