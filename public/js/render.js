// Rendu d'une image du reel à l'instant t.
// Le même code sert à l'aperçu et à l'export : ce que vous voyez est ce que vous exportez.

import { FRAME_W, clipIndexAt, fontById, activeTransition } from './model.js';
import { clamp } from './util.js';

const MOTION_AMOUNT = 0.07;

// ---------- couleurs : unie ('#rrggbb') ou dégradé ({ g: [couleur1, couleur2], a: angle en degrés }) ----------

export const isGradient = (v) => Boolean(v && typeof v === 'object' && Array.isArray(v.g));

// Remplissage canvas pour le rectangle (x, y, w, h). Angle à la manière du CSS : 180° = de haut en bas.
export function paint(ctx, v, x, y, w, h) {
  if (!isGradient(v)) return v || '#000000';
  const a = ((v.a ?? 180) * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = x + w / 2, cy = y + h / 2;
  const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  v.g.forEach((c, i) => g.addColorStop(v.g.length > 1 ? i / (v.g.length - 1) : 0, c));
  return g;
}

export const cssPaint = (v) => (isGradient(v) ? `linear-gradient(${v.a ?? 180}deg, ${v.g.join(', ')})` : (v || '#000000'));

// `src` fournit les images : src.clip(clip, localTime) et src.sticker(overlay, localTime),
// qui renvoient { img, w, h } ou null si rien n'est prêt.
// `still` : identifiant d'un calque à afficher sans animation (calque en cours d'édition).
export function drawFrame(ctx, W, H, project, tl, t, src, { still = null } = {}) {
  ctx.save();
  ctx.fillStyle = paint(ctx, project.settings.background || '#000000', 0, 0, W, H);
  ctx.fillRect(0, 0, W, H);
  const tr = activeTransition(project, tl, t);
  if (tr) drawTransition(ctx, W, H, project, tl, t, src, tr);
  else {
    const i = clipIndexAt(tl, t);
    if (i >= 0) drawClip(ctx, W, H, project.clips[i], t - tl.starts[i], tl.durs[i], src);
  }
  const boxes = [];
  for (const ov of project.overlays) {
    if (t < ov.start || t >= ov.end) continue;
    const tt = ov.id === still ? Math.min(ov.start + 1, (ov.start + ov.end) / 2) : t;
    const box = ov.type === 'text' ? drawText(ctx, W, H, ov, tt) : drawSticker(ctx, W, H, ov, tt, src);
    if (box) boxes.push(box);
  }
  ctx.restore();
  return boxes;
}

// Rectangle où la photo / vidéo est dessinée (cadrage, zoom, mouvement).
function clipRect(W, H, clip, local, dur, s) {
  const p = dur > 0 ? clamp(local / dur, 0, 1) : 0;
  let z = clip.zoom || 1;
  if (clip.motion === 'zoomIn') z *= 1 + MOTION_AMOUNT * p;
  else if (clip.motion === 'zoomOut') z *= 1 + MOTION_AMOUNT * (1 - p);
  const base = clip.fit === 'cover' ? Math.max(W / s.w, H / s.h) : Math.min(W / s.w, H / s.h);
  const dw = s.w * base * z;
  const dh = s.h * base * z;
  const fx = clip.fx ?? 0.5, fy = clip.fy ?? 0.5;
  // En mode « remplir », fx/fy choisissent la partie visible de l'image.
  const dx = dw >= W ? (W - dw) * fx : (W - dw) / 2;
  const dy = dh >= H ? (H - dh) * fy : (H - dh) / 2;
  return { dx, dy, dw, dh };
}

function drawClip(ctx, W, H, clip, local, dur, src) {
  if (clip.kind === 'color') {
    ctx.fillStyle = paint(ctx, clip.color || '#111111', 0, 0, W, H);
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const s = src.clip(clip, local);
  if (!s) return;

  if (clip.fit === 'blur') {
    // Fond : la même image, en remplissage, floutée et assombrie.
    const cover = Math.max(W / s.w, H / s.h) * 1.15;
    const bw = s.w * cover, bh = s.h * cover;
    ctx.save();
    ctx.filter = `blur(${Math.round(W * 0.035)}px) brightness(0.7)`;
    ctx.drawImage(s.img, (W - bw) / 2, (H - bh) / 2, bw, bh);
    ctx.restore();
  }
  const { dx, dy, dw, dh } = clipRect(W, H, clip, local, dur, s);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(s.img, dx, dy, dw, dh);
}

// ---------- transitions ----------

const smooth = (x) => x * x * (3 - 2 * x);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

function drawTransition(ctx, W, H, project, tl, t, src, at) {
  const { k, tr, c, pre, post } = at;
  const A = project.clips[k], B = project.clips[k + 1];
  const la = t - tl.starts[k], lb = Math.max(0, t - tl.starts[k + 1]);
  const before = t < c;
  const x = clamp((t - (c - pre)) / (pre + post), 0, 1); // avancement 0 → 1
  const bell = clamp(1 - Math.abs(t - c) / (before ? pre : post), 0, 1); // 1 sur la coupe
  const bg = project.settings.background || '#000000';

  // Chaque média est dessiné comme un calque plein écran (fond compris).
  const layer = (clip, local, dur, { alpha = 1, scale = 1, dx = 0, blur = 0 } = {}) => {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (dx) ctx.translate(dx, 0);
    if (scale !== 1) { ctx.translate(W / 2, H / 2); ctx.scale(scale, scale); ctx.translate(-W / 2, -H / 2); }
    if (blur > 0.5) ctx.filter = `blur(${blur.toFixed(1)}px)`;
    ctx.fillStyle = paint(ctx, bg, 0, 0, W, H);
    ctx.fillRect(0, 0, W, H);
    drawClip(ctx, W, H, clip, local, dur, src);
    ctx.restore();
  };
  const layerA = (o) => layer(A, la, tl.durs[k], o);
  const layerB = (o) => layer(B, lb, tl.durs[k + 1], o);
  const veil = (color, alpha) => {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };

  switch (tr.type) {
    case 'flash':
    case 'black':
      if (before) layerA(); else layerB();
      veil(tr.type === 'black' ? '#000000' : '#ffffff', bell ** 1.4 * (tr.type === 'black' ? 1 : 0.95));
      break;
    case 'zoom': {
      // Plongée accélérée dans A, puis B arrive en se posant.
      if (before) {
        const q = 1 - bell;
        layerA({ scale: 1 + 0.45 * q * q, blur: q * W * 0.01 });
      } else {
        const q = 1 - bell;
        layerB({ scale: 1 + 0.45 * (1 - smooth(q)), blur: (1 - q) * W * 0.01 });
      }
      veil('#ffffff', 0.18 * bell ** 3);
      break;
    }
    case 'whip': {
      // Panoramique filé : A part vers la gauche, B arrive par la droite, flou de vitesse au milieu.
      const e = easeInOut(x);
      const blur = Math.sin(Math.PI * x) * W * 0.03;
      layerA({ dx: -e * W, blur });
      layerB({ dx: (1 - e) * W, blur });
      break;
    }
    case 'blur': {
      const amount = bell * W * 0.035;
      layerA({ blur: amount });
      layerB({ alpha: smooth(x), blur: amount });
      break;
    }
    case 'leak': {
      // Fondu + brûlure de pellicule : halos chauds qui traversent l'image.
      layerA();
      layerB({ alpha: smooth(clamp((x - 0.25) / 0.5, 0, 1)) });
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = bell ** 1.2;
      const g1 = ctx.createRadialGradient(W * (-0.3 + 1.6 * x), H * 0.35, 0, W * (-0.3 + 1.6 * x), H * 0.35, W * 0.95);
      g1.addColorStop(0, 'rgba(255, 150, 60, 0.95)');
      g1.addColorStop(0.5, 'rgba(255, 90, 60, 0.45)');
      g1.addColorStop(1, 'rgba(255, 60, 60, 0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, W, H);
      const g2 = ctx.createRadialGradient(W * (1.2 - 1.3 * x), H * 0.78, 0, W * (1.2 - 1.3 * x), H * 0.78, W * 0.8);
      g2.addColorStop(0, 'rgba(255, 80, 160, 0.75)');
      g2.addColorStop(1, 'rgba(255, 80, 160, 0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255, 220, 160, 0.3)';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      break;
    }
    case 'cutout': {
      // Flash, puis le sujet de A (détouré) reste un instant par-dessus B avant de s'effacer.
      if (before) {
        layerA();
        veil('#ffffff', 0.9 * ((t - (c - pre)) / pre) ** 2);
        break;
      }
      layerB();
      const q = clamp((t - c) / post, 0, 1);
      const cut = A.kind !== 'color' && src.cutout?.(A);
      const sA = cut && src.clip(A, la);
      if (cut && sA) {
        const r = clipRect(W, H, A, la, tl.durs[k], sA);
        const sc = 1 + 0.035 * q;
        ctx.save();
        ctx.globalAlpha = q < 0.6 ? 1 : 1 - (q - 0.6) / 0.4;
        ctx.translate(r.dx + r.dw / 2, r.dy + r.dh / 2);
        ctx.scale(sc, sc);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cut.img, -r.dw / 2, -r.dh / 2, r.dw, r.dh);
        ctx.restore();
      }
      veil('#ffffff', 0.9 * clamp(1 - (t - c) / 0.15, 0, 1));
      break;
    }
    default: // fondu enchaîné
      layerA();
      layerB({ alpha: smooth(x) });
  }
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
  const lineH = size * (font.lineHeight || 1.18);
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

  // Zone du bloc de texte, pour orienter les dégradés.
  const bx = -L.blockW / 2 - L.pad, by = top - L.pad * 0.6, bw = L.blockW + L.pad * 2, bh = L.blockH + L.pad * 1.2;
  if (ov.style === 'box') {
    ctx.fillStyle = paint(ctx, ov.bgColor, bx, by, bw, bh);
    roundRect(ctx, bx, by, bw, bh, L.size * 0.18);
  } else if (ov.style === 'lines') {
    ctx.fillStyle = paint(ctx, ov.bgColor, bx, by, bw, bh);
    L.lines.forEach((line, i) => {
      if (!line) return;
      const w = L.widths[i];
      roundRect(ctx, lineX(w) - L.pad * 0.7, top + i * L.lineH + L.lineH * 0.04, w + L.pad * 1.4, L.lineH * 0.98, L.size * 0.14);
    });
  }

  ctx.fillStyle = paint(ctx, ov.color, -L.blockW / 2, top, L.blockW, L.blockH);
  L.lines.forEach((line, i) => {
    const y = top + (i + 0.5) * L.lineH + L.size * 0.04;
    const x = lineX(L.widths[i]);
    if (ov.style === 'outline') {
      ctx.lineJoin = 'round';
      ctx.lineWidth = L.size * 0.14;
      ctx.strokeStyle = paint(ctx, ov.bgColor, bx, by, bw, bh);
      ctx.strokeText(line, x, y);
    }
    ctx.fillText(line, x, y);
  });
  ctx.restore();

  return { id: ov.id, x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

// ---------- sticker (image, image animée, vidéo) ----------

function drawSticker(ctx, W, H, ov, t, src) {
  const s = src.sticker(ov, t - ov.start);
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
