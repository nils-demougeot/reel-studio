// Timeline : vignettes des médias (sélection, réordonnancement, durée au bord),
// calques (textes et stickers), musique avec forme d'onde et grille des temps.

import { store, on, commit, select, setTime, setActiveTrack, setMagnet } from './store.js';
import { beatLength, beatPhase, musicSegments, songTimeAt, SNAP_PX, nearest, beatGrid, gridSubFor } from './model.js';
import { music, moveClipsTo, deleteSelection, shuffleClips, reverseClips, sortClips, splitAtPlayhead, magnetOn } from './actions.js';
import { openMusicEditor } from './music-editor.js';
import { cssPaint } from './render.js';
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
  const soundTrack = h('div', { class: 'tl-track tl-sounds' });
  const waveCanvas = h('canvas', { class: 'tl-wave-canvas' });
  const musicLabel = h('div', { class: 'tl-music-label' });
  const musicTrack = h('div', { class: 'tl-track tl-music' }, waveCanvas, musicLabel);
  const playhead = h('div', { class: 'tl-playhead' }, h('div', { class: 'tl-playhead-knob' }));
  const marker = h('div', { class: 'tl-insert' });
  const content = h('div', { class: 'tl-content' }, rulerTrack, clipsTrack, ovTrack, soundTrack, musicTrack, marker, playhead);
  const scroller = h('div', { class: 'tl-scroll' }, content);

  const ovHead = h('div', { class: 'tl-head tl-head-ov', title: 'Textes et stickers : la ligne du haut est au premier plan' }, icon('layers', 15), 'Calques');
  const clipsHead = h('div', { class: 'tl-head tl-head-clips', title: 'Cliquer pour couper les médias', onclick: () => setActiveTrack('clips') }, icon('image', 15), 'Médias');
  const musicHead = h('div', { class: 'tl-head tl-head-music', title: 'Cliquer pour couper la musique', onclick: () => setActiveTrack('music') }, icon('music', 15), 'Musique');
  const soundHead = h('div', { class: 'tl-head tl-head-sounds', title: 'Effets sonores' }, icon('sound', 15), 'Sons');
  const heads = h('div', { class: 'tl-heads' },
    h('div', { class: 'tl-head tl-head-ruler' }),
    clipsHead,
    ovHead,
    soundHead,
    musicHead);

  const selInfo = h('span', { class: 'tl-info' });
  const zoomInput = h('input', {
    type: 'range', min: 0, max: 1000, class: 'range tl-zoom',
    oninput: () => setZoom(MIN_PPS * (MAX_PPS / MIN_PPS) ** (zoomInput.value / 1000)),
  });
  const sortMenu = h('select', {
    class: 'select select-sm', title: 'Trier',
    onchange: () => { if (sortMenu.value) sortClips(sortMenu.value); sortMenu.value = ''; },
  }, h('option', { value: '' }, 'Trier…'), h('option', { value: 'name' }, 'Par nom'), h('option', { value: 'date' }, 'Par date'));

  const cutBtn = h('button', {
    class: 'btn btn-ghost btn-sm tl-cut', onclick: (e) => splitAtPlayhead({ free: e.altKey }),
  }, icon('scissors', 15), 'Couper');
  const magnetBtn = h('button', {
    class: 'btn btn-ghost btn-sm tl-magnet', onclick: () => setMagnet(!store.magnet),
  }, icon('magnet', 15), 'Aimant');
  const renderMagnet = () => {
    magnetBtn.classList.toggle('is-on', store.magnet);
    magnetBtn.title = store.magnet
      ? 'Aimant activé : coupes, durées et calques s’accrochent aux temps et aux autres éléments quand ils en sont proches. Alt pour l’ignorer.'
      : 'Aimant désactivé : tout se place librement, au pixel près. Alt pour aimanter ponctuellement.';
  };
  renderMagnet();
  const toolbar = h('div', { class: 'tl-toolbar' },
    selInfo,
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => select('clips', store.project.clips.map((c) => c.id)), title: 'Ctrl+A' }, 'Tout sélectionner'),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: shuffleClips, title: 'Mélanger (la sélection, ou tout)' }, icon('shuffle', 15), 'Mélanger'),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: reverseClips, title: 'Inverser l\'ordre' }, icon('reverse', 15), 'Inverser'),
    sortMenu,
    cutBtn,
    h('button', { class: 'btn btn-ghost btn-sm', onclick: deleteSelection, title: 'Supprimer (Suppr)' }, icon('trash', 15), 'Supprimer'),
    magnetBtn,
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
    store.pps = pps;
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

  // Zone hachurée à partir de `left` pixels : dépasse la durée réelle du fichier.
  const overflowZone = (left, title) => h('div', { class: 'tl-overflow', style: { left: `${left}px` }, title });

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
        el.style.background = cssPaint(c.color);
        el.classList.add('is-card');
        if (durs[i] * pps > 50) el.append(h('span', { class: 'tl-clip-label' }, 'Carton'));
      }
      if (m?.type === 'video' && durs[i] * pps > 26) el.append(h('span', { class: 'tl-clip-badge' }, icon('video', 12)));
      // Partie au-delà de la fin réelle de la vidéo : hachurée (la dernière image reste affichée).
      if (m?.type === 'video' && m.duration) {
        const avail = Math.max(0, m.duration - (c.trim || 0));
        if (durs[i] > avail + 0.02) el.append(overflowZone(avail * pps, 'Au-delà de la fin de la vidéo : la dernière image reste affichée'));
      }
      if (durs[i] * pps > 10) el.append(h('div', { class: 'tl-clip-edge', dataset: { edge: '1' } }));
      frag.append(el);
    });
    clipsTrack.replaceChildren(frag);
  }

  const ROW = 26;
  // Une ligne par calque : la ligne du haut (dernier du tableau) est au premier plan.
  function renderOverlays() {
    const p = store.project;
    const n = p.overlays.length;
    const frag = document.createDocumentFragment();
    p.overlays.forEach((ov, i) => {
      const row = n - 1 - i;
      const name = ov.file ? ov.file.replace(/^sticker-/, '').replace(/\.[^.]+$/, '') : '';
      const label = ov.type === 'text'
        ? (ov.text || 'Texte').replace(/\n/g, ' ')
        : `${{ video: 'Vidéo', anim: 'Animé' }[ov.kind] || 'Sticker'} · ${name}`;
      frag.append(h('div', {
        class: `tl-ov tl-ov-${ov.type} ${store.sel.type === 'overlay' && store.sel.ids[0] === ov.id ? 'is-selected' : ''}`,
        dataset: { id: ov.id },
        style: { left: `${x(ov.start)}px`, width: `${Math.max(6, (ov.end - ov.start) * pps)}px`, top: `${4 + row * ROW}px` },
      },
      h('div', { class: 'tl-ov-edge tl-ov-edge-l', dataset: { edge: 'l' } }),
      h('span', { class: 'tl-ov-label' }, label),
      ov.type === 'sticker' && ov.loop === false && ov.duration && ov.end - ov.start > ov.duration + 0.02
        ? overflowZone(ov.duration * pps, 'Au-delà de la fin du sticker : la dernière image reste affichée')
        : null,
      h('div', { class: 'tl-ov-edge tl-ov-edge-r', dataset: { edge: 'r' } })));
    });
    const ovH = `${Math.max(1, n) * ROW + 8}px`;
    ovTrack.style.height = ovH;
    ovHead.style.height = ovH;
    if (!n) frag.append(h('div', { class: 'tl-hint' }, 'Ajoutez un texte ou un sticker depuis la barre au-dessus de l\'aperçu'));
    ovTrack.replaceChildren(frag);
  }


  // Effets sonores : rangés sur plusieurs lignes s'ils se chevauchent.
  function renderSounds() {
    const p = store.project;
    const lanes = [];
    const frag = document.createDocumentFragment();
    for (const s of [...p.sounds].sort((a, b) => a.start - b.start)) {
      let lane = lanes.findIndex((end) => end <= s.start + 1e-6);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = s.start + s.duration;
      frag.append(h('div', {
        class: `tl-snd ${store.sel.type === 'sound' && store.sel.ids.includes(s.id) ? 'is-selected' : ''}`,
        dataset: { id: s.id },
        style: { left: `${x(s.start)}px`, width: `${Math.max(6, s.duration * pps)}px`, top: `${4 + lane * 24}px` },
      }, h('span', { class: 'tl-ov-label' }, s.name)));
    }
    const hgt = `${Math.max(1, lanes.length) * 24 + 8}px`;
    soundTrack.style.height = hgt;
    soundHead.style.height = hgt;
    if (!p.sounds.length) frag.append(h('div', { class: 'tl-hint' }, 'Ajoutez un effet sonore avec le bouton « Son » au-dessus de l’aperçu'));
    soundTrack.replaceChildren(frag);
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
    const cut = p.music.removed.length ? ` · ${p.music.removed.length} passage${p.music.removed.length > 1 ? 's' : ''} supprimé${p.music.removed.length > 1 ? 's' : ''}` : '';
    musicLabel.replaceChildren(h('strong', {}, p.music.name), h('span', {}, cut),
      h('button', { class: 'tl-music-edit', onclick: (e) => { e.stopPropagation(); openMusicEditor(); }, onpointerdown: (e) => e.stopPropagation() },
        icon('scissors', 12), 'Choisir les passages'));
    if (!music.peaks) return;
    const { data, perSecond } = music.peaks;
    const sl = scroller.scrollLeft;
    const mid = hgt / 2 + 6;
    const amp = hgt / 2 - 10;
    const total = store.tl.total;
    const segs = musicSegments(p);
    const colIn = css.getPropertyValue('--music');
    const colOut = css.getPropertyValue('--music-dim');

    // Passage sélectionné
    const selKeys = store.sel.type === 'music' ? store.sel.ids : [];
    for (const sg of segs) {
      if (!selKeys.includes(sg.key)) continue;
      g.fillStyle = css.getPropertyValue('--accent-soft');
      g.fillRect(x(sg.at) - sl, 0, (sg.to - sg.from) * pps, hgt);
    }
    for (let px = 0; px < w; px += 2) {
      const t = tAt(px + sl);
      if (t < 0) continue;
      const songT = songTimeAt(p, t, segs);
      if (songT == null) break;
      const i0 = Math.floor(songT * perSecond);
      const i1 = Math.max(i0 + 1, Math.floor((songT + 2 / pps) * perSecond));
      let v = 0;
      for (let i = i0; i < i1 && i < data.length; i++) v = Math.max(v, data[i]);
      const bh = Math.max(1, v * amp);
      g.fillStyle = t <= total ? colIn : colOut;
      g.fillRect(px, mid - bh, 1.5, bh * 2);
    }
    // Repères : coupe (trait blanc) ou raccord après un passage supprimé (trait orange).
    for (const sg of segs.slice(1)) {
      const px = Math.round(x(sg.at) - sl);
      if (px < -2 || px > w + 2) continue;
      g.fillStyle = sg.joined ? css.getPropertyValue('--accent') : css.getPropertyValue('--text');
      g.fillRect(px - (sg.joined ? 1 : 0), 0, sg.joined ? 3 : 1.5, hgt);
    }
  }

  function renderPlayhead() {
    playhead.style.transform = `translateX(${x(store.time)}px)`;
  }

  function renderInfo() {
    const p = store.project;
    const n = store.sel.type === 'clips' ? store.sel.ids.length : 0;
    if (store.sel.type === 'music') {
      selInfo.textContent = 'Passage de musique sélectionné — Suppr pour le retirer';
      return;
    }
    selInfo.textContent = n
      ? `${n} sélectionné${n > 1 ? 's' : ''}`
      : `${p.clips.length} média${p.clips.length > 1 ? 's' : ''} · ${fmtTime(store.tl.total)}`;
  }

  function renderActiveTrack() {
    clipsHead.classList.toggle('is-active', store.activeTrack === 'clips');
    musicHead.classList.toggle('is-active', store.activeTrack === 'music');
    cutBtn.title = store.activeTrack === 'music'
      ? 'Couper la musique à la tête de lecture (S) — calé sur le temps, Alt pour une coupe libre'
      : 'Couper le média à la tête de lecture (S) — Alt pour une coupe libre';
  }

  function renderAll() {
    if (!store.project) return;
    renderActiveTrack();
    content.style.width = `${contentWidth()}px`;
    renderClips();
    renderOverlays();
    renderSounds();
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
    setActiveTrack('clips');
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
    const start = store.tl.starts[store.project.clips.findIndex((c) => c.id === clip.id)] || 0;
    const marks = [store.time, ...store.project.overlays.flatMap((o) => [o.start, o.end])];
    const move = (ev) => {
      let end = start + b0 * L + (ev.clientX - x0) / pps;
      if (magnetOn(ev.altKey)) {
        const tol = SNAP_PX / pps;
        end = nearest(end, [...beatGrid(store.project, end - tol, end + tol, gridSubFor(store.project, pps)), ...marks], tol);
      }
      const beats = Math.max(0.04 / L, (end - start) / L);
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

  // Calques : sélection, déplacement dans le temps, durée d'affichage,
  // et glisser vers le haut / le bas pour changer l'ordre de superposition.
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
    const y0 = e.clientY;
    const key = `ov-${Date.now()}`;
    let vertical = false;
    // Points d'accroche : coupes entre médias, tête de lecture, début.
    const snaps = [0, store.tl.total, store.time, ...store.tl.starts,
      ...store.project.overlays.filter((o) => o.id !== id).flatMap((o) => [o.start, o.end])];
    let magnet = store.magnet;
    const snap = (t) => (magnet ? nearest(t, snaps, SNAP_PX / pps) : t);
    const move = (ev) => {
      magnet = magnetOn(ev.altKey);
      // Glisser verticalement (sans bouger dans le temps) : change l'ordre des calques.
      if (mode === 'move' && (vertical || (Math.abs(ev.clientY - y0) > 12 && Math.abs(ev.clientY - y0) > Math.abs(ev.clientX - x0)))) {
        vertical = true;
        const p = store.project;
        const n = p.overlays.length;
        const row = clamp(Math.floor((ev.clientY - ovTrack.getBoundingClientRect().top - 4) / ROW), 0, n - 1);
        const target = n - 1 - row;
        const cur = p.overlays.findIndex((o) => o.id === id);
        if (cur !== target) {
          commit((proj) => { const [o] = proj.overlays.splice(cur, 1); proj.overlays.splice(target, 0, o); }, { key });
        }
        return;
      }
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

  // Effets sonores : clic pour sélectionner, glisser pour déplacer (aimanté aux coupes, aux temps…).
  soundTrack.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('.tl-snd');
    if (!el) { select(null); scrub(e); return; }
    const id = el.dataset.id;
    const snd = store.project.sounds.find((s) => s.id === id);
    select('sound', [id]);
    const s0 = snd.start;
    const x0 = e.clientX;
    const key = `snd-${Date.now()}`;
    const p = store.project;
    const marks = [0, store.time, store.tl.total, ...store.tl.starts,
      ...p.overlays.flatMap((o) => [o.start, o.end]), ...p.sounds.filter((s) => s.id !== id).map((s) => s.start)];
    const move = (ev) => {
      let start = Math.max(0, s0 + (ev.clientX - x0) / pps);
      if (magnetOn(ev.altKey)) {
        const tol = SNAP_PX / pps;
        start = nearest(start, [...marks, ...beatGrid(store.project, start - tol, start + tol, 1)], tol);
      }
      commit((proj) => { const s = proj.sounds.find((q) => q.id === id); if (s.start === start) return false; s.start = start; }, { key });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // Musique : un clic sélectionne un passage (et place la tête de lecture),
  // un double-clic ouvre la fenêtre de choix des passages.
  musicTrack.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    setActiveTrack('music');
    if (!store.project.music) return;
    const t = pointerT(e);
    if (t >= 0 && t <= store.tl.total) setTime(t);
    const seg = musicSegments(store.project).find((sg) => t >= sg.at && t < sg.at + (sg.to - sg.from));
    if (!seg) { select(null); return; }
    const already = store.sel.type === 'music' ? store.sel.ids : [];
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      select('music', already.includes(seg.key) ? already.filter((k) => k !== seg.key) : [...already, seg.key]);
    } else select('music', [seg.key]);
  });
  musicTrack.addEventListener('dblclick', () => { if (store.project.music) openMusicEditor(); });

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
  on('magnet', renderMagnet);
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
