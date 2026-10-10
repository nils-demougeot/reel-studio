// Import des fichiers et chargement des images / vidéos pour l'aperçu et l'export.

import * as api from './api.js';
import { naturalCompare, uid, progressToast, toast } from './util.js';
import { decodeAnimated, frameAt, stickerTime, disposeAnimated } from './stickers.js';

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const UNSUPPORTED_EXT = /\.(heic|heif|dng|cr2|nef|arw)$/i;

export const fileKind = (f) => {
  const n = f.name;
  if (IMAGE_EXT.test(n) || (f.type.startsWith('image/') && !UNSUPPORTED_EXT.test(n))) return 'image';
  if (VIDEO_EXT.test(n) || f.type.startsWith('video/')) return 'video';
  if (AUDIO_EXT.test(n) || f.type.startsWith('audio/')) return 'audio';
  if (UNSUPPORTED_EXT.test(n)) return 'unsupported';
  return null;
};

// Récupère tous les fichiers d'un glisser-déposer, y compris dans les sous-dossiers.
export async function filesFromDrop(dataTransfer) {
  const entries = [...dataTransfer.items].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      Object.defineProperty(file, 'relPath', { value: prefix + file.name });
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

export function dropFolderName(dataTransfer) {
  const entry = [...dataTransfer.items].map((it) => it.webkitGetAsEntry?.()).find((e) => e?.isDirectory);
  return entry?.name || null;
}

// ---------- génération des miniatures ----------

function canvasToBlob(canvas, quality = 0.85) {
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
}

async function scaledJpeg(source, sw, sh, maxSide, quality) {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, w, h);
  return canvasToBlob(c, quality);
}

function loadVideoMeta(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    const fail = () => reject(new Error('Vidéo illisible par le navigateur'));
    v.addEventListener('error', fail, { once: true });
    v.addEventListener('loadedmetadata', () => {
      if (!v.videoWidth) return fail();
      v.currentTime = Math.min(0.2, v.duration / 2);
    }, { once: true });
    v.addEventListener('seeked', () => resolve(v), { once: true });
    setTimeout(fail, 20000);
    v.src = url;
  });
}

async function prepareImage(projectId, file) {
  const bmp = await createImageBitmap(file);
  const id = uid('m');
  const [thumb, proxy] = await Promise.all([
    scaledJpeg(bmp, bmp.width, bmp.height, 360, 0.8),
    scaledJpeg(bmp, bmp.width, bmp.height, 1440, 0.86),
  ]);
  const media = { id, type: 'image', name: file.name, w: bmp.width, h: bmp.height, date: file.lastModified };
  bmp.close();
  media.file = await api.uploadFile(projectId, 'media', file.name, file, { unique: true });
  await api.uploadFile(projectId, 'thumbs', `${id}.jpg`, thumb);
  await api.uploadFile(projectId, 'proxies', `${id}.jpg`, proxy);
  media.proxy = true;
  return media;
}

async function prepareVideo(projectId, file) {
  const id = uid('m');
  const savedName = await api.uploadFile(projectId, 'media', file.name, file, { unique: true });
  let name = savedName;
  let v;
  try {
    v = await loadVideoMeta(api.fileUrl(projectId, 'media', savedName));
  } catch {
    // Format non lu par le navigateur (souvent HEVC) : conversion en H.264 par le serveur.
    name = (await api.transcode(projectId, savedName)).file;
    v = await loadVideoMeta(api.fileUrl(projectId, 'media', name));
  }
  const thumb = await scaledJpeg(v, v.videoWidth, v.videoHeight, 360, 0.8);
  await api.uploadFile(projectId, 'thumbs', `${id}.jpg`, thumb);
  const media = { id, type: 'video', name: file.name, file: name, w: v.videoWidth, h: v.videoHeight, duration: v.duration, date: file.lastModified };
  v.removeAttribute('src');
  v.load();
  return media;
}

