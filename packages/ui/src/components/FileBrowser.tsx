import { useState, useEffect, useCallback, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Folder, FolderOpen, ArrowUp, Loader2, AlertTriangle, Home } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import { api } from '@/lib/api';

export interface FileBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export default function FileBrowser({
  isOpen,
  onClose,
  onSelect,
  initialPath,
}: FileBrowserProps): JSX.Element {
  const [currentPath, setCurrentPath] = useState<string | undefined>(initialPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Fetch directory contents
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['files', 'browse', currentPath],
    queryFn: () => api.files.browse(currentPath),
    enabled: isOpen,
    retry: false,
  });

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentPath(initialPath);
      setSelectedPath(null);
    }
  }, [isOpen, initialPath]);

  const handleNavigate = useCallback((path: string): void => {
    setCurrentPath(path);
    setSelectedPath(null);
  }, []);

  const handleGoUp = useCallback((): void => {
    const parentPath = data?.parentPath;
    if (parentPath !== null && parentPath !== undefined) {
      setCurrentPath(parentPath);
      setSelectedPath(null);
    }
  }, [data?.parentPath]);

  const handleGoHome = useCallback((): void => {
    setCurrentPath(undefined);
    setSelectedPath(null);
  }, []);

  const handleSelectDirectory = useCallback((path: string): void => {
    setSelectedPath(path);
  }, []);

  const handleDoubleClick = useCallback((path: string): void => {
    handleNavigate(path);
  }, [handleNavigate]);

  const handleConfirm = useCallback((): void => {
    const pathToSelect = selectedPath ?? data?.currentPath;
    if (pathToSelect !== undefined) {
      onSelect(pathToSelect);
      onClose();
    }
  }, [selectedPath, data?.currentPath, onSelect, onClose]);

  const handleRetry = useCallback((): void => {
    void refetch();
  }, [refetch]);

  // Filter to only show directories
  const directories = data?.entries.filter((e) => e.type === 'directory') ?? [];
  const hasData = data !== undefined;
  const hasError = error !== null;
  const hasNoError = !hasError;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Select Directory"
      description="Choose a project folder"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!hasData}
          >
            Select {selectedPath !== null ? 'Folder' : 'Current Directory'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Current path and navigation */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGoHome}
            title="Go to home directory"
            className="p-2"
          >
            <Home className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGoUp}
            disabled={data?.parentPath === null || data?.parentPath === undefined}
            title="Go up one level"
            className="p-2"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <div className="flex-1 rounded-lg bg-dark-700 px-3 py-2 text-sm text-dark-200 truncate font-mono">
            {data?.currentPath ?? 'Loading...'}
          </div>
        </div>

        {/* Directory listing */}
        <div className="h-72 overflow-y-auto rounded-lg border border-dark-600 bg-dark-900">
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-dark-400" />
            </div>
          )}

          {hasError && (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
              <AlertTriangle className="h-8 w-8 text-error mb-2" />
              <p className="text-dark-300 text-sm">
                {error instanceof Error ? error.message : 'Failed to load directory'}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRetry}
                className="mt-3"
              >
                Retry
              </Button>
            </div>
          )}

          {!isLoading && hasNoError && directories.length === 0 && (
            <div className="flex items-center justify-center h-full text-dark-400 text-sm">
              No subdirectories found
            </div>
          )}

          {!isLoading && hasNoError && directories.length > 0 && (
            <ul className="divide-y divide-dark-700">
              {directories.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-dark-700 ${
                      selectedPath === entry.path
                        ? 'bg-accent/20 hover:bg-accent/30'
                        : ''
                    }`}
                    onClick={() => { handleSelectDirectory(entry.path); }}
                    onDoubleClick={() => { handleDoubleClick(entry.path); }}
                  >
                    {selectedPath === entry.path ? (
                      <FolderOpen className="h-5 w-5 text-accent flex-shrink-0" />
                    ) : (
                      <Folder className="h-5 w-5 text-dark-400 flex-shrink-0" />
                    )}
                    <span
                      className={`flex-1 truncate ${
                        selectedPath === entry.path ? 'text-accent' : 'text-dark-200'
                      }`}
                    >
                      {entry.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Help text */}
        <p className="text-xs text-dark-500">
          Click to select a folder, double-click to navigate into it.
          Press "Select Current Directory" to use the directory shown above.
        </p>
      </div>
    </Modal>
  );
}
