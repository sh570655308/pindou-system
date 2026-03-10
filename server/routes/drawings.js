const express = require('express');
const { query, get, run } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { upload, deleteFile } = require('../utils/fileUpload');
const { drawingsDir } = require('../database');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const os = require('os');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');

const router = express.Router();

// OCR API配置（从环境变量读取）
// DeepSeek-OCR API（硅基流动）- 主要使用
const DEEPSEEK_API_KEY = process.env.OCR_API_KEY || '';
const DEEPSEEK_API_URL = process.env.OCR_API_URL || 'https://api.siliconflow.cn/v1';

// OCR.space API - 备用（可选）
const OCR_API_KEY = process.env.OCR_SPACE_API_KEY || '';
const OCR_API_URL = 'https://api.ocr.space/parse/image';

// 需要认证
router.use(authenticateToken);

// multer instance for meta uploads (memory storage)
const metaUpload = multer();

// 列表：分页查询当前用户的图纸
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search ? req.query.search.toString().trim() : null;
    const statuses = req.query.status ? (Array.isArray(req.query.status) ? req.query.status : [req.query.status]) : [];
    const folderId = req.query.folder_id !== undefined ? parseInt(req.query.folder_id) : null;

    // 构建WHERE条件
    let whereConditions = ['d.user_id = ?'];
    let params = [userId];

    // 添加搜索条件（按标题搜索）
    if (search && search.length > 0) {
      whereConditions.push('d.title LIKE ?');
      params.push(`%${search}%`);
    }

    // 添加状态筛选条件
    if (statuses.length > 0) {
      const placeholders = statuses.map(() => '?').join(',');
      whereConditions.push(`d.status IN (${placeholders})`);
      params.push(...statuses);
    }

    // 添加目录筛选条件
    if (folderId !== null && !isNaN(folderId)) {
      whereConditions.push('d.folder_id = ?');
      params.push(folderId);
    }

    const whereClause = whereConditions.join(' AND ');

    // 查询图纸列表（优先使用缩略图，没有则使用原图）
    const rows = await query(
      `SELECT
         d.id, d.title, d.description, d.width, d.height, d.status, d.shared, d.pending_quantity, d.created_at, d.updated_at,
         (SELECT COALESCE(di.thumbnail_path, di.file_path) FROM drawing_images di WHERE di.drawing_id = d.id ORDER BY CASE WHEN di.image_type='blueprint' THEN 0 WHEN di.image_type='completion' THEN 1 ELSE 2 END, di.sort_order LIMIT 1) as thumbnail
       FROM drawings d
       WHERE ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // 获取总数
    const countResult = await get(`SELECT COUNT(*) as total FROM drawings d WHERE ${whereClause}`, params);
    const total = countResult ? countResult.total : 0;

    res.json({ data: rows, total: total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有图纸（用于下拉选择框，不分页）
router.get('/all', async (req, res) => {
  try {
    const userId = req.user.id;
    const rows = await query(
      `SELECT d.id, d.title, d.status, d.created_at, d.pending_quantity,
              (SELECT COALESCE(di.thumbnail_path, di.file_path) FROM drawing_images di WHERE di.drawing_id = d.id ORDER BY CASE WHEN di.image_type='blueprint' THEN 0 WHEN di.image_type='completion' THEN 1 ELSE 2 END, di.sort_order LIMIT 1) as thumbnail
       FROM drawings d
       WHERE d.user_id = ?
       ORDER BY d.created_at DESC`,
      [userId]
    );
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 列出所有被分享的图纸（用于导入选择）
router.get('/shared', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const rows = await query(
      `SELECT d.id, d.user_id, d.title, d.description, d.status, d.created_at,
              (SELECT COALESCE(di.thumbnail_path, di.file_path) FROM drawing_images di WHERE di.drawing_id = d.id ORDER BY CASE WHEN di.image_type='blueprint' THEN 0 WHEN di.image_type='completion' THEN 1 ELSE 2 END, di.sort_order LIMIT 1) as thumbnail,
              u.username
       FROM drawings d
       JOIN users u ON u.id = d.user_id
       WHERE d.shared = 1
       ORDER BY d.created_at DESC
       LIMIT ?`,
      [limit]
    );
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 详情：包含图片、材料清单与计算价格（基于用户库存单价）
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const drawing = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!drawing) return res.status(404).json({ error: '图纸未找到' });

    const images = await query(
      `SELECT id, file_path, file_name, mime_type, image_type, sort_order, created_at
       FROM drawing_images WHERE drawing_id = ? ORDER BY sort_order, created_at`,
      [drawingId]
    );

    // materials include user inventory quantity and in-transit quantity (orders)
    // Use a subselect that joins orders to products by code -> product id to avoid mismatches.
    const materials = await query(
      `SELECT dm.product_id, dm.quantity, p.code, p.color_code, COALESCE(ui.unit_price, 0) as unit_price,
              COALESCE(ui.quantity, 0) as inventory_qty,
              COALESCE((
                SELECT COALESCE(SUM(o.quantity), 0)
                FROM orders o
                JOIN products p2 ON p2.code = o.product_code
                WHERE o.user_id = ? AND p2.id = p.id AND o.status = 'in_transit'
              ), 0) as in_transit_qty
       FROM drawing_materials dm
       JOIN products p ON dm.product_id = p.id
       LEFT JOIN user_inventory ui ON ui.product_id = dm.product_id AND ui.user_id = ?
       WHERE dm.drawing_id = ?
       ORDER BY dm.sort_order`,
      [userId, userId, drawingId]
    );

    // 计算总价格
    let totalPrice = 0;
    materials.forEach((m) => {
      totalPrice += (m.unit_price || 0) * (m.quantity || 0);
    });

    // 获取用户的单个物料售价设置
    const unitPriceResult = await get(
      `SELECT value FROM settings WHERE key = ?`,
      [`user_unit_price_per_material_${userId}`]
    );
    const defaultPriceResult = await get(
      `SELECT value FROM settings WHERE key = 'default_unit_price_per_material'`
    );
    const unitPricePerMaterial = unitPriceResult
      ? parseFloat(unitPriceResult.value)
      : parseFloat(defaultPriceResult?.value || '0.01');

    // 计算总物料数量
    const totalMaterialQuantity = materials.reduce((sum, m) => sum + (m.quantity || 0), 0);

    // 计算参考售价 = 总物料数量 × 单个物料售价
    const referenceSalesPrice = totalMaterialQuantity * unitPricePerMaterial;

    res.json({
      drawing,
      images,
      materials,
      price: totalPrice,
      referenceSalesPrice,
      totalMaterialQuantity
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建图纸（仅需 title，其他可后续修改）
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, description, difficulty, estimated_time, width, height, status, shared, materials } = req.body;
    if (!title || title.trim() === '') {
      return res.status(400).json({ error: '名称（title）为必填项' });
    }
    const result = await run(
      `INSERT INTO drawings (user_id, title, description, difficulty, estimated_time, width, height, status, shared)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, title, description || null, difficulty || 1, estimated_time || null, width || null, height || null, status || 'draft', shared ? 1 : 0]
    );
    const newId = result.id;
    // 如果包含材料清单，则写入 drawing_materials
    if (Array.isArray(materials) && materials.length > 0) {
      for (let i = 0; i < materials.length; i++) {
        const m = materials[i];
        if (!m.product_id || !m.quantity) continue;
        try {
          await run(
            `INSERT INTO drawing_materials (drawing_id, product_id, quantity, sort_order) VALUES (?, ?, ?, ?)`,
            [newId, m.product_id, m.quantity, i]
          );
        } catch (e) {
          // 忽略唯一约束等错误，继续插入剩余项
        }
      }
    }
    const newDrawing = await get(`SELECT * FROM drawings WHERE id = ?`, [newId]);
    res.status(201).json({ drawing: newDrawing });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新图纸及材料清单（materials: [{ product_id, quantity }])
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const exists = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!exists) return res.status(404).json({ error: '图纸未找到或无权限' });

    const { title, description, difficulty, estimated_time, width, height, status, shared, folder_id, materials } = req.body;

    // 验证 folder_id 是否存在且属于当前用户
    if (folder_id !== undefined && folder_id !== null) {
      const folderExists = await get(`SELECT id FROM drawing_folders WHERE id = ? AND user_id = ?`, [folder_id, userId]);
      if (!folderExists) {
        return res.status(400).json({ error: '指定的目录不存在或无权限' });
      }
    }

    // 记录旧状态以判断是否触发消耗
    const oldStatus = exists.status;
    // 更新基本信息
    await run(
      `UPDATE drawings SET title = COALESCE(?, title),
        description = COALESCE(?, description),
        difficulty = COALESCE(?, difficulty),
        estimated_time = COALESCE(?, estimated_time),
        width = COALESCE(?, width),
        height = COALESCE(?, height),
        status = COALESCE(?, status),
        shared = COALESCE(?, shared),
        folder_id = COALESCE(?, folder_id),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [title, description, difficulty, estimated_time, width, height, status, (shared === undefined ? null : (shared ? 1 : 0)), folder_id, drawingId]
    );

    // 更新材料清单（替换策略）
    // 如果materials是undefined或null，不更新材料清单；如果是数组（包括空数组），则更新
    if (materials !== undefined && materials !== null) {
      if (Array.isArray(materials)) {
        console.log(`[drawings] 开始更新材料清单，图纸ID: ${drawingId}, 材料数量: ${materials.length}`);
        console.log('[drawings] 接收到的材料数据:', JSON.stringify(materials, null, 2));

        // 去重：按 product_id 去重，保留最后出现的（用户可能是手动修改了数量）
        const uniqueMaterials = [];
        const seenProductIds = new Set();
        for (let i = materials.length - 1; i >= 0; i--) {
          const m = materials[i];
          if (!m.product_id || !m.quantity) continue;
          if (!seenProductIds.has(m.product_id)) {
            seenProductIds.add(m.product_id);
            uniqueMaterials.unshift(m);
          }
        }

        console.log(`[drawings] 去重后的材料数量: ${uniqueMaterials.length} (原始: ${materials.length})`);

        // 批量验证所有 product_id（一次查询代替 N 次查询）
        const invalidProducts = [];
        if (uniqueMaterials.length > 0) {
          const productIds = uniqueMaterials.map(m => m.product_id);
          const placeholders = productIds.map(() => '?').join(',');
          const existingProducts = await query(
            `SELECT id FROM products WHERE id IN (${placeholders})`,
            productIds
          );
          const existingIds = new Set(existingProducts.map(p => p.id));

          // 找出无效的 product_id
          uniqueMaterials.forEach((m, i) => {
            if (m.product_id && !existingIds.has(m.product_id)) {
              // 查找原始索引（在去重前的数组中）
              const originalIndex = materials.findIndex(
                (om, oi) => om.product_id === m.product_id && oi === materials.lastIndexOf(om)
              );
              invalidProducts.push({ index: originalIndex >= 0 ? originalIndex : i, product_id: m.product_id });
            }
          });
        }

        if (invalidProducts.length > 0) {
          return res.status(400).json({
            error: '材料清单中存在无效的产品ID',
            invalidProducts
          });
        }

        // 获取现有材料清单，用于增量更新
        const existingMaterials = await query(
          `SELECT product_id, quantity, sort_order FROM drawing_materials WHERE drawing_id = ?`,
          [drawingId]
        );
        const existingMap = new Map(existingMaterials.map(m => [m.product_id, { quantity: m.quantity, sort_order: m.sort_order }]));
        const newMap = new Map(uniqueMaterials.map((m, i) => [m.product_id, { quantity: m.quantity, sort_order: i }]));

        // 计算差异：toDelete, toInsert, toUpdate
        const toDelete = [];
        const toInsert = [];
        const toUpdate = [];

        // 找出需要删除的（存在旧数据但不在新数据中）
        for (const [productId] of existingMap) {
          if (!newMap.has(productId)) {
            toDelete.push(productId);
          }
        }

        // 找出需要插入或更新的（包括数量变化或排序变化）
        for (const [productId, data] of newMap) {
          if (!existingMap.has(productId)) {
            toInsert.push({ product_id: productId, quantity: data.quantity, sort_order: data.sort_order });
          } else {
            const existing = existingMap.get(productId);
            // 检查数量或排序顺序是否变化
            if (existing.quantity !== data.quantity || existing.sort_order !== data.sort_order) {
              toUpdate.push({ product_id: productId, quantity: data.quantity, sort_order: data.sort_order });
            }
          }
        }

        console.log(`[drawings] 增量更新: 删除 ${toDelete.length}, 插入 ${toInsert.length}, 更新 ${toUpdate.length}`);

        // 执行增量更新
        // 1. 删除不再需要的材料
        if (toDelete.length > 0) {
          const deletePlaceholders = toDelete.map(() => '?').join(',');
          await run(
            `DELETE FROM drawing_materials WHERE drawing_id = ? AND product_id IN (${deletePlaceholders})`,
            [drawingId, ...toDelete]
          );
          console.log(`[drawings] 已删除 ${toDelete.length} 条材料记录`);
        }

        // 2. 插入新材料
        for (const m of toInsert) {
          await run(
            `INSERT INTO drawing_materials (drawing_id, product_id, quantity, sort_order) VALUES (?, ?, ?, ?)`,
            [drawingId, m.product_id, m.quantity, m.sort_order]
          );
        }
        if (toInsert.length > 0) {
          console.log(`[drawings] 已插入 ${toInsert.length} 条新材料记录`);
        }

        // 3. 更新已有材料的数量
        for (const m of toUpdate) {
          await run(
            `UPDATE drawing_materials SET quantity = ?, sort_order = ? WHERE drawing_id = ? AND product_id = ?`,
            [m.quantity, m.sort_order, drawingId, m.product_id]
          );
        }
        if (toUpdate.length > 0) {
          console.log(`[drawings] 已更新 ${toUpdate.length} 条材料记录`);
        }

        // 如果没有任何变化，记录日志
        if (toDelete.length === 0 && toInsert.length === 0 && toUpdate.length === 0) {
          console.log(`[drawings] 材料清单无变化，跳过数据库更新`);
        }
      }
    }


    // 返回最新详情（含价格计算）
    const updated = await get(`SELECT * FROM drawings WHERE id = ?`, [drawingId]);
    res.json({ drawing: updated });
  } catch (error) {
    console.error('更新图纸失败:', error);
    console.error('错误详情:', {
      drawingId: req.params.id,
      userId: req.user?.id,
      body: req.body,
      errorMessage: error.message,
      errorStack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// 更新图纸的 pending_quantity（待拼数量）
router.patch('/:id/pending-quantity', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const { pending_quantity } = req.body;
    if (pending_quantity === undefined || pending_quantity === null) {
      return res.status(400).json({ error: 'pending_quantity 为必填项' });
    }
    const parsed = parseInt(pending_quantity);
    if (isNaN(parsed) || parsed < 1) {
      return res.status(400).json({ error: 'pending_quantity 必须为大于等于1的整数' });
    }
    const exists = await get(`SELECT id FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!exists) return res.status(404).json({ error: '图纸未找到或无权限' });

    await run(`UPDATE drawings SET pending_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [parsed, drawingId]);

    const updated = await get(`SELECT * FROM drawings WHERE id = ?`, [drawingId]);
    res.json({ drawing: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 上传图片：每次上传增加一张图片
router.post('/:id/images', upload.fields([{ name: 'blueprint', maxCount: 1 }]), async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const exists = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!exists) return res.status(404).json({ error: '图纸未找到或无权限' });

    const files = req.files || {};

    // Check for existing blueprint
    const existingBlueprint = await get(`SELECT * FROM drawing_images WHERE drawing_id = ? AND image_type = 'blueprint' LIMIT 1`, [drawingId]);
    const uploadingBlueprint = files.blueprint && files.blueprint.length > 0;

    console.log(`[drawings] user ${userId} uploading image to drawing ${drawingId} - blueprint:${uploadingBlueprint}`);
    // 处理 blueprint：如果已有 blueprint，则作为 completion 插入，否则作为 blueprint
    if (uploadingBlueprint) {
      const f = files.blueprint[0];
      const filePath = `${drawingId}/${f.filename}`;
      const fullPath = path.join(drawingsDir, filePath);

      // 生成缩略图（150x150，保持比例，填充到正方形）
      let thumbnailPath = null;
      try {
        const thumbnailFilename = `thumb_${f.filename}`;
        const thumbnailFullPath = path.join(drawingsDir, drawingId, thumbnailFilename);

        await sharp(fullPath)
          .resize(150, 150, {
            fit: 'cover',
            position: 'center'
          })
          .jpeg({ quality: 80 })
          .toFile(thumbnailFullPath);

        thumbnailPath = `${drawingId}/${thumbnailFilename}`;
        console.log(`[drawings] generated thumbnail: ${thumbnailPath}`);
      } catch (thumbErr) {
        console.error(`[drawings] failed to generate thumbnail:`, thumbErr.message);
        // 缩略图生成失败不影响主流程
      }

      if (existingBlueprint) {
        // 插入为 completion（保留已有 blueprint），按当前数量设定 sort_order
        const countRow = await get(`SELECT COUNT(*) as cnt FROM drawing_images WHERE drawing_id = ?`, [drawingId]);
        let sortBase = countRow ? countRow.cnt : 0;
        await run(
          `INSERT INTO drawing_images (drawing_id, file_path, file_name, file_size, mime_type, image_type, sort_order, thumbnail_path)
           VALUES (?, ?, ?, ?, ?, 'completion', ?, ?)`,
          [drawingId, filePath, f.originalname, f.size, f.mimetype, sortBase, thumbnailPath]
        );
      } else {
        // 没有 blueprint，插入为 blueprint（sort_order 0）
        await run(
          `INSERT INTO drawing_images (drawing_id, file_path, file_name, file_size, mime_type, image_type, sort_order, thumbnail_path)
           VALUES (?, ?, ?, ?, ?, 'blueprint', 0, ?)`,
          [drawingId, filePath, f.originalname, f.size, f.mimetype, thumbnailPath]
        );
      }
    }
    console.log(`[drawings] upload complete for drawing ${drawingId}`);

    res.json({ message: '上传成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 保存像素化元数据（JSON 或 gzipped JSON），字段可为 pixel_meta 或 pixel_meta_gz
router.post('/:id/meta', metaUpload.fields([{ name: 'pixel_meta', maxCount: 1 }, { name: 'pixel_meta_gz', maxCount: 1 }]), async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const drawing = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!drawing) return res.status(404).json({ error: '图纸未找到或无权限' });

    const files = req.files || {};
    let buffer = null;
    let isGz = false;
    if (files.pixel_meta_gz && files.pixel_meta_gz.length > 0) {
      buffer = files.pixel_meta_gz[0].buffer;
      isGz = true;
    } else if (files.pixel_meta && files.pixel_meta.length > 0) {
      buffer = files.pixel_meta[0].buffer;
      isGz = false;
    } else {
      return res.status(400).json({ error: '缺少 pixel_meta 或 pixel_meta_gz 上传字段' });
    }

    // 保存到 drawings 目录下的 meta 文件（保持原始二进制，如果是 gz 则保持 gz）
    const destDir = path.join(drawingsDir, String(drawingId));
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const outPath = path.join(destDir, isGz ? 'pixelate_meta.json.gz' : 'pixelate_meta.json');
    fs.writeFileSync(outPath, buffer);
    console.log(`[drawings] saved pixelate meta for drawing ${drawingId} -> ${outPath}`);

    res.json({ ok: true });
  } catch (err) {
    console.error('save meta failed', err);
    res.status(500).json({ error: err.message || 'save meta failed' });
  }
});

// 读取像素化元数据（若存在）
router.get('/:id/meta', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const drawing = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!drawing) return res.status(404).json({ error: '图纸未找到或无权限' });

    const destDir = path.join(drawingsDir, String(drawingId));
    const gzPath = path.join(destDir, 'pixelate_meta.json.gz');
    const jsonPath = path.join(destDir, 'pixelate_meta.json');
    if (fs.existsSync(gzPath)) {
      const buf = fs.readFileSync(gzPath);
      // return gzipped buffer with appropriate header so client can gunzip if desired
      res.setHeader('Content-Type', 'application/gzip');
      res.send(buf);
      return;
    } else if (fs.existsSync(jsonPath)) {
      const content = fs.readFileSync(jsonPath, 'utf8');
      return res.json({ meta: JSON.parse(content) });
    } else {
      return res.status(404).json({ error: '未找到像素化元数据' });
    }
  } catch (err) {
    console.error('read meta failed', err);
    res.status(500).json({ error: err.message || 'read meta failed' });
  }
});
// 删除指定图片
router.delete('/:id/images/:imageId', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const imageId = req.params.imageId;
    const exists = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!exists) return res.status(404).json({ error: '图纸未找到或无权限' });

    const img = await get(`SELECT * FROM drawing_images WHERE id = ? AND drawing_id = ?`, [imageId, drawingId]);
    if (!img) return res.status(404).json({ error: '图片未找到' });

    // 删除文件与记录
    await deleteFile(img.file_path);
    await run(`DELETE FROM drawing_images WHERE id = ?`, [imageId]);
    console.log(`[drawings] user ${userId} deleted image ${imageId} from drawing ${drawingId}`);
    res.json({ message: '图片删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 将某张图片设为缩略图（blueprint），其他图片设为 completion
router.put('/:id/images/:imageId/select', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const imageId = req.params.imageId;
    const exists = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!exists) return res.status(404).json({ error: '图纸未找到或无权限' });

    const img = await get(`SELECT * FROM drawing_images WHERE id = ? AND drawing_id = ?`, [imageId, drawingId]);
    if (!img) return res.status(404).json({ error: '图片未找到' });

    // set all to completion first
    await run(`UPDATE drawing_images SET image_type = 'completion' WHERE drawing_id = ?`, [drawingId]);
    // set selected to blueprint and sort_order 0
    await run(`UPDATE drawing_images SET image_type = 'blueprint', sort_order = 0 WHERE id = ?`, [imageId]);
    console.log(`[drawings] user ${userId} set image ${imageId} as thumbnail for drawing ${drawingId}`);
    res.json({ message: '已设为缩略图' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除整张图纸（含图片与材料清单等）--- 需要二次确认由客户端确认后调用
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const exists = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!exists) return res.status(404).json({ error: '图纸未找到或无权限' });

    // 删除文件目录
    const { deleteDirectory } = require('../utils/fileUpload');
    await deleteDirectory(drawingId.toString());

    // 删除数据库记录（ON DELETE CASCADE 会处理 images/materials)
    await run(`DELETE FROM drawings WHERE id = ?`, [drawingId]);
    console.log(`[drawings] user ${userId} deleted drawing ${drawingId}`);
    res.json({ message: '图纸删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 导出图纸为压缩包（包含 BOM 清单与图片）
router.get('/:id/export', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const drawing = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!drawing) return res.status(404).json({ error: '图纸未找到' });

    const images = await query(
      `SELECT id, file_path, file_name, mime_type, image_type, sort_order FROM drawing_images WHERE drawing_id = ? ORDER BY sort_order, created_at`,
      [drawingId]
    );

    const materials = await query(
      `SELECT dm.quantity, p.code FROM drawing_materials dm JOIN products p ON dm.product_id = p.id WHERE dm.drawing_id = ? ORDER BY dm.sort_order`,
      [drawingId]
    );

    const safeTitle = (drawing.title || '').replace(/[\/\\:?<>|\"*]/g, '').replace(/\s+/g, '_');
    const zipName = `${drawingId}-${safeTitle}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('archiver error', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    // BOM 清单（CSV）
    let bomCsv = 'product_code,quantity\n';
    materials.forEach((m) => {
      bomCsv += `${m.code || ''},${m.quantity || 0}\n`;
    });
    archive.append(bomCsv, { name: `${drawingId}-${safeTitle}-物料.csv` });

    // 添加图片文件
    let idx = 1;
    for (const img of images) {
      const fullPath = path.join(drawingsDir, img.file_path || '');
      if (fs.existsSync(fullPath)) {
        const ext = path.extname(img.file_name || fullPath) || path.extname(fullPath) || '';
        const typeLabel = img.image_type || '图纸';
        const entryName = `${drawingId}-${safeTitle}-${typeLabel}-${idx}${ext}`;
        archive.file(fullPath, { name: entryName });
        idx++;
      }
    }

    archive.finalize();
  } catch (error) {
    console.error('export error', error);
    res.status(500).json({ error: error.message });
  }
});

