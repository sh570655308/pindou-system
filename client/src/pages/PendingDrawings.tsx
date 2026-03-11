import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { formatBeijingTimeShort } from '../utils/time';
import { useLocalStorageState } from '../utils/useLocalStorageState';

interface Drawing {
  id: number;
  title: string;
  description?: string;
  width?: number;
  height?: number;
  status?: string;
  created_at?: string;
  updated_at?: string;
  thumbnail?: string;
}

interface ProductOption {
  id: number;
  code: string;
  color_code?: string;
  color_hex?: string;
  category_id?: number;
  category_name?: string;
}

interface MaterialLine {
  product_id?: number | null;
  quantity?: number | null;
  id?: string;
  inventory_qty?: number;
  in_transit_qty?: number;
  code?: string;
  color_code?: string;
  unit_price?: number;
}

const PendingDrawings: React.FC = () => {
  const { user } = useAuth();

  // 状态管理
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loadingDrawings, setLoadingDrawings] = useState<boolean>(false);
  const [selectedDrawing, setSelectedDrawing] = useState<Drawing | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [listSearch, setListSearch] = useState<string>('');
  const [pendingQuantity, setPendingQuantity] = useState<number>(1);

  // 图纸详情相关状态
  const [drawingImages, setDrawingImages] = useState<any[]>([]);
  const [materials, setMaterials] = useState<MaterialLine[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  // 本地持久化已保存的待拼数量（按图纸ID）作为备份（主要保存到服务端）
  const [savedQuantities, setSavedQuantities] = useLocalStorageState<Record<string, number>>('pending-drawings-quantities', {});
  const [saveIndicator, setSaveIndicator] = useState<boolean>(false);

  useEffect(() => {
    loadDrawings();
    loadProducts();
  }, []);

  // 加载所有状态为pending的图纸
  const loadDrawings = async () => {
    setLoadingDrawings(true);
    try {
      const res = await api.get('/drawings/all');
      // 筛选出状态为pending的图纸
      const pendingDrawings = res.data.data.filter((d: Drawing) => d.status === 'pending');
      setDrawings(pendingDrawings);
    } catch (err) {
      console.error('加载待拼图纸失败', err);
    } finally {
      setLoadingDrawings(false);
    }
  };

  // 加载产品列表（用于物料显示）
  const loadProducts = async () => {
    try {
      // 与其他页面保持一致，使用 /inventory/products/all 返回完整数组
      const res = await api.get('/inventory/products/all');
      // 该接口返回直接的数组（见 Drawings.tsx 的实现）
      setProducts(res.data || []);
    } catch (err) {
      console.error('加载产品列表失败', err);
    }
  };

  // 选择图纸并加载详情
  const handleSelectDrawing = async (drawing: Drawing) => {
    setSelectedDrawing(drawing);
    setLoadingDetail(true);
    try {
      const res = await api.get(`/drawings/${drawing.id}`);
      setDrawingImages(res.data.images || []);
      setMaterials(res.data.materials || []);
      // 优先使用服务器端的 pending_quantity；若无则回退到 localStorage 备份或 1
      const serverDrawing = res.data.drawing;
      if (serverDrawing && typeof serverDrawing.pending_quantity !== 'undefined') {
        setPendingQuantity(Number(serverDrawing.pending_quantity) || 1);
      } else {
        const saved = savedQuantities ? savedQuantities[String(drawing.id)] : undefined;
        setPendingQuantity(typeof saved !== 'undefined' ? saved : 1);
      }
    } catch (err) {
      console.error('加载图纸详情失败', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // 过滤图纸列表（基于搜索）
  const filteredDrawings = drawings.filter(drawing =>
    drawing.title.toLowerCase().includes(listSearch.toLowerCase()) ||
    (drawing.description && drawing.description.toLowerCase().includes(listSearch.toLowerCase()))
  );

  // 获取产品信息
  const getProductInfo = (productId: number) => {
    return products.find(p => p.id === productId);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-6">
          {/* 左侧图纸列表 */}
          <div className="w-80 bg-white rounded-lg shadow-sm">
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900 mb-3">待拼图纸</h2>
              {/* 搜索框 */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="搜索图纸..."
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            <div className="max-h-[calc(100vh-12rem)] overflow-y-auto">
              {loadingDrawings ? (
                <div className="p-4 text-center text-gray-500">加载中...</div>
              ) : filteredDrawings.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  {listSearch ? '未找到匹配的图纸' : '暂无待拼图纸'}
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {filteredDrawings.map((drawing) => (
                    <div
                      key={drawing.id}
                      className={`p-4 cursor-pointer hover:bg-gray-50 ${
                        selectedDrawing?.id === drawing.id ? 'bg-blue-50 border-r-2 border-blue-500' : ''
                      }`}
                      onClick={() => handleSelectDrawing(drawing)}
                    >
                      <div className="flex items-start space-x-3">
                        <div className="w-12 h-12 rounded bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                          {drawing.thumbnail ? (
                            <img
                              src={`${window.location.origin}/uploads/drawings/${drawing.thumbnail}`}
                              alt={drawing.title}
                              className="w-full h-full object-cover"
                              onError={(e:any) => { e.currentTarget.style.display = 'none'; }}
                            />
                          ) : (
                            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">{drawing.title}</div>
                          {drawing.description && (
                            <div className="text-sm text-gray-500 truncate mt-1">{drawing.description}</div>
                          )}
                          <div className="text-xs text-gray-400 mt-1">
                            {drawing.created_at ? formatBeijingTimeShort(drawing.created_at) : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 右侧图纸信息 */}
          <div className="flex-1 bg-white rounded-lg shadow-sm">
            {selectedDrawing ? (
              <div className="p-6">
                <div className="mb-6 sticky top-20 bg-white z-10 pb-4">
                  <h3 className="text-xl font-medium text-gray-900 mb-2">{selectedDrawing.title}</h3>
                  {selectedDrawing.description && (
                    <p className="text-gray-600 mb-4">{selectedDrawing.description}</p>
                  )}

                  {/* 待拼数量输入 与 保存按钮 */}
                  <div className="mb-2 flex items-center space-x-3">
                    <label className="block text-sm font-medium text-gray-700">
                      待拼数量
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={pendingQuantity}
                      onChange={(e) => setPendingQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      className="px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
                    onClick={async () => {
                      if (!selectedDrawing) return;
                      try {
                        const res = await api.patch(`/drawings/${selectedDrawing.id}/pending-quantity`, { pending_quantity: pendingQuantity });
                        // update local backup copy as well
                        setSavedQuantities((prev) => ({ ...(prev || {}), [String(selectedDrawing.id)]: pendingQuantity }));
                        setSaveIndicator(true);
                        setTimeout(() => setSaveIndicator(false), 1500);
                        // optionally refresh materials/drawing info from server
                        if (res && res.data && res.data.drawing) {
                          // nothing more for now; materials remain same
                        }
                      } catch (err) {
                        console.error('保存待拼数量到服务器失败', err);
                        alert('保存失败，请重试');
                      }
                    }}
                    >
                      保存
                    </button>
                    {saveIndicator && <span className="text-sm text-emerald-600">已保存</span>}
                  </div>
                </div>

                {/* 下方内容可滚动：图片 + 物料 */}
                <div className="mt-2 overflow-auto max-h-[60vh]">
                  {/* 图纸图片 */}
                  {drawingImages.length > 0 && (
                    <div className="mb-6">
                      <h4 className="text-lg font-medium text-gray-900 mb-3">图纸图片</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {drawingImages.map((image) => (
                          <div key={image.id} className="relative">
                            <img
                              src={`${window.location.origin}/uploads/drawings/${image.file_path}`}
                              alt={image.file_name}
                              className="w-full h-32 object-cover rounded-lg border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => window.open(`${window.location.origin}/uploads/drawings/${image.file_path}`, '_blank')}
                            />
                            <div className="absolute bottom-2 left-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
                              {image.image_type === 'blueprint' ? '蓝图' : image.image_type === 'completion' ? '成品' : '参考'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 实际物料消耗 */}
                  <div className="mb-6">
                    <h4 className="text-lg font-medium text-gray-900 mb-3">实际物料消耗</h4>
                    {loadingDetail ? (
                      <div className="text-center py-4 text-gray-500">加载中...</div>
                    ) : materials.length === 0 ? (
                      <div className="text-center py-4 text-gray-500">暂无物料信息</div>
                    ) : (
                      <div className="space-y-3">
                        {materials.map((material, index) => {
                          const product = getProductInfo(material.product_id || 0);
                          const requiredQty = (material.quantity || 0) * pendingQuantity;
                          const availableQty = material.inventory_qty || 0;
                          const isShortage = availableQty < requiredQty;

                          return (
                            <div key={index} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                              <div className="flex items-center space-x-3">
                                <div
                                  className="w-6 h-6 rounded border"
                                  style={{ backgroundColor: product?.color_hex || (material as any).color_hex || '#cccccc' }}
                                  title={product?.color_code || (material as any).color_code || ''}
                                />
                                <div>
                                  <div className="font-medium text-gray-900">
                                    {product?.code || material.code || `产品${material.product_id}`}
                                  </div>
                                  <div className="text-sm text-gray-500">
                                    {product?.category_name || ''}{product?.category_name && material.color_code ? ' - ' : ''}{product?.color_code || material.color_code || ''}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`font-medium ${isShortage ? 'text-red-600' : 'text-green-600'}`}>
                                  需要: {requiredQty}
                                </div>
                                <div className="text-sm text-gray-500">
                                  库存: {availableQty}
                                  {(material.in_transit_qty || 0) > 0 && (
                                    <span className="ml-2">在途: {material.in_transit_qty || 0}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-500">
                请选择左侧的图纸查看详情
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PendingDrawings;
