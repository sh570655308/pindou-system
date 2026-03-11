import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { useLocalStorageState } from '../utils/useLocalStorageState';

interface Category {
  id: number;
  name: string;
  product_count: number;
}

interface Product {
  id: number;
  code: string;
  color_code: string;
  color_hex: string;
  category_name: string;
  category_id: number;
  quantity: number;
  unit_price?: number;
  in_transit_quantity?: number;
  pending_consumption?: number;
}

interface Stats {
  totalQuantity: number;
  typesCount: number;
  lowStockCount: number;
  pendingShortageCount: number;
  warningThreshold: number;
  safetyStock: number;
}

const Inventory: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  // 非持久化状态（临时状态）
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalQuantity: 0,
    typesCount: 0,
    lowStockCount: 0,
    pendingShortageCount: 0,
    warningThreshold: 300,
    safetyStock: 0,
  });
  const [loading, setLoading] = useState(true);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [editingPriceProductId, setEditingPriceProductId] = useState<number | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState<string>('');

  // 持久化状态（页面刷新后保留）
  const [selectedCategory, setSelectedCategory] = useLocalStorageState<string>('inventory-selectedCategory', '');
  const [searchTerm, setSearchTerm] = useLocalStorageState<string>('inventory-searchTerm', '');
  const [inStockOnly, setInStockOnly] = useLocalStorageState<boolean>('inventory-inStockOnly', false);
  const [lowStockOnly, setLowStockOnly] = useLocalStorageState<boolean>('inventory-lowStockOnly', false);
  const [batchSize, setBatchSize] = useLocalStorageState<number>('inventory-batchSize', 100);
  const [expandedLetters, setExpandedLetters] = useLocalStorageState<Set<string>>('inventory-expandedLetters', new Set(), {
    serialize: (value) => JSON.stringify(Array.from(value)),
    deserialize: (value) => new Set(JSON.parse(value))
  });
  const [activeLetter, setActiveLetter] = useLocalStorageState<string | null>('inventory-activeLetter', null);
  const [pendingShortageOnly, setPendingShortageOnly] = useLocalStorageState<boolean>('inventory-pendingShortageOnly', false);
  const [scrollPosition, setScrollPosition] = useLocalStorageState<number>('inventory-scrollPosition', 0);

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
    loadData();
  }, [selectedCategory, searchTerm, inStockOnly, lowStockOnly, pendingShortageOnly]);

  // 根据产品列表按首字母分组（字母 A-Z，其他归为 '#'）
  const { groupedByLetter, letters } = React.useMemo(() => {
    const map: Record<string, Product[]> = {};
    for (const p of products) {
      const raw = (p.code || '').trim();
      const first = raw ? raw[0].toUpperCase() : '#';
      const letter = /^[A-Z]$/.test(first) ? first : '#';
      if (!map[letter]) map[letter] = [];
      map[letter].push(p);
    }
    const letterKeys = Object.keys(map).sort((a, b) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
    return { groupedByLetter: map, letters: letterKeys };
  }, [products]);

  // 当切换到缺货筛选时，展开所有分组（仅在 lowStockOnly 切换时设置）
  useEffect(() => {
    if (lowStockOnly) {
      setExpandedLetters(new Set(letters));
    }
    // 当取消 lowStockOnly 时，不主动折叠，保留用户之前的折叠状态
  }, [lowStockOnly]);

  // 如果 lowStockOnly 为 true 且 letters 发生变化，确保新出现的字母也被展开（不收起已有）
  useEffect(() => {
    if (!lowStockOnly) return;
    setExpandedLetters((prev) => {
      const next = new Set(prev);
      for (const l of letters) next.add(l);
      return next;
    });
  }, [letters, lowStockOnly]);

  // 当切换到待拼不足筛选时，展开所有分组（仅在 pendingShortageOnly 切换时设置）
  useEffect(() => {
    if (pendingShortageOnly) {
      setExpandedLetters(new Set(letters));
    }
    // 取消时不收起，保留用户状态
  }, [pendingShortageOnly]);

  // 如果 pendingShortageOnly 为 true 且 letters 发生变化，确保新出现的字母也被展开（不收起已有）
  useEffect(() => {
    if (!pendingShortageOnly) return;
    setExpandedLetters((prev) => {
      const next = new Set(prev);
      for (const l of letters) next.add(l);
      return next;
    });
  }, [letters, pendingShortageOnly]);

  // 根据滚动位置高亮右侧字母导航（选取最后一个已越过 header 的分组）
  useEffect(() => {
    const onScroll = () => {
      const headerOffset = 120; // 视口顶部可能有固定头部，调整该值以匹配页面布局
      let current: string | null = letters.length > 0 ? letters[0] : null;
      for (const l of letters) {
        const el = document.getElementById(`letter-${l}`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top - headerOffset <= 0) {
          current = l;
        } else {
          break;
        }
      }
      setActiveLetter(current);
    };

    // 监听滚动和窗口大小变化
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // 初始触发一次以设置高亮
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [letters]);

  useEffect(() => {
    const onCategoriesChanged = () => loadData();
    const onSettingsChanged = () => loadData();
    window.addEventListener('categories_changed', onCategoriesChanged);
    window.addEventListener('settings_changed', onSettingsChanged);
    return () => {
      window.removeEventListener('categories_changed', onCategoriesChanged);
      window.removeEventListener('settings_changed', onSettingsChanged);
    };
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [categoriesRes, productsRes, statsRes] = await Promise.all([
        api.get('/inventory/categories'),
        api.get('/inventory/list', {
          params: {
            category: selectedCategory || undefined,
            search: searchTerm || undefined,
            inStockOnly: inStockOnly,
            lowStockOnly: lowStockOnly,
            pendingShortageOnly: pendingShortageOnly,
          },
        }),
        api.get('/inventory/stats'),
      ]);

      setCategories(categoriesRes.data);
      setProducts(productsRes.data);
      setStats(statsRes.data);

      // 如果选择了类别，默认选择第一个
      if (!selectedCategory && categoriesRes.data.length > 0) {
        setSelectedCategory(categoriesRes.data[0].name);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateQuantity = async (productId: number, delta: number) => {
    try {
      const product = products.find((p) => p.id === productId);
      if (!product) return;

    const newQuantity = product.quantity + delta;
      await setQuantity(productId, newQuantity);
    } catch (error) {
      console.error('更新库存失败:', error);
      alert('更新库存失败');
    }
  };

  const setQuantity = async (productId: number, quantity: number) => {
    try {
    const finalQuantity = quantity; // allow negative inventory
      await api.post('/inventory/update', {
        productId,
        quantity: finalQuantity,
      });

      // 更新本地状态
      setProducts((prev) =>
        prev.map((p) =>
      p.id === productId ? { ...p, quantity: finalQuantity } : p
        )
      );

      // 重新加载统计数据
      const statsRes = await api.get('/inventory/stats');
      setStats(statsRes.data);
    } catch (error) {
      console.error('更新库存失败:', error);
      alert('更新库存失败');
    }
  };

  const handleDoubleClick = (productId: number, currentQuantity: number) => {
    setEditingProductId(productId);
    setEditingValue(currentQuantity.toString());
  };

  const handleEditSubmit = async (productId: number) => {
    const value = parseInt(editingValue);
    if (!isNaN(value) && value >= 0) {
      await setQuantity(productId, value);
    }
    setEditingProductId(null);
    setEditingValue('');
  };

  const handleEditCancel = () => {
    setEditingProductId(null);
    setEditingValue('');
  };

  const handleEditKeyPress = (e: React.KeyboardEvent, productId: number) => {
    if (e.key === 'Enter') {
      handleEditSubmit(productId);
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

 

  const handlePriceSubmit = async () => {
    if (editingPriceProductId === null) return;

    const parsedPrice = parseFloat(editingPriceValue);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      alert('请输入有效的单价（大于等于0的数字）');
      return;
    }

    try {
      await api.put('/inventory/price', {
        productId: editingPriceProductId,
        unitPrice: parsedPrice,
      });

      // 更新本地状态
      setProducts((prev) =>
        prev.map((p) =>
          p.id === editingPriceProductId ? { ...p, unit_price: parsedPrice } : p
        )
      );

      setEditingPriceProductId(null);
      setEditingPriceValue('');
    } catch (error: any) {
      alert(error.response?.data?.error || '更新单价失败');
    }
  };

  const handlePriceCancel = () => {
    setEditingPriceProductId(null);
    setEditingPriceValue('');
  };

  const handlePriceKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handlePriceSubmit();
    } else if (e.key === 'Escape') {
      handlePriceCancel();
    }
  };

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 bg-blue-100 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">总数量</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalQuantity}</p>
                <p className="text-xs text-gray-500">颗拼豆</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 bg-green-100 rounded-lg">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">种类数</p>
                <p className="text-2xl font-bold text-gray-900">{stats.typesCount}</p>
                <p className="text-xs text-gray-500">种类型</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 bg-red-100 rounded-lg">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">低库存</p>
                <p className="text-2xl font-bold text-gray-900">{stats.lowStockCount}</p>
                <div className="flex items-center space-x-3">
                  <p className="text-xs text-gray-500">预警阈值：{stats.warningThreshold}颗</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 bg-orange-100 rounded-lg">
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">待拼不足</p>
                <p className="text-2xl font-bold text-gray-900">{stats.pendingShortageCount}</p>
                <div className="flex items-center space-x-3">
                  <p className="text-xs text-gray-500">安全库存：{stats.safetyStock}颗</p>
                </div>
              </div>
            </div>
          </div>

          {/* 预警阈值卡片已移动到用户设置页面 */}
        </div>

        {/* 操作栏 */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <input
                  type="text"
                  placeholder="搜索色号..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <svg className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex space-x-2 overflow-x-auto">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.name)}
                    className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
                      selectedCategory === cat.name
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {cat.name} ({cat.product_count})
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  setInStockOnly(!inStockOnly);
                  if (!inStockOnly) setLowStockOnly(false);
                }}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  inStockOnly
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <svg className="w-5 h-5 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                只看有货
              </button>
              <button
                onClick={() => {
                  setLowStockOnly(!lowStockOnly);
                  if (!lowStockOnly) {
                    setInStockOnly(false);
                    setPendingShortageOnly(false);
                  }
                }}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  lowStockOnly
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <svg className="w-5 h-5 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                缺货
              </button>
              <button
                onClick={() => {
                  setPendingShortageOnly(!pendingShortageOnly);
                  if (!pendingShortageOnly) {
                    setInStockOnly(false);
                    setLowStockOnly(false);
                  }
                }}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  pendingShortageOnly
                    ? 'bg-orange-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <svg className="w-5 h-5 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                待拼不足
              </button>
            </div>
          </div>
        </div>

        {/* 产品列表：按首字母分组并支持折叠/展开 */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">加载中...</p>
          </div>
        ) : (
          <div className="relative">
            <div className="space-y-4">
              {letters.map((letter) => {
                const group = groupedByLetter[letter] || [];
                const isExpanded = expandedLetters.has(letter);
                return (
                  <div key={letter} id={`letter-${letter}`} className="bg-white rounded-lg shadow overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedLetters((prev) => {
                          const next = new Set(prev);
                          if (next.has(letter)) next.delete(letter);
                          else next.add(letter);
                          return next;
                        });
                      }}
                      className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
                    >
                      <div className="flex items-center space-x-3">
                        <svg
                          className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? 'transform rotate-90' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span className="font-medium text-gray-900">{letter}</span>
                        <span className="text-sm text-gray-500">({group.length})</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {group.map((product) => {
                          const isPendingShortage = Number(product.pending_consumption || 0) > 0 && Number(product.pending_consumption || 0) >= (Number(product.quantity || 0) - Number(stats.safetyStock || 0));
                          const cardBgClass = product.quantity < 0 ? 'bg-red-50' : (isPendingShortage ? 'bg-orange-50' : (product.pending_consumption && product.quantity < product.pending_consumption ? 'bg-yellow-50' : 'bg-white'));
                          return (
                            <div
                              key={product.id}
                              className={`${cardBgClass} rounded-lg shadow p-4 hover:shadow-md transition-shadow`}
                            >
                              <div className="flex items-center justify-between">
                                <button
                                  type="button"
                                  onClick={() => navigate(`/inventory/logs/${product.id}`, { state: { code: product.code } })}
                                  className="flex items-center space-x-3 focus:outline-none group"
                                  title="点击查看该产品的库存变动记录"
                                >
                                  <div
                                    className="w-12 h-12 rounded-full border-2 border-gray-200 group-hover:border-blue-400 transition-colors"
                                    style={{ backgroundColor: product.color_hex || '#CCCCCC' }}
                                  />
                                  <div className="text-left">
                                    <p className="font-semibold text-gray-900 group-hover:text-blue-600">
                                      {product.code}
                                    </p>
                                    <p className="text-sm text-gray-500">{product.category_name}</p>
                      {product.unit_price !== undefined && product.unit_price !== null && product.unit_price > 0 ? (
                        <p 
                          className="text-xs text-gray-600 mt-0.5 cursor-pointer hover:text-blue-600 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingPriceProductId(product.id);
                            setEditingPriceValue((product.unit_price || 0).toFixed(4));
                          }}
                          title="点击修改单价"
                        >
                          单价：{product.unit_price.toFixed(4)}元
                        </p>
                      ) : (
                        <p 
                          className="text-xs text-gray-400 mt-0.5 cursor-pointer hover:text-blue-600 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingPriceProductId(product.id);
                            setEditingPriceValue('0.0000');
                          }}
                          title="点击设置单价"
                        >
                          单价：未设置
                        </p>
                      )}
                                    {typeof product.pending_consumption !== 'undefined' && product.pending_consumption > 0 && (
                                      <div className="text-xs mt-1">
                                        <span className="text-gray-500">待消耗：{product.pending_consumption}</span>
                                      </div>
                                    )}
                                  </div>
                                </button>
                                <div className="flex items-center space-x-2">
                                  <div className="flex flex-col items-center">
                                    <button
                                      onClick={() => updateQuantity(product.id, -batchSize)}
                                      className="w-8 h-8 bg-gray-200 hover:bg-gray-300 rounded flex items-center justify-center font-bold text-gray-700"
                                    >
                                      -
                                    </button>
                                    <span className="text-xs text-gray-500 mt-1">{batchSize}</span>
                                  </div>

                                  <div className="relative">
                                    {editingProductId === product.id ? (
                                      <div className="relative">
                                        <div>
                                          <input
                                            type="number"
                                            value={editingValue}
                                            onChange={(e) => setEditingValue(e.target.value)}
                                            onBlur={() => handleEditSubmit(product.id)}
                                            onKeyDown={(e) => handleEditKeyPress(e, product.id)}
                                            className="w-32 text-2xl font-bold text-gray-900 text-center border-2 border-blue-500 rounded px-2 py-1 pr-8 focus:outline-none"
                                            autoFocus
                                            min="0"
                                          />
                                          {Number(product.in_transit_quantity || 0) > 0 && (
                                            <div className="text-xs text-gray-500 font-normal mt-0.5 text-center">
                                              在途数：{product.in_transit_quantity}
                                            </div>
                                          )}
                                        </div>
                                        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex flex-col">
                                          <button
                                            type="button"
                                            onMouseDown={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                            }}
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              const value = parseInt(editingValue) || 0;
                                              setEditingValue((value + 1).toString());
                                            }}
                                            className="w-4 h-3 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                                            title="增加1"
                                          >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                                            </svg>
                                          </button>
                                          <button
                                            type="button"
                                            onMouseDown={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                            }}
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              const value = parseInt(editingValue) || 0;
                                              setEditingValue(Math.max(0, value - 1).toString());
                                            }}
                                            className="w-4 h-3 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                                            title="减少1"
                                          >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                                            </svg>
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <div
                                          className={`text-2xl font-bold text-center border-2 border-transparent rounded px-2 py-1 pr-8 cursor-pointer hover:bg-gray-50 transition-colors ${product.quantity < 0 ? 'bg-red-50' : (isPendingShortage ? 'bg-orange-50' : (product.pending_consumption && product.quantity < product.pending_consumption ? 'bg-yellow-50' : ''))}`}
                                          onDoubleClick={() => handleDoubleClick(product.id, product.quantity)}
                                          title="双击编辑"
                                        >
                                          {product.quantity}
                                        </div>
                                        {Number(product.in_transit_quantity || 0) > 0 && (
                                          <div className="text-xs text-gray-500 font-normal mt-0.5 text-center">
                                            在途数：{product.in_transit_quantity}
                                          </div>
                                        )}
                                        {Number(product.pending_consumption || 0) > 0 && (
                                          <div className={`text-xs mt-0.5 text-center ${product.quantity < 0 ? 'text-red-600' : (isPendingShortage ? 'text-orange-600' : (product.quantity < (product.pending_consumption || 0) ? 'text-yellow-600' : 'text-gray-500'))}`}>
                                            待消耗：{product.pending_consumption}
                                          </div>
                                        )}
                                        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex flex-col">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              updateQuantity(product.id, 1);
                                            }}
                                            className="w-4 h-3 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                                            title="增加1"
                                          >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                                            </svg>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              updateQuantity(product.id, -1);
                                            }}
                                            className="w-4 h-3 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                                            title="减少1"
                                          >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                                            </svg>
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>

                                  <div className="flex flex-col items-center">
                                    <button
                                      onClick={() => updateQuantity(product.id, batchSize)}
                                      className="w-8 h-8 bg-blue-600 hover:bg-blue-700 rounded flex items-center justify-center font-bold text-white"
                                    >
                                      +
                                    </button>
                                    <span className="text-xs text-gray-500 mt-1">{batchSize}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 右侧字母导航：固定定位在视口最右侧，居中显示，支持高亮当前字母 */}
            <div className="hidden md:flex fixed right-4 top-1/2 transform -translate-y-1/2 z-50">
              <div className="flex flex-col space-y-1 bg-white/0 p-1 rounded">
                {letters.map((l) => {
                  const isActive = activeLetter === l;
                  return (
                    <button
                      key={l}
                      onClick={() => {
                        const el = document.getElementById(`letter-${l}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        // 点击时展开该分组并设置为高亮
                        setExpandedLetters((prev) => {
                          const next = new Set(prev);
                          if (!next.has(l)) next.add(l);
                          return next;
                        });
                        setActiveLetter(l);
                      }}
                      className={`w-8 h-8 flex items-center justify-center text-xs rounded transition-all ${isActive ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-blue-600 hover:bg-gray-100'}`}
                      title={`跳转到 ${l}`}
                      aria-label={`跳转到 ${l}`}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {!loading && products.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-500">暂无产品数据</p>
          </div>
        )}
      </div>

      {/* 单价编辑弹窗 */}
      {editingPriceProductId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">修改库存单价</h2>
              <button
                onClick={handlePriceCancel}
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
            <div className="px-6 py-4">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  产品代码
                </label>
                <input
                  type="text"
                  value={products.find(p => p.id === editingPriceProductId)?.code || ''}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  当前库存数量
                </label>
                <input
                  type="text"
                  value={products.find(p => p.id === editingPriceProductId)?.quantity || 0}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  单价（元）
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={editingPriceValue}
                  onChange={(e) => setEditingPriceValue(e.target.value)}
                  onKeyDown={handlePriceKeyPress}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="输入单价"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">
                  提示：修改单价不会影响库存数量，仅用于成本核算
                </p>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end space-x-3">
              <button
                type="button"
                onClick={handlePriceCancel}
                className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handlePriceSubmit}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Inventory;
