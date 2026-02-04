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
} from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Badge from '@/components/Badge';
import FileBrowser from '@/components/FileBrowser';
import { useSession } from '@/hooks/useSession';
import { api, type CreateSessionRequest, type SessionConfig } from '@/lib/api';

const ISSUE_TYPES = [
  // Core static analysis
  { id: 'lint', label: 'Lint Issues', description: 'ESLint, Prettier violations', group: 'static' },
  { id: 'type', label: 'Type Errors', description: 'TypeScript type issues', group: 'static' },
  { id: 'security', label: 'Security Issues', description: 'Vulnerabilities and risks', group: 'static' },
  { id: 'test', label: 'Test Coverage', description: 'Missing or failing tests', group: 'static' },
  // AI-powered analysis
  { id: 'ai', label: 'AI Deep Analysis', description: 'LLM-powered: logic bugs, code smells, patterns', group: 'ai', featured: true },
  // Code quality
  { id: 'style', label: 'Code Style', description: 'Duplicates, dead code, formatting', group: 'quality' },
  { id: 'performance', label: 'Bug Detection', description: 'Potential bugs and edge cases', group: 'quality' },
  { id: 'stub', label: 'Stubs & TODOs', description: 'Incomplete implementations', group: 'quality' },
];

export default function NewSession() {
  const navigate = useNavigate();
  const { createSession, isCreating } = useSession();

  const { data: providers, isLoading: _isLoadingProviders } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settings.get(),
  });

  // Form state
  const [repoPath, setRepoPath] = useState('');
  const [branch, _setBranch] = useState('main');
  const [repoType, setRepoType] = useState<'local' | 'git'>('local');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [maxTime, setMaxTime] = useState<string>('');
  const [strictness, setStrictness] = useState<'low' | 'medium' | 'high'>('medium');
  const [issueTypes, setIssueTypes] = useState<string[]>(['lint', 'type', 'test']);
  const [approvalMode, setApprovalMode] = useState(false);
  const [testCommand, setTestCommand] = useState('');
  const [lintCommand, setLintCommand] = useState('');
  const [buildCommand, setBuildCommand] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get configured providers
  const configuredProviders = providers?.filter((p) => p.configured) || [];
  const selectedProvider = providers?.find((p) => p.id === provider);

  // Apply defaults from settings
  useState(() => {
    if (settings) {
      const s = settings as Record<string, unknown>;
      if (s.defaultProvider) setProvider(s.defaultProvider as string);
      if (s.defaultModel) setModel(s.defaultModel as string);
      if (s.defaultStrictness) setStrictness(s.defaultStrictness as 'low' | 'medium' | 'high');
      if (s.defaultMaxTime) setMaxTime(String(s.defaultMaxTime));
      if (s.approvalModeDefault) setApprovalMode(s.approvalModeDefault as boolean);
    }
  });

  const toggleIssueType = (type: string) => {
    setIssueTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!repoPath) {
      setError('Please enter a repository path');
      return;
    }

    if (!provider) {
      setError('Please select a provider');
      return;
    }

    if (issueTypes.length === 0) {
      setError('Please select at least one issue type');
      return;
    }

    try {
      const config: Partial<SessionConfig> = {
        maxTime: maxTime ? parseInt(maxTime) * 60 : undefined, // Convert to seconds
        strictness,
        issueTypes,
        approvalMode,
        testCommand: testCommand || undefined,
        lintCommand: lintCommand || undefined,
        buildCommand: buildCommand || undefined,
      };

      const request: CreateSessionRequest = {
        repoPath: repoType === 'git' ? repoPath : repoPath,
        branch: branch || undefined,
        provider,
        model: model || undefined,
        config,
      };

      await createSession(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
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
              onClick={() => setRepoType('local')}
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
              onClick={() => setRepoType('git')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border transition-colors ${
                repoType === 'git'
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-dark-600 text-dark-400 hover:border-dark-500'
              }`}
            >
              <GitBranch className="h-4 w-4" />
              Git URL
            </button>
          </div>

          {repoType === 'local' ? (
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="/path/to/your/project"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  leftIcon={<FolderOpen className="h-4 w-4" />}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowFileBrowser(true)}
                leftIcon={<FolderSearch className="h-4 w-4" />}
              >
                Browse
              </Button>
            </div>
          ) : (
            <Input
              placeholder="https://github.com/user/repo.git"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              leftIcon={<GitBranch className="h-4 w-4" />}
            />
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
                    onClick={() => navigate('/settings')}
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
                  })) || []),
                ]}
                value={model}
                onChange={(e) => setModel(e.target.value)}
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
              onChange={(e) => setMaxTime(e.target.value)}
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
              onChange={(e) => setStrictness(e.target.value as 'low' | 'medium' | 'high')}
            />
          </div>

          {/* Issue Types */}
          <div className="mt-6">
            <label className="mb-3 block text-sm font-medium text-dark-200">
              Issue Types to Fix
            </label>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ISSUE_TYPES.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => toggleIssueType(type.id)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    issueTypes.includes(type.id)
                      ? type.featured
                        ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30'
                        : 'border-accent bg-accent/10'
                      : type.featured
                        ? 'border-purple-500/50 hover:border-purple-500 bg-purple-500/5'
                        : 'border-dark-600 hover:border-dark-500'
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border ${
                      issueTypes.includes(type.id)
                        ? type.featured
                          ? 'border-purple-500 bg-purple-500 text-white'
                          : 'border-accent bg-accent text-white'
                        : type.featured
                          ? 'border-purple-500/50'
                          : 'border-dark-500'
                    }`}
                  >
                    {issueTypes.includes(type.id) && (
                      <CheckSquare className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={`text-sm font-medium ${
                          issueTypes.includes(type.id)
                            ? type.featured
                              ? 'text-purple-400'
                              : 'text-accent'
                            : type.featured
                              ? 'text-purple-300'
                              : 'text-dark-200'
                        }`}
                      >
                        {type.label}
                      </p>
                      {type.featured && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 bg-purple-500/20 px-1.5 py-0.5 rounded">
                          New
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-dark-500">{type.description}</p>
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
              onChange={(e) => setApprovalMode(e.target.checked)}
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
            onClick={() => setShowAdvanced(!showAdvanced)}
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
                onChange={(e) => setTestCommand(e.target.value)}
                hint="Command to run tests"
              />

              <Input
                label="Lint Command"
                placeholder="npm run lint"
                value={lintCommand}
                onChange={(e) => setLintCommand(e.target.value)}
                hint="Command to run linting"
              />

              <Input
                label="Build Command"
                placeholder="npm run build"
                value={buildCommand}
                onChange={(e) => setBuildCommand(e.target.value)}
                hint="Command to build the project"
              />
            </div>
          )}
        </section>

        {/* Error Message */}
        {error && (
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
            onClick={() => navigate('/')}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={isCreating}
            disabled={!repoPath || !provider || configuredProviders.length === 0}
            leftIcon={<Play className="h-4 w-4" />}
          >
            Start Session
          </Button>
        </div>
      </form>

      {/* File Browser Modal */}
      <FileBrowser
        isOpen={showFileBrowser}
        onClose={() => setShowFileBrowser(false)}
        onSelect={(path) => setRepoPath(path)}
        initialPath={repoPath || undefined}
      />
    </div>
  );
}
