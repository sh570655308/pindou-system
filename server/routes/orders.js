const express = require('express');
const { query, get, run } = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// 移动加权平均算法：计算新的库存单价
// 公式：新单价 = (原库存数量 * 原单价 + 新入库数量 * 新单价) / (原库存数量 + 新入库数量)
function calculateMovingAveragePrice(currentQuantity, currentPrice, incomingQuantity, incomingPrice) {
  if (incomingQuantity <= 0) {
    return currentPrice || 0;
  }
  
  // 如果当前库存为0，直接使用新单价
  if (currentQuantity <= 0 || !currentPrice || currentPrice === 0) {
    return incomingPrice || 0;
  }
  
  const totalCost = (currentQuantity * currentPrice) + (incomingQuantity * incomingPrice);
  const totalQuantity = currentQuantity + incomingQuantity;
  
  return totalCost / totalQuantity;
}

// 所有订单相关路由都需要认证
router.use(authenticateToken);

// helper: format order label with local date and order id, e.g. "2025年12月5日 订单#264"
async function getOrderLabel(userId, orderId) {
  try {
    const row = await get(`SELECT created_at FROM orders WHERE id = ? AND user_id = ?`, [orderId, userId]);
    let dateStr = '';
    if (row && row.created_at) {
      const dt = new Date(row.created_at);
      const y = dt.getFullYear();
      const m = dt.getMonth() + 1;
      const d = dt.getDate();
      dateStr = `${y}年${m}月${d}日`;
    } else {
      const now = new Date();
      dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    }
    return `${dateStr} 订单#${orderId}`;
  } catch (err) {
    return `订单#${orderId}`;
  }
}

// 获取订单列表（按状态过滤）
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    let sql = `
      SELECT id, product_code, quantity, total_amount, status, created_at, updated_at
      FROM orders
      WHERE user_id = ?
    `;
    const params = [userId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at ASC, product_code ASC';

    const orders = await query(sql, params);
    res.json(orders);
  } catch (error) {
    console.error('获取订单列表失败:', error);
    res.status(500).json({ error: '获取订单列表失败' });
  }
});

// 创建单条订单（默认状态为在途 in_transit）
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { productCode, quantity, totalAmount } = req.body;

    if (!productCode || typeof productCode !== 'string') {
      return res.status(400).json({ error: '产品代码不能为空' });
    }

    const parsedQuantity = parseInt(quantity, 10);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ error: '数量必须为大于0的整数' });
    }

    // 处理订单金额（可选）
    let orderAmount = 0;
    if (totalAmount !== undefined && totalAmount !== null) {
      const parsedAmount = parseFloat(totalAmount);
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({ error: '订单总额必须为大于等于0的数字' });
      }
      orderAmount = parsedAmount;
    }

    const result = await run(
      `INSERT INTO orders (user_id, product_code, quantity, total_amount, status)
       VALUES (?, ?, ?, ?, 'in_transit')`,
      [userId, productCode.trim(), parsedQuantity, orderAmount]
    );

    const order = await get(
      `SELECT id, product_code, quantity, total_amount, status, created_at, updated_at
       FROM orders WHERE id = ?`,
      [result.id]
    );

    res.status(201).json(order);
  } catch (error) {
    console.error('创建订单失败:', error);
    res.status(500).json({ error: '创建订单失败' });
  }
});