// Importe une liste de fichiers. `onMedia` reçoit les médias par lots pour
// qu'ils apparaissent au fur et à mesure dans la timeline.
export async function importFiles(projectId, files, { onMedia, onAudio }) {
  const visual = [];
  const audio = [];
  let unsupported = 0;
  for (const f of files) {
    const k = fileKind(f);
    if (k === 'image' || k === 'video') visual.push(f);
    else if (k === 'audio') audio.push(f);
    else if (k === 'unsupported') unsupported++;
  }
  visual.sort((a, b) => naturalCompare(a.relPath || a.webkitRelativePath || a.name, b.relPath || b.webkitRelativePath || b.name));

  if (audio.length && onAudio) await onAudio(audio[0]);

  const failed = [];
  if (visual.length) {
    const prog = progressToast(`Import de ${visual.length} fichier${visual.length > 1 ? 's' : ''}…`);
    const results = new Array(visual.length);
    let next = 0, done = 0, flushed = 0;
    const flush = () => {
      // On livre les médias dans l'ordre, dès que le début de la liste est prêt.
      const batch = [];
      while (flushed < results.length && results[flushed] !== undefined) {
        if (results[flushed]) batch.push(results[flushed]);
        flushed++;
      }
      if (batch.length) onMedia(batch);
    };
    const worker = async () => {
      while (next < visual.length) {
        const i = next++;
        const f = visual[i];
        try {
          results[i] = fileKind(f) === 'video' ? await prepareVideo(projectId, f) : await prepareImage(projectId, f);
        } catch (err) {
          console.warn(f.name, err);
          results[i] = null;
          failed.push(f.name);
        }
        done++;
        prog.set(done / visual.length, `Import ${done} / ${visual.length}`);
        if (done % 6 === 0) flush();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    flush();
    prog.close();
  }

  if (unsupported) toast(`${unsupported} fichier(s) HEIC/RAW ignoré(s) : exportez-les en JPG depuis votre téléphone ou ordinateur.`, { type: 'warn', timeout: 8000 });
  if (failed.length) toast(`Impossible d'importer : ${failed.slice(0, 4).join(', ')}${failed.length > 4 ? '…' : ''}`, { type: 'warn', timeout: 8000 });
  if (!visual.length && !audio.length && !unsupported) toast('Aucune photo, vidéo ou musique trouvée.', { type: 'warn' });
}

// ---------- sources pour l'aperçu ----------

// Durée avant la fin à laquelle on considère être sur la dernière image d'une vidéo.
export const LAST_FRAME = 0.04;

// Pilote une vidéo de l'aperçu. `frozen` : on a dépassé la fin du fichier → on reste sur la
// dernière image, en pause, sans la relancer (sinon elle repart, s'arrête et clignote).
function driveVideo(v, target, frozen, playing) {
  if (playing && !frozen) {
    if (v.paused) {
      if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target;
      v.play().catch(() => {});
    } else if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - target) > (frozen ? 0.06 : 0.02) && !v.seeking) v.currentTime = target;
  }
}

// Garde une copie de l'image affichée après chaque positionnement, pour ne pas montrer
// la miniature (ou rien) pendant que la vidéo cherche une autre image.
function keepStill(v) {
  if (!v.videoWidth) return;
  const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
  const c = v.__still || document.createElement('canvas');
  c.width = Math.round(v.videoWidth * k);
  c.height = Math.round(v.videoHeight * k);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  v.__still = c;
}

function videoImage(v) {
  if (v.readyState >= 2) return { img: v, w: v.videoWidth, h: v.videoHeight };
  if (v.__still) return { img: v.__still, w: v.videoWidth, h: v.videoHeight };
  return null;
}

// Garde en mémoire un nombre limité d'images décodées autour de la tête de lecture.
export class PreviewSources {
  constructor(onReady) {
    this.onReady = onReady;
    this.projectId = null;
    this.bitmaps = new Map(); // mediaId -> ImageBitmap | 'loading'
    this.thumbs = new Map(); // mediaId -> HTMLImageElement
    this.videos = new Map(); // mediaId -> HTMLVideoElement
    this.stickerImages = new Map(); // fichier -> HTMLImageElement
    this.stickerVideos = new Map(); // fichier -> HTMLVideoElement
    this.anims = new Map(); // fichier -> image animée décodée | 'loading' | 'static'
    this.usedStickerVideos = new Set();
    this.order = [];
    this.loading = 0;
    this.queue = [];
    this.project = null;
    this.playing = false;
    this.activeVideo = null;
  }

