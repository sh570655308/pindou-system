import React from 'react';
import { OrderItem } from '../types/order';
import { formatBeijingTimeDate } from '../utils/time';

interface OrderItemsListProps {
  items: OrderItem[];
  onChange?: (items: OrderItem[]) => void;
  readonly?: boolean;
}

const OrderItemsList: React.FC<OrderItemsListProps> = ({ items, onChange, readonly = false }) => {
  const handleRemoveItem = (index: number) => {
    if (readonly) return;
    const newItems = [...items];
    newItems.splice(index, 1);
    onChange?.(newItems);
  };

  const totalMaterialCost = items.reduce((sum, item) => sum + (item.total_cost || 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium">完工记录明细</label>
        {!readonly && (
          <span className="text-xs text-gray-500">共 {items.length} 项</span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-gray-400 py-2 text-center border border-dashed rounded">
          暂无完工记录，请添加
        </div>
      ) : (
        <div className="border rounded divide-y max-h-48 overflow-y-auto">
          {items.map((item, index) => (
            <div key={index} className="p-2 flex items-center justify-between text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{item.drawing_title}</div>
                <div className="text-gray-500 text-xs">
                  数量: {item.quantity} × 单价: ￥{item.unit_cost?.toFixed(4)}
                </div>
                <div className="text-gray-500 text-xs">
                  估算成本: ￥{item.total_cost?.toFixed(2)} | 参考售价: ￥{item.reference_sales_price?.toFixed(2) || '0.00'}
                </div>
                {item.completion_image && (
                  <img
                    src={`${window.location.origin}/uploads/drawings/${item.completion_image}`}
                    alt="完工图"
                    className="w-12 h-12 object-cover rounded mt-1 cursor-pointer"
                    onClick={() => window.open(`/uploads/drawings/${item.completion_image}`, '_blank')}
                  />
                )}
              </div>
              <div className="text-right ml-2">
                <div className="font-medium text-indigo-600">￥{item.total_cost?.toFixed(2)}</div>
                {!readonly && (
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(index)}
                    className="text-xs text-red-600 hover:text-red-800 mt-1"
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center text-sm bg-gray-50 p-2 rounded">
        <span>直接物料成本合计:</span>
        <span className="font-bold text-indigo-600">￥{totalMaterialCost.toFixed(2)}</span>
      </div>
      <div className="flex justify-between items-center text-sm bg-gray-50 p-2 rounded">
        <span>直接物料数量合计:</span>
        <span className="font-bold text-gray-700">{items.reduce((sum, item) => sum + (item.total_material_quantity || 0), 0)} 颗</span>
      </div>
    </div>
  );
};

export default OrderItemsList;
