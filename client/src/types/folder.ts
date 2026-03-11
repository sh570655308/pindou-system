/**
 * 目录/文件夹相关类型定义
 */

// 目录节点
export interface FolderNode {
  id: number;
  name: string;
  color: string;
  icon?: string;
  parent_id: number | null;
  sort_order: number;
  drawing_count: number;
  created_at?: string;
  updated_at?: string;
  children?: FolderNode[];
  expanded?: boolean; // UI状态：是否展开
}

// 目录表单数据（用于新建/编辑）
export interface FolderFormData {
  id?: number;
  name: string;
  parent_id?: number | null;
  color?: string;
  icon?: string;
  sort_order?: number;
}

// 目录树选项（用于树形选择器）
export interface FolderTreeOption {
  id: number;
  name: string;
  color: string;
  children?: FolderTreeOption[];
}
