import type { JSX } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ProgressBarProps {
  value: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'success' | 'warning' | 'error' | 'gradient';
  showLabel?: boolean;
  label?: string;
  animated?: boolean;
  striped?: boolean;
  className?: string;
}

const sizeStyles = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
};

const variantStyles = {
  default: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  gradient: 'bg-gradient-to-r from-accent via-purple-500 to-pink-500',
};

export default function ProgressBar({
  value,
  max = 100,
  size = 'md',
  variant = 'default',
  showLabel = false,
  label,
  animated = false,
  striped = false,
  className,
}: ProgressBarProps): JSX.Element {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <div className={twMerge('w-full', className)}>
      {(showLabel || (label !== undefined && label !== '')) && (
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-dark-300">{label}</span>
          {showLabel && (
            <span className="font-medium text-dark-200">
              {Math.round(percentage)}%
            </span>
          )}
        </div>
      )}
      <div
        className={clsx(
          'w-full overflow-hidden rounded-full bg-dark-700',
          sizeStyles[size]
        )}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-500 ease-out',
            variantStyles[variant],
            striped && 'bg-stripes',
            animated && 'animate-progress bg-[length:30px_30px]'
          )}
          style={{ width: `${String(percentage)}%` }}
        />
      </div>
    </div>
  );
}

// Indeterminate progress bar
export function IndeterminateProgress({
  size = 'md',
  variant = 'default',
  className,
}: Pick<ProgressBarProps, 'size' | 'variant' | 'className'>): JSX.Element {
  return (
    <div
      className={twMerge(
        clsx(
          'w-full overflow-hidden rounded-full bg-dark-700',
          sizeStyles[size],
          className
        )
      )}
      role="progressbar"
      aria-busy="true"
    >
      <div
        className={clsx(
          'h-full w-1/3 rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite]',
          variantStyles[variant]
        )}
      />
      <style>{`
        @keyframes indeterminate {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(400%);
          }
        }
      `}</style>
    </div>
  );
}

// Circular progress
export interface CircularProgressProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  variant?: 'default' | 'success' | 'warning' | 'error';
  showValue?: boolean;
  className?: string;
}

const circularVariantColors = {
  default: 'stroke-accent',
  success: 'stroke-success',
  warning: 'stroke-warning',
  error: 'stroke-error',
};

export function CircularProgress({
  value,
  max = 100,
  size = 48,
  strokeWidth = 4,
  variant = 'default',
  showValue = true,
  className,
}: CircularProgressProps): JSX.Element {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div
      className={twMerge('relative inline-flex', className)}
      style={{ width: size, height: size }}
    >
      <svg className="transform -rotate-90" width={size} height={size}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-dark-700"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={clsx(
            'transition-all duration-500 ease-out',
            circularVariantColors[variant]
          )}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
          }}
        />
      </svg>
      {showValue && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-medium text-dark-200">
            {Math.round(percentage)}%
          </span>
        </div>
      )}
    </div>
  );
}
