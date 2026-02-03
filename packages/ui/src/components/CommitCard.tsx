import { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  GitCommit,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  FileCode,
  Clock,
  Check,
} from 'lucide-react';
import Button from './Button';
import Badge from './Badge';
import DiffViewer from './DiffViewer';
import type { Commit } from '@/lib/api';

export interface CommitCardProps {
  commit: Commit;
  onRevert?: (id: string) => void;
  isReverting?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  showDiff?: boolean;
  className?: string;
}

export default function CommitCard({
  commit,
  onRevert,
  isReverting = false,
  isExpanded: controlledExpanded,
  onToggleExpand,
  showDiff = true,
  className,
}: CommitCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = controlledExpanded ?? internalExpanded;

  const handleToggle = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setInternalExpanded(!internalExpanded);
    }
  };

  const shortHash = commit.hash.substring(0, 7);
  const time = new Date(commit.createdAt).toLocaleString();

  return (
    <div
      className={twMerge(
        clsx(
          'rounded-lg border bg-dark-800 transition-all duration-200',
          commit.reverted
            ? 'border-error/30 bg-error/5 opacity-60'
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
        {/* Commit Icon */}
        <div
          className={clsx(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
            commit.reverted
              ? 'bg-error/10 text-error'
              : 'bg-success/10 text-success'
          )}
        >
          {commit.reverted ? (
            <RotateCcw className="h-4 w-4" />
          ) : (
            <GitCommit className="h-4 w-4" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm font-mono text-accent">{shortHash}</code>
            {commit.reverted && (
              <Badge variant="error" size="sm">
                Reverted
              </Badge>
            )}
            <Badge variant="neutral" size="sm">
              {commit.files.length} file{commit.files.length !== 1 ? 's' : ''}
            </Badge>
          </div>

          <p className="mt-2 text-sm text-dark-200">{commit.message}</p>

          <div className="mt-2 flex items-center gap-2 text-xs text-dark-400">
            <Clock className="h-3.5 w-3.5" />
            <span>{time}</span>
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
          {/* Changed Files */}
          <div>
            <h4 className="text-xs font-medium text-dark-400 mb-2">
              Changed Files
            </h4>
            <div className="space-y-1">
              {commit.files.map((file) => (
                <div
                  key={file}
                  className="flex items-center gap-2 text-sm text-dark-300"
                >
                  <FileCode className="h-3.5 w-3.5 text-dark-500" />
                  <span className="font-mono truncate">{file}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Resolved Issues */}
          {commit.issueIds.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-dark-400 mb-2">
                Resolved Issues
              </h4>
              <div className="flex flex-wrap gap-2">
                {commit.issueIds.map((issueId) => (
                  <Badge key={issueId} variant="success" size="sm">
                    <Check className="h-3 w-3" />
                    {issueId.substring(0, 8)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Diff Viewer */}
          {showDiff && commit.diff && (
            <div>
              <h4 className="text-xs font-medium text-dark-400 mb-2">
                Changes
              </h4>
              <DiffViewer
                oldValue=""
                newValue={commit.diff}
                oldTitle="Before"
                newTitle="After"
                splitView={false}
                collapsible
                defaultExpanded={false}
                maxHeight="400px"
              />
            </div>
          )}

          {/* Actions */}
          {onRevert && !commit.reverted && (
            <div className="flex items-center gap-2 pt-2 border-t border-dark-700">
              <Button
                variant="danger"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRevert(commit.id);
                }}
                isLoading={isReverting}
                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
              >
                Revert Commit
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Compact commit row for lists
export interface CommitRowProps {
  commit: Commit;
  onClick?: () => void;
  isSelected?: boolean;
  className?: string;
}

export function CommitRow({
  commit,
  onClick,
  isSelected = false,
  className,
}: CommitRowProps) {
  const shortHash = commit.hash.substring(0, 7);

  return (
    <button
      onClick={onClick}
      className={twMerge(
        clsx(
          'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
          isSelected
            ? 'bg-accent/10 border-l-2 border-accent'
            : 'hover:bg-dark-700/50',
          commit.reverted && 'opacity-60'
        ),
        className
      )}
    >
      <GitCommit
        className={clsx(
          'h-4 w-4 flex-shrink-0',
          commit.reverted ? 'text-error' : 'text-success'
        )}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="text-sm font-mono text-accent">{shortHash}</code>
          {commit.reverted && (
            <Badge variant="error" size="sm">
              Reverted
            </Badge>
          )}
        </div>
        <p className="text-sm text-dark-300 truncate">{commit.message}</p>
      </div>

      <Badge variant="neutral" size="sm">
        {commit.files.length}
      </Badge>
    </button>
  );
}
