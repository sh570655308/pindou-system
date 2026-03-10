const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { query } = require('../database');

// temp upload
const upload = multer({ dest: os.tmpdir() });

// POST /api/pixelate
// form-data: image file field name = "image"
// optional form field: max_pixels
router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少 image 文件' });
    const filePath = req.file.path;
    const maxPixels = parseInt(req.body.max_pixels || req.query.max_pixels || '40') || 40;

    const img = sharp(filePath);
    const meta = await img.metadata();
    let resizeOpts = {};
    if ((meta.width || 0) >= (meta.height || 0)) {
      resizeOpts.width = maxPixels;
    } else {
      resizeOpts.height = maxPixels;
    }

    const { data, info } = await img.resize(resizeOpts.width, resizeOpts.height, { kernel: sharp.kernel.nearest, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const channels = info.channels;

    // requested color count (limit); default 16
    const colorCount = parseInt(req.body.color_count || req.query.color_count || '16') || 16;
    // clamp sensible bounds
    const effectiveColorCount = Math.max(2, Math.min(256, colorCount));
    // whether to perform lightweight background removal (抠图) before quantization
    const removeBg = (req.body.remove_bg === '1' || req.body.remove_bg === 'true' || req.query.remove_bg === '1' || req.query.remove_bg === 'true');

    const byteToHex = (b) => ('0' + b.toString(16)).slice(-2).toUpperCase();
    const rgbToHex = (r, g, b) => `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
    const hexToRgb = (hex) => {
      if (!hex) return [204, 204, 204];
      const h = hex.replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };

    const dist2 = (a, b) => {
      const dr = a[0] - b[0];
      const dg = a[1] - b[1];
      const db = a[2] - b[2];
      return dr * dr + dg * dg + db * db;
    };

    // get palette from products (limit)
    let paletteRows = await query(`SELECT id, code, color_hex FROM products ORDER BY id LIMIT 512`);
    const palette = paletteRows.map((r) => {
      const rgb = hexToRgb(r.color_hex || '#CCCCCC');
      return { productId: r.id, code: r.code, hex: (r.color_hex || '#CCCCCC'), rgb };
    });

    // Step 1: 若请求需要抠图，先用边缘采样估算背景色（简单、CPU 友好），然后在扁平化像素时把与背景接近的像素替换为白色
    // 最终对处理后的像素做颜色量化（K-means），将颜色数量控制到 effectiveColorCount
    let bgMean = null;
    let bgThresholdSq = 0;
    if (removeBg) {
      const borderSamples = [];
      const stepX = Math.max(1, Math.floor(width / 30));
      const stepY = Math.max(1, Math.floor(height / 30));
      // top & bottom rows
      for (let x = 0; x < width; x += stepX) {
        let idx = (0 * width + x) * channels;
        const r1 = data[idx], g1 = data[idx + 1], b1 = data[idx + 2];
        borderSamples.push([r1, g1, b1]);
        idx = ((height - 1) * width + x) * channels;
        const r2 = data[idx], g2 = data[idx + 1], b2 = data[idx + 2];
        borderSamples.push([r2, g2, b2]);
      }
      // left & right columns
      for (let y = 0; y < height; y += stepY) {
        let idx = (y * width + 0) * channels;
        const r1 = data[idx], g1 = data[idx + 1], b1 = data[idx + 2];
        borderSamples.push([r1, g1, b1]);
        idx = (y * width + (width - 1)) * channels;
        const r2 = data[idx], g2 = data[idx + 1], b2 = data[idx + 2];
        borderSamples.push([r2, g2, b2]);
      }
      // compute mean
      const sum = borderSamples.reduce((s, p) => { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; return s; }, [0, 0, 0]);
      const n = Math.max(1, borderSamples.length);
      bgMean = [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)];
      // compute average distance squared to mean
      let accDist = 0;
      for (const p of borderSamples) accDist += dist2(p, bgMean);
      const avgDist = accDist / n;
      // threshold: at least 30 per channel (~900), scaled by observed variance
      bgThresholdSq = Math.max(900, Math.round(avgDist * 4));
    }

    // Step 1: 构建 pixelMask 并把需要参与量化的像素收集到 flatPixels
    // pixelMask: false 表示该像素为透明/空位，不参与量化，返回时用 {hex: null, productId: null}
    const pixelMask = new Array(width * height).fill(true);
    const flatPixels = []; // array of [r,g,b]
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = channels >= 4 ? data[idx + 3] : 255;
        // treat nearly-transparent as removed
        if (a < 16) {
          pixelMask[y * width + x] = false;
          continue;
        }
        let rr = r, gg = g, bb = b;
        if (a < 255) {
          const alpha = a / 255;
          rr = Math.round(rr * alpha + 255 * (1 - alpha));
          gg = Math.round(gg * alpha + 255 * (1 - alpha));
          bb = Math.round(bb * alpha + 255 * (1 - alpha));
        }
        // if removeBg requested and this pixel is close to estimated bg color, mark as removed
        if (removeBg && bgMean && dist2([rr, gg, bb], bgMean) <= bgThresholdSq) {
          pixelMask[y * width + x] = false;
          continue;
        }
        flatPixels.push([rr, gg, bb]);
      }
    }

    // simple K-means implementation (small images -> OK)
    const kmeans = (dataArr, k, maxIter = 30) => {
      if (!dataArr || dataArr.length === 0) return { centers: [], labels: [] };
      k = Math.min(k, dataArr.length);
      // initialize centers by random distinct samples
      const centers = [];
      const used = new Set();
      while (centers.length < k) {
        const idx = Math.floor(Math.random() * dataArr.length);
        if (!used.has(idx)) {
          used.add(idx);
          centers.push(dataArr[idx].slice());
        }
      }
      const labels = new Array(dataArr.length).fill(0);
      for (let iter = 0; iter < maxIter; iter++) {
        let moved = false;
        // assign
        for (let i = 0; i < dataArr.length; i++) {
          let best = -1;
          let bestD = Infinity;
          const pt = dataArr[i];
          for (let j = 0; j < centers.length; j++) {
            const d = dist2(pt, centers[j]);
            if (d < bestD) { bestD = d; best = j; }
          }
          if (labels[i] !== best) {
            labels[i] = best;
            moved = true;
          }
        }
        // recompute centers
        const sums = new Array(centers.length).fill(0).map(() => [0, 0, 0]);
        const counts = new Array(centers.length).fill(0);
        for (let i = 0; i < dataArr.length; i++) {
          const l = labels[i];
          sums[l][0] += dataArr[i][0];
          sums[l][1] += dataArr[i][1];
          sums[l][2] += dataArr[i][2];
          counts[l] += 1;
        }
        for (let j = 0; j < centers.length; j++) {
          if (counts[j] === 0) {
            centers[j] = dataArr[Math.floor(Math.random() * dataArr.length)].slice();
          } else {
            const nr = Math.round(sums[j][0] / counts[j]);
            const ng = Math.round(sums[j][1] / counts[j]);
            const nb = Math.round(sums[j][2] / counts[j]);
            centers[j][0] = nr;
            centers[j][1] = ng;
            centers[j][2] = nb;
          }
        }
        if (!moved) break;
      }
      return { centers, labels };
    };

    let centers = [];
    let labels = [];
    if (flatPixels.length > 0) {
      const res = kmeans(flatPixels, effectiveColorCount, 30);
      centers = res.centers;
      labels = res.labels;
    }

    // Step 2: 将量化后的颜色中心映射到产品调色盘（避免每个像素都做完整循环）
    // centers: array of [r,g,b]
    const centerToProduct = new Array(centers.length);
    for (let ci = 0; ci < centers.length; ci++) {
      let bestPid = null;
      let bestHex = rgbToHex(centers[ci][0], centers[ci][1], centers[ci][2]);
      let bestDist = Infinity;
      for (const p of palette) {
        const d = dist2(centers[ci], p.rgb);
        if (d < bestDist) {
          bestDist = d;
          bestPid = p.productId;
          bestHex = p.hex;
        }
      }
      centerToProduct[ci] = { productId: bestPid, hex: bestHex };
    }

    // Step 3: build pixel grid using pixelMask and mapped center -> product mapping
    const pixels = [];
    const statsMap = new Map();
    let labelIndex = 0;
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!pixelMask[idx]) {
          // transparent / removed background
          row.push({ hex: null, productId: null });
          continue;
        }
        const label = labels[labelIndex] ?? 0;
        const mapped = centerToProduct[label] || { productId: null, hex: rgbToHex(...(centers[label] || [204,204,204])) };
        row.push({ hex: mapped.hex, productId: mapped.productId });
        if (mapped.productId != null) {
          const key = String(mapped.productId);
          statsMap.set(key, (statsMap.get(key) || 0) + 1);
        }
        labelIndex++;
      }
      pixels.push(row);
    }

    const stats = [];
    for (const p of palette) {
      const cnt = statsMap.get(String(p.productId)) || 0;
      if (cnt > 0) stats.push({ productId: p.productId, code: p.code, hex: p.hex, count: cnt });
    }
    stats.sort((a, b) => b.count - a.count);
    const total = width * height;

    // cleanup temp file
    try { fs.unlinkSync(filePath); } catch (e) {}

    res.json({ pixels, stats, total, width, height });
  } catch (error) {
    console.error('pixelate upload error', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


