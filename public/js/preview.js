// Aperçu 9:16 : lecture synchronisée avec la musique et manipulation directe
// des textes / logos (déplacer, redimensionner) et du cadrage des photos.

import { store, on, emit, setTime, setPlaying, select, commit } from './store.js';
import { drawFrame } from './render.js';
import { clipIndexAt, FRAME_W, FRAME_H, FIT_MODES } from './model.js';
import { PreviewSources } from './media.js';
import { player, addText, addLogo, addColorCard, updateAllClips } from './actions.js';
import { h, icon, clamp, fmtTime, rafThrottle } from './util.js';

const SNAP = 0.012;

export const sources = new PreviewSources(() => requestRender());
let requestRender = () => {};

export function play() {
  const p = store.project;
  if (!p?.clips.length) return;
  if (store.time >= store.tl.total - 0.02) setTime(0);
  player.play(store.time, p.music);
  sources.setPlaying(true);
  setPlaying(true);
  const loop = () => {
    if (!store.playing) return;
    const t = player.now();
    if (t >= store.tl.total) { setTime(store.tl.total); pause(); return; }
    setTime(t, { fromPlayback: true });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export function pause() {
  player.stop();
  sources.setPlaying(false);
  setPlaying(false);
  requestRender();
}

export const togglePlay = () => (store.playing ? pause() : play());

export function createPreview() {
  const canvas = h('canvas', { class: 'preview-canvas' });
  const ctx = canvas.getContext('2d');
  const selBox = h('div', { class: 'sel-box' }, ['nw', 'ne', 'sw', 'se'].map((c) => h('div', { class: `handle handle-${c}`, dataset: { handle: c } })));
  const guideV = h('div', { class: 'guide guide-v' });
  const guideH = h('div', { class: 'guide guide-h' });
  const safe = h('div', { class: 'safe-zones' }, h('div', { class: 'safe-top' }), h('div', { class: 'safe-bottom' }), h('div', { class: 'safe-right' }));
  const empty = h('div', { class: 'stage-empty' },
    icon('folder', 28), h('div', { class: 'stage-empty-title' }, 'Glissez ici un dossier'),
    h('div', {}, 'photos, vidéos et musique'));
  const stage = h('div', { class: 'stage' }, canvas, safe, guideV, guideH, selBox, empty);
  const stageWrap = h('div', { class: 'stage-wrap' }, stage);

  let showSafe = localStorage.getItem('reel-safe') === '1';
  const safeBtn = h('button', {
    class: `btn btn-ghost btn-sm ${showSafe ? 'is-on' : ''}`,
    title: 'Afficher les zones masquées par l\'interface Instagram',
    onclick: () => {
      showSafe = !showSafe;
      localStorage.setItem('reel-safe', showSafe ? '1' : '0');
      safeBtn.classList.toggle('is-on', showSafe);
      safe.classList.toggle('visible', showSafe);
    },
  }, icon('eye', 16), h('span', { class: 'hide-narrow' }, 'Zones Instagram'));
  safe.classList.toggle('visible', showSafe);

  // Format de toutes les photos / vidéos : adapter (bandes noires) ou recadrer.
  const fitButtons = FIT_MODES.map((m) => h('button', { class: 'seg', title: m.title, onclick: () => updateAllClips({ fit: m.id }) }, m.label));
  const fitSwitch = h('div', { class: 'segmented segmented-sm fit-switch', title: 'Format de tous les médias' }, fitButtons);
  const renderFitSwitch = () => {
    const clips = (store.project?.clips || []).filter((c) => c.kind !== 'color');
    const fit = clips.length && clips.every((c) => c.fit === clips[0].fit) ? clips[0].fit : null;
    FIT_MODES.forEach((m, i) => fitButtons[i].classList.toggle('is-on', m.id === (fit ?? (clips.length ? null : store.project?.defaults.fit))));
  };

  const toolbar = h('div', { class: 'preview-toolbar' },
    h('button', { class: 'btn btn-chip chip-text', onclick: () => addText('title'), title: 'Ajouter un texte (T)' }, icon('text', 16), 'Texte'),
    h('button', { class: 'btn btn-chip chip-logo', onclick: addLogo, title: 'Ajouter un logo' }, icon('image', 16), 'Logo'),
    h('button', { class: 'btn btn-chip chip-card', onclick: addColorCard, title: 'Ajouter un carton de couleur' }, icon('card', 16), 'Carton'),
    h('div', { class: 'spacer' }),
    fitSwitch,
    safeBtn);

  const playBtn = h('button', { class: 'btn btn-round', onclick: togglePlay, title: 'Lecture / pause (Espace)' }, icon('play', 20));
  const timeEl = h('span', { class: 'time-current' }, '0:00.0');
  const totalEl = h('span', { class: 'time-total' }, '/ 0:00.0');
  const transport = h('div', { class: 'transport' },
    h('button', { class: 'btn btn-icon', onclick: () => setTime(0), title: 'Retour au début (Origine)' }, icon('back', 18)),
    playBtn,
    h('div', { class: 'time' }, timeEl, totalEl));

  const root = h('div', { class: 'preview' }, toolbar, stageWrap, transport);

  // ---------- dimensionnement ----------
  let cssW = 0, cssH = 0, W = 0, H = 0;
  const layout = () => {
    const r = stageWrap.getBoundingClientRect();
    const availH = r.height - 8, availW = r.width - 8;
    cssH = Math.max(100, Math.min(availH, availW * 16 / 9));
    cssW = cssH * 9 / 16;
    stage.style.width = `${cssW}px`;
    stage.style.height = `${cssH}px`;
    const dpr = window.devicePixelRatio || 1;
    W = Math.min(FRAME_W, Math.round(cssW * dpr));
    H = Math.round(W * FRAME_H / FRAME_W);
    canvas.width = W;
    canvas.height = H;
    render();
  };
  new ResizeObserver(layout).observe(stageWrap);

  // ---------- rendu ----------
  let boxes = [];
  const render = () => {
    const p = store.project;
    if (!p || !W) return;
    sources.setProject(p);
    const still = !store.playing && store.sel.type === 'overlay' ? store.sel.ids[0] : null;
    boxes = drawFrame(ctx, W, H, p, store.tl, store.time, sources, { still });
    const i = clipIndexAt(store.tl, store.time);
    sources.prefetch(Math.max(0, i), store.playing ? 16 : 6);
    if (i >= 0) sources.preroll(p.clips[i + 1]);
    empty.style.display = p.clips.length ? 'none' : '';
    updateSelBox();
    timeEl.textContent = fmtTime(store.time);
    totalEl.textContent = `/ ${fmtTime(store.tl.total)}`;
  };
  requestRender = rafThrottle(render);

  const k = () => cssW / W; // pixels canvas -> pixels écran

  function updateSelBox() {
    const ov = store.sel.type === 'overlay' && boxes.find((b) => b.id === store.sel.ids[0]);
    if (!ov) { selBox.style.display = 'none'; return; }
    const s = k();
    Object.assign(selBox.style, { display: '', left: `${ov.x * s}px`, top: `${ov.y * s}px`, width: `${ov.w * s}px`, height: `${ov.h * s}px` });
    selBox.classList.toggle('is-logo', store.project.overlays.find((o) => o.id === ov.id)?.type === 'logo');
  }

  // ---------- interactions ----------
  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k(), y: (e.clientY - r.top) / k() };
  };

  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !store.project) return;
    const pt = toCanvas(e);
    const handle = e.target.dataset?.handle;
    const p = store.project;

    if (handle && store.sel.type === 'overlay') {
      const ov = p.overlays.find((o) => o.id === store.sel.ids[0]);
      const cx = ov.x * W, cy = ov.y * H;
      drag = { mode: 'resize', ov, d0: Math.hypot(pt.x - cx, pt.y - cy) || 1, size0: ov.size, w0: ov.w, cx, cy };
    } else {
      const hit = [...boxes].reverse().find((b) => pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h);
      if (hit) {
        const ov = p.overlays.find((o) => o.id === hit.id);
        if (!(store.sel.type === 'overlay' && store.sel.ids[0] === ov.id)) select('overlay', [ov.id]);
        drag = { mode: 'move', ov, start: pt, x0: ov.x, y0: ov.y };
      } else {
        const i = clipIndexAt(store.tl, store.time);
        const clip = p.clips[i];
        if (!clip) { select(null); return; }
        if (!(store.sel.type === 'clips' && store.sel.ids.includes(clip.id))) select('clips', [clip.id]);
        const m = p.media[clip.mediaId];
        if (m && clip.fit === 'cover') {
          const base = Math.max(W / m.w, H / m.h) * (clip.zoom || 1);
          drag = { mode: 'pan', clip, start: pt, fx0: clip.fx ?? 0.5, fy0: clip.fy ?? 0.5, ox: m.w * base - W, oy: m.h * base - H };
        }
      }
    }
    if (drag) {
      drag.key = `drag-${Date.now()}`;
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const pt = toCanvas(e);
    if (drag.mode === 'move') {
      let x = drag.x0 + (pt.x - drag.start.x) / W;
      let y = drag.y0 + (pt.y - drag.start.y) / H;
      const snapX = Math.abs(x - 0.5) < SNAP;
      const snapY = Math.abs(y - 0.5) < SNAP * 9 / 16;
      if (snapX) x = 0.5;
      if (snapY) y = 0.5;
      guideV.classList.toggle('visible', snapX);
      guideH.classList.toggle('visible', snapY);
      const id = drag.ov.id;
      commit((p) => { const o = p.overlays.find((q) => q.id === id); o.x = clamp(x, 0, 1); o.y = clamp(y, 0, 1); }, { key: drag.key });
    } else if (drag.mode === 'resize') {
      const f = Math.hypot(pt.x - drag.cx, pt.y - drag.cy) / drag.d0;
      const id = drag.ov.id;
      commit((p) => {
        const o = p.overlays.find((q) => q.id === id);
        if (o.type === 'text') o.size = Math.round(clamp(drag.size0 * f, 16, 400));
        else o.w = clamp(drag.w0 * f, 0.03, 1.5);
      }, { key: drag.key });
    } else if (drag.mode === 'pan') {
      const dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
      const id = drag.clip.id;
      commit((p) => {
        const c = p.clips.find((q) => q.id === id);
        if (drag.ox > 1) c.fx = clamp(drag.fx0 - dx / drag.ox, 0, 1);
        if (drag.oy > 1) c.fy = clamp(drag.fy0 - dy / drag.oy, 0, 1);
      }, { key: drag.key });
    }
  });

  const endDrag = () => {
    drag = null;
    guideV.classList.remove('visible');
    guideH.classList.remove('visible');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', () => {
    if (store.sel.type === 'overlay') emit('focus-text');
  });

  // ---------- abonnements ----------
  let audioSig = '';
  on('project', (d) => {
    const p = store.project;
    if (d?.source === 'open') sources.reset();
    const sig = `${p.music?.file}|${p.music?.start}|${p.rhythm.bpm}`;
    if (store.playing && sig !== audioSig) player.play(store.time, p.music);
    if (store.playing) player.setVolume(p.music?.volume ?? 1);
    audioSig = sig;
    renderFitSwitch();
    requestRender();
  });
  on('time', (d) => {
    if (store.playing && !d?.fromPlayback) player.play(store.time, store.project.music);
    requestRender();
  });
  on('select', requestRender);
  on('play', () => {
    playBtn.replaceChildren(icon(store.playing ? 'pause' : 'play', 20));
    root.classList.toggle('is-playing', store.playing);
  });
  document.fonts?.addEventListener?.('loadingdone', requestRender);

  return root;
}