// 批量创建订单（允许一笔订单包含多个产品）
router.post('/batch', async (req, res) => {
  try {
    const userId = req.user.id;
    const { items, totalAmount } = req.body; // [{ productCode, quantity }, ...], totalAmount: 订单总额

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '请至少添加一个产品' });
    }

    // 计算订单总额（如果提供了）
    let orderTotalAmount = 0;
    if (totalAmount !== undefined && totalAmount !== null) {
      const parsedAmount = parseFloat(totalAmount);
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({ error: '订单总额必须为大于等于0的数字' });
      }
      orderTotalAmount = parsedAmount;
    }

    // 计算总数量，用于平均分配订单金额
    const totalQuantity = items.reduce((sum, item) => {
      const qty = parseInt(item.quantity, 10) || 0;
      return sum + qty;
    }, 0);

    // 如果提供了订单总额，计算每个产品的平均单价
    const averagePricePerUnit = orderTotalAmount > 0 && totalQuantity > 0 
      ? orderTotalAmount / totalQuantity 
      : 0;

    const createdOrders = [];

    for (const item of items) {
      const { productCode, quantity } = item || {};

      if (!productCode || typeof productCode !== 'string') {
        return res.status(400).json({ error: '产品代码不能为空' });
      }

      const parsedQuantity = parseInt(quantity, 10);
      if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
        return res.status(400).json({ error: '数量必须为大于0的整数' });
      }

      // 计算该产品分配的订单金额（按数量比例分配）
      const itemAmount = averagePricePerUnit > 0 
        ? averagePricePerUnit * parsedQuantity 
        : 0;

      const result = await run(
        `INSERT INTO orders (user_id, product_code, quantity, total_amount, status)
         VALUES (?, ?, ?, ?, 'in_transit')`,
        [userId, productCode.trim(), parsedQuantity, itemAmount]
      );

      const order = await get(
        `SELECT id, product_code, quantity, total_amount, status, created_at, updated_at
         FROM orders WHERE id = ?`,
        [result.id]
      );

      if (order) {
        createdOrders.push(order);
      }
    }

    res.status(201).json(createdOrders);
  } catch (error) {
    console.error('批量创建订单失败:', error);
    res.status(500).json({ error: '批量创建订单失败' });
  }
});

