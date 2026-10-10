// Génère la bibliothèque d'effets sonores intégrée (public/sfx) par synthèse :
// aucun fichier téléchargé, aucun droit d'auteur. Relancer : node tools/generate-sfx.mjs
//
// Chaque effet est construit à partir de bruit filtré, d'oscillateurs et d'une réverbération,
// en stéréo 48 kHz, puis normalisé et écrit en WAV (pas de silence ajouté au début, comme en MP3).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sfx');
const SR = 48000;
const TAU = Math.PI * 2;

// ---------- outils ----------

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const white = () => rnd() * 2 - 1;
const n = (s) => Math.round(s * SR);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function pinkNoise() {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = white();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return out * 0.11;
  };
}

// Filtre biquad (formules RBJ), réglable à chaque échantillon.
class Biquad {
  constructor(type) { this.type = type; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.f = -1; }
  set(freq, q = 0.707) {
    freq = clamp(freq, 20, SR * 0.45);
    if (Math.abs(freq - this.f) < 0.5 && q === this.q) return;
    this.f = freq; this.q = q;
    const w = TAU * freq / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (this.type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (this.type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; } // passe-bande
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * cs / a0; this.a2 = (1 - al) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const stereo = (secs) => [new Float32Array(n(secs)), new Float32Array(n(secs))];

// Ajoute un signal mono dans le buffer, avec panoramique (-1 gauche … 1 droite), à partir de `at` s.
function addMono(buf, at, len, fn, pan = 0) {
  const start = n(at);
  for (let i = 0; i < len && start + i < buf[0].length; i++) {
    const t = i / SR;
    const p = typeof pan === 'function' ? pan(t) : pan;
    const v = fn(t, i);
    const a = (clamp(p, -1, 1) + 1) * Math.PI / 4;
    buf[0][start + i] += v * Math.cos(a);
    buf[1][start + i] += v * Math.sin(a);
  }
}

// Réverbération type Freeverb (8 filtres en peigne + 4 passe-tout par canal).
function reverb(buf, { mix = 0.2, room = 0.82, damp = 0.35, tail = 0.8 } = {}) {
  const len = buf[0].length + n(tail);
  const out = [new Float32Array(len), new Float32Array(len)];
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  for (let ch = 0; ch < 2; ch++) {
    const spread = ch ? 23 : 0;
    const cb = combs.map((d) => ({ b: new Float32Array(d + spread), i: 0, s: 0 }));
    const ab = aps.map((d) => ({ b: new Float32Array(d + spread), i: 0 }));
    const src = buf[ch];
    for (let k = 0; k < len; k++) {
      const x = (k < src.length ? src[k] : 0) * 0.015;
      let y = 0;
      for (const c of cb) {
        const o = c.b[c.i];
        c.s = o * (1 - damp) + c.s * damp;
        c.b[c.i] = x + c.s * room;
        c.i = (c.i + 1) % c.b.length;
        y += o;
      }
      for (const a of ab) {
        const o = a.b[a.i];
        a.b[a.i] = y + o * 0.5;
        a.i = (a.i + 1) % a.b.length;
        y = o - y;
      }
      out[ch][k] = (k < src.length ? src[k] : 0) * (1 - mix) + y * mix * 3;
    }
  }
  return out;
}

function finish(buf, { peak = 0.89 } = {}) {
  let max = 0;
  for (const ch of buf) for (const v of ch) max = Math.max(max, Math.abs(v));
  const g = max ? peak / max : 1;
  // Coupe le silence final (sous -60 dB), petits fondus anti-clic.
  let end = buf[0].length;
  while (end > 1 && Math.abs(buf[0][end - 1] * g) < 0.001 && Math.abs(buf[1][end - 1] * g) < 0.001) end--;
  end = Math.min(buf[0].length, end + n(0.02));
  const fadeIn = n(0.002), fadeOut = n(0.015);
  return buf.map((ch) => {
    const o = ch.slice(0, end);
    for (let i = 0; i < o.length; i++) {
      let e = g;
      if (i < fadeIn) e *= i / fadeIn;
      if (i > o.length - fadeOut) e *= (o.length - i) / fadeOut;
      o[i] = clamp(o[i] * e, -1, 1);
    }
    return o;
  });
}

function writeWav(file, buf) {
  const len = buf[0].length;
  const data = Buffer.alloc(len * 4);
  for (let i = 0; i < len; i++) {
    data.writeInt16LE(Math.round(buf[0][i] * 32767), i * 4);
    data.writeInt16LE(Math.round(buf[1][i] * 32767), i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
  head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

const bell = (x) => Math.sin(Math.PI * clamp(x, 0, 1)) ** 2; // 0 → 1 → 0
const expDecay = (t, d) => Math.exp(-t / d);

// ---------- effets ----------

function whoosh({ dur = 0.9, peakAt = 0.55, lo = 220, hi = 3200, panFrom = -0.8, panTo = 0.8 } = {}) {
  const buf = stereo(dur);
  const pink = pinkNoise();
  const bp = new Biquad('bp'), lp = new Biquad('lp');
  addMono(buf, 0, n(dur), (t) => {
    const x = t / dur;
    const env = x < peakAt ? bell((x / peakAt) * 0.5) : bell(0.5 + ((x - peakAt) / (1 - peakAt)) * 0.5);
    const s = pink();
    bp.set(lo + (hi - lo) * env ** 1.4, 1.1);
    lp.set(300 + 1800 * env, 0.7);
    return (bp.run(s) * 1.4 + lp.run(s) * 0.6) * env ** 1.3;
  }, (t) => panFrom + (panTo - panFrom) * (t / dur));
  return finish(reverb(buf, { mix: 0.14, tail: 0.5 }));
}

function swish() {
  const dur = 0.32, buf = stereo(dur);
  const hp = new Biquad('hp'), bp = new Biquad('bp');
  hp.set(1800);
  addMono(buf, 0, n(dur), (t) => {
    const x = t / dur;
    const env = x < 0.35 ? (x / 0.35) ** 2 : expDecay(x - 0.35, 0.18);
    bp.set(7000 - 4500 * x, 0.9);
    return bp.run(hp.run(white())) * env;
  }, (t) => 0.7 - 1.4 * (t / dur));
  return finish(reverb(buf, { mix: 0.1, tail: 0.3 }));
}

function impactLayer(buf, at, { f0 = 95, f1 = 38, decay = 0.45, punch = 1 } = {}) {
  let ph = 0;
  const len = decay * 5;
  addMono(buf, at, n(len), (t) => {
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.07);
    ph += TAU * f / SR;
    // Extinction progressive jusqu'au silence complet (pas de coupure audible).
    return Math.tanh(Math.sin(ph) * expDecay(t, decay) * 1.8) * punch * (1 - t / len);
  });
  const lp = new Biquad('lp');
  lp.set(900);
  addMono(buf, at, n(0.25), (t) => lp.run(white()) * expDecay(t, 0.05) * 0.9 * punch);
  const hp = new Biquad('hp');
  hp.set(3000);
  addMono(buf, at, n(0.01), (t) => hp.run(white()) * expDecay(t, 0.002) * 0.6 * punch);
}

function impact() {
  const buf = stereo(2.2);
  impactLayer(buf, 0, { decay: 0.4 });
  return finish(reverb(buf, { mix: 0.22, room: 0.86, tail: 1.2 }));
}

function arrival() {
  const rise = 1.15, dur = rise + 2.6, buf = stereo(dur);
  const pink = pinkNoise();
  const bp = new Biquad('bp'), lp = new Biquad('lp');
  addMono(buf, 0, n(rise), (t) => {
    const x = t / rise;
    const env = x ** 2.2;
    const s = pink();
    bp.set(180 + 4200 * x ** 1.8, 1.0);
    lp.set(250 + 2500 * x, 0.7);
    return (bp.run(s) * 1.3 + lp.run(s) * 0.7) * env * (x > 0.97 ? (1 - x) / 0.03 : 1);
  }, (t) => -0.6 + 0.6 * (t / rise));
  impactLayer(buf, rise, { decay: 0.5, punch: 1.1 });
  return finish(reverb(buf, { mix: 0.2, room: 0.85, tail: 1.2 }));
}

function air() {
  const dur = 1.9, buf = stereo(dur);
  for (const ch of [0, 1]) {
    const pink = pinkNoise();
    const bp = new Biquad('bp');
    const len = n(dur);
    for (let i = 0; i < len; i++) {
      const t = i / SR, x = t / dur;
      const env = x < 0.35 ? (x / 0.35) ** 1.5 : x > 0.6 ? ((1 - x) / 0.4) ** 1.5 : 1;
      bp.set(1700 + 900 * Math.sin(TAU * 0.6 * t + ch * 1.3), 0.8);
      buf[ch][i] += bp.run(pink()) * env;
    }
  }
  return finish(reverb(buf, { mix: 0.18, tail: 0.6 }), { peak: 0.6 });
}

function riser() {
  const dur = 2.6, buf = stereo(dur);
  const pink = pinkNoise();
  const lp = new Biquad('lp'), lpN = new Biquad('bp');
  const phs = [0, 0, 0];
  const det = [1, 1.007, 0.993];
  addMono(buf, 0, n(dur), (t) => {
    const x = t / dur;
    const f = 180 * Math.pow(7, x);
    let saw = 0;
    det.forEach((d, k) => { phs[k] = (phs[k] + f * d / SR) % 1; saw += phs[k] * 2 - 1; });
    lp.set(300 + 8000 * x ** 2, 1.2);
    lpN.set(400 + 6000 * x ** 1.5, 0.8);
    const env = x ** 2.5 * (x > 0.985 ? (1 - x) / 0.015 : 1);
    return (lp.run(saw / 3) * 0.55 + lpN.run(pink()) * 1.2) * env;
  });
  return finish(reverb(buf, { mix: 0.15, tail: 0.4 }));
}

function subDrop() {
  const dur = 1.5, buf = stereo(dur);
  let ph = 0;
  addMono(buf, 0, n(dur), (t) => {
    const x = t / dur;
    ph += TAU * (32 + 110 * Math.pow(1 - x, 2.2)) / SR;
    return Math.tanh(Math.sin(ph) * 2.2) * (1 - x) ** 1.2 * Math.min(1, t / 0.01);
  });
  return finish(buf);
}

function click({ freq = 3600, q = 5, low = 950, soft = false } = {}) {
  const buf = stereo(0.12);
  const bp = new Biquad('bp');
  bp.set(freq, q);
  addMono(buf, 0, n(0.05), (t) => bp.run(t < 0.0015 ? white() : 0) * (soft ? 0.6 : 1));
  addMono(buf, 0, n(0.012), (t) => Math.sin(TAU * low * t) * expDecay(t, 0.0025) * 0.35);
  return finish(buf, { peak: soft ? 0.6 : 0.8 }); // sec, sans réverbération
}

function shutter() {
  const buf = stereo(0.45);
  const clack = (at, scale, pitches) => {
    const bp = new Biquad('bp');
    bp.set(2600 * scale, 1.2);
    addMono(buf, at, n(0.02), (t) => bp.run(white()) * expDecay(t, 0.004) * 1.2);
    for (const [f, a, d] of pitches) addMono(buf, at, n(0.08), (t) => Math.sin(TAU * f * scale * t) * a * expDecay(t, d));
    const lp = new Biquad('lp');
    lp.set(400);
    addMono(buf, at, n(0.04), (t) => lp.run(white()) * expDecay(t, 0.008) * 0.8);
  };
  clack(0, 1, [[1150, 0.25, 0.012], [2950, 0.18, 0.008], [5300, 0.12, 0.005]]);
  clack(0.085, 0.92, [[1320, 0.3, 0.014], [3400, 0.2, 0.009], [6100, 0.1, 0.005]]);
  return finish(reverb(buf, { mix: 0.04, room: 0.5, damp: 0.6, tail: 0.12 }));
}

function pop() {
  const buf = stereo(0.25);
  let ph = 0;
  addMono(buf, 0, n(0.12), (t) => {
    ph += TAU * (230 + 800 * Math.exp(-t / 0.018)) / SR;
    return Math.sin(ph) * expDecay(t, 0.035);
  });
  const hp = new Biquad('hp');
  hp.set(2500);
  addMono(buf, 0, n(0.006), () => hp.run(white()) * 0.4);
  return finish(reverb(buf, { mix: 0.08, room: 0.5, tail: 0.1 }));
}

function ding() {
  const len = 3, buf = stereo(len);
  const base = 1046.5;
  const partials = [[1, 1, 0.9], [2, 0.5, 0.6], [2.76, 0.35, 0.45], [5.4, 0.18, 0.25], [8.93, 0.1, 0.12]];
  for (const [r, a, d] of partials) {
    addMono(buf, 0, n(len), (t) => Math.sin(TAU * base * r * t) * a * expDecay(t, d) * Math.min(1, t / 0.002) * (1 - t / len));
  }
  return finish(reverb(buf, { mix: 0.22, room: 0.84, tail: 1 }), { peak: 0.75 });
}

function sparkle() {
  const buf = stereo(1.8);
  for (let k = 0; k < 22; k++) {
    const at = 0.9 * (k / 22) ** 1.3 + rnd() * 0.04;
    const f = 7200 - k * 180 + rnd() * 900;
    const amp = 0.25 + rnd() * 0.25;
    addMono(buf, at, n(0.12), (t) => Math.sin(TAU * f * t) * amp * expDecay(t, 0.03), rnd() * 1.6 - 0.8);
  }
  const hp = new Biquad('hp');
  hp.set(7000);
  addMono(buf, 0, n(1.1), (t) => hp.run(white()) * 0.08 * bell(t / 1.1));
  return finish(reverb(buf, { mix: 0.35, room: 0.88, tail: 1 }), { peak: 0.7 });
}

function applause() {
  const dur = 3.6, buf = stereo(dur);
  const claps = 700;
  for (let k = 0; k < claps; k++) {
    // Densité : montée rapide, plateau, puis fin progressive.
    let at;
    do { at = rnd() * dur; } while (rnd() > (at < 0.3 ? at / 0.3 : at > 2.4 ? Math.max(0, (dur - at) / 1.2) : 1));
    const bp = new Biquad('bp');
    bp.set(900 + rnd() * 1500, 1.4);
    const amp = 0.3 + rnd() * 0.7;
    const d = 0.004 + rnd() * 0.006;
    addMono(buf, at, n(0.04), (t) => bp.run(white()) * amp * expDecay(t, d), rnd() * 1.8 - 0.9);
  }
  return finish(reverb(buf, { mix: 0.25, room: 0.84, tail: 0.8 }), { peak: 0.8 });
}

function glitch() {
  const buf = stereo(0.6);
  let at = 0;
  while (at < 0.5) {
    const len = 0.02 + rnd() * 0.05;
    const kind = Math.floor(rnd() * 3);
    const f = 150 + rnd() * 1800;
    const pan = rnd() > 0.5 ? 0.7 : -0.7;
    let hold = 0;
    addMono(buf, at, n(len), (t, i) => {
      if (kind === 0) return Math.sign(Math.sin(TAU * f * t)) * 0.35;
      if (kind === 1) { if (i % 40 === 0) hold = white(); return hold * 0.5; }
      return Math.round(Math.sin(TAU * f * t) * 4) / 4 * 0.45;
    }, pan);
    at += len + (rnd() > 0.7 ? 0.02 : 0);
  }
  return finish(buf, { peak: 0.75 });
}

function reverse() {
  const dur = 0.25;
  let buf = stereo(dur);
  const hp = new Biquad('hp');
  hp.set(500);
  addMono(buf, 0, n(dur), (t) => hp.run(white()) * expDecay(t, 0.06));
  buf = reverb(buf, { mix: 0.75, room: 0.9, damp: 0.2, tail: 1.4 });
  for (const ch of buf) ch.reverse();
  return finish(buf);
}

// ---------- catalogue ----------

const EFFECTS = [
  ['whoosh', 'Whoosh', 'Transitions', () => whoosh()],
  ['whoosh-long', 'Whoosh long', 'Transitions', () => whoosh({ dur: 1.6, peakAt: 0.6, lo: 160, hi: 2600, panFrom: 0.8, panTo: -0.8 })],
  ['swish', 'Swish rapide', 'Transitions', swish],
  ['arrivee', 'Arrivée (vent + impact)', 'Transitions', arrival],
  ['montee', 'Montée', 'Transitions', riser],
  ['aspiration', 'Aspiration (reverse)', 'Transitions', reverse],
  ['impact', 'Impact grave', 'Impacts', impact],
  ['sub-drop', 'Sub drop', 'Impacts', subDrop],
  ['glitch', 'Glitch', 'Impacts', glitch],
  ['clic', 'Clic', 'Interface', () => click()],
  ['clic-doux', 'Clic doux', 'Interface', () => click({ freq: 1900, q: 3, low: 600, soft: true })],
  ['pop', 'Pop', 'Interface', pop],
  ['ding', 'Ding', 'Interface', ding],
  ['photo', 'Appareil photo', 'Ambiance', shutter],
  ['air', 'Souffle d’air', 'Ambiance', air],
  ['paillettes', 'Paillettes', 'Ambiance', sparkle],
  ['applaudissements', 'Applaudissements', 'Ambiance', applause],
];

fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (const [id, name, category, make] of EFFECTS) {
  seed = 12345 + id.length * 7919;
  const buf = make();
  const file = `${id}.wav`;
  writeWav(path.join(OUT, file), buf);
  index.push({ file, name, category, duration: Math.round((buf[0].length / SR) * 1000) / 1000 });
  console.log(`${file.padEnd(24)} ${(buf[0].length / SR).toFixed(2)} s`);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
