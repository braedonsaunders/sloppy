import { useState, useEffect, useCallback, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Github,
  Search,
  Lock,
  Globe,
  GitFork,
  Star,
  Loader2,
  AlertTriangle,
  ChevronDown,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import Input from './Input';
import Select from './Select';
import Badge from './Badge';
import { api, type GitHubRepository } from '@/lib/api';

export interface GitHubRepoSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (repo: GitHubRepository, branch: string) => void;
}

export default function GitHubRepoSelector({
  isOpen,
  onClose,
  onSelect,
}: GitHubRepoSelectorProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepository | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all');
  const [page, setPage] = useState(1);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => { clearTimeout(timer); };
  }, [searchQuery]);

  // Fetch GitHub connection status
  const { data: githubStatus } = useQuery({
    queryKey: ['github', 'status'],
    queryFn: () => api.github.status(),
    enabled: isOpen,
  });

  // Fetch repositories
  const {
    data: repoData,
    isLoading: isLoadingRepos,
    error: repoError,
    refetch: refetchRepos,
  } = useQuery({
    queryKey: ['github', 'repositories', { page, visibility, search: debouncedSearch }],
    queryFn: () => api.github.listRepositories({
      page,
      perPage: 20,
      sort: 'updated',
      visibility,
      search: debouncedSearch !== '' ? debouncedSearch : undefined,
    }),
    enabled: isOpen && githubStatus?.connected === true,
  });

  // Fetch branches when a repo is selected
  const {
    data: branchData,
    isLoading: isLoadingBranches,
  } = useQuery({
    queryKey: ['github', 'branches', selectedRepo?.fullName],
    queryFn: () => {
      if (!selectedRepo) {return { branches: [] };}
      const [owner, repo] = selectedRepo.fullName.split('/');
      return api.github.listBranches(owner, repo);
    },
    enabled: selectedRepo !== null,
  });

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setDebouncedSearch('');
      setSelectedRepo(null);
      setSelectedBranch('');
      setVisibility('all');
      setPage(1);
    }
  }, [isOpen]);

  // Set default branch when branches are loaded
  useEffect(() => {
    if (selectedRepo && branchData?.branches && !selectedBranch) {
      // Prefer the default branch, otherwise first branch
      const defaultBranch = branchData.branches.find(
        (b) => b.name === selectedRepo.defaultBranch
      );
      setSelectedBranch(defaultBranch?.name ?? branchData.branches[0]?.name ?? '');
    }
  }, [selectedRepo, branchData, selectedBranch]);

  const handleSelectRepo = useCallback((repo: GitHubRepository): void => {
    setSelectedRepo(repo);
    setSelectedBranch('');
  }, []);

  const handleConfirm = useCallback((): void => {
    if (selectedRepo && selectedBranch) {
      onSelect(selectedRepo, selectedBranch);
      onClose();
    }
  }, [selectedRepo, selectedBranch, onSelect, onClose]);

  const handleRetry = useCallback((): void => {
    void refetchRepos();
  }, [refetchRepos]);

  const handleLoadMore = useCallback((): void => {
    setPage((p) => p + 1);
  }, []);

  const isConnected = githubStatus?.connected === true;
  const repositories = repoData?.repositories ?? [];
  const hasMore = repoData?.hasMore ?? false;
  const hasError = repoError !== null;

  // Format relative time
  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {return 'today';}
    if (diffDays === 1) {return 'yesterday';}
    if (diffDays < 7) {return `${diffDays} days ago`;}
    if (diffDays < 30) {return `${Math.floor(diffDays / 7)} weeks ago`;}
    if (diffDays < 365) {return `${Math.floor(diffDays / 30)} months ago`;}
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  if (!isConnected) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Select GitHub Repository"
        description="Connect GitHub to access your repositories"
        size="lg"
      >
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Github className="h-12 w-12 text-dark-500 mb-4" />
          <h3 className="text-lg font-medium text-dark-200 mb-2">
            GitHub Not Connected
          </h3>
          <p className="text-dark-400 text-sm mb-4 max-w-sm">
            Connect your GitHub account in Settings to browse and select repositories.
          </p>
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Go to Settings
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Select GitHub Repository"
      description={`Signed in as ${githubStatus?.user?.login ?? 'unknown'}`}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!selectedRepo || !selectedBranch}
          >
            Select Repository
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Search and filters */}
        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              placeholder="Search repositories..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); }}
              leftIcon={<Search className="h-4 w-4" />}
            />
          </div>
          <Select
            options={[
              { value: 'all', label: 'All repos' },
              { value: 'public', label: 'Public' },
              { value: 'private', label: 'Private' },
            ]}
            value={visibility}
            onChange={(e) => { setVisibility(e.target.value as 'all' | 'public' | 'private'); }}
            className="w-32"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRetry}
            title="Refresh repositories"
            className="px-3"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Repository list */}
        <div className="h-80 overflow-y-auto rounded-lg border border-dark-600 bg-dark-900">
          {isLoadingRepos && page === 1 && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-dark-400" />
            </div>
          )}

          {hasError && (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
              <AlertTriangle className="h-8 w-8 text-error mb-2" />
              <p className="text-dark-300 text-sm">
                {repoError instanceof Error ? repoError.message : 'Failed to load repositories'}
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

          {!isLoadingRepos && !hasError && repositories.length === 0 && (
            <div className="flex items-center justify-center h-full text-dark-400 text-sm">
              {debouncedSearch !== '' ? 'No repositories found matching your search' : 'No repositories found'}
            </div>
          )}

          {!hasError && repositories.length > 0 && (
            <ul className="divide-y divide-dark-700">
              {repositories.map((repo) => (
                <li key={repo.id}>
                  <button
                    type="button"
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-dark-700 ${
                      selectedRepo?.id === repo.id
                        ? 'bg-accent/20 hover:bg-accent/30'
                        : ''
                    }`}
                    onClick={() => { handleSelectRepo(repo); }}
                  >
                    <Github
                      className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                        selectedRepo?.id === repo.id ? 'text-accent' : 'text-dark-400'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium truncate ${
                            selectedRepo?.id === repo.id ? 'text-accent' : 'text-dark-200'
                          }`}
                        >
                          {repo.fullName}
                        </span>
                        {repo.private ? (
                          <Lock className="h-3.5 w-3.5 text-dark-500 flex-shrink-0" />
                        ) : (
                          <Globe className="h-3.5 w-3.5 text-dark-500 flex-shrink-0" />
                        )}
                        {repo.fork && (
                          <GitFork className="h-3.5 w-3.5 text-dark-500 flex-shrink-0" />
                        )}
                      </div>
                      {repo.description && (
                        <p className="text-sm text-dark-400 truncate mt-0.5">
                          {repo.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-1 text-xs text-dark-500">
                        {repo.language && (
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-accent" />
                            {repo.language}
                          </span>
                        )}
                        {repo.stargazersCount > 0 && (
                          <span className="flex items-center gap-1">
                            <Star className="h-3 w-3" />
                            {repo.stargazersCount}
                          </span>
                        )}
                        <span>Updated {formatRelativeTime(repo.updatedAt)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}

              {/* Load more */}
              {hasMore && (
                <li className="p-3 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLoadMore}
                    isLoading={isLoadingRepos && page > 1}
                    leftIcon={<ChevronDown className="h-4 w-4" />}
                  >
                    Load more repositories
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Selected repo and branch */}
        {selectedRepo && (
          <div className="rounded-lg border border-dark-600 bg-dark-850 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Github className="h-5 w-5 text-accent" />
                <span className="font-medium text-dark-200">{selectedRepo.fullName}</span>
                <Badge variant={selectedRepo.private ? 'neutral' : 'success'} size="sm">
                  {selectedRepo.private ? 'Private' : 'Public'}
                </Badge>
              </div>
              <a
                href={selectedRepo.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-dark-400 hover:text-dark-200 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-sm text-dark-400 whitespace-nowrap">Branch:</label>
              {isLoadingBranches ? (
                <div className="flex items-center gap-2 text-dark-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading branches...</span>
                </div>
              ) : (
                <Select
                  options={
                    branchData?.branches.map((b) => ({
                      value: b.name,
                      label: `${b.name}${b.name === selectedRepo.defaultBranch ? ' (default)' : ''}${b.protected ? ' (protected)' : ''}`,
                    })) ?? []
                  }
                  value={selectedBranch}
                  onChange={(e) => { setSelectedBranch(e.target.value); }}
                  className="flex-1"
                />
              )}
            </div>

            <p className="text-xs text-dark-500 mt-2">
              Clone URL: <code className="bg-dark-700 px-1 py-0.5 rounded text-dark-300">{selectedRepo.cloneUrl}</code>
            </p>
          </div>
        )}

        {/* Help text */}
        <p className="text-xs text-dark-500">
          Select a repository and branch. The repository will be cloned to a local working directory.
        </p>
      </div>
    </Modal>
  );
}