// 根据订单状态变更同步库存并记录日志
async function applyInventoryChangeForOrder(userId, order, newStatus) {
  // 只在状态变化时处理
  if (order.status === newStatus) return;

  // 只对以下几种转换做库存变动：
  // in_transit -> received      : 签收增加
  // received   -> in_transit    : 撤回在途，库存减少
  // received   -> returned      : 退货减少
  // returned   -> received      : 再次签收增加

  let quantityChange = 0;
  let changeType = null;
  let shouldUpdatePrice = false; // 是否需要更新单价（仅在签收时更新）

  if (order.status === 'in_transit' && newStatus === 'received') {
    quantityChange = order.quantity;
    changeType = 'order_received_increase';
    shouldUpdatePrice = true; // 签收时更新单价
  } else if (order.status === 'received' && newStatus === 'in_transit') {
    quantityChange = -order.quantity;
    changeType = 'order_return_decrease';
    // 撤回在途时，不更新单价（因为单价已经在签收时更新过了）
  } else if (order.status === 'received' && newStatus === 'returned') {
    quantityChange = -order.quantity;
    changeType = 'order_return_decrease';
    // 退货时，不更新单价（因为单价已经在签收时更新过了）
  } else if (order.status === 'returned' && newStatus === 'received') {
    quantityChange = order.quantity;
    changeType = 'order_received_increase';
    shouldUpdatePrice = true; // 再次签收时更新单价
  }

  if (!quantityChange || !changeType) {
    return;
  }

  // 根据产品代码找到产品ID
  const product = await get(
    `SELECT id FROM products WHERE code = ? LIMIT 1`,
    [order.product_code]
  );

  if (!product) {
    // 没找到产品，不做库存变动，但记录错误日志
    console.warn('订单对应的产品不存在，无法同步库存:', order.product_code);
    return;
  }

  const productId = product.id;

  // 查询当前库存和单价
  const existing = await get(
    `SELECT quantity, unit_price FROM user_inventory WHERE user_id = ? AND product_id = ?`,
    [userId, productId]
  );
  const beforeQty = existing ? existing.quantity : 0;
  const beforePrice = existing ? (existing.unit_price || 0) : 0;
  const afterQty = Math.max(0, beforeQty + quantityChange);

  // 计算新单价（仅在签收时使用移动加权平均）
  let newPrice = beforePrice;
  if (shouldUpdatePrice && order.total_amount && order.total_amount > 0 && order.quantity > 0) {
    // 计算本次入库的单价
    const incomingPrice = order.total_amount / order.quantity;
    newPrice = calculateMovingAveragePrice(beforeQty, beforePrice, order.quantity, incomingPrice);
  }

  // 更新或插入库存（包括单价）
  await run(
    `INSERT INTO user_inventory (user_id, product_id, quantity, unit_price, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, product_id) 
     DO UPDATE SET quantity = ?, unit_price = ?, updated_at = CURRENT_TIMESTAMP`,
    [userId, productId, afterQty, newPrice, afterQty, newPrice]
  );

  // 写入库存变动日志
  const orderLabel = await getOrderLabel(userId, order.id);
  await run(
    `INSERT INTO inventory_change_logs 
      (user_id, product_id, change_type, source, quantity_change, quantity_before, quantity_after, order_id, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      productId,
      changeType,
      'order',
      quantityChange,
      beforeQty,
      afterQty,
      order.id,
      `${orderLabel} ${changeType === 'order_received_increase' ? '签收增加库存' : '退货减少库存'}`,
    ]
  );
}

// 更新订单状态
router.put('/:id/status', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['in_transit', 'received', 'returned'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: '无效的订单状态' });
    }

    const order = await get(
      `SELECT id, product_code, quantity, total_amount, status FROM orders WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }

    // 先应用库存变动（如果需要）
    await applyInventoryChangeForOrder(userId, order, status);

    // 再更新订单状态
    await run(
      `UPDATE orders
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [status, id, userId]
    );

    const updated = await get(
      `SELECT id, product_code, quantity, total_amount, status, created_at, updated_at
       FROM orders WHERE id = ?`,
      [id]
    );

    res.json(updated);
  } catch (error) {
    console.error('更新订单状态失败:', error);
    res.status(500).json({ error: '更新订单状态失败' });
  }
});

// 批量修改订单状态（body: { ids: [...], status: 'received'|'in_transit'|'returned' })
router.post('/batch/status', async (req, res) => {
  try {
    const userId = req.user.id;
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '缺少要修改的订单 ids' });
    }
    const validStatuses = ['in_transit', 'received', 'returned'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: '无效的目标状态' });
    }

    // fetch orders to operate on
    const placeholders = ids.map(() => '?').join(',');
    const orders = await query(
      `SELECT id, product_code, quantity, total_amount, status FROM orders WHERE id IN (${placeholders}) AND user_id = ?`,
      [...ids, userId]
    );

    // run in transaction for consistency
    await run('BEGIN TRANSACTION');
    try {
      for (const order of orders) {
        // apply inventory changes if needed
        await applyInventoryChangeForOrder(userId, order, status);
        await run(`UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`, [status, order.id, userId]);
      }
      await run('COMMIT');
    } catch (err) {
      await run('ROLLBACK');
      throw err;
    }

    res.json({ message: '批量状态更新完成', count: orders.length });
  } catch (error) {
    console.error('批量修改状态失败', error);
    res.status(500).json({ error: error.message });
  }
});

// 批量删除订单（body: { ids: [...] })
router.post('/batch/delete', async (req, res) => {
  try {
    const userId = req.user.id;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '缺少要删除的订单 ids' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const orders = await query(
      `SELECT id, product_code, quantity, total_amount, status FROM orders WHERE id IN (${placeholders}) AND user_id = ?`,
      [...ids, userId]
    );

    await run('BEGIN TRANSACTION');
    try {
      for (const order of orders) {
        // if received, need to decrease inventory (same logic as single delete)
        if (order.status === 'received') {
          const product = await get(`SELECT id FROM products WHERE code = ? LIMIT 1`, [order.product_code]);
          if (product) {
            const productId = product.id;
            const existing = await get(`SELECT quantity FROM user_inventory WHERE user_id = ? AND product_id = ?`, [userId, productId]);
            const beforeQty = existing ? existing.quantity : 0;
            const afterQty = Math.max(0, beforeQty - order.quantity);
            await run(
              `INSERT INTO user_inventory (user_id, product_id, quantity, updated_at)
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(user_id, product_id) 
               DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP`,
              [userId, productId, afterQty, afterQty]
            );
            await run(
              `INSERT INTO inventory_change_logs 
                (user_id, product_id, change_type, source, quantity_change, quantity_before, quantity_after, order_id, remark)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                userId,
                productId,
                'order_return_decrease',
                'order',
                -order.quantity,
                beforeQty,
                afterQty,
                order.id,
                `${await getOrderLabel(userId, order.id)} 删除已签收订单，减少库存`
              ]
            );
          }
        }
        await run(`DELETE FROM orders WHERE id = ? AND user_id = ?`, [order.id, userId]);
      }
      await run('COMMIT');
    } catch (err) {
      await run('ROLLBACK');
      throw err;
    }

    res.json({ message: '批量删除完成', count: orders.length });
  } catch (error) {
    console.error('批量删除失败', error);
    res.status(500).json({ error: error.message });
  }
});

