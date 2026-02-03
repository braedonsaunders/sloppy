import { type HTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  dot?: boolean;
}

const variantStyles = {
  success: 'bg-success/20 text-success',
  warning: 'bg-warning/20 text-warning',
  error: 'bg-error/20 text-error',
  info: 'bg-accent/20 text-accent',
  neutral: 'bg-dark-600 text-dark-300',
};

const dotColors = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  info: 'bg-accent',
  neutral: 'bg-dark-400',
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

export default function Badge({
  className,
  variant = 'neutral',
  size = 'sm',
  icon,
  dot,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={twMerge(
        clsx(
          'inline-flex items-center gap-1.5 rounded-full font-medium',
          variantStyles[variant],
          sizeStyles[size],
          className
        )
      )}
      {...props}
    >
      {dot && (
        <span
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            dotColors[variant]
          )}
        />
      )}
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </span>
  );
}

// Convenience components for common badge types
export function StatusBadge({
  status,
  ...props
}: Omit<BadgeProps, 'variant' | 'children'> & {
  status: 'running' | 'paused' | 'completed' | 'failed' | 'stopped' | 'pending' | 'in_progress' | 'resolved' | 'skipped' | 'approved' | 'rejected';
}) {
  const statusConfig: Record<
    string,
    { variant: BadgeProps['variant']; label: string }
  > = {
    running: { variant: 'success', label: 'Running' },
    paused: { variant: 'warning', label: 'Paused' },
    completed: { variant: 'success', label: 'Completed' },
    failed: { variant: 'error', label: 'Failed' },
    stopped: { variant: 'neutral', label: 'Stopped' },
    pending: { variant: 'neutral', label: 'Pending' },
    in_progress: { variant: 'info', label: 'In Progress' },
    resolved: { variant: 'success', label: 'Resolved' },
    skipped: { variant: 'neutral', label: 'Skipped' },
    approved: { variant: 'success', label: 'Approved' },
    rejected: { variant: 'error', label: 'Rejected' },
  };

  const config = statusConfig[status] || { variant: 'neutral', label: status };

  return (
    <Badge variant={config.variant} dot {...props}>
      {config.label}
    </Badge>
  );
}

export function SeverityBadge({
  severity,
  ...props
}: Omit<BadgeProps, 'variant' | 'children'> & {
  severity: 'error' | 'warning' | 'info';
}) {
  const severityConfig: Record<
    string,
    { variant: BadgeProps['variant']; label: string }
  > = {
    error: { variant: 'error', label: 'Error' },
    warning: { variant: 'warning', label: 'Warning' },
    info: { variant: 'info', label: 'Info' },
  };

  const config = severityConfig[severity];

  return (
    <Badge variant={config.variant} {...props}>
      {config.label}
    </Badge>
  );
}

export function TypeBadge({
  type,
  ...props
}: Omit<BadgeProps, 'variant' | 'children'> & {
  type: 'lint' | 'type' | 'test' | 'security' | 'performance' | 'style';
}) {
  const typeLabels: Record<string, string> = {
    lint: 'Lint',
    type: 'Type',
    test: 'Test',
    security: 'Security',
    performance: 'Performance',
    style: 'Style',
  };

  return (
    <Badge variant="neutral" {...props}>
      {typeLabels[type] || type}
    </Badge>
  );
}
