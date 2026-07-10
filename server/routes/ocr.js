// 图纸物料网格 OCR 路由（后端 Node 跑 PaddleOCR V4 英文模型）
//
// 前端把拉正后的每格图片（base64）批量 POST 过来，后端用 onnxruntime-node 原生推理，
// 返回每格识别文本。这样前端不用加载 12MB 模型 + 编译 WASM，秒响应。
//
// 模型文件在 server/models/（det.onnx / rec.onnx / en_dict.txt），首次启动加载并缓存。

const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// 简单的鉴权（复用现有中间件）—— 网格 OCR 是登录后功能
const { authenticateToken } = require('../middleware/auth');
router.use(authenticateToken);

// ===== PaddleOcrService 单例（懒加载）=====
let ocrService = null;
let initPromise = null;
let initError = null;

async function getOcrService() {
  if (ocrService) return ocrService;
  if (initError) throw initError;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    console.log('[ocr] 初始化 PaddleOCR V4 英文模型...');
    // ppu-paddle-ocr 是 ESM，用动态 import
    const { PaddleOcrService } = await import('ppu-paddle-ocr');
    const modelsDir = path.join(__dirname, '..', 'models');
    // 校验模型文件存在
    const detPath = path.join(modelsDir, 'det.onnx');
    const recPath = path.join(modelsDir, 'rec.onnx');
    const dictPath = path.join(modelsDir, 'en_dict.txt');
    for (const p of [detPath, recPath, dictPath]) {
      if (!fs.existsSync(p)) {
        throw new Error('模型文件缺失: ' + p);
      }
    }
    // 用本地文件绝对路径（ppu-paddle-ocr 内部 readFileSync 直接读）
    const t0 = Date.now();
    ocrService = new PaddleOcrService({
      model: {
        detection: detPath,
        recognition: recPath,
        charactersDictionary: dictPath,
      },
    });
    await ocrService.initialize();
    console.log(`[ocr] PaddleOCR 初始化完成，耗时 ${Date.now() - t0}ms`);
    return ocrService;
  })();
  try {
    return await initPromise;
  } catch (e) {
    initError = e;
    initPromise = null;
    throw e;
  }
}

// 启动时预加载（不阻塞服务器启动，后台初始化）
getOcrService().catch((e) => {
  console.error('[ocr] 启动预加载失败（首次请求时会重试）:', e.message);
  initPromise = null;
});

/**
 * base64 dataUrl → ArrayBuffer
 * 注意：PaddleOcrService.recognize 要求 ArrayBuffer（不是 Node Buffer）。
 * Buffer 是 Uint8Array 的子类，recognize 内部会走 image.getContext 分支导致报错，
 * 所以必须返回真正的 ArrayBuffer（buffer.buffer 的对应切片）。
 */
function dataUrlToArrayBuffer(dataUrl) {
  const m = dataUrl.match(/^data:image\/\w+;base64,(.*)$/);
  if (!m) throw new Error('invalid dataUrl');
  const buf = Buffer.from(m[1], 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * 物料代码格式规范化：单字母 + 2位数字（D5→D05）。
 * 与前端 normalizeCode 保持一致。
 */
function normalizeCode(raw) {
  let s = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  const letterToDigit = { O: '0', S: '5', I: '1', B: '8', Z: '2', G: '6' };
  const digitToLetter = { '0': 'D', '5': 'S', '1': 'I', '8': 'B', '2': 'Z', '6': 'G' };

  const tryExtract = (str) => {
    const m = str.match(/([A-Z]+)(\d+)/);
    if (!m) return '';
    let letters = m[1];
    let digits = m[2];
    if (letters.length > 1) letters = letters.slice(-1);
    digits = digits.replace(/[OSIBZG]/g, (ch) => letterToDigit[ch] || ch);
    return letters + digits;
  };
  const padDigits = (code) => {
    const m = code.match(/^([A-Z]+)(\d+)$/);
    if (!m) return code;
    let letters = m[1];
    if (letters.length > 1) letters = letters.slice(-1);
    let digits = m[2];
    if (digits.length === 1) digits = '0' + digits;
    else if (digits.length > 2) digits = digits.slice(0, 2);
    return letters + digits;
  };

  let best = tryExtract(s);
  if (best) return padDigits(best);
  if (/^\d/.test(s) && digitToLetter[s[0]]) {
    best = tryExtract(digitToLetter[s[0]] + s.slice(1));
    if (best) return padDigits(best);
  }
  return '';
}

const CODE_REGEX = /^[A-Z]\d{2}$/;

/**
 * 批量识别接口
 * POST /api/ocr/cells
 * body: { cells: [{ row, col, dataUrl }] }
 * 返回: { results: [{ row, col, text, code }] }
 */
router.post('/cells', async (req, res) => {
  try {
    const cells = req.body && req.body.cells;
    if (!Array.isArray(cells) || cells.length === 0) {
      return res.status(400).json({ error: '缺少 cells 数组' });
    }
    if (cells.length > 5000) {
      return res.status(400).json({ error: '格子数过多（上限 5000）' });
    }

    const service = await getOcrService();

    // 顺序识别（onnxruntime 单 session 并发不安全；逐格很快 ~20ms）
    const results = [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      let text = '';
      try {
        const ab = dataUrlToArrayBuffer(cell.dataUrl);
        const r = await service.recognize(ab, { strategy: 'per-box' });
        text = (r && r.text ? r.text : '').trim();
      } catch (e) {
        text = '';
      }
      const code = normalizeCode(text);
      results.push({ row: cell.row, col: cell.col, text, code: CODE_REGEX.test(code) ? code : '' });
    }

    res.json({ results });
  } catch (error) {
    console.error('[ocr] /cells 失败:', error);
    res.status(500).json({ error: error.message || 'OCR 识别失败' });
  }
});

/**
 * 健康检查 / 状态查询（前端可据此判断后端 OCR 是否就绪）
 * GET /api/ocr/status
 */
router.get('/status', (req, res) => {
  res.json({ ready: !!ocrService, loading: !!initPromise && !ocrService });
});

module.exports = router;
