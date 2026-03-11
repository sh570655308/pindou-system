import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { formatBeijingTimeShort, formatBeijingTimeDate } from '../utils/time';
import { computeFileSHA256 } from '../utils/file';
import { useLocalStorageState } from '../utils/useLocalStorageState';
import { useCompletionActions } from '../hooks/useCompletionActions';
import PixelGrid, { PixelCell } from '../components/PixelGrid';
import StatsPanel from '../components/StatsPanel';
import DirectoryTree from '../components/DirectoryTree';
import MaterialRecognition from '../components/MaterialRecognition';
import { FolderNode } from '../types/folder';

interface Drawing {
  id: number;
  title: string;
  description?: string;
  width?: number;
  height?: number;
  status?: string;
  created_at?: string;
  updated_at?: string;
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
  id?: string; // client-side id for list rendering
  inventory_qty?: number;
  in_transit_qty?: number;
}

const Drawings: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // 非持久化状态（临时状态）
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loadingDrawings, setLoadingDrawings] = useState<boolean>(false);
  const [totalDrawings, setTotalDrawings] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [price, setPrice] = useState<number>(0);
  const [referenceSalesPrice, setReferenceSalesPrice] = useState<number>(0);
  const [images, setImages] = useState<any[]>([]);
  const [completedCount, setCompletedCount] = useState<number>(0);
  const [blueprintFile, setBlueprintFile] = useState<File | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  // 原始数据快照，用于变更检测
  const originalDrawingData = useRef<{
    title: string;
    description: string;
    status: string;
    shared: boolean;
    folder_id: number | null;
    materials: { product_id: number; quantity: number }[];
  } | null>(null);
  const [openPickerRow, setOpenPickerRow] = useState<string | null>(null);
  const [showMaterialRecognition, setShowMaterialRecognition] = useState<boolean>(false);

  // 使用共享的完工记录操作hook
  const { loading: actionLoading, handleUndo, handleDelete } = useCompletionActions({
    onSuccess: () => {
      // 操作成功后刷新相关数据
      if (selectedDrawing && selectedDrawing.id) {
        loadDrawingCompletions((selectedDrawing as any).id);
        handleSelectDrawing((selectedDrawing as any).id);
      }
      loadDrawings(currentPage);
    },
  });

  // 持久化状态（页面刷新后保留）
  const [selectedDrawing, setSelectedDrawing] = useLocalStorageState<Drawing | null>('drawings-selectedDrawing', null);
  const [title, setTitle] = useLocalStorageState<string>('drawings-title', '');
  const [description, setDescription] = useLocalStorageState<string>('drawings-description', '');
  const [shared, setShared] = useLocalStorageState<boolean>('drawings-shared', false);
  const [materials, setMaterials] = useLocalStorageState<MaterialLine[]>('drawings-materials', []);
  const [listSearch, setListSearch] = useLocalStorageState<string>('drawings-listSearch', '');
  const [productSearch, setProductSearch] = useLocalStorageState<Record<string, string>>('drawings-productSearch', {});
  const [statusValue, setStatusValue] = useLocalStorageState<string>('drawings-statusValue', 'recorded');
  const [statusFilters, setStatusFilters] = useLocalStorageState<string[]>('drawings-statusFilters', ['recorded', 'pending', 'completed']);
  const [showStatusFilter, setShowStatusFilter] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useLocalStorageState<boolean>('drawings-showArchived', false);
  const filterRef = useRef<HTMLDivElement>(null);

  // 物料排序方式：code_asc(代码升序), code_desc(代码降序), qty_asc(数量升序), qty_desc(数量降序)
  const [materialSortBy, setMaterialSortBy] = useLocalStorageState<string>('drawings-materialSortBy', 'code_asc');

  // ========== 多维度管理 - 目录管理 ==========
  // 目录数据
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [loadingFolders, setLoadingFolders] = useState<boolean>(false);

  // 目录筛选状态（持久化）
  const [selectedFolderId, setSelectedFolderId] = useLocalStorageState<number | null>('drawings-selectedFolderId', null);
  const [expandedFolderIds, setExpandedFolderIds] = useLocalStorageState<number[]>('drawings-expandedFolderIds', []);

  // 批量操作状态
  const [selectedDrawingIds, setSelectedDrawingIds] = useState<number[]>([]);
  const [showBatchOperationModal, setShowBatchOperationModal] = useState<boolean>(false);
  const [batchOperationType, setBatchOperationType] = useState<'move' | 'archive' | null>(null);

  // 目录编辑模态框
  const [showFolderModal, setShowFolderModal] = useState<boolean>(false);
  const [folderForm, setFolderForm] = useState<{ id?: number; name: string; color: string; parent_id?: number | null }>({
    name: '',
    color: '#3B82F6',
    parent_id: null
  });
  const [batchForm, setBatchForm] = useState<{
    targetFolderId: number | null;
    archived: boolean;
  }>({
    targetFolderId: null,
    archived: false
  });
  // ============================================

  useEffect(() => {
    loadDrawings();
    loadProducts();
    loadFolders();
  }, []);

  // helper: detect pixelate pointer in description (we store a small pointer in description and full meta in a separate file)
  const hasPixelateMetaPointer = (desc?: string) => {
    if (!desc) return false;
    return /\[\[PIXELATE_META_PTR:([0-9]+)\]\]/.test(desc);
  };

  // fetch pixelate meta from server for a drawing (reads /api/drawings/:id/meta)
  const fetchPixelateMetaFromServer = async (drawingId: number) => {
    try {
      const res = await api.get(`/drawings/${drawingId}/meta`, { responseType: 'arraybuffer' });
      const contentType = (res.headers && (res.headers['content-type'] || res.headers['Content-Type'] || '')).toString().toLowerCase();
      if (contentType.includes('application/gzip')) {
        // try to ungzip using pako if available
        try {
          const pako = await import('pako');
          const u8 = new Uint8Array(res.data);
          const inflated = pako.ungzip(u8);
          const text = new TextDecoder().decode(inflated);
          return JSON.parse(text);
        } catch (err) {
          console.warn('无法解压像素化元数据（gzip），', err);
          return null;
        }
      } else {
        // assume JSON body
        // axios may have returned ArrayBuffer; convert to string
        try {
          const text = new TextDecoder().decode(new Uint8Array(res.data));
          const parsed = JSON.parse(text);
          if (parsed && parsed.meta) return parsed.meta;
          return parsed;
        } catch (err) {
          console.warn('解析像素化元数据失败', err);
          return null;
        }
      }
    } catch (err) {
      console.error('fetchPixelateMetaFromServer error', err);
      return null;
    }
  };

  // 页面加载时恢复选中的图纸状态
  useEffect(() => {
    const restoreSelectedDrawing = async () => {
      if (selectedDrawing && selectedDrawing.id) {
        try {
          // 验证图纸是否仍然存在
          const res = await api.get(`/drawings/${selectedDrawing.id}`);
          if (res.data && res.data.drawing) {
            // 图纸存在，重新加载详情
            await handleSelectDrawing(selectedDrawing.id);
          } else {
            // 图纸不存在，清除状态
            setSelectedDrawing(null);
          }
        } catch (error) {
          // 图纸不存在或加载失败，清除状态
          console.warn('恢复选中的图纸失败:', error);
          setSelectedDrawing(null);
        }
      }
    };

    // 只有在产品数据加载完成后才恢复图纸状态
    if (products.length > 0) {
      restoreSelectedDrawing();
    }
  }, [products.length]); // 只依赖products.length，避免无限循环

  useEffect(() => {
    const onCategoriesChanged = () => {
      loadProducts();
      loadDrawings();
    };
    const onSettingsChanged = () => {
      loadProducts();
      loadDrawings();
    };
    window.addEventListener('categories_changed', onCategoriesChanged);
    window.addEventListener('settings_changed', onSettingsChanged);
    return () => {
      window.removeEventListener('categories_changed', onCategoriesChanged);
      window.removeEventListener('settings_changed', onSettingsChanged);
    };
  }, []);

  // 点击外部关闭筛选下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowStatusFilter(false);
      }
    };

    if (showStatusFilter) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showStatusFilter]);

  // 筛选条件变化时重置到第一页并重新加载
  useEffect(() => {
    if (currentPage !== 1) {
      setCurrentPage(1);
    }
    loadDrawings(1);
  }, [listSearch, statusFilters, selectedFolderId]);

  // 当切换显示归档开关时，自动更新状态筛选
  useEffect(() => {
    if (showArchived) {
      if (!statusFilters.includes('archived')) {
        setStatusFilters([...statusFilters, 'archived']);
      }
    } else {
      setStatusFilters(statusFilters.filter(s => s !== 'archived'));
    }
  }, [showArchived]);

  const loadDrawings = async (page: number = currentPage) => {
    setLoadingDrawings(true);
    try {
      const limit = pageSize;
      const offset = (page - 1) * pageSize;

      // 构建查询参数，包含筛选条件
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });

      // 添加搜索条件
      if (listSearch && listSearch.trim()) {
        params.append('search', listSearch.trim());
      }

      // 添加状态筛选条件
      if (statusFilters.length > 0) {
        statusFilters.forEach(status => {
          params.append('status', status);
        });
      }

      // 添加目录筛选
      if (selectedFolderId !== null) {
        params.append('folder_id', String(selectedFolderId));
      }

      const res = await api.get(`/drawings?${params.toString()}`);
      setDrawings(res.data.data || []);
      setTotalDrawings(res.data.total || 0);
      setCurrentPage(page);
    } catch (error) {
      console.error('加载图纸列表失败', error);
    } finally {
      setLoadingDrawings(false);
    }
  };

  const loadProducts = async () => {
    try {
      const res = await api.get('/inventory/products/all');
      setProducts(res.data || []);
    } catch (error) {
      console.error('加载产品列表失败', error);
    }
  };

  // ========== 多维度管理 - API 函数 ==========
  const loadFolders = async () => {
    setLoadingFolders(true);
    try {
      const res = await api.get('/drawings/folders/tree');
      setFolders(res.data.data || []);
    } catch (error) {
      console.error('加载目录列表失败', error);
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleCreateFolder = async (parentId: number | null) => {
    setFolderForm({ name: '', color: '#3B82F6', parent_id: parentId });
    setShowFolderModal(true);
  };

  const handleEditFolder = async (folderId: number) => {
    // 查找目录信息
    const findFolder = (nodes: FolderNode[], id: number): FolderNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children) {
          const found = findFolder(node.children, id);
          if (found) return found;
        }
      }
      return null;
    };
    const folder = findFolder(folders, folderId);
    if (folder) {
      setFolderForm({ id: folder.id, name: folder.name, color: folder.color, parent_id: folder.parent_id });
      setShowFolderModal(true);
    }
  };

  const handleDeleteFolder = async (folderId: number) => {
    if (!window.confirm('确认删除此目录？目录下的图纸将移动到"未分类"目录。')) return;
    try {
      await api.delete(`/drawings/folders/${folderId}`);
      await loadFolders();
      await loadDrawings();
      alert('删除成功');
    } catch (err: any) {
      console.error('删除目录失败', err);
      alert(err?.response?.data?.error || '删除失败');
    }
  };

  const handleFolderDrop = async (draggedId: number, targetId: number) => {
    try {
      // 查找被拖拽的图纸ID（这里简化处理，实际可能需要更复杂的逻辑）
      // 目前仅支持目录之间的移动
      await api.put(`/drawings/folders/${draggedId}`, { parent_id: targetId });
      await loadFolders();
    } catch (err: any) {
      console.error('移动目录失败', err);
      alert(err?.response?.data?.error || '移动失败');
    }
  };

  const handleSaveFolder = async () => {
    if (!folderForm.name || folderForm.name.trim() === '') {
      alert('目录名称为必填项');
      return;
    }
    try {
      if (folderForm.id) {
        await api.put(`/drawings/folders/${folderForm.id}`, folderForm);
      } else {
        await api.post('/drawings/folders', folderForm);
      }
      setShowFolderModal(false);
      await loadFolders();
      alert(folderForm.id ? '更新成功' : '创建成功');
    } catch (err: any) {
      console.error('保存目录失败', err);
      alert(err?.response?.data?.error || '保存失败');
    }
  };

  // ========== 批量操作处理函数 ==========
  const handleToggleDrawingSelection = (drawingId: number) => {
    if (selectedDrawingIds.includes(drawingId)) {
      setSelectedDrawingIds(selectedDrawingIds.filter(id => id !== drawingId));
    } else {
      setSelectedDrawingIds([...selectedDrawingIds, drawingId]);
    }
  };

  const handleSelectAllDrawings = () => {
    if (selectedDrawingIds.length === drawings.length) {
      setSelectedDrawingIds([]);
    } else {
      setSelectedDrawingIds(drawings.map(d => d.id));
    }
  };

  const handleBatchMove = () => {
    if (selectedDrawingIds.length === 0) {
      alert('请先选择要移动的图纸');
      return;
    }
    setBatchOperationType('move');
    setBatchForm({ ...batchForm, targetFolderId: selectedFolderId });
    setShowBatchOperationModal(true);
  };

  const handleBatchArchive = (archive: boolean) => {
    if (selectedDrawingIds.length === 0) {
      alert('请先选择要归档的图纸');
      return;
    }
    setBatchOperationType('archive');
    setBatchForm({ ...batchForm, archived: archive });
    setShowBatchOperationModal(true);
  };

  const handleExecuteBatchOperation = async () => {
    if (selectedDrawingIds.length === 0) return;

    try {
      switch (batchOperationType) {
        case 'move':
          if (batchForm.targetFolderId === null) {
            alert('请选择目标目录');
            return;
          }
          await api.post('/drawings/batch-move', {
            drawing_ids: selectedDrawingIds,
            target_folder_id: batchForm.targetFolderId,
            is_primary: true
          });
          alert('批量移动成功');
          break;

        case 'archive':
          await api.post('/drawings/batch-archive', {
            drawing_ids: selectedDrawingIds,
            archived: batchForm.archived ? 1 : 0
          });
          alert(batchForm.archived ? '批量归档成功' : '批量取消归档成功');
          break;

        default:
          return;
      }

      setShowBatchOperationModal(false);
      setSelectedDrawingIds([]);
      await loadDrawings();
      await loadFolders();
    } catch (err: any) {
      console.error('批量操作失败', err);
      alert(err?.response?.data?.error || '操作失败');
    }
  };
  // =========================================

  // 辅助函数：渲染目录选项（包含缩进）
  const renderFolderOptions = (folder: FolderNode, level: number = 0): React.ReactElement => {
    const indent = level * 16;
    return (
      <React.Fragment key={folder.id}>
        <option value={folder.id} style={{ paddingLeft: `${indent}px` }}>
          {'  '.repeat(level)}{folder.name}
        </option>
        {folder.children && folder.children.map((child) => renderFolderOptions(child, level + 1))}
      </React.Fragment>
    );
  };

  // 辅助函数：移动图纸到目录
  const handleMoveDrawingToFolder = async (drawingId: number, folderId: number | null) => {
    try {
      await api.post('/drawings/batch-move', {
        drawing_ids: [drawingId],
        target_folder_id: folderId || null,
        is_primary: true
      });
      await loadDrawings(currentPage);
      if (selectedDrawing && selectedDrawing.id === drawingId) {
        await handleSelectDrawing(drawingId);
      }
    } catch (err: any) {
      console.error('移动图纸失败', err);
      alert(err?.response?.data?.error || '移动失败');
    }
  };

  // ============================================

  const openNewDrawingForm = () => {
    setSelectedDrawing(null);
    setTitle('');
    setDescription('');
    setMaterials([]);
    setImages([]);
    setBlueprintFile(null);
    setCompletionImageFile(null);
    setPrice(0);
    setStatusValue('recorded');
    setShared(false);
    setSelectedFolderIdForEdit(null);
  };

  const handleSelectDrawing = async (id: number) => {
    setLoadingDetail(true);
    try {
      const res = await api.get(`/drawings/${id}`);
      const { drawing, materials: serverMaterials, images: serverImages, price: serverPrice, referenceSalesPrice: refPrice, folders: drawingFolders } = res.data;
      setSelectedDrawing(drawing);
      setTitle(drawing.title || '');
      setDescription(drawing.description || '');
      setShared(Boolean((drawing as any).shared));

      // 设置文件夹：优先使用 folder_id 字段，如果没有则从 folders 数组中查找
      let folderId = (drawing as any).folder_id;
      if (!folderId && drawingFolders && Array.isArray(drawingFolders) && drawingFolders.length > 0) {
        folderId = drawingFolders.find((f: any) => f.is_primary)?.folder_id || drawingFolders[0].folder_id;
      }
      setSelectedFolderIdForEdit(folderId || null);

      // create stable ids for rows and initialize display names
      const ts = Date.now();
      const mapped = (serverMaterials || []).map((m: any, idx: number) => {
        return {
          product_id: m.product_id,
          quantity: m.quantity,
          id: `${m.product_id}-${ts}-${idx}`,
          inventory_qty: m.inventory_qty || 0,
          in_transit_qty: m.in_transit_qty || 0,
        };
      });
      setMaterials(mapped);
      // init product search display for selected materials
      const ps: Record<string, string> = {};
      mapped.forEach((m: MaterialLine) => {
        const prod = products.find((p) => p.id === m.product_id);
        if (prod) ps[m.id || ''] = `${prod.code}${prod.category_name ? ' (' + prod.category_name + ')' : ''}`;
      });
      setProductSearch(ps);
      setStatusValue(drawing.status || 'recorded');
      setCompletedCount(drawing.completed_count || 0);
      setImages(serverImages || []);
      setPrice(serverPrice || 0);
      setReferenceSalesPrice(refPrice || 0);

      // 保存原始数据快照用于变更检测
      originalDrawingData.current = {
        title: drawing.title || '',
        description: drawing.description || '',
        status: drawing.status || 'recorded',
        shared: Boolean((drawing as any).shared),
        folder_id: folderId || null,
        materials: (serverMaterials || []).map((m: any) => ({
          product_id: m.product_id,
          quantity: m.quantity,
        })),
      };
    } catch (error) {
      console.error('加载图纸详情失败', error);
      // 如果加载失败，清除选中的图纸状态
      setSelectedDrawing(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  // 检测是否有变更
  const hasChanges = (): boolean => {
    if (!originalDrawingData.current) return true; // 没有原始数据时，默认允许保存

    const original = originalDrawingData.current;

    // 检查基本字段
    if (title !== original.title) return true;
    if (description !== original.description) return true;
    if (statusValue !== original.status) return true;
    if (shared !== original.shared) return true;
    if (selectedFolderIdForEdit !== original.folder_id) return true;

    // 检查材料清单
    const currentMaterials = Array.isArray(materials) ? materials : [];
    const originalMaterials = original.materials || [];

    // 数量不同（包括未完成的行）
    if (currentMaterials.length !== originalMaterials.length) return true;

    // 解析当前材料，始终尝试从 productSearch 中获取最新的 product_id
    const resolvedCurrent = currentMaterials.map((r) => {
      const key = r.id || '';
      const display = (productSearch[key] || '').toString().trim();
      if (display) {
        const code = display.split(/\s|\(/)[0];
        if (code) {
          const prod = products.find((p) => p.code === code);
          if (prod) {
            return { ...r, product_id: prod.id };
          }
        }
      }
      return r;
    });

    // 按原始顺序比较 material 内容（包括顺序变化）
    const validCurrent = resolvedCurrent.filter(m => m.product_id && m.quantity && m.quantity > 0);
    const validOriginal = originalMaterials.filter(m => m.product_id && m.quantity && m.quantity > 0);

    if (validCurrent.length !== validOriginal.length) return true;

    for (let i = 0; i < validCurrent.length; i++) {
      if (validCurrent[i].product_id !== validOriginal[i].product_id) return true;
      if (validCurrent[i].quantity !== validOriginal[i].quantity) return true;
    }

    return false;
  };

  // 物料排序函数：根据排序方式对物料数组进行排序
  const sortMaterials = (materialsArray: MaterialLine[], sortBy: string): MaterialLine[] => {
    return [...materialsArray].sort((a, b) => {
      const productA = products.find(p => p.id === a.product_id);
      const productB = products.find(p => p.id === b.product_id);
      const codeA = productA?.code || '';
      const codeB = productB?.code || '';
      const qtyA = a.quantity || 0;
      const qtyB = b.quantity || 0;

      switch (sortBy) {
        case 'code_desc':
          return codeB.localeCompare(codeA, undefined, { numeric: true, sensitivity: 'base' });
        case 'qty_asc':
          if (qtyA !== qtyB) return qtyA - qtyB;
          // 数量相同时按代码升序
          return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
        case 'qty_desc':
          if (qtyA !== qtyB) return qtyB - qtyA;
          // 数量相同时按代码升序
          return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
        case 'code_asc':
        default:
          return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
      }
    });
  };

  // 立即排序物料列表
  const handleSortMaterialsNow = () => {
    const sorted = sortMaterials(materials, materialSortBy);
    setMaterials(sorted);
  };

  const handleAddMaterialRow = () => {
    setMaterials((prev) => [...prev, { product_id: null, quantity: null, id: `m-${Date.now()}-${Math.random()}` }]);
  };

  const handleRemoveMaterialRow = (rowId?: string) => {
    setMaterials((prev) => prev.filter((r) => r.id !== rowId));
  };

  const handleMaterialChange = (rowId: string | undefined, field: 'product_id' | 'quantity', value: any) => {
    setMaterials((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: field === 'quantity' ? parseInt(value || '0') : value } : r)));
  };

  const handleProductSearchChange = (rowId: string, value: string) => {
    setProductSearch((prev) => ({ ...prev, [rowId]: value }));
    setOpenPickerRow(rowId);
  };

  const handleSelectProductForRow = (rowId: string, product: ProductOption) => {
    // set product id on row and set displayed search text
    setMaterials((prev) => {
      const next = prev.map((r) => (r.id === rowId ? { ...r, product_id: product.id } : r));
      // debug log for selection
      try { console.debug('[drawings] handleSelectProductForRow - set product_id', { rowId, productId: product.id, nextMaterials: next }); } catch (e) { }
      return next;
    });
    setProductSearch((prev) => ({ ...prev, [rowId]: `${product.code}${product.category_name ? ' (' + product.category_name + ')' : ''}` }));
    setOpenPickerRow(null);
    // fetch current stock & in-transit quantities for this product and update row
    (async () => {
      try {
        const res = await api.get(`/inventory/products/${product.id}/stock`);
        const { inventory_qty, in_transit_qty, unit_price } = res.data || {};
        setMaterials((prev) => {
          const next = prev.map((r) => (r.id === rowId ? { ...r, inventory_qty: inventory_qty || 0, in_transit_qty: in_transit_qty || 0 } : r));
          try { console.debug('[drawings] handleSelectProductForRow - updated inventory', { rowId, productId: product.id, inventory_qty, in_transit_qty, nextMaterials: next }); } catch (e) { }
          return next;
        });
        // also update displayed unit price if needed in productSearch metadata (optional)
      } catch (err) {
        // ignore silently; inventory fields remain as-is
        console.error('fetch stock failed', err);
      }
    })();
  };

  const handleCreate = async () => {
    if (!title || title.trim() === '') {
      alert('名称为必填项');
      return;
    }

    // 确保materials是数组，避免undefined错误
    let materialsArray = Array.isArray(materials) ? materials : [];

    // 始终尝试从 productSearch 中解析最新的物料代码
    const productSearchSnapshot = { ...(productSearch || {}) };
    const resolvedArr = materialsArray.map((r) => {
      const key = r.id || '';
      const display = (productSearchSnapshot[key] || '').toString().trim();
      if (display) {
        const code = display.split(/\s|\(/)[0];
        if (code) {
          const prod = products.find((p) => p.code === code);
          if (prod) {
            productSearchSnapshot[key] = `${prod.code}${prod.category_name ? ' (' + prod.category_name + ')' : ''}`;
            return { ...r, product_id: prod.id };
          }
        }
      }
      return r;
    });
    setMaterials(resolvedArr);
    setProductSearch(productSearchSnapshot);
    materialsArray = resolvedArr;

    // 已移除：不再做不完整行与重复物料的阻断检查（功能将重做）

    setSaving(true);
    try {
      // 排序物料：根据选择的排序方式排序（默认按代码升序）
      const validMaterials = materialsArray.filter((m) => m.product_id && m.quantity && m.quantity > 0);
      const sortedMaterials = sortMaterials(validMaterials, materialSortBy);

      const payload: any = {
        title,
        description,
        status: statusValue,
        shared: shared ? 1 : 0,
        folder_id: selectedFolderIdForEdit,
        materials: sortedMaterials.map((m) => ({ product_id: m.product_id, quantity: m.quantity })),
      };
      const res = await api.post('/drawings', payload);
      const newDrawing = res.data.drawing;
      await loadDrawings(1); // 创建后跳转到第一页
      // select newly created for editing
      if (newDrawing && newDrawing.id) {
        handleSelectDrawing(newDrawing.id);
      }
    } catch (error) {
      console.error('创建图纸失败', error);
      alert('创建失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!selectedDrawing) {
      alert('请先选择或创建图纸');
      return;
    }

    // 检测是否有变更
    if (!hasChanges()) {
      alert('没有需要保存的修改');
      return;
    }

    // 确保materials是数组，避免undefined错误
    let materialsArray = Array.isArray(materials) ? materials : [];

    // 始终尝试从 productSearch 中解析最新的物料代码
    // 这样即使用户只修改了输入框内容而没有从下拉框选择，也能正确保存
    const productSearchSnapshot = { ...(productSearch || {}) };
    const resolvedArr = materialsArray.map((r) => {
      const key = r.id || '';
      const display = (productSearchSnapshot[key] || '').toString().trim();
      if (display) {
        // 尝试从显示文本中提取 code（例如 "A01 (MARD)" -> "A01"）
        const code = display.split(/\s|\(/)[0];
        if (code) {
          const prod = products.find((p) => p.code === code);
          if (prod) {
            // update productSearch display to canonical form
            productSearchSnapshot[key] = `${prod.code}${prod.category_name ? ' (' + prod.category_name + ')' : ''}`;
            return { ...r, product_id: prod.id };
          }
        }
      }
      return r;
    });
    // 更新状态
    setMaterials(resolvedArr);
    setProductSearch(productSearchSnapshot);
    materialsArray = resolvedArr;

    // 已移除：不再做不完整行与重复物料的阻断检查（功能将重做）

    setSaving(true);
    try {
      // 排序物料：根据选择的排序方式排序（默认按代码升序）
      const validMaterials = materialsArray.filter((m) => m.product_id && m.quantity && m.quantity > 0);
      const sortedMaterials = sortMaterials(validMaterials, materialSortBy);

      const payload: any = {
        title,
        description,
        status: statusValue,
        shared: shared ? 1 : 0,
        folder_id: selectedFolderIdForEdit,
        materials: sortedMaterials.map((m) => ({ product_id: m.product_id, quantity: m.quantity })),
      };
      await api.put(`/drawings/${selectedDrawing.id}`, payload);
      // reload detail to update price & images
      await handleSelectDrawing(selectedDrawing.id);
      await loadDrawings(currentPage); // 保存后保持当前页
      alert('保存成功');
    } catch (error: any) {
      console.error('保存图纸失败', error);

      // 构建详细的错误信息
      let errorMessage = '保存失败';

      if (error?.response?.data?.error) {
        errorMessage = `保存失败：${error.response.data.error}`;

        // 如果有无效产品的详细信息，也显示出来
        if (error.response.data.invalidProducts && error.response.data.invalidProducts.length > 0) {
          const invalidList = error.response.data.invalidProducts
            .map((p: any) => `产品ID: ${p.product_id} (位置: ${p.index + 1})`)
            .join('\n');
          errorMessage += `\n\n无效的产品：\n${invalidList}`;
        }
      } else if (error?.message) {
        errorMessage = `保存失败：${error.message}`;
      }

      alert(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleBlueprintFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (f) setBlueprintFile(f);
  };

  // 已移除：handleCompletionFilesChange（完成图由完工记录管理）

  // 处理OCR识别结果
  const handleMaterialDetected = (detectedMaterials: Array<{ code?: string; quantity: number; name?: string }>) => {
    // 将识别的物料添加到BOM清单
    const newMaterials = detectedMaterials.map((m, idx) => {
      // 尝试通过code查找对应的product_id
      const product = products.find(p => p.code === m.code);
      return {
        id: `detected-${Date.now()}-${idx}`,
        product_id: product?.id || null,
        quantity: m.quantity,
        inventory_qty: undefined,
        in_transit_qty: undefined
      };
    });

    setMaterials([...materials, ...newMaterials]);
    alert(`已识别并添加 ${detectedMaterials.length} 个物料`);
  };

  const handleUploadImages = async () => {
    // If no drawing selected (new draft), create it first so we have an id to upload to
    if (!selectedDrawing) {
      if (!title || title.trim() === '') {
        alert('请先填写名称以创建图纸后上传图片');
        return;
      }
      setSaving(true);
      try {
        const payload: any = {
          title,
          description,
          status: statusValue,
          materials: materials
            .filter((m) => m.product_id && m.quantity && m.quantity > 0)
            .map((m) => ({ product_id: m.product_id, quantity: m.quantity })),
        };
        const resCreate = await api.post('/drawings', payload);
        const newDrawing = resCreate.data.drawing;
        if (newDrawing && newDrawing.id) {
          // store temp id so upload later can reference it synchronously
          (window as any).__tempCreatedDrawingId__ = newDrawing.id;
          await loadDrawings();
          await handleSelectDrawing(newDrawing.id);
        } else {
          alert('创建图纸失败，无法上传图片');
          setSaving(false);
          return;
        }
      } catch (err) {
        console.error('自动创建图纸失败', err);
        alert('创建图纸失败，无法上传图片');
        setSaving(false);
        return;
      } finally {
        setSaving(false);
      }
    }
    if (!blueprintFile) {
      alert('请选择要上传的图纸图片');
      return;
    }
    const form = new FormData();
    if (blueprintFile) form.append('blueprint', blueprintFile);
    // 完成图的上传交由“完工记录”模块，此处仅上传图纸（blueprint）
    try {
      const drawingIdToUse = selectedDrawing ? selectedDrawing.id : ((window as any).__tempCreatedDrawingId__ || null);
      if (!drawingIdToUse) {
        alert('未找到要上传的图纸ID');
        return;
      }
      await api.post(`/drawings/${drawingIdToUse}/images`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // reload images & price
      await handleSelectDrawing(drawingIdToUse);
      setBlueprintFile(null);
      setCompletionImageFile(null);
      // cleanup temp id if any
      if ((window as any).__tempCreatedDrawingId__) delete (window as any).__tempCreatedDrawingId__;
      alert('上传成功');
    } catch (error: any) {
      console.error('上传失败', error);
      alert(error?.response?.data?.error || '上传失败');
    }
  };

  const handleCompletionImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    setCompletionImageFile(f || null);
  };

  const handleSubmitCompletionRecord = async () => {
    if (!selectedDrawing) {
      alert('请先选择图纸');
      return;
    }
    if (!completionQty || completionQty <= 0) {
      alert('请输入大于0的完工数量');
      return;
    }
    setCompletionSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('drawing_id', String((selectedDrawing as any).id));
      fd.append('quantity', String(completionQty));
      if (completionImageFile) {
        fd.append('image', completionImageFile);
        try {
          const sha = await computeFileSHA256(completionImageFile);
          fd.append('image_hash', sha);
        } catch (e) {
          // 计算失败不阻止上传，继续上传文件
          console.warn('计算图片哈希失败，继续上传', e);
        }
      }
      if (completionCompletedAt) fd.append('completed_at', completionCompletedAt);
      if (completionSatisfaction) fd.append('satisfaction', String(completionSatisfaction));
      await api.post('/completions', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      // refresh details & counts
      await handleSelectDrawing((selectedDrawing as any).id);
      await loadDrawings(currentPage); // 保持当前页
      setShowCompletionModal(false);
      setCompletionQty(1);
      setCompletionImageFile(null);
      setCompletionCompletedAt(null);
      setCompletionSatisfaction(null);
      alert('完工记录已添加');
    } catch (err: any) {
      console.error('添加完工记录失败', err);
      alert(err?.response?.data?.error || '添加失败');
    } finally {
      setCompletionSubmitting(false);
    }
  };

  // 将图片URL转换为File对象
  const urlToFile = async (url: string, filename: string): Promise<File> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type });
  };

  const handleExportDrawing = async (drawingId?: number, title?: string) => {
    if (!drawingId) {
      alert('请选择要导出的图纸');
      return;
    }
    try {
      const res = await api.get(`/drawings/${drawingId}/export`, { responseType: 'blob' });
      let filename = `${drawingId}-${(title || '').replace(/\s+/g, '_') || 'drawing'}.zip`;
      const disposition = res.headers?.['content-disposition'] || '';
      const m = disposition.match(/filename\\*?=UTF-8''(.+)$/);
      if (m && m[1]) {
        filename = decodeURIComponent(m[1]);
      }
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('导出失败', err);
      alert('导出失败');
    }
  };

  const [importingBom, setImportingBom] = useState(false);
  const handleBomFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!selectedDrawing) {
      alert('请先选择或创建图纸再导入 BOM');
      return;
    }
    const form = new FormData();
    form.append('file', f);
    setImportingBom(true);
    api.post(`/drawings/${selectedDrawing.id}/import-bom`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((res) => {
        alert('导入完成');
        // reload details to reflect new materials
        handleSelectDrawing(selectedDrawing.id);
      })
      .catch((err) => {
        console.error('BOM 导入失败', err);
        alert(err?.response?.data?.error || '导入失败');
      })
      .finally(() => {
        setImportingBom(false);
        // clear input value if any
        (e.target as HTMLInputElement).value = '';
      });
  };
  // 持久化弹窗状态
  const [showBulkBomModal, setShowBulkBomModal] = useLocalStorageState<boolean>('drawings-showBulkBomModal', false);

  // ========== 多维度管理 - 编辑表单状态 ==========
  const [selectedFolderIdForEdit, setSelectedFolderIdForEdit] = useState<number | null>(null);
  // ============================================
  const [bulkBomText, setBulkBomText] = useLocalStorageState<string>('drawings-bulkBomText', '');
  const [bulkOverwrite, setBulkOverwrite] = useLocalStorageState<boolean>('drawings-bulkOverwrite', false);
  const [showPixelViewer, setShowPixelViewer] = useLocalStorageState<boolean>('drawings-showPixelViewer', false);
  const [pixelGridData, setPixelGridData] = useLocalStorageState<PixelCell[][]>('drawings-pixelGridData', []);
  const [materialStats, setMaterialStats] = useLocalStorageState<any[]>('drawings-materialStats', []);
  const [statsVisible, setStatsVisible] = useLocalStorageState<boolean>('drawings-statsVisible', true);
  const [highlightedProductId, setHighlightedProductId] = useLocalStorageState<number | null>('drawings-highlightedProductId', null);
  const [showCompletionModal, setShowCompletionModal] = useLocalStorageState<boolean>('drawings-showCompletionModal', false);
  const [completionQty, setCompletionQty] = useLocalStorageState<number>('drawings-completionQty', 1);
  const [completionCompletedAt, setCompletionCompletedAt] = useLocalStorageState<string | null>('drawings-completionCompletedAt', null);
  const [completionSatisfaction, setCompletionSatisfaction] = useLocalStorageState<number | null>('drawings-completionSatisfaction', null);
  const [showViewCompletionsModal, setShowViewCompletionsModal] = useLocalStorageState<boolean>('drawings-showViewCompletionsModal', false);
  const [showEditModal, setShowEditModal] = useLocalStorageState<boolean>('drawings-showEditModal', false);
  const [editingId, setEditingId] = useLocalStorageState<number | null>('drawings-editingId', null);
  const [editQuantity, setEditQuantity] = useLocalStorageState<number>('drawings-editQuantity', 1);
  const [editCompletedAt, setEditCompletedAt] = useLocalStorageState<string | null>('drawings-editCompletedAt', null);
  const [editSatisfaction, setEditSatisfaction] = useLocalStorageState<number | null>('drawings-editSatisfaction', null);
  const [showImageModal, setShowImageModal] = useLocalStorageState<boolean>('drawings-showImageModal', false);
  const [imageModalSrc, setImageModalSrc] = useLocalStorageState<string | null>('drawings-imageModalSrc', null);
  const [imageScale, setImageScale] = useState<number>(1);
  const [imagePosition, setImagePosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showImportModal, setShowImportModal] = useLocalStorageState<boolean>('drawings-showImportModal', false);
  const [showOrderModal, setShowOrderModal] = useState<boolean>(false);
  const [orderForm, setOrderForm] = useState<any>({
    completion_record_id: null,
    drawing_title: '',
    completion_image: '',
    completion_date: '',
    cost_price: 0,
    accessories_cost: 0,
    freight: 0,
    material_loss: 0,
    selling_price: 0
  });

  // 非持久化状态（临时状态）
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState<any | null>(null);
  const [completionImageFile, setCompletionImageFile] = useState<File | null>(null);
  const [completionSubmitting, setCompletionSubmitting] = useState<boolean>(false);
  const [drawingCompletions, setDrawingCompletions] = useState<any[]>([]);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [sharedDrawings, setSharedDrawings] = useState<any[]>([]);
  const [loadingSharedDrawings, setLoadingSharedDrawings] = useState(false);
  const [importingSharedId, setImportingSharedId] = useState<number | null>(null);

  const loadSharedDrawings = async () => {
    setLoadingSharedDrawings(true);
    try {
      const res = await api.get('/drawings/shared');
      setSharedDrawings(res.data.data || []);
    } catch (err) {
      console.error('加载共享图纸失败', err);
      setSharedDrawings([]);
    } finally {
      setLoadingSharedDrawings(false);
    }
  };

  const openImportModal = async () => {
    setShowImportModal(true);
    await loadSharedDrawings();
  };

  const handleImportDrawing = async (sharedId?: number) => {
    if (!sharedId) return;
    if (!window.confirm('确认将该共享图纸导入到您的账户中吗？导入后图纸将作为您自己的拷贝保存。')) return;
    try {
      setImportingSharedId(sharedId);
      const res = await api.post(`/drawings/${sharedId}/import`);
      const newDrawing = res.data.drawing;
      await loadDrawings(1); // 导入后跳转到第一页
      if (newDrawing && newDrawing.id) {
        await handleSelectDrawing(newDrawing.id);
      }
      alert('导入成功');
      setShowImportModal(false);
    } catch (err: any) {
      console.error('导入失败', err);
      alert(err?.response?.data?.error || '导入失败');
    } finally {
      setImportingSharedId(null);
    }
  };

  const loadDrawingCompletions = async (drawingId?: number) => {
    if (!drawingId) return;
    try {
      const res = await api.get(`/completions?drawing_id=${drawingId}`);
      setDrawingCompletions(res.data.data || []);
    } catch (err) {
      console.error('加载完工记录失败', err);
      setDrawingCompletions([]);
    }
  };

  // 已移除：重复检测（将由后续重做替代）

  const openEditModal = (r: any) => {
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
      const rec = drawingCompletions.find((it) => it.id === editingId);
      if (!rec) {
        alert('未找到原始记录，无法更新');
        return;
      }
      const fd = new FormData();
      // 差异提交：仅提交发生变化的字段
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
        else fd.append('satisfaction', '');
      }
      if (editImageFile) fd.append('image', editImageFile);
      // include drawing id for multer routing
      if (rec && rec.drawing_id) fd.append('drawing_id', String(rec.drawing_id));
      if (Array.from(fd.keys()).length === 0) {
        setShowEditModal(false);
        setEditingId(null);
        alert('未检测到更改，无需保存');
        return;
      }
      await api.put(`/completions/${editingId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setShowEditModal(false);
      setEditingId(null);
      await loadDrawingCompletions(rec.drawing_id);
      await handleSelectDrawing((selectedDrawing as any).id);
      await loadDrawings(currentPage); // 保持当前页
      alert('更新成功');
    } catch (err: any) {
      console.error('更新失败', err);
      alert(err?.response?.data?.error || '更新失败');
    }
  };

  const openOrderModal = (rec: any) => {
    // calculate cost price from drawing materials + unit prices
    // Note: This is an estimation. ideally we should snapshot this.
    // simpler calculation: iterate drawing materials, find product in `products`, use average inventory price or just 0 if we don't track unit price well enough yet.
    // For now, let's use the `price` state which (in handleSelectDrawing) supposedly comes from server which sums up product costs?
    // Actually `price` in state is likely calculated by server based on products. Let's use that as base.
    // But `price` is for the whole drawing.

    setOrderForm({
      completion_record_id: rec.id,
      drawing_title: selectedDrawing ? selectedDrawing.title : '',
      completion_image: rec.image_path || '',
      completion_date: rec.completed_at || rec.created_at || new Date().toISOString(),
      cost_price: price || 0, // snapshot current estimated cost
      accessories_cost: 0,
      freight: 0,
      material_loss: 0,
      selling_price: 0
    });
    setShowOrderModal(true);
  };

  const handleSubmitOrder = async () => {
    try {
      await api.post('/sales_orders', orderForm);
      alert('订单创建成功');
      setShowOrderModal(false);
    } catch (err: any) {
      console.error('创建订单失败', err);
      alert(err?.response?.data?.error || '创建订单失败');
    }
  };

  const openImageModal = (relPath?: string) => {
    if (!relPath) return;
    setImageModalSrc(`${window.location.origin}/uploads/drawings/${relPath}`);
    setShowImageModal(true);
  };

  const downloadFile = async (relPath?: string, filename?: string) => {
    if (!relPath) {
      alert('未找到要下载的文件');
      return;
    }
    try {
      // encode each path segment to preserve slashes
      const encoded = relPath.split('/').map(encodeURIComponent).join('/');
      const url = `${window.location.origin}/uploads/drawings/${encoded}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`网络错误: ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename || relPath.split('/').pop() || 'file';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('下载失败', err);
      alert('下载失败：' + (err && (err as Error).message ? (err as Error).message : '未知错误'));
    }
  };

  const handleBulkBomSubmit = async () => {
    // If no drawing selected (we're creating new), create it first and use its id as target
    let targetDrawingId: number | null = selectedDrawing ? selectedDrawing.id : null;
    if (!targetDrawingId) {
      if (!title || title.trim() === '') {
        alert('请先填写名称以创建图纸后再导入 BOM');
        return;
      }
      setSaving(true);
      try {
        const payload: any = {
          title,
          description,
          status: statusValue,
          materials: materials
            .filter((m) => m.product_id && m.quantity && m.quantity > 0)
            .map((m) => ({ product_id: m.product_id, quantity: m.quantity })),
        };
        const resCreate = await api.post('/drawings', payload);
        const newDrawing = resCreate.data.drawing;
        if (newDrawing && newDrawing.id) {
          await loadDrawings();
          await handleSelectDrawing(newDrawing.id);
          targetDrawingId = newDrawing.id;
        } else {
          alert('创建图纸失败，无法导入 BOM');
          setSaving(false);
          return;
        }
      } catch (err) {
        console.error('自动创建图纸失败', err);
        alert('创建图纸失败，无法导入 BOM');
        setSaving(false);
        return;
      } finally {
        setSaving(false);
      }
    }
    const lines = bulkBomText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) {
      alert('请粘贴要导入的多行 BOM 数据');
      return;
    }

    // 检查导入数据中的重复代码
    const importCodes: string[] = [];
    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        importCodes.push(parts[0]);
      }
    }
    const codeCount: Record<string, number> = {};
    importCodes.forEach(code => {
      codeCount[code] = (codeCount[code] || 0) + 1;
    });
    const duplicateImportCodes = Object.keys(codeCount).filter(code => codeCount[code] > 1);
    if (duplicateImportCodes.length > 0) {
      const confirmed = window.confirm(`导入数据中发现重复的物料代码：${duplicateImportCodes.join(', ')}\n\n确定要继续导入吗？`);
      if (!confirmed) {
        return;
      }
    }

    setBulkImporting(true);
    setBulkResult(null);
    try {
      // append mode: send to targetDrawingId determined above
      const res = await api.post(`/drawings/${targetDrawingId}/import-bom-bulk`, { lines, overwrite: bulkOverwrite });
      setBulkResult(res.data || null);
      alert('批量导入完成');
      await handleSelectDrawing(targetDrawingId as number);
      setBulkBomText('');
      setShowBulkBomModal(false);
    } catch (err: any) {
      console.error('批量导入失败', err);
      alert(err?.response?.data?.error || '导入失败');
    } finally {
      setBulkImporting(false);
    }
  };

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">图纸档案管理</h2>
        <div className="flex items-center space-x-3">
          <button
            className="bg-green-500 hover:bg-green-600 text-white py-2 px-4 rounded"
            onClick={openNewDrawingForm}
          >
            新建图纸
          </button>
          <button
            className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded"
            onClick={openImportModal}
          >
            导入图纸
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-6 gap-6">
        {/* 左侧：目录树 */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow p-4 sticky top-20">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">目录</h3>
              <button
                onClick={() => handleCreateFolder(null)}
                className="p-1.5 hover:bg-gray-100 rounded text-blue-600 hover:text-blue-700 transition-colors"
                title="新建目录"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
            <DirectoryTree
              tree={folders}
              selectedFolderId={selectedFolderId}
              onFolderSelect={setSelectedFolderId}
              onFolderCreate={handleCreateFolder}
              onFolderEdit={handleEditFolder}
              onFolderDelete={handleDeleteFolder}
              onFolderDrop={handleFolderDrop}
              loading={loadingFolders}
            />
          </div>
        </div>

        {/* 中间：图纸列表 + 标签云 */}
        <div className="lg:col-span-2 space-y-4">
          {/* 图纸列表 */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-lg font-medium mb-2">图纸列表</h3>
            {/* 分页置顶（粘性）— 当列表很长时固定在顶部，避免滚动时查找分页 */}
            {totalDrawings > pageSize && (
              <div className="sticky top-20 z-20 mb-3 bg-white p-2 rounded">
                <div className="flex flex-nowrap items-center justify-between">
                  <div className="text-sm text-gray-500 whitespace-nowrap overflow-hidden truncate">
                    显示 {Math.min((currentPage - 1) * pageSize + 1, totalDrawings)} - {Math.min(currentPage * pageSize, totalDrawings)} 条，共 {totalDrawings} 条记录
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <button
                      onClick={() => loadDrawings(currentPage - 1)}
                      disabled={currentPage <= 1 || loadingDrawings}
                      className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 flex-shrink-0"
                    >
                      上一页
                    </button>
                    <span className="text-sm text-gray-600 whitespace-nowrap">
                      第 {currentPage} 页，共 {Math.ceil(totalDrawings / pageSize)} 页
                    </span>
                    <button
                      onClick={() => loadDrawings(currentPage + 1)}
                      disabled={currentPage >= Math.ceil(totalDrawings / pageSize) || loadingDrawings}
                      className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 flex-shrink-0"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="mb-3">
              <div className="flex items-center space-x-2 flex-nowrap">
                <input value={listSearch} onChange={(e) => setListSearch(e.target.value)} placeholder="按名称搜索" className="flex-1 min-w-0 border rounded p-2 text-sm" />
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className={`px-3 py-2 rounded text-sm flex items-center space-x-1 flex-shrink-0 border transition-colors ${
                    showArchived
                      ? 'bg-purple-100 border-purple-300 text-purple-700 hover:bg-purple-200'
                      : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
                  }`}
                  title={showArchived ? '点击隐藏已归档图纸' : '点击显示已归档图纸'}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  <span>{showArchived ? '已归档' : '归档'}</span>
                </button>
                <div className="relative flex-shrink-0" ref={filterRef}>
                  <button
                    onClick={() => setShowStatusFilter(!showStatusFilter)}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm flex items-center space-x-1 flex-shrink-0"
                  >
                    <span>筛选</span>
                    <svg className={`w-4 h-4 transition-transform ${showStatusFilter ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showStatusFilter && (
                    <div className="absolute right-0 mt-1 w-48 bg-white border rounded shadow-lg z-10">
                      <div className="p-3">
                        <div className="text-sm font-medium text-gray-700 mb-2">按状态筛选</div>
                        <div className="space-y-2">
                          {[
                            { value: 'recorded', label: '仅记录', color: '#6B7280' },
                            { value: 'pending', label: '待完成', color: '#F59E0B' },
                            { value: 'completed', label: '已完成', color: '#10B981' },
                            { value: 'archived', label: '已归档', color: '#8B5CF6', disabled: true }
                          ].map((status) => (
                            <label key={status.value} className={`flex items-center space-x-2 ${status.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                              <input
                                type="checkbox"
                                checked={statusFilters.includes(status.value)}
                                onChange={(e) => {
                                  if (status.disabled) return;
                                  if (e.target.checked) {
                                    setStatusFilters([...statusFilters, status.value]);
                                  } else {
                                    setStatusFilters(statusFilters.filter(s => s !== status.value));
                                  }
                                }}
                                disabled={status.disabled}
                                className="rounded"
                              />
                              <span className="text-sm flex items-center space-x-1">
                                <div className="w-3 h-3 rounded" style={{ backgroundColor: status.color }}></div>
                                <span>{status.label}</span>
                                {status.disabled && <span className="text-xs text-gray-400">(使用上方开关)</span>}
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <button
                            onClick={() => setStatusFilters(['recorded', 'pending', 'completed', 'archived'])}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            全选
                          </button>
                          <button
                            onClick={() => setStatusFilters([])}
                            className="text-xs text-gray-600 hover:text-gray-800"
                          >
                            清空
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {loadingDrawings ? (
              <div className="text-center py-8">加载中...</div>
            ) : (
              <div className="space-y-2 max-h-[70vh] overflow-auto pr-2">
                {/* 批量选择工具栏 */}
                {selectedDrawingIds.length > 0 && (
                  <div className="sticky top-0 z-20 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-blue-700">
                        已选择 {selectedDrawingIds.length} 个图纸
                      </div>
                      <button
                        onClick={() => setSelectedDrawingIds([])}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        清空选择
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleBatchMove}
                        className="inline-flex items-center px-2 py-1 bg-white hover:bg-gray-50 border border-gray-300 rounded text-xs"
                      >
                        📁 移动到目录
                      </button>
                      <button
                        onClick={() => handleBatchArchive(true)}
                        className="inline-flex items-center px-2 py-1 bg-white hover:bg-gray-50 border border-gray-300 rounded text-xs"
                      >
                        📦 归档
                      </button>
                      <button
                        onClick={() => handleBatchArchive(false)}
                        className="inline-flex items-center px-2 py-1 bg-white hover:bg-gray-50 border border-gray-300 rounded text-xs"
                      >
                        📂 取消归档
                      </button>
                    </div>
                  </div>
                )}

                {/* 全选按钮 */}
                {drawings.length > 0 && (
                  <button
                    onClick={handleSelectAllDrawings}
                    className="w-full text-left p-2 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded"
                  >
                    {selectedDrawingIds.length === drawings.length ? '✓ 已全选（点击取消）' : '☐ 全选当前页'}
                  </button>
                )}

                {drawings.map((d) => {
                  const isSelected = selectedDrawingIds.includes(d.id);
                  return (
                    <div
                      key={d.id}
                      className={`relative rounded flex items-center justify-between ${isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'} ${selectedDrawing?.id === d.id ? 'bg-blue-100 border-2 border-blue-300' : ''}`}
                    >
                      {/* 批量选择复选框 */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleDrawingSelection(d.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                      />

                      {/* 图纸内容 */}
                      <button
                        onClick={() => handleSelectDrawing(d.id)}
                        className="flex-1 flex items-center justify-between p-3 pl-10 text-left"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-12 h-12 rounded bg-gray-100 overflow-hidden flex items-center justify-center">
                            {(d as any).thumbnail ? (
                              <img
                                src={`${window.location.origin}/uploads/drawings/${(d as any).thumbnail}`}
                                alt={d.title}
                                title={d.title}
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover"
                                style={{ transform: 'scale(1.25)', transformOrigin: 'center' }}
                              />
                            ) : (
                              <div className="text-xs text-gray-500">无图</div>
                            )}
                          </div>
                          <div className="text-left min-w-0">
                            <div className="font-medium truncate">{d.title}</div>
                            <div className="text-sm text-gray-500 truncate">{d.created_at ? formatBeijingTimeShort(d.created_at) : ''}</div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3 flex-shrink-0">
                          <div className="text-sm text-gray-400">#{d.id}</div>
                          <div className="text-xs px-2 py-1 rounded text-white" style={{ backgroundColor: d.status === 'completed' ? '#10B981' : d.status === 'pending' ? '#F59E0B' : '#6B7280' }}>
                            {d.status === 'completed' ? '已完成' : d.status === 'pending' ? '待完成' : '仅记录'}
                          </div>
                        </div>
                      </button>
                    </div>
                  );
                })}
                {drawings.length === 0 && <div className="text-gray-500">还没有图纸，点击"新建图纸"开始</div>}

                {/* 分页已移至顶部粘性区域 */}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：编辑面板 */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium mb-4">{selectedDrawing ? '编辑图纸' : '新建图纸'}</h3>

            {/* 粘性按钮条：固定在编辑面板顶部，避免长 BOM 滚动时按钮被卷走 */}
            <div className="sticky top-20 z-30 -mx-6 mb-4">
              <div className="bg-white p-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <button onClick={() => setShowBulkBomModal(true)} className="inline-flex items-center px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm">
                    批量导入 BOM
                  </button>
                  {!selectedDrawing ? (
                    <button onClick={handleCreate} className="inline-flex items-center px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded text-sm" disabled={saving}>
                      创建
                    </button>
                  ) : (
                    <>
                      <div className="inline-flex items-center space-x-2">
                        <button onClick={() => { setShowCompletionModal(true); }} className="inline-flex items-center px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-sm">
                          添加完工记录
                        </button>
                        <button onClick={async () => { await loadDrawingCompletions((selectedDrawing as any).id); setShowViewCompletionsModal(true); }} className="inline-flex items-center px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm">
                          查看完工记录
                        </button>
                      </div>
                      <button onClick={handleSave} className="inline-flex items-center px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors" disabled={saving}>
                        {saving ? (
                          <>
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            保存中...
                          </>
                        ) : '保存'}
                      </button>
                      <button onClick={() => handleExportDrawing((selectedDrawing as any).id, (selectedDrawing as any).title)} className="inline-flex items-center px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded text-sm">
                        导出图纸
                      </button>
                      <button onClick={async () => {
                        if (!window.confirm('确认删除此图纸？此操作不可撤销。')) return;
                        try {
                          await api.delete(`/drawings/${(selectedDrawing as any).id}`);
                          setSelectedDrawing(null);
                          const newPage = drawings.length <= 1 && currentPage > 1 ? currentPage - 1 : currentPage;
                          await loadDrawings(newPage);
                          alert('删除成功');
                        } catch (err) {
                          console.error('删除图纸失败', err);
                          alert('删除失败');
                        }
                      }} className="inline-flex items-center px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded text-sm">
                        删除图纸
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">名称（必填）</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">状态</label>
                <select value={statusValue} onChange={(e) => setStatusValue(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded p-2">
                  <option value="recorded">仅记录</option>
                  <option value="pending">待完成</option>
                  <option value="completed">已完成</option>
                  <option value="archived">已归档</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">目录</label>
                <select
                  value={selectedFolderIdForEdit ?? ''}
                  onChange={(e) => setSelectedFolderIdForEdit(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 block w-full border border-gray-300 rounded p-2"
                >
                  <option value="">未分类</option>
                  {folders.map((folder) => renderFolderOptions(folder, 0))}
                </select>
              </div>
              <div className="flex items-center space-x-2">
                <label className="inline-flex items-center">
                  <input type="checkbox" className="mr-2" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                  <span className="text-sm text-gray-700">是否分享</span>
                </label>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">描述</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 block w-full border rounded p-1" rows={2}></textarea>
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-600">估算成本</div>
                  <div className="text-2xl font-bold">{price ? `￥${price.toFixed(4)}` : '￥0.0000'}</div>
                  <div className="text-sm text-gray-600 mt-1">参考售价: <span className="font-bold text-green-600">￥{referenceSalesPrice.toFixed(2)}</span></div>
                  <div className="text-sm text-gray-600 mt-1">已完成次数: <span className="font-medium">{completedCount}</span></div>
                </div>
                <div className="text-sm text-gray-600">
                  总物料数量: <span className="font-medium">{materials.reduce((s, m) => s + (m.quantity || 0), 0)}</span>
                </div>
              </div>
              <h4 className="font-medium mb-2">图片上传与查看</h4>
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex-shrink-0">
                  <label className="block text-sm text-gray-700">图纸</label>
                  <div className="mt-1">
                    <input type="file" accept="image/*" onChange={handleBlueprintFileChange} className="border rounded p-1 text-sm w-full" />
                    <div className="mt-2 flex space-x-2">
                      <button onClick={handleUploadImages} className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-3 rounded text-sm">上传图片</button>
                      <button
                        onClick={() => setShowMaterialRecognition(true)}
                        disabled={!selectedDrawing}
                        className="bg-green-500 hover:bg-green-600 text-white py-2 px-3 rounded text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        物料识别
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">完成图上传在“完工记录”模块管理</div>
                </div>

                <div className="flex-1 min-w-[220px]">
                  <h5 className="text-sm font-medium">图纸（缩略图）</h5>
                  <div className="mt-2 flex items-start space-x-4">
                    {(() => {
                      const blueprint = images.find((im) => im.image_type === 'blueprint');
                      if (!blueprint) {
                        return <div className="text-gray-500">暂无图纸</div>;
                      }
                      return (
                        <div className="w-36 h-36 border rounded overflow-hidden relative flex-shrink-0">
                          <img
                            src={`${window.location.origin}/uploads/drawings/${blueprint.file_path}`}
                            alt={blueprint.file_name}
                            title={blueprint.file_name}
                            className="w-full h-full object-cover cursor-pointer"
                            style={{ transform: 'scale(1.25)', transformOrigin: 'center' }}
                            onClick={() => openImageModal(blueprint.file_path)}
                            onError={(e) => {
                              console.error('图片加载失败:', e.currentTarget.src);
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                          <button onClick={(e) => {
                            e.stopPropagation();
                            downloadFile(blueprint.file_path, blueprint.file_name || 'drawing.jpg');
                          }} className="absolute top-1 right-8 bg-black bg-opacity-50 text-white rounded-full p-1 hover:opacity-100 transition-opacity z-10" title="下载图纸">
                            ↓
                          </button>
                          <button onClick={async (e) => {
                            e.stopPropagation();
                            if (!window.confirm('确认删除此图纸？')) return;
                            try {
                              await api.delete(`/drawings/${(selectedDrawing as any).id}/images/${blueprint.id}`);
                              await handleSelectDrawing((selectedDrawing as any).id);
                            } catch (err) {
                              console.error('删除图纸失败', err);
                              alert('删除失败');
                            }
                          }} className="absolute top-1 right-1 bg-black bg-opacity-50 text-white rounded-full p-1 hover:opacity-100 transition-opacity z-10" title="删除图纸">
                            ×
                          </button>
                        </div>
                      );
                    })()}

                    {images && images.filter((im) => im.image_type !== 'blueprint').length > 0 && (
                      <div className="flex space-x-2 overflow-auto">
                        {images
                          .filter((im) => im.image_type !== 'blueprint')
                          .sort((a, b) => {
                            const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
                            const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
                            return tb - ta; // newest first
                          })
                          .map((im) => (
                            <div key={im.id} className="w-16 h-16 border rounded overflow-hidden relative flex-shrink-0">
                              <img
                                src={`${window.location.origin}/uploads/drawings/${im.file_path}`}
                                alt={im.file_name}
                                title={im.file_name}
                                className="w-full h-full object-cover cursor-pointer"
                                onClick={() => openImageModal(im.file_path)}
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                              <button onClick={(e) => { e.stopPropagation(); downloadFile(im.file_path, im.file_name || `img-${im.id}.jpg`); }} className="absolute top-1 right-8 bg-black bg-opacity-50 text-white rounded-full p-1 hover:opacity-100 transition-opacity z-10" title="下载图片">
                                ↓
                              </button>
                              <button onClick={async (e) => {
                                e.stopPropagation();
                                if (!window.confirm('确认删除此图片？')) return;
                                try {
                                  await api.delete(`/drawings/${(selectedDrawing as any).id}/images/${im.id}`);
                                  await handleSelectDrawing((selectedDrawing as any).id);
                                } catch (err) {
                                  console.error('删除图片失败', err);
                                  alert('删除失败');
                                }
                              }} className="absolute top-1 right-1 bg-black bg-opacity-50 text-white rounded-full p-1 hover:opacity-100 transition-opacity z-10" title="删除图片">
                                ×
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <div className="flex space-x-2">
                  {/* 如果图纸包含 pixelate meta，则显示可编辑按钮（仅针对通过像素化界面保存的图纸） */}
                  {selectedDrawing && hasPixelateMetaPointer(selectedDrawing.description) && (
                    <button
                      className="mt-2 inline-flex items-center px-3 py-2 bg-emerald-500 text-white rounded"
                      onClick={async () => {
                        if (!selectedDrawing) return;
                        try {
                          const meta = await fetchPixelateMetaFromServer((selectedDrawing as any).id);
                          if (!meta) {
                            alert('未能获取像素化元数据');
                            return;
                          }
                          // mark as pixelate_saved for the Pixelate page and pass full metadata
                          const payload = { ...meta, type: 'pixelate_saved' };
                          sessionStorage.setItem('pixelate-auto-upload', JSON.stringify(payload));
                          sessionStorage.setItem('pixelate-scroll-to-top', '1');
                          navigate('/pixelate');
                        } catch (err) {
                          console.error('准备像素化编辑失败', err);
                          alert('无法打开像素化编辑');
                        }
                      }}
                    >
                      像素化编辑
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium">材料清单（BOM）</h4>
                <div className="flex items-center gap-2">
                  <select
                    value={materialSortBy}
                    onChange={(e) => setMaterialSortBy(e.target.value)}
                    className="text-sm border rounded px-2 py-1"
                    title="选择排序方式"
                  >
                    <option value="code_asc">代码升序 (A→Z)</option>
                    <option value="code_desc">代码降序 (Z→A)</option>
                    <option value="qty_asc">数量升序</option>
                    <option value="qty_desc">数量降序</option>
                  </select>
                  <button
                    className="text-sm text-gray-600 hover:text-blue-600 px-2 py-1 border rounded"
                    onClick={handleSortMaterialsNow}
                    title="立即排序"
                  >
                    排序
                  </button>
                  <button className="text-sm text-blue-600" onClick={handleAddMaterialRow}>添加物料</button>
                </div>
              </div>
              <div className="space-y-2">
                {(() => {
                  return materials.map((row) => {
                    const key = row.id || '';
                    const hasCustom = Object.prototype.hasOwnProperty.call(productSearch, key);
                    const displayText = hasCustom ? productSearch[key] : (products.find((p) => p.id === row.product_id)?.code || '');
                    const term = (productSearch[row.id || ''] || '').toLowerCase();
                    const filtered = (term ? products.filter((p) => {
                      const display = `${p.code}${p.category_name ? ' (' + p.category_name + ')' : ''}`.toLowerCase();
                      return display.includes(term) || p.code.toLowerCase().includes(term) || (p.category_name || '').toLowerCase().includes(term);
                    }) : products);

                    return (
                      <div key={row.id} className="grid grid-cols-12 gap-2 items-center relative">
                        <div className="col-span-6 relative">
                          <input
                            value={displayText}
                            onChange={(e) => handleProductSearchChange(row.id || '', e.target.value)}
                            onFocus={() => setOpenPickerRow(row.id || '')}
                            placeholder="搜索或选择产品"
                            className="w-full border rounded p-2"
                          />
                          {openPickerRow === row.id && (
                            <div className="absolute z-10 bg-white border rounded mt-1 w-full max-h-44 overflow-auto shadow">
                              {filtered.length === 0 ? (
                                <div className="p-2 text-sm text-gray-500">无匹配项</div>
                              ) : (
                                filtered.map((p) => (
                                  <div key={p.id} className="p-2 hover:bg-gray-50 cursor-pointer flex items-center space-x-2" onMouseDown={() => handleSelectProductForRow(row.id || '', p)}>
                                    <div className="w-5 h-5 rounded-full border" style={{ backgroundColor: p.color_hex || '#ccc' }} />
                                    <div className="text-sm">{p.code}</div>
                                    <div className="text-xs text-gray-400"> {p.category_name ? `(${p.category_name})` : ''}</div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                        <div className="col-span-4">
                          <input type="number" min={1} value={row.quantity || ''} onChange={(e) => handleMaterialChange(row.id, 'quantity', e.target.value)} className="w-full border rounded p-2" placeholder="数量" />
                        </div>
                        <div className="col-span-2">
                          <button className="text-red-500" onClick={() => handleRemoveMaterialRow(row.id)}>删除</button>
                        </div>
                        <div className="col-span-12 mt-1 text-sm text-gray-600">
                          <span className={`${(row.inventory_qty || 0) < (row.quantity || 0) ? 'text-red-600' : 'text-green-600'}`}>
                            库存：{row.inventory_qty ?? 0}
                          </span>
                          <span className="ml-3 text-gray-500">在途：{row.in_transit_qty ?? 0}</span>
                        </div>
                      </div>
                    );
                  });
                })()}
                {materials.length === 0 && <div className="text-gray-500">暂无材料，创建后可添加</div>}
              </div>
            </div>

            {/* 估算价格已移至 BOM 上方 */}
          </div>
          {/* 像素化查看弹窗 */}
          {showPixelViewer && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl w-[90vw] h-[80vh] p-4 flex">
                <div className="flex-1 mr-3 relative">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-medium">像素化查看</h3>
                    <div className="space-x-2">
                      <button className="px-3 py-1 bg-gray-100 rounded" onClick={() => setStatsVisible((v) => !v)}>{statsVisible ? '隐藏统计' : '显示统计'}</button>
                      <button className="px-3 py-1 bg-red-500 text-white rounded" onClick={() => setShowPixelViewer(false)}>关闭</button>
                    </div>
                  </div>
                  <div className="w-full h-full border rounded overflow-hidden">
                    <PixelGrid
                      pixels={pixelGridData}
                      cellSize={18}
                      gap={0}
                      highlightedProductId={highlightedProductId}
                      onCellClick={(cell) => {
                        setHighlightedProductId(cell.productId ?? null);
                      }}
                    />
                  </div>
                </div>
                <div style={{ width: 320 }} className="flex-shrink-0">
                  <StatsPanel
                    visible={statsVisible}
                    stats={materialStats}
                    totalCells={materialStats.reduce((s, it) => s + (it.count || 0), 0)}
                    onClose={() => setStatsVisible(false)}
                    onSelectMaterial={(pid) => setHighlightedProductId(pid ?? null)}
                  />
                </div>
              </div>
            </div>
          )}
          {/* 添加完工记录弹窗 */}
          {showCompletionModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium">添加完工记录</h3>
                  <button className="text-gray-500" onClick={() => setShowCompletionModal(false)}>关闭</button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm">图纸</label>
                    <div className="mt-1">{selectedDrawing ? `${(selectedDrawing as any).title || ''} (#${(selectedDrawing as any).id})` : '未选择'}</div>
                  </div>
                  <div>
                    <label className="block text-sm">完工数量</label>
                    <input type="number" min={1} value={completionQty} onChange={(e) => setCompletionQty(parseInt(e.target.value || '1'))} className="mt-1 w-full border rounded p-2" />
                  </div>
                  <div>
                    <label className="block text-sm">完工时间（可选，默认当前时间）</label>
                    <input type="datetime-local" className="mt-1 w-full border rounded p-2" value={completionCompletedAt || ''} onChange={(e) => setCompletionCompletedAt(e.target.value || null)} />
                  </div>
                  <div>
                    <label className="block text-sm">满意度（可选）</label>
                    <select className="mt-1 w-full border rounded p-2" value={completionSatisfaction ?? ''} onChange={(e) => setCompletionSatisfaction(e.target.value ? parseInt(e.target.value) : null)}>
                      <option value="">-- 请选择满意度 --</option>
                      <option value="5">很满意</option>
                      <option value="4">满意</option>
                      <option value="3">一般</option>
                      <option value="2">不满意</option>
                      <option value="1">很不满意</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm">完工成品图（可选）</label>
                    <input type="file" accept="image/*" onChange={handleCompletionImageChange} className="mt-1" />
                  </div>
                  <div className="flex items-center justify-end space-x-3">
                    <button className="px-3 py-2 bg-gray-200 rounded" onClick={() => setShowCompletionModal(false)}>取消</button>
                    <button className="px-3 py-2 bg-emerald-600 text-white rounded" onClick={handleSubmitCompletionRecord} disabled={completionSubmitting}>
                      {completionSubmitting ? '提交中...' : '提交'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* 查看完工记录弹窗 */}
          {showViewCompletionsModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] overflow-auto p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium">图纸完工记录 - {selectedDrawing ? (selectedDrawing.title || `#${selectedDrawing.id}`) : ''}</h3>
                  <button className="text-gray-500" onClick={() => setShowViewCompletionsModal(false)}>关闭</button>
                </div>
                <div className="space-y-3">
                  {drawingCompletions.length === 0 && <div className="text-sm text-gray-500">暂无完工记录</div>}
                  {drawingCompletions.map((r) => (
                    <div key={r.id} className="p-3 border rounded flex items-center justify-between">
                      <div>
                        <div><strong>完工时间：</strong>{r.completed_at ? formatBeijingTimeDate(r.completed_at) : (r.created_at ? formatBeijingTimeDate(r.created_at) : '')}</div>
                        <div><strong>数量：</strong>{r.quantity}</div>
                        <div><strong>满意度：</strong>{r.satisfaction ? (r.satisfaction === 5 ? '很满意' : r.satisfaction === 4 ? '满意' : r.satisfaction === 3 ? '一般' : r.satisfaction === 2 ? '不满意' : '很不满意') : '未填写'}</div>
                        <div className="text-xs text-gray-500 mt-1">{r.created_at ? formatBeijingTimeShort(r.created_at) : ''}</div>
                      </div>
                      <div className="flex flex-col items-end space-y-2">
                        <div className="flex space-x-2">
                          <button className="px-2 py-1 text-sm bg-indigo-100 text-indigo-700 rounded" onClick={() => openOrderModal(r)}>添加订单</button>
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
                          <div className="relative">
                            <img
                              src={`${window.location.origin}/uploads/drawings/${(r as any).thumbnail || r.image_path}`}
                              alt="完工"
                              title="完工图片"
                              loading="lazy"
                              decoding="async"
                              className="w-28 h-28 object-cover rounded cursor-pointer"
                              onClick={() => openImageModal(r.image_path)}
                            />
                            <button onClick={(e) => {
                              e.stopPropagation();
                              downloadFile(r.image_path, `completion-${r.id}.jpg`);
                            }} className="absolute top-1 right-1 bg-black bg-opacity-50 text-white rounded-full w-5 h-5 text-xs hover:opacity-100 transition-opacity z-10" title="下载图片">
                              ↓
                            </button>
                          </div>
                        ) : (
                          <div className="text-sm text-gray-400">无图片</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* 编辑弹窗（与 CompletionRecords 类似） */}
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
            <div
              className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 overflow-hidden"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setShowImageModal(false);
                  setImageScale(1);
                  setImagePosition({ x: 0, y: 0 });
                }
              }}
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                setImageScale((prev) => Math.max(0.1, Math.min(5, prev + delta)));
              }}
            >
              {/* 工具栏 */}
              <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-white bg-opacity-90 rounded-lg px-4 py-2 flex items-center gap-4 z-50 shadow-lg">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setImageScale((prev) => Math.max(0.1, prev - 0.2));
                  }}
                  className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  缩小
                </button>
                <span className="text-sm font-medium min-w-[60px] text-center">
                  {Math.round(imageScale * 100)}%
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setImageScale((prev) => Math.min(5, prev + 0.2));
                  }}
                  className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  放大
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setImageScale(1);
                    setImagePosition({ x: 0, y: 0 });
                  }}
                  className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                >
                  重置
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowImageModal(false);
                    setImageScale(1);
                    setImagePosition({ x: 0, y: 0 });
                  }}
                  className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                >
                  关闭
                </button>
              </div>

              {/* 图片容器 */}
              <div
                className="relative cursor-grab active:cursor-grabbing"
                style={{
                  transform: `scale(${imageScale}) translate(${imagePosition.x / imageScale}px, ${imagePosition.y / imageScale}px)`,
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                  setDragStart({ x: e.clientX - imagePosition.x, y: e.clientY - imagePosition.y });
                }}
                onMouseMove={(e) => {
                  if (isDragging) {
                    e.preventDefault();
                    setImagePosition({
                      x: e.clientX - dragStart.x,
                      y: e.clientY - dragStart.y,
                    });
                  }
                }}
                onMouseUp={() => {
                  setIsDragging(false);
                }}
                onMouseLeave={() => {
                  setIsDragging(false);
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={imageModalSrc}
                  alt="大图"
                  className="max-w-[90vw] max-h-[90vh] rounded shadow-lg pointer-events-none"
                  draggable={false}
                />
              </div>
            </div>
          )}

          {/* 销售订单录入弹窗 */}
          {showOrderModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium">添加销售订单</h3>
                  <button className="text-gray-500" onClick={() => setShowOrderModal(false)}>关闭</button>
                </div>
                <div className="space-y-3 max-h-[80vh] overflow-y-auto pr-1">
                  <div className="bg-gray-50 p-2 rounded text-sm space-y-1">
                    <div><strong>图纸名称：</strong>{orderForm.drawing_title}</div>
                    <div><strong>完工日期：</strong>{orderForm.completion_date ? formatBeijingTimeDate(orderForm.completion_date) : '-'}</div>
                    <div><strong>成本价(估算)：</strong>￥{(orderForm.cost_price || 0).toFixed(4)}</div>
                  </div>

                  {orderForm.completion_image && (
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">完工图</label>
                      <img
                        src={`${window.location.origin}/uploads/drawings/${orderForm.completion_image}`}
                        alt="完工图"
                        loading="lazy"
                        decoding="async"
                        className="w-32 h-32 object-cover rounded border"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium">配件成本</label>
                    <input
                      type="number" step="0.01"
                      value={orderForm.accessories_cost}
                      onChange={(e) => setOrderForm({ ...orderForm, accessories_cost: parseFloat(e.target.value) })}
                      className="mt-1 w-full border rounded p-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">运费</label>
                    <input
                      type="number" step="0.01"
                      value={orderForm.freight}
                      onChange={(e) => setOrderForm({ ...orderForm, freight: parseFloat(e.target.value) })}
                      className="mt-1 w-full border rounded p-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">物料损耗</label>
                    <input
                      type="number" step="0.01"
                      value={orderForm.material_loss}
                      onChange={(e) => setOrderForm({ ...orderForm, material_loss: parseFloat(e.target.value) })}
                      className="mt-1 w-full border rounded p-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">售价</label>
                    <input
                      type="number" step="0.01"
                      value={orderForm.selling_price}
                      onChange={(e) => setOrderForm({ ...orderForm, selling_price: parseFloat(e.target.value) })}
                      className="mt-1 w-full border rounded p-2"
                    />
                  </div>

                  <div className="pt-2 border-t mt-2">
                    <div className="flex justify-between items-center text-sm">
                      <span>总成本:</span>
                      <span>￥{((orderForm.cost_price || 0) + (orderForm.accessories_cost || 0) + (orderForm.freight || 0) + (orderForm.material_loss || 0)).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center font-bold mt-1 text-lg">
                      <span>预估利润:</span>
                      <span className={`${(orderForm.selling_price - ((orderForm.cost_price || 0) + (orderForm.accessories_cost || 0) + (orderForm.freight || 0) + (orderForm.material_loss || 0))) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ￥{(orderForm.selling_price - ((orderForm.cost_price || 0) + (orderForm.accessories_cost || 0) + (orderForm.freight || 0) + (orderForm.material_loss || 0))).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end space-x-3 mt-4">
                    <button className="px-3 py-2 bg-gray-200 rounded" onClick={() => setShowOrderModal(false)}>取消</button>
                    <button className="px-3 py-2 bg-blue-600 text-white rounded" onClick={handleSubmitOrder}>确认录入</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 批量导入 BOM 弹窗 */}
          {showBulkBomModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-auto p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium">批量导入 BOM（每行：物料代码,数量,大类 可选）</h3>
                  <button className="text-gray-500" onClick={() => setShowBulkBomModal(false)}>关闭</button>
                </div>
                <p className="text-sm text-gray-500 mb-2">示例：A01,125,MARD 或 A01,125（缺省大类将使用你库存中总量最多的大类）</p>
                <textarea value={bulkBomText} onChange={(e) => setBulkBomText(e.target.value)} className="w-full h-48 border rounded p-2 mb-3" placeholder="每行一条，如 A01,125,MARD"></textarea>
                <div className="flex items-center justify-between mb-3">
                  <label className="inline-flex items-center text-sm text-gray-700">
                    <input type="checkbox" className="mr-2" checked={bulkOverwrite} onChange={(e) => setBulkOverwrite(e.target.checked)} />
                    覆盖模式（选中将删除现有 BOM 并以导入数据覆盖；未选中为追加模式）
                  </label>
                  <div className="flex items-center space-x-3">
                    <button onClick={() => setShowBulkBomModal(false)} className="px-4 py-2 bg-gray-200 rounded">取消</button>
                    <button onClick={handleBulkBomSubmit} disabled={bulkImporting} className="px-4 py-2 bg-blue-600 text-white rounded">
                      {bulkImporting ? '导入中...' : '开始导入'}
                    </button>
                  </div>
                </div>
                {bulkResult && (
                  <div className="mt-4 text-sm text-gray-700">
                    <h4 className="font-medium">导入结果</h4>
                    <pre className="bg-gray-50 p-2 rounded text-xs">{JSON.stringify(bulkResult, null, 2)}</pre>
                  </div>
                )}
              </div>
            </div>
          )}
          {/* 导入共享图纸弹窗 */}
          {showImportModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] overflow-auto p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium">导入共享图纸</h3>
                  <button className="text-gray-500" onClick={() => setShowImportModal(false)}>关闭</button>
                </div>
                <div>
                  {loadingSharedDrawings ? (
                    <div className="text-center py-8">加载中...</div>
                  ) : (
                    <div className="space-y-3">
                      {sharedDrawings.length === 0 && <div className="text-sm text-gray-500">当前没有可导入的共享图纸</div>}
                      {sharedDrawings.map((d) => (
                        <div key={d.id} className="p-3 border rounded flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="w-12 h-12 rounded bg-gray-100 overflow-hidden flex items-center justify-center">
                              {d.thumbnail ? (
                                <img
                                  src={`${window.location.origin}/uploads/drawings/${d.thumbnail}`}
                                  alt={d.title}
                                  title={d.title}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="text-xs text-gray-500">无图</div>
                              )}
                            </div>
                            <div>
                              <div className="font-medium">{d.title}</div>
                              <div className="text-xs text-gray-500">作者: {d.username || d.user_id} · {d.created_at ? formatBeijingTimeShort(d.created_at) : ''}</div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button className="px-3 py-1 bg-green-600 text-white rounded text-sm" onClick={() => handleImportDrawing(d.id)} disabled={importingSharedId === d.id}>
                              {importingSharedId === d.id ? '导入中...' : '导入'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 目录编辑弹窗 */}
          {showFolderModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium">{folderForm.id ? '编辑目录' : '新建目录'}</h3>
                  <button className="text-gray-500" onClick={() => setShowFolderModal(false)}>关闭</button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm">目录名称</label>
                    <input
                      type="text"
                      value={folderForm.name}
                      onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })}
                      className="mt-1 w-full border rounded p-2"
                      placeholder="输入目录名称"
                    />
                  </div>
                  <div>
                    <label className="block text-sm">颜色</label>
                    <input
                      type="color"
                      value={folderForm.color}
                      onChange={(e) => setFolderForm({ ...folderForm, color: e.target.value })}
                      className="mt-1 w-full h-10 border rounded p-1"
                    />
                  </div>
                  <div className="flex items-center justify-end space-x-3 mt-4">
                    <button className="px-3 py-2 bg-gray-200 rounded" onClick={() => setShowFolderModal(false)}>取消</button>
                    <button className="px-3 py-2 bg-blue-600 text-white rounded" onClick={handleSaveFolder}>
                      {folderForm.id ? '更新' : '创建'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 批量操作弹窗 */}
          {showBatchOperationModal && batchOperationType && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium">
                    {batchOperationType === 'move' && '批量移动到目录'}
                    {batchOperationType === 'archive' && (batchForm.archived ? '批量归档' : '批量取消归档')}
                  </h3>
                  <button className="text-gray-500" onClick={() => setShowBatchOperationModal(false)}>关闭</button>
                </div>

                <div className="space-y-3">
                  {batchOperationType === 'move' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">目标目录</label>
                      <select
                        value={batchForm.targetFolderId ?? ''}
                        onChange={(e) => setBatchForm({ ...batchForm, targetFolderId: e.target.value ? Number(e.target.value) : null })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        <option value="">选择目录</option>
                        {folders.map((folder) => renderFolderOptions(folder, 0))}
                      </select>
                    </div>
                  )}

                  {batchOperationType === 'archive' && (
                    <div className="text-sm text-gray-700">
                      {batchForm.archived
                        ? `确定要归档这 ${selectedDrawingIds.length} 个图纸吗？归档后图纸将不会在默认列表中显示。`
                        : `确定要取消归档这 ${selectedDrawingIds.length} 个图纸吗？`
                      }
                    </div>
                  )}

                  <div className="flex items-center justify-end space-x-3 mt-4 pt-3 border-t border-gray-200">
                    <button
                      className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300"
                      onClick={() => setShowBatchOperationModal(false)}
                    >
                      取消
                    </button>
                    <button
                      className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                      onClick={handleExecuteBatchOperation}
                    >
                      确认操作
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 物料识别组件 */}
        {showMaterialRecognition && selectedDrawing && (
          <MaterialRecognition
            drawingId={selectedDrawing.id}
            products={products}
            onMaterialDetected={handleMaterialDetected}
            onClose={() => setShowMaterialRecognition(false)}
          />
        )}
      </div>
    </div>
  );
};

export default Drawings;
