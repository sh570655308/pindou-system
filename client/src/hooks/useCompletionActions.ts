import { useState } from 'react';
import api from '../utils/api';

export interface CompletionRecord {
  id: number;
  drawing_id: number;
  quantity: number;
  image_path?: string;
  created_at?: string;
  completed_at?: string | null;
  satisfaction?: number | null;
  is_revoked?: number | boolean;
}

export interface CompletionActionsCallbacks {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export const useCompletionActions = (callbacks?: CompletionActionsCallbacks) => {
  const [loading, setLoading] = useState<boolean>(false);

  const handleUndo = async (recId: number) => {
    if (!window.confirm('确认撤销此完工记录？此操作会将已扣减的库存还原。')) return;
    setLoading(true);
    try {
      await api.post(`/completions/${recId}/undo`);
      callbacks?.onSuccess?.();
      alert('撤销成功');
    } catch (err: any) {
      console.error('撤销失败', err);
      const errorMsg = err?.response?.data?.error || '撤销失败';
      callbacks?.onError?.(errorMsg);
      alert(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (recId: number) => {
    if (!window.confirm('确认删除此已撤销的完工记录？此操作不可撤销。')) return;
    setLoading(true);
    try {
      await api.delete(`/completions/${recId}`);
      callbacks?.onSuccess?.();
      alert('删除成功');
    } catch (err: any) {
      console.error('删除失败', err);
      const errorMsg = err?.response?.data?.error || '删除失败';
      callbacks?.onError?.(errorMsg);
      alert(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    handleUndo,
    handleDelete,
  };
};
