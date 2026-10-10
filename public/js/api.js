// Appels au serveur local.

async function request(method, url, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) init.body = body;
    else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export const listProjects = () => request('GET', '/api/projects');
export const createProject = (name) => request('POST', '/api/projects', { name });
export const getProject = (id) => request('GET', `/api/projects/${id}`);
export const saveProject = (p) => request('PUT', `/api/projects/${p.id}`, p);
export const deleteProject = (id) => request('DELETE', `/api/projects/${id}`);

export async function uploadFile(projectId, kind, name, blob, { unique = false } = {}) {
  const q = new URLSearchParams({ name, unique: unique ? '1' : '0' });
  const { name: saved } = await request('PUT', `/api/projects/${projectId}/files/${kind}?${q}`, blob);
  return saved;
}

export const transcode = (projectId, file) => request('POST', `/api/projects/${projectId}/transcode`, { file });
export const convertSticker = (projectId, file, target) => request('POST', `/api/projects/${projectId}/convert-sticker`, { file, target });
export const reveal = (projectId, file, kind = 'exports') => request('POST', `/api/projects/${projectId}/reveal`, { file, kind });

export const startExport = (projectId, opts) => request('POST', `/api/projects/${projectId}/exports`, opts);
export const pushFrames = (exportId, blob) => request('POST', `/api/exports/${exportId}/frames`, blob);
export const finishExport = (exportId) => request('POST', `/api/exports/${exportId}/finish`);
export const cancelExport = (exportId) => request('DELETE', `/api/exports/${exportId}`);

export const fileUrl = (projectId, kind, name) => `/files/${projectId}/${kind}/${encodeURIComponent(name)}`;

// ---------- bibliothèque partagée (kind : 'musiques' | 'logos') ----------
export const listLibrary = (kind) => request('GET', `/api/library/${kind}`);
export const setLibraryMeta = (kind, file, data) => request('PATCH', `/api/library/${kind}/meta`, { file, ...data });
export const deleteLibraryFile = (kind, file) => request('DELETE', `/api/library/${kind}/${encodeURIComponent(file)}`);
export const revealLibrary = (kind) => request('POST', `/api/library/${kind}/reveal`);
export const libUrl = (kind, file) => `/lib/${kind}/${encodeURIComponent(file)}`;

export async function uploadToLibrary(kind, file) {
  const q = new URLSearchParams({ name: file.name });
  return (await request('PUT', `/api/library/${kind}/files?${q}`, file)).file;
}

// Copie entre la bibliothèque et le dossier « media » d'un projet.
export const copyToLibrary = async (projectId, kind, file) => (await request('POST', `/api/projects/${projectId}/to-library`, { kind, file })).file;
export const copyFromLibrary = async (projectId, kind, file) => (await request('POST', `/api/projects/${projectId}/from-library`, { kind, file })).file;

export const listTemplates = () => request('GET', '/api/templates');
export const saveTemplate = (t) => request('PUT', `/api/templates/${t.id}`, t);
export const deleteTemplate = (id) => request('DELETE', `/api/templates/${id}`);
