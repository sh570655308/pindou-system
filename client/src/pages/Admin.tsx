import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';

interface Category {
  id: number;
  name: string;
  sort_order?: number;
}

interface Product {
  id: number;
  category_id: number;
  code: string;
  color_code: string;
  color_hex: string;
}

const Admin: React.FC = () => {
  const { isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [warningThreshold, setWarningThreshold] = useState(300);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  // 表单状态
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [productColorHex, setProductColorHex] = useState('#CCCCCC');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [draggedCategory, setDraggedCategory] = useState<number | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvData, setCsvData] = useState('');
  const [importing, setImporting] = useState(false);

  // 缩略图生成状态
  const [thumbnailStatus, setThumbnailStatus] = useState<{ total: number; withThumbnail: number; withoutThumbnail: number } | null>(null);
  const [generatingThumbnails, setGeneratingThumbnails] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
      return;
    }
    loadData();
  }, [isAdmin, navigate]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [categoriesRes, settingsRes, registrationRes] = await Promise.all([
        api.get('/admin/categories'),
        api.get('/inventory/stats'),
        api.get('/admin/settings/registration-enabled'),
      ]);

      setCategories(categoriesRes.data);
      setWarningThreshold(settingsRes.data.warningThreshold);
      setRegistrationEnabled(registrationRes.data.enabled);

      if (categoriesRes.data.length > 0 && !selectedCategory) {
        setSelectedCategory(categoriesRes.data[0].id);
      }

      // 加载缩略图状态
      loadThumbnailStatus();
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadThumbnailStatus = async () => {
    try {
      const res = await api.get('/admin/thumbnails/status');
      setThumbnailStatus(res.data);
    } catch (error) {
      console.error('加载缩略图状态失败:', error);
    }
  };

  const handleGenerateThumbnails = async () => {
    if (!window.confirm('确定要生成缩略图吗？这可能需要一些时间。')) return;

    try {
      setGeneratingThumbnails(true);
      let remaining = thumbnailStatus?.withoutThumbnail || 0;

      while (remaining > 0) {
        const res = await api.post('/admin/thumbnails/generate', { limit: 50 });
        remaining = res.data.remaining;

        if (res.data.processed === 0) break;

        // 刷新状态
        await loadThumbnailStatus();

        if (remaining > 0) {
          // 继续处理下一批
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      alert('缩略图生成完成！');
      await loadThumbnailStatus();
    } catch (error: any) {
      alert(error.response?.data?.error || '生成缩略图失败');
    } finally {
      setGeneratingThumbnails(false);
    }
  };

  useEffect(() => {
    if (selectedCategory) {
      loadProducts(selectedCategory);
    }
  }, [selectedCategory]);

  const loadProducts = async (categoryId: number) => {
    try {
      const response = await api.get(`/admin/categories/${categoryId}/products`);
      setProducts(response.data);
    } catch (error) {
      console.error('加载产品失败:', error);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/admin/categories', { name: categoryName });
      setCategoryName('');
      setShowCategoryForm(false);
      await loadData();
    } catch (error: any) {
      alert(error.response?.data?.error || '创建失败');
    }
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory) return;
    try {
      await api.put(`/admin/categories/${editingCategory.id}`, { name: categoryName });
      setEditingCategory(null);
      setCategoryName('');
      await loadData();
    } catch (error: any) {
      alert(error.response?.data?.error || '更新失败');
    }
  };

  const handleDeleteCategory = async (id: number) => {
    if (!window.confirm('确定要删除这个类别吗？')) return;
    try {
      await api.delete(`/admin/categories/${id}`);
      await loadData();
      if (selectedCategory === id) {
        setSelectedCategory(null);
      }
    } catch (error: any) {
      alert(error.response?.data?.error || '删除失败');
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategory) return;
    try {
      await api.post('/admin/products', {
        categoryId: selectedCategory,
        code: productCode,
        colorCode: productCode,
        colorHex: productColorHex,
      });
      setProductCode('');
      setProductColorHex('#CCCCCC');
      setShowProductForm(false);
      await loadProducts(selectedCategory);
    } catch (error: any) {
      alert(error.response?.data?.error || '创建失败');
    }
  };

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    try {
      await api.put(`/admin/products/${editingProduct.id}`, {
        code: productCode,
        colorCode: productCode,
        colorHex: productColorHex,
      });
      setEditingProduct(null);
      setProductCode('');
      setProductColorHex('#CCCCCC');
      if (selectedCategory) {
        await loadProducts(selectedCategory);
      }
    } catch (error: any) {
      alert(error.response?.data?.error || '更新失败');
    }
  };

  const handleDeleteProduct = async (id: number) => {
    if (!window.confirm('确定要删除这个产品吗？')) return;
    try {
      await api.delete(`/admin/products/${id}`);
      if (selectedCategory) {
        await loadProducts(selectedCategory);
      }
    } catch (error: any) {
      alert(error.response?.data?.error || '删除失败');
    }
  };

  const handleUpdateThreshold = async () => {
    try {
      await api.put('/admin/settings/warning-threshold', { threshold: warningThreshold });
      alert('预警阈值更新成功');
    } catch (error: any) {
      alert(error.response?.data?.error || '更新失败');
    }
  };

  const handleUpdateRegistrationEnabled = async () => {
    try {
      await api.put('/admin/settings/registration-enabled', { enabled: registrationEnabled });
      alert('注册开关更新成功');
    } catch (error: any) {
      alert(error.response?.data?.error || '更新失败');
    }
  };

  const startEditCategory = (category: Category) => {
    setEditingCategory(category);
    setCategoryName(category.name);
    setShowCategoryForm(true);
  };

  const startEditProduct = (product: Product) => {
    setEditingProduct(product);
    setProductCode(product.code);
    setProductColorHex(product.color_hex);
    setShowProductForm(true);
  };

  const cancelEdit = () => {
    setEditingCategory(null);
    setEditingProduct(null);
    setCategoryName('');
    setProductCode('');
    setProductColorHex('#CCCCCC');
    setShowCategoryForm(false);
    setShowProductForm(false);
  };

  // 拖拽排序相关函数
  const handleDragStart = (e: React.DragEvent, categoryId: number) => {
    setDraggedCategory(categoryId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', ''); // 兼容性
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetCategoryId: number) => {
    e.preventDefault();
    
    if (draggedCategory === null || draggedCategory === targetCategoryId) {
      setDraggedCategory(null);
      return;
    }

    const draggedIndex = categories.findIndex(c => c.id === draggedCategory);
    const targetIndex = categories.findIndex(c => c.id === targetCategoryId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedCategory(null);
      return;
    }

    const newCategories = [...categories];
    const [removed] = newCategories.splice(draggedIndex, 1);
    newCategories.splice(targetIndex, 0, removed);

    setCategories(newCategories);
    setDraggedCategory(null);

    // 立即保存排序
    saveCategoryOrder(newCategories);
  };

  const handleDragEnd = () => {
    setDraggedCategory(null);
  };

  const saveCategoryOrder = async (newCategories: Category[]) => {
    try {
      const categoryOrders = newCategories.map((cat, index) => ({
        id: cat.id,
        sort_order: index
      }));

      await api.post('/admin/categories/reorder', { categoryOrders });
    } catch (error: any) {
      console.error('更新排序失败:', error);
      alert(error.response?.data?.error || '更新排序失败');
      // 恢复原数据
      await loadData();
    }
  };

  // CSV导入相关函数
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      alert('请选择CSV文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvData(text);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const parseCSV = (csvText: string) => {
    const lines = csvText.split('\n').filter(line => line.trim());
    const products = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // 简单的CSV解析（处理逗号分隔）
      const parts = line.split(',').map(p => p.trim());
      const code = parts[0];
      const colorHex = parts[1] || ''; // 第二列为十六进制颜色值（如FD7C72）

      if (code) {
        products.push({ code, colorHex });
      }
    }

    return products;
  };

  const handleImport = async () => {
    if (!selectedCategory) {
      alert('请先选择一个类别');
      return;
    }

    if (!csvData.trim()) {
      alert('请先上传或输入CSV数据');
      return;
    }

    try {
      setImporting(true);
      const newProducts = parseCSV(csvData);

      if (newProducts.length === 0) {
        alert('CSV文件中没有有效的产品数据');
        setImporting(false);
        return;
      }

      // 检查是否有重复的产品代码
      const duplicateProducts = newProducts.filter(p =>
        products.some(existing => existing.code === p.code)
      );

      let allowOverwrite = false;
      if (duplicateProducts.length > 0) {
        // 弹出确认对话框
        const duplicateList = duplicateProducts.map(p => p.code).join('、');
        const confirmed = window.confirm(
          `以下产品代码已存在：${duplicateList}\n\n是否覆盖这些产品？\n\n点击"确定"覆盖，点击"取消"跳过已存在的产品。`
        );

        if (!confirmed) {
          // 用户选择不覆盖，过滤掉重复产品
          allowOverwrite = false;
        } else {
          // 用户选择覆盖
          allowOverwrite = true;
        }
      }

      const response = await api.post('/admin/products/batch-import', {
        categoryId: selectedCategory,
        products: newProducts,
        allowOverwrite
      });

      alert(response.data.message);
      setShowImportModal(false);
      setCsvData('');

      // 重新加载产品列表
      if (selectedCategory) {
        await loadProducts(selectedCategory);
      }
    } catch (error: any) {
      alert(error.response?.data?.error || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 预警阈值设置 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">系统设置</h2>
          <div className="space-y-4">
            <div className="flex items-center space-x-4">
              <label className="text-gray-700">预警阈值:</label>
              <input
                type="number"
                value={warningThreshold}
                onChange={(e) => setWarningThreshold(parseInt(e.target.value) || 0)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleUpdateThreshold}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                更新
              </button>
            </div>
            <div className="flex items-center space-x-4">
              <label className="text-gray-700">用户注册:</label>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="registration-toggle"
                  checked={registrationEnabled}
                  onChange={(e) => setRegistrationEnabled(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
                <label htmlFor="registration-toggle" className="text-sm text-gray-700">
                  {registrationEnabled ? '开启注册' : '关闭注册'}
                </label>
              </div>
              <button
                onClick={handleUpdateRegistrationEnabled}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                更新
              </button>
            </div>

            {/* 缩略图管理 */}
            <div className="pt-4 border-t">
              <h3 className="text-lg font-medium text-gray-900 mb-3">图片优化</h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">
                      缩略图状态：
                      {thumbnailStatus ? (
                        <span className="ml-2">
                          <span className="text-green-600">{thumbnailStatus.withThumbnail}</span> 已生成 /
                          <span className="text-gray-600"> {thumbnailStatus.total}</span> 总计
                          {thumbnailStatus.withoutThumbnail > 0 && (
                            <span className="text-orange-600 ml-2">
                              ({thumbnailStatus.withoutThumbnail} 待生成)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="ml-2 text-gray-400">加载中...</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      缩略图可大幅提升列表页加载速度（约150x150像素，~5-10KB）
                    </p>
                  </div>
                  <button
                    onClick={handleGenerateThumbnails}
                    disabled={generatingThumbnails || !thumbnailStatus || thumbnailStatus.withoutThumbnail === 0}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center"
                  >
                    {generatingThumbnails ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        生成中...
                      </>
                    ) : (
                      '生成缩略图'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 库存大类管理 */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">库存大类</h2>
                <button
                  onClick={() => {
                    cancelEdit();
                    setShowCategoryForm(!showCategoryForm);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {showCategoryForm ? '取消' : '+ 添加类别'}
                </button>
              </div>
            </div>

            {showCategoryForm && (
              <div className="p-6 border-b bg-gray-50">
                <form onSubmit={editingCategory ? handleUpdateCategory : handleCreateCategory}>
                  <div className="space-y-4">
                    <input
                      type="text"
                      placeholder="类别名称"
                      value={categoryName}
                      onChange={(e) => setCategoryName(e.target.value)}
                      required
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <div className="flex space-x-2">
                      <button
                        type="submit"
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        {editingCategory ? '更新' : '创建'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            <div className="p-6">
              <p className="text-sm text-gray-500 mb-3">拖拽项目可调整排序</p>
              <div className="space-y-2">
                {categories.map((category) => (
                  <div
                    key={category.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, category.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, category.id)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-move transition-colors ${
                      selectedCategory === category.id
                        ? 'bg-blue-50 border-2 border-blue-500'
                        : 'bg-gray-50 hover:bg-gray-100'
                    } ${draggedCategory === category.id ? 'opacity-50' : ''}`}
                    onClick={() => setSelectedCategory(category.id)}
                  >
                    <div className="flex items-center space-x-2">
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                      </svg>
                      <span className="font-medium text-gray-900">{category.name}</span>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditCategory(category);
                        }}
                        className="px-3 py-1 text-sm bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                      >
                        编辑
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCategory(category.id);
                        }}
                        className="px-3 py-1 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 产品细类管理 */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">产品细类</h2>
                {selectedCategory && (
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setShowImportModal(true)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      批量导入
                    </button>
                    <button
                      onClick={() => {
                        cancelEdit();
                        setShowProductForm(!showProductForm);
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      {showProductForm ? '取消' : '+ 添加产品'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {!selectedCategory ? (
              <div className="p-6 text-center text-gray-500">
                请先选择一个库存大类
              </div>
            ) : (
              <>
                {showProductForm && (
                  <div className="p-6 border-b bg-gray-50">
                    <form onSubmit={editingProduct ? handleUpdateProduct : handleCreateProduct}>
                      <div className="space-y-4">
                        <input
                          type="text"
                          placeholder="产品代码"
                          value={productCode}
                          onChange={(e) => setProductCode(e.target.value)}
                          required
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <div className="flex items-center space-x-4">
                          <label className="text-gray-700">颜色:</label>
                          <input
                            type="color"
                            value={productColorHex}
                            onChange={(e) => setProductColorHex(e.target.value)}
                            className="w-20 h-10 border border-gray-300 rounded cursor-pointer"
                          />
                          <input
                            type="text"
                            value={productColorHex}
                            onChange={(e) => setProductColorHex(e.target.value)}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="#CCCCCC"
                          />
                        </div>
                        <div className="flex space-x-2">
                          <button
                            type="submit"
                            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            {editingProduct ? '更新' : '创建'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                )}

                <div className="p-6">
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {products.map((product) => (
                      <div
                        key={product.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100"
                      >
                        <div className="flex items-center space-x-3">
                          <div
                            className="w-10 h-10 rounded-full border-2 border-gray-200"
                            style={{ backgroundColor: product.color_hex }}
                          />
                          <span className="font-medium text-gray-900">{product.code}</span>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => startEditProduct(product)}
                            className="px-3 py-1 text-sm bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDeleteProduct(product.id)}
                            className="px-3 py-1 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                    {products.length === 0 && (
                      <div className="text-center text-gray-500 py-8">暂无产品</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* CSV导入模态框 */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-900 mb-4">批量导入产品</h3>
            <p className="text-sm text-gray-600 mb-4">
              CSV格式：第一列为产品代码，第二列为十六进制颜色值（可选，6位）。示例：
              <br />
              <code className="text-xs bg-gray-100 px-2 py-1 rounded">A20,FD7C72</code>
              <br />
              <code className="text-xs bg-gray-100 px-2 py-1 rounded">A21,FF5733</code>
              <br />
              <span className="text-xs text-gray-500">注：颜色值为6位十六进制数，不需要#号</span>
            </p>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                上传CSV文件
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                或直接粘贴CSV内容
              </label>
              <textarea
                value={csvData}
                onChange={(e) => setCsvData(e.target.value)}
                placeholder="产品代码,十六进制颜色值&#10;A20,FD7C72&#10;A21,FF5733"
                className="w-full h-48 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              />
            </div>

            <div className="flex space-x-2">
              <button
                onClick={handleImport}
                disabled={importing || !csvData.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {importing ? '导入中...' : '导入'}
              </button>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setCsvData('');
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin;
