// Mini-menu des transitions : aperçus animés, à glisser sur une coupe de la timeline
// (ou clic : appliquée à la coupe la plus proche de la tête de lecture).

import { store, on } from './store.js';
import { TRANSITIONS, computeTimeline, normalizeProject } from './model.js';
import { drawFrame } from './render.js';
import { setTransition, nearestCut } from './actions.js';
import { h, toast } from './util.js';

export const TRANSITION_MIME = 'application/x-reel-transition';

// Petit projet factice : deux cartons en dégradé, pour montrer chaque transition en boucle.
function demoProject(type) {
  const p = normalizeProject({
    id: 'demo',
    settings: { background: '#111111' },
    rhythm: { bpm: 120 },
    clips: [
      { id: 'a', kind: 'color', color: { g: ['#ff5b2e', '#ffd23f'], a: 160 }, beats: 3, transition: { type, dur: TRANSITIONS.find((t) => t.id === type).dur } },
      { id: 'b', kind: 'color', color: { g: ['#3aa0ff', '#7c6cff'], a: 20 }, beats: 3 },
    ],
  });
  return { p, tl: computeTimeline(p) };
}

const noSources = { clip: () => null, sticker: () => null, cutout: () => null };

let current = null;

export function closeTransitionMenu() {
  if (!current) return;
  current.close();
  current = null;
}

export function openTransitionMenu(anchor) {
  if (current) { closeTransitionMenu(); return; }
  const demos = [];
  const cards = TRANSITIONS.map((tr) => {
    const canvas = h('canvas', { class: 'tr-demo', width: 54 * 2, height: 96 * 2 });
    demos.push({ canvas, ...demoProject(tr.id) });
    const card = h('div', {
      class: 'tr-card', draggable: true, title: `${tr.desc}. Glissez sur une coupe, ou cliquez.`,
      ondragstart: (e) => {
        e.dataTransfer.setData(TRANSITION_MIME, tr.id);
        e.dataTransfer.effectAllowed = 'copy';
        root.classList.add('is-dragging');
      },
      ondragend: () => root.classList.remove('is-dragging'),
      onclick: () => {
        const k = nearestCut(store.time);
        if (k < 0) { toast('Il faut au moins deux médias pour placer une transition.'); return; }
        setTransition(k, tr.id);
        closeTransitionMenu();
      },
    }, canvas, h('div', { class: 'tr-name' }, tr.label));
    return card;
  });

  const root = h('div', { class: 'tr-menu' },
    h('div', { class: 'tr-grid' }, cards),
    h('p', { class: 'insp-hint tr-help' }, 'Glissez une transition sur une coupe de la timeline, ou cliquez pour l’appliquer à la coupe la plus proche de la tête de lecture.'));
  document.body.append(root);
  const r = anchor.getBoundingClientRect();
  root.style.left = `${Math.max(8, Math.min(window.innerWidth - root.offsetWidth - 8, r.left))}px`;
  root.style.top = `${r.bottom + 6}px`;

  // Animation des aperçus : boucle autour de la coupe (à 1,5 s).
  let raf = 0;
  const t0 = performance.now();
  const tick = () => {
    const t = 0.9 + (((performance.now() - t0) / 1000) % 1.6) * 0.75;
    for (const d of demos) drawFrame(d.canvas.getContext('2d'), d.canvas.width, d.canvas.height, d.p, d.tl, t, noSources);
    raf = requestAnimationFrame(tick);
  };
  tick();

  const outside = (e) => { if (!root.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeTransitionMenu(); };
  const esc = (e) => { if (e.key === 'Escape') closeTransitionMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  document.addEventListener('keydown', esc);
  const off = on('transition-dropped', closeTransitionMenu);
  current = {
    close() {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
      off();
      root.remove();
    },
  };
}
