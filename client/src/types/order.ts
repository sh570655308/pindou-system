/**
 * 订单相关类型定义
 */

// 订单明细项
export interface OrderItem {
  id?: number;
  order_id?: number;
  completion_record_id: number;
  drawing_id: number;
  drawing_title: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  reference_sales_price?: number;  // NEW
  total_material_quantity?: number;  // NEW
  completion_image?: string;
  completion_date?: string;
  created_at?: string;
}

// 其他成本项
export interface AdditionalCost {
  id?: number;
  order_id?: number;
  cost_name: string;
  cost_amount: number;
  sort_order?: number;
  created_at?: string;
}

// 完工记录（用于订单选择）
export interface CompletionRecordForOrder {
  id: number;
  user_id: number;
  drawing_id: number;
  quantity: number;
  image_path?: string;
  created_at?: string;
  completed_at?: string;
  drawing_title?: string;
  unit_cost?: number;
  reference_sales_price?: number;  // NEW
  total_material_quantity?: number;  // NEW
}

// 订单状态
export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'completed' | 'cancelled';

// 订单主体
export interface Order {
  id: number;
  user_id: number;
  order_no: string;
  total_amount: number;
  total_cost: number;
  profit: number;
  status: OrderStatus;
  remarks?: string;
  created_at?: string;
  updated_at?: string;
  // 列表时的统计字段
  items_count?: number;
  items_summary?: string;
  // 详情时包含的关联数据
  items?: OrderItem[];
  additional_costs?: AdditionalCost[];
}

// 订单表单数据（用于新建/编辑）
export interface OrderFormData {
  id?: number;
  total_amount: number;
  status: OrderStatus;
  remarks: string;
  items: OrderItem[];
  additional_costs: AdditionalCost[];
}
