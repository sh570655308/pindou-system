import React from 'react';

interface KPICardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: string;
  trendType?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'orange';
}

const KPICard: React.FC<KPICardProps> = ({
  title,
  value,
  unit,
  trend,
  trendType = 'neutral',
  icon,
  color = 'blue'
}) => {
  const colorClasses = {
    blue: {
      bg: 'bg-blue-50',
      text: 'text-blue-600',
      border: 'border-blue-200',
      iconBg: 'bg-blue-100',
      iconText: 'text-blue-600'
    },
    green: {
      bg: 'bg-green-50',
      text: 'text-green-600',
      border: 'border-green-200',
      iconBg: 'bg-green-100',
      iconText: 'text-green-600'
    },
    red: {
      bg: 'bg-red-50',
      text: 'text-red-600',
      border: 'border-red-200',
      iconBg: 'bg-red-100',
      iconText: 'text-red-600'
    },
    yellow: {
      bg: 'bg-yellow-50',
      text: 'text-yellow-600',
      border: 'border-yellow-200',
      iconBg: 'bg-yellow-100',
      iconText: 'text-yellow-600'
    },
    purple: {
      bg: 'bg-purple-50',
      text: 'text-purple-600',
      border: 'border-purple-200',
      iconBg: 'bg-purple-100',
      iconText: 'text-purple-600'
    },
    orange: {
      bg: 'bg-orange-50',
      text: 'text-orange-600',
      border: 'border-orange-200',
      iconBg: 'bg-orange-100',
      iconText: 'text-orange-600'
    }
  };

  const colors = colorClasses[color];

  const getTrendIcon = () => {
    if (trendType === 'up') {
      return (
        <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      );
    } else if (trendType === 'down') {
      return (
        <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      );
    }
    return null;
  };

  return (
    <div className={`${colors.bg} ${colors.border} border rounded-lg p-4`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
          <div className="flex items-baseline">
            <span className={`text-2xl font-bold ${colors.text}`}>
              {typeof value === 'number' ? value.toLocaleString() : value}
            </span>
            {unit && <span className="ml-1 text-sm text-gray-500">{unit}</span>}
          </div>
          {trend && (
            <div className="flex items-center mt-1">
              {getTrendIcon()}
              <span className={`ml-1 text-sm ${
                trendType === 'up' ? 'text-green-600' :
                trendType === 'down' ? 'text-red-600' :
                'text-gray-600'
              }`}>
                {trend}
              </span>
            </div>
          )}
        </div>
        {icon && (
          <div className={`ml-4 p-3 rounded-lg ${colors.iconBg} ${colors.iconText}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
};

export default KPICard;
