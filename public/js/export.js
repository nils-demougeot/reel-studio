// Export : chaque image est rendue dans le navigateur (même moteur que l'aperçu),
// puis envoyée au serveur local qui encode en H.264 haute qualité avec la musique.

import * as api from './api.js';
import { store, commit } from './store.js';
import { computeTimeline, clipIndexAt, FONTS, FRAME_W, FRAME_H, musicSegments } from './model.js';
import { drawFrame } from './render.js';
import { ExportSources } from './media.js';
import { pause } from './preview.js';
import { h, icon, modal, fmtTime, fmtBytes, toast } from './util.js';

const QUALITIES = [
  { id: 'high', label: 'Haute', crf: 17, note: 'Recommandé pour Instagram' },
  { id: 'max', label: 'Maximale', crf: 13, note: 'Fichier plus lourd' },
];

// Pool de workers qui encodent les images en JPEG en parallèle.
class JpegPool {
  constructor(size) {
    this.workers = Array.from({ length: size }, () => new Worker('/js/jpeg-worker.js'));
    this.pending = new Map();
    this.next = 0;
    this.seq = 0;
    for (const w of this.workers) {
      w.onmessage = ({ data }) => {
        const p = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) p.reject(new Error(data.error)); else p.resolve(data.blob);
      };
    }
  }

  encode(bitmap, quality) {
    const id = this.seq++;
    const w = this.workers[this.next++ % this.workers.length];
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ id, bitmap, quality }, [bitmap]);
    });
  }

  dispose() { for (const w of this.workers) w.terminate(); }
}

export async function loadAllFonts() {
  await Promise.all(FONTS.flatMap((f) => f.weights.map((w) => document.fonts.load(`${w} 40px "${f.family}"`).catch(() => {}))));
}

export function openExportDialog() {
  const p = store.project;
  if (!p.clips.length) { toast('Ajoutez d\'abord des photos ou vidéos.', { type: 'warn' }); return; }
  pause();

  const opts = { quality: p.export.quality || 'high', fps: p.export.fps || 30, audio: p.export.audio || 'with' };
  const nameInput = h('input', { class: 'input', value: p.name || 'reel' });
  const seg = (list, key) => h('div', { class: 'segmented' }, list.map((o) => {
    const b = h('button', {
      class: `seg ${opts[key] === o.id ? 'is-on' : ''}`,
      onclick: () => { opts[key] = o.id; b.parentElement.querySelectorAll('.seg').forEach((x) => x.classList.remove('is-on')); b.classList.add('is-on'); },
    }, o.label);
    return b;
  }));

  const total = store.tl.total;
  const warnings = [];
  if (!p.music) warnings.push('Aucune musique : la vidéo sera muette.');
  if (total > 180) warnings.push('Plus de 3 minutes : Instagram risque de refuser le reel.');

  const form = h('div', { class: 'export-form' },
    h('div', { class: 'export-summary' },
      h('div', {}, h('strong', {}, fmtTime(total)), h('span', {}, 'durée')),
      h('div', {}, h('strong', {}, '1080 × 1920'), h('span', {}, 'format 9:16')),
      h('div', {}, h('strong', {}, String(p.clips.length)), h('span', {}, 'médias'))),
    h('label', { class: 'field' }, h('span', {}, 'Nom du fichier'), nameInput),
    h('div', { class: 'field' }, h('span', {}, 'Qualité'), seg(QUALITIES, 'quality')),
    h('div', { class: 'field' }, h('span', {}, 'Images par seconde'), seg([{ id: 30, label: '30 i/s' }, { id: 60, label: '60 i/s (plus fluide, plus long)' }], 'fps')),
    p.music ? h('div', { class: 'field' }, h('span', {}, 'Musique'),
      seg([{ id: 'with', label: 'Incluse dans la vidéo' }, { id: 'without', label: 'Sans (à ajouter dans Instagram)' }], 'audio'),
      h('p', { class: 'insp-hint' }, `Sans : la vidéo est muette et vous ajoutez « ${p.music.name.replace(/\.[^.]+$/, '')} » depuis la bibliothèque musicale d’Instagram, en choisissant le passage qui commence à ${fmtTime(p.music.start, false)}. C’est la façon la plus sûre de publier avec un morceau connu (droits gérés par Instagram, pas de son coupé).`),
      p.music.removed?.length ? h('p', { class: 'insp-hint warn' }, 'Votre musique contient des passages coupés : Instagram ne pourra pas reproduire ces coupes, gardez plutôt la musique incluse.') : null) : null,
    warnings.map((w) => h('p', { class: 'insp-hint warn' }, w)));

  const m = modal({
    title: 'Exporter la vidéo',
    body: form,
    width: 480,
    actions: [
      { label: 'Annuler', onClick: (close) => close() },
      {
        label: 'Exporter', primary: true,
        onClick: (close) => {
          close();
          commit((q) => { q.export.quality = opts.quality; q.export.fps = opts.fps; q.export.audio = opts.audio; });
          runExport({ ...opts, name: nameInput.value.trim() || 'reel' });
        },
      },
    ],
  });
  setTimeout(() => nameInput.focus(), 0);
  return m;
}

