// Web Worker for lightweight background removal.
// Receives a message: { id, file: Blob, maxDim }
// Posts back: { id, success: true, blob } with blob transferable, or { id, success: false, error }

// eslint-disable-next-line no-restricted-globals
self.onmessage = async (e) => {
  const { id, file, maxDim = 1024 } = e.data || {};
  try {
    if (!file) throw new Error('no file');
    // create image bitmap from blob
    const imgBitmap = await createImageBitmap(file);
    const scale = Math.min(1, Math.max(0.001, Math.min(maxDim / imgBitmap.width, maxDim / imgBitmap.height)));
    const w = Math.max(1, Math.round(imgBitmap.width * scale));
    const h = Math.max(1, Math.round(imgBitmap.height * scale));
    const off = new OffscreenCanvas(w, h);
    const ctx = off.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
    ctx.drawImage(imgBitmap, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // sample border pixels
    const borderSamples = [];
    const stepX = Math.max(1, Math.floor(w / 40));
    const stepY = Math.max(1, Math.floor(h / 40));
    for (let x = 0; x < w; x += stepX) {
      let idx = (0 * w + x) * 4;
      borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
      idx = ((h - 1) * w + x) * 4;
      borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
    for (let y = 0; y < h; y += stepY) {
      let idx = (y * w + 0) * 4;
      borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
      idx = (y * w + (w - 1)) * 4;
      borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }

    // compute mean and variance
    const sum = borderSamples.reduce((s, p) => { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; return s; }, [0, 0, 0]);
    const n = Math.max(1, borderSamples.length);
    const mean = [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)];
    let acc = 0;
    for (const p of borderSamples) {
      const dr = p[0] - mean[0];
      const dg = p[1] - mean[1];
      const db = p[2] - mean[2];
      acc += dr * dr + dg * dg + db * db;
    }
    const avgDist = acc / n;
    const thresholdSq = Math.max(900, Math.round(avgDist * 3)); // tunable

    // apply mask: set alpha = 0 if close to bg mean or already nearly transparent
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 16) { data[i + 3] = 0; continue; }
      const dr = r - mean[0], dg = g - mean[1], db = b - mean[2];
      const d2 = dr * dr + dg * dg + db * db;
      if (d2 <= thresholdSq) {
        data[i + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // export to blob (PNG preserves alpha)
    const outBlob = await off.convertToBlob({ type: 'image/png' });
    // Transfer blob back
    // eslint-disable-next-line no-restricted-globals
    self.postMessage({ id, success: true, blob: outBlob }, [outBlob]);
  } catch (err) {
    // eslint-disable-next-line no-restricted-globals
    self.postMessage({ id, success: false, error: (err && err.message) ? err.message : String(err) });
  }
};


