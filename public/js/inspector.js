// Panneau de droite : réglages du projet, des médias sélectionnés ou du texte / logo sélectionné.

import { store, on, commit, selectedClips, selectedOverlay, setTime } from './store.js';
import {
  BEAT_CHOICES, FIT_MODES, MOTIONS, TEXT_STYLES, ANIMATIONS, TEXT_PRESETS, FONTS, SWATCHES,
  beatLength, fontById, clipIndexAt, snapToBeat, introEnd, musicSegments,
} from './model.js';
import {
  music, setBpm, redetectTempo, shiftMusic, pickMusic, removeMusic, setBeatsForAll, setBeatsForSelection,
  updateSelectedClips, updateAllClips, duplicateSelection, deleteSelection, updateOverlay, replaceLogo,
  useLibraryMusic, autoPassage, splitAtPlayhead, deleteMusicSegments, restoreFullMusic,
} from './actions.js';
import { openMusicLibrary } from './library.js';

// Choix d'une musique de la bibliothèque, placée directement sur son meilleur passage.
const fromLibrary = () => openMusicLibrary({
  onPick: async (item) => { await useLibraryMusic(item); autoPassage(); },
});
import { TapTempo } from './audio.js';
import { fileUrl } from './api.js';
import { h, icon, clamp, round, fmtTime, parseNumber, rafThrottle } from './util.js';

// ---------- petits composants ----------

const section = (title, ...children) => h('section', { class: 'insp-section' }, title ? h('h3', {}, title) : null, ...children);
const row = (label, ...children) => h('div', { class: 'insp-row' }, label ? h('label', {}, label) : null, h('div', { class: 'insp-control' }, ...children));
const hint = (text) => h('p', { class: 'insp-hint' }, text);

function segmented(options, value, onChange, { small = false } = {}) {
  return h('div', { class: `segmented ${small ? 'segmented-sm' : ''}` }, options.map((o) => h('button', {
    class: `seg ${o.id === value ? 'is-on' : ''}`,
    title: o.title || '',
    style: o.style || null,
    onclick: () => onChange(o.id),
  }, o.label)));
}

function slider({ min, max, step, value, format, onInput }) {
  const out = h('span', { class: 'slider-value' }, format(value));
  const input = h('input', {
    type: 'range', class: 'range', min, max, step, value,
    oninput: () => { const v = Number(input.value); out.textContent = format(v); onInput(v); },
  });
  return h('div', { class: 'slider' }, input, out);
}

function colorPicker(value, onChange) {
  const native = h('input', { type: 'color', class: 'color-native', value, oninput: () => onChange(native.value, true) });
  return h('div', { class: 'swatches' },
    SWATCHES.map((c) => h('button', {
      class: `swatch ${c.toLowerCase() === String(value).toLowerCase() ? 'is-on' : ''}`,
      style: { background: c }, title: c, onclick: () => onChange(c),
    })),
    h('label', { class: 'swatch swatch-custom', title: 'Autre couleur' }, native));
}

function numberInput(value, { step = 0.1, min, max, suffix, onChange, width = 72 }) {
  const input = h('input', {
    class: 'input input-num', value: value == null ? '' : String(value).replace('.', ','), style: { width: `${width}px` },
    onchange: () => {
      let v = parseNumber(input.value);
      if (v == null) return;
      if (min != null) v = Math.max(min, v);
      if (max != null) v = Math.min(max, v);
      onChange(v);
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const v = (parseNumber(input.value) || 0) + (e.key === 'ArrowUp' ? step : -step);
        input.value = String(round(v, 3)).replace('.', ',');
        input.dispatchEvent(new Event('change'));
      }
    },
  });
  return h('span', { class: 'num-wrap' }, input, suffix ? h('span', { class: 'num-suffix' }, suffix) : null);
}

const secs = (s) => `${round(s, 2).toLocaleString('fr-FR')} s`;
const beatsLabel = (b) => (BEAT_CHOICES.find((c) => c.beats === b)?.label ?? round(b, 3).toLocaleString('fr-FR'));

// ---------- panneau ----------

