// Timeline : vignettes des médias (sélection, réordonnancement, durée au bord),
// pistes texte / logo, musique avec forme d'onde et grille des temps.

import { store, on, commit, select, setTime } from './store.js';
import { beatLength, beatPhase, snapToBeat } from './model.js';
import { music, moveClipsTo, deleteSelection, shuffleClips, reverseClips, sortClips } from './actions.js';
import { fileUrl } from './api.js';
import { h, icon, clamp, rafThrottle, fmtTime } from './util.js';

const PAD = 14;
const MIN_PPS = 15;
const MAX_PPS = 600;

export function createTimeline() {
  let pps = Number(localStorage.getItem('reel-pps')) || 90;
  const x = (t) => PAD + t * pps;
  const tAt = (px) => (px - PAD) / pps;

  // ---------- structure ----------
  const ruler = h('canvas', { class: 'tl-ruler-canvas' });
  const rulerTrack = h('div', { class: 'tl-ruler' }, ruler);
  const clipsTrack = h('div', { class: 'tl-track tl-clips' });
  const ovTrack = h('div', { class: 'tl-track tl-overlays' });
  const waveCanvas = h('canvas', { class: 'tl-wave-canvas' });
  const musicLabel = h('div', { class: 'tl-music-label' });
  const musicTrack = h('div', { class: 'tl-track tl-music' }, waveCanvas, musicLabel);
  const playhead = h('div', { class: 'tl-playhead' }, h('div', { class: 'tl-playhead-knob' }));
  const marker = h('div', { class: 'tl-insert' });
  const content = h('div', { class: 'tl-content' }, rulerTrack, clipsTrack, ovTrack, musicTrack, marker, playhead);
  const scroller = h('div', { class: 'tl-scroll' }, content);

  const ovHead = h('div', { class: 'tl-head tl-head-ov' }, icon('text', 15), 'Textes');
  const heads = h('div', { class: 'tl-heads' },
    h('div', { class: 'tl-head tl-head-ruler' }),
    h('div', { class: 'tl-head tl-head-clips' }, icon('image', 15), 'Médias'),
    ovHead,
    h('div', { class: 'tl-head tl-head-music' }, icon('music', 15), 'Musique'));

  const selInfo = h('span', { class: 'tl-info' });
  const zoomInput = h('input', {
    type: 'range', min: 0, max: 1000, class: 'range tl-zoom',
    oninput: () => setZoom(MIN_PPS * (MAX_PPS / MIN_PPS) ** (zoomInput.value / 1000)),
  });
  const sortMenu = h('select', {
    class: 'select select-sm', title: 'Trier',
    onchange: () => { if (sortMenu.value) sortClips(sortMenu.value); sortMenu.value = ''; },
  }, h('option', { value: '' }, 'Trier…'), h('option', { value: 'name' }, 'Par nom'), h('option', { value: 'date' }, 'Par date'));

  const toolbar = h('div', { class: 'tl-toolbar' },
    selInfo,
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => select('clips', store.project.clips.map((c) => c.id)), title: 'Ctrl+A' }, 'Tout sélectionner'),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: shuffleClips, title: 'Mélanger (la sélection, ou tout)' }, icon('shuffle', 15), 'Mélanger'),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: reverseClips, title: 'Inverser l\'ordre' }, icon('reverse', 15), 'Inverser'),
    sortMenu,
    h('button', { class: 'btn btn-ghost btn-sm', onclick: deleteSelection, title: 'Supprimer (Suppr)' }, icon('trash', 15), 'Supprimer'),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn btn-icon btn-sm', onclick: () => setZoom(pps / 1.4), title: 'Dézoomer' }, icon('zoomout', 16)),
    zoomInput,
    h('button', { class: 'btn btn-icon btn-sm', onclick: () => setZoom(pps * 1.4), title: 'Zoomer' }, icon('zoomin', 16)),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: fit, title: 'Tout voir' }, icon('fit', 15), 'Ajuster'));

  const root = h('div', { class: 'timeline' }, toolbar, h('div', { class: 'tl-body' }, heads, scroller));

  // ---------- zoom ----------
  function setZoom(v, anchorClientX) {
    const r = scroller.getBoundingClientRect();
    const ax = anchorClientX != null ? anchorClientX - r.left : r.width / 2;
    const tAnchor = tAt(scroller.scrollLeft + ax);
    pps = clamp(v, MIN_PPS, MAX_PPS);
    localStorage.setItem('reel-pps', String(pps));
    zoomInput.value = String(Math.round(1000 * Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)));
    renderAll();
    scroller.scrollLeft = x(tAnchor) - ax;
  }

  function fit() {
    const w = scroller.clientWidth - PAD * 2 - 20;
    if (store.tl.total > 0) setZoom(w / store.tl.total);
    scroller.scrollLeft = 0;
  }

  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX);
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      scroller.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });

  // ---------- rendu ----------
  function contentWidth() {
    const musicEnd = store.project.music ? store.project.music.duration - store.project.music.start : 0;
    return Math.max(scroller.clientWidth, x(Math.max(store.tl.total, Math.min(musicEnd, store.tl.total + 30))) + 200);
  }

  function renderClips() {
    const p = store.project;
    const { starts, durs } = store.tl;
    const selected = new Set(store.sel.type === 'clips' ? store.sel.ids : []);
    const frag = document.createDocumentFragment();
    p.clips.forEach((c, i) => {
      const m = p.media[c.mediaId];
      const el = h('div', {
        class: `tl-clip ${selected.has(c.id) ? 'is-selected' : ''} ${m?.type === 'video' ? 'is-video' : ''}`,
        dataset: { id: c.id, index: i },
        style: { left: `${x(starts[i])}px`, width: `${Math.max(2, durs[i] * pps)}px` },
      });
      if (m) el.style.backgroundImage = `url("${fileUrl(p.id, 'thumbs', `${m.id}.jpg`)}")`;
      else {
        el.style.backgroundColor = c.color;
        el.classList.add('is-card');
        if (durs[i] * pps > 50) el.append(h('span', { class: 'tl-clip-label' }, 'Carton'));
      }
      if (m?.type === 'video' && durs[i] * pps > 26) el.append(h('span', { class: 'tl-clip-badge' }, icon('video', 12)));
      if (durs[i] * pps > 10) el.append(h('div', { class: 'tl-clip-edge', dataset: { edge: '1' } }));
      frag.append(el);
    });
    clipsTrack.replaceChildren(frag);
  }

  function renderOverlays() {
    const p = store.project;
    const lanes = [];
    const sorted = [...p.overlays].sort((a, b) => a.start - b.start);
    const frag = document.createDocumentFragment();
    for (const ov of sorted) {
      let lane = lanes.findIndex((end) => end <= ov.start + 1e-6);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = ov.end;
      const label = ov.type === 'text' ? (ov.text || 'Texte').replace(/\n/g, ' ') : 'Logo';
      frag.append(h('div', {
        class: `tl-ov tl-ov-${ov.type} ${store.sel.type === 'overlay' && store.sel.ids[0] === ov.id ? 'is-selected' : ''}`,
        dataset: { id: ov.id },
        style: { left: `${x(ov.start)}px`, width: `${Math.max(6, (ov.end - ov.start) * pps)}px`, top: `${4 + lane * 26}px` },
      },
      h('div', { class: 'tl-ov-edge tl-ov-edge-l', dataset: { edge: 'l' } }),
      h('span', { class: 'tl-ov-label' }, label),
      h('div', { class: 'tl-ov-edge tl-ov-edge-r', dataset: { edge: 'r' } })));
    }
    const ovH = `${Math.max(1, lanes.length) * 26 + 8}px`;
    ovTrack.style.height = ovH;
    ovHead.style.height = ovH;
    if (!p.overlays.length) frag.append(h('div', { class: 'tl-hint' }, 'Ajoutez un texte ou un logo depuis la barre au-dessus de l\'aperçu'));
    ovTrack.replaceChildren(frag);
  }

  function renderRuler() {
    const p = store.project;
    const w = scroller.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    const hgt = 26;
    ruler.width = w * dpr; ruler.height = hgt * dpr;
    ruler.style.width = `${w}px`; ruler.style.height = `${hgt}px`;
    ruler.style.transform = `translateX(${scroller.scrollLeft}px)`;
    const g = ruler.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, hgt);
    const css = getComputedStyle(root);
    const sl = scroller.scrollLeft;
    const t0 = Math.max(0, tAt(sl)), t1 = tAt(sl + w);

    // Temps musicaux
    const L = beatLength(p);
    const ph = beatPhase(p);
    if (L * pps >= 5) {
      const k0 = Math.max(0, Math.floor((t0 - ph) / L));
      for (let k = k0; ph + k * L <= t1; k++) {
        const tx = x(ph + k * L) - sl;
        const bar = k % 4 === 0;
        g.fillStyle = bar ? css.getPropertyValue('--beat-strong') : css.getPropertyValue('--beat');
        g.fillRect(Math.round(tx), bar ? 14 : 19, 1, bar ? 12 : 7);
      }
    }
    // Secondes
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = steps.find((s) => s * pps >= 64) || 60;
    g.font = '11px Inter, system-ui, sans-serif';
    g.fillStyle = css.getPropertyValue('--muted');
    for (let s = Math.floor(t0 / step) * step; s <= t1; s += step) {
      const tx = x(s) - sl;
      g.fillRect(Math.round(tx), 0, 1, 6);
      g.fillText(fmtTime(s, step < 1), tx + 4, 11);
    }
    // Fin de la vidéo
    if (store.tl.total > 0) {
      g.fillStyle = css.getPropertyValue('--accent');
      g.fillRect(Math.round(x(store.tl.total) - sl), 0, 2, hgt);
    }
  }

  function renderWave() {
    const p = store.project;
    const w = scroller.clientWidth;
    const hgt = musicTrack.clientHeight || 52;
    const dpr = window.devicePixelRatio || 1;
    waveCanvas.width = w * dpr; waveCanvas.height = hgt * dpr;
    waveCanvas.style.width = `${w}px`; waveCanvas.style.height = `${hgt}px`;
    waveCanvas.style.transform = `translateX(${scroller.scrollLeft}px)`;
    const g = waveCanvas.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, hgt);
    const css = getComputedStyle(root);
    if (!p.music) {
      musicLabel.replaceChildren(h('span', { class: 'tl-hint-inline' }, 'Aucune musique — glissez un fichier audio ou utilisez le panneau de gauche'));
      return;
    }
    musicLabel.replaceChildren(h('strong', {}, p.music.name), h('span', {}, ' · glisser pour choisir le passage'));
    if (!music.peaks) return;
    const { data, perSecond } = music.peaks;
    const sl = scroller.scrollLeft;
    const mid = hgt / 2 + 6;
    const amp = hgt / 2 - 10;
    const total = store.tl.total;
    const colIn = css.getPropertyValue('--music');
    const colOut = css.getPropertyValue('--music-dim');
    for (let px = 0; px < w; px += 2) {
      const t = tAt(px + sl);
      if (t < 0) continue;
      const songT = p.music.start + t;
      if (songT > p.music.duration) break;
      const i0 = Math.floor(songT * perSecond);
      const i1 = Math.max(i0 + 1, Math.floor((songT + 2 / pps) * perSecond));
      let v = 0;
      for (let i = i0; i < i1 && i < data.length; i++) v = Math.max(v, data[i]);
      const bh = Math.max(1, v * amp);
      g.fillStyle = t <= total ? colIn : colOut;
      g.fillRect(px, mid - bh, 1.5, bh * 2);
    }
  }

  function renderPlayhead() {
    playhead.style.transform = `translateX(${x(store.time)}px)`;
  }

  function renderInfo() {
    const p = store.project;
    const n = store.sel.type === 'clips' ? store.sel.ids.length : 0;
    selInfo.textContent = n
      ? `${n} sélectionné${n > 1 ? 's' : ''}`
      : `${p.clips.length} média${p.clips.length > 1 ? 's' : ''} · ${fmtTime(store.tl.total)}`;
  }

  function renderAll() {
    if (!store.project) return;
    content.style.width = `${contentWidth()}px`;
    renderClips();
    renderOverlays();
    renderRuler();
    renderWave();
    renderPlayhead();
    renderInfo();
  }

  const scheduleAll = rafThrottle(renderAll);
  const scheduleCanvases = rafThrottle(() => { if (store.project) { renderRuler(); renderWave(); } });
  scroller.addEventListener('scroll', scheduleCanvases);
  new ResizeObserver(scheduleAll).observe(scroller);

  // ---------- interactions ----------
  const pointerT = (e) => tAt(e.clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft);

  function scrub(e) {
    setTime(clamp(pointerT(e), 0, store.tl.total));
    const move = (ev) => setTime(clamp(pointerT(ev), 0, store.tl.total));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  rulerTrack.addEventListener('pointerdown', (e) => { if (e.button === 0) scrub(e); });
  playhead.addEventListener('pointerdown', (e) => { if (e.button === 0) { e.stopPropagation(); scrub(e); } });

  // Défilement automatique pendant un glisser près des bords.
  let autoScroll = null;
  function startAutoScroll(getClientX) {
    const step = () => {
      const r = scroller.getBoundingClientRect();
      const cx = getClientX();
      if (cx < r.left + 50) scroller.scrollLeft -= Math.ceil((r.left + 50 - cx) / 4);
      else if (cx > r.right - 50) scroller.scrollLeft += Math.ceil((cx - r.right + 50) / 4);
      autoScroll = requestAnimationFrame(step);
    };
    autoScroll = requestAnimationFrame(step);
  }
  const stopAutoScroll = () => { cancelAnimationFrame(autoScroll); autoScroll = null; };

  // Médias : sélection, réordonnancement, durée.
  clipsTrack.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('.tl-clip');
    if (!el) { select(null); scrub(e); return; }
    const p = store.project;
    const id = el.dataset.id;
    const index = Number(el.dataset.index);
    const clip = p.clips[index];

    if (e.target.dataset.edge) return startResize(e, clip);

    const already = store.sel.type === 'clips' && store.sel.ids.includes(id);
    if (e.ctrlKey || e.metaKey) {
      const ids = already ? store.sel.ids.filter((x) => x !== id) : [...(store.sel.type === 'clips' ? store.sel.ids : []), id];
      select('clips', ids, id);
      return;
    }
    if (e.shiftKey && store.sel.type === 'clips' && store.sel.anchor) {
      const a = p.clips.findIndex((c) => c.id === store.sel.anchor);
      const [lo, hi] = a < index ? [a, index] : [index, a];
      select('clips', p.clips.slice(lo, hi + 1).map((c) => c.id), store.sel.anchor);
      return;
    }
    if (!already) select('clips', [id]);
    const { starts, durs } = store.tl;
    if (store.time < starts[index] || store.time >= starts[index] + durs[index]) setTime(starts[index] + Math.min(0.05, durs[index] / 2));

    // Glisser pour réordonner.
    const startX = e.clientX;
    let dragging = false;
    let ghost = null;
    let insertAt = null;
    let lastX = e.clientX;
    const move = (ev) => {
      lastX = ev.clientX;
      if (!dragging && Math.abs(ev.clientX - startX) < 5) return;
      if (!dragging) {
        dragging = true;
        root.classList.add('is-dragging');
        const n = store.sel.ids.length;
        ghost = h('div', { class: 'tl-ghost' }, n > 1 ? `${n} médias` : '1 média');
        document.body.append(ghost);
        startAutoScroll(() => lastX);
      }
      ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY - 30}px)`;
      const t = pointerT(ev);
      const st = store.tl.starts;
      let i = 0;
      while (i < st.length && st[i] + store.tl.durs[i] / 2 < t) i++;
      insertAt = i;
      marker.style.display = 'block';
      marker.style.transform = `translateX(${x(i < st.length ? st[i] : store.tl.total) - 1}px)`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      stopAutoScroll();
      marker.style.display = 'none';
      root.classList.remove('is-dragging');
      ghost?.remove();
      if (dragging && insertAt != null) moveClipsTo(store.sel.ids, insertAt);
      else if (!dragging && already && store.sel.ids.length > 1) select('clips', [id]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // Bord droit d'une vignette : change la durée (de la sélection entière si la vignette en fait partie).
  function startResize(e, clip) {
    e.stopPropagation();
    const ids = store.sel.type === 'clips' && store.sel.ids.includes(clip.id) ? [...store.sel.ids] : [clip.id];
    if (ids.length === 1) select('clips', ids);
    const set = new Set(ids);
    const b0 = clip.beats;
    const L = beatLength(store.project);
    const x0 = e.clientX;
    const key = `resize-${Date.now()}`;
    root.classList.add('is-resizing');
    const move = (ev) => {
      const raw = b0 + (ev.clientX - x0) / pps / L;
      const q = ev.altKey ? 0.0625 : 0.25;
      const beats = Math.max(q, Math.round(raw / q) * q);
      commit((p) => {
        let changed = false;
        for (const c of p.clips) if (set.has(c.id) && c.beats !== beats) { c.beats = beats; changed = true; }
        return changed ? undefined : false;
      }, { key });
    };
    const up = () => {
      root.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Textes / logos : sélection, déplacement et réglage de la durée d'affichage.
  ovTrack.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('.tl-ov');
    if (!el) { select(null); scrub(e); return; }
    const id = el.dataset.id;
    const ov = store.project.overlays.find((o) => o.id === id);
    select('overlay', [id]);
    if (store.time < ov.start || store.time >= ov.end) setTime(ov.start + Math.min(0.4, (ov.end - ov.start) / 2));
    const mode = e.target.dataset.edge || 'move';
    const { start: s0, end: e0 } = ov;
    const x0 = e.clientX;
    const key = `ov-${Date.now()}`;
    // Points d'accroche : coupes entre médias, tête de lecture, début.
    const snaps = [0, store.tl.total, ...store.tl.starts];
    const snap = (t) => {
      let best = t, bd = 8 / pps;
      for (const s of snaps) if (Math.abs(s - t) < bd) { bd = Math.abs(s - t); best = s; }
      return best;
    };
    const move = (ev) => {
      const dt = (ev.clientX - x0) / pps;
      let start = s0, end = e0;
      if (mode === 'move') {
        const rawS = s0 + dt, rawE = e0 + dt;
        const sS = snap(rawS), sE = snap(rawE);
        start = rawS;
        if (sS !== rawS && (sE === rawE || Math.abs(sS - rawS) <= Math.abs(sE - rawE))) start = sS;
        else if (sE !== rawE) start = sE - (e0 - s0);
        start = Math.max(0, start);
        end = start + (e0 - s0);
      } else if (mode === 'l') start = clamp(snap(s0 + dt), 0, e0 - 0.1);
      else end = Math.max(s0 + 0.1, snap(e0 + dt));
      commit((p) => { const o = p.overlays.find((q) => q.id === id); o.start = start; o.end = end; }, { key });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // Musique : glisser pour choisir le passage (calé sur les temps, Alt pour un réglage libre).
  musicTrack.addEventListener('pointerdown', (e) => {
    const p = store.project;
    if (e.button !== 0 || !p.music) return;
    const start0 = p.music.start;
    const x0 = e.clientX;
    const key = `music-${Date.now()}`;
    musicTrack.classList.add('is-dragging');
    const move = (ev) => {
      let s = clamp(start0 - (ev.clientX - x0) / pps, 0, Math.max(0, p.music.duration - 1));
      if (!ev.altKey) s = snapToBeat(store.project, s);
      commit((proj) => { if (proj.music.start === s) return false; proj.music.start = s; }, { key });
    };
    const up = () => {
      musicTrack.classList.remove('is-dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // ---------- abonnements ----------
  on('project', (d) => {
    if (d?.source === 'open') {
      requestAnimationFrame(() => {
        if (store.tl.total > 0 && x(store.tl.total) < scroller.clientWidth * 0.3) fit();
        else renderAll();
      });
    }
    scheduleAll();
  });
  on('select', scheduleAll);
  on('music', scheduleAll);
  on('time', () => {
    renderPlayhead();
    if (store.playing) {
      const px = x(store.time);
      if (px > scroller.scrollLeft + scroller.clientWidth - 60 || px < scroller.scrollLeft) {
        scroller.scrollLeft = px - scroller.clientWidth * 0.25;
      }
    }
  });

  setZoom(pps);
  return root;
}