  setProject(project) {
    if (this.projectId !== project.id) this.reset();
    this.projectId = project.id;
    this.project = project;
  }

  reset() {
    for (const b of this.bitmaps.values()) if (b instanceof ImageBitmap) b.close();
    for (const v of this.videos.values()) { v.pause(); v.removeAttribute('src'); v.load(); }
    for (const v of this.stickerVideos.values()) { v.pause(); v.removeAttribute('src'); v.load(); }
    for (const a of this.anims.values()) if (typeof a === 'object') disposeAnimated(a);
    this.bitmaps.clear(); this.thumbs.clear(); this.videos.clear();
    this.stickerImages.clear(); this.stickerVideos.clear(); this.anims.clear();
    this.order = []; this.queue = [];
  }

  thumb(media) {
    let img = this.thumbs.get(media.id);
    if (!img) {
      img = new Image();
      img.onload = () => this.onReady();
      img.src = api.fileUrl(this.projectId, 'thumbs', `${media.id}.jpg`);
      this.thumbs.set(media.id, img);
    }
    return img.complete && img.naturalWidth ? { img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }

  request(media) {
    if (media.type !== 'image' || this.bitmaps.has(media.id)) return;
    this.bitmaps.set(media.id, 'loading');
    this.queue.push(media);
    this.pump();
  }

  pump() {
    while (this.loading < 4 && this.queue.length) {
      const media = this.queue.shift();
      this.loading++;
      const kind = media.proxy ? 'proxies' : 'media';
      const name = media.proxy ? `${media.id}.jpg` : media.file;
      const pid = this.projectId;
      fetch(api.fileUrl(pid, kind, name))
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b))
        .then((bmp) => {
          if (pid !== this.projectId) { bmp.close(); return; }
          this.bitmaps.set(media.id, bmp);
          this.order.push(media.id);
          this.evict();
          this.onReady();
        })
        .catch(() => this.bitmaps.delete(media.id))
        .finally(() => { this.loading--; this.pump(); });
    }
  }

  evict() {
    while (this.order.length > 60) {
      const id = this.order.shift();
      const b = this.bitmaps.get(id);
      if (b instanceof ImageBitmap) b.close();
      this.bitmaps.delete(id);
    }
  }

  // Précharge les images autour de l'index courant.
  prefetch(index, ahead = 10, behind = 3) {
    const { clips, media } = this.project;
    for (let i = Math.max(0, index - behind); i < Math.min(clips.length, index + ahead); i++) {
      const m = media[clips[i].mediaId];
      if (m) this.request(m);
    }
  }

  video(media) {
    let v = this.videos.get(media.id);
    if (!v) {
      v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      v.addEventListener('seeked', () => { keepStill(v); this.onReady(); });
      v.addEventListener('loadeddata', () => { keepStill(v); this.onReady(); });
      v.src = api.fileUrl(this.projectId, 'media', media.file);
      this.videos.set(media.id, v);
    }
    return v;
  }

  // Positionne la vidéo au bon moment (lecture continue ou recherche ponctuelle).
  syncVideo(clip, media, local) {
    const v = this.video(media);
    const last = Math.max(0, (media.duration || 0) - LAST_FRAME);
    const raw = (clip.trim || 0) + local;
    if (this.activeVideo && this.activeVideo !== v) this.activeVideo.pause();
    this.activeVideo = v;
    driveVideo(v, Math.min(raw, last), raw >= last, this.playing);
    return v;
  }

  setPlaying(playing) {
    this.playing = playing;
    if (!playing && this.activeVideo) this.activeVideo.pause();
    if (!playing) for (const v of this.stickerVideos.values()) v.pause();
  }

  // Interface utilisée par le moteur de rendu.
  clip(clip, local) {
    const media = this.project.media[clip.mediaId];
    if (!media) return null;
    if (media.type === 'video') {
      const v = this.syncVideo(clip, media, local);
      return videoImage(v) || this.thumb(media);
    }
    const b = this.bitmaps.get(media.id);
    if (b instanceof ImageBitmap) return { img: b, w: b.width, h: b.height };
    this.request(media);
    return this.thumb(media);
  }

  stickerImage(ov) {
    let img = this.stickerImages.get(ov.file);
    if (!img) {
      img = new Image();
      img.onload = () => this.onReady();
      img.src = api.fileUrl(this.projectId, 'media', ov.file);
      this.stickerImages.set(ov.file, img);
    }
    return img.complete && img.naturalWidth ? { img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }

  // Interface utilisée par le moteur de rendu : image du sticker `local` s après son apparition.
  sticker(ov, local) {
    if (ov.kind === 'video') {
      let v = this.stickerVideos.get(ov.file);
      if (!v) {
        v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.playsInline = true;
        v.addEventListener('seeked', () => { keepStill(v); this.onReady(); });
        v.addEventListener('loadeddata', () => { keepStill(v); this.onReady(); });
        v.src = api.fileUrl(this.projectId, 'media', ov.file);
        this.stickerVideos.set(ov.file, v);
      }
      this.usedStickerVideos.add(v);
      const frozen = ov.loop === false && local >= (ov.duration || 0) - LAST_FRAME;
      driveVideo(v, stickerTime(ov, local), frozen, this.playing);
      return videoImage(v);
    }
    if (ov.kind === 'anim') {
      const a = this.anims.get(ov.file);
      if (!a) {
        this.anims.set(ov.file, 'loading');
        fetch(api.fileUrl(this.projectId, 'media', ov.file))
          .then((r) => r.blob())
          .then((b) => decodeAnimated(b, b.type))
          .then((anim) => { this.anims.set(ov.file, anim || 'static'); this.onReady(); })
          .catch(() => this.anims.set(ov.file, 'static'));
      }
      if (a && typeof a === 'object') return { img: frameAt(a, stickerTime(ov, local)), w: a.w, h: a.h };
    }
    return this.stickerImage(ov);
  }

  beginFrame() { this.usedStickerVideos = new Set(); }

  // Met en pause les vidéos de stickers qui ne sont plus à l'écran.
  endFrame() {
    for (const v of this.stickerVideos.values()) if (!this.usedStickerVideos.has(v) && !v.paused) v.pause();
  }

  // Vidéo à précharger avant son tour, pour éviter un temps de chargement à la coupe.
  preroll(clip) {
    const media = clip && this.project.media[clip.mediaId];
    if (media?.type !== 'video') return;
    const v = this.video(media);
    if (v !== this.activeVideo && Math.abs(v.currentTime - (clip.trim || 0)) > 0.05 && !v.seeking) v.currentTime = clip.trim || 0;
  }
}

