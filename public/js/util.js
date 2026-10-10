// Petits utilitaires DOM et divers, partagés par toute l'interface.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const naturalCompare = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' }).compare;
export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function fmtTime(s, precise = true) {
  if (!Number.isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const str = precise ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0');
  return `${m}:${str}`;
}

export function fmtSeconds(s) {
  return `${round(s, 2).toLocaleString('fr-FR')} s`;
}

export function fmtBytes(n) {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} Go`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} Mo`;
  return `${Math.round(n / 1e3)} Ko`;
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.flush = (...args) => { clearTimeout(t); return fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

// Regroupe plusieurs demandes de rendu dans la même frame.
export function rafThrottle(fn) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(); });
  };
}

export function parseNumber(str) {
  const v = parseFloat(String(str).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

// ---------- icônes (traits simples, 20px) ----------

const ICONS = {
  play: '<path d="M7 4.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6.5 4.5h2.5v11H6.5zM11 4.5h2.5v11H11z" fill="currentColor" stroke="none"/>',
  back: '<path d="M12.5 4.5 7 10l5.5 5.5"/>',
  undo: '<path d="M7.5 8.5H13a3.5 3.5 0 0 1 0 7h-2.5"/><path d="M10 5.5 7 8.5l3 3"/>',
  redo: '<path d="M12.5 8.5H7a3.5 3.5 0 0 0 0 7h2.5"/><path d="M10 5.5l3 3-3 3"/>',
  text: '<path d="M5 5.5h10M10 5.5v10"/>',
  image: '<rect x="3.5" y="4.5" width="13" height="11" rx="2"/><circle cx="8" cy="8.5" r="1.3"/><path d="m4 14 4-3.5 3 2.5 2-1.5 3 2.5"/>',
  card: '<rect x="4.5" y="3.5" width="11" height="13" rx="2"/>',
  music: '<path d="M8 14.5V5l8-1.5V13"/><circle cx="6" cy="14.5" r="2"/><circle cx="14" cy="13" r="2"/>',
  folder: '<path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5H15a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 15 15.5H5A1.5 1.5 0 0 1 3.5 14z"/>',
  plus: '<path d="M10 4.5v11M4.5 10h11"/>',
  trash: '<path d="M4.5 6h11M8.5 6V4.5h3V6M6 6l.7 9.5h6.6L14 6"/>',
  copy: '<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7"/>',
  shuffle: '<path d="M4 6h2.5c3 0 4 8 7 8H16M4 14h2.5c1.3 0 2.2-1.3 2.9-3M11.5 9c.6-1.7 1.4-3 2.5-3H16"/><path d="m14 4 2 2-2 2M14 12l2 2-2 2"/>',
  export: '<path d="M10 3.5v9M6.5 7 10 3.5 13.5 7"/><path d="M4.5 12v3.5h11V12"/>',
  video: '<rect x="3.5" y="5.5" width="9" height="9" rx="1.5"/><path d="m12.5 9 4-2.5v7l-4-2.5"/>',
  check: '<path d="m5 10.5 3.2 3L15 6.5"/>',
  close: '<path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/>',
  tap: '<circle cx="10" cy="10" r="2.5"/><circle cx="10" cy="10" r="6"/>',
  wand: '<path d="m4.5 15.5 8-8M12 4v2M15.5 7.5h-2M14.5 5l-1.2 1.2"/>',
  zoomin: '<circle cx="9" cy="9" r="4.5"/><path d="m12.5 12.5 3.5 3.5M9 7v4M7 9h4"/>',
  zoomout: '<circle cx="9" cy="9" r="4.5"/><path d="m12.5 12.5 3.5 3.5M7 9h4"/>',
  fit: '<path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4"/>',
  reverse: '<path d="M4 7.5h11l-3-3M16 12.5H5l3 3"/>',
  sort: '<path d="M6 4.5v11M3.5 13 6 15.5 8.5 13M11 6h5.5M11 10h4M11 14h2.5"/>',
  eye: '<path d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2"/>',
  more: '<circle cx="5" cy="10" r=".8" fill="currentColor"/><circle cx="10" cy="10" r=".8" fill="currentColor"/><circle cx="15" cy="10" r=".8" fill="currentColor"/>',
  edit: '<path d="M4.5 15.5h3l8-8-3-3-8 8z"/>',
  scissors: '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="14" r="2.2"/><path d="M7.8 7.3 16 14M7.8 12.7 16 6"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

// ---------- notifications ----------

export function toast(message, { type = 'info', timeout = 3500 } = {}) {
  const host = document.getElementById('toasts');
  const el = h('div', { class: `toast toast-${type}` }, message);
  host.append(el);
  const close = () => el.remove();
  if (timeout) setTimeout(close, timeout);
  return { el, close, update: (msg) => { el.textContent = msg; } };
}

export function progressToast(label) {
  const host = document.getElementById('toasts');
  const text = h('div', { class: 'toast-label' }, label);
  const bar = h('div', { class: 'progress-bar' });
  const el = h('div', { class: 'toast' }, text, h('div', { class: 'progress' }, bar));
  host.append(el);
  return {
    set(fraction, msg) {
      bar.style.width = `${clamp(fraction, 0, 1) * 100}%`;
      if (msg) text.textContent = msg;
    },
    close() { el.remove(); },
  };
}

// ---------- fenêtres modales ----------

export function modal({ title, body, actions = [], onClose, width = 440, dismissable = true }) {
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(); } };
  const footer = actions.length
    ? h('div', { class: 'modal-actions' }, actions.map((a) => h('button', {
      class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`,
      onclick: () => a.onClick?.(close),
    }, a.label)))
    : null;
  const box = h('div', { class: 'modal', style: { width: `${width}px` } },
    title ? h('div', { class: 'modal-title' }, title) : null,
    h('div', { class: 'modal-body' }, body),
    footer);
  const overlay = h('div', { class: 'modal-overlay', onpointerdown: (e) => { if (e.target === overlay && dismissable) close(); } }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  return { close, box };
}

export function confirmDialog(message, { confirmLabel = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title: 'Confirmation',
      body: h('p', {}, message),
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: 'Annuler', onClick: (close) => close() },
        { label: confirmLabel, primary: !danger, danger, onClick: (close) => { answered = true; resolve(true); close(); } },
      ],
    });
  });
}

export function promptDialog(title, value = '', { confirmLabel = 'Valider' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const input = h('input', { class: 'input', value, onkeydown: (e) => { if (e.key === 'Enter') submit(); } });
    let closeFn;
    const submit = () => { answered = true; resolve(input.value.trim()); closeFn(); };
    const m = modal({
      title, body: input,
      onClose: () => { if (!answered) resolve(null); },
      actions: [
        { label: 'Annuler', onClick: (close) => close() },
        { label: confirmLabel, primary: true, onClick: () => submit() },
      ],
    });
    closeFn = m.close;
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

export function pickFiles({ accept = '', multiple = true, directory = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    if (directory) input.webkitdirectory = true;
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