async function runExport({ quality, fps, name, audio }) {
  const p = structuredClone(store.project);
  const tl = computeTimeline(p);
  const W = FRAME_W, H = FRAME_H;
  const N = Math.max(1, Math.round(tl.total * fps));
  const crf = QUALITIES.find((q) => q.id === quality)?.crf ?? 17;

  // ----- interface de progression -----
  let cancelled = false;
  const mini = h('canvas', { class: 'export-mini', width: 180, height: 320 });
  const bar = h('div', { class: 'progress-bar' });
  const status = h('div', { class: 'export-status' }, 'Préparation…');
  const eta = h('div', { class: 'muted' }, '');
  const body = h('div', { class: 'export-progress' }, mini,
    h('div', { class: 'export-side' }, status, h('div', { class: 'progress progress-lg' }, bar), eta,
      h('p', { class: 'insp-hint' }, 'Gardez cet onglet ouvert pendant l\'export.')));
  const dlg = modal({
    title: 'Export en cours', body, width: 520, dismissable: false,
    actions: [{ label: 'Annuler l\'export', onClick: () => { cancelled = true; status.textContent = 'Annulation…'; } }],
  });
  const miniCtx = mini.getContext('2d');

  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* facultatif */ }

  const src = new ExportSources(p, W, H);
  const pool = new JpegPool(Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 2)));
  let exportId = null;
  const t0 = performance.now();
  try {
    await loadAllFonts();
    await src.init();
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });

    ({ exportId } = await api.startExport(p.id, {
      fps, crf, name, duration: N / fps,
      music: p.music && audio !== 'without' ? {
        file: p.music.file, start: p.music.start, volume: p.music.volume ?? 1, fadeOut: p.export.fadeOut,
        segments: musicSegments(p).map((s) => ({ from: s.from, to: s.to })),
      } : null,
    }));

    // Les images sont encodées en parallèle mais envoyées dans l'ordre, par paquets.
    const queue = []; // promesses de JPEG, dans l'ordre des images
    let inflight = Promise.resolve();
    const send = async (count) => {
      const blobs = await Promise.all(queue.splice(0, count));
      await inflight;
      inflight = api.pushFrames(exportId, new Blob(blobs, { type: 'application/octet-stream' }));
      inflight.catch(() => {}); // l'erreur est traitée au prochain `await inflight`
    };

    for (let i = 0; i < N; i++) {
      if (cancelled) throw new Error('cancelled');
      const t = i / fps;
      const idx = clipIndexAt(tl, t);
      if (idx >= 0) await src.prepare(idx, t - tl.starts[idx]);
      drawFrame(ctx, W, H, p, tl, t, src);
      queue.push(pool.encode(await createImageBitmap(canvas), 0.95));
      if (queue.length >= 12) await send(8);

      if (i % 3 === 0 || i === N - 1) {
        miniCtx.drawImage(canvas, 0, 0, mini.width, mini.height);
        const frac = (i + 1) / N;
        bar.style.width = `${frac * 100}%`;
        status.textContent = `Image ${i + 1} / ${N}`;
        const elapsed = (performance.now() - t0) / 1000;
        if (i > fps) eta.textContent = `Environ ${Math.max(1, Math.round(elapsed / frac - elapsed))} s restantes`;
      }
    }
    await send(queue.length);
    await inflight;
    status.textContent = 'Finalisation de la vidéo…';
    eta.textContent = '';
    const result = await api.finishExport(exportId);
    exportId = null;
    dlg.close();
    showDone(p, result, (performance.now() - t0) / 1000, audio === 'without');
  } catch (err) {
    dlg.close();
    if (exportId) api.cancelExport(exportId).catch(() => {});
    if (err.message === 'cancelled') toast('Export annulé.');
    else {
      console.error(err);
      modal({
        title: 'L\'export a échoué',
        body: h('div', {}, h('p', {}, 'Le projet est intact. Réessayez ; si le problème persiste, voici le détail :'),
          h('pre', { class: 'error-log' }, String(err.message).slice(-1500))),
        actions: [{ label: 'Fermer', primary: true, onClick: (c) => c() }],
      });
    }
  } finally {
    src.dispose();
    pool.dispose();
    wakeLock?.release?.().catch(() => {});
  }
}

function showDone(p, result, seconds, muted = false) {
  modal({
    title: 'Vidéo prête',
    width: 460,
    body: h('div', { class: 'export-done' },
      h('div', { class: 'export-done-icon' }, icon('check', 28)),
      h('p', {}, h('strong', {}, result.file)),
      h('p', { class: 'muted' }, `${fmtBytes(result.size)} · exportée en ${Math.round(seconds)} s`),
      h('p', { class: 'insp-hint' }, 'Le fichier est aussi enregistré dans le dossier « exports » du projet.'),
      muted && p.music ? h('p', { class: 'insp-hint warn' },
        `Dans Instagram : ajoutez la musique « ${p.music.name.replace(/\.[^.]+$/, '')} » et placez son début à ${fmtTime(p.music.start, false)} pour retrouver la synchronisation.`) : null),
    actions: [
      { label: 'Ouvrir le dossier', onClick: () => api.reveal(p.id, result.file).catch(() => toast('Impossible d\'ouvrir le dossier.', { type: 'warn' })) },
      {
        label: 'Télécharger', primary: true,
        onClick: (close) => {
          const a = h('a', { href: `${result.url}?download=1`, download: result.file });
          document.body.append(a); a.click(); a.remove();
          close();
        },
      },
    ],
  });
}