// ---------- sources pour l'export (pleine résolution) ----------

export class ExportSources {
  constructor(project, W, H) {
    this.project = project;
    this.W = W;
    this.H = H;
    this.images = new Map(); // mediaId -> Promise<ImageBitmap>
    this.ready = new Map(); // mediaId -> ImageBitmap
    this.videos = new Map();
    this.stickers = new Map(); // fichier -> { img } | { anim } | { video }
  }

  async init() {
    for (const ov of this.project.overlays) {
      if (ov.type !== 'sticker' || this.stickers.has(ov.file)) continue;
      const url = api.fileUrl(this.project.id, 'media', ov.file);
      if (ov.kind === 'video') {
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.src = url;
        await new Promise((res) => { v.onloadeddata = res; v.onerror = res; });
        this.stickers.set(ov.file, { video: v });
        continue;
      }
      if (ov.kind === 'anim') {
        const blob = await (await fetch(url)).blob();
        const anim = await decodeAnimated(blob, blob.type);
        if (anim) { this.stickers.set(ov.file, { anim }); continue; }
      }
      // Élément <img> : fonctionne aussi pour le SVG, dessiné net à n'importe quelle taille.
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      this.stickers.set(ov.file, { img });
    }
  }

  // Positionne les stickers vidéo visibles à l'instant t.
  async prepareStickers(t) {
    for (const ov of this.project.overlays) {
      if (ov.type !== 'sticker' || ov.kind !== 'video' || t < ov.start || t >= ov.end) continue;
      const v = this.stickers.get(ov.file)?.video;
      if (v) await this.seek(v, stickerTime(ov, t - ov.start));
    }
  }