// 从共享图纸导入到当前用户账号：复制图纸记录、BOM 与图片文件
router.post('/:id/import', async (req, res) => {
  try {
    const userId = req.user.id;
    const srcId = req.params.id;
    // 只能导入被标记为 shared 的图纸
    const src = await get(`SELECT * FROM drawings WHERE id = ? AND shared = 1`, [srcId]);
    if (!src) return res.status(404).json({ error: '共享图纸未找到或不可导入' });

    // 创建新的图纸记录到当前用户（不继承 shared 标记）
    const result = await run(
      `INSERT INTO drawings (user_id, title, description, difficulty, estimated_time, width, height, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, src.title, src.description || null, src.difficulty || 1, src.estimated_time || null, src.width || null, src.height || null, src.status || 'draft']
    );
    const newId = result.id;

    // 复制材料清单
    const mats = await query(`SELECT product_id, quantity, sort_order FROM drawing_materials WHERE drawing_id = ? ORDER BY sort_order`, [srcId]);
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      try {
        await run(`INSERT INTO drawing_materials (drawing_id, product_id, quantity, sort_order) VALUES (?, ?, ?, ?)`, [newId, m.product_id, m.quantity, m.sort_order || i]);
      } catch (e) {
        // 忽略可能的约束冲突
      }
    }

    // 复制图片文件（若有），并写入 drawing_images
    const imgs = await query(`SELECT id, file_path, file_name, mime_type, image_type, sort_order FROM drawing_images WHERE drawing_id = ? ORDER BY sort_order, created_at`, [srcId]);
    if (imgs && imgs.length > 0) {
      const destDir = path.join(drawingsDir, String(newId));
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      for (const img of imgs) {
        try {
          const srcFull = path.join(drawingsDir, img.file_path || '');
          if (fs.existsSync(srcFull)) {
            // create a new filename to avoid collisions
            const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${img.file_name || path.basename(srcFull)}`;
            const destRel = `${newId}/${uniqueName}`;
            const destFull = path.join(drawingsDir, destRel);
            fs.copyFileSync(srcFull, destFull);
            await run(
              `INSERT INTO drawing_images (drawing_id, file_path, file_name, file_size, mime_type, image_type, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [newId, destRel, img.file_name || uniqueName, img.file_size || null, img.mime_type || null, img.image_type || 'completion', img.sort_order || 0]
            );
          }
        } catch (err) {
          console.error('复制图片失败', err);
        }
      }
    }

    const newDrawing = await get(`SELECT * FROM drawings WHERE id = ?`, [newId]);
    res.status(201).json({ message: '导入成功', drawing: newDrawing });
  } catch (error) {
    console.error('import error', error);
    res.status(500).json({ error: error.message });
  }
});

// 导入 BOM（CSV）到图纸（字段：大类,物料代码,数量）
const uploadCsv = multer({ dest: os.tmpdir() });
router.post('/:id/import-bom', uploadCsv.single('file'), async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const drawing = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!drawing) return res.status(404).json({ error: '图纸未找到或无权限' });
    if (!req.file) return res.status(400).json({ error: '缺少上传文件（字段名 file）' });

    const content = fs.readFileSync(req.file.path, 'utf8');
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const results = { imported: 0, skipped: 0, errors: [] };

    // 替换策略：先删除现有材料清单
    await run(`DELETE FROM drawing_materials WHERE drawing_id = ?`, [drawingId]);

    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      if (cols.length < 3) {
        results.skipped++;
        results.errors.push({ line: i + 1, reason: '字段数量不足', raw: lines[i] });
        continue;
      }
      const [categoryName, productCode, qtyStr] = cols;
      const quantity = parseInt(qtyStr || '0');
      if (!productCode) {
        results.skipped++;
        results.errors.push({ line: i + 1, reason: '物料代码为空', raw: lines[i] });
        continue;
      }

      // 查找产品
      const prod = await get(
        `SELECT p.id FROM products p JOIN categories c ON p.category_id = c.id WHERE p.code = ? AND c.name = ?`,
        [productCode, categoryName]
      );
      if (!prod) {
        // 尝试回退：仅按 code 匹配（忽略 category），并记录警告（兼容数据不严格的情况）
        const fallback = await get(`SELECT id FROM products WHERE code = ? LIMIT 1`, [productCode]);
        if (fallback) {
          prod = fallback;
          results.errors.push({ line: i + 1, reason: '未匹配到类别，已按代码回退匹配', raw: lines[i] });
        } else {
        results.skipped++;
        results.errors.push({ line: i + 1, reason: '未找到对应产品（category+code）', raw: lines[i] });
        continue;
        }
      }

      try {
        await run(
          `INSERT INTO drawing_materials (drawing_id, product_id, quantity, sort_order) VALUES (?, ?, ?, ?)`,
          [drawingId, prod.id, quantity || 0, i]
        );
        results.imported++;
      } catch (err) {
        results.skipped++;
        results.errors.push({ line: i + 1, reason: '插入失败', error: err.message, raw: lines[i] });
      }
    }

    // 删除临时文件
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({ message: '导入完成', result: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量导入 BOM（粘贴文本），请求体：{ lines: [ "A01,125,MARD", "B02,10" ] }
router.post('/:id/import-bom-bulk', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const drawing = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!drawing) return res.status(404).json({ error: '图纸未找到或无权限' });

    const lines = Array.isArray(req.body.lines) ? req.body.lines.map((l) => (l || '').toString().trim()).filter((l) => l.length > 0) : [];
    const overwrite = req.body.overwrite === true;
    if (lines.length === 0) return res.status(400).json({ error: '缺少要导入的行（lines）' });

    const results = { imported: 0, skipped: 0, errors: [] };

    // 计算默认大类：基于用户库存，按类别累计数量选择总量最多的大类名称
    const defaultCategoryRow = await get(
      `SELECT c.name, SUM(COALESCE(ui.quantity,0)) as total_qty
       FROM user_inventory ui
       JOIN products p ON ui.product_id = p.id
       JOIN categories c ON p.category_id = c.id
       WHERE ui.user_id = ?
       GROUP BY c.id
       ORDER BY total_qty DESC
       LIMIT 1`,
      [userId]
    );
    const defaultCategoryName = defaultCategoryRow ? defaultCategoryRow.name : null;

    // 如果是覆盖模式，先删除现有材料清单（overwrite = true）
    if (overwrite) {
      await run(`DELETE FROM drawing_materials WHERE drawing_id = ?`, [drawingId]);
    }

    // 逐行处理（追加或覆盖由 overwrite 决定）
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      if (cols.length < 2) {
        results.skipped++;
        results.errors.push({ line: i + 1, reason: '字段不足，需至少 code,quantity', raw: lines[i] });
        continue;
      }
      const productCode = cols[0];
      const qty = parseInt(cols[1] || '0') || 0;
      let categoryName = cols[2] || null;
      if (!categoryName) categoryName = defaultCategoryName;

      if (!productCode) {
        results.skipped++;
        results.errors.push({ line: i + 1, reason: '物料代码为空', raw: lines[i] });
        continue;
      }

      // 按 code+category 查找
      let prod = null;
      if (categoryName) {
        prod = await get(`SELECT p.id FROM products p JOIN categories c ON p.category_id = c.id WHERE p.code = ? AND c.name = ?`, [productCode, categoryName]);
      }
      if (!prod) {
        // 回退：仅按 code 匹配
        prod = await get(`SELECT id FROM products WHERE code = ? LIMIT 1`, [productCode]);
        if (prod) {
          results.errors.push({ line: i + 1, reason: '未匹配到类别，已按代码回退匹配', raw: lines[i] });
        } else {
          results.skipped++;
          results.errors.push({ line: i + 1, reason: '未找到对应产品', raw: lines[i] });
          continue;
        }
      }

      try {
        if (overwrite) {
          // 覆盖模式：直接插入（因为之前已删除现有记录）
          await run(
            `INSERT INTO drawing_materials (drawing_id, product_id, quantity, sort_order)
             VALUES (?, ?, ?, ?)`,
            [drawingId, prod.id, qty, i]
          );
        } else {
          // 追加模式：upsert 累加数量
          await run(
            `INSERT INTO drawing_materials (drawing_id, product_id, quantity, sort_order)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(drawing_id, product_id) DO UPDATE SET
               quantity = drawing_materials.quantity + excluded.quantity,
               sort_order = excluded.sort_order`,
            [drawingId, prod.id, qty, i]
          );
        }
        results.imported++;
      } catch (err) {
        results.skipped++;
        results.errors.push({ line: i + 1, reason: '插入/更新失败', error: err.message, raw: lines[i] });
      }
    }

    res.json({ message: '导入完成', result: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量移动图纸到目录
router.post('/batch-move', async (req, res) => {
  try {
    const userId = req.user.id;
    const { drawing_ids, target_folder_id } = req.body;

    if (!Array.isArray(drawing_ids) || drawing_ids.length === 0) {
      return res.status(400).json({ error: 'drawing_ids 必须是非空数组' });
    }

    // 验证目标目录是否存在且属于当前用户
    if (target_folder_id !== null && target_folder_id !== undefined) {
      const folder = await get(
        `SELECT id FROM drawing_folders WHERE id = ? AND user_id = ?`,
        [target_folder_id, userId]
      );
      if (!folder) {
        return res.status(400).json({ error: '目标目录不存在或无权限' });
      }
    }

    // 批量更新图纸的 folder_id
    const placeholders = drawing_ids.map(() => '?').join(',');
    const result = await run(
      `UPDATE drawings SET folder_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders}) AND user_id = ?`,
      [target_folder_id, ...drawing_ids, userId]
    );

    console.log(`[drawings] user ${userId} moved ${result.changes} drawings to folder ${target_folder_id}`);
    res.json({ message: '批量移动成功', moved_count: result.changes });
  } catch (error) {
    console.error('批量移动失败', error);
    res.status(500).json({ error: error.message });
  }
});

// 批量归档/取消归档图纸（通过修改 status 字段实现）
router.post('/batch-archive', async (req, res) => {
  try {
    const userId = req.user.id;
    const { drawing_ids, archived } = req.body;

    if (!Array.isArray(drawing_ids) || drawing_ids.length === 0) {
      return res.status(400).json({ error: 'drawing_ids 必须是非空数组' });
    }

    if (archived === undefined || archived === null) {
      return res.status(400).json({ error: 'archived 参数必填' });
    }

    // 归档：status = 'archived'，取消归档：status = 'recorded'
    const newStatus = archived ? 'archived' : 'recorded';

    // 批量更新图纸的 status
    const placeholders = drawing_ids.map(() => '?').join(',');
    const result = await run(
      `UPDATE drawings SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders}) AND user_id = ?`,
      [newStatus, ...drawing_ids, userId]
    );

    console.log(`[drawings] user ${userId} changed ${result.changes} drawings to status=${newStatus}`);
    res.json({ message: archived ? '批量归档成功' : '批量取消归档成功', updated_count: result.changes });
  } catch (error) {
    console.error('批量归档失败', error);
    res.status(500).json({ error: error.message });
  }
});

// 像素化并映射到物料颜色（前端期望的接口）
// GET /drawings/:id/pixelate?max_pixels=40
router.get('/:id/pixelate', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const drawing = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!drawing) return res.status(404).json({ error: '图纸未找到' });

    const imgRow = await get(`SELECT file_path FROM drawing_images WHERE drawing_id = ? AND image_type = 'blueprint' LIMIT 1`, [drawingId]);
    if (!imgRow || !imgRow.file_path) return res.status(400).json({ error: '未找到图纸图片（blueprint）' });

    const fullPath = path.join(drawingsDir, imgRow.file_path || '');
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '图纸文件不存在' });

    const maxPixels = parseInt(req.query.max_pixels || '40') || 40;

    // 读取并按最长边缩放到 maxPixels（保持纵横比），使用最近邻以保留像素效果
    const img = sharp(fullPath);
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

    // helper
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

    // 获取图纸关联的物料作为调色盘；若为空则退回到全部产品
    let paletteRows = await query(`SELECT p.id, p.code, p.color_hex FROM products p JOIN drawing_materials dm ON p.id = dm.product_id WHERE dm.drawing_id = ?`, [drawingId]);
    if (!paletteRows || paletteRows.length === 0) {
      paletteRows = await query(`SELECT id, code, color_hex FROM products ORDER BY id LIMIT 64`);
    }
    const palette = paletteRows.map((r) => {
      const rgb = hexToRgb(r.color_hex || '#CCCCCC');
      return { productId: r.id, code: r.code, hex: (r.color_hex || '#CCCCCC'), rgb };
    });

    // build pixel grid and map to nearest palette color
    const pixels = [];
    const statsMap = new Map();
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        // if alpha present, composite on white background roughly
        const a = channels >= 4 ? data[idx + 3] : 255;
        let rr = r, gg = g, bb = b;
        if (a < 255) {
          const alpha = a / 255;
          rr = Math.round(rr * alpha + 255 * (1 - alpha));
          gg = Math.round(gg * alpha + 255 * (1 - alpha));
          bb = Math.round(bb * alpha + 255 * (1 - alpha));
        }
        const hex = rgbToHex(rr, gg, bb);

        // find nearest palette color
        let bestPid = null;
        let bestDist = Infinity;
        for (const p of palette) {
          const d = dist2([rr, gg, bb], p.rgb);
          if (d < bestDist) {
            bestDist = d;
            bestPid = p.productId;
          }
        }
        row.push({ hex, productId: bestPid });
        const key = String(bestPid || 'null');
        statsMap.set(key, (statsMap.get(key) || 0) + 1);
      }
      pixels.push(row);
    }

    // build stats array
    const stats = [];
    for (const p of palette) {
      const cnt = statsMap.get(String(p.productId)) || 0;
      if (cnt > 0) stats.push({ productId: p.productId, code: p.code, hex: p.hex, count: cnt });
    }
    // sort desc
    stats.sort((a, b) => b.count - a.count);

    const total = width * height;
    res.json({ pixels, stats, total, width, height });
  } catch (error) {
    console.error('pixelate error', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== 目录管理 API ==========

// 获取目录树
router.get('/folders/tree', async (req, res) => {
  try {
    const userId = req.user.id;
    const folders = await query(
      `SELECT id, user_id, parent_id, name, color, icon, sort_order, created_at, updated_at
       FROM drawing_folders
       WHERE user_id = ?
       ORDER BY sort_order, name`,
      [userId]
    );

    // 构建树形结构
    const buildTree = (parentId) => {
      return folders
        .filter((f) => f.parent_id === parentId)
        .map((f) => ({
          ...f,
          children: buildTree(f.id)
        }));
    };

    const tree = buildTree(null);
    res.json({ data: tree });
  } catch (error) {
    console.error('获取目录树失败', error);
    res.status(500).json({ error: error.message });
  }
});

// 创建目录
router.post('/folders', async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, color, parent_id, icon } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: '目录名称为必填项' });
    }

    // 检查同级目录名称是否重复
    const existing = await get(
      `SELECT id FROM drawing_folders WHERE user_id = ? AND parent_id ${parent_id ? '= ?' : 'IS NULL'} AND name = ?`,
      parent_id ? [userId, parent_id, name.trim()] : [userId, name.trim()]
    );

    if (existing) {
      return res.status(400).json({ error: '同级目录下已存在相同名称' });
    }

    // 获取同级最大 sort_order
    const maxOrder = await get(
      `SELECT MAX(sort_order) as max_order FROM drawing_folders WHERE user_id = ? AND parent_id ${parent_id ? '= ?' : 'IS NULL'}`,
      parent_id ? [userId, parent_id] : [userId]
    );

    const newOrder = (maxOrder?.max_order || 0) + 1;

    const result = await run(
      `INSERT INTO drawing_folders (user_id, name, color, parent_id, icon, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, name.trim(), color || '#3B82F6', parent_id || null, icon || null, newOrder]
    );

    const newFolder = await get(`SELECT * FROM drawing_folders WHERE id = ?`, [result.id]);
    res.status(201).json({ data: newFolder });
  } catch (error) {
    console.error('创建目录失败', error);
    res.status(500).json({ error: error.message });
  }
});

