import React, { useState } from 'react';
import { AdditionalCost } from '../types/order';

interface AdditionalCostsListProps {
  costs: AdditionalCost[];
  onChange: (costs: AdditionalCost[]) => void;
  readonly?: boolean;
}

const AdditionalCostsList: React.FC<AdditionalCostsListProps> = ({ costs, onChange, readonly = false }) => {
  const [newCostName, setNewCostName] = useState('');
  const [newCostAmount, setNewCostAmount] = useState(0);

  const handleAddCost = () => {
    if (!newCostName.trim() || newCostAmount <= 0) return;
    const newCost: AdditionalCost = {
      cost_name: newCostName.trim(),
      cost_amount: parseFloat(newCostAmount.toFixed(2)),
    };
    onChange([...costs, newCost]);
    setNewCostName('');
    setNewCostAmount(0);
  };

  const handleRemoveCost = (index: number) => {
    const newCosts = [...costs];
    newCosts.splice(index, 1);
    onChange(newCosts);
  };

  const totalAdditionalCost = costs.reduce((sum, cost) => sum + (cost.cost_amount || 0), 0);

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">其他成本项目</label>

      {costs.length === 0 ? (
        <div className="text-sm text-gray-400 py-2 text-center border border-dashed rounded">
          暂无其他成本
        </div>
      ) : (
        <div className="border rounded divide-y">
          {costs.map((cost, index) => (
            <div key={index} className="p-2 flex items-center justify-between text-sm">
              <div className="flex-1">{cost.cost_name}</div>
              <div className="text-right ml-2">
                <span className="font-medium text-orange-600">￥{cost.cost_amount?.toFixed(2)}</span>
                {!readonly && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCost(index)}
                    className="text-xs text-red-600 hover:text-red-800 ml-2"
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!readonly && (
        <div className="flex items-center space-x-2">
          <input
            type="text"
            placeholder="成本项目名称"
            value={newCostName}
            onChange={(e) => setNewCostName(e.target.value)}
            className="flex-1 border rounded p-2 text-sm"
          />
          <input
            type="number"
            step="0.01"
            placeholder="金额"
            value={newCostAmount || ''}
            onChange={(e) => setNewCostAmount(parseFloat(e.target.value) || 0)}
            className="w-24 border rounded p-2 text-sm"
          />
          <button
            type="button"
            onClick={handleAddCost}
            disabled={!newCostName.trim() || newCostAmount <= 0}
            className="px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:bg-gray-300"
          >
            添加
          </button>
        </div>
      )}

      <div className="flex justify-between items-center text-sm bg-gray-50 p-2 rounded">
        <span>其他成本合计:</span>
        <span className="font-bold text-orange-600">￥{totalAdditionalCost.toFixed(2)}</span>
      </div>
    </div>
  );
};

export default AdditionalCostsList;
