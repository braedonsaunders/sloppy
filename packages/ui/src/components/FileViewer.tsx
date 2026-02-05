import type { JSX } from 'react';
import { useState, useEffect } from 'react';
import { FileCode, Copy, Check, AlertCircle, Wrench } from 'lucide-react';
import Button from '@/components/Button';
import { api } from '@/lib/api';

interface FileViewerProps {
  filePath: string;
  repoPath: string;
  issues?: Array<{
    id: string;
    line?: number;
    severity: string;
    message: string;
    status: string;
  }>;
  onFixFile?: (filePath: string) => void;
  onFixIssue?: (issueId: string) => void;
}

export default function FileViewer({
  filePath,
  repoPath,
  issues = [],
  onFixFile,
  onFixIssue,
}: FileViewerProps): JSX.Element {
  const [content, setContent] = useState<string | null>(null);
  const [language, setLanguage] = useState('plaintext');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const fullPath = filePath.startsWith('/') ? filePath : `${repoPath}/${filePath}`;

    api.fileTree.readFile(fullPath)
      .then((result) => {
        setContent(result.content);
        setLanguage(result.language);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load file');
        setLoading(false);
      });
  }, [filePath, repoPath]);

  const issuesByLine = new Map<number, typeof issues>();
  for (const issue of issues) {
    if (issue.line) {
      const existing = issuesByLine.get(issue.line) ?? [];
      existing.push(issue);
      issuesByLine.set(issue.line, existing);
    }
  }

  const handleCopy = (): void => {
    if (content) {
      void navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-dark-400">
        <FileCode className="h-5 w-5 animate-pulse mr-2" />
        Loading file...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-error">
        <AlertCircle className="h-5 w-5 mr-2" />
        {error}
      </div>
    );
  }

  const lines = content?.split('\n') ?? [];

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-dark-800 border-b border-dark-700">
        <div className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-accent" />
          <span className="text-sm font-mono text-dark-200">{filePath}</span>
          <span className="text-xs text-dark-500">{language}</span>
          {issues.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-error/10 text-error text-[10px] font-medium">
              {issues.length} issues
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onFixFile && issues.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onFixFile(filePath)}
              leftIcon={<Wrench className="h-3 w-3" />}
            >
              Fix All
            </Button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-dark-700 text-dark-400 hover:text-dark-200 transition-colors"
          >
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Code Content */}
      <div className="overflow-auto max-h-[600px]">
        <table className="w-full">
          <tbody>
            {lines.map((line, index) => {
              const lineNum = index + 1;
              const lineIssues = issuesByLine.get(lineNum);
              const hasIssue = lineIssues && lineIssues.length > 0;
              const severityBg = hasIssue
                ? lineIssues[0].severity === 'error'
                  ? 'bg-error/5'
                  : lineIssues[0].severity === 'warning'
                  ? 'bg-warning/5'
                  : 'bg-accent/5'
                : '';

              return (
                <tr key={lineNum} className={`group ${severityBg} hover:bg-dark-800/50`}>
                  <td className="select-none text-right pr-3 pl-4 py-0 text-dark-600 text-xs font-mono w-12 align-top">
                    {lineNum}
                  </td>
                  <td className="relative">
                    <pre className="text-xs font-mono text-dark-200 py-0 pr-4 whitespace-pre overflow-x-auto">
                      <code>{line || ' '}</code>
                    </pre>
                    {hasIssue && lineIssues.map((issue) => (
                      <div
                        key={issue.id}
                        className="flex items-center gap-2 pl-2 py-1 text-xs border-l-2 border-error ml-1 mb-1"
                      >
                        <AlertCircle className="h-3 w-3 text-error flex-shrink-0" />
                        <span className="text-error/80">{issue.message}</span>
                        {onFixIssue && issue.status === 'detected' && (
                          <button
                            type="button"
                            onClick={() => onFixIssue(issue.id)}
                            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-medium hover:bg-accent/20 transition-colors"
                          >
                            <Wrench className="h-2.5 w-2.5" />
                            Fix
                          </button>
                        )}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { FileViewer };
