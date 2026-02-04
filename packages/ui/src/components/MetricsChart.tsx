import type { JSX } from 'react';
import { useMemo } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Metrics } from '@/lib/api';

export interface MetricsChartProps {
  data: Metrics[];
  type?: 'line' | 'area' | 'bar';
  metrics?: ('issuesFound' | 'issuesResolved' | 'testsPassing' | 'testsFailing' | 'lintErrors')[];
  height?: number;
  className?: string;
  showLegend?: boolean;
  showGrid?: boolean;
}

const metricColors = {
  issuesFound: '#f59e0b',
  issuesResolved: '#10b981',
  testsPassing: '#6366f1',
  testsFailing: '#ef4444',
  lintErrors: '#ec4899',
};

const metricLabels = {
  issuesFound: 'Issues Found',
  issuesResolved: 'Issues Resolved',
  testsPassing: 'Tests Passing',
  testsFailing: 'Tests Failing',
  lintErrors: 'Lint Errors',
};

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}): JSX.Element | null => {
  if (active !== true || payload === undefined) {return null;}

  return (
    <div className="rounded-lg border border-dark-600 bg-dark-800 p-3 shadow-xl">
      <p className="mb-2 text-xs text-dark-400">
        {new Date(label ?? '').toLocaleTimeString()}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-sm">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-dark-300">{entry.name}:</span>
          <span className="font-medium text-dark-100">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function MetricsChart({
  data,
  type = 'area',
  metrics = ['issuesFound', 'issuesResolved'],
  height = 300,
  className,
  showLegend = true,
  showGrid = true,
}: MetricsChartProps): JSX.Element {
  const formattedData = useMemo(() => {
    return data.map((item) => ({
      ...item,
      time: new Date(item.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));
  }, [data]);

  const renderChart = (): JSX.Element => {
    const commonProps = {
      data: formattedData,
      margin: { top: 10, right: 10, left: 0, bottom: 0 },
    };

    const xAxisProps = {
      dataKey: 'time',
      stroke: '#6e6e80',
      fontSize: 12,
      tickLine: false,
      axisLine: false,
    };

    const yAxisProps = {
      stroke: '#6e6e80',
      fontSize: 12,
      tickLine: false,
      axisLine: false,
      width: 40,
    };

    if (type === 'line') {
      return (
        <LineChart {...commonProps}>
          {showGrid && (
            <CartesianGrid strokeDasharray="3 3" stroke="#343541" />
          )}
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip content={<CustomTooltip />} />
          {showLegend && (
            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
            />
          )}
          {metrics.map((metric) => (
            <Line
              key={metric}
              type="monotone"
              dataKey={metric}
              name={metricLabels[metric]}
              stroke={metricColors[metric]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      );
    }

    if (type === 'bar') {
      return (
        <BarChart {...commonProps}>
          {showGrid && (
            <CartesianGrid strokeDasharray="3 3" stroke="#343541" />
          )}
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip content={<CustomTooltip />} />
          {showLegend && (
            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
            />
          )}
          {metrics.map((metric) => (
            <Bar
              key={metric}
              dataKey={metric}
              name={metricLabels[metric]}
              fill={metricColors[metric]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      );
    }

    // Default: area chart
    return (
      <AreaChart {...commonProps}>
        {showGrid && (
          <CartesianGrid strokeDasharray="3 3" stroke="#343541" />
        )}
        <XAxis {...xAxisProps} />
        <YAxis {...yAxisProps} />
        <Tooltip content={<CustomTooltip />} />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
          />
        )}
        {metrics.map((metric) => (
          <Area
            key={metric}
            type="monotone"
            dataKey={metric}
            name={metricLabels[metric]}
            stroke={metricColors[metric]}
            fill={metricColors[metric]}
            fillOpacity={0.2}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    );
  };

  if (data.length === 0) {
    return (
      <div
        className={twMerge(
          'flex items-center justify-center rounded-lg border border-dark-700 bg-dark-800',
          className
        )}
        style={{ height }}
      >
        <p className="text-dark-500">No metrics data available</p>
      </div>
    );
  }

  return (
    <div className={twMerge('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}

// Summary stats component
export interface MetricsSummaryProps {
  data: Metrics[];
  className?: string;
}

export function MetricsSummary({ data, className }: MetricsSummaryProps): JSX.Element | null {
  const summary = useMemo(() => {
    if (data.length === 0) {return null;}

    const latest = data[data.length - 1];
    const first = data[0];

    return {
      issuesFound: latest.issuesFound,
      issuesResolved: latest.issuesResolved,
      testsPassing: latest.testsPassing,
      testsFailing: latest.testsFailing,
      lintErrors: latest.lintErrors,
      issuesResolvedDelta: latest.issuesResolved - first.issuesResolved,
      testsPassingDelta: latest.testsPassing - first.testsPassing,
    };
  }, [data]);

  if (!summary) {
    return null;
  }

  return (
    <div
      className={twMerge(
        'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5',
        className
      )}
    >
      <SummaryCard
        label="Issues Found"
        value={summary.issuesFound}
        color="warning"
      />
      <SummaryCard
        label="Issues Resolved"
        value={summary.issuesResolved}
        delta={summary.issuesResolvedDelta}
        color="success"
      />
      <SummaryCard
        label="Tests Passing"
        value={summary.testsPassing}
        delta={summary.testsPassingDelta}
        color="info"
      />
      <SummaryCard
        label="Tests Failing"
        value={summary.testsFailing}
        color="error"
      />
      <SummaryCard
        label="Lint Errors"
        value={summary.lintErrors}
        color="neutral"
      />
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: number;
  delta?: number;
  color: 'success' | 'warning' | 'error' | 'info' | 'neutral';
}

function SummaryCard({ label, value, delta, color }: SummaryCardProps): JSX.Element {
  const colorStyles = {
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-error',
    info: 'text-accent',
    neutral: 'text-dark-300',
  };

  return (
    <div className="rounded-lg border border-dark-700 bg-dark-800 p-4">
      <p className="text-sm text-dark-400">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={clsx('text-2xl font-semibold', colorStyles[color])}>
          {value}
        </span>
        {delta !== undefined && delta !== 0 && (
          <span
            className={clsx(
              'text-xs font-medium',
              delta > 0 ? 'text-success' : 'text-error'
            )}
          >
            {delta > 0 ? '+' : ''}
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}
