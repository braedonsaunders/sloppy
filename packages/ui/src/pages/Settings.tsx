import type { JSX } from 'react';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Save,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Zap,
  Shield,
  Github,
  ExternalLink,
  Unlink,
} from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Badge from '@/components/Badge';
import { api, type Provider, type ProviderConfig } from '@/lib/api';

interface Settings {
  defaultProvider?: string;
  defaultModel?: string;
  defaultStrictness?: string;
  defaultMaxTime?: number;
  approvalModeDefault?: boolean;
  [key: string]: unknown;
}

export default function Settings(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'providers' | 'github' | 'defaults'>('providers');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-dark-100">Settings</h1>
        <p className="mt-1 text-dark-400">
          Configure AI providers, GitHub integration, and default session settings
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-dark-700">
        <nav className="flex gap-1">
          <button
            onClick={() => { setActiveTab('providers'); }}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'providers'
                ? 'border-accent text-accent'
                : 'border-transparent text-dark-400 hover:text-dark-200'
            }`}
          >
            <Zap className="h-4 w-4 inline-block mr-2" />
            Providers
          </button>
          <button
            onClick={() => { setActiveTab('github'); }}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'github'
                ? 'border-accent text-accent'
                : 'border-transparent text-dark-400 hover:text-dark-200'
            }`}
          >
            <Github className="h-4 w-4 inline-block mr-2" />
            GitHub
          </button>
          <button
            onClick={() => { setActiveTab('defaults'); }}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'defaults'
                ? 'border-accent text-accent'
                : 'border-transparent text-dark-400 hover:text-dark-200'
            }`}
          >
            <Shield className="h-4 w-4 inline-block mr-2" />
            Defaults
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'providers' && <ProvidersTab />}
      {activeTab === 'github' && <GitHubTab />}
      {activeTab === 'defaults' && <DefaultsTab />}
    </div>
  );
}

function ProvidersTab(): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');

  const { data: providers, isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
  });

  // Fetch detected env providers
  const { data: envProviders } = useQuery({
    queryKey: ['detect', 'providers'],
    queryFn: () => fetch('/api/detect/providers').then(r => r.json()).then(d => d.data?.detectedProviders as Record<string, boolean>),
  });

  const detectedKeys = envProviders ? Object.entries(envProviders).filter(([_, v]) => v).map(([k]) => k) : [];

  const configureMutation = useMutation({
    mutationFn: (config: ProviderConfig) => api.providers.configure(config),
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (providerId: string) => api.providers.test(providerId),
    onSuccess: (): void => {
      // Refresh providers to get updated models
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const refreshModelsMutation = useMutation({
    mutationFn: (providerId: string) => api.providers.refreshModels(providerId),
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const selectModelMutation = useMutation({
    mutationFn: ({ providerId, model }: { providerId: string; model: string }) =>
      api.providers.selectModel(providerId, model),
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  // Set default selected provider when providers load
  useEffect(() => {
    if (providers !== undefined && providers.length > 0 && selectedProviderId === '') {
      // Prefer to select a configured provider first, otherwise pick the first one
      const configured = providers.find((p) => p.configured);
      setSelectedProviderId(configured?.id ?? providers[0].id);
    }
  }, [providers, selectedProviderId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-dark-500" />
      </div>
    );
  }

  const selectedProvider = providers?.find((p) => p.id === selectedProviderId);

  // Group providers by category for better organization
  const providerCategories = {
    'Cloud APIs': ['claude', 'openai', 'gemini', 'openrouter', 'deepseek', 'mistral', 'groq', 'together', 'cohere'],
    'Local': ['ollama'],
    'CLI Tools': ['claude-cli', 'codex-cli'],
  };

  const getProviderCategory = (id: string): string => {
    for (const [category, ids] of Object.entries(providerCategories)) {
      if (ids.includes(id)) {return category;}
    }
    return 'Other';
  };

  // Group providers for display
  const groupedProviders = providers?.reduce<Record<string, Provider[]>>((acc, provider) => {
    const category = getProviderCategory(provider.id);
    acc[category] ??= [];
    acc[category].push(provider);
    return acc;
  }, {}) ?? {};

  return (
    <div className="space-y-6">
      {/* Environment Detection Banner */}
      {detectedKeys.length > 0 && (
        <div className="rounded-xl border border-success/30 bg-success/5 p-4 flex items-start gap-3">
          <CheckCircle className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-dark-200">
              API keys detected from environment
            </p>
            <p className="text-xs text-dark-400 mt-1">
              Found keys for: {detectedKeys.map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(', ')}.
              These providers are ready to use.
            </p>
          </div>
        </div>
      )}

      {/* Provider Selector */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
        <label className="mb-3 block text-sm font-medium text-dark-200">
          Select Provider
        </label>
        <Select
          options={[
            { value: '', label: 'Select a provider...', disabled: true },
            ...Object.entries(groupedProviders).flatMap(([category, categoryProviders]) => [
              { value: `__category_${category}`, label: `── ${category} ──`, disabled: true },
              ...categoryProviders.map((p) => ({
                value: p.id,
                label: `${p.name}${p.configured ? ' ✓' : ''}`,
              })),
            ]),
          ]}
          value={selectedProviderId}
          onChange={(e) => {
            setSelectedProviderId(e.target.value);
            // Reset test results when switching providers
            testMutation.reset();
          }}
        />
        <p className="mt-2 text-xs text-dark-500">
          Configure API keys and settings for your AI providers. Providers marked with ✓ are already configured.
        </p>
      </div>

      {/* Selected Provider Card */}
      {selectedProvider ? (
        <ProviderCard
          key={selectedProvider.id}
          provider={selectedProvider}
          onConfigure={(config) => { configureMutation.mutate(config); }}
          onTest={() => { testMutation.mutate(selectedProvider.id); }}
          onRefreshModels={() => { refreshModelsMutation.mutate(selectedProvider.id); }}
          isConfiguring={configureMutation.isPending}
          isTesting={testMutation.isPending}
          isRefreshing={refreshModelsMutation.isPending}
          testResult={
            testMutation.data && testMutation.variables === selectedProvider.id
              ? testMutation.data
              : null
          }
          selectedModel={selectedProvider.selectedModel}
          onSelectModel={(model) =>
            { selectModelMutation.mutate({ providerId: selectedProvider.id, model }); }
          }
        />
      ) : (
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-dark-600 mx-auto" />
          <p className="mt-4 text-dark-400">Select a provider to configure</p>
        </div>
      )}

      {(!providers || providers.length === 0) && (
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-dark-600 mx-auto" />
          <p className="mt-4 text-dark-400">No providers available</p>
        </div>
      )}
    </div>
  );
}

// Helper functions for provider configuration
function supportsBaseUrl(providerId: string): boolean {
  return ['openai', 'ollama', 'openrouter', 'deepseek', 'mistral', 'groq', 'together', 'cohere', 'gemini', 'claude'].includes(providerId);
}

function getDefaultBaseUrl(providerId: string): string {
  const defaults: Record<string, string> = {
    ollama: 'http://localhost:11434',
    openai: 'https://api.openai.com/v1',
    claude: 'https://api.anthropic.com',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
    openrouter: 'https://openrouter.ai/api/v1',
    deepseek: 'https://api.deepseek.com/v1',
    mistral: 'https://api.mistral.ai/v1',
    groq: 'https://api.groq.com/openai/v1',
    together: 'https://api.together.xyz/v1',
    cohere: 'https://api.cohere.ai/v1',
  };
  return defaults[providerId] || '';
}

function requiresApiKey(providerId: string): boolean {
  // CLI providers and Ollama don't require API keys
  return !['ollama', 'claude-cli', 'codex-cli'].includes(providerId);
}

interface ProviderCardProps {
  provider: Provider;
  onConfigure: (config: ProviderConfig) => void;
  onTest: () => void;
  onRefreshModels: () => void;
  isConfiguring: boolean;
  isTesting: boolean;
  isRefreshing: boolean;
  testResult: { success: boolean; message?: string } | null;
  selectedModel: string | null;
  onSelectModel: (model: string) => void;
}

function ProviderCard({
  provider,
  onConfigure,
  onTest,
  onRefreshModels,
  isConfiguring,
  isTesting,
  isRefreshing,
  testResult,
  selectedModel,
  onSelectModel,
}: ProviderCardProps): JSX.Element {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const handleSave = (): void => {
    onConfigure({
      providerId: provider.id,
      apiKey: apiKey !== '' ? apiKey : undefined,
      baseUrl: baseUrl !== '' ? baseUrl : undefined,
    });
    setIsDirty(false);
    setApiKey('');
  };

  const providerIcons: Record<string, string> = {
    claude: 'A',
    openai: 'O',
    gemini: 'G',
    ollama: 'L',
    openrouter: 'R',
    deepseek: 'D',
    mistral: 'M',
    groq: 'Q',
    together: 'T',
    cohere: 'C',
    'claude-cli': 'A',
    'codex-cli': 'X',
  };

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 bg-dark-850">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent font-semibold">
            {providerIcons[provider.id] || provider.name.charAt(0)}
          </div>
          <div>
            <h3 className="font-medium text-dark-100">{provider.name}</h3>
            <p className="text-sm text-dark-500">
              {provider.models.length} model{provider.models.length !== 1 ? 's' : ''} available
            </p>
          </div>
        </div>
        <Badge
          variant={provider.configured ? 'success' : 'neutral'}
          dot
        >
          {provider.configured ? 'Configured' : 'Not configured'}
        </Badge>
      </div>

      {/* Body */}
      <div className="p-6 space-y-4">
        {/* API Key - only shown for providers that require it */}
        {requiresApiKey(provider.id) ? (
          <div className="relative">
            <Input
              label="API Key"
              type={showApiKey ? 'text' : 'password'}
              placeholder={provider.configured ? '••••••••••••••••' : 'Enter your API key'}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setIsDirty(true);
              }}
              rightIcon={
                <button
                  type="button"
                  onClick={() => { setShowApiKey(!showApiKey); }}
                  className="text-dark-400 hover:text-dark-200"
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              }
            />
            <p className="mt-1.5 text-xs text-dark-500">
              Your API key is stored locally on this machine.
            </p>
          </div>
        ) : (
          <div className="rounded-lg bg-dark-700/50 p-3">
            <p className="text-sm text-dark-400">
              {provider.id === 'ollama'
                ? 'Ollama runs locally and does not require an API key. Just ensure Ollama is running.'
                : 'This provider uses local CLI tools and does not require an API key.'}
            </p>
          </div>
        )}

        {/* Base URL (optional) */}
        {supportsBaseUrl(provider.id) && (
          <Input
            label="Base URL (optional)"
            placeholder={getDefaultBaseUrl(provider.id)}
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setIsDirty(true);
            }}
            hint="Override the default API endpoint"
          />
        )}

        {/* Model Selection */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-dark-200">
              Model ({provider.models.length} available)
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefreshModels}
              isLoading={isRefreshing}
              disabled={!provider.configured}
              leftIcon={<RefreshCw className="h-3 w-3" />}
            >
              Refresh
            </Button>
          </div>
          {provider.models.length > 0 ? (
            <Select
              options={[
                { value: '', label: 'Select a model...' },
                ...provider.models.map((model) => ({
                  value: model,
                  label: model,
                })),
              ]}
              value={selectedModel ?? ''}
              onChange={(e) => { onSelectModel(e.target.value); }}
            />
          ) : (
            <div className="rounded-lg border border-dark-700 bg-dark-850 p-3 text-center">
              <p className="text-sm text-dark-500">
                {provider.configured
                  ? 'No models found. Click Refresh to fetch available models.'
                  : 'Configure the provider to see available models.'}
              </p>
            </div>
          )}
        </div>

        {/* Test Result */}
        {testResult && (
          <div
            className={`rounded-lg p-3 ${
              testResult.success
                ? 'bg-success/10 text-success'
                : 'bg-error/10 text-error'
            }`}
          >
            <div className="flex items-center gap-2">
              {testResult.success ? (
                <CheckCircle className="h-4 w-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
              )}
              <span className="text-sm font-medium">
                {testResult.success ? 'Connection successful' : 'Connection failed'}
              </span>
            </div>
            {testResult.message && (
              <p className="text-xs mt-1.5 ml-6 opacity-80">
                {testResult.message}
              </p>
            )}
            {!testResult.success && !testResult.message && (
              <p className="text-xs mt-1.5 ml-6 opacity-80">
                Could not reach the provider. Please verify your API key is correct, check that the
                base URL is reachable, and ensure your network connection is stable. If using a
                custom endpoint, confirm the URL includes the correct path.
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="primary"
            onClick={handleSave}
            isLoading={isConfiguring}
            disabled={!isDirty || (requiresApiKey(provider.id) && !apiKey)}
            leftIcon={<Save className="h-4 w-4" />}
          >
            Save
          </Button>
          <Button
            variant="secondary"
            onClick={onTest}
            isLoading={isTesting}
            disabled={!provider.configured}
            leftIcon={<Zap className="h-4 w-4" />}
          >
            Test & Sync Models
          </Button>
        </div>
      </div>
    </div>
  );
}

function DefaultsTab(): JSX.Element {
  const defaultsQueryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settings.get() as Promise<Settings>,
  });

  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
  });

  const updateMutation = useMutation({
    mutationFn: (settings: Settings) => api.settings.update(settings as Record<string, unknown>),
    onSuccess: (): void => {
      void defaultsQueryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const [formData, setFormData] = useState<Settings>({});

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const handleSave = (): void => {
    updateMutation.mutate(formData);
  };

  const selectedProvider = providers?.find((p) => p.id === formData.defaultProvider);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-dark-500" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800 p-6 space-y-6">
      <div>
        <h3 className="text-lg font-medium text-dark-100">Default Settings</h3>
        <p className="mt-1 text-sm text-dark-400">
          Configure default values for new sessions
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Select
          label="Default Provider"
          options={[
            { value: '', label: 'Select provider...' },
            ...(providers?.filter((p) => p.configured).map((p) => ({
              value: p.id,
              label: p.name,
            })) ?? []),
          ]}
          value={formData.defaultProvider ?? ''}
          onChange={(e) =>
            { setFormData({ ...formData, defaultProvider: e.target.value !== '' ? e.target.value : undefined }); }
          }
        />

        <Select
          label="Default Model"
          options={[
            { value: '', label: 'Select model...' },
            ...(selectedProvider?.models.map((m) => ({
              value: m,
              label: m,
            })) ?? []),
          ]}
          value={formData.defaultModel ?? ''}
          onChange={(e) =>
            { setFormData({ ...formData, defaultModel: e.target.value !== '' ? e.target.value : undefined }); }
          }
          disabled={formData.defaultProvider === undefined}
        />

        <Select
          label="Default Strictness"
          options={[
            { value: 'low', label: 'Low - Quick fixes, fewer changes' },
            { value: 'medium', label: 'Medium - Balanced approach' },
            { value: 'high', label: 'High - Thorough, more changes' },
          ]}
          value={formData.defaultStrictness ?? 'medium'}
          onChange={(e) =>
            { setFormData({ ...formData, defaultStrictness: e.target.value }); }
          }
        />

        <Input
          label="Default Max Time (minutes)"
          type="number"
          min={1}
          max={480}
          value={formData.defaultMaxTime ?? ''}
          onChange={(e) =>
            { setFormData({
              ...formData,
              defaultMaxTime: e.target.value !== '' ? parseInt(e.target.value, 10) : undefined,
            }); }
          }
          hint="Leave empty for no time limit"
        />
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="approvalMode"
          checked={formData.approvalModeDefault ?? false}
          onChange={(e) =>
            { setFormData({ ...formData, approvalModeDefault: e.target.checked }); }
          }
          className="h-4 w-4 rounded border-dark-600 bg-dark-700 text-accent focus:ring-accent"
        />
        <label htmlFor="approvalMode" className="text-sm text-dark-200">
          Enable approval mode by default (require manual approval for each fix)
        </label>
      </div>

      <div className="pt-4 border-t border-dark-700">
        <Button
          variant="primary"
          onClick={handleSave}
          isLoading={updateMutation.isPending}
          leftIcon={<Save className="h-4 w-4" />}
        >
          Save Defaults
        </Button>
      </div>
    </div>
  );
}

function GitHubTab(): JSX.Element {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  // Fetch GitHub connection status
  const { data: githubStatus, isLoading } = useQuery({
    queryKey: ['github', 'status'],
    queryFn: () => api.github.status(),
  });

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: (token: string) => api.github.connect(token),
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: ['github'] });
      setToken('');
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: () => api.github.disconnect(),
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: ['github'] });
    },
  });

  // Test connection mutation
  const testMutation = useMutation({
    mutationFn: () => api.github.test(),
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: ['github'] });
    },
  });

  const handleConnect = (): void => {
    if (token.trim()) {
      connectMutation.mutate(token.trim());
    }
  };

  const handleDisconnect = (): void => {
    disconnectMutation.mutate();
  };

  const handleTest = (): void => {
    testMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-dark-500" />
      </div>
    );
  }

  const isConnected = githubStatus?.connected === true;
  const user = githubStatus?.user;

  return (
    <div className="space-y-6">
      {/* Connection Status Card */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 bg-dark-850">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Github className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-medium text-dark-100">GitHub Integration</h3>
              <p className="text-sm text-dark-500">
                Connect to access your repositories
              </p>
            </div>
          </div>
          <Badge
            variant={isConnected ? 'success' : 'neutral'}
            dot
          >
            {isConnected ? 'Connected' : 'Not connected'}
          </Badge>
        </div>

        <div className="p-6 space-y-4">
          {isConnected && user ? (
            <>
              {/* Connected state */}
              <div className="flex items-center gap-4 p-4 rounded-lg bg-dark-700/50">
                {user.avatarUrl !== undefined && user.avatarUrl !== '' && (
                  <img
                    src={user.avatarUrl}
                    alt={user.login}
                    className="w-12 h-12 rounded-full"
                  />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-dark-100">{user.name ?? user.login}</span>
                    {user.name !== undefined && user.name !== '' && (
                      <span className="text-dark-400">@{user.login}</span>
                    )}
                  </div>
                  {githubStatus.scopes !== undefined && githubStatus.scopes.length > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-dark-500">Scopes:</span>
                      <div className="flex gap-1 flex-wrap">
                        {githubStatus.scopes.map((scope) => (
                          <Badge key={scope} variant="neutral" size="sm">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {githubStatus.configuredAt !== null && (
                    <p className="text-xs text-dark-500 mt-1">
                      Connected on {new Date(githubStatus.configuredAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
                {user.htmlUrl !== undefined && user.htmlUrl !== '' && (
                  <a
                    href={user.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-dark-400 hover:text-dark-200 transition-colors"
                  >
                    <ExternalLink className="h-5 w-5" />
                  </a>
                )}
              </div>

              {/* Test result */}
              {testMutation.data && (
                <div
                  className={`flex items-center gap-2 rounded-lg p-3 ${
                    testMutation.data.success
                      ? 'bg-success/10 text-success'
                      : 'bg-error/10 text-error'
                  }`}
                >
                  {testMutation.data.success ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <span className="text-sm">
                    {testMutation.data.success
                      ? `Connection verified. Rate limit: ${String(testMutation.data.rateLimit?.remaining ?? '?')}/${String(testMutation.data.rateLimit?.limit ?? '?')}`
                      : 'Connection test failed. Token may have been revoked.'}
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={handleTest}
                  isLoading={testMutation.isPending}
                  leftIcon={<RefreshCw className="h-4 w-4" />}
                >
                  Test Connection
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDisconnect}
                  isLoading={disconnectMutation.isPending}
                  leftIcon={<Unlink className="h-4 w-4" />}
                >
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Not connected state */}
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-dark-300 mb-4">
                    Connect your GitHub account using a Personal Access Token (PAT) to browse
                    and select your repositories, including private ones.
                  </p>

                  <div className="rounded-lg bg-dark-700/50 p-4 mb-4">
                    <h4 className="text-sm font-medium text-dark-200 mb-2">How to create a token:</h4>
                    <ol className="text-sm text-dark-400 space-y-1 list-decimal list-inside">
                      <li>Go to GitHub Settings &gt; Developer settings &gt; Personal access tokens</li>
                      <li>Click "Generate new token (classic)"</li>
                      <li>Select scopes: <code className="bg-dark-600 px-1 py-0.5 rounded text-dark-300">repo</code> (for private repos) or <code className="bg-dark-600 px-1 py-0.5 rounded text-dark-300">public_repo</code> (for public only)</li>
                      <li>Copy the generated token and paste it below</li>
                    </ol>
                    <a
                      href="https://github.com/settings/tokens/new"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:text-accent/80 text-sm mt-3"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Create a new token on GitHub
                    </a>
                  </div>
                </div>

                <div className="relative">
                  <Input
                    label="Personal Access Token"
                    type={showToken ? 'text' : 'password'}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    value={token}
                    onChange={(e) => { setToken(e.target.value); }}
                    rightIcon={
                      <button
                        type="button"
                        onClick={() => { setShowToken(!showToken); }}
                        className="text-dark-400 hover:text-dark-200"
                      >
                        {showToken ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    }
                  />
                  <p className="mt-1.5 text-xs text-dark-500">
                    Your token is stored securely and only used to access your GitHub repositories.
                  </p>
                </div>

                {/* Connect error */}
                {connectMutation.isError && (
                  <div className="flex items-center gap-2 rounded-lg p-3 bg-error/10 text-error">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">
                      {connectMutation.error instanceof Error
                        ? connectMutation.error.message
                        : 'Failed to connect. Please check your token.'}
                    </span>
                  </div>
                )}

                <Button
                  variant="primary"
                  onClick={handleConnect}
                  isLoading={connectMutation.isPending}
                  disabled={!token.trim()}
                  leftIcon={<Github className="h-4 w-4" />}
                >
                  Connect GitHub
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Info card */}
      <div className="rounded-lg border border-dark-700 bg-dark-800/50 p-4">
        <h4 className="text-sm font-medium text-dark-200 mb-2">What can you do with GitHub integration?</h4>
        <ul className="text-sm text-dark-400 space-y-1">
          <li className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-success" />
            Browse and select from all your repositories (including private)
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-success" />
            Automatically clone repositories for code quality sessions
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-success" />
            Select specific branches to work on
          </li>
        </ul>
      </div>
    </div>
  );
}
