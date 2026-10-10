// Rendu d'une image du reel à l'instant t.
// Le même code sert à l'aperçu et à l'export : ce que vous voyez est ce que vous exportez.

import { FRAME_W, clipIndexAt, fontById } from './model.js';
import { clamp } from './util.js';

const MOTION_AMOUNT = 0.07;

// `src` fournit les images : src.clip(clip, localTime) et src.logo(overlay),
// qui renvoient { img, w, h } ou null si rien n'est prêt.
// `still` : identifiant d'un calque à afficher sans animation (calque en cours d'édition).
export function drawFrame(ctx, W, H, project, tl, t, src, { still = null } = {}) {
  ctx.save();
  ctx.fillStyle = project.settings.background || '#000';
  ctx.fillRect(0, 0, W, H);
  const i = clipIndexAt(tl, t);
  if (i >= 0) drawClip(ctx, W, H, project.clips[i], t - tl.starts[i], tl.durs[i], src);
  const boxes = [];
  for (const ov of project.overlays) {
    if (t < ov.start || t >= ov.end) continue;
    const tt = ov.id === still ? Math.min(ov.start + 1, (ov.start + ov.end) / 2) : t;
    const box = ov.type === 'text' ? drawText(ctx, W, H, ov, tt) : drawLogo(ctx, W, H, ov, tt, src);
    if (box) boxes.push(box);
  }
  ctx.restore();
  return boxes;
}

function drawClip(ctx, W, H, clip, local, dur, src) {
  if (clip.kind === 'color') {
    ctx.fillStyle = clip.color || '#111';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const s = src.clip(clip, local);
  if (!s) return;
  const p = dur > 0 ? clamp(local / dur, 0, 1) : 0;
  let z = clip.zoom || 1;
  if (clip.motion === 'zoomIn') z *= 1 + MOTION_AMOUNT * p;
  else if (clip.motion === 'zoomOut') z *= 1 + MOTION_AMOUNT * (1 - p);

  if (clip.fit === 'blur') {
    // Fond : la même image, en remplissage, floutée et assombrie.
    const cover = Math.max(W / s.w, H / s.h) * 1.15;
    const bw = s.w * cover, bh = s.h * cover;
    ctx.save();
    ctx.filter = `blur(${Math.round(W * 0.035)}px) brightness(0.7)`;
    ctx.drawImage(s.img, (W - bw) / 2, (H - bh) / 2, bw, bh);
    ctx.restore();
  }
  const base = clip.fit === 'cover' ? Math.max(W / s.w, H / s.h) : Math.min(W / s.w, H / s.h);
  const dw = s.w * base * z;
  const dh = s.h * base * z;
  const fx = clip.fx ?? 0.5, fy = clip.fy ?? 0.5;
  // En mode « remplir », fx/fy choisissent la partie visible de l'image.
  const dx = dw >= W ? (W - dw) * fx : (W - dw) / 2;
  const dy = dh >= H ? (H - dh) * fy : (H - dh) / 2;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(s.img, dx, dy, dw, dh);
}

// ---------- animations d'entrée / sortie ----------

const easeOutBack = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;
const easeOut = (x) => 1 - (1 - x) ** 3;

function animState(ov, t, H) {
  const inP = clamp((t - ov.start) / 0.35, 0, 1);
  const outP = clamp((ov.end - t) / 0.2, 0, 1);
  let alpha = 1, scale = 1, dy = 0;
  if (ov.anim === 'fade') alpha = easeOut(inP) * outP;
  else if (ov.anim === 'pop') { alpha = clamp(inP * 3, 0, 1) * outP; scale = 0.6 + 0.4 * easeOutBack(inP); }
  else if (ov.anim === 'rise') { alpha = easeOut(inP) * outP; dy = (1 - easeOut(inP)) * H * 0.03; }
  return { alpha, scale, dy };
}

// ---------- texte ----------

export function layoutText(ctx, W, ov) {
  const k = W / FRAME_W;
  const font = fontById(ov.font);
  const size = ov.size * k;
  ctx.font = `${ov.weight || 400} ${size}px "${font.family}"`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(ov.spacing || 0) * k}px`;
  const raw = ov.uppercase ? ov.text.toUpperCase() : ov.text;
  const maxW = (ov.maxWidth || 0.86) * W;
  const lines = [];
  for (const para of raw.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = words[0];
    for (const w of words.slice(1)) {
      const test = `${line} ${w}`;
      if (ctx.measureText(test).width > maxW) { lines.push(line); line = w; } else line = test;
    }
    lines.push(line);
  }
  const lineH = size * (font.id === 'bebas' || font.id === 'anton' ? 1.05 : 1.18);
  const widths = lines.map((l) => ctx.measureText(l).width);
  const blockW = Math.max(1, ...widths);
  const pad = ov.style === 'box' || ov.style === 'lines' ? size * 0.32 : ov.style === 'outline' ? size * 0.08 : 0;
  return { lines, widths, lineH, size, blockW, blockH: lines.length * lineH, pad, k };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fill();
}

function drawText(ctx, W, H, ov, t) {
  if (!ov.text?.trim()) return null;
  const L = layoutText(ctx, W, ov);
  const cx = ov.x * W, cy = ov.y * H;
  const { alpha, scale, dy } = animState(ov, t, H);
  const align = ov.align || 'center';
  const lineX = (w) => (align === 'left' ? -L.blockW / 2 : align === 'right' ? L.blockW / 2 - w : -w / 2);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const top = -L.blockH / 2;

  if (ov.style === 'box') {
    ctx.fillStyle = ov.bgColor;
    roundRect(ctx, -L.blockW / 2 - L.pad, top - L.pad * 0.6, L.blockW + L.pad * 2, L.blockH + L.pad * 1.2, L.size * 0.18);
  } else if (ov.style === 'lines') {
    ctx.fillStyle = ov.bgColor;
    L.lines.forEach((line, i) => {
      if (!line) return;
      const w = L.widths[i];
      roundRect(ctx, lineX(w) - L.pad * 0.7, top + i * L.lineH + L.lineH * 0.04, w + L.pad * 1.4, L.lineH * 0.98, L.size * 0.14);
    });
  }

  ctx.fillStyle = ov.color;
  L.lines.forEach((line, i) => {
    const y = top + (i + 0.5) * L.lineH + L.size * 0.04;
    const x = lineX(L.widths[i]);
    if (ov.style === 'outline') {
      ctx.lineJoin = 'round';
      ctx.lineWidth = L.size * 0.14;
      ctx.strokeStyle = ov.bgColor;
      ctx.strokeText(line, x, y);
    }
    ctx.fillText(line, x, y);
  });
  ctx.restore();

  const bw = L.blockW + L.pad * 2, bh = L.blockH + L.pad * 1.2;
  return { id: ov.id, x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

// ---------- logo ----------

function drawLogo(ctx, W, H, ov, t, src) {
  const s = src.logo(ov);
  const dw = ov.w * W;
  const dh = dw * (ov.ih / ov.iw);
  const cx = ov.x * W, cy = ov.y * H;
  if (s) {
    const { alpha, scale, dy } = animState(ov, t, H);
    ctx.save();
    ctx.globalAlpha = alpha * (ov.opacity ?? 1);
    ctx.translate(cx, cy + dy);
    ctx.scale(scale, scale);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(s.img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  return { id: ov.id, x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh };
}
