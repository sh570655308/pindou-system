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
  completion_count: number;
  total_quantity: number;
  unique_drawings: number;
}

interface DrawingRankingData {
  drawing_id: number;
  title: string;
  completion_count: number;
  total_quantity: number;
  last_completion_date: string;
  avg_quantity: number;
}

interface CompletionSummary {
  total_completions: number;
  total_quantity: number;
  unique_drawings: number;
  daily_avg: number;
}

interface CompletionReportData {
  timeTrend: TimeTrendData[];
  drawingRanking: DrawingRankingData[];
  summary: CompletionSummary;
}

const CompletionReportTab: React.FC = () => {
  const { user } = useAuth();
  const [reportData, setReportData] = useState<CompletionReportData | null>(null);
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
    loadCompletionReport();
  }, [filters]);

  const loadCompletionReport = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/reports/completion', {
        params: {
          days: filters.timeRange
        }
      });
      setReportData(res.data);
    } catch (err: any) {
      console.error('加载完工统计失败', err);
      setError(err?.response?.data?.error || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-500">正在加载完工统计数据...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500">{error}</div>
        <button
          onClick={loadCompletionReport}
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
        <div className="text-gray-500">暂无完工统计数据</div>
      </div>
    );
  }

  return (
    <div>
      <ReportFilter
        filters={filterConfig}
        onChange={setFilters}
        onRefresh={loadCompletionReport}
        loading={loading}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="完工记录总数"
          value={reportData.summary.total_completions}
          unit="次"
          color="blue"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          }
        />
        <KPICard
          title="完工总数量"
          value={reportData.summary.total_quantity}
          unit="件"
          color="green"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          }
        />
        <KPICard
          title="活跃图纸数"
          value={reportData.summary.unique_drawings}
          unit="个"
          color="purple"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />
        <KPICard
          title="日均完工"
          value={reportData.summary.daily_avg.toFixed(2)}
          unit="次"
          color="orange"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Time Trend Chart */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h3 className="text-lg font-medium mb-4">完工趋势</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={reportData.timeTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="completion_count" name="完工次数" stroke="#3B82F6" strokeWidth={2} />
            <Line type="monotone" dataKey="total_quantity" name="完工数量" stroke="#10B981" strokeWidth={2} />
            <Line type="monotone" dataKey="unique_drawings" name="活跃图纸" stroke="#F59E0B" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Drawing Ranking */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-medium mb-4">图纸完工排行 (Top 10)</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">排名</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">图纸名称</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">完工次数</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">总数量</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">平均数量</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">最后完工日期</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reportData.drawingRanking.map((item, index) => (
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
                    {item.title}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    {item.completion_count}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    {item.total_quantity}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                    {item.avg_quantity.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {new Date(item.last_completion_date).toLocaleDateString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {reportData.drawingRanking.length === 0 && (
          <div className="text-center py-8 text-gray-500">暂无排行数据</div>
        )}
      </div>

      {/* Completion Efficiency Analysis */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mt-6">
        <h3 className="text-lg font-medium mb-4">完工效率分析</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="text-sm text-gray-600 mb-2">高活跃图纸（完工5次以上）</div>
            <div className="text-2xl font-bold text-blue-600">
              {reportData.drawingRanking.filter(d => d.completion_count >= 5).length}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              占比: {reportData.drawingRanking.length > 0
                ? ((reportData.drawingRanking.filter(d => d.completion_count >= 5).length / reportData.drawingRanking.length) * 100).toFixed(2)
                : 0}%
            </div>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <div className="text-sm text-gray-600 mb-2">中等活跃图纸（完工2-4次）</div>
            <div className="text-2xl font-bold text-green-600">
              {reportData.drawingRanking.filter(d => d.completion_count >= 2 && d.completion_count < 5).length}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              占比: {reportData.drawingRanking.length > 0
                ? ((reportData.drawingRanking.filter(d => d.completion_count >= 2 && d.completion_count < 5).length / reportData.drawingRanking.length) * 100).toFixed(2)
                : 0}%
            </div>
          </div>
          <div className="p-4 bg-yellow-50 rounded-lg">
            <div className="text-sm text-gray-600 mb-2">低活跃图纸（完工1次）</div>
            <div className="text-2xl font-bold text-yellow-600">
              {reportData.drawingRanking.filter(d => d.completion_count === 1).length}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              占比: {reportData.drawingRanking.length > 0
                ? ((reportData.drawingRanking.filter(d => d.completion_count === 1).length / reportData.drawingRanking.length) * 100).toFixed(2)
                : 0}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompletionReportTab;
