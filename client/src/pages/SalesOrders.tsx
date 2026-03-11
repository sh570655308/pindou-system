import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { formatBeijingTimeDate } from '../utils/time';
import OrderItemsList from '../components/OrderItemsList';
import AdditionalCostsList from '../components/AdditionalCostsList';
import CompletionRecordSelector from '../components/CompletionRecordSelector';
import { Order, OrderItem, AdditionalCost, OrderStatus } from '../types/order';

const SalesOrders: React.FC = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');

  // 新建/编辑订单模态框
  const [showOrderModal, setShowOrderModal] = useState<boolean>(false);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [showSelector, setShowSelector] = useState<boolean>(false);

  // 订单表单数据
  const [formData, setFormData] = useState<{
    total_amount: number;
    status: OrderStatus;
    remarks: string;
    items: OrderItem[];
    additional_costs: AdditionalCost[];
  }>({
    total_amount: 0,
    status: 'pending',
    remarks: '',
    items: [],
    additional_costs: []
  });

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);

      const res = await api.get(`/sales_orders?${params.toString()}`);
      setOrders(res.data.data || []);
    } catch (err) {
      console.error('加载订单列表失败', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = () => {
    setEditingOrderId(null);
    setFormData({
      total_amount: 0,
      status: 'pending',
      remarks: '',
      items: [],
      additional_costs: []
    });
    setShowOrderModal(true);
  };

  const handleEdit = async (id: number) => {
    try {
      const res = await api.get(`/sales_orders/${id}`);
      const order = res.data.order;
      setEditingOrderId(id);
      setFormData({
        total_amount: order.total_amount || 0,
        status: order.status || 'pending',
        remarks: order.remarks || '',
        items: order.items || [],
        additional_costs: order.additional_costs || []
      });
      setShowOrderModal(true);
    } catch (err) {
      console.error('加载订单详情失败', err);
      alert('加载订单详情失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('确认删除此订单吗？')) return;
    try {
      await api.delete(`/sales_orders/${id}`);
      setOrders(prev => prev.filter(o => o.id !== id));
    } catch (err) {
      console.error('删除失败', err);
      alert('删除失败');
    }
  };

  const handleSaveOrder = async () => {
    if (formData.items.length === 0) {
      alert('请至少添加一项完工记录');
      return;
    }
    if (formData.total_amount <= 0) {
      alert('订单金额必须大于0');
      return;
    }

    try {
      if (editingOrderId) {
        await api.put(`/sales_orders/${editingOrderId}`, formData);
        alert('订单更新成功');
      } else {
        await api.post('/sales_orders', formData);
        alert('订单创建成功');
      }
      setShowOrderModal(false);
      loadOrders();
    } catch (err: any) {
      console.error('保存订单失败', err);
      alert(err?.response?.data?.error || '保存订单失败');
    }
  };

  const handleAddItems = (items: OrderItem[]) => {
    setFormData({
      ...formData,
      items: [...formData.items, ...items]
    });
    setShowSelector(false);
  };

  // 计算成本合计
  const totalMaterialCost = formData.items.reduce((sum, item) => sum + (item.total_cost || 0), 0);
  const totalAdditionalCost = formData.additional_costs.reduce((sum, cost) => sum + (cost.cost_amount || 0), 0);
  const totalCost = totalMaterialCost + totalAdditionalCost;
  const profit = formData.total_amount - totalCost;

  // Calculate reference order amount
  const referenceOrderAmount = formData.items.reduce((sum, item) =>
    sum + (item.reference_sales_price || 0), 0
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">订单管理</h2>
        <button
          onClick={handleCreateNew}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          新建订单
        </button>
      </div>

      <div className="mb-4 flex items-center space-x-2">
        <input
          type="text"
          placeholder="搜索订单编号或备注"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded p-2 text-sm w-64"
        />
        <button onClick={() => loadOrders()} className="bg-gray-600 text-white px-4 py-2 rounded text-sm hover:bg-gray-700">
          查询
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">加载中...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单编号</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单金额</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">成本明细</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">利润</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 text-center text-gray-500 text-sm">暂无订单记录</td>
                  </tr>
                ) : (
                  orders.map(order => (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {order.order_no || `#${order.id}`}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ￥{order.total_amount?.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div>成本合计: ￥{order.total_cost?.toFixed(2)}</div>
                        {order.items_count && (
                          <div className="text-xs text-gray-400">包含 {order.items_count} 项完工记录</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`font-bold ${order.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ￥{order.profit?.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2 py-1 rounded text-xs ${
                          order.status === 'completed' ? 'bg-green-100 text-green-800' :
                          order.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {order.status === 'pending' ? '待处理' :
                           order.status === 'confirmed' ? '已确认' :
                           order.status === 'shipped' ? '已发货' :
                           order.status === 'completed' ? '已完成' :
                           order.status === 'cancelled' ? '已取消' : order.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {order.created_at ? formatBeijingTimeDate(order.created_at) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button onClick={() => handleEdit(order.id)} className="text-indigo-600 hover:text-indigo-900 mr-3">编辑</button>
                        <button onClick={() => handleDelete(order.id)} className="text-red-600 hover:text-red-900">删除</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新建/编辑订单模态框 */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-medium">{editingOrderId ? '编辑订单' : '新建订单'}</h3>
              <button type="button" className="text-gray-500" onClick={() => setShowOrderModal(false)}>关闭</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 订单金额 */}
              <div>
                <label className="block text-sm font-medium">订单金额 *</label>
                <div className="mt-1 relative">
                  <input
                    type="number"
                    step="0.01"
                    value={formData.total_amount || ''}
                    onChange={(e) => setFormData({ ...formData, total_amount: parseFloat(e.target.value) || 0 })}
                    className="w-full border rounded p-2 pr-32"
                  />
                  {referenceOrderAmount > 0 && (
                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-sm text-gray-500">
                      参考: ￥{referenceOrderAmount.toFixed(2)}
                    </div>
                  )}
                </div>
                {referenceOrderAmount > 0 && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, total_amount: referenceOrderAmount })}
                    className="mt-1 text-xs text-blue-600 hover:text-blue-800"
                  >
                    使用参考金额
                  </button>
                )}
              </div>

              {/* 状态 */}
              <div>
                <label className="block text-sm font-medium">订单状态</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as OrderStatus })}
                  className="mt-1 w-full border rounded p-2"
                >
                  <option value="pending">待处理</option>
                  <option value="confirmed">已确认</option>
                  <option value="shipped">已发货</option>
                  <option value="completed">已完成</option>
                  <option value="cancelled">已取消</option>
                </select>
              </div>

              {/* 完工记录 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium">完工记录 *</label>
                  <button
                    type="button"
                    onClick={() => setShowSelector(true)}
                    className="text-sm bg-indigo-100 text-indigo-700 px-3 py-1 rounded hover:bg-indigo-200"
                  >
                    + 添加完工记录
                  </button>
                </div>
                <OrderItemsList
                  items={formData.items}
                  onChange={(items) => setFormData({ ...formData, items })}
                  readonly={false}
                />
              </div>

              {/* 其他成本 */}
              <div>
                <AdditionalCostsList
                  costs={formData.additional_costs}
                  onChange={(costs) => setFormData({ ...formData, additional_costs: costs })}
                  readonly={false}
                />
              </div>

              {/* 备注 */}
              <div>
                <label className="block text-sm font-medium">备注</label>
                <textarea
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  className="mt-1 w-full border rounded p-2"
                  rows={3}
                />
              </div>

              {/* 成本汇总 */}
              <div className="bg-gray-50 p-4 rounded space-y-2">
                <div className="flex justify-between text-sm">
                  <span>直接物料成本:</span>
                  <span className="font-medium">￥{totalMaterialCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>其他成本:</span>
                  <span className="font-medium">￥{totalAdditionalCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t pt-2">
                  <span>成本合计:</span>
                  <span>￥{totalCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold">
                  <span>订单利润:</span>
                  <span className={profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                    ￥{profit.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 border-t bg-gray-50 flex justify-end space-x-3">
              <button
                type="button"
                className="px-4 py-2 bg-gray-200 rounded"
                onClick={() => setShowOrderModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                onClick={handleSaveOrder}
              >
                {editingOrderId ? '保存修改' : '创建订单'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 完工记录选择器 */}
      {showSelector && (
        <CompletionRecordSelector
          onConfirm={handleAddItems}
          onClose={() => setShowSelector(false)}
          selectedRecordIds={formData.items.map(i => i.completion_record_id)}
        />
      )}
    </div>
  );
};

export default SalesOrders;
