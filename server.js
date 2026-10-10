// Reel Studio — serveur local.
// Sert l'interface, stocke les projets sur le disque (dossier ./projets) et
// encode les exports avec ffmpeg (x264 + AAC).

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const DATA_DIR = path.resolve(process.env.REEL_DATA_DIR || path.join(APP_DIR, 'projets'));
const TRASH_DIR = path.join(DATA_DIR, '_corbeille');
// Bibliothèque partagée entre tous les projets : musiques, logos et modèles.
const LIB_DIR = path.resolve(process.env.REEL_LIB_DIR || path.join(APP_DIR, 'bibliotheque'));
const LIB_KINDS = {
  musiques: /\.(mp3|wav|m4a|aac|ogg|flac)$/i,
  logos: /\.(png|jpe?g|webp|svg|gif)$/i,
  sons: /\.(mp3|wav|m4a|aac|ogg|flac|opus|webm)$/i, // effets sonores ajoutés par l'utilisateur
  sfx: /\.(wav|mp3|ogg)$/i, // effets sonores fournis avec l'application (lecture seule)
};
const READ_ONLY_KINDS = new Set(['sfx']);
const PORT = Number(process.env.PORT || 5173);
const HOST = '127.0.0.1';
const FILE_KINDS = new Set(['media', 'thumbs', 'proxies', 'exports']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.apng': 'image/apng', '.ogv': 'video/ogg', '.mkv': 'video/x-matroska',
};

// ---------- utilitaires ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readBody(req, limit = 50 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Requête trop volumineuse');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON invalide'); }
}

function safeName(name) {
  const base = path.basename(String(name || 'fichier'))
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120);
  return base || 'fichier';
}

function projectDir(id) {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new HttpError(400, 'Identifiant de projet invalide');
  return path.join(DATA_DIR, id);
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; await exists(path.join(dir, candidate)); i++) candidate = `${stem}-${i}${ext}`;
  return path.join(dir, candidate);
}

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

// ---------- projets ----------

async function readProject(id) {
  const file = path.join(projectDir(id), 'project.json');
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw new HttpError(404, 'Projet introuvable');
    // Fichier corrompu : on retombe sur la dernière sauvegarde valide.
    const backups = await listBackups(id);
    for (const b of backups) {
      try { return JSON.parse(await fsp.readFile(b, 'utf8')); } catch { /* suivante */ }
    }
    throw err;
  }
}

async function listBackups(id) {
  const dir = path.join(projectDir(id), 'sauvegardes');
  try {
    const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.json')).sort().reverse();
    return names.map((n) => path.join(dir, n));
  } catch { return []; }
}

const lastBackupAt = new Map();

async function saveProject(id, project) {
  const dir = projectDir(id);
  if (!(await exists(dir))) throw new HttpError(404, 'Projet introuvable');
  project.updatedAt = Date.now();
  const json = JSON.stringify(project, null, 1);
  await writeAtomic(path.join(dir, 'project.json'), json);

  // Copie de sécurité horodatée au plus toutes les 3 minutes, 30 conservées.
  const now = Date.now();
  if (now - (lastBackupAt.get(id) || 0) > 3 * 60 * 1000) {
    lastBackupAt.set(id, now);
    const bdir = path.join(dir, 'sauvegardes');
    await fsp.mkdir(bdir, { recursive: true });
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    await fsp.writeFile(path.join(bdir, `${stamp}.json`), json);
    const all = await listBackups(id);
    for (const old of all.slice(30)) await fsp.rm(old, { force: true });
  }
  return project.updatedAt;
}