// 批量修改订单创建日期（body: { ids: [...], newDate: 'YYYY-MM-DD' })
router.post('/batch/date', async (req, res) => {
  try {
    const userId = req.user.id;
    const { ids, newDate } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '缺少要修改的订单 ids' });
    }
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      return res.status(400).json({ error: 'newDate 必须为 YYYY-MM-DD 格式' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const orders = await query(
      `SELECT id, created_at FROM orders WHERE id IN (${placeholders}) AND user_id = ?`,
      [...ids, userId]
    );

    await run('BEGIN TRANSACTION');
    try {
      for (const order of orders) {
        const oldDt = new Date(order.created_at);
        const hh = String(oldDt.getHours()).padStart(2, '0');
        const mm = String(oldDt.getMinutes()).padStart(2, '0');
        const ss = String(oldDt.getSeconds()).padStart(2, '0');
        const newCreatedAt = `${newDate} ${hh}:${mm}:${ss}`;
        await run(`UPDATE orders SET created_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`, [newCreatedAt, order.id, userId]);
      }
      await run('COMMIT');
    } catch (err) {
      await run('ROLLBACK');
      throw err;
    }

    res.json({ message: '批量修改日期完成', count: orders.length });
  } catch (error) {
    console.error('批量修改日期失败', error);
    res.status(500).json({ error: error.message });
  }
});

// 更新订单（修改产品代码、数量与订单金额，仅限在途订单）
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { productCode, quantity, totalAmount } = req.body;

    const order = await get(
      `SELECT id, product_code, quantity, total_amount, status FROM orders WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }

    if (order.status !== 'in_transit') {
      return res.status(400).json({ error: '只能修改在途订单' });
    }

    if (!productCode || typeof productCode !== 'string') {
      return res.status(400).json({ error: '产品代码不能为空' });
    }

    const parsedQuantity = parseInt(quantity, 10);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ error: '数量必须为大于0的整数' });
    }

    // 订单金额（可选）
    let orderAmount = order.total_amount || 0;
    if (totalAmount !== undefined && totalAmount !== null) {
      const parsedAmount = parseFloat(totalAmount);
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({ error: '订单总额必须为大于等于0的数字' });
      }
      orderAmount = parsedAmount;
    }

    await run(
      `UPDATE orders
       SET product_code = ?, quantity = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [productCode.trim(), parsedQuantity, orderAmount, id, userId]
    );

    const updated = await get(
      `SELECT id, product_code, quantity, total_amount, status, created_at, updated_at
       FROM orders WHERE id = ?`,
      [id]
    );

    res.json(updated);
  } catch (error) {
    console.error('更新订单失败:', error);
    res.status(500).json({ error: '更新订单失败' });
  }
});

// 删除订单（根据状态处理库存）
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const order = await get(
      `SELECT id, product_code, quantity, total_amount, status FROM orders WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }

    // 如果订单是已签收状态，删除时需要减少库存
    if (order.status === 'received') {
      // 根据产品代码找到产品ID
      const product = await get(
        `SELECT id FROM products WHERE code = ? LIMIT 1`,
        [order.product_code]
      );

      if (product) {
        const productId = product.id;

        // 查询当前库存
        const existing = await get(
          `SELECT quantity FROM user_inventory WHERE user_id = ? AND product_id = ?`,
          [userId, productId]
        );
        const beforeQty = existing ? existing.quantity : 0;
        const afterQty = Math.max(0, beforeQty - order.quantity);

        // 更新库存
        await run(
          `INSERT INTO user_inventory (user_id, product_id, quantity, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, product_id) 
           DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP`,
          [userId, productId, afterQty, afterQty]
        );

        // 写入库存变动日志
        const delLabel = await getOrderLabel(userId, order.id);
        await run(
          `INSERT INTO inventory_change_logs 
            (user_id, product_id, change_type, source, quantity_change, quantity_before, quantity_after, order_id, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            productId,
            'order_return_decrease',
            'order',
            -order.quantity,
            beforeQty,
            afterQty,
            order.id,
            `${delLabel} 删除已签收订单，减少库存`,
          ]
        );
      }
    }
    // 已退货订单和在途订单删除时不影响库存

    // 删除订单
    await run(`DELETE FROM orders WHERE id = ? AND user_id = ?`, [id, userId]);

    res.json({ message: '订单删除成功' });
  } catch (error) {
    console.error('删除订单失败:', error);
    res.status(500).json({ error: '删除订单失败' });
  }
});

module.exports = router;


