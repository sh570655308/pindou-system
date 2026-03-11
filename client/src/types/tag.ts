/**
 * 标签相关类型定义
 */

// 标签
export interface Tag {
  id: number;
  user_id: number;
  name: string;
  color: string;
  usage_count: number;
  created_at?: string;
}

// 标签表单数据（用于新建/编辑）
export interface TagFormData {
  id?: number;
  name: string;
  color?: string;
}

// 标签合并请求
export interface TagMergeRequest {
  source_tag_ids: number[];
  target_tag_id: number;
}

// 标签云布局模式
export type TagCloudLayout = 'list' | 'cloud';
