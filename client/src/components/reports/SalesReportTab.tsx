import React, { useEffect, useState } from 'react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import KPICard from './KPICard';
import ReportFilter from './ReportFilter';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

interface TimeTrendData {
  date: string;
  order_count: number;
  total_amount: number;
  total_cost: number;
  profit: number;
}

interface ProductRankingData {
  drawing_id: number;
  drawing_title: string;
  quantity: number;
  amount: number;
  cost: number;
  profit: number;
}

interface ProfitAnalysis {
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  avg_order_amount: number;
}

interface SalesReportData {
  timeTrend: TimeTrendData[];
  productRanking: ProductRankingData[];
  profitAnalysis: ProfitAnalysis;
}

const SalesReportTab: React.FC = () => {
  const { user } = useAuth();
  const [reportData, setReportData] = useState<SalesReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [filters, setFilters] = useState<Record<string, string>>({
    timeRange: '30',
    groupBy: 'day'
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
    },
    groupBy: {
      value: filters.groupBy,
      label: '分组方式',
      options: [
        { label: '按天', value: 'day' },
        { label: '按周', value: 'week' },
        { label: '按月', value: 'month' }
      ]
    }
  };

  useEffect(() => {
    loadSalesReport();
  }, [filters]);

  const loadSalesReport = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/reports/sales', {
        params: {
          days: filters.timeRange,
          groupBy: filters.groupBy
        }
      });
      setReportData(res.data);
    } catch (err: any) {
      console.error('加载销售统计失败', err);
      setError(err?.response?.data?.error || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-500">正在加载销售统计数据...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500">{error}</div>
        <button
          onClick={loadSalesReport}
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
        <div className="text-gray-500">暂无销售统计数据</div>
      </div>
    );
  }

  const profitMargin = (reportData.profitAnalysis?.total_revenue || 0) > 0
    ? (((reportData.profitAnalysis?.total_profit || 0) / reportData.profitAnalysis.total_revenue) * 100).toFixed(2)
    : '0.00';

  return (
    <div>
      <ReportFilter
        filters={filterConfig}
        onChange={setFilters}
        onRefresh={loadSalesReport}
        loading={loading}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="总收入"
          value={(reportData.profitAnalysis?.total_revenue || 0).toFixed(2)}
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
          value={(reportData.profitAnalysis?.total_cost || 0).toFixed(2)}
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
          value={(reportData.profitAnalysis?.total_profit || 0).toFixed(2)}
          unit="元"
          color="green"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <KPICard
          title="利润率"
          value={profitMargin}
          unit="%"
          color="purple"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
      </div>

      {/* Time Trend Chart */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h3 className="text-lg font-medium mb-4">销售趋势</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={reportData.timeTrend || []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="total_amount" name="销售额" stroke="#3B82F6" strokeWidth={2} />
            <Line type="monotone" dataKey="profit" name="利润" stroke="#10B981" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Product Ranking */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-medium mb-4">产品销售排行 (Top 10)</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">排名</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">图纸</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">数量</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">金额</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">成本</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">利润</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">利润率</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(reportData.productRanking || []).map((item, index) => {
                const itemProfitMargin = (item.amount || 0) > 0
                  ? (((item.profit || 0) / item.amount) * 100).toFixed(2)
                  : '0.00';
                return (
                  <tr key={item.drawing_id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                        index === 0 ? 'bg-yellow-100 text-yellow-800' :
                        index === 1 ? 'bg-gray-100 text-gray-800' :
                        index === 2 ? 'bg-orange-100 text-orange-800' :
                        'bg-blue-50 text-blue-600'
                      }`}>
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {item.drawing_title}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                      {item.quantity}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                      ¥{(item.amount || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                      ¥{(item.cost || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-green-600">
                      ¥{(item.profit || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                      {itemProfitMargin}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(reportData.productRanking || []).length === 0 && (
          <div className="text-center py-8 text-gray-500">暂无排行数据</div>
        )}
      </div>
    </div>
  );
};

export default SalesReportTab;
