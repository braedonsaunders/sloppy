import type { JSX } from 'react';
import { useState, useMemo } from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { twMerge } from 'tailwind-merge';
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import Button from './Button';

export interface DiffViewerProps {
  oldValue: string;
  newValue: string;
  oldTitle?: string;
  newTitle?: string;
  splitView?: boolean;
  showDiffOnly?: boolean;
  language?: string;
  className?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  maxHeight?: string;
}

// Custom styles for dark theme
const diffStyles = {
  variables: {
    dark: {
      diffViewerBackground: '#202123',
      diffViewerColor: '#e5e5e5',
      addedBackground: '#1a3a2a',
      addedColor: '#86efac',
      removedBackground: '#3a1a1a',
      removedColor: '#fca5a5',
      wordAddedBackground: '#166534',
      wordRemovedBackground: '#991b1b',
      addedGutterBackground: '#14532d',
      removedGutterBackground: '#7f1d1d',
      gutterBackground: '#343541',
      gutterBackgroundDark: '#2d2d3a',
      highlightBackground: '#4a4a5a',
      highlightGutterBackground: '#4a4a5a',
      codeFoldGutterBackground: '#343541',
      codeFoldBackground: '#343541',
      emptyLineBackground: '#202123',
      gutterColor: '#6e6e80',
      addedGutterColor: '#86efac',
      removedGutterColor: '#fca5a5',
      codeFoldContentColor: '#8e8ea0',
      diffViewerTitleBackground: '#343541',
      diffViewerTitleColor: '#e5e5e5',
      diffViewerTitleBorderColor: '#4a4a5a',
    },
  },
  line: {
    padding: '4px 8px',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '13px',
    lineHeight: '1.5',
  },
  contentText: {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '13px',
  },
  gutter: {
    padding: '4px 12px',
    minWidth: '40px',
  },
  marker: {
    padding: '4px 8px',
  },
  codeFold: {
    fontSize: '12px',
    padding: '4px 8px',
  },
  titleBlock: {
    padding: '8px 12px',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '12px',
  },
};

export default function DiffViewer({
  oldValue,
  newValue,
  oldTitle = 'Original',
  newTitle = 'Modified',
  splitView = true,
  showDiffOnly = true,
  language: _language,
  className,
  collapsible = false,
  defaultExpanded = true,
  maxHeight = '500px',
}: DiffViewerProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState<'old' | 'new' | null>(null);

  const hasChanges = useMemo(() => oldValue !== newValue, [oldValue, newValue]);

  const handleCopy = (content: string, type: 'old' | 'new'): void => {
    void navigator.clipboard.writeText(content);
    setCopied(type);
    setTimeout(() => {
      setCopied(null);
    }, 2000);
  };

  if (!hasChanges) {
    return (
      <div
        className={twMerge(
          'rounded-lg border border-dark-700 bg-dark-800 p-4 text-center text-dark-400',
          className
        )}
      >
        No changes detected
      </div>
    );
  }

  return (
    <div
      className={twMerge(
        'rounded-lg border border-dark-700 bg-dark-900 overflow-hidden',
        className
      )}
    >
      {/* Header */}
      {collapsible && (
        <button
          onClick={() => {
            setIsExpanded(!isExpanded);
          }}
          className="flex w-full items-center justify-between px-4 py-3 bg-dark-800 hover:bg-dark-700 transition-colors"
        >
          <span className="text-sm font-medium text-dark-200">Diff View</span>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-dark-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-dark-400" />
          )}
        </button>
      )}

      {/* Diff Content */}
      {(!collapsible || isExpanded) && (
        <div className="relative">
          {/* Copy buttons */}
          <div className="absolute right-2 top-2 z-10 flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                handleCopy(oldValue, 'old');
              }}
              className="h-7 px-2"
              title="Copy original"
            >
              {copied === 'old' ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                handleCopy(newValue, 'new');
              }}
              className="h-7 px-2"
              title="Copy modified"
            >
              {copied === 'new' ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          {/* Diff viewer */}
          <div
            className="overflow-auto"
            style={{ maxHeight }}
          >
            <ReactDiffViewer
              oldValue={oldValue}
              newValue={newValue}
              leftTitle={oldTitle}
              rightTitle={newTitle}
              splitView={splitView}
              showDiffOnly={showDiffOnly}
              useDarkTheme={true}
              styles={diffStyles}
              compareMethod={DiffMethod.WORDS}
              extraLinesSurroundingDiff={3}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Simplified inline diff for smaller changes
export interface InlineDiffProps {
  oldValue: string;
  newValue: string;
  className?: string;
}

export function InlineDiff({ oldValue, newValue, className }: InlineDiffProps): JSX.Element {
  if (oldValue === newValue) {
    return (
      <code className={twMerge('text-dark-300 font-mono text-sm', className)}>
        {oldValue}
      </code>
    );
  }

  return (
    <span className={twMerge('font-mono text-sm', className)}>
      <span className="bg-error/20 text-error line-through">{oldValue}</span>
      <span className="mx-1 text-dark-500">→</span>
      <span className="bg-success/20 text-success">{newValue}</span>
    </span>
  );
}
