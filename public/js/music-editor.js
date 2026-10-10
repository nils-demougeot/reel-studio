// Fenêtre « Choisir les passages » : vue d'ensemble du morceau, on sélectionne à la souris
// les parties à garder ; elles sont jouées à la suite dans la vidéo.

import { store, commit, select } from './store.js';
import { music, magnetOn } from './actions.js';
import { musicSegments, snapToBeat } from './model.js';
import { audioContext, findBestPassage } from './audio.js';
import { pause } from './preview.js';
import { h, icon, modal, fmtTime, clamp, toast } from './util.js';

const MIN_LEN = 0.1;

// ---------- opérations sur des listes de plages [début, fin] ----------

function merge(ranges) {
  const sorted = ranges.filter(([a, b]) => b - a > 1e-3).map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1e-3) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}

const subtract = (ranges, [a, b]) => merge(ranges.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, a], [b, y]]))
  .filter(([x, y]) => y - x >= MIN_LEN));

const totalOf = (ranges) => ranges.reduce((s, [a, b]) => s + b - a, 0);

export function openMusicEditor() {
  const p = store.project;
  if (!p?.music) return;
  if (!music.buffer || !music.peaks) { toast('La musique est encore en cours de chargement…'); return; }
  pause();

  const dur = p.music.duration;
  const videoTotal = store.tl.total;
  let kept = merge(musicSegments(p).map((s) => [s.from, s.to]));
  let sel = null;
  let listen = null; // lecture en cours : { sources, ctxStart, plan, raf }

  // ---------- éléments ----------
  const W = 760, H = 150;
  const canvas = h('canvas', { class: 'me-canvas' });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = '100%';
  const info = h('div', { class: 'me-info' });
  const playBtn = h('button', { class: 'btn btn-sm', onclick: () => (listen ? stop() : play()) });
  const keepOnly = h('button', { class: 'btn btn-sm btn-primary', onclick: () => apply([sel]) }, 'Garder seulement ça');
  const addSel = h('button', { class: 'btn btn-sm', onclick: () => apply(merge([...kept, sel])) }, icon('plus', 14), 'Ajouter');
  const removeSel = h('button', { class: 'btn btn-sm', onclick: () => apply(subtract(kept, sel)) }, icon('trash', 14), 'Retirer');

  const body = h('div', { class: 'me' },
    h('p', { class: 'muted me-help' },
      'Glissez sur le morceau pour sélectionner une partie, puis gardez-la ou retirez-la. Les parties en couleur sont jouées à la suite dans la vidéo. Un simple clic écoute à partir de cet endroit.'),
    h('div', { class: 'me-wave' }, canvas),
    info,
    h('div', { class: 'btn-row me-actions' },
      playBtn, keepOnly, addSel, removeSel,
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: bestPassage, title: 'Garde le refrain / drop le plus énergique, de la durée de la vidéo' }, icon('wand', 14), 'Meilleur passage'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { sel = null; apply([[snapToBeat(p, 0), dur]]); } }, 'Tout le morceau')));

  const dlg = modal({
    title: `Musique — ${p.music.name.replace(/\.[^.]+$/, '')}`,
    body,
    width: 820,
    onClose: () => stop(),
    actions: [
      { label: 'Annuler', onClick: (c) => c() },
      { label: 'Valider', primary: true, onClick: (c) => { if (save()) c(); } },
    ],
  });

  // ---------- conversions ----------
  const toX = (t) => (t / dur) * W;
  const toT = (clientX) => {
    const r = canvas.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * dur, 0, dur);
  };
  // Instant du morceau où la vidéo se termine (après avoir parcouru les parties gardées).
  const videoEndAt = () => {
    let left = videoTotal;
    for (const [a, b] of kept) {
      if (left <= b - a) return a + left;
      left -= b - a;
    }
    return null;
  };

  // ---------- dessin ----------
  function draw() {
    const g = canvas.getContext('2d');
    const css = getComputedStyle(document.body);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const top = 8, waveH = H - 34, mid = top + waveH / 2;
    const { data, perSecond } = music.peaks;
    const isKept = (t) => kept.some(([a, b]) => t >= a && t < b);

    // Bandes des parties gardées
    g.fillStyle = 'rgba(74, 168, 255, 0.10)';
    for (const [a, b] of kept) g.fillRect(toX(a), top, toX(b) - toX(a), waveH);

    // Forme d'onde
    for (let x = 0; x < W; x += 2) {
      const t0 = (x / W) * dur, t1 = ((x + 2) / W) * dur;
      let v = 0;
      for (let i = Math.floor(t0 * perSecond); i < Math.min(data.length, Math.ceil(t1 * perSecond)); i++) v = Math.max(v, data[i]);
      const bh = Math.max(1, v * (waveH / 2 - 2));
      g.fillStyle = isKept(t0) ? css.getPropertyValue('--music') : '#3a3a42';
      g.fillRect(x, mid - bh, 1.5, bh * 2);
    }

    // Fin de la vidéo
    const end = videoEndAt();
    if (end != null) {
      const x = toX(end);
      g.fillStyle = css.getPropertyValue('--accent');
      g.fillRect(x - 1, top, 2, waveH);
      g.font = '11px Inter, sans-serif';
      g.fillText('fin de la vidéo', Math.min(x + 4, W - 80), top + 12);
    }

    // Sélection
    if (sel) {
      const x0 = toX(sel[0]), x1 = toX(sel[1]);
      g.fillStyle = 'rgba(255, 255, 255, 0.14)';
      g.fillRect(x0, top, x1 - x0, waveH);
      g.fillStyle = '#ffffff';
      g.fillRect(x0, top, 1.5, waveH);
      g.fillRect(x1 - 1.5, top, 1.5, waveH);
    }

    // Lecture
    if (listen) {
      const pos = listenPosition();
      if (pos != null) { g.fillStyle = '#ffffff'; g.fillRect(toX(pos) - 1, 0, 2, waveH + top); }
    }

    // Graduation
    g.fillStyle = css.getPropertyValue('--muted');
    g.font = '11px Inter, sans-serif';
    const step = dur > 240 ? 60 : dur > 60 ? 30 : 10;
    for (let t = 0; t <= dur; t += step) {
      g.fillRect(toX(t), H - 22, 1, 5);
      g.fillText(fmtTime(t, false), toX(t) + 3, H - 8);
    }

    // Infos et boutons
    const n = kept.length;
    const keptTotal = totalOf(kept);
    const parts = `${n} partie${n > 1 ? 's' : ''} gardée${n > 1 ? 's' : ''} · ${fmtTime(keptTotal, false)}`;
    const vid = keptTotal >= videoTotal
      ? `la vidéo (${fmtTime(videoTotal, false)}) s’arrête au trait orange`
      : `attention : la vidéo dure ${fmtTime(videoTotal, false)}, la fin sera sans musique`;
    info.replaceChildren(...[
      h('span', {}, parts), h('span', { class: keptTotal >= videoTotal ? 'muted' : 'warn' }, ` — ${vid}`),
      sel ? h('span', { class: 'me-sel' }, ` · sélection ${fmtTime(sel[0])} → ${fmtTime(sel[1])}`) : null,
    ].filter(Boolean));
    for (const b of [keepOnly, addSel, removeSel]) b.disabled = !sel;
    playBtn.replaceChildren(icon(listen ? 'pause' : 'play', 14), listen ? 'Arrêter' : sel ? 'Écouter la sélection' : 'Écouter le résultat');
  }

  // ---------- sélection à la souris ----------
  canvas.addEventListener('pointerdown', (e) => {
    const x0 = e.clientX;
    const a = toT(e.clientX);
    canvas.setPointerCapture(e.pointerId);
    let moved = false;
    const snap = (t, ev) => (magnetOn(ev.altKey) ? clamp(snapToBeat(p, t), 0, dur) : t);
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const b = toT(ev.clientX);
      const r = [snap(Math.min(a, b), ev), snap(Math.max(a, b), ev)];
      sel = r[1] - r[0] >= MIN_LEN ? r : null;
      draw();
    };
    const up = (ev) => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      if (!moved) { sel = null; play([[toT(ev.clientX), dur]]); }
      draw();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  });

  // ---------- écoute ----------
  function play(plan = sel ? [sel] : kept) {
    stop();
    const ac = audioContext();
    ac.resume();
    const ctxStart = ac.currentTime + 0.05;
    const sources = [];
    let at = 0;
    for (const [a, b] of plan) {
      const src = ac.createBufferSource();
      src.buffer = music.buffer;
      src.connect(ac.destination);
      src.start(ctxStart + at, a, b - a);
      sources.push(src);
      at += b - a;
    }
    listen = { sources, ctxStart, plan, total: at };
    const tick = () => {
      if (!listen) return;
      if (ac.currentTime - listen.ctxStart > listen.total) { stop(); draw(); return; }
      draw();
      listen.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  function listenPosition() {
    let el = audioContext().currentTime - listen.ctxStart;
    if (el < 0) return listen.plan[0]?.[0] ?? null;
    for (const [a, b] of listen.plan) {
      if (el <= b - a) return a + el;
      el -= b - a;
    }
    return null;
  }

  function stop() {
    if (!listen) return;
    cancelAnimationFrame(listen.raf);
    for (const s of listen.sources) { try { s.stop(); } catch { /* déjà arrêtée */ } s.disconnect(); }
    listen = null;
  }

  // ---------- modifications ----------
  function apply(next) {
    const merged = merge(next);
    if (!merged.length) { toast('Il faut garder au moins une partie de la musique.'); return; }
    kept = merged;
    sel = null;
    if (listen) stop();
    draw();
  }

  function bestPassage() {
    const start = findBestPassage(music.buffer, p.rhythm.bpm, p.rhythm.offset, Math.max(5, videoTotal));
    apply([[start, Math.min(dur, start + Math.max(videoTotal, 5) + 2)]]);
  }

  function save() {
    if (!kept.length) return false;
    commit((proj) => {
      const m = proj.music;
      m.start = kept[0][0];
      m.cuts = [];
      // Ce qui n'est pas gardé (après le début) devient des passages retirés.
      const removed = [];
      for (let i = 0; i < kept.length; i++) {
        const to = i + 1 < kept.length ? kept[i + 1][0] : m.duration;
        if (to - kept[i][1] > 1e-3) removed.push({ from: kept[i][1], to });
      }
      m.removed = removed;
    });
    select(null);
    return true;
  }

  draw();
  return dlg;
}
