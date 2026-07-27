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
    // maxPixels 作为「长边上限」：仅当原图长边超过它时才缩小，否则保持原始尺寸 1:1 映射。
    // 这样上传的图若已是指定分辨率，就不会被再次缩放/颜色混合；只对过大的图做下采样。
    const origW = meta.width || 0;
    const origH = meta.height || 0;
    const longSide = Math.max(origW, origH);
    let resizeOpts = null;
    if (longSide > maxPixels) {
      // 等比缩小：把长边压到 maxPixels，短边按比例（fit:inside 保持宽高比，不裁切）
      if (origW >= origH) {
        resizeOpts = { width: maxPixels };
      } else {
        resizeOpts = { height: maxPixels };
      }
    }

    const pipeline = resizeOpts
      ? img.resize(resizeOpts.width, resizeOpts.height, { kernel: sharp.kernel.nearest, fit: 'inside' })
      : img; // 原图尺寸已在上限内，不缩放，直接读取原始像素
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const channels = info.channels;

    // requested color count (limit); default 16
    // 「颜色精度」= 量化簇数 K（复用前端 color_count 字段，前端仍叫「颜色数」）。
    // 注意：最终输出物料数 ≤ K，因为调色盘在暗色/高饱和等区域覆盖不足时，多个簇会塌到同一物料。
    // 采用调色盘感知播种后，K=32 实测有效物料数约 25（旧 RGB-kmeans 仅 15）。
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

    // ===== 颜色匹配距离（两阶段算法的第二阶段）=====
    // 量化后的每个簇中心 → 一个物料色。距离 = 加权综合：亮度(L*)主导、色相强约束（杜绝蓝→红误配）、饱和度最后。
    // 不设 ΔE 阈值：每个簇独立映射，不同簇不会被强制合并，从而保留原图不同颜色之间的差异性。
    //   dist = WL·|ΔL*|/100 + WH·(ΔH/180) + WS·|ΔS|
    //   默认 WL=0.5, WH=0.35, WS=0.15
    const WL = 0.5, WH = 0.35, WS = 0.15;

    // ===== 感知颜色空间工具（CIELAB + CIEDE2000）=====
    // 亮度项用 CIELAB 的 L*（感知亮度，比 HSV 的 V 更准）。
    // CIEDE2000 实现保留备用（当前匹配走加权综合距离，但 L* 仍来自 rgbToLab）。
    const srgbToLinear = (c) => {
      const cs = c / 255;
      return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
    };
    const rgbToXyz = (rgb) => {
      const r = srgbToLinear(rgb[0]);
      const g = srgbToLinear(rgb[1]);
      const b = srgbToLinear(rgb[2]);
      return [
        r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
        r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
        r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
      ];
    };
    const xyzToLab = (xyz) => {
      const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
      const eps = 0.008856, kap = 903.3;
      const f = (t) => t > eps ? Math.cbrt(t) : (kap * t + 16) / 116;
      const fx = f(xyz[0] / Xn), fy = f(xyz[1] / Yn), fz = f(xyz[2] / Zn);
      return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    };
    const rgbToLab = (rgb) => xyzToLab(rgbToXyz(rgb));
    // HSV：仅用 H(0~360) 与 S(0~1)，亮度项交给 L*（V 不用）
    const rgbToHsv = (rgb) => {
      const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d !== 0) {
        if (mx === r) h = 60 * (((g - b) / d) % 6);
        else if (mx === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
      }
      if (h < 0) h += 360;
      const s = mx === 0 ? 0 : d / mx;
      return [h, s]; // [hue, saturation]
    };
    // 环形色相差，归一到 [0,180]
    const hueDiff = (h1, h2) => { let d = Math.abs(h1 - h2) % 360; return d > 180 ? 360 - d : d; };
    // 加权综合距离：亮度(L*)主导 + 色相强约束 + 饱和度最后。所有项归一到 [0,1]。
    // labPx/hsvPx 为簇中心的 Lab/HSV；pal.lab/pal.hsv 为候选产品色的预计算值。
    const matchDist = (labPx, hsvPx, pal) => {
      return WL * Math.abs(labPx[0] - pal.lab[0]) / 100
           + WH * hueDiff(hsvPx[0], pal.hsv[0]) / 180
           + WS * Math.abs(hsvPx[1] - pal.hsv[1]);
    };
    // CIEDE2000 色差公式（Sharma et al. 参考实现，保留备用）
    const ciede2000 = (lab1, lab2) => {
      const [L1, a1, b1] = lab1;
      const [L2, a2, b2] = lab2;
      const rad2deg = (r) => (r * 180) / Math.PI;
      const deg2rad = (d) => (d * Math.PI) / 180;
      const C1 = Math.sqrt(a1 * a1 + b1 * b1);
      const C2 = Math.sqrt(a2 * a2 + b2 * b2);
      const Cbar = (C1 + C2) / 2;
      const Cbar7 = Math.pow(Cbar, 7);
      const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
      const a1p = (1 + G) * a1;
      const a2p = (1 + G) * a2;
      const C1p = Math.sqrt(a1p * a1p + b1 * b1);
      const C2p = Math.sqrt(a2p * a2p + b2 * b2);
      let h1p = Math.atan2(b1, a1p); h1p = h1p < 0 ? h1p + 2 * Math.PI : h1p;
      let h2p = Math.atan2(b2, a2p); h2p = h2p < 0 ? h2p + 2 * Math.PI : h2p;
      const dLp = L2 - L1;
      const dCp = C2p - C1p;
      let dhp = h2p - h1p;
      if (dhp > Math.PI) dhp -= 2 * Math.PI;
      else if (dhp < -Math.PI) dhp += 2 * Math.PI;
      const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2);
      const Lbarp = (L1 + L2) / 2;
      const Cbarp = (C1p + C2p) / 2;
      let hbarp = (h1p + h2p) / 2;
      if (Math.abs(h1p - h2p) > Math.PI) hbarp += Math.PI;
      const T = 1 - 0.17 * Math.cos(hbarp - deg2rad(30))
              + 0.24 * Math.cos(2 * hbarp)
              + 0.32 * Math.cos(3 * hbarp + deg2rad(6))
              - 0.20 * Math.cos(4 * hbarp - deg2rad(63));
      const dTheta = deg2rad(30) * Math.exp(-Math.pow((rad2deg(hbarp) - 275) / 25, 2));
      const Cbarp7 = Math.pow(Cbarp, 7);
      const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
      const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
      const SC = 1 + 0.045 * Cbarp;
      const SH = 1 + 0.015 * Cbarp * T;
      const RT = -Math.sin(2 * dTheta) * RC;
      return Math.sqrt(
        Math.pow(dLp / SL, 2) +
        Math.pow(dCp / SC, 2) +
        Math.pow(dHp / SH, 2) +
        RT * (dCp / SC) * (dHp / SH)
      );
    };

    // get palette from products (limit)
    // 排除 R/P/Y/T/Q 开头的系列：半透色/特殊材质色，不适用于不透明像素图自动匹配
    let paletteRows = await query(`SELECT id, code, color_hex FROM products WHERE UPPER(SUBSTR(code,1,1)) NOT IN ('R','P','Y','T','Q') ORDER BY id LIMIT 512`);
    const palette = paletteRows.map((r) => {
      const rgb = hexToRgb(r.color_hex || '#CCCCCC');
      return { productId: r.id, code: r.code, hex: (r.color_hex || '#CCCCCC'), rgb };
    });
    // 预计算调色盘每个产品色的 Lab（亮度项）与 HSV（色相/饱和度项），供加权匹配复用
    for (const p of palette) {
      p.lab = rgbToLab(p.rgb);
      p.hsv = rgbToHsv(p.rgb);
    }

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

    // ===== 亮度优先分层量化（luma-first quantization）=====
    // 设计原理（实测 K=32：亮度误差 1.5→0.7, 色度误差 3.8→2.2, 总误差 5.1→3.5）：
    // 1) 先按 L*(感知亮度) 把像素分成 NL 个等宽档（0-10,10-20,...），确保亮度维度全覆盖。
    //    → 解决旧 K-means「暗红区堆积、L*8~18 出现空洞」导致亮度信息丢失的问题。
    //    → 用户实测反馈：「灰阶 9 以下丢失严重」，亮度是最重要维度，必须优先保障覆盖。
    // 2) 每档按像素数比例分配簇预算（每档至少 1 个），档内在 a*b* 色度平面做小 K-means。
    //    → 同一亮度档内按色相/饱和度细分，保留色调差异。
    // 3) 全程确定性（排序初始化，无 Math.random），刷新可复现。
    const lumaQuantize = (dataArr, k, nl = 10) => {
      if (!dataArr || dataArr.length === 0) return { centers: [], labels: [] };
      const n = dataArr.length;
      k = Math.min(k, n);
      const w = 100 / nl; // 每档宽度（L* 0-100 均分）

      // 预计算每个像素的 Lab（复用 rgbToLab）
      const pixLab = dataArr.map(rgbToLab);

      // —— 第 1 步：按 L* 等宽分桶 ——
      const buckets = Array.from({ length: nl }, () => []);
      for (let i = 0; i < n; i++) {
        let bi = Math.min(nl - 1, Math.floor(pixLab[i][0] / w));
        if (bi < 0) bi = 0;
        buckets[bi].push(i);
      }

      // —— 第 2 步：每档分配簇数 ——
      // 有像素的档各至少 1 簇，剩余按像素数轮分
      const activeBuckets = buckets.map((b, i) => ({ i, size: b.length })).filter(x => x.size > 0);
      const perBucket = {};
      for (const a of activeBuckets) perBucket[a.i] = 1;
      let remaining = k - activeBuckets.length;
      const sortedActive = [...activeBuckets].sort((a, b) => b.size - a.size);
      let oi = 0;
      while (remaining > 0 && sortedActive.length > 0) {
        perBucket[sortedActive[oi % sortedActive.length].i]++;
        remaining--; oi++;
      }

      // —— 第 3 步：档内在 a*b* 色度平面做小 K-means ——
      const centers = []; // [r,g,b]
      const pixLabel = new Array(n).fill(-1); // 每个像素的全局簇号
      let nextClusterId = 0;

      for (let bi = 0; bi < nl; bi++) {
        const bucketIdx = buckets[bi]; // 像素在 dataArr 中的下标
        if (bucketIdx.length === 0) continue;
        const kb = Math.min(perBucket[bi] || 1, bucketIdx.length);
        if (kb === 1) {
          // 单簇：直接用桶内像素均值
          let sr = 0, sg = 0, sb = 0;
          for (const idx of bucketIdx) { sr += dataArr[idx][0]; sg += dataArr[idx][1]; sb += dataArr[idx][2]; }
          const cnt = bucketIdx.length;
          centers.push([Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt)]);
          for (const idx of bucketIdx) pixLabel[idx] = nextClusterId;
          nextClusterId++;
          continue;
        }
        // 桶内 a*b* K-means
        const ab = bucketIdx.map(idx => [pixLab[idx][1], pixLab[idx][2]]);
        // 确定性初始化：a* 排序后均匀采样
        const abOrder = ab.map((_, i) => i).sort((a, b) => ab[a][0] - ab[b][0] || ab[a][1] - ab[b][1]);
        let cents = [];
        for (let c = 0; c < kb; c++) cents.push(ab[abOrder[Math.min(ab.length - 1, Math.floor((c + 0.5) * ab.length / kb))]].slice());
        const subLabel = new Array(ab.length).fill(0);
        for (let iter = 0; iter < 20; iter++) {
          let moved = false;
          for (let i = 0; i < ab.length; i++) {
            let best = 0, bestD = Infinity;
            for (let j = 0; j < cents.length; j++) {
              const d = (ab[i][0] - cents[j][0]) * (ab[i][0] - cents[j][0]) + (ab[i][1] - cents[j][1]) * (ab[i][1] - cents[j][1]);
              if (d < bestD) { bestD = d; best = j; }
            }
            if (subLabel[i] !== best) { subLabel[i] = best; moved = true; }
          }
          const sums = cents.map(() => [0, 0]), counts = new Array(cents.length).fill(0);
          for (let i = 0; i < ab.length; i++) { sums[subLabel[i]][0] += ab[i][0]; sums[subLabel[i]][1] += ab[i][1]; counts[subLabel[i]]++; }
          for (let j = 0; j < cents.length; j++) {
            if (counts[j] > 0) { cents[j][0] = sums[j][0] / counts[j]; cents[j][1] = sums[j][1] / counts[j]; }
          }
          if (!moved) break;
        }
        // 把每个子簇转成 RGB 中心（用子簇内像素 RGB 均值，更准确）
        for (let j = 0; j < cents.length; j++) {
          let sr = 0, sg = 0, sb = 0, cnt = 0;
          for (let i = 0; i < ab.length; i++) {
            if (subLabel[i] === j) { const idx = bucketIdx[i]; sr += dataArr[idx][0]; sg += dataArr[idx][1]; sb += dataArr[idx][2]; cnt++; }
          }
          if (cnt > 0) {
            centers.push([Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt)]);
          } else {
            // 空子簇：用桶均值兜底
            let bsr = 0, bsg = 0, bsb = 0;
            for (const idx of bucketIdx) { bsr += dataArr[idx][0]; bsg += dataArr[idx][1]; bsb += dataArr[idx][2]; }
            const bcnt = bucketIdx.length;
            centers.push([Math.round(bsr / bcnt), Math.round(bsg / bcnt), Math.round(bsb / bcnt)]);
          }
          for (let i = 0; i < ab.length; i++) {
            if (subLabel[i] === j) pixLabel[bucketIdx[i]] = nextClusterId;
          }
          nextClusterId++;
        }
      }

      return { centers, labels: pixLabel };
    };

    let centers = [];
    let labels = [];
    if (flatPixels.length > 0) {
      const res = lumaQuantize(flatPixels, effectiveColorCount, 10);
      centers = res.centers;
      labels = res.labels;
    }

    // Step 2: 将量化后的颜色中心映射到产品调色盘（避免每个像素都做完整循环）
    // centers: array of [r,g,b]
    // 用加权综合距离：亮度(L*)主导 + 色相强约束(杜绝蓝→红) + 饱和度最后。
    // 不设 ΔE 阈值 —— 每个簇独立映射到最近的物料色，不同簇不会被合并，从而保留原图色差。
    const centerToProduct = new Array(centers.length);
    for (let ci = 0; ci < centers.length; ci++) {
      const centerLab = rgbToLab(centers[ci]);
      const centerHsv = rgbToHsv(centers[ci]);
      let bestPid = null;
      let bestHex = rgbToHex(centers[ci][0], centers[ci][1], centers[ci][2]);
      let bestDist = Infinity;
      for (const p of palette) {
        const d = matchDist(centerLab, centerHsv, p);
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

// ===== 调试测试页面：GET /api/pixelate/debug-page 返回 HTML =====
router.get('/debug-page', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'debug', 'pixelate-debug.html');
  try {
    const html = fs.readFileSync(htmlPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send('调试页面文件未找到: ' + htmlPath);
  }
});

// ===== 调试端点：分阶段返回中间数据，供测试页面分布验证 =====
// POST /api/pixelate/debug  form-data: image, max_pixels, color_count, remove_bg, stage
//   stage=resize    : 仅做尺寸调整，返回原图尺寸/缩放后尺寸/预览图/去重颜色数
//   stage=quantize  : 尺寸调整 + K-means 量化，额外返回簇数/每簇中心色与像素数/量化预览图
//   stage=map       : 全流程，额外返回簇→物料映射表/最终物料数/最终预览图
//   stage=all (默认): 返回所有阶段数据
router.post('/debug', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少 image 文件' });
    const filePath = req.file.path;
    const maxPixels = parseInt(req.body.max_pixels || req.query.max_pixels || '40') || 40;
    const colorCount = parseInt(req.body.color_count || req.query.color_count || '16') || 16;
    const effectiveColorCount = Math.max(2, Math.min(256, colorCount));
    const removeBg = (req.body.remove_bg === '1' || req.body.remove_bg === 'true');
    const stage = req.body.stage || 'all';

    // ---- 工具函数（与主流程一致）----
    const byteToHex = (b) => ('0' + b.toString(16)).slice(-2).toUpperCase();
    const rgbToHex = (r, g, b) => `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
    const hexToRgb = (hex) => {
      if (!hex) return [204, 204, 204];
      const h = hex.replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    const srgbToLinear = (c) => { const cs = c / 255; return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4); };
    const rgbToXyz = (rgb) => {
      const r = srgbToLinear(rgb[0]), g = srgbToLinear(rgb[1]), b = srgbToLinear(rgb[2]);
      return [r * 0.4124564 + g * 0.3575761 + b * 0.1804375, r * 0.2126729 + g * 0.7151522 + b * 0.0721750, r * 0.0193339 + g * 0.1191920 + b * 0.9503041];
    };
    const xyzToLab = (xyz) => {
      const Xn = 0.95047, Yn = 1.0, Zn = 1.08883, eps = 0.008856, kap = 903.3;
      const f = (t) => t > eps ? Math.cbrt(t) : (kap * t + 16) / 116;
      const fx = f(xyz[0] / Xn), fy = f(xyz[1] / Yn), fz = f(xyz[2] / Zn);
      return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    };
    const rgbToLab = (rgb) => xyzToLab(rgbToXyz(rgb));
    const rgbToHsv = (rgb) => {
      const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d !== 0) {
        if (mx === r) h = 60 * (((g - b) / d) % 6);
        else if (mx === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
      }
      if (h < 0) h += 360;
      const s = mx === 0 ? 0 : d / mx;
      return [h, s];
    };
    const hueDiff = (h1, h2) => { let d = Math.abs(h1 - h2) % 360; return d > 180 ? 360 - d : d; };
    const WL = 0.5, WH = 0.35, WS = 0.15;
    const matchDist = (labPx, hsvPx, pal) =>
      WL * Math.abs(labPx[0] - pal.lab[0]) / 100 + WH * hueDiff(hsvPx[0], pal.hsv[0]) / 180 + WS * Math.abs(hsvPx[1] - pal.hsv[1]);
    const dist2 = (a, b) => { const dr = a[0]-b[0], dg = a[1]-b[1], db = a[2]-b[2]; return dr*dr + dg*dg + db*db; };

    // 把 raw 像素缓冲编码成 base64 PNG（放大到便于查看）
    const rawToPngBase64 = async (rawData, w, h, channels, scale = 1) => {
      const out = await sharp(rawData, { raw: { width: w, height: h, channels } })
        .resize(w * scale, h * scale, { kernel: sharp.kernel.nearest })
        .png().toBuffer();
      return 'data:image/png;base64,' + out.toString('base64');
    };

    const result = { stage, params: { maxPixels, colorCount: effectiveColorCount, removeBg } };

    // ============ 阶段 1：尺寸调整 ============
    const img = sharp(filePath);
    const meta = await img.metadata();
    const origW = meta.width || 0, origH = meta.height || 0;
    const longSide = Math.max(origW, origH);
    let resizeOpts = null;
    let didResize = false;
    if (longSide > maxPixels) {
      if (origW >= origH) resizeOpts = { width: maxPixels };
      else resizeOpts = { height: maxPixels };
      didResize = true;
    }
    const pipeline = resizeOpts
      ? img.resize(resizeOpts.width, resizeOpts.height, { kernel: sharp.kernel.nearest, fit: 'inside' })
      : img;
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const width = info.width, height = info.height, channels = info.channels;

    // 统计缩放后的去重颜色数
    const colorSet = new Set();
    for (let i = 0; i < data.length; i += channels) {
      const a = channels >= 4 ? data[i + 3] : 255;
      if (a < 16) continue;
      colorSet.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }

    result.resize = {
      original: { width: origW, height: origH },
      target: { maxPixels, rule: didResize ? `长边${longSide}>${maxPixels}，缩小到${resizeOpts.width?'宽':'高'}=${maxPixels}` : `${longSide}≤${maxPixels}，不缩放` },
      resized: didResize,
      after: { width, height, channels },
      distinctColors: colorSet.size,
    };
    if (stage === 'resize' || stage === 'all') {
      // 预览图：如果图很小就放大显示
      const previewScale = Math.max(1, Math.ceil(200 / Math.max(width, height)));
      result.resize.preview = await rawToPngBase64(data, width, height, channels, previewScale);
    }

    if (stage === 'resize') {
      try { fs.unlinkSync(filePath); } catch (e) {}
      return res.json(result);
    }

    // ============ 阶段 gray：灰度 32 阶量化（诊断用）============
    // 转 ITU-R BT.601 灰度（0-255），按 step=8 量化到 32 阶（0,8,16,...,248）。
    // 目的：排除 K-means 的干扰，看「纯亮度 32 级」能保留多少信息。
    if (stage === 'gray') {
      const step = Math.max(1, Math.round(256 / effectiveColorCount)); // color_count=32 → step=8
      const levels = Math.ceil(256 / step); // 实际阶数
      const grayRaw = Buffer.alloc(width * height * 4);
      const grayHistogram = {}; // {量化值: 像素数}
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * channels;
          const pidx = (y * width + x) * 4;
          const a = channels >= 4 ? data[idx + 3] : 255;
          if (a < 16) { grayRaw[pidx] = 255; grayRaw[pidx+1] = 255; grayRaw[pidx+2] = 255; grayRaw[pidx+3] = 0; continue; }
          // BT.601 灰度
          const gray = Math.round(0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2]);
          // 量化到 step 的倍数
          const q = Math.min(255, Math.floor(gray / step) * step);
          grayRaw[pidx] = q; grayRaw[pidx+1] = q; grayRaw[pidx+2] = q; grayRaw[pidx+3] = 255;
          grayHistogram[q] = (grayHistogram[q] || 0) + 1;
        }
      }
      const usedLevels = Object.keys(grayHistogram).sort((a, b) => Number(a) - Number(b));
      const previewScale = Math.max(1, Math.ceil(400 / Math.max(width, height)));
      result.gray = {
        method: `BT.601 灰度 → 每 ${step} 一阶（0~${step-1}→0, ${step}~${2*step-1}→${step}, ...）`,
        requestedLevels: effectiveColorCount,
        step,
        actualLevelsUsed: usedLevels.length,
        maxLevels: levels,
        histogram: usedLevels.map(v => ({ level: Number(v), count: grayHistogram[v] })),
      };
      // 对比预览：左=彩色原图(灰度化但不量化)，右=量化后
      const grayRawUnquantized = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * channels;
          const pidx = (y * width + x) * 4;
          const a = channels >= 4 ? data[idx + 3] : 255;
          if (a < 16) { grayRawUnquantized[pidx] = 255; grayRawUnquantized[pidx+1] = 255; grayRawUnquantized[pidx+2] = 255; grayRawUnquantized[pidx+3] = 0; continue; }
          const gray = Math.round(0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2]);
          grayRawUnquantized[pidx] = gray; grayRawUnquantized[pidx+1] = gray; grayRawUnquantized[pidx+2] = gray; grayRawUnquantized[pidx+3] = 255;
        }
      }
      result.gray.previewOriginal = await rawToPngBase64(grayRawUnquantized, width, height, 4, previewScale);
      result.gray.previewQuantized = await rawToPngBase64(grayRaw, width, height, 4, previewScale);
      try { fs.unlinkSync(filePath); } catch (e) {}
      return res.json(result);
    }

    // ============ 阶段 2：颜色量化（K-means）============
    // 构建调色盘
    const paletteRows = await query(`SELECT id, code, color_hex FROM products WHERE UPPER(SUBSTR(code,1,1)) NOT IN ('R','P','Y','T','Q') ORDER BY id LIMIT 512`);
    const palette = paletteRows.map((r) => {
      const rgb = hexToRgb(r.color_hex || '#CCCCCC');
      return { productId: r.id, code: r.code, hex: (r.color_hex || '#CCCCCC'), rgb, lab: rgbToLab(rgb), hsv: rgbToHsv(rgb) };
    });

    // 收集有效像素（处理透明 + 可选抠图）
    let bgMean = null, bgThresholdSq = 0;
    if (removeBg) {
      const borderSamples = [];
      const stepX = Math.max(1, Math.floor(width / 30)), stepY = Math.max(1, Math.floor(height / 30));
      for (let x = 0; x < width; x += stepX) {
        let idx = (0 * width + x) * channels; borderSamples.push([data[idx], data[idx+1], data[idx+2]]);
        idx = ((height - 1) * width + x) * channels; borderSamples.push([data[idx], data[idx+1], data[idx+2]]);
      }
      for (let y = 0; y < height; y += stepY) {
        let idx = (y * width + 0) * channels; borderSamples.push([data[idx], data[idx+1], data[idx+2]]);
        idx = (y * width + (width - 1)) * channels; borderSamples.push([data[idx], data[idx+1], data[idx+2]]);
      }
      const sum = borderSamples.reduce((s, p) => { s[0]+=p[0]; s[1]+=p[1]; s[2]+=p[2]; return s; }, [0,0,0]);
      const n = Math.max(1, borderSamples.length);
      bgMean = [Math.round(sum[0]/n), Math.round(sum[1]/n), Math.round(sum[2]/n)];
      let accDist = 0; for (const p of borderSamples) accDist += dist2(p, bgMean);
      bgThresholdSq = Math.max(900, Math.round((accDist/n) * 4));
    }

    const pixelMask = new Array(width * height).fill(true);
    const flatPixels = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        const a = channels >= 4 ? data[idx + 3] : 255;
        if (a < 16) { pixelMask[y * width + x] = false; continue; }
        let rr = data[idx], gg = data[idx+1], bb = data[idx+2];
        if (a < 255) { const al = a/255; rr = Math.round(rr*al+255*(1-al)); gg = Math.round(gg*al+255*(1-al)); bb = Math.round(bb*al+255*(1-al)); }
        if (removeBg && bgMean && dist2([rr,gg,bb], bgMean) <= bgThresholdSq) { pixelMask[y*width+x] = false; continue; }
        flatPixels.push([rr, gg, bb]);
      }
    }

    // 亮度优先分层量化（与主流程 lumaQuantize 一致）
    const runLumaQuantize = (dataArr, k, nl = 10) => {
      if (!dataArr || dataArr.length === 0) return { centers: [], labels: [] };
      const n = dataArr.length;
      k = Math.min(k, n);
      const w = 100 / nl;
      const pixLab = dataArr.map(rgbToLab);
      // 按 L* 等宽分桶
      const buckets = Array.from({ length: nl }, () => []);
      for (let i = 0; i < n; i++) {
        let bi = Math.min(nl - 1, Math.floor(pixLab[i][0] / w));
        if (bi < 0) bi = 0;
        buckets[bi].push(i);
      }
      // 每档分配簇数
      const activeBuckets = buckets.map((b, i) => ({ i, size: b.length })).filter(x => x.size > 0);
      const perBucket = {};
      for (const a of activeBuckets) perBucket[a.i] = 1;
      let remaining = k - activeBuckets.length;
      const sortedActive = [...activeBuckets].sort((a, b) => b.size - a.size);
      let oi = 0;
      while (remaining > 0 && sortedActive.length > 0) {
        perBucket[sortedActive[oi % sortedActive.length].i]++;
        remaining--; oi++;
      }
      // 档内 a*b* K-means
      const centers = [];
      const pixLabel = new Array(n).fill(-1);
      let nextId = 0;
      for (let bi = 0; bi < nl; bi++) {
        const bucketIdx = buckets[bi];
        if (bucketIdx.length === 0) continue;
        const kb = Math.min(perBucket[bi] || 1, bucketIdx.length);
        if (kb === 1) {
          let sr = 0, sg = 0, sb = 0;
          for (const idx of bucketIdx) { sr += dataArr[idx][0]; sg += dataArr[idx][1]; sb += dataArr[idx][2]; }
          const cnt = bucketIdx.length;
          centers.push([Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt)]);
          for (const idx of bucketIdx) pixLabel[idx] = nextId;
          nextId++;
          continue;
        }
        const ab = bucketIdx.map(idx => [pixLab[idx][1], pixLab[idx][2]]);
        const abOrder = ab.map((_, i) => i).sort((a, b) => ab[a][0] - ab[b][0] || ab[a][1] - ab[b][1]);
        let cents = [];
        for (let c = 0; c < kb; c++) cents.push(ab[abOrder[Math.min(ab.length - 1, Math.floor((c + 0.5) * ab.length / kb))]].slice());
        const subLabel = new Array(ab.length).fill(0);
        for (let iter = 0; iter < 20; iter++) {
          let moved = false;
          for (let i = 0; i < ab.length; i++) {
            let best = 0, bestD = Infinity;
            for (let j = 0; j < cents.length; j++) {
              const d = (ab[i][0] - cents[j][0]) ** 2 + (ab[i][1] - cents[j][1]) ** 2;
              if (d < bestD) { bestD = d; best = j; }
            }
            if (subLabel[i] !== best) { subLabel[i] = best; moved = true; }
          }
          const sums = cents.map(() => [0, 0]), counts = new Array(cents.length).fill(0);
          for (let i = 0; i < ab.length; i++) { sums[subLabel[i]][0] += ab[i][0]; sums[subLabel[i]][1] += ab[i][1]; counts[subLabel[i]]++; }
          for (let j = 0; j < cents.length; j++) { if (counts[j] > 0) { cents[j][0] = sums[j][0] / counts[j]; cents[j][1] = sums[j][1] / counts[j]; } }
          if (!moved) break;
        }
        for (let j = 0; j < cents.length; j++) {
          let sr = 0, sg = 0, sb = 0, cnt = 0;
          for (let i = 0; i < ab.length; i++) {
            if (subLabel[i] === j) { const idx = bucketIdx[i]; sr += dataArr[idx][0]; sg += dataArr[idx][1]; sb += dataArr[idx][2]; cnt++; }
          }
          if (cnt > 0) { centers.push([Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt)]); }
          else {
            let bsr = 0, bsg = 0, bsb = 0;
            for (const idx of bucketIdx) { bsr += dataArr[idx][0]; bsg += dataArr[idx][1]; bsb += dataArr[idx][2]; }
            const bcnt = bucketIdx.length;
            centers.push([Math.round(bsr / bcnt), Math.round(bsg / bcnt), Math.round(bsb / bcnt)]);
          }
          for (let i = 0; i < ab.length; i++) { if (subLabel[i] === j) pixLabel[bucketIdx[i]] = nextId; }
          nextId++;
        }
      }
      return { centers, labels: pixLabel };
    };

    let centers = [], labels = [];
    if (flatPixels.length > 0) {
      const res2 = runLumaQuantize(flatPixels, effectiveColorCount, 10);
      centers = res2.centers; labels = res2.labels;
    }

    // 量化后的预览图：把每个像素替换成所属簇的中心色
    const clusterLs = centers.map(c => rgbToLab(c)[0]);
    const lumaBandsCovered = new Set();
    for (const L of clusterLs) { const b = Math.floor(L / 10); if (b >= 0 && b < 10) lumaBandsCovered.add(b); }
    result.quantize = {
      inputPixels: flatPixels.length,
      requestedK: effectiveColorCount,
      actualClusters: centers.length,
      lumaBandsCovered: lumaBandsCovered.size, // 0-10，覆盖的亮度档数
      centers: centers.map((c, i) => {
        const cnt = labels.filter(l => l === i).length;
        const L = clusterLs[i];
        return { index: i, hex: rgbToHex(c[0], c[1], c[2]), rgb: c.slice(), count: cnt, L: Number(L.toFixed(1)) };
      }).sort((a, b) => a.L - b.L), // 按 L* 升序，方便看亮度分布
    };

    if (stage === 'quantize' || stage === 'all') {
      // 生成量化预览图
      const quantRaw = Buffer.alloc(width * height * 4);
      let li = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const pidx = (y * width + x) * 4;
          if (!pixelMask[y * width + x]) {
            quantRaw[pidx] = 255; quantRaw[pidx+1] = 255; quantRaw[pidx+2] = 255; quantRaw[pidx+3] = 0; // 透明
            continue;
          }
          const label = labels[li] ?? 0;
          const c = centers[label] || [204, 204, 204];
          quantRaw[pidx] = c[0]; quantRaw[pidx+1] = c[1]; quantRaw[pidx+2] = c[2]; quantRaw[pidx+3] = 255;
          li++;
        }
      }
      const previewScale = Math.max(1, Math.ceil(200 / Math.max(width, height)));
      result.quantize.preview = await rawToPngBase64(quantRaw, width, height, 4, previewScale);
    }

    if (stage === 'quantize') {
      try { fs.unlinkSync(filePath); } catch (e) {}
      return res.json(result);
    }

    // ============ 阶段 3：簇 → 物料映射 ============
    const centerToProduct = new Array(centers.length);
    for (let ci = 0; ci < centers.length; ci++) {
      const centerLab = rgbToLab(centers[ci]), centerHsv = rgbToHsv(centers[ci]);
      let bestPid = null, bestHex = rgbToHex(centers[ci][0], centers[ci][1], centers[ci][2]), bestDist = Infinity;
      let runnerUpPid = null, runnerUpDist = Infinity;
      for (const p of palette) {
        const d = matchDist(centerLab, centerHsv, p);
        if (d < bestDist) { runnerUpDist = bestDist; runnerUpPid = bestPid; bestDist = d; bestPid = p.productId; bestHex = p.hex; }
        else if (d < runnerUpDist) { runnerUpDist = d; runnerUpPid = p.productId; }
      }
      centerToProduct[ci] = { productId: bestPid, hex: bestHex };
    }

    // 构建映射详情表
    const mappingTable = centers.map((c, ci) => {
      const cnt = labels.filter(l => l === ci).length;
      const pal = palette.find(p => p.productId === centerToProduct[ci].productId);
      const centerLab = rgbToLab(c), centerHsv = rgbToHsv(c);
      return {
        clusterIndex: ci,
        clusterHex: rgbToHex(c[0], c[1], c[2]),
        clusterL: Number(centerLab[0].toFixed(1)),
        clusterH: Number(centerHsv[0].toFixed(0)),
        clusterS: Number(centerHsv[1].toFixed(2)),
        pixelCount: cnt,
        matchedCode: pal ? pal.code : null,
        matchedHex: centerToProduct[ci].hex,
        matchedProductId: centerToProduct[ci].productId,
      };
    }).sort((a, b) => b.pixelCount - a.pixelCount);

    // 检测塌并：多个簇映射到同一物料
    const byProduct = {};
    for (const m of mappingTable) {
      const key = m.matchedCode || 'null';
      (byProduct[key] = byProduct[key] || []).push(m);
    }
    const collisions = Object.entries(byProduct).filter(([k, arr]) => arr.length > 1).map(([code, arr]) => ({
      matchedCode: code, matchedHex: arr[0].matchedHex, clusterCount: arr.length, totalPixels: arr.reduce((s, x) => s + x.pixelCount, 0),
      clusters: arr.map(a => ({ hex: a.clusterHex, L: a.clusterL, pixels: a.pixelCount })),
    }));

    // 最终预览图
    const finalRaw = Buffer.alloc(width * height * 4);
    let li2 = 0;
    const statsMap = new Map();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pidx = (y * width + x) * 4;
        if (!pixelMask[y * width + x]) {
          finalRaw[pidx] = 255; finalRaw[pidx+1] = 255; finalRaw[pidx+2] = 255; finalRaw[pidx+3] = 0;
          continue;
        }
        const label = labels[li2] ?? 0;
        const mapped = centerToProduct[label] || { hex: '#CCCCCC' };
        const rgb = hexToRgb(mapped.hex);
        finalRaw[pidx] = rgb[0]; finalRaw[pidx+1] = rgb[1]; finalRaw[pidx+2] = rgb[2]; finalRaw[pidx+3] = 255;
        if (mapped.productId != null) statsMap.set(String(mapped.productId), (statsMap.get(String(mapped.productId)) || 0) + 1);
        li2++;
      }
    }
    const stats = [];
    for (const p of palette) { const cnt = statsMap.get(String(p.productId)) || 0; if (cnt > 0) stats.push({ productId: p.productId, code: p.code, hex: p.hex, count: cnt }); }
    stats.sort((a, b) => b.count - a.count);

    result.map = {
      clusters: centers.length,
      distinctMaterials: new Set(mappingTable.map(m => m.matchedProductId).filter(x => x != null)).size,
      mappingTable,
      collisions,
      stats,
    };
    const previewScale = Math.max(1, Math.ceil(200 / Math.max(width, height)));
    result.map.preview = await rawToPngBase64(finalRaw, width, height, 4, previewScale);

    try { fs.unlinkSync(filePath); } catch (e) {}
    res.json(result);
  } catch (error) {
    console.error('pixelate debug error', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


