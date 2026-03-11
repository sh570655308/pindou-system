import React, { useState, useRef, useEffect } from 'react';
import api from '../utils/api';

interface MaterialRecognitionProps {
  drawingId: number | null;
  products: Array<{ code: string }>;
  onMaterialDetected: (materials: Array<{ code?: string; quantity: number; name?: string }>) => void;
  onClose: () => void;
}

interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RecognizedMaterial {
  code: string;
  quantity: number;
  id: string;
}

const MaterialRecognition: React.FC<MaterialRecognitionProps> = ({
  drawingId,
  products,
  onMaterialDetected,
  onClose
}) => {
  const [images, setImages] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [recognizing, setRecognizing] = useState<boolean>(false);
  const [selection, setSelection] = useState<SelectionBox | null>(null);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // 新增：确认步骤相关状态
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [recognizedMaterials, setRecognizedMaterials] = useState<RecognizedMaterial[]>([]);
  const [cropImagePath, setCropImagePath] = useState<string>('');
  const [hoverInsertIndex, setHoverInsertIndex] = useState<number | null>(null);

  // 图片查看器状态
  const [showImageViewer, setShowImageViewer] = useState<boolean>(false);
  const [imageScale, setImageScale] = useState<number>(1);
  const [imagePosition, setImagePosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // 物料代码搜索和选择相关状态
  const [productSearch, setProductSearch] = useState<Record<string, string>>({});
  const [openPickerRow, setOpenPickerRow] = useState<string | null>(null);

  // 点击外部关闭下拉列表
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openPickerRow) {
        const target = event.target as HTMLElement;
        // 检查点击是否在下拉列表或输入框内
        if (!target.closest('.picker-dropdown') && !target.closest('input')) {
          setOpenPickerRow(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openPickerRow]);

  // ESC键关闭图片查看器
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showImageViewer) {
        handleCloseImageViewer();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showImageViewer]);

  // 在document级别监听鼠标移动和抬起事件，防止鼠标移出canvas时框选中断
  useEffect(() => {
    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isDrawing || !startPoint || !canvasRef.current || !imageRef.current) return;

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = imageRef.current.naturalWidth / rect.width;
      const scaleY = imageRef.current.naturalHeight / rect.height;

      // 图片实际尺寸
      const imgWidth = imageRef.current.naturalWidth;
      const imgHeight = imageRef.current.naturalHeight;

      // 计算鼠标在图像坐标系中的位置，并限制在图片边界内
      let x = (e.clientX - rect.left) * scaleX;
      let y = (e.clientY - rect.top) * scaleY;

      // 边界自动纠错：确保坐标在图片范围内
      x = Math.max(0, Math.min(x, imgWidth));
      y = Math.max(0, Math.min(y, imgHeight));

      const width = x - startPoint.x;
      const height = y - startPoint.y;

      // 计算选择框位置和尺寸，并确保不超出边界
      let selX = width > 0 ? startPoint.x : x;
      let selY = height > 0 ? startPoint.y : y;
      let selWidth = Math.abs(width);
      let selHeight = Math.abs(height);

      // 最终边界校正：确保选择框完全在图片范围内
      selX = Math.max(0, selX);
      selY = Math.max(0, selY);
      selWidth = Math.min(selWidth, imgWidth - selX);
      selHeight = Math.min(selHeight, imgHeight - selY);

      setSelection({
        x: selX,
        y: selY,
        width: selWidth,
        height: selHeight
      });
    };

    const handleDocumentMouseUp = () => {
      if (isDrawing) {
        setIsDrawing(false);
        setStartPoint(null);
      }
    };

    if (isDrawing) {
      document.addEventListener('mousemove', handleDocumentMouseMove);
      document.addEventListener('mouseup', handleDocumentMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleDocumentMouseMove);
        document.removeEventListener('mouseup', handleDocumentMouseUp);
      };
    }
  }, [isDrawing, startPoint]);

  // 加载图纸图片
  useEffect(() => {
    const loadImages = async () => {
      if (!drawingId) return;

      try {
        setLoading(true);
        const res = await api.get(`/drawings/${drawingId}`);
        if (res.data && res.data.images && res.data.images.length > 0) {
          // 使用 images 数组中的图片
          const imageList = res.data.images.map((img: any) => ({
            path: img.file_path,
            file_name: img.file_name || '图纸',
            id: img.id
          }));
          setImages(imageList);
          if (imageList.length > 0) {
            setSelectedImage(imageList[0]);
          }
        }
      } catch (err) {
        console.error('加载图纸图片失败', err);
      } finally {
        setLoading(false);
      }
    };

    loadImages();
  }, [drawingId]);

  // 初始化canvas尺寸（当图片加载完成后）
  useEffect(() => {
    if (!canvasRef.current || !imageRef.current) return;

    const img = imageRef.current;
    const canvas = canvasRef.current;

    // 等待图片加载完成
    if (img.complete) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    } else {
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      };
    }
  }, [selectedImage]);

  // 绘制选择框
  useEffect(() => {
    if (!canvasRef.current || !imageRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = imageRef.current;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // 清除画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 如果有选择框，绘制
    if (selection) {
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 3;
      ctx.strokeRect(selection.x, selection.y, selection.width, selection.height);

      // 绘制半透明填充
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.fillRect(selection.x, selection.y, selection.width, selection.height);
    }
  }, [selection]);

  // 获取鼠标在图片上的相对坐标
  const getImageCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = imageRef.current.naturalWidth / rect.width;
    const scaleY = imageRef.current.naturalHeight / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  // 鼠标按下
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getImageCoordinates(e);
    if (!coords) return;

    setIsDrawing(true);
    setStartPoint(coords);
    setSelection({ x: coords.x, y: coords.y, width: 0, height: 0 });
  };

  // 规范化物料代码：将字母+1位数字补齐为字母+2位数字
  const normalizeMaterialCode = (code: string): string => {
    // 匹配模式：字母开头 + 1位数字（末尾）
    // 例如：C1 -> C01, A8 -> A08
    const pattern = /^([A-Z]+)(\d)$/;
    const match = code.match(pattern);
    if (match) {
      const prefix = match[1]; // 字母部分，如 C
      const number = match[2]; // 数字部分，如 1
      return `${prefix}0${number}`; // 补零，如 C01
    }
    return code; // 不匹配则返回原值
  };

  // 执行OCR识别
  const handleRecognize = async () => {
    if (!selection || !selectedImage || !drawingId) {
      alert('请先框选一个区域');
      return;
    }

    try {
      setRecognizing(true);

      const formData = new FormData();
      formData.append('image_path', selectedImage.path);
      formData.append('x', Math.round(selection.x).toString());
      formData.append('y', Math.round(selection.y).toString());
      formData.append('width', Math.round(selection.width).toString());
      formData.append('height', Math.round(selection.height).toString());

      const res = await api.post(`/drawings/${drawingId}/recognize-materials`, formData);

      if (res.data && res.data.materials) {
        // 保存裁剪图片路径
        if (res.data.crop_image_path) {
          setCropImagePath(res.data.crop_image_path);
        }

        // 转换为确认界面格式，并对物料代码进行规范化
        const materials: RecognizedMaterial[] = res.data.materials.map((m: any, idx: number) => {
          const originalCode = m.code || m.name || '';
          return {
            id: `mat-${Date.now()}-${idx}`,
            code: normalizeMaterialCode(originalCode),
            quantity: m.quantity || 1
          };
        });
        setRecognizedMaterials(materials);
        setShowConfirm(true);
      } else {
        alert('OCR识别失败，请重试');
      }
    } catch (err: any) {
      console.error('OCR识别失败', err);
      alert(err?.response?.data?.error || 'OCR识别失败，请重试');
    } finally {
      setRecognizing(false);
    }
  };

  // 清除选择框
  const handleClearSelection = () => {
    setSelection(null);
  };

  // 处理物料代码搜索变化
  const handleProductSearchChange = (materialId: string, value: string) => {
    setProductSearch(prev => ({ ...prev, [materialId]: value }));
    setOpenPickerRow(materialId);
  };

  // 选择产品
  const handleSelectProduct = (materialId: string, product: { code: string }) => {
    setRecognizedMaterials(materials =>
      materials.map(m => m.id === materialId ? { ...m, code: product.code } : m)
    );
    setProductSearch(prev => ({ ...prev, [materialId]: product.code }));
    setOpenPickerRow(null);
  };

  // 确认界面：更新数量
  const handleQuantityChange = (id: string, newQuantity: number) => {
    setRecognizedMaterials(materials =>
      materials.map(m => m.id === id ? { ...m, quantity: newQuantity } : m)
    );
  };

  // 确认界面：删除物料
  const handleDeleteMaterial = (id: string) => {
    setRecognizedMaterials(materials => materials.filter(m => m.id !== id));
  };

  // 确认界面：代码下移 - 将当前行及以下所有行下移，当前行代码变空
  const handleShiftDownCode = (currentIndex: number) => {
    setRecognizedMaterials(materials => {
      const newMaterials = [...materials];

      // 从当前行开始，将所有行的代码向下移动
      for (let i = newMaterials.length - 1; i > currentIndex; i--) {
        newMaterials[i] = {
          ...newMaterials[i],
          code: newMaterials[i - 1].code
        };
      }

      // 当前行代码变成空白，数量保持不变
      newMaterials[currentIndex] = {
        ...newMaterials[currentIndex],
        code: '',
        id: `shifted-code-${Date.now()}`
      };

      return newMaterials;
    });
  };

  // 确认界面：数量下移 - 将当前行及以下所有行下移，当前行数量变空
  const handleShiftDownQuantity = (currentIndex: number) => {
    setRecognizedMaterials(materials => {
      const newMaterials = [...materials];

      // 从当前行开始，将所有行的数量向下移动
      for (let i = newMaterials.length - 1; i > currentIndex; i--) {
        newMaterials[i] = {
          ...newMaterials[i],
          quantity: newMaterials[i - 1].quantity
        };
      }

      // 当前行数量变成1（默认值），代码保持不变
      newMaterials[currentIndex] = {
        ...newMaterials[currentIndex],
        quantity: 1,
        id: `shifted-qty-${Date.now()}`
      };

      return newMaterials;
    });
  };

  // 确认界面：在指定位置插入新物料
  const handleInsertMaterial = (index: number) => {
    const newMaterial: RecognizedMaterial = {
      id: `new-${Date.now()}`,
      code: '',
      quantity: 1
    };
    setRecognizedMaterials(materials => {
      const newMaterials = [...materials];
      // index === -1 表示在第一行之前插入，否则在 index 行之后插入
      const insertPosition = index === -1 ? 0 : index + 1;
      newMaterials.splice(insertPosition, 0, newMaterial);
      return newMaterials;
    });
    // 插入后清空悬停状态
    setHoverInsertIndex(null);
  };

  // 确认界面：确认添加
  const handleConfirmAdd = () => {
    const validMaterials = recognizedMaterials
      .filter(m => m.code.trim() !== '' && m.quantity > 0)
      .map(m => ({
        code: m.code.trim(),
        quantity: m.quantity
      }));

    if (validMaterials.length === 0) {
      alert('请至少添加一个有效物料');
      return;
    }

    // 检查是否有空代码
    const emptyCodeMaterials = recognizedMaterials.filter(m => m.code.trim() === '');
    if (emptyCodeMaterials.length > 0) {
      alert('存在未填写物料代码的行，请填写完整后再确认');
      return;
    }

    // 检查代码是否重复
    const codeCount = new Map<string, number>();
    validMaterials.forEach(m => {
      codeCount.set(m.code, (codeCount.get(m.code) || 0) + 1);
    });

    const duplicateCodes = Array.from(codeCount.entries())
      .filter(([_, count]) => count > 1)
      .map(([code, _]) => code);

    if (duplicateCodes.length > 0) {
      alert(`以下物料代码重复：${duplicateCodes.join(', ')}，请检查后再确认`);
      return;
    }

    // 检查代码是否存在于产品列表中
    const productCodeSet = new Set(products.map(p => p.code));
    const invalidCodes = validMaterials
      .map(m => m.code)
      .filter(code => !productCodeSet.has(code));

    if (invalidCodes.length > 0) {
      const confirmMessage = `以下物料代码在产品列表中不存在：\n${invalidCodes.join('\n')}\n\n是否继续添加？`;
      if (window.confirm(confirmMessage)) {
        onMaterialDetected(validMaterials);
        onClose();
      }
      return;
    }

    onMaterialDetected(validMaterials);
    onClose();
  };

  // 确认界面：返回重新识别
  const handleBackToRecognize = () => {
    setShowConfirm(false);
    setRecognizedMaterials([]);
    setCropImagePath('');
    setProductSearch({});
    setOpenPickerRow(null);
    setShowImageViewer(false);
    setImageScale(1);
    setImagePosition({ x: 0, y: 0 });
  };

  // 图片查看器：打开
  const handleOpenImageViewer = () => {
    setShowImageViewer(true);
    setImageScale(1);
    setImagePosition({ x: 0, y: 0 });
  };

  // 图片查看器：关闭
  const handleCloseImageViewer = () => {
    setShowImageViewer(false);
    setImageScale(1);
    setImagePosition({ x: 0, y: 0 });
  };

  // 图片查看器：缩放
  const handleImageWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const scaleDelta = e.deltaY > 0 ? -0.1 : 0.1;
    setImageScale(prev => Math.max(0.5, Math.min(5, prev + scaleDelta)));
  };

  // 图片查看器：开始拖拽
  const handleImageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - imagePosition.x, y: e.clientY - imagePosition.y });
  };

  // 图片查看器：拖拽中
  const handleImageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setImagePosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  // 图片查看器：结束拖拽
  const handleImageMouseUp = () => {
    setIsDragging(false);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl p-6">
          <div className="text-center py-8">
            <div className="text-gray-500">加载中...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 主界面 */}
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* 头部 */}
        <div className="sticky top-0 bg-white border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">
              {showConfirm ? '确认识别结果' : '物料识别'}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700"
            >
              关闭
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="p-6">
          {showConfirm ? (
            // ===== 确认界面 =====
            <div>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-gray-600">
                    识别到 {recognizedMaterials.length} 个物料，请核对并修改后确认添加
                  </p>
                  <button
                    onClick={handleOpenImageViewer}
                    className="px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
                  >
                    查看原图
                  </button>
                </div>

                {/* 显示裁剪图片 */}
                {cropImagePath && (
                  <div className="mb-4 p-3 bg-gray-50 rounded">
                    <p className="text-sm font-medium text-gray-700 mb-2">识别区域图片：</p>
                    <img
                      src={`/uploads/drawings/${cropImagePath}`}
                      alt="裁剪区域"
                      className="max-w-full h-auto border rounded"
                      style={{ maxHeight: '300px' }}
                    />
                  </div>
                )}

                {/* 物料列表 */}
                <div className="border rounded max-h-96 overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 border-b">物料代码</th>
                        <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 border-b">数量</th>
                        <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 border-b" style={{ width: '80px' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* 第一行之前的插入区域 */}
                      <tr
                        onMouseEnter={() => setHoverInsertIndex(-1)}
                        onMouseLeave={() => setHoverInsertIndex(null)}
                        className="cursor-pointer"
                        style={{
                          backgroundColor: hoverInsertIndex === -1 ? '#e0f2fe' : 'transparent',
                          cursor: hoverInsertIndex === -1 ? 'pointer' : 'default'
                        }}
                        onClick={() => handleInsertMaterial(-1)}
                      >
                        <td
                          colSpan={3}
                          className="text-center"
                          style={{
                            padding: hoverInsertIndex === -1 ? '10px' : '8px 0',
                            opacity: hoverInsertIndex === -1 ? '1' : '1',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          {hoverInsertIndex === -1 ? (
                            <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-500 text-white rounded-full text-lg font-bold hover:bg-blue-600">
                              +
                            </span>
                          ) : (
                            <div className="w-full h-px bg-gray-300"></div>
                          )}
                        </td>
                      </tr>
                      {recognizedMaterials.map((material, idx) => {
                        const hasCustom = Object.prototype.hasOwnProperty.call(productSearch, material.id);
                        const displayText = hasCustom ? productSearch[material.id] : material.code;
                        const term = (productSearch[material.id] || material.code || '').toLowerCase();
                        const filtered = (term ? products.filter((p) => {
                          const display = p.code.toLowerCase();
                          return display.includes(term);
                        }) : products);

                        return (
                          <React.Fragment key={material.id}>
                            {/* 当前行 */}
                            <tr className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="px-4 py-2 border-b relative">
                                <input
                                  type="text"
                                  value={displayText}
                                  onChange={(e) => handleProductSearchChange(material.id, e.target.value)}
                                  onFocus={() => setOpenPickerRow(material.id)}
                                  className="w-full border rounded px-2 py-1"
                                  placeholder="输入物料代码"
                                />
                                {openPickerRow === material.id && (
                                  <div className="picker-dropdown absolute z-10 bg-white border rounded mt-1 w-full max-h-44 overflow-auto shadow">
                                    {filtered.length === 0 ? (
                                      <div className="p-2 text-sm text-gray-500">无匹配项</div>
                                    ) : (
                                      filtered.map((p) => (
                                        <div
                                          key={p.code}
                                          className="p-2 hover:bg-gray-50 cursor-pointer text-sm"
                                          onMouseDown={() => handleSelectProduct(material.id, p)}
                                        >
                                          {p.code}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2 border-b">
                                <input
                                  type="number"
                                  min="1"
                                  value={material.quantity}
                                  onChange={(e) => handleQuantityChange(material.id, parseInt(e.target.value) || 1)}
                                  className="w-24 border rounded px-2 py-1"
                                />
                              </td>
                              <td className="px-4 py-2 border-b" style={{ width: '120px' }}>
                                <button
                                  onClick={() => handleShiftDownCode(idx)}
                                  className="text-blue-600 hover:text-blue-800 text-sm mr-2"
                                  title="将当前行及以下所有代码下移，当前行代码变空"
                                >
                                  下移代码
                                </button>
                                <button
                                  onClick={() => handleShiftDownQuantity(idx)}
                                  className="text-green-600 hover:text-green-800 text-sm mr-2"
                                  title="将当前行及以下所有数量下移，当前行数量变1"
                                >
                                  下移数量
                                </button>
                                <button
                                  onClick={() => handleDeleteMaterial(material.id)}
                                  className="text-red-600 hover:text-red-800 text-sm"
                                >
                                  删除
                                </button>
                              </td>
                            </tr>

                          {/* 行间插入区域 - 默认padding 8px，悬停时展开 */}
                          <tr
                            onMouseEnter={() => setHoverInsertIndex(idx)}
                            onMouseLeave={() => setHoverInsertIndex(null)}
                            className="cursor-pointer"
                            style={{
                              backgroundColor: hoverInsertIndex === idx ? '#e0f2fe' : 'transparent',
                              cursor: hoverInsertIndex === idx ? 'pointer' : 'default'
                            }}
                            onClick={() => handleInsertMaterial(idx)}
                          >
                            <td
                              colSpan={3}
                              className="text-center"
                              style={{
                                padding: hoverInsertIndex === idx ? '10px' : '8px 0',
                                opacity: hoverInsertIndex === idx ? '1' : '1',
                                transition: 'all 0.2s ease'
                              }}
                            >
                              {hoverInsertIndex === idx ? (
                                <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-500 text-white rounded-full text-lg font-bold hover:bg-blue-600">
                                  +
                                </span>
                              ) : (
                                <div className="w-full h-px bg-gray-300"></div>
                              )}
                            </td>
                          </tr>
                        </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center justify-between mt-6">
                <div className="text-sm text-gray-500">
                  共 {recognizedMaterials.length} 个物料
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={handleBackToRecognize}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    返回重新识别
                  </button>
                  <button
                    onClick={handleConfirmAdd}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    确认添加
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // ===== 框选界面 =====
            <>
              {/* 图片选择 */}
              {images.length > 1 && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">选择图纸</label>
                  <select
                    value={selectedImage?.path || ''}
                    onChange={(e) => {
                      const img = images.find((i) => i.path === e.target.value);
                      if (img) setSelectedImage(img);
                      setSelection(null);
                    }}
                    className="w-full border rounded p-2"
                  >
                    {images.map((img) => (
                      <option key={img.path} value={img.path}>
                        {img.file_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 图片显示区域 */}
              {selectedImage ? (
                <div className="mb-4">
                  <div className="relative inline-block w-full">
                    <img
                      ref={imageRef}
                      src={`/uploads/drawings/${selectedImage.path}`}
                      alt="图纸"
                      className="w-full h-auto block"
                    />
                    <canvas
                      ref={canvasRef}
                      onMouseDown={handleMouseDown}
                      className="absolute top-0 left-0 w-full h-full cursor-crosshair"
                      style={{ pointerEvents: 'auto' }}
                    />
                  </div>
                  <p className="text-sm text-gray-500 mt-2">在图纸上拖拽鼠标框选需要识别的区域</p>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  该图纸暂无图片
                </div>
              )}

              {/* 选择信息 */}
              {selection && (
                <div className="mb-4 p-3 bg-blue-50 rounded">
                  <div className="text-sm">
                    <div><strong>选择区域:</strong></div>
                    <div>位置: X={Math.round(selection.x)}, Y={Math.round(selection.y)}</div>
                    <div>大小: {Math.round(selection.width)} x {Math.round(selection.height)} 像素</div>
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex items-center justify-between">
                <div className="flex space-x-2">
                  {selection && (
                    <button
                      onClick={handleClearSelection}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                      清除选择
                    </button>
                  )}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleRecognize}
                    disabled={!selection || recognizing}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {recognizing ? '识别中...' : '开始识别'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>

    {/* 图片查看器弹窗 */}
    {showImageViewer && selectedImage && (
      <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[100]">
        <div className="relative w-full h-full flex items-center justify-center">
          {/* 关闭按钮 */}
          <button
            onClick={handleCloseImageViewer}
            className="absolute top-4 right-4 z-10 px-4 py-2 bg-white text-gray-800 rounded hover:bg-gray-100 text-sm font-medium"
          >
            关闭 (ESC)
          </button>

          {/* 提示信息 */}
          <div className="absolute top-4 left-4 z-10 text-white text-sm bg-black bg-opacity-50 px-3 py-1 rounded">
            鼠标滚轮缩放 • 拖拽移动
          </div>

          {/* 缩放比例显示 */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 text-white text-sm bg-black bg-opacity-50 px-3 py-1 rounded">
            {Math.round(imageScale * 100)}%
          </div>

          {/* 图片容器 */}
          <div
            className="overflow-hidden cursor-move"
            style={{ width: '90vw', height: '90vh' }}
            onWheel={handleImageWheel}
            onMouseDown={handleImageMouseDown}
            onMouseMove={handleImageMouseMove}
            onMouseUp={handleImageMouseUp}
            onMouseLeave={handleImageMouseUp}
          >
            <img
              src={`/uploads/drawings/${selectedImage.path}`}
              alt="原图"
              className="max-w-none"
              style={{
                transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) scale(${imageScale})`,
                transformOrigin: 'center center',
                cursor: isDragging ? 'grabbing' : 'grab'
              }}
              draggable={false}
            />
          </div>
        </div>
      </div>
    )}
  </>
  );
};

export default MaterialRecognition;
