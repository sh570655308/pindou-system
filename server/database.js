const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// 获取基础目录（支持 pkg 打包）
const getBaseDir = () => {
  // pkg 打包后 process.pkg 存在，使用程序运行目录
  if (process.pkg) {
    return path.dirname(process.execPath);
  }
  // 开发环境使用源码目录的上级
  return path.join(__dirname, '..');
};

const baseDir = getBaseDir();

// 支持通过环境变量配置数据目录（Docker 部署时使用）
const dataDir = process.env.DATA_DIR || path.join(baseDir, 'data/database');
const dbPath = path.join(dataDir, 'database.sqlite');

// 确保数据目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const db = new sqlite3.Database(dbPath);

// 创建上传目录
const uploadsDir = process.env.UPLOADS_DIR || path.join(baseDir, 'server/uploads');
const drawingsDir = path.join(uploadsDir, 'drawings');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(drawingsDir)) {
  fs.mkdirSync(drawingsDir, { recursive: true });
}

// 初始化数据库表
function initializeDatabase() {
  db.serialize(() => {
    // 用户表
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 库存大类表
    db.run(`CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 尝试添加sort_order字段（如果表已存在但没有这个字段）
    db.run(`ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0`, (err) => {
      // 忽略错误（字段已存在或其他错误）
      if (!err) {
        // 如果字段添加成功，为已有数据初始化sort_order
        db.run(`UPDATE categories SET sort_order = id WHERE sort_order = 0 OR sort_order IS NULL`);
      }
    });

    // 尝试添加 enabled 字段（控制类别是否启用）
    db.run(`ALTER TABLE categories ADD COLUMN enabled INTEGER DEFAULT 1`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });

    // 为已有数据初始化sort_order（确保所有记录的sort_order都有值）
    db.run(`UPDATE categories SET sort_order = id WHERE sort_order = 0 OR sort_order IS NULL`);

    // 产品细类表
    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      color_code TEXT,
      color_hex TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      UNIQUE(category_id, code)
    )`);

    // 用户库存表
    db.run(`CREATE TABLE IF NOT EXISTS user_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      UNIQUE(user_id, product_id)
    )`);

    // 尝试添加unit_price字段（如果表已存在但没有这个字段）
    db.run(`ALTER TABLE user_inventory ADD COLUMN unit_price REAL DEFAULT 0`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });

    // 系统设置表（预警阈值等）
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);

    // 图纸档案表
    db.run(`CREATE TABLE IF NOT EXISTS drawings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      difficulty INTEGER DEFAULT 1,
      estimated_time INTEGER,
      width INTEGER,
      height INTEGER,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    // 尝试添加 completed_count 字段（记录图纸已完成次数）
    db.run(`ALTER TABLE drawings ADD COLUMN completed_count INTEGER DEFAULT 0`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });
    // 尝试添加 shared 字段（控制图纸是否被分享）
    db.run(`ALTER TABLE drawings ADD COLUMN shared INTEGER DEFAULT 0`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });
    // 尝试添加 pending_quantity 字段（每张图纸的默认待拼数量）
    db.run(`ALTER TABLE drawings ADD COLUMN pending_quantity INTEGER DEFAULT 1`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });
    // 尝试添加 price 字段（图纸材料成本价）
    db.run(`ALTER TABLE drawings ADD COLUMN price REAL DEFAULT 0`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });

    // 图纸图片表（存储图片路径，不存储二进制数据）
    db.run(`CREATE TABLE IF NOT EXISTS drawing_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drawing_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      image_type TEXT DEFAULT 'main',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (drawing_id) REFERENCES drawings(id) ON DELETE CASCADE
    )`);

    // 尝试添加 thumbnail_path 字段（如果表已存在但没有这个字段）
    db.run(`ALTER TABLE drawing_images ADD COLUMN thumbnail_path TEXT`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });

    // 图纸材料清单表（关联产品和图纸）
    db.run(`CREATE TABLE IF NOT EXISTS drawing_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drawing_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (drawing_id) REFERENCES drawings(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id),
      UNIQUE(drawing_id, product_id)
    )`);

    // 消耗记录表
    db.run(`CREATE TABLE IF NOT EXISTS consumption_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      drawing_id INTEGER,
      record_type TEXT DEFAULT 'manual',
      title TEXT NOT NULL,
      description TEXT,
      consumption_date DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (drawing_id) REFERENCES drawings(id) ON DELETE SET NULL
    )`);

    // 消耗明细表（关联消耗记录和产品）
    db.run(`CREATE TABLE IF NOT EXISTS consumption_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (record_id) REFERENCES consumption_records(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`);

    // 完工记录表（记录用户对某图纸的完工数量与可选图片）
    db.run(`CREATE TABLE IF NOT EXISTS completion_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      drawing_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      image_path TEXT,
      file_name TEXT,
      mime_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (drawing_id) REFERENCES drawings(id) ON DELETE CASCADE
    )`);

    // 索引：便于按用户/图纸查询完工记录
    db.run(`CREATE INDEX IF NOT EXISTS idx_completion_records_user_id ON completion_records(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_completion_records_drawing_id ON completion_records(drawing_id)`);
    // 尝试添加 completed_at 和 satisfaction 字段（如果表已存在但没有这些字段）
    db.run(`ALTER TABLE completion_records ADD COLUMN completed_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });
    db.run(`ALTER TABLE completion_records ADD COLUMN satisfaction INTEGER`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });
    // 尝试添加 updated_at 字段（用于记录更新时间，供 UPDATE 语句使用）
    db.run(`ALTER TABLE completion_records ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });
    // 尝试添加 image_hash 字段（用于记录图片的哈希以便去重）
    db.run(`ALTER TABLE completion_records ADD COLUMN image_hash TEXT`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });
    // 尝试添加 thumbnail_path 字段（用于存储缩略图路径）
    db.run(`ALTER TABLE completion_records ADD COLUMN thumbnail_path TEXT`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });

    // 库存变动记录表
    db.run(`CREATE TABLE IF NOT EXISTS inventory_change_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      change_type TEXT NOT NULL, -- manual_increase/manual_decrease/manual_set/order_received_increase/order_return_decrease
      source TEXT NOT NULL,      -- manual/order
      quantity_change INTEGER NOT NULL, -- 正数为增加，负数为减少
      quantity_before INTEGER,
      quantity_after INTEGER,
      order_id INTEGER,
      remark TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )`);

    // 采购订单表（用于统计在途库存）
    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_code TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      total_amount REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'in_transit', -- in_transit/received/returned
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // 销售订单表（新增加，用于管理图纸出售订单）
    db.run(`CREATE TABLE IF NOT EXISTS sales_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      completion_record_id INTEGER, -- 关联完工记录（可选，如果是从完工记录生成的）
      drawing_title TEXT,           -- 图纸名称（快照）
      completion_image TEXT,        -- 完工图路径（快照）
      completion_date DATETIME,     -- 完工日期（快照）
      cost_price REAL DEFAULT 0,    -- 成本价（快照）
      accessories_cost REAL DEFAULT 0, -- 配件成本（手工录入）
      freight REAL DEFAULT 0,       -- 运费（手工录入）
      material_loss REAL DEFAULT 0, -- 物料损耗（手工录入）
      selling_price REAL DEFAULT 0, -- 售价（手工录入）
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (completion_record_id) REFERENCES completion_records(id) ON DELETE SET NULL
    )`);

    // 尝试添加 material_loss 字段
    db.run(`ALTER TABLE sales_orders ADD COLUMN material_loss REAL DEFAULT 0`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });

    // 尝试添加订单新字段（支持订单编号、金额、成本、利润、状态、备注）
    db.run(`ALTER TABLE sales_orders ADD COLUMN order_no TEXT`, (err) => {
      // 忽略错误
    });
    db.run(`ALTER TABLE sales_orders ADD COLUMN total_amount REAL DEFAULT 0`, (err) => {
      // 忽略错误
    });
    db.run(`ALTER TABLE sales_orders ADD COLUMN total_cost REAL DEFAULT 0`, (err) => {
      // 忽略错误
    });
    db.run(`ALTER TABLE sales_orders ADD COLUMN profit REAL DEFAULT 0`, (err) => {
      // 忽略错误
    });
    db.run(`ALTER TABLE sales_orders ADD COLUMN status TEXT DEFAULT 'pending'`, (err) => {
      // 忽略错误
    });
    db.run(`ALTER TABLE sales_orders ADD COLUMN remarks TEXT`, (err) => {
      // 忽略错误
    });

    // 订单明细表（order_items）- 支持一个订单包含多个完工记录
    db.run(`CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      completion_record_id INTEGER NOT NULL,
      drawing_id INTEGER NOT NULL,
      drawing_title TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_cost REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      completion_image TEXT,
      completion_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (completion_record_id) REFERENCES completion_records(id),
      FOREIGN KEY (drawing_id) REFERENCES drawings(id)
    )`);

    // 订单其他成本表（order_additional_costs）
    db.run(`CREATE TABLE IF NOT EXISTS order_additional_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      cost_name TEXT NOT NULL,
      cost_amount REAL NOT NULL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE
    )`);

    // 尝试添加total_amount字段（如果表已存在但没有这个字段）
    db.run(`ALTER TABLE orders ADD COLUMN total_amount REAL DEFAULT 0`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });

    // 创建索引以优化查询性能
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawings_user_id ON drawings(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawings_status ON drawings(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_images_drawing_id ON drawing_images(drawing_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_materials_drawing_id ON drawing_materials(drawing_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_materials_product_id ON drawing_materials(product_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_consumption_records_user_id ON consumption_records(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_consumption_records_drawing_id ON consumption_records(drawing_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_consumption_records_date ON consumption_records(consumption_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_consumption_items_record_id ON consumption_items(record_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_consumption_items_product_id ON consumption_items(product_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_orders_user_id_status ON orders(user_id, status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_inv_logs_user_product ON inventory_change_logs(user_id, product_id, created_at DESC)`);
    // 订单相关索引
    db.run(`CREATE INDEX IF NOT EXISTS idx_sales_orders_user_id ON sales_orders(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_order_items_completion_record_id ON order_items(completion_record_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_order_additional_costs_order_id ON order_additional_costs(order_id)`);

    // 报表查询优化索引
    db.run(`CREATE INDEX IF NOT EXISTS idx_sales_orders_created_at ON sales_orders(user_id, created_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(user_id, created_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_completion_records_created_at ON completion_records(user_id, created_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_order_items_drawing_id ON order_items(drawing_id)`);

    // 初始化默认管理员账户（密码: admin123）
    const defaultAdminPassword = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO users (username, password, role)
            VALUES ('admin', ?, 'admin')`, [defaultAdminPassword]);

    // 初始化预警阈值
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('warning_threshold', '300')`);
    // 初始化默认单个物料售价
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('default_unit_price_per_material', '0.01')`);

    // 尝试添加 reference_sales_price 字段到 order_items 表
    db.run(`ALTER TABLE order_items ADD COLUMN reference_sales_price REAL DEFAULT 0`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });
    // 尝试添加 total_material_quantity 字段到 order_items 表
    db.run(`ALTER TABLE order_items ADD COLUMN total_material_quantity INTEGER DEFAULT 0`, (err) => {
      // 忽略错误（字段已存在或其他错误）
    });

    // ========== 多维度管理系统表 ==========
    // 1. 目录表 (drawing_folders)
    db.run(`CREATE TABLE IF NOT EXISTS drawing_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      parent_id INTEGER,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#3B82F6',
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES drawing_folders(id) ON DELETE CASCADE,
      UNIQUE(user_id, parent_id, name)
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_folders_user_id ON drawing_folders(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_folders_parent_id ON drawing_folders(parent_id)`);

    // 2. 标签表 (drawing_tags)
    db.run(`CREATE TABLE IF NOT EXISTS drawing_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#10B981',
      usage_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name)
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_tags_user_id ON drawing_tags(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_tags_usage ON drawing_tags(user_id, usage_count DESC)`);

    // 3. 图纸-目录关联表 (drawing_folder_relations)
    db.run(`CREATE TABLE IF NOT EXISTS drawing_folder_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drawing_id INTEGER NOT NULL,
      folder_id INTEGER NOT NULL,
      is_primary INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (drawing_id) REFERENCES drawings(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES drawing_folders(id) ON DELETE CASCADE,
      UNIQUE(drawing_id, folder_id)
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_folder_relations_drawing ON drawing_folder_relations(drawing_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_folder_relations_folder ON drawing_folder_relations(folder_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_folder_relations_primary ON drawing_folder_relations(drawing_id, is_primary)`);

    // 4. 图纸-标签关联表 (drawing_tag_relations)
    db.run(`CREATE TABLE IF NOT EXISTS drawing_tag_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drawing_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (drawing_id) REFERENCES drawings(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES drawing_tags(id) ON DELETE CASCADE,
      UNIQUE(drawing_id, tag_id)
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_tag_relations_drawing ON drawing_tag_relations(drawing_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_tag_relations_tag ON drawing_tag_relations(tag_id)`);

    // 5. 扩展 drawings 表字段
    db.run(`ALTER TABLE drawings ADD COLUMN archived INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE drawings ADD COLUMN folder_id INTEGER`, () => {});
    db.run(`ALTER TABLE drawings ADD COLUMN view_count INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE drawings ADD COLUMN favorite INTEGER DEFAULT 0`, () => {});

    db.run(`CREATE INDEX IF NOT EXISTS idx_drawings_archived ON drawings(user_id, archived)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawings_folder ON drawings(user_id, folder_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drawings_favorite ON drawings(user_id, favorite)`);

    // 6. 用户偏好设置表 (user_preferences)
    db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      expanded_folders TEXT DEFAULT '[]',
      default_view_mode TEXT DEFAULT 'tree',
      show_archived INTEGER DEFAULT 0,
      sidebar_width INTEGER DEFAULT 250,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
  });
}

// 获取默认颜色（示例）
function getDefaultColorHex(code) {
  const colors = {
    'A01': '#FFF9C4', 'A02': '#FFFDE7', 'A03': '#FFF9C4',
    'A04': '#FFF176', 'A05': '#FFF176', 'A06': '#FFB74D',
    'A07': '#FFB74D', 'A08': '#FFF176', 'A09': '#FFB74D',
    'A10': '#FFB74D', 'A11': '#FFCC80', 'A12': '#FFCC80',
    'A13': '#FFCC80', 'A14': '#EF5350', 'A15': '#FFF176',
    'A16': '#FFF9C4', 'A17': '#FFF176', 'A18': '#FFCC80'
  };
  return colors[code] || '#CCCCCC';
}

// 数据库查询辅助函数
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

// 获取数据库统计信息
function getDatabaseStats() {
  return new Promise(async (resolve, reject) => {
    try {
      const stats = {};

      // 获取各表记录数
      const tables = ['users', 'categories', 'products', 'user_inventory',
        'drawings', 'drawing_images', 'drawing_materials',
        'consumption_records', 'consumption_items', 'orders'];

      for (const table of tables) {
        const result = await get(`SELECT COUNT(*) as count FROM ${table}`);
        stats[table] = result ? result.count : 0;
      }

      // 获取数据库文件大小
      if (fs.existsSync(dbPath)) {
        const stat = fs.statSync(dbPath);
        stats.dbSize = stat.size;
        stats.dbSizeMB = (stat.size / 1024 / 1024).toFixed(2);
      }

      resolve(stats);
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  db,
  initializeDatabase,
  query,
  get,
  run,
  getDatabaseStats,
  uploadsDir,
  drawingsDir
};