async function listProjects() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const entries = await fsp.readdir(DATA_DIR, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    try {
      const p = await readProject(e.name);
      const first = (p.clips || []).find((c) => c.mediaId && p.media?.[c.mediaId]);
      out.push({
        id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt,
        clipCount: (p.clips || []).length,
        thumb: first ? `/files/${p.id}/thumbs/${p.media[first.mediaId].id}.jpg` : null,
      });
    } catch { /* dossier non valide : ignoré */ }
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function createProject(name) {
  const id = `p${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const dir = projectDir(id);
  for (const k of FILE_KINDS) await fsp.mkdir(path.join(dir, k), { recursive: true });
  const now = Date.now();
  const project = {
    version: 1, id, name: String(name || 'Nouveau reel').slice(0, 100),
    createdAt: now, updatedAt: now,
  };
  await writeAtomic(path.join(dir, 'project.json'), JSON.stringify(project, null, 1));
  return project;
}

async function trashProject(id) {
  const dir = projectDir(id);
  if (!(await exists(dir))) throw new HttpError(404, 'Projet introuvable');
  await fsp.mkdir(TRASH_DIR, { recursive: true });
  await fsp.rename(dir, path.join(TRASH_DIR, `${id}-${Date.now()}`));
}

// ---------- bibliothèque (musiques, logos, modèles) ----------

function libDir(kind) {
  if (!LIB_KINDS[kind]) throw new HttpError(400, 'Bibliothèque inconnue');
  if (kind === 'sfx') return path.join(PUBLIC_DIR, 'sfx');
  return path.join(LIB_DIR, kind);
}

// Fichier de la bibliothèque sous son nom exact : les fichiers copiés à la main
// gardent leurs espaces, accents, parenthèses… On refuse seulement les chemins.
function libFile(kind, name) {
  const base = String(name || '');
  if (!base || base === '.' || base === '..' || base !== path.basename(base) || /[\\/:*?"<>|]/.test(base)) {
    throw new HttpError(400, 'Nom de fichier invalide');
  }
  return path.join(libDir(kind), base);
}

// Les métadonnées (tempo, passage choisi…) sont dans un index.json par dossier.
// Les écritures sont mises en file pour éviter que deux requêtes s'écrasent.
let metaLock = Promise.resolve();
function withMetaLock(fn) {
  const run = metaLock.then(fn, fn);
  metaLock = run.catch(() => {});
  return run;
}

async function readLibMeta(kind) {
  try { return JSON.parse(await fsp.readFile(path.join(libDir(kind), 'index.json'), 'utf8')); } catch { return {}; }
}

function setLibMeta(kind, file, data) {
  return withMetaLock(async () => {
    const meta = await readLibMeta(kind);
    meta[file] = { ...meta[file], ...data };
    await writeAtomic(path.join(libDir(kind), 'index.json'), JSON.stringify(meta, null, 1));
  });
}

async function listLibrary(kind) {
  const dir = libDir(kind);
  await fsp.mkdir(dir, { recursive: true });
  const meta = await readLibMeta(kind);
  const out = [];
  for (const file of await fsp.readdir(dir)) {
    if (!LIB_KINDS[kind].test(file)) continue;
    const stat = await fsp.stat(path.join(dir, file));
    out.push({ name: path.parse(file).name.replace(/[_-]+/g, ' '), ...meta[file], file, size: stat.size });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

async function receiveLibFile(req, kind, name) {
  const dir = libDir(kind);
  await fsp.mkdir(dir, { recursive: true });
  const target = await uniquePath(dir, safeName(name));
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(`${target}.upload`);
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });
  await fsp.rename(`${target}.upload`, target);
  return path.basename(target);
}

// Copie un fichier, en réutilisant une copie identique (même nom, même taille) si elle existe déjà.
async function copyInto(src, dir, name) {
  const stat = await fsp.stat(src).catch(() => { throw new HttpError(404, 'Fichier introuvable'); });
  await fsp.mkdir(dir, { recursive: true });
  const same = path.join(dir, safeName(name));
  const existing = await fsp.stat(same).catch(() => null);
  if (existing && existing.size === stat.size) return path.basename(same);
  const target = await uniquePath(dir, safeName(name));
  await fsp.copyFile(src, target);
  return path.basename(target);
}

async function moveToLibTrash(file) {
  const trash = path.join(LIB_DIR, '_corbeille');
  await fsp.mkdir(trash, { recursive: true });
  await fsp.rename(file, path.join(trash, `${Date.now()}-${path.basename(file)}`));
}

const templatesDir = () => path.join(LIB_DIR, 'modeles');

async function listTemplates() {
  await fsp.mkdir(templatesDir(), { recursive: true });
  const out = [];
  for (const f of await fsp.readdir(templatesDir())) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(await fsp.readFile(path.join(templatesDir(), f), 'utf8'))); } catch { /* ignoré */ }
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function templateFile(id) {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new HttpError(400, 'Identifiant de modèle invalide');
  return path.join(templatesDir(), `${id}.json`);
}

// ---------- fichiers ----------

async function serveFile(req, res, file, extraHeaders = {}) {
  let stat;
  try { stat = await fsp.stat(file); } catch { throw new HttpError(404, 'Fichier introuvable'); }
  if (!stat.isFile()) throw new HttpError(404, 'Fichier introuvable');
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...extraHeaders };
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    let start = range[1] === '' ? NaN : Number(range[1]);
    let end = range[2] === '' ? stat.size - 1 : Number(range[2]);
    if (Number.isNaN(start)) { start = Math.max(0, stat.size - end); end = stat.size - 1; }
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

async function receiveFile(req, id, kind, name, { unique }) {
  if (!FILE_KINDS.has(kind) || kind === 'exports') throw new HttpError(400, 'Type de fichier invalide');
  const dir = path.join(projectDir(id), kind);
  await fsp.mkdir(dir, { recursive: true });
  const target = unique ? await uniquePath(dir, safeName(name)) : path.join(dir, safeName(name));
  const tmp = `${target}.upload`;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });
  await fsp.rename(tmp, target);
  return path.basename(target);
}

// ---------- ffmpeg ----------

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let log = '';
    proc.stderr.on('data', (d) => { log = (log + d).slice(-4000); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg a échoué (${code})\n${log}`))));
  });
}

