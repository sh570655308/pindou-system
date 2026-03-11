import React, { useEffect, useState } from 'react';
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
  Legend,
  ResponsiveContainer
} from 'recharts';

interface BusinessKPIS {
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  profit_margin: number;
  total_inventory_value: number;
  total_purchase_amount: number;
}

interface InflowOutflowData {
  period: string;
  sales: number;
  purchase: number;
  inventory_change: number;
  profit: number;
}

interface ProductPerformance {
  product_code: string;
  category_name: string;
  sales_quantity: number;
  purchase_quantity: number;
  current_stock: number;
  turnover_rate: number;
}

interface BusinessReportData {
  kpis: BusinessKPIS;
  inflowOutflow: InflowOutflowData[];
  productPerformance: ProductPerformance[];
}

const BusinessReportTab: React.FC = () => {
  const { user } = useAuth();
  const [reportData, setReportData] = useState<BusinessReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [filters, setFilters] = useState<Record<string, string>>({
    timeRange: '30'
  });

  const filterConfig = {
    timeRange: {
      value: filters.timeRange,
      label: '时间范围',
      options: [
        { label: '最近7天', value: '7' },
        { label: '最近30天', value: '30' },
        { label: '最近90天', value: '90' },
        { label: '全部', value: 'all' }
      ]
    }
  };

  useEffect(() => {
    loadBusinessReport();
  }, [filters]);

  const loadBusinessReport = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/reports/business', {
        params: {
          days: filters.timeRange
        }
      });
      setReportData(res.data);
    } catch (err: any) {
      console.error('加载综合经营报表失败', err);
      setError(err?.response?.data?.error || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-500">正在加载综合经营数据...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500">{error}</div>
        <button
          onClick={loadBusinessReport}
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
        <div className="text-gray-500">暂无综合经营数据</div>
      </div>
    );
  }

  return (
    <div>
      <ReportFilter
        filters={filterConfig}
        onChange={setFilters}
        onRefresh={loadBusinessReport}
        loading={loading}
      />

      {/* KPI Cards - Top Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <KPICard
          title="总收入"
          value={(reportData.kpis?.total_revenue || 0).toFixed(2)}
          unit="元"
          color="blue"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <KPICard
          title="总成本"
          value={(reportData.kpis?.total_cost || 0).toFixed(2)}
          unit="元"
          color="red"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
            </svg>
          }
        />
        <KPICard
          title="总利润"
          value={(reportData.kpis?.total_profit || 0).toFixed(2)}
          unit="元"
          color="green"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* KPI Cards - Bottom Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <KPICard
          title="利润率"
          value={(reportData.kpis?.profit_margin || 0).toFixed(2)}
          unit="%"
          color="purple"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
        <KPICard
          title="库存总值"
          value={(reportData.kpis?.total_inventory_value || 0).toFixed(2)}
          unit="元"
          color="yellow"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          }
        />
        <KPICard
          title="采购总额"
          value={(reportData.kpis?.total_purchase_amount || 0).toFixed(2)}
          unit="元"
          color="orange"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          }
        />
      </div>

      {/* Inflow/Outflow Analysis Chart */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h3 className="text-lg font-medium mb-4">进销存趋势分析</h3>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={reportData.inflowOutflow || []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="period" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="sales" name="销售" fill="#10B981" />
            <Bar dataKey="purchase" name="采购" fill="#3B82F6" />
            <Bar dataKey="profit" name="利润" fill="#F59E0B" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Product Performance Table */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-medium mb-4">物料表现分析</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">物料代码</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">类别</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">销售数量</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">采购数量</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">当前库存</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">周转率</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(reportData.productPerformance || []).map((item, index) => (
                <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {item.product_code}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {item.category_name}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    {item.sales_quantity}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    {item.purchase_quantity}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    {item.current_stock}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    {(item.turnover_rate || 0).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {(item.turnover_rate || 0) > 2 ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        高周转
                      </span>
                    ) : (item.turnover_rate || 0) > 0.5 ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        中等
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        低周转
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(reportData.productPerformance || []).length === 0 && (
          <div className="text-center py-8 text-gray-500">暂无物料表现数据</div>
        )}
      </div>

      {/* Business Summary */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mt-6">
        <h3 className="text-lg font-medium mb-4">经营概况</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-3">成本结构</h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">销售收入</span>
                <span className="text-sm font-medium text-green-600">
                  ¥{(reportData.kpis?.total_revenue || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">采购成本</span>
                <span className="text-sm font-medium text-blue-600">
                  ¥{(reportData.kpis?.total_purchase_amount || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">其他成本</span>
                <span className="text-sm font-medium text-red-600">
                  ¥{((reportData.kpis?.total_cost || 0) - (reportData.kpis?.total_purchase_amount || 0)).toFixed(2)}
                </span>
              </div>
              <div className="border-t pt-2 mt-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-900">净利润</span>
                  <span className={`text-sm font-bold ${(reportData.kpis?.total_profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ¥{(reportData.kpis?.total_profit || 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-3">资产状况</h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">库存价值</span>
                <span className="text-sm font-medium text-purple-600">
                  ¥{(reportData.kpis?.total_inventory_value || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">利润率</span>
                <span className={`text-sm font-medium ${(reportData.kpis?.profit_margin || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(reportData.kpis?.profit_margin || 0).toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusinessReportTab;
