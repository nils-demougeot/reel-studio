// Choix d'un effet sonore : bibliothèque fournie (public/sfx) + vos propres sons.

import * as api from './api.js';
import { addSound } from './actions.js';
import { h, icon, modal, pickFiles, toast } from './util.js';

const preview = new Audio();
let playingBtn = null;

function stopPreview() {
  preview.pause();
  if (playingBtn) { playingBtn.classList.remove('is-on'); playingBtn.replaceChildren(icon('play', 14)); }
  playingBtn = null;
}
preview.addEventListener('ended', stopPreview);

function togglePreview(url, btn) {
  if (playingBtn === btn) { stopPreview(); return; }
  stopPreview();
  preview.src = url;
  preview.currentTime = 0;
  preview.play().catch(() => {});
  playingBtn = btn;
  btn.classList.add('is-on');
  btn.replaceChildren(icon('pause', 14));
}

export async function openSoundPicker() {
  let builtin = [];
  try { builtin = await (await fetch('/sfx/index.json')).json(); } catch { /* bibliothèque absente */ }
  const mine = h('div', { class: 'sfx-list' });
  let close = () => {};

  const row = (item, source, url) => {
    const play = h('button', { class: 'btn btn-icon btn-sm lib-play', title: 'Écouter', onclick: () => togglePreview(url, play) }, icon('play', 14));
    const add = () => { stopPreview(); close(); addSound(item, source); };
    return h('div', { class: 'sfx-row', ondblclick: add },
      play,
      h('span', { class: 'sfx-name' }, item.name),
      h('span', { class: 'muted sfx-dur' }, item.duration ? `${item.duration.toFixed(item.duration < 1 ? 2 : 1).replace('.', ',')} s` : ''),
      h('button', { class: 'btn btn-sm btn-accent-soft', onclick: add }, 'Ajouter'));
  };

  async function refreshMine() {
    let items = [];
    try { items = await api.listLibrary('sons'); } catch { /* rien */ }
    mine.replaceChildren(...(items.length
      ? items.map((it) => row(it, 'sons', api.libUrl('sons', it.file)))
      : [h('p', { class: 'muted sfx-empty' }, 'Vos propres effets sonores apparaîtront ici.')]));
  }

  const categories = [...new Set(builtin.map((s) => s.category))];
  const body = h('div', { class: 'sfx' },
    h('p', { class: 'muted sfx-help' }, 'L’effet est placé à la tête de lecture ; vous pourrez le déplacer dans la piste « Sons » de la timeline.'),
    h('div', { class: 'sfx-columns' },
      categories.map((cat) => h('div', { class: 'sfx-group' },
        h('h3', {}, cat),
        h('div', { class: 'sfx-list' }, builtin.filter((s) => s.category === cat).map((s) => row(s, 'sfx', `/sfx/${encodeURIComponent(s.file)}`)))))),
    h('div', { class: 'sfx-group' },
      h('div', { class: 'sfx-mine-head' }, h('h3', {}, 'Mes sons'),
        h('button', {
          class: 'btn btn-ghost btn-sm',
          onclick: async () => {
            const files = await pickFiles({ accept: 'audio/*' });
            for (const f of files) {
              try { await api.uploadToLibrary('sons', f); } catch { toast(`Fichier refusé : ${f.name}`, { type: 'warn' }); }
            }
            refreshMine();
          },
        }, icon('plus', 14), 'Importer des sons')),
      mine));

  ({ close } = modal({ title: 'Effets sonores', body, width: 720, onClose: stopPreview, actions: [{ label: 'Fermer', onClick: (c) => c() }] }));
  refreshMine();
}
