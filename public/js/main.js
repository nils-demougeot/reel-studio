// Point d'entrée : navigation entre l'accueil (#/) et l'éditeur (#/p/<id>).

import { mountHome } from './home.js';
import { mountEditor, unmountEditor } from './editor.js';

const app = document.getElementById('app');
let pending = null;

function openWithFiles(id, files, cfg = null) {
  pending = { files, cfg };
  location.hash = `#/p/${id}`;
}

async function route() {
  const m = /^#\/p\/([a-z0-9-]+)/i.exec(location.hash);
  if (m) {
    const next = pending;
    pending = null;
    await mountEditor(app, m[1], next);
  } else {
    unmountEditor();
    await mountHome(app, { openWithFiles });
  }
}

window.addEventListener('hashchange', route);
route();
