import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FolderOpen,
  GitBranch,
  Clock,
  Shield,
  Play,
  AlertTriangle,
  Terminal,
  CheckSquare,
  FolderSearch,
  Github,
  Lock,
  ExternalLink,
} from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Badge from '@/components/Badge';
import FileBrowser from '@/components/FileBrowser';
import GitHubRepoSelector from '@/components/GitHubRepoSelector';
import { useSession } from '@/hooks/useSession';
import { api, type CreateSessionRequest, type SessionConfig, type GitHubRepository } from '@/lib/api';

// Focus areas for LLM-orchestrated analysis
// The LLM always orchestrates - these tell it what to prioritize
const FOCUS_AREAS = [
  { id: 'lint', label: 'Lint & Formatting', description: 'ESLint, Prettier, code style' },
  { id: 'type', label: 'Type Safety', description: 'TypeScript errors and type issues' },
  { id: 'security', label: 'Security', description: 'Vulnerabilities, injection risks, auth issues' },
  { id: 'test', label: 'Testing', description: 'Test coverage, failing tests, test quality' },
  { id: 'bugs', label: 'Bug Detection', description: 'Logic errors, edge cases, race conditions' },
  { id: 'performance', label: 'Performance', description: 'Memory leaks, slow operations, optimization' },
  { id: 'maintainability', label: 'Maintainability', description: 'Code smells, complexity, duplication' },
  { id: 'stubs', label: 'Completeness', description: 'TODOs, stubs, incomplete implementations' },
];

