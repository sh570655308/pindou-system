import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { formatBeijingTimeShort, formatBeijingTimeDate } from '../utils/time';

interface LogItem {
  id: number;
  change_type: string;
  source: string;
  quantity_change: number;
  quantity_before: number | null;
  quantity_after: number | null;
  order_id?: number | null;
  remark?: string | null;
  created_at: string;
}

interface RouteState {
  code?: string;
}

interface CompletionRecord {
  id: number;
  drawing_id: number;
  quantity: number;
  image_path?: string;
  created_at?: string;
  completed_at?: string | null;
  satisfaction?: number | null;
  is_revoked?: number | boolean;
}

const changeTypeLabel = (type: string) => {
  switch (type) {
    case 'manual_increase':
      return '用户增加';
    case 'manual_decrease':
      return '用户减少';
    case 'order_received_increase':
      return '签收增加';
    case 'order_return_decrease':
      return '退货减少';
    default:
      return type;
  }
};

const InventoryLogs: React.FC = () => {
  const navigate = useNavigate();
  const { productId } = useParams<{ productId: string }>();
  const location = useLocation();
  const state = location.state as RouteState | null;

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 完工记录弹窗状态
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [selectedCompletion, setSelectedCompletion] = useState<CompletionRecord | null>(null);
  const [loadingCompletion, setLoadingCompletion] = useState(false);

  // 图片查看弹窗状态
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageModalSrc, setImageModalSrc] = useState<string | null>(null);

  useEffect(() => {
    if (productId) {
      loadLogs(productId);
    }
  }, [productId]);

  const loadLogs = async (id: string) => {
    try {
      setLoading(true);
      const res = await api.get<LogItem[]>('/inventory/logs', {
        params: { productId: id },
      });
      setLogs(res.data);
    } catch (error) {
      console.error('加载库存变动记录失败', error);
      alert('加载库存变动记录失败');
    } finally {
      setLoading(false);
    }
  };

  // 从备注中提取图纸ID
  const extractDrawingId = (remark: string): number | null => {
    // 匹配格式："图纸{id}-{title} 完工 - 数量: {quantity}"
    const match = remark.match(/图纸(\d+)/);
    return match ? parseInt(match[1]) : null;
  };

  // 打开图片查看弹窗
  const openImageModal = (imagePath: string) => {
    setImageModalSrc(`${window.location.origin}/uploads/drawings/${imagePath}`);
    setShowImageModal(true);
  };

  // 处理点击完工消耗备注
  const handleCompletionClick = async (remark: string) => {
    const drawingId = extractDrawingId(remark);
    if (!drawingId) {
      alert('无法解析完工记录信息');
      return;
    }

    try {
      setLoadingCompletion(true);
      // 获取该图纸的所有完工记录
      const res = await api.get(`/completions?drawing_id=${drawingId}`);
      const completions = res.data.data;

      if (completions && completions.length > 0) {
        // 找到匹配的完工记录（通过备注信息匹配）
        const matchedCompletion = completions.find((c: CompletionRecord) => {
          return remark.includes(`图纸${drawingId}`) && remark.includes(`数量: ${c.quantity}`);
        });

        if (matchedCompletion) {
          setSelectedCompletion(matchedCompletion);
          setShowCompletionModal(true);
        } else {
          // 如果找不到精确匹配，显示第一条记录
          setSelectedCompletion(completions[0]);
          setShowCompletionModal(true);
        }
      } else {
        alert('未找到相关的完工记录');
      }
    } catch (error) {
      console.error('加载完工记录失败', error);
      alert('加载完工记录失败');
    } finally {
      setLoadingCompletion(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-4">
        <button
          onClick={() => navigate('/inventory')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-2"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          返回库存管理
        </button>
        <h1 className="text-2xl font-bold text-gray-900">库存变动记录</h1>
        {state?.code && (
          <p className="text-sm text-gray-500 mt-1">产品代码：{state.code}</p>
        )}
      </div>
      <div className="bg-white rounded-lg shadow p-6">
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">暂无库存变动记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      时间
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      类型
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      变动数量
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      变动前
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      变动后
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      来源
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      备注
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                        {formatBeijingTimeShort(log.created_at)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700">
                        {changeTypeLabel(log.change_type)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm">
                        <span
                          className={`font-semibold ${
                            log.quantity_change > 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {log.quantity_change > 0 ? '+' : ''}
                          {log.quantity_change}
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700">
                        {log.quantity_before ?? '-'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700">
                        {log.quantity_after ?? '-'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                        {log.source === 'order' ? '订单' : '手动'}
                        {log.order_id ? ` #${log.order_id}` : ''}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                        {log.change_type === '完工消耗' && log.remark ? (
                          <button
                            onClick={() => handleCompletionClick(log.remark!)}
                            className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                            title="点击查看完工记录详情"
                          >
                            {log.remark}
                          </button>
                        ) : (
                          log.remark || '-'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* 完工记录详情弹窗 */}
      {showCompletionModal && selectedCompletion && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">完工记录详情</h3>
              <button
                className="text-gray-500 hover:text-gray-700"
                onClick={() => setShowCompletionModal(false)}
              >
                关闭
              </button>
            </div>

            {loadingCompletion ? (
              <div className="text-center py-8">
                <div className="text-gray-500">加载中...</div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">图纸ID</label>
                    <div className="mt-1 text-sm text-gray-900">#{selectedCompletion.drawing_id}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">完工数量</label>
                    <div className="mt-1 text-sm text-gray-900">{selectedCompletion.quantity}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">完工时间</label>
                    <div className="mt-1 text-sm text-gray-900">
                      {selectedCompletion.completed_at
                        ? formatBeijingTimeDate(selectedCompletion.completed_at)
                        : (selectedCompletion.created_at
                          ? formatBeijingTimeDate(selectedCompletion.created_at)
                          : '未知'
                        )
                      }
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">满意度</label>
                    <div className="mt-1 text-sm text-gray-900">
                      {selectedCompletion.satisfaction
                        ? (selectedCompletion.satisfaction === 5 ? '很满意' :
                           selectedCompletion.satisfaction === 4 ? '满意' :
                           selectedCompletion.satisfaction === 3 ? '一般' :
                           selectedCompletion.satisfaction === 2 ? '不满意' : '很不满意')
                        : '未填写'
                      }
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">创建时间</label>
                  <div className="mt-1 text-sm text-gray-500">
                    {selectedCompletion.created_at ? formatBeijingTimeShort(selectedCompletion.created_at) : '未知'}
                  </div>
                </div>

                {selectedCompletion.image_path && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">完工图片</label>
                    <div className="relative inline-block">
                      <img
                        src={`${window.location.origin}/uploads/drawings/${selectedCompletion.image_path}`}
                        alt="完工图片"
                        className="max-w-xs max-h-48 object-cover rounded border cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => selectedCompletion.image_path && openImageModal(selectedCompletion.image_path)}
                        title="点击查看大图"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const link = document.createElement('a');
                          link.href = `${window.location.origin}/uploads/drawings/${selectedCompletion.image_path}`;
                          link.download = `completion-${selectedCompletion.id}.jpg`;
                          link.click();
                        }}
                        className="absolute top-2 right-2 bg-black bg-opacity-50 text-white rounded-full w-6 h-6 text-xs hover:bg-opacity-75 transition-all flex items-center justify-center"
                        title="下载图片"
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-2 pt-4 border-t">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                    selectedCompletion.is_revoked ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                  }`}>
                    {selectedCompletion.is_revoked ? '已撤销' : '有效'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 图片查看弹窗 */}
      {showImageModal && imageModalSrc && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50" onClick={() => setShowImageModal(false)}>
          <img
            src={imageModalSrc}
            alt="大图"
            className="max-w-[90vw] max-h-[90vh] rounded shadow-lg cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setShowImageModal(false)}
            className="absolute top-4 right-4 text-white bg-black bg-opacity-50 rounded-full w-10 h-10 flex items-center justify-center hover:bg-opacity-75 transition-all"
            title="关闭"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};

export default InventoryLogs;


