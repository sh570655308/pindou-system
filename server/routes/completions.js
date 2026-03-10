const express = require('express');
const { query, get, run, db } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { upload, deleteFile } = require('../utils/fileUpload');
const sharp = require('sharp');

const router = express.Router();
const fs = require('fs');
const path = require('path');
const { drawingsDir } = require('../database');

// 事务辅助函数
function runTransaction(queries) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        const results = [];
        let index = 0;
        
        function runNext() {
          if (index >= queries.length) {
            db.run('COMMIT', (err) => {
              if (err) {
                db.run('ROLLBACK');
                reject(err);
              } else {
                resolve(results);
              }
            });
            return;
          }
          
          const { sql, params } = queries[index++];
          db.run(sql, params || [], function(err) {
            if (err) {
              db.run('ROLLBACK');
              reject(err);
              return;
            }
            results.push({ id: this.lastID, changes: this.changes });
            runNext();
          });
        }
        
        runNext();
      });
    });
  });
}

// 需要认证
router.use(authenticateToken);

// 列表：按用户或按图纸查询完工记录
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.query.drawing_id || req.query.drawingId;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // 先获取总数
    let countSql = 'SELECT COUNT(*) as total FROM completion_records cr WHERE cr.user_id = ?';
    const countParams = [userId];
    if (drawingId) {
      countSql += ' AND cr.drawing_id = ?';
      countParams.push(drawingId);
    }
    const countResult = await get(countSql, countParams);
    const total = countResult ? countResult.total : 0;

    // 返回时附加是否已被撤销的标记（查找 inventory_change_logs 中的撤销备注）
    // 同时返回缩略图路径（优先使用缩略图，没有则使用原图）
    let sql = `
      SELECT cr.*,
        COALESCE(cr.thumbnail_path, cr.image_path) as thumbnail,
        CASE WHEN EXISTS (
          SELECT 1 FROM inventory_change_logs l
          WHERE l.user_id = ? AND l.remark LIKE ('%撤销完工记录 ' || cr.id || '%')
        ) THEN 1 ELSE 0 END as is_revoked
      FROM completion_records cr
      WHERE cr.user_id = ?
    `;
    const params = [userId, userId];
    if (drawingId) {
      sql += ' AND cr.drawing_id = ?';
      params.push(drawingId);
    }
    sql += ' ORDER BY cr.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await query(sql, params);

    res.json({ data: rows, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建完工记录（可选上传图片，字段：drawing_id, quantity, image file field 名称为 image）
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.body.drawing_id || req.body.drawingId;
    const quantity = parseInt(req.body.quantity || '0') || 0;
    if (!drawingId || quantity <= 0) return res.status(400).json({ error: '缺少 drawing_id 或 quantity 必须大于 0' });

    const drawing = await get(`SELECT * FROM drawings WHERE id = ? AND user_id = ?`, [drawingId, userId]);
    if (!drawing) return res.status(404).json({ error: '图纸未找到或无权限' });

    let imagePath = null;
    let fileName = null;
    let mimeType = null;
    if (req.file) {
      const uploadedPath = req.file.path; // full path
      // 如果前端提供了 image_hash，则先尝试在现有记录中查找相同 hash，以复用已有文件（避免重复存储）
      const imageHash = req.body.image_hash || null;
      if (imageHash) {
        try {
          const existing = await get(`SELECT image_path, file_name, mime_type FROM completion_records WHERE image_hash = ? LIMIT 1`, [imageHash]);
          if (existing && existing.image_path) {
            // 删除临时上传文件并复用已有路径
            try { await fs.promises.unlink(uploadedPath); } catch (e) { /* ignore */ }
            imagePath = existing.image_path;
            fileName = existing.file_name;
            mimeType = existing.mime_type;
          }
        } catch (e) {
          console.error('检查重复图片失败', e);
        }
      }

      // 如果尚未找到可复用的文件，则移动到目标 drawing 目录
      if (!imagePath) {
        const targetDir = path.join(drawingsDir, String(drawingId));
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        const targetPath = path.join(targetDir, req.file.filename);
        try {
          // 移动文件（如果已经在目标目录则会覆盖为同一个路径）
          await fs.promises.rename(uploadedPath, targetPath);
        } catch (err) {
          // 如果重命名失败（例如跨分区），尝试拷贝然后删除源文件
          try {
            await fs.promises.copyFile(uploadedPath, targetPath);
            await fs.promises.unlink(uploadedPath);
          } catch (e) {
            console.error('移动上传文件失败', e);
            // 仍然允许记录保存，但路径可能指向 temp（尝试容错）
          }
        }
        imagePath = `${drawingId}/${req.file.filename}`;
        fileName = req.file.originalname;
        mimeType = req.file.mimetype;
      }
    }

    // 生成缩略图
    let thumbnailPath = null;
    if (imagePath) {
      try {
        const fullImagePath = path.join(drawingsDir, imagePath);
        if (fs.existsSync(fullImagePath)) {
          const ext = path.extname(imagePath);
          const thumbnailFilename = `thumb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
          thumbnailPath = `${drawingId}/${thumbnailFilename}`;
          const thumbnailFullPath = path.join(drawingsDir, thumbnailPath);

          // 确保目录存在
          const thumbnailDir = path.dirname(thumbnailFullPath);
          if (!fs.existsSync(thumbnailDir)) {
            fs.mkdirSync(thumbnailDir, { recursive: true });
          }

          await sharp(fullImagePath)
            .resize(150, 150, { fit: 'cover', position: 'center' })
            .jpeg({ quality: 80 })
            .toFile(thumbnailFullPath);

          console.log(`[completions] generated thumbnail: ${thumbnailPath}`);
        }
      } catch (thumbErr) {
        console.error(`[completions] failed to generate thumbnail:`, thumbErr.message);
        // 缩略图生成失败不影响主流程
      }
    }

    // 支持可选字段：completed_at (datetime) 与 satisfaction (int 1-5)
    const cols = ['user_id', 'drawing_id', 'quantity', 'image_path', 'file_name', 'mime_type', 'thumbnail_path'];
    const vals = [userId, drawingId, quantity, imagePath, fileName, mimeType, thumbnailPath];
    if (req.body.image_hash) {
      cols.push('image_hash');
      vals.push(req.body.image_hash);
    }
    if (req.body.completed_at) {
      cols.push('completed_at');
      vals.push(req.body.completed_at);
    }
    if (req.body.satisfaction) {
      // 尝试解析为整数
      const s = parseInt(req.body.satisfaction);
      if (!isNaN(s)) {
        cols.push('satisfaction');
        vals.push(s);
      }
    }
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO completion_records (${cols.join(', ')}) VALUES (${placeholders})`;
    const result = await run(sql, vals);

    // 执行库存扣减逻辑：根据图纸材料清单和完工数量扣减库存
    const mats = await query(
      `SELECT dm.product_id, dm.quantity as material_qty FROM drawing_materials dm WHERE dm.drawing_id = ?`,
      [drawingId]
    );
    if (mats && mats.length > 0) {
      // 先创建消耗主记录（获取 recordId）
      const rec = await run(
        `INSERT INTO consumption_records (user_id, drawing_id, record_type, title, description, consumption_date)
         VALUES (?, ?, ?, ?, ?, DATE('now'))`,
        [userId, drawingId, '完工消耗', `图纸${drawingId} - ${drawing.title || ''} 完工`, `自动消耗 - 完工数量: ${quantity}`]
      );
      const recordId = rec.id;

      // 使用事务批量执行库存扣减操作
      const queries = [];
      
      for (const m of mats) {
        const productId = m.product_id;
        const materialQty = m.material_qty || 0;
        const totalConsumeQty = materialQty * quantity;

        // 查询当前库存（在事务外查询）
        const existing = await query(`SELECT quantity, unit_price FROM user_inventory WHERE user_id = ? AND product_id = ?`, [userId, productId]);
        const existingStock = existing && existing.length > 0 ? existing[0] : null;
        const beforeQty = existingStock ? existingStock.quantity : 0;
        const beforePrice = existingStock ? (existingStock.unit_price || 0) : 0;
        const afterQty = beforeQty - totalConsumeQty;

        // 更新库存
        queries.push({
          sql: `INSERT INTO user_inventory (user_id, product_id, quantity, unit_price, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, product_id)
                DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP`,
          params: [userId, productId, afterQty, beforePrice, afterQty]
        });

        // 写入库存变动日志
        queries.push({
          sql: `INSERT INTO inventory_change_logs
                (user_id, product_id, change_type, source, quantity_change, quantity_before, quantity_after, order_id, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            userId,
            productId,
            '完工消耗',
            'auto',
            -totalConsumeQty,
            beforeQty,
            afterQty,
            null,
            `图纸${drawingId}-${drawing.title || ''} 完工 - 数量: ${quantity}`
          ]
        });

        // 写入消耗明细
        queries.push({
          sql: `INSERT INTO consumption_items (record_id, product_id, quantity) VALUES (?, ?, ?)`,
          params: [recordId, productId, totalConsumeQty]
        });
      }

      // 批量执行事务
      await runTransaction(queries);
    }

    // 更新图纸完成计数（按数量累加）
    await run(`UPDATE drawings SET completed_count = COALESCE(completed_count, 0) + ? WHERE id = ?`, [quantity, drawingId]);

    const newRec = await get(`SELECT * FROM completion_records WHERE id = ?`, [result.id]);
    res.status(201).json({ record: newRec });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新完工记录（可修改数量、完工时间、满意度并可替换图片）
router.put('/:id', upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.id;
    const recId = req.params.id;
    const existing = await get(`SELECT * FROM completion_records WHERE id = ? AND user_id = ?`, [recId, userId]);
    if (!existing) return res.status(404).json({ error: '完工记录未找到或无权限' });

    const updates = [];
    const params = [];
    let newQuantity = existing.quantity; // 默认保持原有数量

    if (req.body.quantity) {
      const q = parseInt(req.body.quantity);
      if (!isNaN(q)) {
        updates.push('quantity = ?');
        params.push(q);
        newQuantity = q; // 记录新数量用于库存调整
      }
    }
    if (req.body.completed_at) {
      updates.push('completed_at = ?');
      params.push(req.body.completed_at);
    }
    if (req.body.satisfaction) {
      const s = parseInt(req.body.satisfaction);
      if (!isNaN(s)) {
        updates.push('satisfaction = ?');
        params.push(s);
      }
    }

    // 处理图片替换
    if (req.file) {
      // ensure target dir for drawing exists and move file if needed
      const drawingId = req.body.drawing_id || existing.drawing_id;
      const uploadedPath = req.file.path;
      const imageHash = req.body.image_hash || null;
      let newPath = null;

      if (imageHash) {
        try {
          const found = await get(`SELECT image_path, file_name, mime_type FROM completion_records WHERE image_hash = ? LIMIT 1`, [imageHash]);
          if (found && found.image_path) {
            // delete uploaded temp file and reuse existing file
            try { await fs.promises.unlink(uploadedPath); } catch (e) { /* ignore */ }
            newPath = found.image_path;
          }
        } catch (e) {
          console.error('检查重复图片失败', e);
        }
      }

      if (!newPath) {
        const targetDir = path.join(drawingsDir, String(drawingId));
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        const targetPath = path.join(targetDir, req.file.filename);
        try {
          await fs.promises.rename(uploadedPath, targetPath);
        } catch (err) {
          try {
            await fs.promises.copyFile(uploadedPath, targetPath);
            await fs.promises.unlink(uploadedPath);
          } catch (e) {
            console.error('移动上传文件失败', e);
          }
        }
        newPath = `${drawingId}/${req.file.filename}`;
      }

      updates.push('image_path = ?');
      params.push(newPath);
      if (req.file.originalname) {
        updates.push('file_name = ?');
        params.push(req.file.originalname);
      }
      if (req.file.mimetype) {
        updates.push('mime_type = ?');
        params.push(req.file.mimetype);
      }
      if (req.body.image_hash) {
        updates.push('image_hash = ?');
        params.push(req.body.image_hash);
      }

      // 注意：不删除旧文件以避免误删被其他记录复用的文件
    }

    if (updates.length > 0) {
      const sql = `UPDATE completion_records SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      params.push(recId);
      await run(sql, params);
    }

    // 如果数量发生变化，需要调整库存
    if (newQuantity !== existing.quantity) {
      const quantityDiff = newQuantity - existing.quantity; // 正数表示增加消耗，负数表示减少消耗
      const drawingId = existing.drawing_id;

      // 获取图纸材料清单
      const mats = await query(
        `SELECT dm.product_id, dm.quantity as material_qty FROM drawing_materials dm WHERE dm.drawing_id = ?`,
        [drawingId]
      );

      if (mats && mats.length > 0) {
        // 创建调整消耗记录
        const rec = await run(
          `INSERT INTO consumption_records (user_id, drawing_id, record_type, title, description, consumption_date)
           VALUES (?, ?, ?, ?, ?, DATE('now'))`,
          [userId, drawingId, '完工调整', `图纸${drawingId} 完工记录调整`, `数量调整: ${existing.quantity} → ${newQuantity}`]
        );
        const recordId = rec.id;

        for (const m of mats) {
          const productId = m.product_id;
          const materialQty = m.material_qty || 0;
          const totalAdjustQty = materialQty * quantityDiff; // 材料数量 × 数量差异

          // 查询当前库存
          const existingStock = await query(`SELECT quantity, unit_price FROM user_inventory WHERE user_id = ? AND product_id = ?`, [userId, productId]);
          const stock = existingStock && existingStock.length > 0 ? existingStock[0] : null;
          const beforeQty = stock ? stock.quantity : 0;
          const beforePrice = stock ? (stock.unit_price || 0) : 0;
          const afterQty = beforeQty - totalAdjustQty;

          // 更新或插入库存
          await run(
            `INSERT INTO user_inventory (user_id, product_id, quantity, unit_price, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, product_id)
             DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP`,
            [userId, productId, afterQty, beforePrice, afterQty]
          );

          // 写入库存变动日志
          await run(
            `INSERT INTO inventory_change_logs
              (user_id, product_id, change_type, source, quantity_change, quantity_before, quantity_after, order_id, remark)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              productId,
              '完工调整',
              'auto',
              -totalAdjustQty,
              beforeQty,
              afterQty,
              null,
              `图纸${drawingId} 完工记录${recId}调整 - 数量: ${existing.quantity} → ${newQuantity}`
            ]
          );

          // 写入消耗明细（正数为消耗，负数为退回）
          await run(
            `INSERT INTO consumption_items (record_id, product_id, quantity) VALUES (?, ?, ?)`,
            [recordId, productId, totalAdjustQty]
          );
        }
      }
    }

    const updated = await get(`SELECT * FROM completion_records WHERE id = ?`, [recId]);
    res.json({ record: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

 
// 撤销完工记录：还原对应的库存变动（可多次保护，重复撤销会被阻止）
router.post('/:id/undo', async (req, res) => {
  try {
    const userId = req.user.id;
    const recId = req.params.id;
    const rec = await get(`SELECT * FROM completion_records WHERE id = ? AND user_id = ?`, [recId, userId]);
    if (!rec) return res.status(404).json({ error: '完工记录未找到或无权限' });

    // 防止重复撤销：检查是否已存在对应的撤销日志
    const existingUndoLog = await get(`SELECT id FROM inventory_change_logs WHERE remark LIKE ? AND user_id = ? LIMIT 1`, [`%撤销完工记录 ${recId}%`, userId]);
    if (existingUndoLog) return res.status(400).json({ error: '该完工记录已撤销' });

    const drawing = await get(`SELECT * FROM drawings WHERE id = ?`, [rec.drawing_id]);
    const mats = await query(`SELECT product_id, quantity as material_qty FROM drawing_materials WHERE drawing_id = ?`, [rec.drawing_id]);

    // 创建撤销消耗主记录
    const cr = await run(
      `INSERT INTO consumption_records (user_id, drawing_id, record_type, title, description, consumption_date)
       VALUES (?, ?, ?, ?, ?, DATE('now'))`,
      [userId, rec.drawing_id, '完工撤销', `撤销完工记录 ${recId}`, `撤销完工记录 ${recId} - 图纸${rec.drawing_id} - ${(drawing && drawing.title) || ''} 撤销数量: ${rec.quantity}`]
    );
    const undoRecordId = cr.id;

    for (const m of mats) {
      const productId = m.product_id;
      const qtyToReturn = (m.material_qty || 0) * rec.quantity;

      // 查询当前库存
      const existingStock = await get(`SELECT quantity, unit_price FROM user_inventory WHERE user_id = ? AND product_id = ?`, [userId, productId]);
      const beforeQty = existingStock ? existingStock.quantity : 0;
      const beforePrice = existingStock ? (existingStock.unit_price || 0) : 0;
      const afterQty = beforeQty + qtyToReturn;

      // 更新或插入库存（将被还原回更高的数量）
      await run(
        `INSERT INTO user_inventory (user_id, product_id, quantity, unit_price, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, product_id)
         DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP`,
        [userId, productId, afterQty, beforePrice, afterQty]
      );

      // 写入库存变动日志（正数表示入库/退回）
      await run(
        `INSERT INTO inventory_change_logs
          (user_id, product_id, change_type, source, quantity_change, quantity_before, quantity_after, order_id, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          productId,
          '完工撤销',
          'manual',
          qtyToReturn,
          beforeQty,
          afterQty,
          null,
          `撤销完工记录 ${recId} - 图纸${rec.drawing_id}-${(drawing && drawing.title) || ''} 撤销数量: ${rec.quantity}`
        ]
      );

      // 写入消耗明细（使用负数表示退回）
      await run(
        `INSERT INTO consumption_items (record_id, product_id, quantity) VALUES (?, ?, ?)`,
        [undoRecordId, productId, -qtyToReturn]
      );
    }

    // 更新图纸完成计数（避免为负）
    const current = await get(`SELECT COALESCE(completed_count, 0) as cc FROM drawings WHERE id = ?`, [rec.drawing_id]);
    const newCount = Math.max(0, (current ? current.cc : 0) - rec.quantity);
    await run(`UPDATE drawings SET completed_count = ? WHERE id = ?`, [newCount, rec.drawing_id]);

    res.json({ message: '完工记录已撤销，库存变动已还原' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除已撤销的完工记录（只有已撤销的记录才能删除）
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const recId = req.params.id;
    const rec = await get(`SELECT * FROM completion_records WHERE id = ? AND user_id = ?`, [recId, userId]);
    if (!rec) return res.status(404).json({ error: '完工记录未找到或无权限' });

    // 检查是否已撤销：查找是否存在对应的撤销日志
    const existingUndoLog = await get(`SELECT id FROM inventory_change_logs WHERE remark LIKE ? AND user_id = ? LIMIT 1`, [`%撤销完工记录 ${recId}%`, userId]);
    if (!existingUndoLog) return res.status(400).json({ error: '只能删除已撤销的完工记录' });

    // 删除关联的图片文件（如果存在且不被其他记录复用）
    if (rec.image_path) {
      try {
        // 检查是否被其他记录复用
        const otherUses = await get(`SELECT COUNT(*) as count FROM completion_records WHERE image_path = ? AND id != ? AND user_id = ?`, [rec.image_path, recId, userId]);
        if (!otherUses || otherUses.count === 0) {
          // 没有其他记录使用，可以安全删除
          const fullPath = path.join(drawingsDir, rec.image_path);
          if (fs.existsSync(fullPath)) {
            await fs.promises.unlink(fullPath);
          }
        }
      } catch (fileError) {
        console.warn('删除图片文件失败', fileError);
        // 继续删除记录，不因文件删除失败而中断
      }
    }

    // 删除完工记录
    await run(`DELETE FROM completion_records WHERE id = ? AND user_id = ?`, [recId, userId]);

    res.json({ message: '完工记录已删除' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


module.exports = router;
