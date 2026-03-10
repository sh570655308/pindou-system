# 数据库结构设计文档

## 当前表结构

### 1. users - 用户表
- 用途：存储用户账号信息
- 字段：
  - id: 主键
  - username: 用户名（唯一）
  - password: 加密密码
  - role: 角色（user/admin）
  - created_at: 创建时间

### 2. categories - 库存大类表
- 用途：拼豆库存分类
- 字段：
  - id: 主键
  - name: 类别名称（唯一）
  - created_at: 创建时间

### 3. products - 产品细类表
- 用途：拼豆产品详情
- 字段：
  - id: 主键
  - category_id: 所属类别（外键→categories）
  - code: 产品代码（与category_id联合唯一）
  - color_code: 色号
  - color_hex: 颜色十六进制值
  - created_at: 创建时间

### 4. user_inventory - 用户库存表
- 用途：每个用户的库存数量
- 字段：
  - id: 主键
  - user_id: 用户ID（外键→users）
  - product_id: 产品ID（外键→products）
  - quantity: 库存数量
  - updated_at: 更新时间
  - 唯一约束：(user_id, product_id)

### 5. settings - 系统设置表
- 用途：系统配置参数
- 字段：
  - key: 设置键（主键）
  - value: 设置值

## 新增表结构（为图纸管理和消耗统计模块）

### 6. drawings - 图纸档案表
- 用途：存储拼豆图纸基本信息
- 字段：
  - id: 主键
  - user_id: 创建用户ID（外键→users）
  - title: 图纸标题
  - description: 图纸描述
  - difficulty: 难度等级（1-5）
  - estimated_time: 预计制作时间（分钟）
  - width: 图纸宽度（格子数）
  - height: 图纸高度（格子数）
  - status: 状态（draft/published/archived）
  - created_at: 创建时间
  - updated_at: 更新时间

### 7. drawing_images - 图纸图片表
- 用途：存储图纸的多张图片（主图、细节图等）
- 字段：
  - id: 主键
  - drawing_id: 图纸ID（外键→drawings，级联删除）
  - file_path: 图片文件路径（相对路径）
  - file_name: 原始文件名
  - file_size: 文件大小（字节）
  - mime_type: MIME类型（image/jpeg, image/png等）
  - image_type: 图片类型（main/detail/reference）
  - sort_order: 排序顺序
  - created_at: 上传时间
- 索引：drawing_id

### 8. drawing_materials - 图纸材料清单表
- 用途：图纸所需的产品及数量（关联库存模块）
- 字段：
  - id: 主键
  - drawing_id: 图纸ID（外键→drawings，级联删除）
  - product_id: 产品ID（外键→products）
  - quantity: 所需数量
  - sort_order: 排序顺序
  - created_at: 创建时间
- 唯一约束：(drawing_id, product_id)
- 索引：drawing_id, product_id

### 9. consumption_records - 消耗记录表
- 用途：记录拼豆消耗的主记录
- 字段：
  - id: 主键
  - user_id: 用户ID（外键→users）
  - drawing_id: 关联图纸ID（外键→drawings，可为NULL，表示非图纸消耗）
  - record_type: 记录类型（drawing/manual/other）
  - title: 记录标题
  - description: 记录描述
  - consumption_date: 消耗日期
  - created_at: 创建时间
  - updated_at: 更新时间
- 索引：user_id, drawing_id, consumption_date

### 10. consumption_items - 消耗明细表
- 用途：记录具体消耗的产品及数量（关联库存模块）
- 字段：
  - id: 主键
  - record_id: 消耗记录ID（外键→consumption_records，级联删除）
  - product_id: 产品ID（外键→products）
  - quantity: 消耗数量
  - created_at: 创建时间
- 索引：record_id, product_id

## 数据关联关系

```
users (用户)
  ├─→ user_inventory (用户库存)
  │     └─→ products (产品)
  │           └─→ categories (类别)
  │
  ├─→ drawings (图纸)
  │     ├─→ drawing_images (图纸图片)
  │     └─→ drawing_materials (图纸材料)
  │           └─→ products (产品)
  │
  └─→ consumption_records (消耗记录)
        ├─→ drawings (图纸) [可选]
        └─→ consumption_items (消耗明细)
              └─→ products (产品)
```

## 存储策略

### 图片存储
- **策略**：文件系统存储 + 数据库存储路径
- **目录结构**：
  ```
  server/
    uploads/
      drawings/
        {drawing_id}/
          main_*.jpg      # 主图
          detail_*.jpg    # 细节图
          reference_*.jpg # 参考图
  ```
- **优势**：
  - 避免数据库膨胀
  - 便于CDN部署
  - 支持图片缓存
  - 易于备份和管理

### 数据库扩展性
- SQLite 支持最大 140TB 数据库文件
- 建议监控数据库大小，超过 10GB 考虑迁移到 PostgreSQL
- 对于高频写入场景，考虑添加索引优化

### 索引建议
- user_inventory: (user_id, product_id) - 已设置唯一索引
- drawings: (user_id, created_at), (status)
- drawing_images: (drawing_id, sort_order)
- drawing_materials: (drawing_id), (product_id)
- consumption_records: (user_id, consumption_date), (drawing_id)
- consumption_items: (record_id), (product_id)

## 模块间数据调用

### 库存管理 → 图纸管理
- 查询产品：图纸材料清单需要从 products 表获取产品信息

### 图纸管理 → 库存管理
- 材料清单：drawing_materials 关联 products
- 库存检查：通过 user_inventory 检查用户是否有足够材料

### 消耗统计 → 库存管理
- 消耗记录：consumption_items 关联 products
- 自动扣减：创建消耗记录时，自动从 user_inventory 扣减

### 消耗统计 → 图纸管理
- 关联图纸：consumption_records 可以关联 drawings
- 统计报表：按图纸统计消耗量

## 性能优化建议

1. **分页查询**：所有列表查询都应支持分页
2. **图片缩略图**：生成缩略图，减少加载时间
3. **缓存策略**：常用数据（类别、产品列表）可缓存
4. **批量操作**：支持批量插入和更新
5. **数据库维护**：定期执行 VACUUM 优化数据库
