import type { JSX } from 'react';
import { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  Image,
  Settings,
  AlertCircle,
} from 'lucide-react';
import type { FileTreeNode } from '@/lib/api';

interface FileTreeProps {
  tree: FileTreeNode[];
  onFileSelect?: (path: string) => void;
  selectedFile?: string;
  issueCountByFile?: Record<string, number>;
}

export default function FileTree({ tree, onFileSelect, selectedFile, issueCountByFile }: FileTreeProps): JSX.Element {
  return (
    <div className="text-sm font-mono">
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          onFileSelect={onFileSelect}
          selectedFile={selectedFile}
          issueCountByFile={issueCountByFile}
        />
      ))}
    </div>
  );
}

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  onFileSelect?: (path: string) => void;
  selectedFile?: string;
  issueCountByFile?: Record<string, number>;
}

function TreeNode({ node, depth, onFileSelect, selectedFile, issueCountByFile }: TreeNodeProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(depth < 2);
  const issueCount = issueCountByFile?.[node.path] ?? 0;
  const isSelected = selectedFile === node.path;

  const getFileIcon = (name: string): typeof File => {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts': case 'tsx': case 'js': case 'jsx': case 'py': case 'go': case 'rs':
      case 'java': case 'rb': case 'php': case 'c': case 'cpp': case 'swift':
        return FileCode;
      case 'md': case 'txt': case 'rst':
        return FileText;
      case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'ico':
        return Image;
      case 'json': case 'yaml': case 'yml': case 'toml': case 'ini':
        return Settings;
      default:
        return File;
    }
  };

  if (node.type === 'directory') {
    // Count total issues in directory
    const dirIssues = issueCountByFile
      ? Object.entries(issueCountByFile)
          .filter(([path]) => path.startsWith(node.path + '/'))
          .reduce((sum, [, count]) => sum + count, 0)
      : 0;

    return (
      <div>
        <button
          type="button"
          onClick={() => { setIsOpen(!isOpen); }}
          className="flex items-center gap-1 w-full px-1 py-0.5 rounded hover:bg-dark-700/50 text-dark-300 hover:text-dark-100 transition-colors"
          style={{ paddingLeft: `${String(depth * 16 + 4)}px` }}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-dark-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-dark-500" />
          )}
          {isOpen ? (
            <FolderOpen className="h-4 w-4 flex-shrink-0 text-accent" />
          ) : (
            <Folder className="h-4 w-4 flex-shrink-0 text-accent" />
          )}
          <span className="truncate">{node.name}</span>
          {dirIssues > 0 && (
            <span className="ml-auto flex-shrink-0 px-1.5 py-0.5 rounded-full bg-error/10 text-error text-[10px] font-medium">
              {dirIssues}
            </span>
          )}
        </button>
        {isOpen && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                onFileSelect={onFileSelect}
                selectedFile={selectedFile}
                issueCountByFile={issueCountByFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const FileIcon = getFileIcon(node.name);

  return (
    <button
      type="button"
      onClick={() => onFileSelect?.(node.path)}
      className={`flex items-center gap-1.5 w-full px-1 py-0.5 rounded transition-colors ${
        isSelected
          ? 'bg-accent/10 text-accent'
          : 'text-dark-400 hover:bg-dark-700/50 hover:text-dark-200'
      }`}
      style={{ paddingLeft: `${String(depth * 16 + 20)}px` }}
    >
      <FileIcon className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="truncate">{node.name}</span>
      {issueCount > 0 && (
        <span className="ml-auto flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-error/10 text-error text-[10px] font-medium">
          <AlertCircle className="h-2.5 w-2.5" />
          {issueCount}
        </span>
      )}
      {node.size !== undefined && node.size > 0 && (
        <span className="ml-1 text-[10px] text-dark-600 flex-shrink-0">
          {node.size > 1024 ? `${(node.size / 1024).toFixed(0)}KB` : `${String(node.size)}B`}
        </span>
      )}
    </button>
  );
}

export { FileTree };