// 更新目录
router.put('/folders/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const folderId = req.params.id;
    const { name, color, parent_id, icon } = req.body;

    // 检查目录是否存在且属于当前用户
    const folder = await get(`SELECT * FROM drawing_folders WHERE id = ? AND user_id = ?`, [folderId, userId]);
    if (!folder) {
      return res.status(404).json({ error: '目录未找到或无权限' });
    }

    // 检查同级目录名称是否重复
    if (name && name.trim() !== folder.name) {
      const existing = await get(
        `SELECT id FROM drawing_folders WHERE user_id = ? AND parent_id ${parent_id ? '= ?' : 'IS NULL'} AND name = ? AND id != ?`,
        parent_id ? [userId, parent_id, name.trim(), folderId] : [userId, name.trim(), folderId]
      );

      if (existing) {
        return res.status(400).json({ error: '同级目录下已存在相同名称' });
      }
    }

    // 检查不能将目录移动到自己的子目录下
    if (parent_id && parent_id !== folder.parent_id) {
      const checkChild = async (pid) => {
        if (pid === parseInt(folderId)) return true;
        const child = await get(`SELECT parent_id FROM drawing_folders WHERE id = ?`, [pid]);
        return child && child.parent_id ? await checkChild(child.parent_id) : false;
      };

      if (await checkChild(parent_id)) {
        return res.status(400).json({ error: '不能将目录移动到其子目录下' });
      }
    }

    await run(
      `UPDATE drawing_folders
       SET name = COALESCE(?, name),
           color = COALESCE(?, color),
           parent_id = COALESCE(?, parent_id),
           icon = COALESCE(?, icon),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name?.trim(), color || null, parent_id !== undefined ? parent_id : null, icon || null, folderId]
    );

    const updatedFolder = await get(`SELECT * FROM drawing_folders WHERE id = ?`, [folderId]);
    res.json({ data: updatedFolder });
  } catch (error) {
    console.error('更新目录失败', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除目录
router.delete('/folders/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const folderId = req.params.id;

    // 检查目录是否存在且属于当前用户
    const folder = await get(`SELECT * FROM drawing_folders WHERE id = ? AND user_id = ?`, [folderId, userId]);
    if (!folder) {
      return res.status(404).json({ error: '目录未找到或无权限' });
    }

    // 将该目录下的图纸移动到未分类（folder_id 设为 null）
    await run(
      `UPDATE drawings SET folder_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE folder_id = ?`,
      [folderId]
    );

    // 删除目录（CASCADE 会自动处理子目录）
    await run(`DELETE FROM drawing_folders WHERE id = ?`, [folderId]);

    console.log(`[drawings] user ${userId} deleted folder ${folderId}`);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除目录失败', error);
    res.status(500).json({ error: error.message });
  }
});

// 解析DeepSeek-OCR的返回格式（支持边界框坐标和行判断）
function parseDeepSeekOCR(text) {
  const materials = [];

  console.log('[drawings] 检测到DeepSeek-OCR格式，使用结构化解析');

  // 提取所有<|ref|>和<|det|>的内容（包括坐标）
  const pattern = /<\|ref\|>(.*?)<\|\/ref\|><\|det\|>\[\[(\d+),\s*(\d+),\s*\d+,\s*\d+\]\]<\|\/det\|>/g;
  const matches = [...text.matchAll(pattern)];

  if (matches.length === 0) {
    console.log('[drawings] DeepSeek-OCR格式解析失败：未找到匹配项');
    return materials;
  }

  console.log(`[drawings] DeepSeek-OCR识别到 ${matches.length} 个文本块`);

  // 按y坐标分组（判断行）
  const rows = [];

  for (const match of matches) {
    const content = match[1].trim();
    const x = parseInt(match[2]);
    const y = parseInt(match[3]);

    // 判断所属行（y坐标相近的为一行，容差30px）
    let rowIndex = rows.findIndex(row => Math.abs(row.y - y) < 30);

    if (rowIndex === -1) {
      rowIndex = rows.length;
      rows.push({ y, items: [] });
    }

    rows[rowIndex].items.push({ content, x, y });
  }

  console.log(`[drawings] 文本分为 ${rows.length} 行`);

  // 按x坐标排序每一行内的项目
  rows.forEach(row => {
    row.items.sort((a, b) => a.x - b.x);
  });

  // 按y坐标排序行
  rows.sort((a, b) => a.y - b.y);

  // 检查是否有同一行内包含代码和括号数量的格式（如 A11 (19)）
  const hasInlineFormat = rows.some(row => {
    const items = row.items;
    for (let i = 0; i < items.length - 1; i++) {
      const isCode = /^[A-Z]+\d+$/.test(items[i].content);
      const isQuantity = /^\(\d+\)$/.test(items[i + 1].content);
      if (isCode && isQuantity) {
        return true;
      }
    }
    return false;
  });

  console.log(`[drawings] 格式检测: ${hasInlineFormat ? '内联格式 (A11 (19))' : '分行格式'}`);

  if (hasInlineFormat) {
    // 格式1: 同一行内代码和括号配对 (A11 (19))
    rows.forEach(row => {
      for (let i = 0; i < row.items.length - 1; i++) {
        const currentItem = row.items[i];
        const nextItem = row.items[i + 1];

        let code = currentItem.content;
        const quantityText = nextItem.content;

        // OCR修正
        code = code.replace(/^6(\d)/, 'G$1');
        code = code.replace(/^0(\d)/, 'O$1');

        // 验证格式
        const isCode = /^[A-Z]+\d+$/.test(code);
        const isQuantity = /^\((\d+)\)$/.test(quantityText);

        if (isCode && isQuantity) {
          const quantityMatch = quantityText.match(/^\((\d+)\)$/);
          materials.push({
            name: code,
            code: code,
            color_name: '',
            quantity: parseInt(quantityMatch[1]) || 1
          });
          console.log(`[drawings] ✓ 内联格式匹配: ${code} x${quantityMatch[1]}`);
          i++; // 跳过已使用的数量
        }
      }
    });
  } else {
    // 格式2: 代码行和数量行分开
    // 判断行类型：代码行还是数量行
    rows.forEach(row => {
      const hasLetters = row.items.some(item => /[A-Z]/.test(item.content));
      row.isCodeRow = hasLetters;
    });

    // 提取代码和数量
    let codeItems = [];
    let quantityItems = [];

    rows.forEach(row => {
      if (row.isCodeRow) {
        codeItems.push(...row.items);
      } else {
        quantityItems.push(...row.items);
      }
    });

    console.log(`[drawings] 分行格式: ${codeItems.length} 个代码, ${quantityItems.length} 个数量`);

    // 配对代码和数量
    const minLength = Math.min(codeItems.length, quantityItems.length);
    for (let i = 0; i < minLength; i++) {
      let code = codeItems[i].content;

      // OCR修正
      code = code.replace(/^6(\d)/, 'G$1');
      code = code.replace(/^0(\d)/, 'O$1');

      // 验证代码格式
      if (/^[A-Z]+\d+$/.test(code)) {
        materials.push({
          name: code,
          code: code,
          color_name: '',
          quantity: parseInt(quantityItems[i].content) || 1
        });
        console.log(`[drawings] ✓ 分行格式匹配: ${code} x${quantityItems[i].content}`);
      }
    }
  }

  return materials;
}

// 解析OCR识别的文本，提取物料信息
function parseMaterialText(text) {
  // 首先尝试解析DeepSeek-OCR格式
  if (text.includes('<|ref|>')) {
    return parseDeepSeekOCR(text);
  }

  const materials = [];
  const lines = text.split('\n').filter(line => line.trim());

  console.log('[drawings] 开始解析OCR文本，共', lines.length, '行');

  // 预处理文本：修复常见的OCR错误
  const preprocessedLines = lines.map(line => {
    let processed = line;

    // 规则1: All -> A11 (ll 看起来像 11)
    processed = processed.replace(/\bAll\b/g, 'A11');
    processed = processed.replace(/\bAII\b/g, 'A11');

    // 规则2: 统一字母为大写（c28 -> C28）
    processed = processed.toUpperCase();

    // 规则3: 数字与字母常见误识别修正（在物料代码上下文中）
    processed = processed.replace(/S/g, '5');  // S -> 5
    processed = processed.replace(/O/g, '0');  // O -> 0
    processed = processed.replace(/I/g, '1');  // I -> 1
    processed = processed.replace(/Z/g, '2');  // Z -> 2

    // 规则4: 统一各种括号为标准圆括号
    processed = processed.replace(/[｛［［\{]/g, '(');
    processed = processed.replace(/[｝］］\}]/g, ')');
    processed = processed.replace(/【/g, '(');
    processed = processed.replace(/】/g, ')');

    return processed;
  });

  // 匹配模式1：字母+数字 后面跟着括号里的数字（同行格式）
  // 格式：A23 (29) 或 E15 (45)
  const pattern1 = /([A-Z]+\d+)\s*\((\d+)\)/g;

  // 如果pattern1匹配到结果，优先使用
  for (const line of preprocessedLines) {
    let match;
    while ((match = pattern1.exec(line)) !== null) {
      const [, code, quantity] = match;
      materials.push({
        name: code.trim(),
        code: code.trim(),
        color_name: '',
        quantity: parseInt(quantity),
      });
      console.log(`[drawings] ✓ 模式1匹配: ${code.trim()} x${quantity}`);
    }
  }

  // 如果模式1没有匹配到，尝试模式2（代码和数量分行）
  if (materials.length === 0) {
    let codes = [];
    let quantities = [];

    for (let i = 0; i < preprocessedLines.length; i++) {
      const line = preprocessedLines[i].trim();

      // 检查是否是代码行（主要是字母+数字）
      // 改进：只要包含字母+数字组合，就提取其中的代码
      // 支持1位或多位数字（A8, A16, B23等）
      const codeMatches = line.match(/\b[A-Z]+\d+\b/g);
      if (codeMatches && codeMatches.length > 0) {
        codes = [...codes, ...codeMatches];
        console.log(`[drawings] 识别到代码行 (${codeMatches.length}个代码): ${line.substring(0, 50)}...`);
      }
      // 检查是否是数量行（主要是数字，且数字占比高）
      else if (/^[\d\s]+$/.test(line) || line.split(/\s+/).filter(s => /^\d+$/.test(s)).length > 3) {
        const quantitiesInLine = line.split(/\s+/).filter(s => /^\d+$/.test(s));
        if (quantitiesInLine.length > 0) {
          quantities = [...quantities, ...quantitiesInLine];
          console.log(`[drawings] 识别到数量行 (${quantitiesInLine.length}个数量): ${line.substring(0, 50)}...`);
        }
      }
    }

    // 配对代码和数量
    if (codes.length > 0 && quantities.length > 0) {
      console.log('[drawings] 尝试模式2（代码和数量分行）');
      const minLength = Math.min(codes.length, quantities.length);

      // 先配对代码和数量
      for (let i = 0; i < minLength; i++) {
        const code = codes[i];
        const quantity = parseInt(quantities[i]);

        if (code && !isNaN(quantity)) {
          materials.push({
            name: code,
            code: code,
            color_name: '',
            quantity: quantity,
          });
          console.log(`[drawings] ✓ 模式2匹配: ${code} x${quantity}`);
        }
      }

      // 如果数量多于代码，为多余的数量创建空代码的物料
      if (quantities.length > codes.length) {
        console.log(`[drawings] 数量多于代码，为多余的 ${quantities.length - codes.length} 个数量创建空代码物料`);
        for (let i = codes.length; i < quantities.length; i++) {
          const quantity = parseInt(quantities[i]);
          if (!isNaN(quantity)) {
            materials.push({
              name: '',
              code: '',
              color_name: '',
              quantity: quantity,
            });
            console.log(`[drawings] ✓ 模式2匹配（空代码）: x${quantity}`);
          }
        }
      }
    }
  }

  // 如果模式1和模式2都没有匹配到，尝试模式3（备用模式）
  if (materials.length === 0) {
    console.log('[drawings] 模式1和模式2未匹配，尝试模式3（备用模式）');
    const backupPatterns = [
      /([A-Z]+\d+)\s+([^\d]+?)\s+(\d+)/g,  // MARD-001 珠光白 150
      /([A-Z]+\d+)\s+(\d+)\s*([^\d]*)/g,  // MARD001 150 珠光白
    ];

    for (const backupPattern of backupPatterns) {
      for (const line of preprocessedLines) {
        let match;
        while ((match = backupPattern.exec(line)) !== null) {
          const [, code, part2, part3] = match;
          let quantity, colorName;

          // 判断哪部分是数量
          if (!isNaN(parseInt(part2)) && !part3) {
            quantity = parseInt(part2);
            colorName = '';
          } else if (!isNaN(parseInt(part2))) {
            quantity = parseInt(part2);
            colorName = part3.trim();
          } else if (!isNaN(parseInt(part3))) {
            colorName = part2.trim();
            quantity = parseInt(part3);
          }

          if (code && !isNaN(quantity)) {
            materials.push({
              name: colorName ? `${code.trim()} ${colorName}` : code.trim(),
              code: code.trim(),
              color_name: colorName || '',
              quantity: quantity,
            });
            console.log(`[drawings] ✓ 模式3匹配: ${code.trim()} ${colorName} x${quantity}`);
          }
        }
      }

      if (materials.length > 0) break; // 找到就停止
    }
  }

  return materials;
}

// 物料识别接口（OCR）
router.post('/:id/recognize-materials', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.id;
    const { image_path, x, y, width, height } = req.body;

    // 验证图纸是否属于当前用户
    const drawing = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!drawing) {
      return res.status(404).json({ error: '图纸未找到或无权限' });
    }

    if (!image_path) {
      return res.status(400).json({ error: '缺少图片路径' });
    }

    if (x === undefined || y === undefined || width === undefined || height === undefined) {
      return res.status(400).json({ error: '缺少区域坐标参数' });
    }

    let cropX = parseInt(x);
    let cropY = parseInt(y);
    let cropWidth = parseInt(width);
    let cropHeight = parseInt(height);

    if (cropWidth <= 0 || cropHeight <= 0) {
      return res.status(400).json({ error: '区域尺寸无效' });
    }

    // 构建原图路径
    const fullPath = path.join(drawingsDir, image_path);

    // 获取图片实际尺寸，进行边界自动纠错
    let imageMeta;
    try {
      imageMeta = await sharp(fullPath).metadata();
    } catch (metaErr) {
      return res.status(400).json({ error: '无法读取图片信息' });
    }

    const imgWidth = imageMeta.width;
    const imgHeight = imageMeta.height;

    // 边界自动纠错：确保裁剪区域在图片范围内
    cropX = Math.max(0, cropX);
    cropY = Math.max(0, cropY);
    cropWidth = Math.min(cropWidth, imgWidth - cropX);
    cropHeight = Math.min(cropHeight, imgHeight - cropY);

    // 如果纠错后尺寸无效，返回错误
    if (cropWidth <= 0 || cropHeight <= 0) {
      return res.status(400).json({ error: '选择区域超出图片边界' });
    }

    console.log(`[drawings] 边界纠错: 原始(${x},${y},${width},${height}) -> 纠正后(${cropX},${cropY},${cropWidth},${cropHeight}), 图片尺寸(${imgWidth}x${imgHeight})`);

    // 检查文件是否存在
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: '图片文件不存在' });
    }

    // 创建裁剪图片目录
    const cropDir = path.join(drawingsDir, 'crops');
    if (!fs.existsSync(cropDir)) {
      fs.mkdirSync(cropDir, { recursive: true });
    }

    // 生成裁剪后的文件路径
    const cropFileName = `crop-${drawingId}-${Date.now()}.png`;
    const cropFilePath = path.join(cropDir, cropFileName);

    // 使用sharp裁剪图片并进行预处理以提高OCR准确率
    await sharp(fullPath)
      .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
      // 放大3倍以提高清晰度（更大倍数可以提高OCR识别率）
      .resize(Math.round(cropWidth * 3), Math.round(cropHeight * 3), {
        kernel: sharp.kernel.lanczos3, // 使用高质量的重采样算法
        fit: 'fill'
      })
      // 灰度化处理
      .grayscale()
      // 增强亮度和对比度（测试证明效果最好）
      .modulate({ brightness: 1.2 })
      // 锐化处理
      .sharpen()
      // 归一化
      .normalize()
      .toFile(cropFilePath);

    console.log(`[drawings] OCR recognition for drawing ${drawingId}, region: ${cropX},${cropY},${cropWidth},${cropHeight}`);

    // 使用DeepSeek-OCR API进行OCR识别
    let ocrText = '';
    try {
      // 读取图片并转换为base64
      const imageBuffer = fs.readFileSync(cropFilePath);
      const base64Image = imageBuffer.toString('base64');

      console.log('[drawings] Sending request to DeepSeek-OCR API...');

      // 使用DeepSeek-OCR API（OpenAI格式）
      const response = await axios.post(
        `${DEEPSEEK_API_URL}/chat/completions`,
        {
          model: 'deepseek-ai/DeepSeek-OCR',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${base64Image}`
                  }
                },
                {
                  type: 'text',
                  text: '<image>\n<|grounding|>OCR this image.'
                }
              ]
            }
          ],
          temperature: 0,
          max_tokens: 4096
        },
        {
          headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // 解析响应
      if (response.data && response.data.choices && response.data.choices.length > 0) {
        ocrText = response.data.choices[0].message.content;
        console.log(`[drawings] DeepSeek-OCR raw text:\n${ocrText.substring(0, 500)}...`);

        if (response.data.usage) {
          console.log(`[drawings] Token使用: 输入=${response.data.usage.prompt_tokens}, 输出=${response.data.usage.completion_tokens}, 总计=${response.data.usage.total_tokens}`);
        }
      } else {
        throw new Error('DeepSeek-OCR API返回空结果');
      }

    } catch (ocrError) {
      console.error('[drawings] DeepSeek-OCR API failed:', ocrError);
      if (ocrError.response && ocrError.response.data) {
        console.error('[drawings] API Error Response:', ocrError.response.data);
      }
      throw new Error('OCR识别失败: ' + (ocrError.response?.data?.message || ocrError.message));
    }

    // 解析OCR识别的文本，提取物料信息
    const materials = parseMaterialText(ocrText);

    res.json({
      materials: materials,
      crop_image_path: `crops/${cropFileName}`,
      raw_text: ocrText,
      message: `OCR识别完成，识别到 ${materials.length} 个物料`
    });

  } catch (error) {
    console.error('OCR识别失败', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


