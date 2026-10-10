// Écran d'accueil : liste des projets, création (y compris en déposant un dossier).

import * as api from './api.js';
import { filesFromDrop, dropFolderName } from './media.js';
import { allTemplates, templateCard, openTemplateDialog } from './template-ui.js';
import { openMusicLibrary } from './library.js';
import { h, icon, toast, confirmDialog, promptDialog, pickFiles } from './util.js';

function relativeDate(ts) {
  if (!ts) return '';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'à l\'instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export async function mountHome(container, { openWithFiles }) {
  document.title = 'Reel Studio';

  async function create(name, files, cfg = null) {
    const p = await api.createProject(name || 'Nouveau reel');
    openWithFiles(p.id, files, cfg);
  }

  async function startFromTemplate(tpl) {
    const res = await openTemplateDialog(tpl, { mode: 'create' });
    if (!res) return;
    create(res.cfg.title || tpl.name, res.files, res.cfg);
  }

  const templates = h('div', { class: 'tpl-grid' });
  async function refreshTemplates() {
    const list = await allTemplates();
    templates.replaceChildren(...list.map((t) => templateCard(t, {
      onClick: startFromTemplate,
      onDelete: async (x) => { await api.deleteTemplate(x.id); refreshTemplates(); },
    })));
  }
  refreshTemplates();

  const drop = h('div', { class: 'home-drop' },
    icon('folder', 30),
    h('div', { class: 'home-drop-title' }, 'Glissez un dossier de photos ici'),
    h('div', { class: 'muted' }, 'photos, vidéos et musique — un nouveau projet est créé automatiquement'),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const files = await pickFiles({ directory: true });
          if (!files.length) return;
          const folder = files[0].webkitRelativePath?.split('/')[0];
          create(folder, files);
        },
      }, icon('folder', 16), 'Choisir un dossier'),
      h('button', {
        class: 'btn btn-ghost',
        onclick: async () => {
          const name = await promptDialog('Nom du nouveau projet', 'Nouveau reel', { confirmLabel: 'Créer' });
          if (name) create(name, null);
        },
      }, icon('plus', 16), 'Projet vide')));

  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    const folder = dropFolderName(e.dataTransfer);
    const files = await filesFromDrop(e.dataTransfer);
    if (files.length) create(folder || 'Nouveau reel', files);
  });

  const list = h('div', { class: 'project-grid' });
  const root = h('div', { class: 'home' },
    h('header', { class: 'home-header' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-dot' }), 'Reel Studio'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => openMusicLibrary() }, icon('music', 15), 'Bibliothèque musicale')),
    h('main', { class: 'home-main' },
      h('h2', { class: 'home-subtitle home-subtitle-first' }, 'Partir d\'un modèle'),
      h('p', { class: 'muted home-lead' }, 'Choisissez un modèle, déposez vos photos : musique, rythme, titre et logo se placent tout seuls.'),
      templates,
      h('h2', { class: 'home-subtitle' }, 'Ou partir de zéro'),
      drop,
      h('h2', { class: 'home-subtitle' }, 'Projets'), list));
  container.replaceChildren(root);

  async function refresh() {
    let projects = [];
    try { projects = await api.listProjects(); } catch (err) { toast(`Serveur injoignable : ${err.message}`, { type: 'warn' }); }
    if (!projects.length) {
      list.replaceChildren(h('p', { class: 'muted' }, 'Aucun projet pour l\'instant.'));
      return;
    }
    list.replaceChildren(...projects.map((p) => h('a', { class: 'project-card', href: `#/p/${p.id}` },
      h('div', { class: 'project-thumb', style: p.thumb ? { backgroundImage: `url("${p.thumb}")` } : {} }, p.thumb ? null : icon('image', 26)),
      h('div', { class: 'project-meta' },
        h('div', { class: 'project-title' }, p.name),
        h('div', { class: 'muted' }, `${p.clipCount} média${p.clipCount > 1 ? 's' : ''} · ${relativeDate(p.updatedAt)}`)),
      h('div', { class: 'project-actions' },
        h('button', {
          class: 'btn btn-icon btn-sm', title: 'Renommer',
          onclick: async (e) => {
            e.preventDefault();
            const name = await promptDialog('Renommer le projet', p.name, { confirmLabel: 'Renommer' });
            if (!name) return;
            const full = await api.getProject(p.id);
            full.name = name;
            await api.saveProject(full);
            refresh();
          },
        }, icon('edit', 15)),
        h('button', {
          class: 'btn btn-icon btn-sm', title: 'Supprimer',
          onclick: async (e) => {
            e.preventDefault();
            const ok = await confirmDialog(`Supprimer « ${p.name} » ? Le dossier est déplacé dans « projets/_corbeille », rien n'est effacé définitivement.`, { confirmLabel: 'Supprimer', danger: true });
            if (!ok) return;
            await api.deleteProject(p.id);
            refresh();
          },
        }, icon('trash', 15))))));
  }
  refresh();
}
