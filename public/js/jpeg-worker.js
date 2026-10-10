// Encode les images de l'export en JPEG hors du fil principal
// (plus rapide, et non ralenti quand l'onglet passe en arrière-plan).

let canvas = null;
let ctx = null;

self.onmessage = async (e) => {
  const { id, bitmap, quality } = e.data;
  try {
    if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      ctx = canvas.getContext('2d', { alpha: false });
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    self.postMessage({ id, blob });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