export function createInspector() {
  const body = h('div', { class: 'insp-body' });
  const root = h('aside', { class: 'inspector' }, body);
  const tap = new TapTempo();

  function render() {
    const p = store.project;
    if (!p) return;
    const scroll = body.scrollTop;
    let content;
    const ov = selectedOverlay();
    const clips = selectedClips();
    if (store.sel.type === 'music' && p.music) content = musicCutPanel(p);
    else if (ov?.type === 'text') content = textPanel(p, ov);
    else if (ov?.type === 'logo') content = logoPanel(p, ov);
    else if (clips.length) content = clipsPanel(p, clips);
    else content = projectPanel(p);
    body.replaceChildren(...[content].flat());
    body.scrollTop = scroll;
  }

  // ----- projet -----
  function projectPanel(p) {
    const L = beatLength(p);
    const photoCount = p.clips.filter((c) => p.media[c.mediaId]?.type === 'image').length;
    const tapBtn = h('button', {
      class: 'btn btn-ghost btn-sm', title: 'Tapez en rythme sur ce bouton (ou la touche B)',
      onclick: () => {
        const bpm = tap.tap();
        tapBtn.classList.add('is-flash');
        setTimeout(() => tapBtn.classList.remove('is-flash'), 90);
        if (bpm) { bpmInput.querySelector('input').value = String(bpm).replace('.', ','); setBpm(bpm, 'tap'); }
      },
    }, icon('tap', 15), 'Taper');
    const bpmInput = numberInput(p.rhythm.bpm, { step: 1, min: 30, max: 300, suffix: 'BPM', onChange: (v) => setBpm(v) });

    const rhythm = section('Rythme',
      row('Tempo', bpmInput,
        music.buffer ? h('button', { class: 'btn btn-ghost btn-sm', onclick: redetectTempo, title: 'Analyser la musique' }, icon('wand', 15), 'Détecter') : null,
        tapBtn),
      hint(`1 temps = ${secs(L)}`),
      row('Chaque photo',
        segmented(BEAT_CHOICES.map((c) => ({ id: c.beats, label: c.label, title: `${c.beats} temps = ${secs(c.beats * L)}` })), p.defaults.beats, setBeatsForAll)),
      hint(`${beatsLabel(p.defaults.beats)} temps = ${secs(p.defaults.beats * L)} par photo${photoCount ? ` · ${photoCount} photos` : ''}. S'applique à toutes les photos ; sélectionnez des médias dans la timeline pour régler leur durée à part.`));

    let musicSec;
    if (p.music) {
      musicSec = section('Musique',
        h('div', { class: 'music-card' }, icon('music', 16), h('span', { class: 'music-name' }, p.music.name),
          h('span', { class: 'muted' }, fmtTime(p.music.duration, false))),
        row('Début', h('button', { class: 'btn btn-icon btn-sm', title: '4 temps plus tôt', onclick: () => shiftMusic(-4) }, '−4'),
          h('button', { class: 'btn btn-icon btn-sm', title: '1 temps plus tôt', onclick: () => shiftMusic(-1) }, '−1'),
          h('span', { class: 'value-pill' }, fmtTime(p.music.start)),
          h('button', { class: 'btn btn-icon btn-sm', title: '1 temps plus tard', onclick: () => shiftMusic(1) }, '+1'),
          h('button', { class: 'btn btn-icon btn-sm', title: '4 temps plus tard', onclick: () => shiftMusic(4) }, '+4')),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-ghost btn-sm', onclick: autoPassage, title: 'Place le début sur le refrain / drop le plus énergique' }, icon('wand', 15), 'Meilleur passage')),
        hint('Ou glissez la forme d’onde dans la timeline pour choisir le passage.'),
        row('Volume', slider({
          min: 0, max: 1.5, step: 0.01, value: p.music.volume ?? 1, format: (v) => `${Math.round(v * 100)} %`,
          onInput: (v) => commit((q) => { q.music.volume = v; }, { key: 'music-vol', source: 'inspector' }),
        })),
        row('Fondu final', slider({
          min: 0, max: 5, step: 0.1, value: p.export.fadeOut, format: (v) => secs(v),
          onInput: (v) => commit((q) => { q.export.fadeOut = v; }, { key: 'fade', source: 'inspector' }),
        })),
        row('Calage', slider({
          min: -0.25, max: 0.25, step: 0.005, value: 0, format: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 1000)} ms`,
          onInput: (() => {
            const base = p.rhythm.offset, start = p.music.start;
            return (v) => commit((q) => {
              const Lq = beatLength(q);
              q.rhythm.offset = ((base + v) % Lq + Lq) % Lq;
              q.music.start = snapToBeat(q, start + v);
            }, { key: 'calage', source: 'inspector' });
          })(),
        })),
        hint('Calage : décale légèrement les coupes si elles tombent un peu avant ou après le temps.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-ghost btn-sm', onclick: fromLibrary }, icon('music', 15), 'Bibliothèque'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: pickMusic }, 'Importer un fichier'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: removeMusic }, 'Retirer')),
        p.music.removed.length ? h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-ghost btn-sm', onclick: restoreFullMusic }, `Rétablir la musique entière (${p.music.removed.length} passage${p.music.removed.length > 1 ? 's' : ''} supprimé${p.music.removed.length > 1 ? 's' : ''})`)) : null,
        hint('Couper un passage : cliquez la piste Musique, placez la tête de lecture, « Couper » (S) aux deux bords, cliquez le morceau du milieu puis Suppr.'));
    } else {
      musicSec = section('Musique',
        h('button', { class: 'btn btn-wide', onclick: fromLibrary }, icon('music', 16), 'Choisir dans la bibliothèque'),
        h('button', { class: 'btn btn-wide btn-ghost', onclick: pickMusic }, icon('plus', 16), 'Importer un fichier audio'),
        hint('Le tempo est détecté automatiquement. Vous pouvez aussi glisser un fichier audio n\'importe où.'));
    }

    const images = section('Images',
      row('Format', segmented(FIT_MODES, p.defaults.fit, (v) => updateAllClips({ fit: v }), { small: true })),
      hint('Adapter : la photo reste entière, avec des bandes noires (couleur « Fond ») si elle n’est pas au format 9:16. Recadrer : elle remplit l’écran.'),
      row('Mouvement', segmented(MOTIONS, p.defaults.motion, (v) => {
        commit((q) => {
          q.defaults.motion = v;
          for (const c of q.clips) if (q.media[c.mediaId]?.type !== 'video') c.motion = v;
        });
      }, { small: true })),
      row('Fond', colorPicker(p.settings.background, (c, live) => commit((q) => { q.settings.background = c; }, { key: 'bg', source: live ? 'inspector' : null }))),
      hint('Ces réglages s\'appliquent à tous les médias.'));

    const help = section('Raccourcis',
      h('dl', { class: 'shortcuts' }, [
        ['Espace', 'Lecture / pause'], ['Clic, Maj+clic, Ctrl+clic', 'Sélectionner'], ['Ctrl+A', 'Tout sélectionner'],
        ['Glisser une vignette', 'Changer l\'ordre'], ['Glisser le bord d\'une vignette', 'Changer la durée'],
        ['1 à 5', 'Durée ¼ ½ 1 2 4 temps'], ['Alt+← / →', 'Déplacer la sélection'],
        ['Ctrl+D', 'Dupliquer'], ['Suppr', 'Supprimer'], ['Ctrl+Z / Ctrl+Y', 'Annuler / rétablir'], ['T', 'Ajouter un texte'],
      ].map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));

    return [h('div', { class: 'insp-title' }, 'Projet'), rhythm, musicSec, images, help];
  }

  // ----- passage de musique sélectionné -----
  function musicCutPanel(p) {
    const segs = musicSegments(p).filter((s) => store.sel.ids.includes(s.key));
    const total = segs.reduce((a, s) => a + s.to - s.from, 0);
    return [
      h('div', { class: 'insp-title' }, icon('music', 16), 'Passage de musique'),
      section(null,
        segs.map((s) => h('div', { class: 'music-card' }, icon('scissors', 15),
          h('span', { class: 'music-name' }, `${fmtTime(s.from)} → ${fmtTime(s.to)}`),
          h('span', { class: 'muted' }, secs(s.to - s.from)))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-sm btn-danger-text btn-ghost', onclick: () => deleteMusicSegments(store.sel.ids) }, icon('trash', 15), `Supprimer ce passage (${secs(total)})`),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => splitAtPlayhead() }, icon('scissors', 15), 'Couper ici (S)')),
        hint('La suite de la musique se recolle juste après. Les coupes sont calées sur les temps : les photos restent dans le rythme.'),
        p.music.removed.length ? h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: restoreFullMusic }, 'Rétablir la musique entière')) : null),
    ];
  }

  // ----- médias -----
  function clipsPanel(p, clips) {
    const L = beatLength(p);
    const first = clips[0];
    const same = (k) => clips.every((c) => c[k] === first[k]);
    const media = p.media[first.mediaId];
    const single = clips.length === 1;
    const title = single
      ? (first.kind === 'color' ? 'Carton couleur' : media?.name || 'Média')
      : `${clips.length} médias sélectionnés`;
    const beats = same('beats') ? first.beats : null;

    const durSec = section('Durée',
      segmented(BEAT_CHOICES.map((c) => ({ id: c.beats, label: `${c.label}`, title: `${c.beats} temps = ${secs(c.beats * L)}` })), beats, setBeatsForSelection),
      h('div', { class: 'insp-row' }, h('label', {}, 'Ou'),
        h('div', { class: 'insp-control' },
          numberInput(beats == null ? null : round(beats * L, 3), {
            step: 0.05, min: 0.04, max: 600, suffix: 's', onChange: (v) => setBeatsForSelection(Math.max(0.01, v / L)),
          }),
          numberInput(beats == null ? null : round(beats, 3), { step: 0.25, min: 0.0625, max: 512, suffix: 'temps', onChange: (v) => setBeatsForSelection(v), width: 60 }))),
      hint(beats == null ? 'Durées différentes — choisissez une valeur pour toutes les harmoniser.' : `${beatsLabel(beats)} temps = ${secs(beats * L)}${clips.length > 1 ? ' chacun' : ''}`));

    const parts = [h('div', { class: 'insp-title' }, single && media ? h('img', { class: 'insp-thumb', src: fileUrl(p.id, 'thumbs', `${media.id}.jpg`) }) : null, h('span', {}, title)), durSec];

    if (first.kind === 'color' && single) {
      parts.push(section('Couleur', colorPicker(first.color, (c, live) => updateSelectedClips({ color: c }, live ? `col-${first.id}` : null))));
    } else {
      parts.push(section('Cadrage',
        segmented(FIT_MODES, same('fit') ? first.fit : null, (v) => updateSelectedClips({ fit: v })),
        row('Zoom', slider({
          min: 1, max: 3, step: 0.01, value: same('zoom') ? first.zoom || 1 : 1, format: (v) => `${Math.round(v * 100)} %`,
          onInput: (v) => commit((q) => { const ids = new Set(store.sel.ids); for (const c of q.clips) if (ids.has(c.id)) c.zoom = v; }, { key: `zoom-${first.id}`, source: 'inspector' }),
        })),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => updateSelectedClips({ fx: 0.5, fy: 0.5, zoom: 1 }) }, 'Recentrer')),
        hint(first.fit === 'cover'
          ? 'Astuce : glissez l\'image dans l\'aperçu pour choisir la partie visible.'
          : 'Ce réglage ne concerne que ce(s) média(s). Le bouton au-dessus de l\'aperçu change le format de tous les médias.')));
      parts.push(section('Mouvement', segmented(MOTIONS, same('motion') ? first.motion : null, (v) => updateSelectedClips({ motion: v }))));
    }

    if (single && media?.type === 'video') {
      const dur = beats * L;
      const maxTrim = Math.max(0, media.duration - dur);
      parts.push(section('Extrait vidéo',
        row('Début', slider({
          min: 0, max: Math.max(0.01, maxTrim), step: 0.01, value: Math.min(first.trim || 0, maxTrim), format: (v) => fmtTime(v),
          onInput: (v) => {
            commit((q) => { const c = q.clips.find((x) => x.id === first.id); c.trim = v; }, { key: `trim-${first.id}`, source: 'inspector' });
            const i = p.clips.findIndex((c) => c.id === first.id);
            setTime(store.tl.starts[i] + 0.001);
          },
        })),
        hint(`Vidéo de ${fmtTime(media.duration)} · ${secs(dur)} utilisées. Le son de la vidéo est coupé.`),
        dur > media.duration + 0.05 ? hint('La vidéo est plus courte que la durée choisie : la dernière image restera affichée.') : null));
    }

    parts.push(h('div', { class: 'btn-row insp-actions' },
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => splitAtPlayhead(), title: 'Coupe le média sous la tête de lecture (S)' }, icon('scissors', 15), 'Couper ici'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: duplicateSelection }, icon('copy', 15), 'Dupliquer'),
      h('button', { class: 'btn btn-ghost btn-sm btn-danger-text', onclick: deleteSelection }, icon('trash', 15), 'Supprimer')));
    return parts;
  }

  // ----- timing commun texte / logo -----
  function timingSection(p, ov) {
    const set = (start, end) => updateOverlay(ov.id, { start: Math.max(0, start), end: Math.max(start + 0.1, end) });
    const total = store.tl.total || 2;
    const i = clipIndexAt(store.tl, store.time);
    return section('Affichage',
      h('div', { class: 'insp-row' }, h('label', {}, 'De'),
        h('div', { class: 'insp-control' },
          numberInput(round(ov.start, 2), { step: 0.1, min: 0, suffix: 's', onChange: (v) => set(v, Math.max(ov.end, v + 0.1)) }),
          h('span', { class: 'muted' }, 'à'),
          numberInput(round(ov.end, 2), { step: 0.1, min: 0.1, suffix: 's', onChange: (v) => set(Math.min(ov.start, v - 0.1), v) }))),
      h('div', { class: 'chips' },
        h('button', { class: 'chip', onclick: () => set(0, introEnd(store.tl)) }, 'Intro'),
        i >= 0 ? h('button', { class: 'chip', onclick: () => set(store.tl.starts[i], store.tl.starts[i] + store.tl.durs[i]) }, 'Ce média') : null,
        h('button', { class: 'chip', onclick: () => set(store.time, total) }, 'D\'ici à la fin'),
        h('button', { class: 'chip', onclick: () => set(Math.max(0, total - 2), total) }, 'Fin (2 s)'),
        h('button', { class: 'chip', onclick: () => set(0, total) }, 'Toute la vidéo')),
      row('Animation', segmented(ANIMATIONS, ov.anim, (v) => updateOverlay(ov.id, { anim: v }), { small: true })));
  }

  function positionChips(ov, positions) {
    return h('div', { class: 'chips' }, positions.map(([label, x, y]) => h('button', {
      class: 'chip', onclick: () => updateOverlay(ov.id, { x, y }),
    }, label)));
  }

  // ----- texte -----
  let textArea = null;
  function textPanel(p, ov) {
    const font = fontById(ov.font);
    textArea = h('textarea', {
      class: 'input textarea', rows: 2, value: ov.text, placeholder: 'Votre texte',
      oninput: () => updateText(),
    });
    const updateText = () => commit((q) => { q.overlays.find((o) => o.id === ov.id).text = textArea.value; }, { key: `text-${ov.id}`, source: 'inspector' });

    const weights = font.weights.map((w) => ({ id: w, label: { 400: 'Normal', 700: 'Gras', 800: 'Extra', 900: 'Black' }[w] }));
    return [
      h('div', { class: 'insp-title' }, h('span', { class: 'dot dot-text' }), 'Texte'),
      section(null, textArea,
        h('div', { class: 'chips' }, Object.entries(TEXT_PRESETS).map(([id, pr]) => h('button', {
          class: 'chip', title: 'Appliquer ce style',
          onclick: () => updateOverlay(ov.id, { font: pr.font, weight: pr.weight, size: pr.size, style: pr.style, uppercase: pr.uppercase, anim: pr.anim, spacing: pr.spacing }),
        }, pr.label)))),
      section('Police',
        h('div', { class: 'font-grid' }, FONTS.map((f) => h('button', {
          class: `font-btn ${f.id === ov.font ? 'is-on' : ''}`,
          style: { fontFamily: `"${f.family}"`, fontWeight: String(f.weights.includes(700) ? 700 : 400) },
          onclick: () => updateOverlay(ov.id, { font: f.id, weight: f.weights.includes(ov.weight) ? ov.weight : f.weights[f.weights.length - 1] }),
        }, f.label))),
        weights.length > 1 ? segmented(weights, ov.weight, (v) => updateOverlay(ov.id, { weight: v }), { small: true }) : null,
        row('Taille', slider({
          min: 20, max: 300, step: 1, value: ov.size, format: (v) => `${v}`,
          onInput: (v) => updateOverlay(ov.id, { size: v }, `size-${ov.id}`),
        })),
        row('Casse', segmented([{ id: false, label: 'Normal' }, { id: true, label: 'MAJUSCULES' }], Boolean(ov.uppercase), (v) => updateOverlay(ov.id, { uppercase: v }), { small: true })),
        row('Aligner', segmented([{ id: 'left', label: 'Gauche' }, { id: 'center', label: 'Centre' }, { id: 'right', label: 'Droite' }], ov.align, (v) => updateOverlay(ov.id, { align: v }), { small: true }))),
      section('Couleurs',
        row('Texte', colorPicker(ov.color, (c, live) => updateOverlay(ov.id, { color: c }, live ? `col-${ov.id}` : null))),
        row('Style', segmented(TEXT_STYLES, ov.style, (v) => updateOverlay(ov.id, { style: v }), { small: true })),
        ov.style !== 'none' ? row(ov.style === 'outline' ? 'Contour' : 'Fond', colorPicker(ov.bgColor, (c, live) => updateOverlay(ov.id, { bgColor: c }, live ? `bg-${ov.id}` : null))) : null),
      section('Position',
        positionChips(ov, [['Haut', 0.5, 0.18], ['Centre', 0.5, 0.5], ['Bas', 0.5, 0.74]]),
        hint('Glissez le texte dans l\'aperçu, et ses coins pour l\'agrandir.')),
      timingSection(p, ov),
      h('div', { class: 'btn-row insp-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: duplicateSelection }, icon('copy', 15), 'Dupliquer'),
        h('button', { class: 'btn btn-ghost btn-sm btn-danger-text', onclick: deleteSelection }, icon('trash', 15), 'Supprimer')),
    ];
  }

  // ----- logo -----
  function logoPanel(p, ov) {
    return [
      h('div', { class: 'insp-title' }, h('span', { class: 'dot dot-logo' }), 'Logo'),
      section(null,
        h('div', { class: 'logo-preview' }, h('img', { src: fileUrl(p.id, 'media', ov.file) })),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => replaceLogo(ov.id) }, 'Changer l\'image'))),
      section('Apparence',
        row('Taille', slider({
          min: 0.05, max: 1, step: 0.005, value: ov.w, format: (v) => `${Math.round(v * 100)} %`,
          onInput: (v) => updateOverlay(ov.id, { w: v }, `w-${ov.id}`),
        })),
        row('Opacité', slider({
          min: 0.1, max: 1, step: 0.01, value: ov.opacity ?? 1, format: (v) => `${Math.round(v * 100)} %`,
          onInput: (v) => updateOverlay(ov.id, { opacity: v }, `op-${ov.id}`),
        }))),
      section('Position',
        positionChips(ov, [
          ['Haut', 0.5, 0.12], ['Centre', 0.5, 0.5], ['Bas', 0.5, 0.8],
          ['Haut gauche', 0.16, 0.08], ['Haut droite', 0.84, 0.08],
        ]),
        hint('Glissez le logo dans l\'aperçu, et ses coins pour le redimensionner.')),
      timingSection(p, ov),
      h('div', { class: 'btn-row insp-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: duplicateSelection }, icon('copy', 15), 'Dupliquer'),
        h('button', { class: 'btn btn-ghost btn-sm btn-danger-text', onclick: deleteSelection }, icon('trash', 15), 'Supprimer')),
    ];
  }

  const schedule = rafThrottle(render);
  on('project', (d) => { if (d?.source !== 'inspector') schedule(); });
  on('select', schedule);
  on('music', schedule);
  on('focus-text', () => requestAnimationFrame(() => requestAnimationFrame(() => {
    if (textArea?.isConnected) { textArea.focus(); textArea.select(); }
  })));
  on('tap', () => root.querySelector('[title^="Tapez"]')?.click());

  return root;
}
