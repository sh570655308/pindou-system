import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout, isAdmin } = useAuth();

  const modules = [
    {
      id: 'inventory',
      title: '库存管理',
      description: '管理拼豆库存，查看统计信息，更新库存数量',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      color: 'bg-blue-500',
      hoverColor: 'hover:bg-blue-600',
      path: '/inventory',
    },
    {
      id: 'orders',
      title: '采购管理',
      description: '录入采购订单，管理在途/已签收/已退货库存',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
          />
        </svg>
      ),
      color: 'bg-orange-500',
      hoverColor: 'hover:bg-orange-600',
      path: '/orders',
    },
    {
      id: 'sales-orders',
      title: '订单管理',
      description: '管理销售订单，跟踪订单状态和交付情况',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
      ),
      color: 'bg-pink-500',
      hoverColor: 'hover:bg-pink-600',
      path: '/sales-orders',
    },
    {
      id: 'drawings',
      title: '图纸档案',
      description: '管理拼豆图纸档案，查看和编辑图纸信息',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      color: 'bg-green-500',
      hoverColor: 'hover:bg-green-600',
      path: '/drawings',
    },
    {
      id: 'pending-drawings',
      title: '待拼图纸',
      description: '查看和管理待拼装的图纸任务',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
      color: 'bg-teal-500',
      hoverColor: 'hover:bg-teal-600',
      path: '/pending-drawings',
    },
    {
      id: 'completions',
      title: '完工记录',
      description: '记录和查看已完成的项目信息',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6M5 7h14M5 7v10a2 2 0 002 2h10"
          />
        </svg>
      ),
      color: 'bg-indigo-500',
      hoverColor: 'hover:bg-indigo-600',
      path: '/completions',
    },
    {
      id: 'reports',
      title: '统计报表',
      description: '查看各类数据统计和报表分析',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      ),
      color: 'bg-yellow-500',
      hoverColor: 'hover:bg-yellow-600',
      path: '/reports',
    },
    {
      id: 'pixelate',
      title: '像素化',
      description: '将图片像素化并映射为物料颜色，交互查看与统计',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
        </svg>
      ),
      color: 'bg-purple-500',
      hoverColor: 'hover:bg-purple-600',
      path: '/pixelate',
    },
    // settings module intentionally hidden from dashboard
    // admin module only visible in top navigation
    // consumption module removed per requirements
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* 主内容区域 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">选择功能模块</h2>
          <p className="text-lg text-gray-600">请选择要使用的功能模块</p>
        </div>

        {/* 模块卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {modules.map((module) => (
            <div
              key={module.id}
              onClick={() => navigate(module.path)}
              className="bg-white rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer transform hover:-translate-y-2 overflow-hidden"
            >
              <div className={`${module.color} ${module.hoverColor} p-8 flex items-center justify-center text-white transition-colors`}>
                {module.icon}
              </div>
              <div className="p-6">
                <h3 className="text-xl font-bold text-gray-900 mb-2">{module.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{module.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
