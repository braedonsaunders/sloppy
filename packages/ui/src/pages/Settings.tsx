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

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'providers' | 'defaults'>('providers');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-dark-100">Settings</h1>
        <p className="mt-1 text-dark-400">
          Configure AI providers and default session settings
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-dark-700">
        <nav className="flex gap-1">
          <button
            onClick={() => setActiveTab('providers')}
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
            onClick={() => setActiveTab('defaults')}
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
      {activeTab === 'defaults' && <DefaultsTab />}
    </div>
  );
}

function ProvidersTab() {
  const queryClient = useQueryClient();
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');

  const { data: providers, isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
  });

  const configureMutation = useMutation({
    mutationFn: (config: ProviderConfig) => api.providers.configure(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (providerId: string) => api.providers.test(providerId),
    onSuccess: () => {
      // Refresh providers to get updated models
      queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const refreshModelsMutation = useMutation({
    mutationFn: (providerId: string) => api.providers.refreshModels(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  // Set default selected provider when providers load
  useEffect(() => {
    if (providers && providers.length > 0 && !selectedProviderId) {
      // Prefer to select a configured provider first, otherwise pick the first one
      const configured = providers.find((p) => p.configured);
      setSelectedProviderId(configured?.id || providers[0]!.id);
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
      if (ids.includes(id)) return category;
    }
    return 'Other';
  };

  // Group providers for display
  const groupedProviders = providers?.reduce((acc, provider) => {
    const category = getProviderCategory(provider.id);
    if (!acc[category]) acc[category] = [];
    acc[category].push(provider);
    return acc;
  }, {} as Record<string, Provider[]>) || {};

  return (
    <div className="space-y-6">
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
          onConfigure={(config) => configureMutation.mutate(config)}
          onTest={() => testMutation.mutate(selectedProvider.id)}
          onRefreshModels={() => refreshModelsMutation.mutate(selectedProvider.id)}
          isConfiguring={configureMutation.isPending}
          isTesting={testMutation.isPending}
          isRefreshing={refreshModelsMutation.isPending}
          testResult={
            testMutation.data && testMutation.variables === selectedProvider.id
              ? testMutation.data
              : null
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
    gemini: 'https://generativelanguage.googleapis.com',
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
}: ProviderCardProps) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const handleSave = () => {
    onConfigure({
      providerId: provider.id,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
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
                  onClick={() => setShowApiKey(!showApiKey)}
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
              Your API key is encrypted and stored securely.
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

        {/* Available Models */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-dark-200">
              Available Models ({provider.models.length})
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
            <div className="max-h-32 overflow-y-auto rounded-lg border border-dark-700 bg-dark-850 p-2">
              <div className="flex flex-wrap gap-1.5">
                {provider.models.map((model) => (
                  <Badge key={model} variant="neutral" size="sm">
                    {model}
                  </Badge>
                ))}
              </div>
            </div>
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
            className={`flex items-center gap-2 rounded-lg p-3 ${
              testResult.success
                ? 'bg-success/10 text-success'
                : 'bg-error/10 text-error'
            }`}
          >
            {testResult.success ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <span className="text-sm">
              {testResult.message || (testResult.success ? 'Connection successful' : 'Connection failed')}
            </span>
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

function DefaultsTab() {
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
    onSuccess: () => {
      defaultsQueryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const [formData, setFormData] = useState<Settings>({});

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const handleSave = () => {
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
            })) || []),
          ]}
          value={formData.defaultProvider || ''}
          onChange={(e) =>
            setFormData({ ...formData, defaultProvider: e.target.value || undefined })
          }
        />

        <Select
          label="Default Model"
          options={[
            { value: '', label: 'Select model...' },
            ...(selectedProvider?.models.map((m) => ({
              value: m,
              label: m,
            })) || []),
          ]}
          value={formData.defaultModel || ''}
          onChange={(e) =>
            setFormData({ ...formData, defaultModel: e.target.value || undefined })
          }
          disabled={!formData.defaultProvider}
        />

        <Select
          label="Default Strictness"
          options={[
            { value: 'low', label: 'Low - Quick fixes, fewer changes' },
            { value: 'medium', label: 'Medium - Balanced approach' },
            { value: 'high', label: 'High - Thorough, more changes' },
          ]}
          value={formData.defaultStrictness || 'medium'}
          onChange={(e) =>
            setFormData({ ...formData, defaultStrictness: e.target.value })
          }
        />

        <Input
          label="Default Max Time (minutes)"
          type="number"
          min={1}
          max={480}
          value={formData.defaultMaxTime || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              defaultMaxTime: e.target.value ? parseInt(e.target.value) : undefined,
            })
          }
          hint="Leave empty for no time limit"
        />
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="approvalMode"
          checked={formData.approvalModeDefault || false}
          onChange={(e) =>
            setFormData({ ...formData, approvalModeDefault: e.target.checked })
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
