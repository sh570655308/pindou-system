import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import KPICard from './KPICard';
import ReportFilter from './ReportFilter';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';

interface ConsumptionReportItem {
  product_id: number;
  product_code: string;
  color_hex: string;
  category_name: string;
  total_quantity: number;
  completion_count: number;
  avg_consumption: number;
  recent_20_consumption: number;
}

interface ConsumptionReport {
  data: ConsumptionReportItem[];
  summary: {
    total_materials: number;
    total_consumption: number;
  };
}

type SortDirection = 'asc' | 'desc' | null;
type SortField = 'product_code' | 'category_name' | 'total_quantity' | 'avg_consumption' | 'recent_20_consumption';

const ConsumptionReportTab: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reportData, setReportData] = useState<ConsumptionReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [sortConfig, setSortConfig] = useState<{ field: SortField; direction: SortDirection }>({
    field: 'total_quantity',
    direction: 'desc'
  });

  useEffect(() => {
    loadConsumptionReport();
  }, []);

  // 监听设置变更事件，自动刷新数据
  useEffect(() => {
    const handleSettingsChange = () => {
      loadConsumptionReport();
    };
    window.addEventListener('settings_changed', handleSettingsChange);
    return () => {
      window.removeEventListener('settings_changed', handleSettingsChange);
    };
  }, []);

  const handleProductClick = (productId: number, productCode: string) => {
    navigate(`/inventory/logs/${productId}`, {
      state: { code: productCode }
    });
  };

  const loadConsumptionReport = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/reports/consumption');
      setReportData(res.data);
    } catch (err: any) {
      console.error('加载消耗统计失败', err);
      setError(err?.response?.data?.error || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    setSortConfig(prev => {
      if (prev.field === field) {
        const newDirection: SortDirection =
          prev.direction === 'asc' ? 'desc' :
          prev.direction === 'desc' ? null : 'asc';
        return { field, direction: newDirection };
      } else {
        return { field, direction: 'asc' };
      }
    });
  };

  const getSortedData = () => {
    if (!reportData?.data) return [];

    if (!sortConfig.direction) {
      return [...reportData.data];
    }

    return [...reportData.data].sort((a, b) => {
      const aValue = a[sortConfig.field];
      const bValue = b[sortConfig.field];

      if (sortConfig.field === 'total_quantity' || sortConfig.field === 'avg_consumption' || sortConfig.field === 'recent_20_consumption') {
        const aNum = Number(aValue);
        const bNum = Number(bValue);
        return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
      } else {
        const aStr = String(aValue).toLowerCase();
        const bStr = String(bValue).toLowerCase();
        if (sortConfig.direction === 'asc') {
          return aStr.localeCompare(bStr, undefined, { numeric: true });
        } else {
          return bStr.localeCompare(aStr, undefined, { numeric: true });
        }
      }
    });
  };

  const getSortIcon = (field: SortField) => {
    if (sortConfig.field !== field) {
      return (
        <svg className="w-4 h-4 text-gray-400 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    if (sortConfig.direction === 'asc') {
      return (
        <svg className="w-4 h-4 text-blue-600 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      );
    }
    return (
      <svg className="w-4 h-4 text-blue-600 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-500">正在加载消耗统计数据...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500">{error}</div>
        <button
          onClick={loadConsumptionReport}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          重试
        </button>
      </div>
    );
  }

  if (!reportData || reportData.data.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-500">暂无消耗统计数据</div>
      </div>
    );
  }

  const sortedData = getSortedData();

  // 准备图表数据（Top 15）
  const chartData = sortedData.slice(0, 15).map(item => ({
    code: item.product_code,
    消耗总量: item.total_quantity,
    平均消耗: item.avg_consumption,
    最近20次: item.recent_20_consumption,
    color: item.color_hex || '#CCCCCC'
  }));

  return (
    <div>
      <ReportFilter
        filters={{}}
        onChange={() => {}}
        onRefresh={loadConsumptionReport}
        loading={loading}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="消耗物料种类"
          value={reportData.summary.total_materials}
          unit="种"
          color="blue"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <KPICard
          title="总消耗数量"
          value={reportData.summary.total_consumption}
          unit="件"
          color="green"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          }
        />
        <KPICard
          title="平均物料消耗"
          value={reportData.summary.total_consumption / reportData.summary.total_materials}
          unit="次/种"
          color="purple"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          }
        />
        <KPICard
          title="物料记录数"
          value={reportData.data.length}
          unit="条"
          color="orange"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
      </div>

      {/* 消耗趋势图 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h3 className="text-lg font-medium mb-4">物料消耗排行 (Top 15)</h3>
        <ResponsiveContainer width="100%" height={450}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 110, right: 30, top: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis
              dataKey="code"
              type="category"
              width={100}
              tick={{ fontSize: 13 }}
              interval={0}
            />
            <Tooltip />
            <Bar dataKey="消耗总量" fill="#3B82F6" stroke="#374151" strokeWidth={1} maxBarSize={30}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} stroke="#374151" strokeWidth={1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 消耗详情表格 */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">物料消耗统计详情</h3>
          <div className="text-sm text-gray-500">
            共 {sortedData.length} 条记录
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('product_code')}>
                  物料代码 {getSortIcon('product_code')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('category_name')}>
                  类别 {getSortIcon('category_name')}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('total_quantity')}>
                  消耗总量 {getSortIcon('total_quantity')}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('avg_consumption')}>
                  平均消耗 {getSortIcon('avg_consumption')}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('recent_20_consumption')}>
                  最近20次消耗 {getSortIcon('recent_20_consumption')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedData.map((item, index) => (
                <tr key={item.product_id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <div
                        className="w-4 h-4 rounded border border-gray-300 flex-shrink-0"
                        style={{ backgroundColor: item.color_hex || '#CCCCCC' }}
                        title={`颜色: ${item.color_hex || '#CCCCCC'}`}
                      ></div>
                      <span className="text-sm font-medium text-gray-900">{item.product_code}</span>
                      {index < 3 && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          index === 0 ? 'bg-yellow-100 text-yellow-800' :
                          index === 1 ? 'bg-gray-100 text-gray-800' :
                          'bg-orange-100 text-orange-800'
                        }`}>
                          #{index + 1}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {item.category_name}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                      {item.total_quantity}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="text-sm text-gray-900">
                      {item.avg_consumption.toFixed(2)}
                      <div className="text-xs text-gray-500">
                        ({item.completion_count}次)
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                      {item.recent_20_consumption}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => handleProductClick(item.product_id, item.product_code)}
                      className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                      title="点击查看库存变动记录"
                    >
                      查看日志
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 统计说明 */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">
              统计说明
            </h3>
            <div className="mt-2 text-sm text-blue-700">
              <ul className="list-disc list-inside space-y-1">
                <li>消耗总量：该物料在所有完工记录中的累计消耗数量</li>
                <li>平均消耗：总消耗量除以完工次数</li>
                <li>最近20次消耗：最近20条完工记录中该物料的累计消耗</li>
                <li>点击"查看日志"可查看该物料的库存变动详细记录</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConsumptionReportTab;
