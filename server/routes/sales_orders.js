const express = require('express');
const { query, get, run } = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// protect all routes
router.use(authenticateToken);

/**
 * 生成订单编号
 * 格式: SO + 年月日 + 4位序号
 */
async function generateOrderNo(userId) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `SO${today}`;

    // 查询今天该用户的订单数量
    const result = await get(
        `SELECT COUNT(*) as count FROM sales_orders WHERE user_id = ? AND order_no LIKE ?`,
        [userId, `${prefix}%`
    ]);

    const sequence = (result ? result.count : 0) + 1;
    return `${prefix}${String(sequence).padStart(4, '0')}`;
}

/**
 * GET /available-completions
 * 获取可用的完工记录（排除已在订单中的）
 */
router.get('/available-completions', async (req, res) => {
    try {
        const userId = req.user.id;
        const { search } = req.query;

        let sql = `
            SELECT cr.*, d.title as drawing_title
            FROM completion_records cr
            LEFT JOIN drawings d ON cr.drawing_id = d.id
            WHERE cr.user_id = ?
              AND NOT EXISTS (
                  SELECT 1 FROM order_items oi
                  WHERE oi.completion_record_id = cr.id
              )
        `;
        const params = [userId];

        if (search) {
            sql += ` AND d.title LIKE ?`;
            params.push(`%${search}%`);
        }

        sql += ` ORDER BY cr.created_at DESC`;

        const records = await query(sql, params);

        // Get unit price per material setting
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

        // 为每条记录计算图纸成本单价
        for (const record of records) {
            if (record.drawing_id) {
                // 获取图纸的材料清单并计算成本
                const materials = await query(
                    `SELECT dm.quantity, COALESCE(ui.unit_price, 0) as unit_price
                     FROM drawing_materials dm
                     JOIN products p ON dm.product_id = p.id
                     LEFT JOIN user_inventory ui ON ui.product_id = dm.product_id AND ui.user_id = ?
                     WHERE dm.drawing_id = ?`,
                    [userId, record.drawing_id]
                );

                let unitCost = 0;
                let totalMaterialQuantity = 0;
                materials.forEach((m) => {
                    unitCost += (m.unit_price || 0) * (m.quantity || 0);
                    totalMaterialQuantity += (m.quantity || 0);
                });
                record.unit_cost = unitCost;

                // Calculate reference sales price and total material quantity
                record.reference_sales_price = totalMaterialQuantity * unitPricePerMaterial;
                record.total_material_quantity = totalMaterialQuantity;
            } else {
                record.unit_cost = 0;
                record.reference_sales_price = 0;
                record.total_material_quantity = 0;
            }
        }

        res.json({ data: records });
    } catch (err) {
        console.error('获取可用完工记录失败', err);
        res.status(500).json({ error: '获取完工记录失败' });
    }
});

/**
 * GET /
 * 获取订单列表（包含统计信息）
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const { search } = req.query;

        let sql = `
            SELECT
                so.*,
                COUNT(DISTINCT oi.id) as items_count,
                GROUP_CONCAT(oi.drawing_title || ' (' || oi.quantity || ')', ', ') as items_summary
            FROM sales_orders so
            LEFT JOIN order_items oi ON so.id = oi.order_id
            WHERE so.user_id = ?
        `;
        const params = [userId];

        if (search) {
            sql += ` AND (so.order_no LIKE ? OR so.remarks LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        sql += ` GROUP BY so.id ORDER BY so.created_at DESC`;

        const orders = await query(sql, params);
        res.json({ data: orders });
    } catch (err) {
        console.error('获取销售订单列表失败', err);
        res.status(500).json({ error: '获取订单列表失败' });
    }
});

/**
 * GET /:id
 * 获取订单详情（包含items和additional_costs）
 */
router.get('/:id', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const order = await get(`SELECT * FROM sales_orders WHERE id = ? AND user_id = ?`, [id, userId]);
        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }

        // 获取订单明细
        const items = await query(
            `SELECT * FROM order_items WHERE order_id = ? ORDER BY id`,
            [id]
        );

        // 获取其他成本
        const additionalCosts = await query(
            `SELECT * FROM order_additional_costs WHERE order_id = ? ORDER BY sort_order, id`,
            [id]
        );

        res.json({
            order: {
                ...order,
                items,
                additional_costs: additionalCosts
            }
        });
    } catch (err) {
        console.error('获取订单详情失败', err);
        res.status(500).json({ error: '获取订单详情失败' });
    }
});

/**
 * POST /
 * 创建新订单（支持多完工记录和其他成本）
 */