export default function NewSession(): JSX.Element {
  const navigate = useNavigate();
  const { createSession, isCreating } = useSession();

  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settings.get(),
  });

  const { data: githubStatus } = useQuery({
    queryKey: ['github', 'status'],
    queryFn: () => api.github.status(),
  });

  // Form state
  const [repoPath, setRepoPath] = useState('');
  const [branch, setBranch] = useState('main');
  const [repoType, setRepoType] = useState<'local' | 'git' | 'github'>('local');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [maxTime, setMaxTime] = useState<string>('');
  const [strictness, setStrictness] = useState<'low' | 'medium' | 'high'>('medium');
  const [focusAreas, setFocusAreas] = useState<string[]>(['lint', 'type', 'security', 'bugs']);
  const [approvalMode, setApprovalMode] = useState(false);
  const [testCommand, setTestCommand] = useState('');
  const [lintCommand, setLintCommand] = useState('');
  const [buildCommand, setBuildCommand] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showGitHubSelector, setShowGitHubSelector] = useState(false);
  const [selectedGitHubRepo, setSelectedGitHubRepo] = useState<GitHubRepository | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Get configured providers
  const configuredProviders = providers?.filter((p) => p.configured) ?? [];
  const selectedProvider = providers?.find((p) => p.id === provider);

  // Apply defaults from settings
  useState(() => {
    if (settings !== undefined) {
      const s = settings;
      if (typeof s.defaultProvider === 'string' && s.defaultProvider !== '') {setProvider(s.defaultProvider);}
      if (typeof s.defaultModel === 'string' && s.defaultModel !== '') {setModel(s.defaultModel);}
      if (typeof s.defaultStrictness === 'string' && s.defaultStrictness !== '') {setStrictness(s.defaultStrictness as 'low' | 'medium' | 'high');}
      if (typeof s.defaultMaxTime === 'number') {setMaxTime(String(s.defaultMaxTime));}
      if (typeof s.approvalModeDefault === 'boolean') {setApprovalMode(s.approvalModeDefault);}
    }
  });

  const toggleFocusArea = (area: string): void => {
    setFocusAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  };

  const handleGitHubRepoSelect = (repo: GitHubRepository, selectedBranch: string): void => {
    setSelectedGitHubRepo(repo);
    setRepoPath(repo.cloneUrl);
    setBranch(selectedBranch);
    setShowGitHubSelector(false);
  };

  const isGitHubConnected = githubStatus?.connected === true;

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);

    if (repoPath === '') {
      setError('Please enter a repository path');
      return;
    }

    if (provider === '') {
      setError('Please select a provider');
      return;
    }

    if (focusAreas.length === 0) {
      setError('Please select at least one focus area');
      return;
    }

    const config: Partial<SessionConfig> = {
      maxTime: maxTime !== '' ? parseInt(maxTime) * 60 : undefined, // Convert to seconds
      strictness,
      issueTypes: focusAreas, // Focus areas are passed as issueTypes to the backend
      approvalMode,
      testCommand: testCommand !== '' ? testCommand : undefined,
      lintCommand: lintCommand !== '' ? lintCommand : undefined,
      buildCommand: buildCommand !== '' ? buildCommand : undefined,
    };

    const sessionRequest: CreateSessionRequest = {
      repoPath: repoType === 'git' ? repoPath : repoPath,
      branch: branch !== '' ? branch : undefined,
      provider,
      model: model !== '' ? model : undefined,
      config,
    };

    createSession(sessionRequest).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-dark-100">New Session</h1>
        <p className="mt-1 text-dark-400">
          Configure and start a new code quality improvement session
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Repository Section */}
        <section className="rounded-xl border border-dark-700 bg-dark-800 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FolderOpen className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-medium text-dark-100">Repository</h2>
          </div>

          {/* Repo Type Toggle */}
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => { setRepoType('local'); setSelectedGitHubRepo(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border transition-colors ${
                repoType === 'local'
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-dark-600 text-dark-400 hover:border-dark-500'
              }`}
            >
              <FolderOpen className="h-4 w-4" />
              Local Path
            </button>
            <button
              type="button"
              onClick={() => { setRepoType('git'); setSelectedGitHubRepo(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border transition-colors ${
                repoType === 'git'
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-dark-600 text-dark-400 hover:border-dark-500'
              }`}
            >
              <GitBranch className="h-4 w-4" />
              Git URL
            </button>
            <button
              type="button"
              onClick={() => { setRepoType('github'); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border transition-colors ${
                repoType === 'github'
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-dark-600 text-dark-400 hover:border-dark-500'
              }`}
            >
              <Github className="h-4 w-4" />
              GitHub
              {isGitHubConnected && (
                <span className="w-2 h-2 rounded-full bg-success" />
              )}
            </button>
          </div>

          {repoType === 'local' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="/path/to/your/project"
                  value={repoPath}
                  onChange={(e) => { setRepoPath(e.target.value); }}
                  leftIcon={<FolderOpen className="h-4 w-4" />}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setShowFileBrowser(true); }}
                leftIcon={<FolderSearch className="h-4 w-4" />}
              >
                Browse
              </Button>
            </div>
          )}

          {repoType === 'git' && (
            <Input
              placeholder="https://github.com/user/repo.git"
              value={repoPath}
              onChange={(e) => { setRepoPath(e.target.value); }}
              leftIcon={<GitBranch className="h-4 w-4" />}
            />
          )}

          {repoType === 'github' && (
            <div className="space-y-4">
              {!isGitHubConnected ? (
                <div className="flex items-center gap-3 rounded-lg bg-warning/10 p-4 text-warning">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">GitHub not connected</p>
                    <p className="text-sm text-warning/80 mt-1">
                      Connect your GitHub account in{' '}
                      <button
                        type="button"
                        onClick={() => { navigate('/settings'); }}
                        className="underline hover:no-underline"
                      >
                        Settings
                      </button>{' '}
                      to browse your repositories.
                    </p>
                  </div>
                </div>
              ) : selectedGitHubRepo ? (
                <div className="rounded-lg border border-dark-600 bg-dark-700/50 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Github className="h-5 w-5 text-accent" />
                      <span className="font-medium text-dark-100">{selectedGitHubRepo.fullName}</span>
                      {selectedGitHubRepo.private && (
                        <Lock className="h-3.5 w-3.5 text-dark-400" />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={selectedGitHubRepo.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-dark-400 hover:text-dark-200 transition-colors"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => { setShowGitHubSelector(true); }}
                      >
                        Change
                      </Button>
                    </div>
                  </div>
                  {selectedGitHubRepo.description && (
                    <p className="text-sm text-dark-400 mb-2">{selectedGitHubRepo.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-dark-500">
                    <span>Branch: <code className="bg-dark-600 px-1.5 py-0.5 rounded text-dark-300">{branch}</code></span>
                    {selectedGitHubRepo.language && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-accent" />
                        {selectedGitHubRepo.language}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { setShowGitHubSelector(true); }}
                  leftIcon={<Github className="h-4 w-4" />}
                  className="w-full justify-center py-6"
                >
                  Select Repository from GitHub
                </Button>
              )}
            </div>
          )}
        </section>

        {/* Provider Section */}
        <section className="rounded-xl border border-dark-700 bg-dark-800 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-medium text-dark-100">AI Provider</h2>
          </div>

          {configuredProviders.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg bg-warning/10 p-4 text-warning">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-medium">No providers configured</p>
                <p className="text-sm text-warning/80 mt-1">
                  Please configure at least one AI provider in{' '}
                  <button
                    type="button"
                    onClick={() => { navigate('/settings'); }}
                    className="underline hover:no-underline"
                  >
                    Settings
                  </button>
                  .
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Provider"
                options={[
                  { value: '', label: 'Select provider...' },
                  ...configuredProviders.map((p) => ({
                    value: p.id,
                    label: p.name,
                  })),
                ]}
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel('');
                }}
              />

              <Select
                label="Model"
                options={[
                  { value: '', label: 'Default model' },
                  ...(selectedProvider?.models.map((m) => ({
                    value: m,
                    label: m,
                  })) ?? []),
                ]}
                value={model}
                onChange={(e) => { setModel(e.target.value); }}
                disabled={!provider}
              />
            </div>
          )}
        </section>

        {/* Configuration Section */}
        <section className="rounded-xl border border-dark-700 bg-dark-800 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-medium text-dark-100">Configuration</h2>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Input
              label="Max Time (minutes)"
              type="number"
              min={1}
              max={480}
              placeholder="No limit"
              value={maxTime}
              onChange={(e) => { setMaxTime(e.target.value); }}
              hint="Leave empty for no time limit"
            />

            <Select
              label="Strictness Level"
              options={[
                { value: 'low', label: 'Low - Quick fixes, fewer changes' },
                { value: 'medium', label: 'Medium - Balanced approach' },
                { value: 'high', label: 'High - Thorough, more changes' },
              ]}
              value={strictness}
              onChange={(e) => { setStrictness(e.target.value as 'low' | 'medium' | 'high'); }}
            />
          </div>

          {/* Focus Areas */}
          <div className="mt-6">
            <div className="mb-3">
              <label className="block text-sm font-medium text-dark-200">
                Focus Areas
              </label>
              <p className="text-xs text-dark-500 mt-1">
                The AI will orchestrate analysis using lint, tests, and deep code inspection based on these priorities
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {FOCUS_AREAS.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => { toggleFocusArea(area.id); }}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    focusAreas.includes(area.id)
                      ? 'border-accent bg-accent/10'
                      : 'border-dark-600 hover:border-dark-500'
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border ${
                      focusAreas.includes(area.id)
                        ? 'border-accent bg-accent text-white'
                        : 'border-dark-500'
                    }`}
                  >
                    {focusAreas.includes(area.id) && (
                      <CheckSquare className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p
                      className={`text-sm font-medium ${
                        focusAreas.includes(area.id) ? 'text-accent' : 'text-dark-200'
                      }`}
                    >
                      {area.label}
                    </p>
                    <p className="text-xs text-dark-500">{area.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Approval Mode */}
          <div className="mt-6 flex items-center gap-3">
            <input
              type="checkbox"
              id="approvalMode"
              checked={approvalMode}
              onChange={(e) => { setApprovalMode(e.target.checked); }}
              className="h-4 w-4 rounded border-dark-600 bg-dark-700 text-accent focus:ring-accent"
            />
            <label htmlFor="approvalMode" className="text-sm text-dark-200">
              Enable approval mode (require manual approval for each fix)
            </label>
          </div>
        </section>

        {/* Advanced Section */}
        <section className="rounded-xl border border-dark-700 bg-dark-800 overflow-hidden">
          <button
            type="button"
            onClick={() => { setShowAdvanced(!showAdvanced); }}
            className="flex w-full items-center justify-between p-6 text-left hover:bg-dark-750 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-accent" />
              <h2 className="text-lg font-medium text-dark-100">
                Advanced Settings
              </h2>
            </div>
            <Badge variant="neutral">Optional</Badge>
          </button>

          {showAdvanced && (
            <div className="px-6 pb-6 space-y-4 border-t border-dark-700 pt-4">
              <p className="text-sm text-dark-400 mb-4">
                Override auto-detected commands for your project
              </p>

              <Input
                label="Test Command"
                placeholder="npm test"
                value={testCommand}
                onChange={(e) => { setTestCommand(e.target.value); }}
                hint="Command to run tests"
              />

              <Input
                label="Lint Command"
                placeholder="npm run lint"
                value={lintCommand}
                onChange={(e) => { setLintCommand(e.target.value); }}
                hint="Command to run linting"
              />

              <Input
                label="Build Command"
                placeholder="npm run build"
                value={buildCommand}
                onChange={(e) => { setBuildCommand(e.target.value); }}
                hint="Command to build the project"
              />
            </div>
          )}
        </section>

        {/* Error Message */}
        {error !== null && (
          <div className="flex items-center gap-2 rounded-lg bg-error/10 p-4 text-error">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Submit Button */}
        <div className="flex items-center justify-end gap-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => { navigate('/'); }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={isCreating}
            disabled={!repoPath || !provider || configuredProviders.length === 0 || focusAreas.length === 0}
            leftIcon={<Play className="h-4 w-4" />}
          >
            Start Session
          </Button>
        </div>
      </form>

      {/* File Browser Modal */}
      <FileBrowser
        isOpen={showFileBrowser}
        onClose={() => { setShowFileBrowser(false); }}
        onSelect={(path) => { setRepoPath(path); }}
        initialPath={repoPath || undefined}
      />

      {/* GitHub Repo Selector Modal */}
      <GitHubRepoSelector
        isOpen={showGitHubSelector}
        onClose={() => { setShowGitHubSelector(false); }}
        onSelect={handleGitHubRepoSelect}
      />
    </div>
  );
}
