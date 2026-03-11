import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Category {
  id: number;
  name: string;
  sort_order: number;
  enabled: number;
  product_count: number;
}

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const [includeZero, setIncludeZero] = useState<boolean>(false);
  const [safetyStock, setSafetyStock] = useState<number>(0);
  const [editingSafetyStock, setEditingSafetyStock] = useState<boolean>(false);
  const [safetyStockValue, setSafetyStockValue] = useState<string>('');
  const [warningThreshold, setWarningThreshold] = useState<number>(300);
  const [editingWarningThreshold, setEditingWarningThreshold] = useState<boolean>(false);
  const [warningThresholdValue, setWarningThresholdValue] = useState<string>('');
  const [unitPricePerMaterial, setUnitPricePerMaterial] = useState<number>(0.01);
  const [editingUnitPrice, setEditingUnitPrice] = useState<boolean>(false);
  const [unitPriceValue, setUnitPriceValue] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // 消耗统计排除物料相关状态
  const [excludedMaterials, setExcludedMaterials] = useState<string>('');
  const [editingExcludedMaterials, setEditingExcludedMaterials] = useState<boolean>(false);
  const [excludedMaterialsValue, setExcludedMaterialsValue] = useState<string>('');

  // 修改密码相关状态
  const [showPasswordForm, setShowPasswordForm] = useState<boolean>(false);
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [changingPassword, setChangingPassword] = useState<boolean>(false);

  const { user } = useAuth();
  const userId = (user as any)?.id;
  const avatarUrl = userId ? `/uploads/avatars/${userId}/avatar.jpg` : null;

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [incRes, safetyRes, statsRes, catsRes, unitPriceRes, excludedRes] = await Promise.all([
        api.get('/inventory/stats/include-zero'),
        api.get('/inventory/settings/safety-stock'),
        api.get('/inventory/stats'),
        api.get('/inventory/categories', { params: { all: true } }),
        api.get('/inventory/settings/unit-price-per-material'),
        api.get('/inventory/settings/consumption-excluded-materials'),
      ]);
      setIncludeZero(incRes.data.includeZero);
      setSafetyStock(safetyRes.data.safetyStock || 0);
      setWarningThreshold(statsRes.data.warningThreshold || 300);
      setCategories(catsRes.data || []);
      setUnitPricePerMaterial(unitPriceRes.data.unitPrice || 0.01);
      setExcludedMaterials(excludedRes.data.excludedMaterials || '');
    } catch (err) {
      console.error('加载设置失败', err);
      alert('加载设置失败');
    } finally {
      setLoading(false);
    }
  };

  const toggleIncludeZero = async (val: boolean) => {
    try {
      setIncludeZero(val);
      await api.put('/inventory/settings/include-zero', { includeZero: val });
      // notify other pages to refresh stats/list
      window.dispatchEvent(new Event('settings_changed'));
    } catch (err) {
      console.error('保存失败', err);
      alert('保存失败');
    }
  };

  const handleSafetyStockDoubleClick = () => {
    setEditingSafetyStock(true);
    setSafetyStockValue(safetyStock.toString());
  };

  const handleWarningThresholdDoubleClick = () => {
    setEditingWarningThreshold(true);
    setWarningThresholdValue(warningThreshold.toString());
  };

  const handleWarningThresholdSubmit = async () => {
    const value = parseInt(warningThresholdValue);
    if (isNaN(value) || value < 0) {
      alert('请输入有效的数值（大于等于0）');
      return;
    }

    try {
      await api.put('/inventory/settings/warning-threshold', { threshold: value });
      setWarningThreshold(value);
      setEditingWarningThreshold(false);
      window.dispatchEvent(new Event('settings_changed'));
    } catch (error: any) {
      alert(error.response?.data?.error || '更新失败');
    }
  };

  const handleWarningThresholdCancel = () => {
    setEditingWarningThreshold(false);
    setWarningThresholdValue('');
  };

  const handleWarningThresholdKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleWarningThresholdSubmit();
    } else if (e.key === 'Escape') {
      handleWarningThresholdCancel();
    }
  };

  const handleSafetyStockSubmit = async () => {
    const value = parseInt(safetyStockValue);
    if (isNaN(value) || value < 0) {
      alert('请输入有效的安全库存数值（大于等于0）');
      return;
    }

    try {
      await api.put('/inventory/settings/safety-stock', { safetyStock: value });
      setSafetyStock(value);
      setEditingSafetyStock(false);
      // notify other pages to refresh stats/list
      window.dispatchEvent(new Event('settings_changed'));
    } catch (error: any) {
      alert(error.response?.data?.error || '更新失败');
    }
  };

  const handleSafetyStockCancel = () => {
    setEditingSafetyStock(false);
    setSafetyStockValue('');
  };

  const handleSafetyStockKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSafetyStockSubmit();
    } else if (e.key === 'Escape') {
      handleSafetyStockCancel();
    }
  };

  const handleUnitPriceDoubleClick = () => {
    setEditingUnitPrice(true);
    setUnitPriceValue(unitPricePerMaterial.toString());
  };

  const handleUnitPriceSubmit = async () => {
    const value = parseFloat(unitPriceValue);
    if (isNaN(value) || value < 0) {
      alert('请输入有效的数值（大于等于0）');
      return;
    }
    try {
      await api.put('/inventory/settings/unit-price-per-material', { unitPrice: value });
      setUnitPricePerMaterial(value);
      setEditingUnitPrice(false);
      window.dispatchEvent(new Event('settings_changed'));
    } catch (error: any) {
      alert(error.response?.data?.error || '更新失败');
    }
  };

  const handleUnitPriceCancel = () => {
    setEditingUnitPrice(false);
    setUnitPriceValue('');
  };

  const handleUnitPriceKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleUnitPriceSubmit();
    else if (e.key === 'Escape') handleUnitPriceCancel();
  };

  // 消耗统计排除物料相关处理函数
  const handleExcludedMaterialsDoubleClick = () => {
    setEditingExcludedMaterials(true);
    setExcludedMaterialsValue(excludedMaterials);
  };

  const handleExcludedMaterialsSubmit = async () => {
    try {
      await api.put('/inventory/settings/consumption-excluded-materials', {
        excludedMaterials: excludedMaterialsValue
      });
      setExcludedMaterials(excludedMaterialsValue);
      setEditingExcludedMaterials(false);
      window.dispatchEvent(new Event('settings_changed'));
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || '更新失败';
      alert(errorMsg);
    }
  };

  const handleExcludedMaterialsCancel = () => {
    setEditingExcludedMaterials(false);
    setExcludedMaterialsValue('');
  };

  const handleExcludedMaterialsKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleExcludedMaterialsSubmit();
    else if (e.key === 'Escape') handleExcludedMaterialsCancel();
  };

  const toggleCategory = async (id: number, enabled: boolean) => {
    try {
      await api.put(`/inventory/categories/${id}/enable`, { enabled });
      setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: enabled ? 1 : 0 } : c)));
      // notify other pages to refresh product/category data
      window.dispatchEvent(new Event('categories_changed'));
    } catch (err) {
      console.error('切换类别失败', err);
      alert('切换类别失败');
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      alert('请填写所有密码字段');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert('新密码与确认密码不一致');
      return;
    }
    if (newPassword.length < 6) {
      alert('新密码长度至少6位');
      return;
    }

    try {
      setChangingPassword(true);
      await api.put('/users/password', {
        currentPassword,
        newPassword,
        confirmPassword
      });
      alert('密码修改成功');
      setShowPasswordForm(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      alert(error.response?.data?.error || '密码修改失败');
    } finally {
      setChangingPassword(false);
    }
  };

  const cancelPasswordChange = () => {
    setShowPasswordForm(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-semibold mb-4">用户设置</h2>
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">缺货筛选：包含0库存</div>
                <div className="text-sm text-gray-500">开启后"缺货"筛选会把库存为 0 的物料也视为缺货</div>
              </div>
              <div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={includeZero} onChange={(e) => toggleIncludeZero(e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 transition-colors" />
                  <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transform peer-checked:translate-x-5 transition-transform" />
                </label>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">预警阈值</div>
                <div className="text-sm text-gray-500">用于判定低库存的阈值（双击编辑）</div>
              </div>
              <div className="flex items-center space-x-2">
                {editingWarningThreshold ? (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={warningThresholdValue}
                      onChange={(e) => setWarningThresholdValue(e.target.value)}
                      onBlur={handleWarningThresholdSubmit}
                      onKeyDown={handleWarningThresholdKeyPress}
                      className="w-20 border-2 border-blue-500 rounded px-2 py-1 text-center focus:outline-none"
                      autoFocus
                      min="0"
                    />
                    <span className="text-sm text-gray-500">颗</span>
                  </div>
                ) : (
                  <div
                    className="text-lg font-bold text-gray-900 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 transition-colors"
                    onDoubleClick={handleWarningThresholdDoubleClick}
                    title="双击编辑"
                  >
                    {warningThreshold}
                    <span className="text-sm text-gray-500 ml-1">颗（双击编辑）</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">安全库存数量</div>
                <div className="text-sm text-gray-500">用于计算待拼不足的库存缓冲量</div>
              </div>
              <div className="flex items-center space-x-2">
                {editingSafetyStock ? (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={safetyStockValue}
                      onChange={(e) => setSafetyStockValue(e.target.value)}
                      onBlur={handleSafetyStockSubmit}
                      onKeyDown={handleSafetyStockKeyPress}
                      className="w-20 border-2 border-blue-500 rounded px-2 py-1 text-center focus:outline-none"
                      autoFocus
                      min="0"
                    />
                    <span className="text-sm text-gray-500">颗</span>
                  </div>
                ) : (
                  <div
                    className="text-lg font-bold text-gray-900 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 transition-colors"
                    onDoubleClick={handleSafetyStockDoubleClick}
                    title="双击编辑"
                  >
                    {safetyStock}
                    <span className="text-sm text-gray-500 ml-1">颗（双击编辑）</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">单个物料售价</div>
                <div className="text-sm text-gray-500">用于计算图纸参考售价（双击编辑）</div>
              </div>
              <div className="flex items-center space-x-2">
                {editingUnitPrice ? (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      step="0.01"
                      value={unitPriceValue}
                      onChange={(e) => setUnitPriceValue(e.target.value)}
                      onBlur={handleUnitPriceSubmit}
                      onKeyDown={handleUnitPriceKeyPress}
                      className="w-24 border-2 border-blue-500 rounded px-2 py-1 text-center focus:outline-none"
                      autoFocus
                      min="0"
                    />
                    <span className="text-sm text-gray-500">元/颗</span>
                  </div>
                ) : (
                  <div
                    className="text-lg font-bold text-gray-900 cursor-pointer hover:bg-gray-50 rounded px-2 py-1"
                    onDoubleClick={handleUnitPriceDoubleClick}
                    title="双击编辑"
                  >
                    ￥{unitPricePerMaterial.toFixed(2)}
                    <span className="text-sm text-gray-500 ml-1">（双击编辑）</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">消耗统计排除物料</div>
                <div className="text-sm text-gray-500">
                  在消耗统计表中排除的通用物料代码（双击编辑，多个代码用逗号分隔）
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {editingExcludedMaterials ? (
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={excludedMaterialsValue}
                      onChange={(e) => setExcludedMaterialsValue(e.target.value)}
                      onBlur={handleExcludedMaterialsSubmit}
                      onKeyDown={handleExcludedMaterialsKeyPress}
                      className="w-64 border-2 border-blue-500 rounded px-2 py-1 text-left focus:outline-none"
                      placeholder="例如: A01,A02,A05"
                      autoFocus
                    />
                  </div>
                ) : (
                  <div
                    className="text-lg font-bold text-gray-900 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 transition-colors"
                    onDoubleClick={handleExcludedMaterialsDoubleClick}
                    title="双击编辑"
                  >
                    {excludedMaterials || '(未设置)'}
                    <span className="text-sm text-gray-500 ml-1">（双击编辑）</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-4">
              <div className="font-medium mb-2">头像</div>
              <div className="flex items-center space-x-4">
                <div className="w-20 h-20 rounded-full border overflow-hidden">
                  {avatarUrl ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" onError={(e:any)=>{e.currentTarget.style.display='none'}} /> : <div className="w-full h-full bg-gray-100" />}
                </div>
                <div>
                  <input type="file" accept="image/*" onChange={async (e) => {
                    const f = e.target.files && e.target.files[0];
                    if (!f) return;
                    if (f.size > 10 * 1024 * 1024) {
                      alert('文件不能超过10MB');
                      return;
                    }
                    // client-side resize to max 1024x1024 and convert to JPEG
                    const img = document.createElement('img');
                    const url = URL.createObjectURL(f);
                    img.src = url;
                    await new Promise((res) => img.onload = res);
                    const canvas = document.createElement('canvas');
                    const max = 1024;
                    let { width, height } = img;
                    if (width > max || height > max) {
                      const ratio = Math.min(max / width, max / height);
                      width = Math.round(width * ratio);
                      height = Math.round(height * ratio);
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx!.drawImage(img, 0, 0, width, height);
                    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
                    if (!blob) {
                      alert('图片处理失败');
                      return;
                    }
                    if (blob.size > 10 * 1024 * 1024) {
                      alert('压缩后文件仍大于10MB，请选择更小的图片');
                      return;
                    }
                    const form = new FormData();
                    form.append('avatar', blob, 'avatar.jpg');
                    try {
                      await api.post('/users/avatar', form, { headers: { 'Content-Type': 'multipart/form-data' }});
                      alert('上传成功');
                      loadData();
                    } catch (err) {
                      console.error('上传失败', err);
                      alert('上传失败');
                    } finally {
                      URL.revokeObjectURL(url);
                    }
                  }} />
                </div>
              </div>
            </div>
          </div>

          {/* 修改密码 */}
          <div className="border-t pt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-medium">修改密码</div>
                <div className="text-sm text-gray-500">定期修改密码可以提高账户安全性</div>
              </div>
              {!showPasswordForm && (
                <button
                  onClick={() => setShowPasswordForm(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                >
                  修改密码
                </button>
              )}
            </div>

            {showPasswordForm && (
              <div className="bg-gray-50 rounded-lg p-4 max-w-md">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">原密码</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="请输入原密码"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="请输入新密码（至少6位）"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="请再次输入新密码"
                    />
                  </div>
                  <div className="flex space-x-3 pt-2">
                    <button
                      onClick={handleChangePassword}
                      disabled={changingPassword}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-300 disabled:cursor-not-allowed"
                    >
                      {changingPassword ? '修改中...' : '确认修改'}
                    </button>
                    <button
                      onClick={cancelPasswordChange}
                      disabled={changingPassword}
                      className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors disabled:bg-gray-100"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="font-medium mb-2">库存大类启用 / 禁用</div>
            <div className="text-sm text-gray-500 mb-3">未启用的大类在库存、图纸 BOM 和下单选择器中不会显示</div>
            {loading ? (
              <div>加载中...</div>
            ) : (
              <div className="space-y-2">
                {categories.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 border rounded">
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-gray-500">包含 {c.product_count} 个物料</div>
                    </div>
                    <div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={!!c.enabled} onChange={(e) => toggleCategory(c.id, e.target.checked)} className="sr-only peer" />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 transition-colors" />
                        <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transform peer-checked:translate-x-5 transition-transform" />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;


