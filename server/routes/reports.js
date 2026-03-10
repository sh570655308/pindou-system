const express = require('express');
const { query, get } = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// 需要认证
router.use(authenticateToken);

// 消耗统计表：根据完工记录统计所有物料的消耗情况（按物料汇总）
router.get('/consumption', async (req, res) => {
  try {
    const userId = req.user.id;

    // 获取用户设置的排除物料列表
    const excludedResult = await get(
      `SELECT value FROM settings WHERE key = ?`,
      [`user_consumption_excluded_materials_${userId}`]
    );
    const excludedCodesStr = excludedResult ? excludedResult.value : '';
    const excludedCodes = excludedCodesStr
      ? excludedCodesStr.split(',').map(s => s.trim()).filter(s => s !== '')
      : [];

    // 构建SQL查询
    let sql = `
      SELECT
        p.id as product_id,
        p.code as product_code,
        p.color_hex,
        c.name as category_name,
        SUM(ci.quantity) as total_quantity,
        COUNT(DISTINCT cr.id) as completion_count,
        ROUND(SUM(ci.quantity) * 1.0 / COUNT(DISTINCT cr.id), 2) as avg_consumption,
        (
          SELECT COALESCE(SUM(ci2.quantity), 0)
          FROM (
            SELECT cr2.id, cr2.created_at
            FROM consumption_records cr2
            WHERE cr2.user_id = ?
              AND cr2.record_type IN ('图纸消耗', '完工消耗', 'drawing')
            ORDER BY cr2.created_at DESC
            LIMIT 20
          ) recent_cr
          JOIN consumption_items ci2 ON ci2.record_id = recent_cr.id
          WHERE ci2.product_id = p.id AND ci2.quantity > 0
        ) as recent_20_consumption
      FROM consumption_records cr
      JOIN consumption_items ci ON ci.record_id = cr.id
      JOIN products p ON p.id = ci.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE cr.user_id = ?
        AND cr.record_type IN ('图纸消耗', '完工消耗', 'drawing')
        AND ci.quantity > 0
    `;

    const params = [userId, userId];

    // 如果有排除物料，添加排除条件
    if (excludedCodes.length > 0) {
      const placeholders = excludedCodes.map(() => '?').join(',');
      sql += ` AND p.code NOT IN (${placeholders})`;
      params.push(...excludedCodes);
    }

    sql += `
      GROUP BY p.id, p.code, p.color_hex, c.name
      ORDER BY p.code
    `;

    const consumptionData = await query(sql, params);

    res.json({
      data: consumptionData,
      summary: {
        total_materials: consumptionData.length,
        total_consumption: consumptionData.reduce((sum, item) => sum + item.total_quantity, 0)
      }
    });
  } catch (error) {
    console.error('获取消耗统计失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取单个图纸的消耗详情
router.get('/consumption/:drawingId', async (req, res) => {
  try {
    const userId = req.user.id;
    const drawingId = req.params.drawingId;

    // 验证图纸权限
    const drawing = await query('SELECT * FROM drawings WHERE id = ? AND user_id = ?', [drawingId, userId]);
    if (!drawing || drawing.length === 0) {
      return res.status(404).json({ error: '图纸未找到或无权限' });
    }

    // 获取该图纸的所有完工消耗记录
    const consumptionSql = `
      SELECT
        cr.id as record_id,
        cr.title as record_title,
        cr.consumption_date,
        cr.created_at,
        ci.quantity as consumed_quantity,
        p.code as product_code,
        p.color_code,
        c.name as category_name
      FROM consumption_records cr
      JOIN consumption_items ci ON ci.record_id = cr.id
      JOIN products p ON p.id = ci.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE cr.drawing_id = ? AND cr.user_id = ? AND cr.record_type IN ('完工消耗', 'drawing')
      ORDER BY cr.consumption_date DESC, cr.created_at DESC
    `;

    const consumptionRecords = await query(consumptionSql, [drawingId, userId]);

    // 按记录分组统计
    const groupedRecords = {};
    consumptionRecords.forEach(record => {
      if (!groupedRecords[record.record_id]) {
        groupedRecords[record.record_id] = {
          record_id: record.record_id,
          record_title: record.record_title,
          consumption_date: record.consumption_date,
          created_at: record.created_at,
          items: []
        };
      }
      groupedRecords[record.record_id].items.push({
        product_code: record.product_code,
        color_code: record.color_code,
        category_name: record.category_name,
        quantity: record.consumed_quantity
      });
    });

    const records = Object.values(groupedRecords);

    // 计算图纸总消耗
    const totalConsumption = consumptionRecords.reduce((sum, record) => sum + record.consumed_quantity, 0);

    res.json({
      drawing: drawing[0],
      consumption_records: records,
      summary: {
        total_records: records.length,
        total_consumption: totalConsumption
      }
    });
  } catch (error) {
    console.error('获取图纸消耗详情失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 销售数据统计
router.get('/sales', async (req, res) => {
  try {
    const userId = req.user.id;
    const days = req.query.days ? parseInt(req.query.days) : 30;
    const groupBy = req.query.groupBy || 'day';

    let dateFormat = 'DATE(created_at)';
    if (groupBy === 'week') {
      dateFormat = `DATE(created_at, '-6 day', 'weekday 0')`;
    } else if (groupBy === 'month') {
      dateFormat = `DATE_FORMAT(created_at, '%Y-%m')`;
    }

    let dateFilter = '';
    const params = [userId];
    if (days && days !== 'all') {
      dateFilter = `AND DATE(created_at) >= DATE('now', '-${days} days')`;
    }

    // 时间趋势
    const timeTrendSql = `
      SELECT
        ${dateFormat} as date,
        COUNT(*) as order_count,
        SUM(total_amount) as total_amount,
        SUM(total_cost) as total_cost,
        SUM(profit) as profit
      FROM sales_orders
      WHERE user_id = ? ${dateFilter}
      GROUP BY ${dateFormat}
      ORDER BY date DESC
      LIMIT 50
    `;

    // 产品排行
    const productRankingSql = `
      SELECT
        oi.drawing_id,
        oi.drawing_title,
        SUM(oi.quantity) as quantity,
        SUM(oi.quantity * oi.reference_sales_price) as amount,
        SUM(oi.total_cost) as cost,
        SUM(oi.quantity * oi.reference_sales_price - oi.total_cost) as profit
      FROM order_items oi
      JOIN sales_orders so ON so.id = oi.order_id
      WHERE so.user_id = ? ${dateFilter ? dateFilter.replace('DATE(created_at)', 'DATE(so.created_at)') : ''}
      GROUP BY oi.drawing_id
      ORDER BY profit DESC
      LIMIT 10
    `;

    // 利润汇总
    const profitAnalysisSql = `
      SELECT
        SUM(total_amount) as total_revenue,
        SUM(total_cost) as total_cost,
        SUM(profit) as total_profit,
        AVG(total_amount) as avg_order_amount
      FROM sales_orders
      WHERE user_id = ? ${dateFilter}
    `;

    const [timeTrend, productRanking, profitAnalysis] = await Promise.all([
      query(timeTrendSql, params),
      query(productRankingSql, params),
      query(profitAnalysisSql, params)
    ]);

    res.json({
      timeTrend: timeTrend.reverse(),
      productRanking,
      profitAnalysis: profitAnalysis[0] || { total_revenue: 0, total_cost: 0, total_profit: 0, avg_order_amount: 0 }
    });
  } catch (error) {
    console.error('获取销售统计失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 库存分析报表
router.get('/inventory', async (req, res) => {
  try {
    const userId = req.user.id;

    // 获取预警阈值
    const thresholdResult = await query("SELECT value FROM settings WHERE key = 'warning_threshold'");
    const warningThreshold = thresholdResult && thresholdResult.length > 0 ? parseInt(thresholdResult[0].value) : 300;

    // 库存预警（低于安全库存、零库存、负库存）
    const warningsSql = `
      SELECT
        p.id,
        p.code,
        c.name as category_name,
        ui.quantity as current_stock,
        ${warningThreshold} as warning_threshold,
        ui.unit_price
      FROM user_inventory ui
      JOIN products p ON p.id = ui.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE ui.user_id = ?
        AND (ui.quantity < ${warningThreshold} OR ui.quantity < 0)
      ORDER BY ui.quantity ASC
    `;

    // 类别分布
    const categoryDistributionSql = `
      SELECT
        c.name as category_name,
        COUNT(DISTINCT p.id) as product_count,
        SUM(ui.quantity) as total_quantity,
        SUM(ui.quantity * ui.unit_price) as total_value
      FROM user_inventory ui
      JOIN products p ON p.id = ui.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE ui.user_id = ?
      GROUP BY c.id, c.name
      ORDER BY total_value DESC
    `;

    // 汇总统计
    const summarySql = `
      SELECT
        COUNT(DISTINCT p.id) as total_products,
        SUM(ui.quantity) as total_quantity,
        SUM(ui.quantity * ui.unit_price) as total_value,
        SUM(CASE WHEN ui.quantity < ${warningThreshold} OR ui.quantity < 0 THEN 1 ELSE 0 END) as warning_count
      FROM user_inventory ui
      JOIN products p ON p.id = ui.product_id
      WHERE ui.user_id = ?
    `;

    const [warnings, categoryDistribution, summaryResult] = await Promise.all([
      query(warningsSql, [userId]),
      query(categoryDistributionSql, [userId]),
      query(summarySql, [userId])
    ]);

    res.json({
      warnings,
      categoryDistribution,
      summary: summaryResult[0] || { total_products: 0, total_quantity: 0, total_value: 0, warning_count: 0 }
    });
  } catch (error) {
    console.error('获取库存分析失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 采购数据统计
router.get('/purchase', async (req, res) => {
  try {
    const userId = req.user.id;
    const days = req.query.days ? parseInt(req.query.days) : 30;

    let dateFilter = '';
    if (days && days !== 'all') {
      dateFilter = `AND DATE(created_at) >= DATE('now', '-${days} days')`;
    }

    // 采购趋势
    const timeTrendSql = `
      SELECT
        DATE(created_at) as date,
        COUNT(*) as order_count,
        SUM(total_amount) as total_amount,
        SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as received_count,
        SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) as returned_count
      FROM orders
      WHERE user_id = ? ${dateFilter}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 50
    `;

    // 状态分布
    const statusDistributionSql = `
      SELECT
        status,
        COUNT(*) as count,
        SUM(total_amount) as amount
      FROM orders
      WHERE user_id = ?
      GROUP BY status
      ORDER BY count DESC
    `;

    // 汇总统计
    const summarySql = `
      SELECT
        COUNT(*) as total_orders,
        SUM(total_amount) as total_amount,
        SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as received_count,
        SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) as returned_count
      FROM orders
      WHERE user_id = ? ${dateFilter}
    `;

    const [timeTrend, statusDistribution, summaryResult] = await Promise.all([
      query(timeTrendSql, [userId]),
      query(statusDistributionSql, [userId]),
      query(summarySql, [userId])
    ]);

    const summary = summaryResult[0] || { total_orders: 0, total_amount: 0, received_count: 0, returned_count: 0 };
    summary.received_rate = summary.total_orders > 0 ? (summary.received_count / summary.total_orders) * 100 : 0;
    summary.returned_rate = summary.total_orders > 0 ? (summary.returned_count / summary.total_orders) * 100 : 0;

    res.json({
      timeTrend: timeTrend.reverse(),
      statusDistribution,
      summary
    });
  } catch (error) {
    console.error('获取采购统计失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 完工统计报表
router.get('/completion', async (req, res) => {
  try {
    const userId = req.user.id;
    const days = req.query.days || '30';

    let dateFilter = '';
    if (days !== 'all') {
      const numDays = parseInt(days);
      dateFilter = `AND DATE(created_at) >= DATE('now', '-${numDays} days')`;
    }

    // 时间趋势
    const timeTrendSql = `
      SELECT
        DATE(created_at) as date,
        COUNT(*) as completion_count,
        SUM(quantity) as total_quantity,
        COUNT(DISTINCT drawing_id) as unique_drawings
      FROM completion_records
      WHERE user_id = ? ${dateFilter}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 50
    `;

    // 图纸排行
    const drawingRankingSql = `
      SELECT
        drawing_id,
        d.title,
        COUNT(*) as completion_count,
        SUM(quantity) as total_quantity,
        MAX(cr.created_at) as last_completion_date,
        ROUND(AVG(quantity), 2) as avg_quantity
      FROM completion_records cr
      JOIN drawings d ON d.id = cr.drawing_id
      WHERE cr.user_id = ? ${dateFilter.replace('created_at', 'cr.created_at')}
      GROUP BY drawing_id
      ORDER BY completion_count DESC
      LIMIT 10
    `;

    // 汇总统计
    const summarySql = `
      SELECT
        COUNT(*) as total_completions,
        SUM(quantity) as total_quantity,
        COUNT(DISTINCT drawing_id) as unique_drawings
      FROM completion_records
      WHERE user_id = ? ${dateFilter}
    `;

    const [timeTrend, drawingRanking, summaryResult] = await Promise.all([
      query(timeTrendSql, [userId]),
      query(drawingRankingSql, [userId]),
      query(summarySql, [userId])
    ]);

    const summary = summaryResult[0] || { total_completions: 0, total_quantity: 0, unique_drawings: 0 };
    const daysSpan = days === 'all' ? 1 : parseInt(days);
    summary.daily_avg = summary.total_completions / daysSpan;

    res.json({
      timeTrend: timeTrend.reverse(),
      drawingRanking,
      summary
    });
  } catch (error) {
    console.error('获取完工统计失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 综合经营报表
router.get('/business', async (req, res) => {
  try {
    const userId = req.user.id;
    const days = req.query.days ? parseInt(req.query.days) : 30;

    let dateFilter = '';
    if (days && days !== 'all') {
      dateFilter = `AND DATE(created_at) >= DATE('now', '-${days} days')`;
    }

    // KPI统计
    const kpisSql = `
      SELECT
        (SELECT COALESCE(SUM(total_amount), 0) FROM sales_orders WHERE user_id = ? ${dateFilter}) as total_revenue,
        (SELECT COALESCE(SUM(total_cost), 0) FROM sales_orders WHERE user_id = ? ${dateFilter}) as total_cost,
        (SELECT COALESCE(SUM(profit), 0) FROM sales_orders WHERE user_id = ? ${dateFilter}) as total_profit,
        (SELECT COALESCE(SUM(ui.quantity * ui.unit_price), 0) FROM user_inventory ui WHERE ui.user_id = ?) as total_inventory_value,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE user_id = ? ${dateFilter}) as total_purchase_amount
    `;

    // 进销存趋势
    const inflowOutflowSql = `
      SELECT
        DATE(created_at) as period,
        (SELECT COALESCE(SUM(total_amount), 0) FROM sales_orders WHERE user_id = ? AND DATE(created_at) = DATE(orders.created_at)) as sales,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE user_id = ? AND DATE(created_at) = DATE(orders.created_at)) as purchase,
        0 as inventory_change,
        (SELECT COALESCE(SUM(profit), 0) FROM sales_orders WHERE user_id = ? AND DATE(created_at) = DATE(orders.created_at)) as profit
      FROM orders
      WHERE user_id = ? ${dateFilter}
      GROUP BY DATE(created_at)
      ORDER BY period DESC
      LIMIT 30
    `;

    // 物料表现（简化版）
    const productPerformanceSql = `
      SELECT
        p.code as product_code,
        c.name as category_name,
        0 as sales_quantity,
        0 as purchase_quantity,
        COALESCE(ui.quantity, 0) as current_stock,
        0 as turnover_rate
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN user_inventory ui ON ui.product_id = p.id AND ui.user_id = ?
      WHERE ui.quantity IS NOT NULL
      ORDER BY current_stock DESC
      LIMIT 20
    `;

    const [kpisResult, inflowOutflow, productPerformance] = await Promise.all([
      query(kpisSql, [userId, userId, userId, userId, userId]),
      query(inflowOutflowSql, [userId, userId, userId, userId]),
      query(productPerformanceSql, [userId])
    ]);

    const kpis = kpisResult[0] || {};
    kpis.profit_margin = kpis.total_revenue > 0 ? (kpis.total_profit / kpis.total_revenue) * 100 : 0;

    res.json({
      kpis,
      inflowOutflow: inflowOutflow.reverse(),
      productPerformance
    });
  } catch (error) {
    console.error('获取综合经营报表失败:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
