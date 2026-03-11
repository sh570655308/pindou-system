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
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

interface TimeTrendData {
  date: string;
  order_count: number;
  total_amount: number;
  received_count: number;
  returned_count: number;
}

interface StatusDistribution {
  status: string;
  count: number;
  amount: number;
}

interface PurchaseSummary {
  total_orders: number;
  total_amount: number;
  received_count: number;
  received_rate: number;
  returned_count: number;
  returned_rate: number;
}

interface PurchaseReportData {
  timeTrend: TimeTrendData[];
  statusDistribution: StatusDistribution[];
  summary: PurchaseSummary;
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  confirmed: '已确认',
  shipped: '已发货',
  received: '已签收',
  returned: '已退货',
  cancelled: '已取消'
};

const PurchaseReportTab: React.FC = () => {
  const { user } = useAuth();
  const [reportData, setReportData] = useState<PurchaseReportData | null>(null);
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
    loadPurchaseReport();
  }, [filters]);

  const loadPurchaseReport = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/reports/purchase', {
        params: {
          days: filters.timeRange
        }
      });
      setReportData(res.data);
    } catch (err: any) {
      console.error('加载采购统计失败', err);
      setError(err?.response?.data?.error || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-500">正在加载采购统计数据...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500">{error}</div>
        <button
          onClick={loadPurchaseReport}
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
        <div className="text-gray-500">暂无采购统计数据</div>
      </div>
    );
  }

  // Prepare status pie chart data
  const pieData = (reportData.statusDistribution || []).map(item => ({
    name: STATUS_LABELS[item.status] || item.status,
    value: item.count
  }));

  return (
    <div>
      <ReportFilter
        filters={filterConfig}
        onChange={setFilters}
        onRefresh={loadPurchaseReport}
        loading={loading}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="采购订单总数"
          value={reportData.summary.total_orders}
          unit="单"
          color="blue"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
        <KPICard
          title="采购总额"
          value={(reportData.summary.total_amount || 0).toFixed(2)}
          unit="元"
          color="green"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <KPICard
          title="签收率"
          value={(reportData.summary.received_rate || 0).toFixed(2)}
          unit="%"
          color="purple"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <KPICard
          title="退货率"
          value={(reportData.summary.returned_rate || 0).toFixed(2)}
          unit="%"
          color="red"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
            </svg>
          }
        />
      </div>

      {/* Time Trend Chart */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h3 className="text-lg font-medium mb-4">采购趋势</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={reportData.timeTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="order_count" name="订单数" stroke="#3B82F6" strokeWidth={2} />
            <Line type="monotone" dataKey="total_amount" name="金额" stroke="#10B981" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution Pie Chart */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-medium mb-4">订单状态分布</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => `${entry.name}: ${entry.value}单`}
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

        {/* Status Distribution Table */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-medium mb-4">状态详细统计</h3>
          <div className="overflow-y-auto" style={{ maxHeight: '300px' }}>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">订单数</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">金额</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">占比</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {(reportData.statusDistribution || []).map((item, index) => {
                  const percentage = (reportData.summary.total_orders || 0) > 0
                    ? ((item.count / reportData.summary.total_orders) * 100).toFixed(2)
                    : '0.00';
                  return (
                    <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {STATUS_LABELS[item.status] || item.status}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {item.count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        ¥{(item.amount || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {percentage}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Delivery Metrics */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mt-6">
        <h3 className="text-lg font-medium mb-4">交付指标</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{reportData.summary.received_count || 0}</div>
            <div className="text-sm text-gray-600">已签收订单</div>
          </div>
          <div className="text-center p-4 bg-red-50 rounded-lg">
            <div className="text-2xl font-bold text-red-600">{reportData.summary.returned_count || 0}</div>
            <div className="text-sm text-gray-600">已退货订单</div>
          </div>
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">
              {(reportData.summary.total_orders || 0) - (reportData.summary.received_count || 0) - (reportData.summary.returned_count || 0)}
            </div>
            <div className="text-sm text-gray-600">进行中订单</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PurchaseReportTab;