  loadImage(media, clip) {
    if (this.images.has(media.id)) return this.images.get(media.id);
    const promise = (async () => {
      const blob = await (await fetch(api.fileUrl(this.project.id, 'media', media.file))).blob();
      let bmp = await createImageBitmap(blob);
      // Réduit les très grandes photos à la taille utile (sans jamais agrandir).
      const need = Math.max(this.W / bmp.width, this.H / bmp.height) * (clip.zoom || 1) * 1.1;
      if (need < 0.9) {
        const small = await createImageBitmap(bmp, {
          resizeWidth: Math.round(bmp.width * need), resizeHeight: Math.round(bmp.height * need), resizeQuality: 'high',
        });
        bmp.close();
        bmp = small;
      }
      this.ready.set(media.id, bmp);
      return bmp;
    })();
    this.images.set(media.id, promise);
    return promise;
  }

  video(media) {
    let v = this.videos.get(media.id);
    if (!v) {
      v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = api.fileUrl(this.project.id, 'media', media.file);
      this.videos.set(media.id, v);
    }
    return v;
  }

  async seek(v, time) {
    if (v.readyState < 1) await new Promise((res) => v.addEventListener('loadedmetadata', res, { once: true }));
    if (Math.abs(v.currentTime - time) < 0.001 && v.readyState >= 2) return;
    await new Promise((res) => {
      const timer = setTimeout(res, 4000);
      v.addEventListener('seeked', () => { clearTimeout(timer); res(); }, { once: true });
      v.currentTime = time;
    });
  }

  // Prépare tout ce qu'il faut pour dessiner l'image du clip `index` à `local`.
  async prepare(index, local) {
    const { clips, media } = this.project;
    const clip = clips[index];
    // Libère les images des clips déjà passés.
    for (const [id, bmp] of this.ready) {
      const stillNeeded = clips.slice(index, index + 4).some((c) => c.mediaId === id);
      if (!stillNeeded) { bmp.close(); this.ready.delete(id); this.images.delete(id); }
    }
    for (let j = index + 1; j < Math.min(clips.length, index + 3); j++) {
      const m = media[clips[j].mediaId];
      if (m?.type === 'image') this.loadImage(m, clips[j]).catch(() => {});
    }
    const m = clip && media[clip.mediaId];
    if (!m) return;
    if (m.type === 'image') await this.loadImage(m, clip);
    else {
      const v = this.video(m);
      await this.seek(v, Math.min((clip.trim || 0) + local, Math.max(0, (m.duration || 0) - LAST_FRAME)));
    }
  }

  clip(clip) {
    const m = this.project.media[clip.mediaId];
    if (!m) return null;
    if (m.type === 'video') {
      const v = this.videos.get(m.id);
      return v && v.readyState >= 2 ? { img: v, w: v.videoWidth, h: v.videoHeight } : null;
    }
    const b = this.ready.get(m.id);
    return b ? { img: b, w: b.width, h: b.height } : null;
  }

  sticker(ov, local) {
    const s = this.stickers.get(ov.file);
    if (!s) return null;
    if (s.video) return s.video.readyState >= 2 ? { img: s.video, w: s.video.videoWidth, h: s.video.videoHeight } : null;
    if (s.anim) return { img: frameAt(s.anim, stickerTime(ov, local)), w: s.anim.w, h: s.anim.h };
    return s.img.naturalWidth ? { img: s.img, w: s.img.naturalWidth, h: s.img.naturalHeight } : null;
  }

  dispose() {
    for (const b of this.ready.values()) b.close();
    for (const s of this.stickers.values()) {
      if (s.anim) disposeAnimated(s.anim);
      if (s.video) { s.video.removeAttribute('src'); s.video.load(); }
    }
    for (const v of this.videos.values()) { v.removeAttribute('src'); v.load(); }
  }
}
