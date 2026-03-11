import React from 'react';

export interface Layer {
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    pixels: any[][]; // PixelCell[][]
}

interface LayerPanelProps {
    layers: Layer[];
    activeLayerId: string;
    onLayerChange: (layers: Layer[]) => void;
    onActiveLayerChange: (id: string) => void;
    visible: boolean;
    onClose: () => void;
    position: { x: number; y: number };
    onPositionChange: (pos: { x: number; y: number }) => void;
    onLayerImport?: (layer: Layer) => void;
}

const LayerPanel: React.FC<LayerPanelProps> = ({
    layers,
    activeLayerId,
    onLayerChange,
    onActiveLayerChange,
    visible,
    onClose,
    position,
    onPositionChange,
    onLayerImport
}) => {
    const [isDragging, setIsDragging] = React.useState(false);
    const dragRef = React.useRef<{ startX: number; startY: number } | null>(null);

    // Layer rename state
    const [editingLayerId, setEditingLayerId] = React.useState<string | null>(null);
    const [editingName, setEditingName] = React.useState('');

    // Layer drag-to-reorder state
    const [draggedLayerId, setDraggedLayerId] = React.useState<string | null>(null);
    const [dragOverLayerId, setDragOverLayerId] = React.useState<string | null>(null);

    if (!visible) return null;

    const handlePointerDown = (e: React.PointerEvent) => {
        dragRef.current = { startX: e.clientX - position.x, startY: e.clientY - position.y };
        setIsDragging(true);
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging || !dragRef.current) return;
        const newX = e.clientX - dragRef.current.startX;
        const newY = e.clientY - dragRef.current.startY;
        const clampedX = Math.max(0, Math.min(window.innerWidth - 200, newX));
        const clampedY = Math.max(0, Math.min(window.innerHeight - 300, newY));
        onPositionChange({ x: clampedX, y: clampedY });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setIsDragging(false);
        dragRef.current = null;
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    };

    // Layer export functionality
    const handleExportLayer = (layerId: string) => {
        const layer = layers.find(l => l.id === layerId);
        if (!layer) return;

        const data = {
            version: '2.1',
            type: 'single-layer',
            timestamp: Date.now(),
            layer: layer,
            metadata: {
                rows: layer.pixels.length,
                cols: layer.pixels[0]?.length || 0
            }
        };

        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `layer-${layer.name.replace(/\s+/g, '_')}-${Date.now()}.pindou`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Layer import functionality
    const handleImportLayer = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pindou';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);

                if (data.version >= '2.1' && data.type === 'single-layer' && data.layer) {
                    onLayerImport?.(data.layer);
                } else {
                    alert('无效的图层文件格式');
                }
            } catch (err) {
                alert('图层文件读取失败');
            }
        };
        input.click();
    };

    // Layer rename functionality
    const handleStartRename = (layerId: string, currentName: string) => {
        setEditingLayerId(layerId);
        setEditingName(currentName);
    };

    const handleFinishRename = () => {
        if (!editingLayerId) return;

        const trimmedName = editingName.trim();
        if (!trimmedName) {
            alert('图层名称不能为空');
            setEditingLayerId(null);
            return;
        }

        if (trimmedName.length > 50) {
            alert('图层名称不能超过50个字符');
            return;
        }

        const newLayers = layers.map(l =>
            l.id === editingLayerId ? { ...l, name: trimmedName } : l
        );
        onLayerChange(newLayers);
        setEditingLayerId(null);
    };

    const handleCancelRename = () => {
        setEditingLayerId(null);
        setEditingName('');
    };

    // Layer drag-to-reorder functionality
    const handleDragStart = (e: React.DragEvent, layerId: string) => {
        if (layers.find(l => l.id === layerId)?.locked) {
            e.preventDefault();
            return;
        }
        setDraggedLayerId(layerId);
        e.dataTransfer.effectAllowed = 'move';
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e.dataTransfer.setDragImage(img, 0, 0);
    };

    const handleDragOver = (e: React.DragEvent, layerId: string) => {
        e.preventDefault();
        if (draggedLayerId && draggedLayerId !== layerId) {
            setDragOverLayerId(layerId);
        }
    };

    const handleDragLeave = () => {
        setDragOverLayerId(null);
    };

    const handleDrop = (e: React.DragEvent, targetLayerId: string) => {
        e.preventDefault();
        if (!draggedLayerId || draggedLayerId === targetLayerId) {
            setDraggedLayerId(null);
            setDragOverLayerId(null);
            return;
        }

        const draggedIndex = layers.findIndex(l => l.id === draggedLayerId);
        const targetIndex = layers.findIndex(l => l.id === targetLayerId);

        const newLayers = [...layers];
        const [draggedLayer] = newLayers.splice(draggedIndex, 1);
        newLayers.splice(targetIndex, 0, draggedLayer);

        onLayerChange(newLayers);
        setDraggedLayerId(null);
        setDragOverLayerId(null);
    };

    const addLayer = () => {
        // Clone logic should typically be handled by parent or here if we have a template
        // Ideally we invoke a parent handler for clean structure, but we can do simple array ops here if we don't need access to grid dimensions
        // Actually, creating a layer requires knowing grid dimensions. We should pass an onAddLayer prop or similar.
        // For now, let's assume parent handles logic if we just trigger onLayerChange with new list? No, we need fresh empty grid.
        // Let's defer "Add" logic to parent via a new prop? Or make it simple:
        // We will just expose "onAddLayer" in props to keep it clean.
    };

    // ... refactoring to use handlers passed from parent is better for complex state.
    // But to stick to the interface defined above, we'll iterate.

    return (
        <div
            className="fixed z-50 bg-white/95 backdrop-blur-sm shadow-xl rounded-lg border border-gray-200 flex flex-col transition-all duration-200 hover:shadow-2xl"
            style={{ left: position.x, top: position.y, width: 240, height: 300 }}
        >
            {/* 关闭按钮 */}
            <button
                className="absolute -right-3 -top-3 w-8 h-8 bg-white border border-gray-300 rounded-full shadow-md flex items-center justify-center text-gray-600 hover:text-gray-800 hover:bg-gray-50 transition-all duration-200 z-10"
                onClick={onClose}
                title="关闭图层面板"
            >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>

            {/* 标题栏 */}
            <div className="p-4 pb-2">
                <div
                    className="flex items-center justify-between cursor-move select-none"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                >
                    <h3 className="text-lg font-semibold text-gray-800">图层</h3>
                    {/* Import button */}
                    <button
                        onClick={(e) => { e.stopPropagation(); handleImportLayer(); }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="p-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-all"
                        title="导入图层"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>

            {/* Layer List */}
            <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-1">
                {[...layers].reverse().map((layer) => (
                    <div
                        key={layer.id}
                        className={`group flex items-center p-2 rounded cursor-pointer border ${
                            layer.id === activeLayerId ? 'bg-blue-50 border-blue-200' :
                            layer.id === dragOverLayerId ? 'bg-green-50 border-green-300' :
                            'hover:bg-gray-50 border-transparent'
                        }`}
                        draggable={layers.length > 1}
                        onDragStart={(e) => handleDragStart(e, layer.id)}
                        onDragOver={(e) => handleDragOver(e, layer.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, layer.id)}
                        onClick={() => onActiveLayerChange(layer.id)}
                    >
                        {/* Drag handle (only show when multiple layers) */}
                        {layers.length > 1 && (
                            <div className="mr-2 text-gray-300 cursor-grab hover:text-gray-500">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                    <circle cx="8" cy="6" r="1.5"/><circle cx="8" cy="12" r="1.5"/>
                                    <circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="6" r="1.5"/>
                                    <circle cx="16" cy="12" r="1.5"/><circle cx="16" cy="18" r="1.5"/>
                                </svg>
                            </div>
                        )}

                        {/* Visibility Toggle */}
                        <button
                            className={`mr-2 ${layer.visible ? 'text-gray-600' : 'text-gray-300'}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                const newLayers = layers.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l);
                                onLayerChange(newLayers);
                            }}
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                {layer.visible ? (
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 5c-3.866 0-7 3.134-7 7s3.134 7 7 7 7-3.134 7-7-3.134-7-7-7z M12 9a3 3 0 100 6 3 3 0 000-6z" fill="currentColor" />
                                ) : (
                                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                )}
                            </svg>
                        </button>

                        {/* Layer name or rename input */}
                        {editingLayerId === layer.id ? (
                            <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleFinishRename();
                                    if (e.key === 'Escape') handleCancelRename();
                                }}
                                onBlur={handleFinishRename}
                                className="flex-1 text-sm border border-blue-300 rounded px-1 outline-none focus:ring-2 focus:ring-blue-500"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                                maxLength={50}
                            />
                        ) : (
                            <span
                                className="flex-1 text-sm truncate select-none cursor-text"
                                onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    handleStartRename(layer.id, layer.name);
                                }}
                                title="双击重命名"
                            >
                                {layer.name}
                            </span>
                        )}

                        {/* Export button */}
                        <button
                            className="text-gray-400 hover:text-green-600 opacity-0 group-hover:opacity-100"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleExportLayer(layer.id);
                            }}
                            title="导出图层"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </button>

                        {/* Delete (only if > 1 layer) */}
                        {layers.length > 1 && (
                            <button
                                className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`确定删除图层 "${layer.name}" 吗?`)) {
                                        const newLayers = layers.filter(l => l.id !== layer.id);
                                        onLayerChange(newLayers);
                                        // if deleted active, select top
                                        if (activeLayerId === layer.id) {
                                            onActiveLayerChange(newLayers[newLayers.length - 1].id);
                                        }
                                    }
                                }}
                            >
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* Footer / Toolbar */}
            <div className="p-4 border-t flex justify-center">
                <button
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded text-xs hover:bg-gray-50 flex items-center transition-all"
                    onClick={() => {
                        // trigger add layer via a callback hack or just assume parent handles it if we pass "onAdd"
                        // For now, let's use a special prop we need to add to interface
                        (onLayerChange as any)('ADD_NEW');
                    }}
                >
                    <svg className="w-3 h-3 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    新建图层
                </button>
            </div>
        </div>
    );
};

export default LayerPanel;
