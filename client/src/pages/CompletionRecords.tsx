import React, { useEffect, useState, useRef } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { formatBeijingTimeShort, formatBeijingTimeDate } from '../utils/time';
import { computeFileSHA256 } from '../utils/file';
import { useLocalStorageState } from '../utils/useLocalStorageState';
import { useCompletionActions } from '../hooks/useCompletionActions';

interface Drawing {
  id: number;
  title: string;
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

const CompletionRecords: React.FC = () => {
  const { user } = useAuth();
  // 非持久化状态（临时状态）
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [records, setRecords] = useState<CompletionRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // 分页状态
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(20);
  const [total, setTotal] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);

  // 使用共享的完工记录操作hook
  const { loading: actionLoading, handleUndo, handleDelete } = useCompletionActions({
    onSuccess: () => loadRecords(), // 操作成功后重新加载记录
  });
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [showEditModal, setShowEditModal] = useLocalStorageState<boolean>('completions-showEditModal', false);
  const [editingId, setEditingId] = useLocalStorageState<number | null>('completions-editingId', null);
  const [editQuantity, setEditQuantity] = useLocalStorageState<number>('completions-editQuantity', 1);
  const [editCompletedAt, setEditCompletedAt] = useLocalStorageState<string | null>('completions-editCompletedAt', null);
  const [editSatisfaction, setEditSatisfaction] = useLocalStorageState<number | null>('completions-editSatisfaction', null);
  const [showImageModal, setShowImageModal] = useLocalStorageState<boolean>('completions-showImageModal', false);
  const [imageModalSrc, setImageModalSrc] = useLocalStorageState<string | null>('completions-imageModalSrc', null);

  // 用于编辑后滚动到原位置
  const scrollTargetIdRef = useRef<number | null>(null);

