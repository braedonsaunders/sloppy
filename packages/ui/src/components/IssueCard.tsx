import { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  ChevronDown,
  ChevronUp,
  FileCode,
  AlertTriangle,
  AlertCircle,
  Info,
  Check,
  X,
  SkipForward,
  ExternalLink,
} from 'lucide-react';
import Button from './Button';
import { StatusBadge, SeverityBadge, TypeBadge } from './Badge';
import type { Issue } from '@/lib/api';

export interface IssueCardProps {
  issue: Issue;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onSkip?: (id: string) => void;
  showActions?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  className?: string;
}

const severityIcons = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export default function IssueCard({
  issue,
  onApprove,
  onReject,
  onSkip,
  showActions = true,
  isExpanded: controlledExpanded,
  onToggleExpand,
  className,
}: IssueCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = controlledExpanded ?? internalExpanded;

  const handleToggle = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setInternalExpanded(!internalExpanded);
    }
  };

  const SeverityIcon = severityIcons[issue.severity];
  const isPending = issue.status === 'pending';
  const canApprove = isPending && onApprove;
  const canReject = isPending && onReject;
  const canSkip = isPending && onSkip;

  return (
    <div
      className={twMerge(
        clsx(
          'rounded-lg border bg-dark-800 transition-all duration-200',
          issue.status === 'resolved'
            ? 'border-success/30 bg-success/5'
            : issue.status === 'rejected'
            ? 'border-error/30 bg-error/5'
            : 'border-dark-700 hover:border-dark-600'
        ),
        className
      )}
    >
      {/* Header */}
      <div
        className="flex items-start gap-3 p-4 cursor-pointer"
        onClick={handleToggle}
      >
        {/* Severity Icon */}
        <div
          className={clsx(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
            issue.severity === 'error' && 'bg-error/10 text-error',
            issue.severity === 'warning' && 'bg-warning/10 text-warning',
            issue.severity === 'info' && 'bg-accent/10 text-accent'
          )}
        >
          <SeverityIcon className="h-4 w-4" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={issue.type} size="sm" />
            <SeverityBadge severity={issue.severity} size="sm" />
            <StatusBadge status={issue.status} size="sm" />
          </div>

          <p className="mt-2 text-sm text-dark-200 line-clamp-2">
            {issue.message}
          </p>

          <div className="mt-2 flex items-center gap-2 text-xs text-dark-400">
            <FileCode className="h-3.5 w-3.5" />
            <span className="font-mono truncate">{issue.file}</span>
            {issue.line && (
              <>
                <span>:</span>
                <span className="font-mono">{issue.line}</span>
              </>
            )}
            {issue.column && (
              <>
                <span>:</span>
                <span className="font-mono">{issue.column}</span>
              </>
            )}
          </div>
        </div>

        {/* Expand Button */}
        <button
          className="flex-shrink-0 p-1 text-dark-500 hover:text-dark-300 transition-colors"
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-dark-700 px-4 py-3 space-y-4">
          {/* Code Context */}
          {issue.context && (
            <div>
              <h4 className="text-xs font-medium text-dark-400 mb-2">
                Code Context
              </h4>
              <pre className="rounded-lg bg-dark-900 p-3 text-xs font-mono text-dark-200 overflow-x-auto">
                {issue.context}
              </pre>
            </div>
          )}

          {/* Issue Code/Rule */}
          {issue.code && (
            <div>
              <h4 className="text-xs font-medium text-dark-400 mb-1">
                Rule/Code
              </h4>
              <code className="text-xs font-mono text-accent">{issue.code}</code>
            </div>
          )}

          {/* Timestamps */}
          <div className="flex items-center gap-4 text-xs text-dark-500">
            <span>Created: {new Date(issue.createdAt).toLocaleString()}</span>
            {issue.resolvedAt && (
              <span>
                Resolved: {new Date(issue.resolvedAt).toLocaleString()}
              </span>
            )}
          </div>

          {/* Actions */}
          {showActions && (canApprove || canReject || canSkip) && (
            <div className="flex items-center gap-2 pt-2 border-t border-dark-700">
              {canApprove && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onApprove(issue.id);
                  }}
                  leftIcon={<Check className="h-3.5 w-3.5" />}
                >
                  Approve Fix
                </Button>
              )}
              {canReject && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReject(issue.id);
                  }}
                  leftIcon={<X className="h-3.5 w-3.5" />}
                >
                  Reject
                </Button>
              )}
              {canSkip && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSkip(issue.id);
                  }}
                  leftIcon={<SkipForward className="h-3.5 w-3.5" />}
                >
                  Skip
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Compact issue row for lists
export interface IssueRowProps {
  issue: Issue;
  onClick?: () => void;
  isSelected?: boolean;
  className?: string;
}

export function IssueRow({
  issue,
  onClick,
  isSelected = false,
  className,
}: IssueRowProps) {
  const SeverityIcon = severityIcons[issue.severity];

  return (
    <button
      onClick={onClick}
      className={twMerge(
        clsx(
          'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
          isSelected
            ? 'bg-accent/10 border-l-2 border-accent'
            : 'hover:bg-dark-700/50'
        ),
        className
      )}
    >
      <SeverityIcon
        className={clsx(
          'h-4 w-4 flex-shrink-0',
          issue.severity === 'error' && 'text-error',
          issue.severity === 'warning' && 'text-warning',
          issue.severity === 'info' && 'text-accent'
        )}
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm text-dark-200 truncate">{issue.message}</p>
        <p className="text-xs text-dark-500 font-mono truncate">
          {issue.file}
          {issue.line && `:${issue.line}`}
        </p>
      </div>

      <StatusBadge status={issue.status} size="sm" />
    </button>
  );
}
