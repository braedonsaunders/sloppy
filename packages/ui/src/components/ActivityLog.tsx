import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  Search,
  Wrench,
  TestTube,
  GitCommit,
  Clock,
  AlertCircle,
  Info,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import type { Activity } from '@/lib/api';

export interface ActivityLogProps {
  activities: Activity[];
  maxHeight?: string;
  autoScroll?: boolean;
  className?: string;
}

const activityIcons: Record<string, typeof Search> = {
  analyzing: Search,
  fixing: Wrench,
  testing: TestTube,
  committing: GitCommit,
  waiting: Clock,
  error: AlertCircle,
  info: Info,
  success: CheckCircle,
};

const activityColors: Record<string, string> = {
  analyzing: 'text-accent bg-accent/10',
  fixing: 'text-warning bg-warning/10',
  testing: 'text-purple-400 bg-purple-400/10',
  committing: 'text-success bg-success/10',
  waiting: 'text-dark-400 bg-dark-600',
  error: 'text-error bg-error/10',
  info: 'text-accent bg-accent/10',
  success: 'text-success bg-success/10',
};

export default function ActivityLog({
  activities,
  maxHeight = '400px',
  autoScroll = true,
  className,
}: ActivityLogProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new activities are added
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activities.length, autoScroll]);

  if (activities.length === 0) {
    return (
      <div
        className={twMerge(
          'flex flex-col items-center justify-center rounded-lg border border-dark-700 bg-dark-800 p-8',
          className
        )}
      >
        <Loader2 className="h-8 w-8 animate-spin text-dark-500" />
        <p className="mt-3 text-sm text-dark-400">Waiting for activity...</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={twMerge(
        'rounded-lg border border-dark-700 bg-dark-800 overflow-hidden',
        className
      )}
    >
      <div
        className="overflow-y-auto p-4 space-y-3"
        style={{ maxHeight }}
      >
        {activities.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

interface ActivityItemProps {
  activity: Activity;
}

function ActivityItem({ activity }: ActivityItemProps): JSX.Element {
  const Icon = activityIcons[activity.type] ?? Info;
  const colorClass = activityColors[activity.type] ?? 'text-dark-400 bg-dark-600';

  const time = new Date(activity.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <div
        className={clsx(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
          colorClass
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-dark-200">{activity.message}</p>
        {activity.details !== undefined && (
          <ActivityDetails details={activity.details} />
        )}
      </div>
      <span className="flex-shrink-0 text-xs text-dark-500">{time}</span>
    </div>
  );
}

interface ActivityDetailsProps {
  details: Record<string, unknown>;
}

function ActivityDetails({ details }: ActivityDetailsProps): JSX.Element | null {
  const entries = Object.entries(details).filter(
    ([, value]) => value !== undefined && value !== null
  );

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="mt-1.5 space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="text-dark-500">{formatKey(key)}:</span>
          <span className="text-dark-400 font-mono truncate">
            {formatValue(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

// Compact activity indicator for headers
export interface ActivityIndicatorProps {
  activity?: Activity;
  isActive?: boolean;
  className?: string;
}

export function ActivityIndicator({
  activity,
  isActive = false,
  className,
}: ActivityIndicatorProps): JSX.Element {
  if (activity === undefined && !isActive) {
    return (
      <div className={twMerge('flex items-center gap-2', className)}>
        <span className="h-2 w-2 rounded-full bg-dark-600" />
        <span className="text-sm text-dark-500">Idle</span>
      </div>
    );
  }

  if (activity === undefined) {
    return (
      <div className={twMerge('flex items-center gap-2', className)}>
        <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
        <span className="text-sm text-dark-300">Running</span>
      </div>
    );
  }

  const Icon = activityIcons[activity.type] ?? Info;
  const colorClass = activityColors[activity.type] ?? 'text-dark-400 bg-dark-600';

  return (
    <div className={twMerge('flex items-center gap-2', className)}>
      <div
        className={clsx(
          'flex h-5 w-5 items-center justify-center rounded',
          colorClass
        )}
      >
        <Icon className="h-3 w-3" />
      </div>
      <span className="text-sm text-dark-300 truncate max-w-xs">
        {activity.message}
      </span>
    </div>
  );
}