  // 筛选状态
  const [searchName, setSearchName] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedSatisfaction, setSelectedSatisfaction] = useState<string>('');

  useEffect(() => {
    loadDrawings();
    loadRecords();
  }, []);

  // 编辑后滚动到原位置
  useEffect(() => {
    if (scrollTargetIdRef.current && records.length > 0) {
      const targetId = scrollTargetIdRef.current;
      scrollTargetIdRef.current = null; // 清除目标，避免重复滚动

      // 使用 setTimeout 确保 DOM 已更新
      setTimeout(() => {
        const element = document.getElementById(`completion-record-${targetId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // 添加高亮效果
          element.classList.add('ring-2', 'ring-blue-400');
          setTimeout(() => {
            element.classList.remove('ring-2', 'ring-blue-400');
          }, 2000);
        }
      }, 100);
    }
  }, [records]);

  const loadDrawings = async () => {
    try {
      const res = await api.get('/drawings/all');
      setDrawings(res.data.data || []);
    } catch (err) {
      console.error('加载图纸失败', err);
    }
  };

  const loadRecords = async () => {
    try {
      setLoading(true);
      const res = await api.get('/completions', {
        params: { limit, offset: 0 }
      });
      setRecords(res.data.data || []);
      setTotal(res.data.total || 0);
      setPage(1);
      setHasMore((res.data.data || []).length >= limit);
    } catch (err) {
      console.error('加载完工记录失败', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const nextPage = page + 1;
      const res = await api.get('/completions', {
        params: { limit, offset: page * limit }
      });
      const newRecords = res.data.data || [];
      setRecords([...records, ...newRecords]);
      setPage(nextPage);
      setHasMore(newRecords.length >= limit);
    } catch (err) {
      console.error('加载更多失败', err);
    } finally {
      setLoadingMore(false);
    }
  };


  const openEditModal = (r: CompletionRecord) => {
    setEditingId(r.id);
    setEditQuantity(r.quantity || 1);
    setEditCompletedAt(r.completed_at || null);
    setEditSatisfaction(r.satisfaction ?? null);
    setEditImageFile(null);
    setShowEditModal(true);
  };


  const handleEditSubmit = async () => {
    if (!editingId) return;
    try {
      const rec = records.find((it) => it.id === editingId);
      if (!rec) {
        alert('未找到原始记录，无法更新');
        return;
      }
      const fd = new FormData();
      // 差异提交：只提交与原始记录不同的字段
      if (Number(editQuantity) !== Number(rec.quantity)) {
        fd.append('quantity', String(editQuantity));
      }
      if (editCompletedAt) {
        const origTime = rec.completed_at ? new Date(rec.completed_at).getTime() : (rec.created_at ? new Date(rec.created_at).getTime() : null);
        const newTime = new Date(editCompletedAt).getTime();
        if (!origTime || origTime !== newTime) {
          fd.append('completed_at', editCompletedAt);
        }
      }
      if ((editSatisfaction ?? null) !== (rec.satisfaction ?? null)) {
        if (editSatisfaction !== null) fd.append('satisfaction', String(editSatisfaction));
        else fd.append('satisfaction', ''); // allow clearing? backend ignores invalid; safer omit if null
      }
      if (editImageFile) {
        fd.append('image', editImageFile);
        try {
          const sha = await computeFileSHA256(editImageFile);
          fd.append('image_hash', sha);
        } catch (e) {
          console.warn('计算图片哈希失败', e);
        }
      }
      // only include drawing_id if needed for multer target
      if (rec && rec.drawing_id) fd.append('drawing_id', String(rec.drawing_id));
      // 如果没有任何变更，直接关闭
      if (Array.from(fd.keys()).length === 0) {
        setShowEditModal(false);
        setEditingId(null);
        alert('未检测到更改，无需保存');
        return;
      }
      await api.put(`/completions/${editingId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const savedId = editingId; // 保存ID用于滚动定位
      setShowEditModal(false);
      setEditingId(null);
      scrollTargetIdRef.current = savedId; // 设置滚动目标
      loadRecords();
      alert('更新成功');
    } catch (err: any) {
      console.error('更新失败', err);
      alert(err?.response?.data?.error || '更新失败');
    }
  };

  const openImageModal = (relPath?: string) => {
    if (!relPath) return;
    setImageModalSrc(encodeURI(`/uploads/drawings/${relPath}`));
    setShowImageModal(true);
  };

  // 筛选逻辑
  const filteredRecords = records.filter(r => {
    const drawing = drawings.find(d => d.id === r.drawing_id);
    const drawingTitle = drawing ? drawing.title : '';

    // 名称筛选
    if (searchName && !drawingTitle.toLowerCase().includes(searchName.toLowerCase()) &&
      !r.drawing_id.toString().includes(searchName)) {
      return false;
    }

    // 时间区间筛选
    const recordTime = r.completed_at || r.created_at;
    if (recordTime) {
      const recordDate = new Date(recordTime);
      if (startDate && recordDate < new Date(startDate)) return false;
      if (endDate && recordDate > new Date(endDate + 'T23:59:59')) return false;
    }

    // 满意度筛选
    if (selectedSatisfaction && r.satisfaction !== parseInt(selectedSatisfaction)) {
      return false;
    }

    return true;
  });

  return (
    <div className="p-4">
      <div className="sticky top-20 z-30 -mx-4 mb-4">
        <div className="bg-white p-4 border rounded">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">我的完工记录</h3>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-600">名称：</label>
                <input
                  type="text"
                  placeholder="搜索图纸名称或ID"
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  className="px-2 py-1 border rounded text-sm w-32"
                />
              </div>
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-600">时间：</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-2 py-1 border rounded text-sm"
                />
                <span className="text-sm text-gray-400">-</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-2 py-1 border rounded text-sm"
                />
              </div>
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-600">满意度：</label>
                <select
                  value={selectedSatisfaction}
                  onChange={(e) => setSelectedSatisfaction(e.target.value)}
                  className="px-2 py-1 border rounded text-sm"
                >
                  <option value="">全部</option>
                  <option value="5">很满意</option>
                  <option value="4">满意</option>
                  <option value="3">一般</option>
                  <option value="2">不满意</option>
                  <option value="1">很不满意</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : (
            <>
              {filteredRecords.length === 0 && records.length > 0 && <div className="text-sm text-gray-500">无符合条件的记录</div>}
              {filteredRecords.length === 0 && records.length === 0 && <div className="text-sm text-gray-500">暂无记录</div>}
              {filteredRecords.map(r => {
                const drawing = drawings.find(d => d.id === r.drawing_id);
                return (
                  <div
                    key={r.id}
                    id={`completion-record-${r.id}`}
                    className="p-3 border rounded flex items-center space-x-3 transition-all duration-300"
                  >
                    <div className="flex-1">
                      <div><strong>图纸：</strong>{`${r.drawing_id}${drawing ? ' - ' + drawing.title : ''}`}</div>
                      <div><strong>数量：</strong>{r.quantity}</div>
                      <div><strong>完工时间：</strong>{r.completed_at ? formatBeijingTimeDate(r.completed_at) : (r.created_at ? formatBeijingTimeDate(r.created_at) : '')}</div>
                      <div><strong>满意度：</strong>{r.satisfaction ? (r.satisfaction === 5 ? '很满意' : r.satisfaction === 4 ? '满意' : r.satisfaction === 3 ? '一般' : r.satisfaction === 2 ? '不满意' : '很不满意') : '未填写'}</div>
                      <div className="text-xs text-gray-500">{r.created_at ? formatBeijingTimeShort(r.created_at) : ''}</div>
                    </div>
                    <div className="flex flex-col items-end space-y-2">
                      <div className="flex space-x-2">
                        <button className="px-2 py-1 text-sm bg-gray-100 rounded" onClick={() => openEditModal(r)}>编辑</button>
                        {r.is_revoked ? (
                          <>
                            <button className="px-2 py-1 text-sm bg-gray-100 text-gray-400 rounded cursor-not-allowed" disabled>已撤销</button>
                            <button className="px-2 py-1 text-sm bg-red-600 text-white rounded" onClick={() => handleDelete(r.id)}>删除</button>
                          </>
                        ) : (
                          <button className="px-2 py-1 text-sm bg-red-100 text-red-700 rounded" onClick={() => handleUndo(r.id)}>撤销</button>
                        )}
                      </div>
                      {r.image_path ? (
                        <div>
                          <img
                            src={encodeURI(`/uploads/drawings/${(r as any).thumbnail || r.image_path}`)}
                            alt="完工图"
                            loading="lazy"
                            decoding="async"
                            className="w-24 h-24 object-cover rounded cursor-pointer"
                            onClick={() => openImageModal(r.image_path)}
                          />
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400">无图片</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* 加载更多按钮 */}
        {!loading && records.length > 0 && hasMore && (
          <div className="mt-4 text-center">
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? '加载中...' : `加载更多 (已显示 ${filteredRecords.length}/${total > 0 ? total : '全部'})`}
            </button>
          </div>
        )}

        {/* 已加载全部提示 */}
        {!loading && records.length > 0 && !hasMore && (
          <div className="mt-4 text-center text-sm text-gray-500">
            已加载全部 {records.length} 条记录
          </div>
        )}
      </div>

      {/* 编辑弹窗 */}
      {showEditModal && editingId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">编辑完工记录 #{editingId}</h3>
              <button className="text-gray-500" onClick={() => setShowEditModal(false)}>关闭</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm">数量</label>
                <input type="number" min={1} value={editQuantity} onChange={(e) => setEditQuantity(parseInt(e.target.value || '1'))} className="mt-1 w-full border rounded p-2" />
              </div>
              <div>
                <label className="block text-sm">完工时间</label>
                <input type="datetime-local" value={editCompletedAt || ''} onChange={(e) => setEditCompletedAt(e.target.value || null)} className="mt-1 w-full border rounded p-2" />
              </div>
              <div>
                <label className="block text-sm">满意度</label>
                <select className="mt-1 w-full border rounded p-2" value={editSatisfaction ?? ''} onChange={(e) => setEditSatisfaction(e.target.value ? parseInt(e.target.value) : null)}>
                  <option value="">-- 请选择满意度 --</option>
                  <option value="5">很满意</option>
                  <option value="4">满意</option>
                  <option value="3">一般</option>
                  <option value="2">不满意</option>
                  <option value="1">很不满意</option>
                </select>
              </div>
              <div>
                <label className="block text-sm">替换图片（可选）</label>
                <input type="file" accept="image/*" onChange={(e) => setEditImageFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} className="mt-1" />
              </div>
              <div className="flex items-center justify-end space-x-3">
                <button className="px-3 py-2 bg-gray-200 rounded" onClick={() => setShowEditModal(false)}>取消</button>
                <button className="px-3 py-2 bg-blue-600 text-white rounded" onClick={handleEditSubmit}>保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 图片查看弹窗 */}
      {showImageModal && imageModalSrc && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50" onClick={() => setShowImageModal(false)}>
          <img src={imageModalSrc} alt="大图" className="max-w-[90vw] max-h-[90vh] rounded shadow-lg" />
        </div>
      )}
    </div>
  );
};

export default CompletionRecords;


