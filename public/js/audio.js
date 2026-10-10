// Musique : décodage, lecture synchronisée, forme d'onde et détection du tempo.

let ctx = null;
export const audioContext = () => (ctx ||= new AudioContext({ latencyHint: 'interactive' }));

export async function decodeAudio(urlOrBlob) {
  const data = typeof urlOrBlob === 'string'
    ? await (await fetch(urlOrBlob)).arrayBuffer()
    : await urlOrBlob.arrayBuffer();
  return audioContext().decodeAudioData(data);
}

// ---------- lecture ----------

// Horloge de lecture : celle du contexte audio, pour que l'image suive
// exactement la musique.
export class Player {
  constructor() {
    this.buffer = null;
    this.source = null;
    this.gain = null;
    this.t0 = 0;
    this.ctxStart = 0;
  }

  play(t0, music) {
    const ac = audioContext();
    ac.resume();
    this.stop();
    this.t0 = t0;
    this.ctxStart = ac.currentTime + 0.06;
    if (this.buffer && music) {
      const offset = music.start + t0;
      if (offset < this.buffer.duration) {
        this.gain = ac.createGain();
        this.gain.gain.value = music.volume ?? 1;
        this.gain.connect(ac.destination);
        this.source = ac.createBufferSource();
        this.source.buffer = this.buffer;
        this.source.connect(this.gain);
        this.source.start(this.ctxStart, offset);
      }
    }
  }

  setVolume(v) {
    if (this.gain) this.gain.gain.value = v;
  }

  now() {
    const ac = audioContext();
    const latency = (ac.outputLatency || 0) + (ac.baseLatency || 0);
    return this.t0 + Math.max(0, ac.currentTime - this.ctxStart - latency);
  }

  stop() {
    try { this.source?.stop(); } catch { /* déjà arrêté */ }
    this.source?.disconnect();
    this.gain?.disconnect();
    this.source = null;
    this.gain = null;
  }
}

// ---------- forme d'onde ----------

export function computePeaks(buffer, perSecond = 200) {
  const n = Math.ceil(buffer.duration * perSecond);
  const peaks = new Float32Array(n);
  const step = buffer.sampleRate / perSecond;
  const channels = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step);
    const b = Math.min(buffer.length, Math.floor((i + 1) * step));
    let max = 0;
    for (const ch of channels) {
      for (let j = a; j < b; j += 4) {
        const v = Math.abs(ch[j]);
        if (v > max) max = v;
      }
    }
    peaks[i] = max;
  }
  let top = 0;
  for (const v of peaks) if (v > top) top = v;
  if (top > 0) for (let i = 0; i < n; i++) peaks[i] /= top;
  return { data: peaks, perSecond };
}

// ---------- détection du tempo ----------

// Enveloppe d'attaques à 200 images/s sur deux bandes (graves + aigus).
function onsetEnvelopes(buffer, maxSeconds = 150) {
  const sr = buffer.sampleRate;
  const fps = 200;
  const hop = sr / fps;
  const len = Math.min(buffer.length, Math.floor(sr * maxSeconds));
  const frames = Math.floor(len / hop);
  const chs = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) chs.push(buffer.getChannelData(c));

  const lowE = new Float32Array(frames);
  const highE = new Float32Array(frames);
  const alpha = 1 - Math.exp(-2 * Math.PI * 180 / sr); // passe-bas ~180 Hz
  let lp = 0;
  for (let f = 0; f < frames; f++) {
    const a = Math.floor(f * hop);
    const b = Math.floor((f + 1) * hop);
    let el = 0, eh = 0;
    for (let i = a; i < b; i++) {
      let x = 0;
      for (const ch of chs) x += ch[i];
      x /= chs.length;
      lp += alpha * (x - lp);
      const hi = x - lp;
      el += lp * lp;
      eh += hi * hi;
    }
    lowE[f] = Math.log1p(1000 * el / hop);
    highE[f] = Math.log1p(1000 * eh / hop);
  }

  const flux = (e) => {
    const out = new Float32Array(frames);
    for (let f = 1; f < frames; f++) out[f] = Math.max(0, e[f] - e[f - 1]);
    // Retire la moyenne locale (~0,5 s) pour ne garder que les attaques.
    const w = 50;
    let acc = 0;
    const res = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      acc += out[f];
      if (f >= w) acc -= out[f - w];
      const mean = acc / Math.min(f + 1, w);
      res[f] = Math.max(0, out[f] - mean);
    }
    return res;
  };
  const low = flux(lowE);
  const high = flux(highE);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) env[f] = low[f] * 1.5 + high[f];
  return { env, low, fps };
}

function combScore(env, fps, bpm, phase) {
  const period = fps * 60 / bpm;
  let s = 0, n = 0;
  for (let x = phase; x < env.length - 1; x += period) {
    const i = Math.round(x);
    s += env[i] + 0.5 * (env[i - 1] || 0) + 0.5 * env[i + 1];
    n++;
  }
  return n ? s / n : 0;
}

