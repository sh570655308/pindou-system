const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/database/database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('开始创建多维度管理系统的表...');

db.serialize(() => {
  // 1. 目录表
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
  )`, (err) => {
    if (err) console.error('创建drawing_folders失败:', err);
    else console.log('✓ drawing_folders表创建成功');
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_folders_user_id ON drawing_folders(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_folders_parent_id ON drawing_folders(parent_id)`);

  // 2. 标签表
  db.run(`CREATE TABLE IF NOT EXISTS drawing_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#10B981',
    usage_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, name)
  )`, (err) => {
    if (err) console.error('创建drawing_tags失败:', err);
    else console.log('✓ drawing_tags表创建成功');
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_tags_user_id ON drawing_tags(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_tags_usage ON drawing_tags(user_id, usage_count DESC)`);

  // 3. 图纸-目录关联表
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

  // 4. 图纸-标签关联表
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

  // 5. 扩展drawings表
  db.run(`ALTER TABLE drawings ADD COLUMN archived INTEGER DEFAULT 0`, () => {});
  db.run(`ALTER TABLE drawings ADD COLUMN folder_id INTEGER`, () => {});
  db.run(`ALTER TABLE drawings ADD COLUMN view_count INTEGER DEFAULT 0`, () => {});
  db.run(`ALTER TABLE drawings ADD COLUMN favorite INTEGER DEFAULT 0`, () => {});

  db.run(`CREATE INDEX IF NOT EXISTS idx_drawings_archived ON drawings(user_id, archived)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_drawings_folder ON drawings(user_id, folder_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_drawings_favorite ON drawings(user_id, favorite)`);

  // 6. 用户偏好设置表
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
  )`, (err) => {
    if (err) console.error('创建user_preferences失败:', err);
    else console.log('✓ user_preferences表创建成功');
  });

  // 数据迁移
  console.log('\n开始数据迁移...');

  // 为每个用户创建"未分类"默认目录
  db.run(`
    INSERT INTO drawing_folders (user_id, name, color, sort_order)
    SELECT id, '未分类', '#9CA3AF', 9999
    FROM users
    WHERE NOT EXISTS (
      SELECT 1 FROM drawing_folders
      WHERE user_id = users.id AND name = '未分类'
    )
  `, (err) => {
    if (err) console.error('创建未分类目录失败:', err);
    else console.log('✓ 未分类目录创建成功');
  });

  // 创建示例标签
  db.run(`
    INSERT INTO drawing_tags (user_id, name, color)
    SELECT id, '待完成', '#F59E0B' FROM users
    UNION
    SELECT id, '已完成', '#10B981' FROM users
    UNION
    SELECT id, '高难度', '#EF4444' FROM users
    UNION
    SELECT id, '简单', '#3B82F6' FROM users
  `, (err) => {
    if (err) console.error('创建示例标签失败:', err);
    else console.log('✓ 示例标签创建成功');
  });

  // 验证表创建
  console.log('\n验证表创建...');
  db.all('SELECT name FROM sqlite_master WHERE type="table" AND name LIKE "drawing_%"', (err, rows) => {
    if (err) {
      console.error('验证失败:', err);
    } else {
      console.log('✓ 创建的表:', rows.map(r => r.name));
    }

    // 查询标签数据
    db.all('SELECT * FROM drawing_tags', (err, rows) => {
      if (err) {
        console.error('查询标签失败:', err);
      } else {
        console.log('\n当前标签列表:', JSON.stringify(rows, null, 2));
      }

      db.close(() => {
        console.log('\n✅ 数据库迁移完成！');
        process.exit(0);
      });
    });
  });
});