// Convertit une vidéo que le navigateur ne sait pas lire (ex. HEVC) en H.264.
async function transcodeVideo(id, file) {
  const dir = path.join(projectDir(id), 'media');
  const src = path.join(dir, safeName(file));
  if (!(await exists(src))) throw new HttpError(404, 'Fichier introuvable');
  const target = await uniquePath(dir, `${path.parse(src).name}-h264.mp4`);
  await runFfmpeg(['-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', target]);
  return path.basename(target);
}

// Convertit un sticker que le navigateur ne lit pas : image → PNG ; vidéo → WebM VP9 si elle
// a de la transparence (conservée), sinon MP4 H.264 (plus rapide).
async function convertSticker(id, file, target) {
  const dir = path.join(projectDir(id), 'media');
  const src = path.join(dir, safeName(file));
  if (!(await exists(src))) throw new HttpError(404, 'Fichier introuvable');
  const stem = path.parse(src).name;
  if (target === 'image') {
    const out = await uniquePath(dir, `${stem}.png`);
    await runFfmpeg(['-y', '-i', src, '-frames:v', '1', out]);
    return path.basename(out);
  }
  const probe = await new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', src], { windowsHide: true });
    let log = '';
    proc.stderr.on('data', (d) => { log += d; });
    proc.on('close', () => resolve(log));
  });
  const alpha = /Video:.*\b(yuva\w*|argb|rgba|bgra|abgr|gbrap\w*|ya8|ya16\w*|pal8|rgba64\w*)\b/.test(probe);
  if (alpha) {
    const out = await uniquePath(dir, `${stem}.webm`);
    await runFfmpeg(['-y', '-i', src, '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30',
      '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0', out]);
    return path.basename(out);
  }
  const out = await uniquePath(dir, `${stem}.mp4`);
  await runFfmpeg(['-y', '-i', src, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', out]);
  return path.basename(out);
}

const exportsInProgress = new Map();

async function startExport(id, opts) {
  const dir = projectDir(id);
  const fps = Math.min(60, Math.max(1, Number(opts.fps) || 30));
  const duration = Math.max(0.1, Number(opts.duration) || 1);
  const crf = Math.min(28, Math.max(12, Number(opts.crf) || 17));
  const outDir = path.join(dir, 'exports');
  await fsp.mkdir(outDir, { recursive: true });
  const outFile = await uniquePath(outDir, `${safeName(opts.name || 'reel').replace(/\.mp4$/i, '')}.mp4`);

  const args = ['-y', '-hide_banner', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0'];
  // Son : la musique (passages gardés recollés bout à bout) et les effets sonores sont mixés.
  const graph = [];
  const mixInputs = [];
  let nextInput = 1;
  if (opts.music?.file) {
    const musicPath = path.join(dir, 'media', safeName(opts.music.file));
    if (await exists(musicPath)) {
      const start = Math.max(0, Number(opts.music.start) || 0);
      const raw = Array.isArray(opts.music.segments) && opts.music.segments.length
        ? opts.music.segments : [{ from: start, to: start + duration + 1 }];
      const segs = [];
      let acc = 0;
      for (const sg of raw) {
        const from = Math.max(0, Number(sg.from) || 0), to = Number(sg.to) || 0;
        if (to - from < 0.01) continue;
        segs.push({ from, to });
        acc += to - from;
        if (acc >= duration + 0.5) break;
      }
      if (segs.length) {
        const mi = nextInput++;
        args.push('-i', musicPath);
        const vol = Math.max(0, Number(opts.music.volume ?? 1));
        const fade = Math.min(duration, Math.max(0, Number(opts.music.fadeOut) || 0));
        segs.forEach((sg, i) => {
          const len = sg.to - sg.from;
          graph.push(`[${mi}:a]atrim=start=${sg.from.toFixed(4)}:end=${sg.to.toFixed(4)},asetpts=PTS-STARTPTS,`
            + `afade=t=in:st=0:d=0.008,afade=t=out:st=${Math.max(0, len - 0.008).toFixed(4)}:d=0.008[m${i}]`);
        });
        const tail = [`volume=${vol.toFixed(3)}`, 'afade=t=in:st=0:d=0.03'];
        if (fade > 0) tail.push(`afade=t=out:st=${(duration - fade).toFixed(3)}:d=${fade.toFixed(3)}`);
        tail.push('aformat=sample_rates=48000:channel_layouts=stereo');
        graph.push(`${segs.map((_, i) => `[m${i}]`).join('')}concat=n=${segs.length}:v=0:a=1,${tail.join(',')}[mus]`);
        mixInputs.push('[mus]');
      }
    }
  }
  const sounds = Array.isArray(opts.sounds) ? opts.sounds.slice(0, 80) : [];
  for (const [j, snd] of sounds.entries()) {
    const at = Math.max(0, Number(snd.at) || 0);
    if (at >= duration) continue;
    const soundPath = path.join(dir, 'media', safeName(snd.file));
    if (!(await exists(soundPath))) continue;
    const k = nextInput++;
    args.push('-i', soundPath);
    const vol = Math.max(0, Math.min(4, Number(snd.volume ?? 1)));
    graph.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol.toFixed(3)},`
      + `adelay=delays=${Math.round(at * 1000)}:all=1[s${j}]`);
    mixInputs.push(`[s${j}]`);
  }
  let audioFilter = null;
  if (mixInputs.length) {
    // Limiteur final : évite la saturation quand musique et effets se superposent.
    const limiter = 'alimiter=limit=0.97:attack=5:release=60:level=0:latency=1';
    graph.push(mixInputs.length === 1
      ? `${mixInputs[0]}${limiter}[aout]`
      : `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:normalize=0,${limiter}[aout]`);
    audioFilter = graph.join(';');
  }
  const hasAudio = Boolean(audioFilter);
  if (hasAudio) args.push('-filter_complex', audioFilter);
  args.push('-map', '0:v:0');
  if (hasAudio) args.push('-map', '[aout]');
  args.push(
    '-vf', 'scale=in_range=full:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-profile:v', 'high',
    '-maxrate', '30M', '-bufsize', '60M', '-g', String(fps * 2),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-r', String(fps),
  );
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000');
  args.push('-t', duration.toFixed(3), '-movflags', '+faststart', outFile);

  const proc = spawn(ffmpegPath, args, { windowsHide: true });
  const job = { id: crypto.randomBytes(8).toString('hex'), projectId: id, proc, outFile, log: '', failed: null };
  proc.stderr.on('data', (d) => { job.log = (job.log + d).slice(-6000); });
  proc.stdin.on('error', (err) => { job.failed = job.failed || err; });
  job.done = new Promise((resolve) => proc.on('close', (code) => {
    if (code !== 0 && !job.failed) job.failed = new Error(`ffmpeg a échoué (${code})`);
    resolve(code);
  }));
  exportsInProgress.set(job.id, job);
  return job;
}

async function pushFrames(job, req) {
  for await (const chunk of req) {
    if (job.failed) throw new HttpError(500, `${job.failed.message}\n${job.log}`);
    if (!job.proc.stdin.write(chunk)) {
      await new Promise((resolve) => {
        job.proc.stdin.once('drain', resolve);
        job.proc.once('close', resolve);
      });
    }
  }
}

// ---------- routeur ----------

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const m = req.method;

  if (parts[0] === 'api') {
    const [, a, b, c, d] = parts;
    if (a === 'info' && m === 'GET') return sendJson(res, 200, { dataDir: DATA_DIR, ffmpeg: Boolean(ffmpegPath) });

    if (a === 'library' && b && READ_ONLY_KINDS.has(b) && m !== 'GET' && c !== 'reveal') throw new HttpError(403, 'Bibliothèque en lecture seule');
    if (a === 'library' && b) {
      if (!c && m === 'GET') return sendJson(res, 200, await listLibrary(b));
      if (c === 'files' && m === 'PUT') return sendJson(res, 200, { file: await receiveLibFile(req, b, url.searchParams.get('name')) });
      if (c === 'meta' && m === 'PATCH') {
        const { file, ...data } = await readJson(req);
        if (!(await exists(libFile(b, file)))) throw new HttpError(404, 'Fichier introuvable');
        await setLibMeta(b, path.basename(libFile(b, file)), data);
        return sendJson(res, 200, { ok: true });
      }
      if (c === 'reveal' && m === 'POST') {
        await fsp.mkdir(libDir(b), { recursive: true });
        exec(process.platform === 'win32' ? `explorer "${libDir(b)}"` : `${process.platform === 'darwin' ? 'open' : 'xdg-open'} "${libDir(b)}"`);
        return sendJson(res, 200, { ok: true });
      }
      if (c && c !== 'files' && m === 'DELETE') {
        await moveToLibTrash(libFile(b, c));
        return sendJson(res, 200, { ok: true });
      }
    }

    if (a === 'templates') {
      if (!b && m === 'GET') return sendJson(res, 200, await listTemplates());
      if (b && m === 'PUT') {
        const t = await readJson(req);
        await fsp.mkdir(templatesDir(), { recursive: true });
        await writeAtomic(templateFile(b), JSON.stringify({ ...t, id: b }, null, 1));
        return sendJson(res, 200, { ok: true });
      }
      if (b && m === 'DELETE') {
        if (await exists(templateFile(b))) await moveToLibTrash(templateFile(b));
        return sendJson(res, 200, { ok: true });
      }
    }

    if (a === 'projects') {
      if (!b && m === 'GET') return sendJson(res, 200, await listProjects());
      if (!b && m === 'POST') return sendJson(res, 201, await createProject((await readJson(req)).name));
      if (b && !c && m === 'GET') return sendJson(res, 200, await readProject(b));
      if (b && !c && m === 'PUT') {
        const project = await readJson(req);
        if (project.id !== b) throw new HttpError(400, 'Identifiant incohérent');
        return sendJson(res, 200, { updatedAt: await saveProject(b, project) });
      }
      if (b && !c && m === 'DELETE') { await trashProject(b); return sendJson(res, 200, { ok: true }); }
      if (b && c === 'files' && d && m === 'PUT') {
        const name = await receiveFile(req, b, d, url.searchParams.get('name'), { unique: url.searchParams.get('unique') === '1' });
        return sendJson(res, 200, { name });
      }
      if (b && (c === 'to-library' || c === 'from-library') && m === 'POST') {
        const { kind, file } = await readJson(req);
        const media = path.join(projectDir(b), 'media');
        const name = c === 'to-library'
          ? await copyInto(path.join(media, safeName(file)), libDir(kind), safeName(file).replace(/^logo-/, ''))
          : await copyInto(libFile(kind, file), media, safeName(file));
        return sendJson(res, 200, { file: name });
      }
      if (b && c === 'convert-sticker' && m === 'POST') {
        const { file, target } = await readJson(req);
        return sendJson(res, 200, { file: await convertSticker(b, file, target === 'image' ? 'image' : 'video') });
      }
      if (b && c === 'transcode' && m === 'POST') {
        return sendJson(res, 200, { file: await transcodeVideo(b, (await readJson(req)).file) });
      }
      if (b && c === 'exports' && m === 'POST') {
        const job = await startExport(b, await readJson(req));
        return sendJson(res, 200, { exportId: job.id });
      }
      if (b && c === 'reveal' && m === 'POST') {
        const { kind = 'exports', file } = await readJson(req);
        const dir = path.join(projectDir(b), FILE_KINDS.has(kind) ? kind : 'exports');
        const target = file ? path.join(dir, safeName(file)) : dir;
        if (process.platform === 'win32') exec(file ? `explorer /select,"${target}"` : `explorer "${target}"`);
        else exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} "${file ? dir : target}"`);
        return sendJson(res, 200, { ok: true });
      }
    }

    if (a === 'exports' && b) {
      const job = exportsInProgress.get(b);
      if (!job) throw new HttpError(404, 'Export introuvable');
      if (c === 'frames' && m === 'POST') { await pushFrames(job, req); return sendJson(res, 200, { ok: true }); }
      if (c === 'finish' && m === 'POST') {
        job.proc.stdin.end();
        await job.done;
        exportsInProgress.delete(b);
        if (job.failed) throw new HttpError(500, `${job.failed.message}\n${job.log}`);
        const stat = await fsp.stat(job.outFile);
        const file = path.basename(job.outFile);
        return sendJson(res, 200, { file, size: stat.size, url: `/files/${job.projectId}/exports/${encodeURIComponent(file)}` });
      }
      if (!c && m === 'DELETE') {
        job.proc.kill('SIGKILL');
        await job.done;
        exportsInProgress.delete(b);
        await fsp.rm(job.outFile, { force: true });
        return sendJson(res, 200, { ok: true });
      }
    }
    throw new HttpError(404, 'Route inconnue');
  }

  if (m !== 'GET' && m !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');

  if (parts[0] === 'files' && parts.length === 4) {
    const [, id, kind, name] = parts;
    if (!FILE_KINDS.has(kind)) throw new HttpError(404, 'Introuvable');
    const headers = url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="${safeName(name)}"` } : {};
    return serveFile(req, res, path.join(projectDir(id), kind, safeName(name)), headers);
  }

  if (parts[0] === 'lib' && parts.length === 3) {
    return serveFile(req, res, libFile(parts[1], parts[2]));
  }

  if (parts[0] === 'fonts' && parts.length === 3) {
    const [, family, file] = parts;
    if (!/^[a-z-]+$/.test(family)) throw new HttpError(404, 'Introuvable');
    return serveFile(req, res, path.join(APP_DIR, 'node_modules', '@fontsource', family, 'files', safeName(file)),
      { 'Cache-Control': 'max-age=31536000' });
  }

  const rel = parts.length ? parts.join('/') : 'index.html';
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(403, 'Interdit');
  return serveFile(req, res, file);
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.message });
    else res.end();
  }
});

await fsp.mkdir(DATA_DIR, { recursive: true });
for (const k of [...Object.keys(LIB_KINDS).filter((k) => !READ_ONLY_KINDS.has(k)), 'modeles']) await fsp.mkdir(path.join(LIB_DIR, k), { recursive: true });
server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Reel Studio est prêt : ${url}`);
  console.log(`  Projets enregistrés dans : ${DATA_DIR}`);
  console.log(`  Bibliothèque (musiques, logos, modèles) : ${LIB_DIR}\n`);
  if (process.argv.includes('--open')) {
    exec(process.platform === 'win32' ? `start "" "${url}"` : `${process.platform === 'darwin' ? 'open' : 'xdg-open'} ${url}`);
  }
});