export function detectTempo(buffer) {
  const { env, low, fps } = onsetEnvelopes(buffer);
  const n = env.length;
  if (n < fps * 4) return null;

  // 1. Autocorrélation sur 60–190 BPM, pondérée autour de ~118 BPM pour limiter les erreurs d'octave.
  const minLag = Math.floor(fps * 60 / 190);
  const maxLag = Math.ceil(fps * 60 / 60);
  const acf = new Float32Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    acf[lag] = s / (n - lag);
  }
  let best = -1, bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = fps * 60 / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 118) / 0.7) ** 2);
    const v = acf[lag] * prior;
    if (v > best) { best = v; bestLag = lag; }
  }
  // Interpolation parabolique pour une précision sous l'image.
  const y0 = acf[bestLag - 1], y1 = acf[bestLag], y2 = acf[bestLag + 1];
  const denom = y0 - 2 * y1 + y2;
  const refined = denom ? bestLag + 0.5 * (y0 - y2) / denom : bestLag;
  let bpm = fps * 60 / refined;

  // 2. Affinage du tempo et de la phase par peigne d'impulsions.
  let top = { score: -1, bpm, phase: 0 };
  for (let b = bpm - 1.5; b <= bpm + 1.5; b += 0.02) {
    const period = fps * 60 / b;
    for (let ph = 0; ph < period; ph += 1) {
      const s = combScore(env, fps, b, ph);
      if (s > top.score) top = { score: s, bpm: b, phase: ph };
    }
  }
  bpm = top.bpm;
  if (Math.abs(bpm - Math.round(bpm)) < 0.2) bpm = Math.round(bpm);
  else bpm = Math.round(bpm * 10) / 10;

  // 3. Phase finale calée sur les graves (grosse caisse) avec le tempo retenu.
  const period = fps * 60 / bpm;
  let bestPh = 0, bestPhScore = -1;
  for (let ph = 0; ph < period; ph += 0.5) {
    const s = combScore(low, fps, bpm, ph) * 1.5 + combScore(env, fps, bpm, ph);
    if (s > bestPhScore) { bestPhScore = s; bestPh = ph; }
  }
  const offset = bestPh / fps;
  return { bpm, offset };
}

// ---------- choix automatique du passage ----------

// Cherche le passage le plus énergique (refrain, drop) de la durée voulue,
// en commençant sur une mesure et de préférence juste au moment où l'énergie monte.
export function findBestPassage(buffer, bpm, offset, duration) {
  const L = 60 / bpm;
  const bar = 4 * L;
  const total = buffer.duration;
  if (duration >= total - offset - 1) return offset;

  // Énergie (volume) et force des attaques (coups de batterie) toutes les 50 ms.
  const step = 0.05;
  const n = Math.floor(total / step);
  const sr = buffer.sampleRate;
  const chs = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) chs.push(buffer.getChannelData(c));
  const energy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step * sr), b = Math.floor((i + 1) * step * sr);
    let e = 0, k = 0;
    for (let j = a; j < b; j += 4) { for (const ch of chs) e += ch[j] * ch[j]; k++; }
    energy[i] = e / Math.max(1, k * chs.length);
  }
  const ePrefix = new Float64Array(n + 1);
  const fPrefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const flux = i ? Math.max(0, Math.log1p(1000 * energy[i]) - Math.log1p(1000 * energy[i - 1])) : 0;
    ePrefix[i + 1] = ePrefix[i] + energy[i];
    fPrefix[i + 1] = fPrefix[i] + flux;
  }
  const meanOf = (prefix, s, e) => {
    const i0 = Math.max(0, Math.floor(s / step)), i1 = Math.min(n, Math.floor(e / step));
    return i1 > i0 ? (prefix[i1] - prefix[i0]) / (i1 - i0) : 0;
  };
  const eAll = meanOf(ePrefix, 0, total) || 1;
  const fAll = meanOf(fPrefix, 0, total) || 1;
  const intensity = (s, e) => meanOf(ePrefix, s, e) / eAll + meanOf(fPrefix, s, e) / fAll;

  let best = offset, bestScore = -Infinity;
  for (let s = offset; s + duration <= total - 0.5; s += bar) {
    const body = intensity(s, s + duration);
    const rise = intensity(s, s + 2 * bar) - intensity(s - 2 * bar, s);
    const score = body + 0.5 * Math.max(0, rise);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

// Analyse complète d'une musique de la bibliothèque.
export async function analyzeTrack(url) {
  const buffer = await decodeAudio(url);
  const tempo = detectTempo(buffer) || { bpm: 120, offset: 0 };
  const highlight = findBestPassage(buffer, tempo.bpm, tempo.offset, 20);
  return { buffer, meta: { bpm: tempo.bpm, offset: tempo.offset, duration: buffer.duration, highlight } };
}

// ---------- tap tempo ----------

export class TapTempo {
  constructor() { this.taps = []; }
  tap() {
    const now = performance.now();
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 12) this.taps.shift();
    if (this.taps.length < 3) return null;
    const intervals = [];
    for (let i = 1; i < this.taps.length; i++) intervals.push(this.taps[i] - this.taps[i - 1]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return Math.round(600000 / avg) / 10;
  }
}