router.post('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            total_amount,
            status = 'pending',
            remarks = '',
            items = [],
            additional_costs = []
        } = req.body;

        // 验证
        if (!total_amount || total_amount <= 0) {
            return res.status(400).json({ error: '订单金额必须大于0' });
        }
        if (!items || items.length === 0) {
            return res.status(400).json({ error: '至少需要添加一项完工记录' });
        }

        // 计算总成本
        let totalCost = 0;
        for (const item of items) {
            const itemCost = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0);
            totalCost += itemCost;
        }
        for (const cost of additional_costs) {
            totalCost += parseFloat(cost.cost_amount) || 0;
        }

        // 计算利润
        const profit = parseFloat(total_amount) - totalCost;

        // 生成订单编号
        const orderNo = await generateOrderNo(userId);

        // 使用事务创建订单
        await run('BEGIN TRANSACTION');

        try {
            // 创建订单主记录
            const orderResult = await run(
                `INSERT INTO sales_orders (
                    user_id, order_no, total_amount, total_cost, profit, status, remarks, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [userId, orderNo, total_amount, totalCost, profit, status, remarks]
            );

            const orderId = orderResult.id;

            // 创建订单明细
            for (const item of items) {
                const itemTotalCost = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0);
                await run(
                    `INSERT INTO order_items (
                        order_id, completion_record_id, drawing_id, drawing_title,
                        quantity, unit_cost, total_cost, reference_sales_price, total_material_quantity,
                        completion_image, completion_date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        orderId,
                        item.completion_record_id,
                        item.drawing_id,
                        item.drawing_title,
                        item.quantity,
                        item.unit_cost,
                        itemTotalCost,
                        item.reference_sales_price || 0,
                        item.total_material_quantity || 0,
                        item.completion_image || '',
                        item.completion_date || null
                    ]
                );
            }

            // 创建其他成本记录
            for (let i = 0; i < additional_costs.length; i++) {
                const cost = additional_costs[i];
                await run(
                    `INSERT INTO order_additional_costs (
                        order_id, cost_name, cost_amount, sort_order
                    ) VALUES (?, ?, ?, ?)`,
                    [orderId, cost.cost_name, cost.cost_amount, i]
                );
            }

            await run('COMMIT');

            // 返回完整订单数据
            const newOrder = await get(`SELECT * FROM sales_orders WHERE id = ?`, [orderId]);
            const orderItems = await query(`SELECT * FROM order_items WHERE order_id = ?`, [orderId]);
            const orderAdditionalCosts = await query(`SELECT * FROM order_additional_costs WHERE order_id = ?`, [orderId]);

            res.status(201).json({
                order: {
                    ...newOrder,
                    items: orderItems,
                    additional_costs: orderAdditionalCosts
                }
            });

        } catch (err) {
            await run('ROLLBACK');
            throw err;
        }

    } catch (err) {
        console.error('创建销售订单失败', err);
        res.status(500).json({ error: '创建订单失败' });
    }
});

/**
 * PUT /:id
 * 更新订单
 */
router.put('/:id', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const {
            total_amount,
            status,
            remarks,
            items = [],
            additional_costs = []
        } = req.body;

        // 验证订单存在
        const existingOrder = await get(`SELECT id FROM sales_orders WHERE id = ? AND user_id = ?`, [id, userId]);
        if (!existingOrder) {
            return res.status(404).json({ error: '订单不存在' });
        }

        // 验证
        if (!total_amount || total_amount <= 0) {
            return res.status(400).json({ error: '订单金额必须大于0' });
        }
        if (!items || items.length === 0) {
            return res.status(400).json({ error: '至少需要添加一项完工记录' });
        }

        // 计算总成本
        let totalCost = 0;
        for (const item of items) {
            const itemCost = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0);
            totalCost += itemCost;
        }
        for (const cost of additional_costs) {
            totalCost += parseFloat(cost.cost_amount) || 0;
        }

        // 计算利润
        const profit = parseFloat(total_amount) - totalCost;

        // 使用事务更新订单
        await run('BEGIN TRANSACTION');

        try {
            // 更新订单主记录
            await run(
                `UPDATE sales_orders SET
                    total_amount = ?,
                    total_cost = ?,
                    profit = ?,
                    status = ?,
                    remarks = ?
                WHERE id = ? AND user_id = ?`,
                [total_amount, totalCost, profit, status, remarks, id, userId]
            );

            // 删除旧的明细和成本记录
            await run(`DELETE FROM order_items WHERE order_id = ?`, [id]);
            await run(`DELETE FROM order_additional_costs WHERE order_id = ?`, [id]);

            // 重新创建订单明细
            for (const item of items) {
                const itemTotalCost = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0);
                await run(
                    `INSERT INTO order_items (
                        order_id, completion_record_id, drawing_id, drawing_title,
                        quantity, unit_cost, total_cost, reference_sales_price, total_material_quantity,
                        completion_image, completion_date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id,
                        item.completion_record_id,
                        item.drawing_id,
                        item.drawing_title,
                        item.quantity,
                        item.unit_cost,
                        itemTotalCost,
                        item.reference_sales_price || 0,
                        item.total_material_quantity || 0,
                        item.completion_image || '',
                        item.completion_date || null
                    ]
                );
            }

            // 重新创建其他成本记录
            for (let i = 0; i < additional_costs.length; i++) {
                const cost = additional_costs[i];
                await run(
                    `INSERT INTO order_additional_costs (
                        order_id, cost_name, cost_amount, sort_order
                    ) VALUES (?, ?, ?, ?)`,
                    [id, cost.cost_name, cost.cost_amount, i]
                );
            }

            await run('COMMIT');

            // 返回更新后的完整订单数据
            const updatedOrder = await get(`SELECT * FROM sales_orders WHERE id = ?`, [id]);
            const orderItems = await query(`SELECT * FROM order_items WHERE order_id = ?`, [id]);
            const orderAdditionalCosts = await query(`SELECT * FROM order_additional_costs WHERE order_id = ?`, [id]);

            res.json({
                order: {
                    ...updatedOrder,
                    items: orderItems,
                    additional_costs: orderAdditionalCosts
                }
            });

        } catch (err) {
            await run('ROLLBACK');
            throw err;
        }

    } catch (err) {
        console.error('更新销售订单失败', err);
        res.status(500).json({ error: '更新订单失败' });
    }
});

/**
 * DELETE /:id
 * 删除订单（级联删除关联的order_items和order_additional_costs）
 */
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const order = await get(`SELECT id FROM sales_orders WHERE id = ? AND user_id = ?`, [id, userId]);
        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }

        // 由于设置了ON DELETE CASCADE，删除主记录会自动删除关联记录
        await run(`DELETE FROM sales_orders WHERE id = ?`, [id]);
        res.json({ message: '删除成功' });
    } catch (err) {
        console.error('删除销售订单失败', err);
        res.status(500).json({ error: '删除订单失败' });
    }
});

module.exports = router;
