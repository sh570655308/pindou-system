import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import ConsumptionReportTab from '../components/reports/ConsumptionReportTab';
import SalesReportTab from '../components/reports/SalesReportTab';
import InventoryReportTab from '../components/reports/InventoryReportTab';
import PurchaseReportTab from '../components/reports/PurchaseReportTab';
import CompletionReportTab from '../components/reports/CompletionReportTab';
import BusinessReportTab from '../components/reports/BusinessReportTab';

// 报表标签页配置
interface ReportTab {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  component: React.ComponentType<any>;
}

const reportTabs: ReportTab[] = [
  {
    id: 'consumption',
    label: '消耗统计表',
    description: '按物料汇总统计所有完工记录产生的消耗情况',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    component: ConsumptionReportTab,
  },
  {
    id: 'sales',
    label: '销售数据统计',
    description: '销售趋势、产品排行和利润分析',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    component: SalesReportTab,
  },
  {
    id: 'inventory',
    label: '库存分析报表',
    description: '库存预警、周转率和分布统计',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
    component: InventoryReportTab,
  },
  {
    id: 'purchase',
    label: '采购数据统计',
    description: '采购订单、到货情况和供应商分析',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    component: PurchaseReportTab,
  },
  {
    id: 'completion',
    label: '完工统计报表',
    description: '完工数量、趋势和效率分析',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    component: CompletionReportTab,
  },
  {
    id: 'business',
    label: '综合经营报表',
    description: '进销存汇总、成本利润和经营总览',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    component: BusinessReportTab,
  },
];

const Reports: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>(reportTabs[0].id);
  const activeTabData = reportTabs.find(tab => tab.id === activeTab);
  const ActiveComponent = activeTabData?.component || ConsumptionReportTab;

  return (
    <div className="p-4">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">统计报表</h2>
        <div className="text-sm text-gray-600">
          查看各类业务数据统计报表
        </div>
      </div>

      {/* 标签页导航 */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {reportTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm
                    ${isActive
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <div className="flex items-center space-x-2">
                    {tab.icon}
                    <span>{tab.label}</span>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* 标签页内容区域 */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        {/* 标签页标题和描述 */}
        {activeTabData && (
          <div className="mb-6 pb-4 border-b border-gray-200">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              {activeTabData.label}
            </h3>
            <p className="text-sm text-gray-600">
              {activeTabData.description}
            </p>
          </div>
        )}

        {/* 渲染活动标签页组件 */}
        <ActiveComponent />
      </div>

      {/* 全局功能提示 */}
      <div className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-gray-800">
              报表功能
            </h3>
            <div className="mt-2 text-sm text-gray-700">
              <p>
                提供6种统计报表：消耗统计、销售数据、库存分析、采购数据、完工统计、综合经营。各报表支持时间范围筛选和数据刷新。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reports;