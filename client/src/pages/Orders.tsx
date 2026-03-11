import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { formatBeijingTimeShort } from '../utils/time';
import { useLocalStorageState } from '../utils/useLocalStorageState';

type OrderStatus = 'in_transit' | 'received' | 'returned';

interface Order {
  id: number;
  product_code: string;
  quantity: number;
  total_amount?: number;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
}

const statusTabs: { key: OrderStatus; label: string }[] = [
  { key: 'in_transit', label: '在途' },
  { key: 'received', label: '已签收' },
  { key: 'returned', label: '已退货' },
];

const Orders: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  // 非持久化状态（临时状态）
  const [orders, setOrders] = useState<Order[]>([]);
  const [groupedOrders, setGroupedOrders] = useState<Record<string, Order[]>>({});
  const [orderDates, setOrderDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editProductCode, setEditProductCode] = useState('');
  const [editQuantity, setEditQuantity] = useState<number | ''>('');
  const [editTotalAmount, setEditTotalAmount] = useState<number | ''>('');

  // 持久化状态（页面刷新后保留）
  const [activeStatus, setActiveStatus] = useLocalStorageState<OrderStatus>('orders-activeStatus', 'in_transit');
  const [expandedDates, setExpandedDates] = useLocalStorageState<Set<string>>('orders-expandedDates', new Set(), {
    serialize: (value) => JSON.stringify(Array.from(value)),
    deserialize: (value) => new Set(JSON.parse(value))
  });
  const [selectedProducts, setSelectedProducts] = useLocalStorageState<Set<string>>('orders-selectedProducts', new Set(), {
    serialize: (value) => JSON.stringify(Array.from(value)),
    deserialize: (value) => new Set(JSON.parse(value))
  });
  const [quantity, setQuantity] = useLocalStorageState<number | ''>('orders-quantity', '');
  const [totalAmount, setTotalAmount] = useLocalStorageState<number | ''>('orders-totalAmount', '');
  const [expandedCategories, setExpandedCategories] = useLocalStorageState<Set<number>>('orders-expandedCategories', new Set(), {
    serialize: (value) => JSON.stringify(Array.from(value)),
    deserialize: (value) => new Set(JSON.parse(value))
  });
  const [scrollPosition, setScrollPosition] = useLocalStorageState<number>('orders-scrollPosition', 0);

  // 恢复滚动位置
  useEffect(() => {
    const timer = setTimeout(() => {
      window.scrollTo(0, scrollPosition);
    }, 100); // 延迟一点时间确保DOM已渲染完成
    return () => clearTimeout(timer);
  }, []); // 只在组件挂载时执行一次

  // 监听滚动事件并保存滚动位置
  useEffect(() => {
    const handleScroll = () => {
      setScrollPosition(window.scrollY);
    };

    // 使用防抖来避免过于频繁的保存
    let timeoutId: NodeJS.Timeout;
    const debouncedHandleScroll = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleScroll, 100);
    };

    window.addEventListener('scroll', debouncedHandleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', debouncedHandleScroll);
      clearTimeout(timeoutId);
    };
  }, [setScrollPosition]);

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatus]);

  useEffect(() => {
    if (showModal) {
      loadProducts();
    }
  }, [showModal]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      const res = await api.get<Order[]>('/orders', {
        params: { status: activeStatus },
      });
      const fetched: Order[] = res.data || [];
      setOrders(fetched);
      // group by date (YYYY-MM-DD)
      const map: Record<string, Order[]> = {};
      for (const o of fetched) {
        let d = 'unknown';
        if (o.created_at) {
          const dt = new Date(o.created_at);
          // use local date components to avoid timezone shifts when created_at has no timezone
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, '0');
          const day = String(dt.getDate()).padStart(2, '0');
          d = `${y}-${m}-${day}`;
        }
        if (!map[d]) map[d] = [];
        map[d].push(o);
      }
      // sort dates descending (newest first)
      const dates = Object.keys(map).sort((a, b) => (a < b ? 1 : -1));
      setGroupedOrders(map);
      setOrderDates(dates);
      // 保留用户当前的折叠/展开状态（刷新后不要自动收起），但移除已不存在的日期
      setExpandedDates((prev) => {
        const next = new Set<string>();
        for (const d of Array.from(prev)) {
          if (dates.includes(d)) next.add(d);
        }
        return next;
      });
    } catch (error) {
      console.error('加载订单失败', error);
      alert('加载订单失败');
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    try {
      setLoadingProducts(true);
      const [productsRes, categoriesRes] = await Promise.all([
        api.get('/inventory/products/all'),
        api.get('/inventory/categories'),
      ]);
      setAllProducts(productsRes.data);
      setCategories(categoriesRes.data);
      // 默认展开所有类别
      const allCategoryIds = new Set<number>(categoriesRes.data.map((c: any) => c.id));
      setExpandedCategories(allCategoryIds);
    } catch (error) {
      console.error('加载产品失败', error);
      alert('加载产品失败');
    } finally {
      setLoadingProducts(false);
    }
  };

  const toggleProduct = (productCode: string) => {
    setSelectedProducts((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(productCode)) {
        newSet.delete(productCode);
      } else {
        newSet.add(productCode);
      }
      return newSet;
    });
  };

  const toggleCategory = (categoryId: number) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    if (selectedProducts.size === allProducts.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(allProducts.map((p) => p.code)));
    }
  };

  const handleSubmitBatch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedProducts.size === 0) {
      alert('请至少选择一个产品');
      return;
    }

    const parsedQuantity = typeof quantity === 'string' ? parseInt(quantity, 10) : quantity;
    if (!parsedQuantity || parsedQuantity <= 0) {
      alert('请输入有效的数量（大于0的整数）');
      return;
    }

    const parsedTotalAmount = typeof totalAmount === 'string' ? parseFloat(totalAmount) : totalAmount;
    if (totalAmount !== '' && totalAmount !== null && totalAmount !== undefined) {
      if (isNaN(parsedTotalAmount) || parsedTotalAmount < 0) {
        alert('订单总额必须为大于等于0的数字');
        return;
      }
    }

    const items = Array.from(selectedProducts).map((productCode) => ({
      productCode,
      quantity: parsedQuantity,
    }));

    try {
      await api.post('/orders/batch', { 
        items,
        totalAmount: totalAmount !== '' && totalAmount !== null && totalAmount !== undefined && !isNaN(parsedTotalAmount)
          ? parsedTotalAmount 
          : undefined
      });
      setShowModal(false);
      setSelectedProducts(new Set());
      setQuantity('');
      setTotalAmount('');
      if (activeStatus === 'in_transit') {
        await loadOrders();
      }
    } catch (error: any) {
      alert(error.response?.data?.error || '创建订单失败');
    }
  };

  const updateStatus = async (orderId: number, status: OrderStatus) => {
    try {
      await api.put(`/orders/${orderId}/status`, { status });
      await loadOrders();
    } catch (error: any) {
      alert(error.response?.data?.error || '更新订单状态失败');
    }
  };

  const handleEdit = (order: Order) => {
    if (order.status !== 'in_transit') {
      alert('只能修改在途订单');
      return;
    }
    setEditingOrder(order);
    setEditProductCode(order.product_code);
    setEditQuantity(order.quantity);
    setEditTotalAmount(order.total_amount ?? '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;

    if (!editProductCode.trim()) {
      alert('请输入产品代码');
      return;
    }

    const parsedQuantity = typeof editQuantity === 'string' ? parseInt(editQuantity, 10) : editQuantity;
    if (!parsedQuantity || parsedQuantity <= 0) {
      alert('请输入有效的数量（大于0的整数）');
      return;
    }
    // 处理可选的订单总额
    let parsedTotalAmount: number | undefined = undefined;
    if (editTotalAmount !== '' && editTotalAmount !== null && editTotalAmount !== undefined) {
      const num = typeof editTotalAmount === 'string' ? parseFloat(editTotalAmount) : editTotalAmount;
      if (isNaN(num) || num < 0) {
        alert('订单总额必须为大于等于0的数字');
        return;
      }
      parsedTotalAmount = num;
    }

    try {
      await api.put(`/orders/${editingOrder.id}`, {
        productCode: editProductCode.trim(),
        quantity: parsedQuantity,
        totalAmount: parsedTotalAmount,
      });
      setEditingOrder(null);
      setEditProductCode('');
      setEditQuantity('');
      setEditTotalAmount('');
      await loadOrders();
    } catch (error: any) {
      alert(error.response?.data?.error || '修改订单失败');
    }
  };

  const handleDelete = async (order: Order) => {
    const statusText = order.status === 'in_transit' ? '在途' : order.status === 'received' ? '已签收' : '已退货';
    const confirmMsg = order.status === 'received' 
      ? `确定要删除这条已签收订单吗？删除后库存将减少 ${order.quantity}。`
      : `确定要删除这条${statusText}订单吗？`;
    
    if (!window.confirm(confirmMsg)) {
      return;
    }

    try {
      await api.delete(`/orders/${order.id}`);
      await loadOrders();
    } catch (error: any) {
      alert(error.response?.data?.error || '删除订单失败');
    }
  };

  const renderActions = (order: Order) => {
    if (order.status === 'in_transit') {
      return (
        <div className="flex space-x-2">
          <button
            onClick={() => handleEdit(order)}
            className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
          >
            修改
          </button>
          <button
            onClick={() => updateStatus(order.id, 'received')}
            className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
          >
            签收
          </button>
          <button
            onClick={() => updateStatus(order.id, 'returned')}
            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
          >
            退货
          </button>
          <button
            onClick={() => handleDelete(order)}
            className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            删除
          </button>
        </div>
      );
    }

    if (order.status === 'received') {
      return (
        <div className="flex space-x-2">
          <button
            onClick={() => updateStatus(order.id, 'in_transit')}
            className="px-3 py-1 text-sm bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
          >
            撤回在途
          </button>
          <button
            onClick={() => updateStatus(order.id, 'returned')}
            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
          >
            退货
          </button>
          <button
            onClick={() => handleDelete(order)}
            className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            删除
          </button>
        </div>
      );
    }

    // returned
    return (
      <div className="flex space-x-2">
        <button
          onClick={() => updateStatus(order.id, 'in_transit')}
          className="px-3 py-1 text-sm bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
        >
          撤回在途
        </button>
        <button
          onClick={() => updateStatus(order.id, 'received')}
          className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
        >
          签收
        </button>
        <button
          onClick={() => handleDelete(order)}
          className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          删除
        </button>
      </div>
    );
  };

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 操作栏 */}
        <div className="flex justify-end mb-6">
          <button
            onClick={() => setShowModal(true)}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            添加订单（多产品）
          </button>
          <label className="ml-3 inline-flex items-center px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded cursor-pointer text-sm">
            导入采购记录 (CSV)
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
              const f = e.target.files && e.target.files[0];
              if (!f) return;
              const form = new FormData();
              form.append('file', f);
              setImporting(true);
              setImportResult(null);
              try {
                const res = await api.post('/inventory/purchases/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
                setImportResult(res.data || null);
                alert('导入完成');
                // reload orders if viewing in_transit
                if (activeStatus === 'in_transit') await loadOrders();
              } catch (err: any) {
                console.error('导入失败', err);
                alert(err?.response?.data?.error || '导入失败');
              } finally {
                setImporting(false);
                // reset input
                (e.target as HTMLInputElement).value = '';
              }
            }} />
          </label>
          {/* 导入示例抬头说明 */}
          <div className="ml-3 mt-2 text-xs text-gray-500">
            示例表头：大类,代码,数量,金额,日期
          </div>
        </div>

        {/* 状态标签 */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b px-6 pt-4">
            <nav className="-mb-px flex space-x-4">
              {statusTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveStatus(tab.key)}
                  className={`px-4 py-2 border-b-2 font-medium text-sm ${
                    activeStatus === tab.key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : orderDates.length === 0 ? (
              importResult ? (
                <div className="text-left py-4">
                  <h4 className="font-medium mb-2">导入结果</h4>
                  <pre className="text-xs text-gray-700 bg-gray-50 p-3 rounded">{JSON.stringify(importResult, null, 2)}</pre>
                </div>
              ) : (
               <div className="text-center py-8 text-gray-500">当前状态下暂无订单</div>
              )
            ) : (
              <div className="space-y-4">
                {orderDates.map((date) => {
                  const group = groupedOrders[date] || [];
                  const isExpanded = expandedDates.has(date);
                  // format date like "2025年12月10日"
                  const [y, m, d] = date.split('-');
                  const label = `${y}年${parseInt(m,10)}月${parseInt(d,10)}日`;
                  return (
                    <div key={date} className="bg-white rounded-lg shadow overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedDates((prev) => {
                            const next = new Set(prev);
                            if (next.has(date)) next.delete(date);
                            else next.add(date);
                            return next;
                          });
                        }}
                        className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
                      >
                        <div className="flex items-center space-x-3">
                          <svg className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? 'transform rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="font-medium text-gray-900">{label}</span>
                          <span className="text-sm text-gray-500">({group.length})</span>
                        </div>
                    <div className="flex items-center space-x-2">
                      {/* 顺序：修改/改日 - 签收 - 撤回 - 退货 - 删除 */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const ids = group.map((o) => o.id);
                          const input = window.prompt('输入新的日期 (YYYY-MM-DD)', date);
                          if (!input) return;
                          if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
                            alert('日期格式不正确，应为 YYYY-MM-DD');
                            return;
                          }
                          try {
                            await api.post('/orders/batch/date', { ids, newDate: input });
                            alert('批量修改日期完成');
                            await loadOrders();
                          } catch (err) {
                            console.error('批量修改日期失败', err);
                            alert('批量修改日期失败');
                          }
                        }}
                        className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                        title="批量修改该日订单的创建日期"
                      >
                        批量改日
                      </button>
                      {activeStatus !== 'received' && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            const ids = group.map((o) => o.id);
                            if (!window.confirm(`确认要批量将 ${label} 的 ${group.length} 条订单全部签收吗？`)) return;
                            try {
                              await api.post('/orders/batch/status', { ids, status: 'received' });
                              alert('批量签收完成');
                              await loadOrders();
                            } catch (err) {
                              console.error('批量签收失败', err);
                              alert('批量签收失败');
                            }
                          }}
                          className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                          title="批量签收该日全部订单"
                        >
                          批量签收
                        </button>
                      )}
                      {(activeStatus === 'received' || activeStatus === 'returned') && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            const ids = group.map((o) => o.id);
                            if (!window.confirm(`确认要批量撤回 ${label} 的 ${group.length} 条订单为在途吗？`)) return;
                            try {
                              await api.post('/orders/batch/status', { ids, status: 'in_transit' });
                              alert('批量撤回完成');
                              await loadOrders();
                            } catch (err) {
                              console.error('批量撤回失败', err);
                              alert('批量撤回失败');
                            }
                          }}
                          className="px-3 py-1 text-sm bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                          title="批量撤回该日全部订单为在途"
                        >
                          批量撤回
                        </button>
                      )}
                      {activeStatus !== 'returned' && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            const ids = group.map((o) => o.id);
                            if (!window.confirm(`确认要批量将 ${label} 的 ${group.length} 条订单全部标记为退货吗？`)) return;
                            try {
                              await api.post('/orders/batch/status', { ids, status: 'returned' });
                              alert('批量退货完成');
                              await loadOrders();
                            } catch (err) {
                              console.error('批量退货失败', err);
                              alert('批量退货失败');
                            }
                          }}
                          className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                          title="批量退货该日全部订单"
                        >
                          批量退货
                        </button>
                      )}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const ids = group.map((o) => o.id);
                          if (!window.confirm(`确认要批量删除 ${label} 的 ${group.length} 条订单吗？此操作不可撤销。`)) return;
                          try {
                            await api.post('/orders/batch/delete', { ids });
                            alert('批量删除完成');
                            await loadOrders();
                          } catch (err) {
                            console.error('批量删除失败', err);
                            alert('批量删除失败');
                          }
                        }}
                        className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                        title="批量删除该日全部订单"
                      >
                        批量删除
                      </button>
                    </div>
                      </button>
                      {isExpanded && (
                        <div className="p-4 space-y-3">
                          {group.map((order) => (
                            <div key={order.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                              <div>
                                <div className="flex items-center space-x-3">
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                    {order.product_code}
                                  </span>
                                  <span className="text-gray-700 font-semibold">
                                    数量：{order.quantity}
                                  </span>
                                </div>
                                <div className="mt-1 text-xs text-gray-400">
                                  创建时间：{formatBeijingTimeShort(order.created_at)}
                                </div>
                              </div>
                              <div className="flex items-center space-x-4">
                                {renderActions(order)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 批量添加订单弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">添加采购订单</h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setSelectedProducts(new Set());
                  setQuantity('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSubmitBatch} className="flex flex-col flex-1 overflow-hidden">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedProducts.size === allProducts.length && allProducts.length > 0}
                      onChange={selectAll}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">全选</span>
                  </label>
                  <span className="text-sm text-gray-500">
                    已选择 {selectedProducts.size} 个产品
                  </span>
                </div>
                <div className="flex items-center space-x-3">
                  <label className="text-sm font-medium text-gray-700">数量：</label>
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value ? parseInt(e.target.value, 10) : '')}
                    className="w-32 px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    placeholder="输入数量"
                    required
                  />
                </div>
                <div className="flex items-center space-x-3">
                  <label className="text-sm font-medium text-gray-700">订单总额（元）：</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value ? parseFloat(e.target.value) : '')}
                    className="w-32 px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    placeholder="可选，输入订单总额"
                  />
                  <span className="text-xs text-gray-500">
                    {totalAmount && quantity && Number(totalAmount) > 0 && Number(quantity) > 0
                      ? `（平均单价：${(Number(totalAmount) / (Number(quantity) * selectedProducts.size)).toFixed(2)}元/个）`
                      : '将按数量平均分配'}
                  </span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {loadingProducts ? (
                  <div className="text-center py-12 text-gray-500">加载产品中...</div>
                ) : (
                  <div className="space-y-4">
                    {categories.map((category) => {
                      const categoryProducts = allProducts.filter(
                        (p) => p.category_id === category.id
                      );
                      const selectedInCategory = categoryProducts.filter((p) =>
                        selectedProducts.has(p.code)
                      ).length;
                      const isExpanded = expandedCategories.has(category.id);

                      return (
                        <div key={category.id} className="border rounded-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => toggleCategory(category.id)}
                            className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
                          >
                            <div className="flex items-center space-x-3">
                              <svg
                                className={`w-5 h-5 text-gray-500 transition-transform ${
                                  isExpanded ? 'transform rotate-90' : ''
                                }`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M9 5l7 7-7 7"
                                />
                              </svg>
                              <span className="font-medium text-gray-900">{category.name}</span>
                              <span className="text-sm text-gray-500">
                                {selectedInCategory}/{categoryProducts.length}
                              </span>
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="p-4 grid grid-cols-10 gap-3">
                              {categoryProducts.map((product) => {
                                const isSelected = selectedProducts.has(product.code);
                                return (
                                  <button
                                    key={product.id}
                                    type="button"
                                    onClick={() => toggleProduct(product.code)}
                                    className={`flex flex-col items-center space-y-1 p-2 rounded-lg transition-all ${
                                      isSelected
                                        ? 'bg-blue-100 ring-2 ring-blue-500'
                                        : 'bg-white hover:bg-gray-50'
                                    }`}
                                  >
                                    <div
                                      className={`w-12 h-12 rounded-full border-2 ${
                                        isSelected
                                          ? 'border-blue-500 ring-2 ring-blue-200'
                                          : 'border-gray-200'
                                      }`}
                                      style={{ backgroundColor: product.color_hex || '#CCCCCC' }}
                                    />
                                    <span className="text-xs font-medium text-gray-700">
                                      {product.code}
                                    </span>
                                    {isSelected && (
                                      <svg
                                        className="w-4 h-4 text-blue-600"
                                        fill="currentColor"
                                        viewBox="0 0 20 20"
                                      >
                                        <path
                                          fillRule="evenodd"
                                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                          clipRule="evenodd"
                                        />
                                      </svg>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setSelectedProducts(new Set());
                    setQuantity('');
                    setTotalAmount('');
                  }}
                  className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={selectedProducts.size === 0 || !quantity || Number(quantity) <= 0}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  提交订单（{selectedProducts.size} 个产品）
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 修改订单弹窗 */}
      {editingOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">修改订单</h2>
              <button
                onClick={() => {
                  setEditingOrder(null);
                  setEditProductCode('');
                  setEditQuantity('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="px-6 py-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    产品代码
                  </label>
                  <input
                    type="text"
                    value={editProductCode}
                    onChange={(e) => setEditProductCode(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="如 A01"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    数量
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={editQuantity}
                    onChange={(e) => setEditQuantity(e.target.value ? parseInt(e.target.value, 10) : '')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  订单金额（元，可选）
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={editTotalAmount as any}
                  onChange={(e) => setEditTotalAmount(e.target.value ? parseFloat(e.target.value) : '')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="输入订单总额（可选）"
                />
              </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setEditingOrder(null);
                    setEditProductCode('');
                    setEditQuantity('');
                  }}
                  className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default Orders;


