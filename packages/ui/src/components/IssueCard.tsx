import type { JSX } from 'react';
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
  Copy,
  CheckCheck,
  Clock,
  GitCommit,
  Lightbulb,
  Code2,
  MapPin,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import Button from './Button';
import { StatusBadge, SeverityBadge, TypeBadge } from './Badge';
import type { Issue } from '@/lib/api';

export interface IssueCardProps {
  issue: Issue;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onSkip?: (id: string) => void;
  onRetry?: (id: string, context?: string) => void;
  showActions?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  className?: string;
}

const severityIcons: Record<string, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  hint: Info,
};

const severityColors: Record<string, string> = {
  error: 'border-error/30 bg-error/5',
  warning: 'border-warning/30 bg-warning/5',
  info: 'border-accent/30 bg-accent/5',
  hint: 'border-dark-600 bg-dark-800',
};

export default function IssueCard({
  issue,
  onApprove,
  onReject,
  onSkip,
  onRetry,
  showActions = true,
  isExpanded: controlledExpanded,
  onToggleExpand,
  className,
}: IssueCardProps): JSX.Element {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const isExpanded = controlledExpanded ?? internalExpanded;

  const handleToggle = (): void => {
    if (onToggleExpand !== undefined) {
      onToggleExpand();
    } else {
      setInternalExpanded(!internalExpanded);
    }
  };

  const handleCopyContext = (): void => {
    if (issue.context !== undefined && issue.context !== '') {
      void navigator.clipboard.writeText(issue.context);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    }
  };

  const SeverityIcon = severityIcons[issue.severity] ?? Info;
  const isPending = issue.status === 'detected';
  const isFailed = issue.status === 'rejected';
  const canApprove = isPending && onApprove !== undefined;
  const canReject = isPending && onReject !== undefined;
  const canSkip = isPending && onSkip !== undefined;
  const canRetry = isFailed && onRetry !== undefined;

  // Parse context if it has suggestion
  const contextData = issue.context !== undefined && issue.context !== '' ? tryParseContext(issue.context) : null;
  const hasErrorOutput = contextData?.context !== undefined && (
    contextData.context.includes('Error') ||
    contextData.context.includes('FAIL') ||
    contextData.context.includes('error') ||
    contextData.context.includes('test') ||
    contextData.context.includes('assert')
  );

  return (
    <div
      className={twMerge(
        clsx(
          'rounded-lg border bg-dark-800 transition-all duration-200',
          issue.status === 'fixed'
            ? 'border-success/30 bg-success/5'
            : issue.status === 'rejected'
            ? 'border-error/30 bg-error/5'
            : issue.status === 'in_progress'
            ? severityColors[issue.severity]
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
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
            issue.severity === 'error' && 'bg-error/10 text-error',
            issue.severity === 'warning' && 'bg-warning/10 text-warning',
            issue.severity === 'info' && 'bg-accent/10 text-accent'
          )}
        >
          <SeverityIcon className="h-5 w-5" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <TypeBadge type={issue.type} size="sm" />
            <SeverityBadge severity={issue.severity} size="sm" />
            <StatusBadge status={issue.status} size="sm" />
            {issue.code !== undefined && issue.code !== '' && (
              <span className="text-xs font-mono text-dark-500 bg-dark-700 px-1.5 py-0.5 rounded">
                {issue.code}
              </span>
            )}
          </div>

          <p className="text-sm text-dark-200 leading-relaxed">
            {issue.message}
          </p>

          {/* File Location */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex items-center gap-2 text-xs text-dark-400 bg-dark-900/50 rounded px-2 py-1">
              <FileCode className="h-3.5 w-3.5" />
              <span className="font-mono truncate max-w-[300px]">{issue.file}</span>
              {issue.line !== undefined && (
                <>
                  <span className="text-dark-600">:</span>
                  <span className="font-mono text-accent">{issue.line}</span>
                </>
              )}
              {issue.column !== undefined && (
                <>
                  <span className="text-dark-600">:</span>
                  <span className="font-mono text-dark-500">{issue.column}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Expand Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
          className={clsx(
            'flex-shrink-0 p-2 rounded-lg transition-colors',
            isExpanded
              ? 'bg-accent/10 text-accent'
              : 'text-dark-500 hover:text-dark-300 hover:bg-dark-700'
          )}
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
        <div className="border-t border-dark-700 px-4 py-4 space-y-4">
          {/* Code Context */}
          {(issue.context !== undefined || contextData?.context !== undefined) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-dark-400 flex items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5" />
                  Code Context
                </h4>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyContext();
                  }}
                  className="flex items-center gap-1 text-xs text-dark-500 hover:text-dark-300 transition-colors"
                >
                  {copied ? (
                    <>
                      <CheckCheck className="h-3.5 w-3.5 text-success" />
                      <span className="text-success">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="rounded-lg bg-dark-900 p-3 text-xs font-mono text-dark-200 overflow-x-auto border border-dark-700">
                {contextData?.context ?? issue.context}
              </pre>
            </div>
          )}

          {/* Suggested Fix */}
          {contextData?.suggestion !== undefined && (
            <div className="rounded-lg border border-success/30 bg-success/5 p-3">
              <h4 className="text-xs font-medium text-success flex items-center gap-1.5 mb-2">
                <Lightbulb className="h-3.5 w-3.5" />
                Suggested Fix
              </h4>
              <p className="text-sm text-dark-200">{contextData.suggestion}</p>
            </div>
          )}

          {/* Error Details (expandable) */}
          {isFailed && hasErrorOutput && (
            <div className="rounded-lg border border-error/30 bg-error/5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowErrorDetails(!showErrorDetails);
                }}
                className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-error hover:bg-error/10 transition-colors rounded-lg"
              >
                <span className="flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5" />
                  Error Output
                </span>
                {showErrorDetails ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              {showErrorDetails && (
                <div className="px-3 pb-3">
                  <pre className="rounded-lg bg-dark-900 p-3 text-xs font-mono text-error/80 overflow-x-auto border border-error/20 max-h-[200px] overflow-y-auto">
                    {contextData?.context ?? issue.context}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
            {/* Location */}
            <div className="space-y-1">
              <span className="text-xs text-dark-500 flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                Location
              </span>
              <p className="text-sm font-mono text-dark-300">
                Line {issue.line ?? '?'}
                {issue.column !== undefined && `, Col ${String(issue.column)}`}
              </p>
            </div>

            {/* Created */}
            <div className="space-y-1">
              <span className="text-xs text-dark-500 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Created
              </span>
              <p className="text-sm text-dark-300">
                {formatTimestamp(issue.createdAt)}
              </p>
            </div>

            {/* Resolved */}
            {issue.resolvedAt !== undefined && (
              <div className="space-y-1">
                <span className="text-xs text-dark-500 flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  Resolved
                </span>
                <p className="text-sm text-dark-300">
                  {formatTimestamp(issue.resolvedAt)}
                </p>
              </div>
            )}

            {/* Commit */}
            {issue.commitId !== undefined && (
              <div className="space-y-1">
                <span className="text-xs text-dark-500 flex items-center gap-1">
                  <GitCommit className="h-3 w-3" />
                  Fixed In
                </span>
                <p className="text-sm font-mono text-accent">
                  {issue.commitId.substring(0, 7)}
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          {showActions && (canApprove || canReject || canSkip || canRetry) && (
            <div className="flex items-center gap-2 pt-3 border-t border-dark-700">
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
                  Skip for Now
                </Button>
              )}
              {canRetry && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(issue.id, issue.context);
                  }}
                  leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                >
                  Retry with Context
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Helper to format timestamps
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) {
    return 'Just now';
  }
  if (diffMins < 60) {
    return `${String(diffMins)}m ago`;
  }
  if (diffHours < 24) {
    return `${String(diffHours)}h ago`;
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Try to parse context if it's JSON with suggestion
function tryParseContext(context: string): { context?: string; suggestion?: string } | null {
  try {
    const parsed: unknown = JSON.parse(context);
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      return {
        context: typeof obj.context === 'string' ? obj.context : undefined,
        suggestion: typeof obj.suggestion === 'string' ? obj.suggestion : undefined,
      };
    }
  } catch {
    // Not JSON, return as plain context
  }
  return null;
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
}: IssueRowProps): JSX.Element {
  const SeverityIcon = severityIcons[issue.severity] ?? Info;

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
          {issue.line !== undefined && `:${String(issue.line)}`}
        </p>
      </div>

      <StatusBadge status={issue.status} size="sm" />
    </button>
  );
}

// Detailed issue view for split-panel layouts
export interface IssueDetailViewProps {
  issue: Issue;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onSkip?: (id: string) => void;
  onRetry?: (id: string, context?: string) => void;
  showActions?: boolean;
  className?: string;
}

export function IssueDetailView({
  issue,
  onApprove,
  onReject,
  onSkip,
  onRetry,
  showActions = true,
  className,
}: IssueDetailViewProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const SeverityIcon = severityIcons[issue.severity] ?? Info;
  const isPending = issue.status === 'detected';
  const isFailed = issue.status === 'rejected';
  const canRetry = isFailed && onRetry !== undefined;
  const contextData = issue.context !== undefined && issue.context !== '' ? tryParseContext(issue.context) : null;
  const hasErrorOutput = contextData?.context !== undefined && (
    contextData.context.includes('Error') ||
    contextData.context.includes('FAIL') ||
    contextData.context.includes('error') ||
    contextData.context.includes('test') ||
    contextData.context.includes('assert')
  );

  const handleCopy = (text: string): void => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div className={twMerge('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-start gap-4">
        <div
          className={clsx(
            'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl',
            issue.severity === 'error' && 'bg-error/10 text-error',
            issue.severity === 'warning' && 'bg-warning/10 text-warning',
            issue.severity === 'info' && 'bg-accent/10 text-accent'
          )}
        >
          <SeverityIcon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <TypeBadge type={issue.type} />
            <SeverityBadge severity={issue.severity} />
            <StatusBadge status={issue.status} />
          </div>
          <h2 className="text-lg font-medium text-dark-100 leading-snug">
            {issue.message}
          </h2>
        </div>
      </div>

      {/* File Location */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-dark-900 border border-dark-700">
        <FileCode className="h-5 w-5 text-dark-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-mono text-dark-200 truncate">{issue.file}</p>
          <p className="text-xs text-dark-500">
            Line {issue.line ?? '?'}
            {issue.column !== undefined && `, Column ${String(issue.column)}`}
          </p>
        </div>
        <button
          onClick={() => {
            handleCopy(`${issue.file}:${String(issue.line ?? 1)}`);
          }}
          className="p-2 rounded hover:bg-dark-700 text-dark-500 hover:text-dark-300 transition-colors"
          title="Copy file path"
        >
          {copied ? <CheckCheck className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>

      {/* Code Context */}
      {(issue.context !== undefined || contextData?.context !== undefined) && (
        <div>
          <h3 className="text-sm font-medium text-dark-300 mb-2 flex items-center gap-2">
            <Code2 className="h-4 w-4" />
            Code Context
          </h3>
          <pre className="rounded-lg bg-dark-900 p-4 text-sm font-mono text-dark-200 overflow-x-auto border border-dark-700 leading-relaxed">
            {contextData?.context ?? issue.context}
          </pre>
        </div>
      )}

      {/* Suggested Fix */}
      {contextData?.suggestion !== undefined && (
        <div className="rounded-lg border border-success/30 bg-success/5 p-4">
          <h3 className="text-sm font-medium text-success flex items-center gap-2 mb-2">
            <Lightbulb className="h-4 w-4" />
            Suggested Fix
          </h3>
          <p className="text-sm text-dark-200 leading-relaxed">{contextData.suggestion}</p>
        </div>
      )}

      {/* Error Details (expandable for failed issues) */}
      {isFailed && hasErrorOutput && (
        <div className="rounded-lg border border-error/30 bg-error/5">
          <button
            type="button"
            onClick={() => { setShowErrorDetails(!showErrorDetails); }}
            className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-error hover:bg-error/10 transition-colors rounded-lg"
          >
            <span className="flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              Error Output
            </span>
            {showErrorDetails ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {showErrorDetails && (
            <div className="px-4 pb-4">
              <pre className="rounded-lg bg-dark-900 p-4 text-sm font-mono text-error/80 overflow-x-auto border border-error/20 max-h-[300px] overflow-y-auto leading-relaxed">
                {contextData?.context ?? issue.context}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Rule/Code Info */}
      {issue.code !== undefined && issue.code !== '' && (
        <div className="p-3 rounded-lg bg-dark-900 border border-dark-700">
          <span className="text-xs text-dark-500">Rule / Error Code</span>
          <p className="text-sm font-mono text-accent mt-1">{issue.code}</p>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-dark-300">Timeline</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-sm">
            <Clock className="h-4 w-4 text-dark-500" />
            <span className="text-dark-400">Created</span>
            <span className="text-dark-200">{new Date(issue.createdAt).toLocaleString()}</span>
          </div>
          {issue.resolvedAt !== undefined && (
            <div className="flex items-center gap-3 text-sm">
              <Check className="h-4 w-4 text-success" />
              <span className="text-dark-400">Resolved</span>
              <span className="text-dark-200">{new Date(issue.resolvedAt).toLocaleString()}</span>
            </div>
          )}
          {issue.commitId !== undefined && (
            <div className="flex items-center gap-3 text-sm">
              <GitCommit className="h-4 w-4 text-accent" />
              <span className="text-dark-400">Commit</span>
              <span className="font-mono text-accent">{issue.commitId}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {showActions && (isPending || canRetry) && (
        <div className="flex items-center gap-3 pt-4 border-t border-dark-700">
          {onApprove !== undefined && isPending && (
            <Button
              variant="primary"
              onClick={() => {
                onApprove(issue.id);
              }}
              leftIcon={<Check className="h-4 w-4" />}
            >
              Approve Fix
            </Button>
          )}
          {onReject !== undefined && isPending && (
            <Button
              variant="danger"
              onClick={() => {
                onReject(issue.id);
              }}
              leftIcon={<X className="h-4 w-4" />}
            >
              Reject
            </Button>
          )}
          {onSkip !== undefined && isPending && (
            <Button
              variant="ghost"
              onClick={() => {
                onSkip(issue.id);
              }}
              leftIcon={<SkipForward className="h-4 w-4" />}
            >
              Skip
            </Button>
          )}
          {canRetry && (
            <Button
              variant="outline"
              onClick={() => {
                onRetry(issue.id, issue.context);
              }}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Retry with Context
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
