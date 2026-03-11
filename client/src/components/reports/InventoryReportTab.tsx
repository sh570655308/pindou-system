import React, { useEffect, useState } from 'react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import KPICard from './KPICard';
import ReportFilter from './ReportFilter';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

interface InventoryWarning {
  id: number;
  code: string;
  category_name: string;
  current_stock: number;
  warning_threshold: number;
  unit_price: number;
}

interface CategoryDistribution {
  category_name: string;
  product_count: number;
  total_quantity: number;
  total_value: number;
}

interface InventorySummary {
  total_products: number;
  total_quantity: number;
  total_value: number;
  warning_count: number;
}

interface InventoryReportData {
  warnings: InventoryWarning[];
  categoryDistribution: CategoryDistribution[];
  summary: InventorySummary;
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

const InventoryReportTab: React.FC = () => {
  const { user } = useAuth();
  const [reportData, setReportData] = useState<InventoryReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadInventoryReport();
  }, []);

  const loadInventoryReport = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/reports/inventory');
      setReportData(res.data);
    } catch (err: any) {
      console.error('加载库存分析失败', err);
      setError(err?.response?.data?.error || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-500">正在加载库存分析数据...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500">{error}</div>
        <button
          onClick={loadInventoryReport}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          重试
        </button>
      </div>
    );
  }

  if (!reportData) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-500">暂无库存分析数据</div>
      </div>
    );
  }

  // Prepare chart data
  const pieData = reportData.categoryDistribution.map(item => ({
    name: item.category_name,
    value: item.total_value
  }));

  const barData = reportData.categoryDistribution.map(item => ({
    name: item.category_name,
    数量: item.total_quantity,
    价值: item.total_value
  }));

  return (
    <div>
      <ReportFilter
        filters={{}}
        onChange={() => {}}
        onRefresh={loadInventoryReport}
        loading={loading}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="物料种类"
          value={reportData.summary.total_products}
          unit="种"
          color="blue"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          }
        />
        <KPICard
          title="库存总量"
          value={reportData.summary.total_quantity}
          unit="件"
          color="green"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
          }
        />
        <KPICard
          title="库存总值"
          value={reportData.summary.total_value.toFixed(2)}
          unit="元"
          color="purple"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <KPICard
          title="预警数量"
          value={reportData.summary.warning_count}
          unit="项"
          color="red"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
      </div>

      {/* Inventory Warnings */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h3 className="text-lg font-medium mb-4">库存预警</h3>
        {reportData.warnings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">物料代码</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">类别</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">当前库存</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">预警阈值</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">差额</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">库存价值</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {reportData.warnings.map((item) => {
                  const diff = item.current_stock - item.warning_threshold;
                  const isNegative = item.current_stock < 0;
                  const isLow = item.current_stock < item.warning_threshold;
                  return (
                    <tr key={item.id} className={isNegative ? 'bg-red-50' : ''}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {item.code}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          {item.category_name}
                        </span>
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${
                        isNegative ? 'text-red-600' : isLow ? 'text-orange-600' : 'text-gray-900'
                      }`}>
                        {item.current_stock}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {item.warning_threshold}
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${
                        diff < 0 ? 'text-red-600' : 'text-orange-600'
                      }`}>
                        {diff > 0 ? '+' : ''}{diff}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        ¥{(item.current_stock * item.unit_price).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isNegative ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            负库存
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            低库存
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="mt-2">库存状况良好，无预警项</p>
          </div>
        )}
      </div>

      {/* Category Distribution Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Pie Chart */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-medium mb-4">库存价值分布</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => `${entry.name}: ¥${entry.value.toFixed(0)}`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Bar Chart */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-medium mb-4">类别统计</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="数量" fill="#3B82F6" />
              <Bar dataKey="价值" fill="#10B981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Category Detail Table */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-medium mb-4">类别详细统计</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">类别</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">物料种类</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">总数量</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">总价值</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">平均单价</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reportData.categoryDistribution.map((item, index) => (
                <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {item.category_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    {item.product_count}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    {item.total_quantity}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    ¥{item.total_value.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    ¥{item.total_quantity > 0 ? (item.total_value / item.total_quantity).toFixed(2) : '0.00'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default InventoryReportTab;
