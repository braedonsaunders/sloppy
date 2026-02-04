import { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  Zap,
  Clock,
  ArrowUp,
  ArrowDown,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Cpu,
} from 'lucide-react';
import Badge from './Badge';

export interface LLMRequest {
  id: string;
  status: 'pending' | 'streaming' | 'completed' | 'failed';
  model: string;
  provider: string;
  type: 'analyze' | 'fix' | 'review' | 'test' | 'other';
  prompt?: string;
  response?: string;
  inputTokens?: number;
  outputTokens?: number;
  duration?: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface LLMRequestPanelProps {
  requests: LLMRequest[];
  activeRequest?: LLMRequest;
  className?: string;
}

const typeLabels: Record<LLMRequest['type'], string> = {
  analyze: 'Analyzing',
  fix: 'Fixing',
  review: 'Reviewing',
  test: 'Testing',
  other: 'Processing',
};

const typeColors: Record<LLMRequest['type'], string> = {
  analyze: 'bg-accent/10 text-accent',
  fix: 'bg-warning/10 text-warning',
  review: 'bg-purple-400/10 text-purple-400',
  test: 'bg-success/10 text-success',
  other: 'bg-dark-600 text-dark-300',
};

export default function LLMRequestPanel({
  requests,
  activeRequest,
  className,
}: LLMRequestPanelProps) {
  const completedRequests = requests.filter((r) => r.status === 'completed');
  const totalTokens = requests.reduce(
    (acc, r) => acc + (r.inputTokens || 0) + (r.outputTokens || 0),
    0
  );
  const avgDuration =
    completedRequests.length > 0
      ? completedRequests.reduce((acc, r) => acc + (r.duration || 0), 0) /
        completedRequests.length
      : 0;

  return (
    <div
      className={twMerge(
        'rounded-xl border border-dark-700 bg-dark-800 overflow-hidden',
        className
      )}
    >
      {/* Header with stats */}
      <div className="p-4 border-b border-dark-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-dark-200 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-accent" />
            LLM Requests
          </h3>
          {activeRequest && (
            <Badge variant="info" className="animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              Active
            </Badge>
          )}
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <p className="text-lg font-semibold text-dark-100">{requests.length}</p>
            <p className="text-xs text-dark-500">Total</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-success">{completedRequests.length}</p>
            <p className="text-xs text-dark-500">Success</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-dark-100">
              {(totalTokens / 1000).toFixed(1)}k
            </p>
            <p className="text-xs text-dark-500">Tokens</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-dark-100">
              {(avgDuration / 1000).toFixed(1)}s
            </p>
            <p className="text-xs text-dark-500">Avg Time</p>
          </div>
        </div>
      </div>

      {/* Active Request */}
      {activeRequest && (
        <div className="p-4 bg-accent/5 border-b border-dark-700">
          <ActiveRequestCard request={activeRequest} />
        </div>
      )}

      {/* Request History */}
      <div className="max-h-[300px] overflow-y-auto">
        {requests.length === 0 ? (
          <div className="p-6 text-center">
            <MessageSquare className="h-8 w-8 text-dark-600 mx-auto mb-2" />
            <p className="text-sm text-dark-500">No LLM requests yet</p>
          </div>
        ) : (
          <div className="divide-y divide-dark-700">
            {requests.slice().reverse().map((request) => (
              <RequestRow key={request.id} request={request} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ActiveRequestCardProps {
  request: LLMRequest;
}

function ActiveRequestCard({ request }: ActiveRequestCardProps) {
  const elapsed = Date.now() - new Date(request.startedAt).getTime();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={clsx('p-1.5 rounded', typeColors[request.type])}>
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-dark-100">
              {typeLabels[request.type]}
            </p>
            <p className="text-xs text-dark-400">
              {request.provider} / {request.model}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-mono text-accent">
            {(elapsed / 1000).toFixed(1)}s
          </p>
          <p className="text-xs text-dark-500">elapsed</p>
        </div>
      </div>

      {/* Streaming indicator */}
      {request.status === 'streaming' && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-dark-700 rounded-full overflow-hidden">
            <div className="h-full bg-accent animate-pulse-width rounded-full" />
          </div>
          <span className="text-xs text-dark-400">Streaming response...</span>
        </div>
      )}

      {/* Token counts if available */}
      {(request.inputTokens || request.outputTokens) && (
        <div className="flex items-center gap-4 text-xs">
          {request.inputTokens && (
            <div className="flex items-center gap-1 text-dark-400">
              <ArrowUp className="h-3 w-3" />
              <span>{request.inputTokens.toLocaleString()} in</span>
            </div>
          )}
          {request.outputTokens && (
            <div className="flex items-center gap-1 text-dark-400">
              <ArrowDown className="h-3 w-3" />
              <span>{request.outputTokens.toLocaleString()} out</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface RequestRowProps {
  request: LLMRequest;
}

function RequestRow({ request }: RequestRowProps) {
  const [expanded, setExpanded] = useState(false);

  const StatusIcon =
    request.status === 'completed'
      ? CheckCircle
      : request.status === 'failed'
      ? XCircle
      : request.status === 'streaming'
      ? Loader2
      : Clock;

  const statusColor =
    request.status === 'completed'
      ? 'text-success'
      : request.status === 'failed'
      ? 'text-error'
      : 'text-dark-400';

  const time = new Date(request.startedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center gap-3 hover:bg-dark-700/50 transition-colors text-left"
      >
        <StatusIcon
          className={clsx(
            'h-4 w-4 flex-shrink-0',
            statusColor,
            request.status === 'streaming' && 'animate-spin'
          )}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-dark-200">
              {typeLabels[request.type]}
            </span>
            <span className="text-xs text-dark-500">{request.model}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-dark-500">
          {request.duration && (
            <span className="font-mono">{(request.duration / 1000).toFixed(1)}s</span>
          )}
          {(request.inputTokens || request.outputTokens) && (
            <span className="font-mono">
              {((request.inputTokens || 0) + (request.outputTokens || 0)).toLocaleString()} tok
            </span>
          )}
          <span>{time}</span>
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-dark-700/50">
          {/* Token details */}
          <div className="grid grid-cols-2 gap-4 pt-3">
            <div className="flex items-center gap-2">
              <ArrowUp className="h-3.5 w-3.5 text-dark-500" />
              <span className="text-xs text-dark-400">Input:</span>
              <span className="text-xs font-mono text-dark-200">
                {request.inputTokens?.toLocaleString() || '—'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ArrowDown className="h-3.5 w-3.5 text-dark-500" />
              <span className="text-xs text-dark-400">Output:</span>
              <span className="text-xs font-mono text-dark-200">
                {request.outputTokens?.toLocaleString() || '—'}
              </span>
            </div>
          </div>

          {/* Prompt preview */}
          {request.prompt && (
            <div>
              <p className="text-xs text-dark-500 mb-1">Prompt:</p>
              <pre className="text-xs font-mono text-dark-300 bg-dark-900 rounded p-2 max-h-24 overflow-auto whitespace-pre-wrap">
                {request.prompt.slice(0, 500)}
                {request.prompt.length > 500 && '...'}
              </pre>
            </div>
          )}

          {/* Response preview */}
          {request.response && (
            <div>
              <p className="text-xs text-dark-500 mb-1">Response:</p>
              <pre className="text-xs font-mono text-dark-300 bg-dark-900 rounded p-2 max-h-24 overflow-auto whitespace-pre-wrap">
                {request.response.slice(0, 500)}
                {request.response.length > 500 && '...'}
              </pre>
            </div>
          )}

          {/* Error */}
          {request.error && (
            <div className="text-xs text-error bg-error/10 rounded p-2">
              {request.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Compact version for sidebar
export interface LLMStatusIndicatorProps {
  activeRequest?: LLMRequest;
  totalRequests: number;
  className?: string;
}

export function LLMStatusIndicator({
  activeRequest,
  totalRequests,
  className,
}: LLMStatusIndicatorProps) {
  return (
    <div className={twMerge('flex items-center gap-2', className)}>
      {activeRequest ? (
        <>
          <div className="relative">
            <Cpu className="h-4 w-4 text-accent" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-accent rounded-full animate-pulse" />
          </div>
          <span className="text-sm text-dark-300 truncate">
            {typeLabels[activeRequest.type]}...
          </span>
        </>
      ) : (
        <>
          <Cpu className="h-4 w-4 text-dark-500" />
          <span className="text-sm text-dark-500">
            {totalRequests} requests
          </span>
        </>
      )}
    </div>
  );
}
