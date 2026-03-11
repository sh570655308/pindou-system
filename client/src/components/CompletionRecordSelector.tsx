import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { CompletionRecordForOrder, OrderItem } from '../types/order';
import { formatBeijingTimeDate } from '../utils/time';

interface CompletionRecordSelectorProps {
  onConfirm: (items: OrderItem[]) => void;
  onClose: () => void;
  selectedRecordIds?: number[];
}

const CompletionRecordSelector: React.FC<CompletionRecordSelectorProps> = ({
  onConfirm,
  onClose,
  selectedRecordIds = []
}) => {
  const [records, setRecords] = useState<CompletionRecordForOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadRecords();
  }, [search]);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);

      const res = await api.get(`/sales_orders/available-completions?${params.toString()}`);
      setRecords(res.data.data || []);
    } catch (err) {
      console.error('加载完工记录失败', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleCheck = (id: number) => {
    const newChecked = new Set(checkedIds);
    if (newChecked.has(id)) {
      newChecked.delete(id);
    } else {
      newChecked.add(id);
    }
    setCheckedIds(newChecked);
  };

  const handleConfirm = () => {
    const selectedRecords = records.filter(r => checkedIds.has(r.id));
    const items: OrderItem[] = selectedRecords.map(r => ({
      completion_record_id: r.id,
      drawing_id: r.drawing_id,
      drawing_title: r.drawing_title || `Drawing #${r.drawing_id}`,
      quantity: r.quantity,
      unit_cost: r.unit_cost || 0,
      total_cost: (r.quantity || 1) * (r.unit_cost || 0),
      reference_sales_price: r.reference_sales_price || 0,
      total_material_quantity: r.total_material_quantity || 0,
      completion_image: r.image_path || '',
      completion_date: r.completed_at || r.created_at || '',
    }));
    onConfirm(items);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-medium">选择完工记录</h3>
          <button type="button" className="text-gray-500" onClick={onClose}>关闭</button>
        </div>

        <div className="p-4 border-b">
          <input
            type="text"
            placeholder="搜索图纸名称"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border rounded p-2 text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-gray-500 py-8">加载中...</div>
          ) : records.length === 0 ? (
            <div className="text-center text-gray-400 py-8">暂无可用完工记录</div>
          ) : (
            <div className="space-y-2">
              {records.map(r => (
                <label
                  key={r.id}
                  className={`flex items-center p-3 border rounded cursor-pointer hover:bg-gray-50 ${
                    selectedRecordIds.includes(r.id) ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checkedIds.has(r.id)}
                    onChange={() => !selectedRecordIds.includes(r.id) && handleToggleCheck(r.id)}
                    disabled={selectedRecordIds.includes(r.id)}
                    className="mr-3"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.drawing_title}</div>
                    <div className="text-sm text-gray-500">
                      数量: {r.quantity} | 估算成本: ￥{r.unit_cost?.toFixed(4)} | 参考售价: ￥{r.reference_sales_price?.toFixed(2) || '0.00'}
                    </div>
                    <div className="text-xs text-gray-400">
                      完工时间: {r.completed_at ? formatBeijingTimeDate(r.completed_at) : '-'}
                    </div>
                  </div>
                  <div className="ml-2">
                    <span className="text-sm font-bold text-indigo-600">
                      ￥{((r.quantity || 1) * (r.unit_cost || 0)).toFixed(2)}
                    </span>
                  </div>
                  {r.image_path && (
                    <img
                      src={`${window.location.origin}/uploads/drawings/${r.image_path}`}
                      alt="完工图"
                      className="w-12 h-12 object-cover rounded ml-3"
                    />
                  )}
                  {selectedRecordIds.includes(r.id) && (
                    <span className="ml-2 text-xs text-gray-400">(已选)</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
          <div className="text-sm text-gray-600">
            已选择 <span className="font-bold text-indigo-600">{checkedIds.size}</span> 项
          </div>
          <div className="space-x-2">
            <button
              type="button"
              className="px-4 py-2 bg-gray-200 rounded"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300"
              onClick={handleConfirm}
              disabled={checkedIds.size === 0}
            >
              确认添加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompletionRecordSelector;
