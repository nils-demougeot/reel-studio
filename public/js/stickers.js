// Stickers : images, images animées (GIF, WebP, APNG, AVIF) et vidéos superposées au montage.
//
// kind 'image' : image fixe ; 'anim' : image animée décodée image par image (transparence conservée) ;
// 'video' : vidéo (muette). Les formats que le navigateur ne lit pas sont convertis par le serveur.

import * as api from './api.js';

export const STICKER_ACCEPT = [
  'image/*', 'video/*',
  '.gif', '.webp', '.apng', '.png', '.avif', '.svg', '.jpg', '.jpeg', '.bmp', '.ico', '.tif', '.tiff', '.jp2', '.heic', '.heif',
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.mts', '.m2ts', '.3gp', '.ogv', '.mpg', '.mpeg',
].join(',');

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mts|m2ts|3gp|ogv|mpg|mpeg)$/i;
const MAYBE_ANIMATED = /\.(gif|webp|png|apng|avif)$/i;
const MIME_BY_EXT = { gif: 'image/gif', webp: 'image/webp', png: 'image/png', apng: 'image/apng', avif: 'image/avif' };
const MAX_FRAME_SIDE = 720; // les images animées sont réduites pour limiter la mémoire

const isVideoFile = (f) => f.type.startsWith('video/') || VIDEO_EXT.test(f.name);

// ---------- images animées ----------

// Décode toutes les images d'une image animée. Renvoie null si elle n'est pas animée
// ou si le navigateur ne sait pas la décoder.
export async function decodeAnimated(blob, type) {
  if (!('ImageDecoder' in window) || !type) return null;
  try {
    if (!(await ImageDecoder.isTypeSupported(type))) return null;
    const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type });
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track || track.frameCount <= 1) { decoder.close(); return null; }
    const frames = [];
    let t = 0;
    for (let i = 0; i < track.frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      const k = Math.min(1, MAX_FRAME_SIDE / Math.max(image.displayWidth, image.displayHeight));
      const bmp = await createImageBitmap(image, k < 1
        ? { resizeWidth: Math.round(image.displayWidth * k), resizeHeight: Math.round(image.displayHeight * k), resizeQuality: 'high' }
        : {});
      const d = image.duration ? image.duration / 1e6 : 0.1;
      frames.push({ bmp, t, d: d > 0.01 ? d : 0.1 });
      t += frames[frames.length - 1].d;
      image.close();
    }
    decoder.close();
    return { frames, duration: t, w: frames[0].bmp.width, h: frames[0].bmp.height };
  } catch (err) {
    console.warn('Image animée non décodée', err);
    return null;
  }
}

export function frameAt(anim, time) {
  const { frames } = anim;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= time) lo = mid; else hi = mid - 1;
  }
  return frames[lo].bmp;
}

export function disposeAnimated(anim) {
  for (const f of anim?.frames || []) f.bmp.close();
}

// Moment à afficher dans le sticker animé / vidéo, `local` secondes après son apparition.
export function stickerTime(ov, local) {
  const dur = ov.duration || 0;
  if (!dur) return 0;
  if (ov.loop === false) return Math.min(Math.max(0, local), Math.max(0, dur - 0.04)); // puis dernière image
  return ((local % dur) + dur) % dur;
}

// ---------- import ----------

function imageSizeFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth ? resolve({ w: img.naturalWidth, h: img.naturalHeight }) : reject(new Error('vide')));
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = url;
  });
}

function videoMeta(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    const timer = setTimeout(() => reject(new Error('délai dépassé')), 20000);
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      if (!v.videoWidth) return reject(new Error('pas d\'image'));
      resolve({ w: v.videoWidth, h: v.videoHeight, duration: v.duration });
      v.removeAttribute('src');
      v.load();
    };
    v.onerror = () => { clearTimeout(timer); reject(new Error('Vidéo illisible')); };
    v.src = url;
  });
}

// Importe un fichier comme sticker. Renvoie { file, kind, iw, ih, duration? }.
export async function importSticker(projectId, file) {
  const name = await api.uploadFile(projectId, 'media', `sticker-${file.name}`, file, { unique: true });
  const url = (n) => api.fileUrl(projectId, 'media', n);

  if (isVideoFile(file)) {
    try {
      const m = await videoMeta(url(name));
      return { file: name, kind: 'video', iw: m.w, ih: m.h, duration: m.duration };
    } catch {
      // Format non lu par le navigateur (ProRes, AVI, MKV…) : conversion en conservant la transparence.
      const conv = (await api.convertSticker(projectId, name, 'video')).file;
      const m = await videoMeta(url(conv));
      return { file: conv, kind: 'video', iw: m.w, ih: m.h, duration: m.duration };
    }
  }

  if (MAYBE_ANIMATED.test(file.name) || Object.values(MIME_BY_EXT).includes(file.type)) {
    const ext = file.name.split('.').pop().toLowerCase();
    const anim = await decodeAnimated(file, file.type || MIME_BY_EXT[ext]);
    if (anim) {
      const out = { file: name, kind: 'anim', iw: anim.w, ih: anim.h, duration: anim.duration };
      disposeAnimated(anim);
      return out;
    }
  }

  try {
    const m = await imageSizeFromUrl(url(name));
    return { file: name, kind: 'image', iw: m.w, ih: m.h };
  } catch {
    // TIFF, JPEG 2000, certains HEIC… : conversion en PNG par le serveur.
    const conv = (await api.convertSticker(projectId, name, 'image')).file;
    const m = await imageSizeFromUrl(url(conv));
    return { file: conv, kind: 'image', iw: m.w, ih: m.h };
  }
}
