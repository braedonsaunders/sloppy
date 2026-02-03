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
}

export default function Settings() {
  const queryClient = useQueryClient();
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
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-dark-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {providers?.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          onConfigure={(config) => configureMutation.mutate(config)}
          onTest={() => testMutation.mutate(provider.id)}
          isConfiguring={configureMutation.isPending}
          isTesting={testMutation.isPending}
          testResult={
            testMutation.data && testMutation.variables === provider.id
              ? testMutation.data
              : null
          }
        />
      ))}

      {(!providers || providers.length === 0) && (
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-dark-600 mx-auto" />
          <p className="mt-4 text-dark-400">No providers available</p>
        </div>
      )}
    </div>
  );
}

interface ProviderCardProps {
  provider: Provider;
  onConfigure: (config: ProviderConfig) => void;
  onTest: () => void;
  isConfiguring: boolean;
  isTesting: boolean;
  testResult: { success: boolean; message?: string } | null;
}

function ProviderCard({
  provider,
  onConfigure,
  onTest,
  isConfiguring,
  isTesting,
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
    openai: 'O',
    anthropic: 'A',
    google: 'G',
    ollama: 'L',
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
        {/* API Key */}
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

        {/* Base URL (optional) */}
        {(provider.id === 'openai' || provider.id === 'ollama') && (
          <Input
            label="Base URL (optional)"
            placeholder={
              provider.id === 'ollama'
                ? 'http://localhost:11434'
                : 'https://api.openai.com/v1'
            }
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
          <label className="mb-1.5 block text-sm font-medium text-dark-200">
            Available Models
          </label>
          <div className="flex flex-wrap gap-2">
            {provider.models.map((model) => (
              <Badge key={model} variant="neutral" size="md">
                {model}
              </Badge>
            ))}
          </div>
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
            disabled={!isDirty || !apiKey}
            leftIcon={<Save className="h-4 w-4" />}
          >
            Save
          </Button>
          <Button
            variant="secondary"
            onClick={onTest}
            isLoading={isTesting}
            disabled={!provider.configured}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Test Connection
          </Button>
        </div>
      </div>
    </div>
  );
}

function DefaultsTab() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settings.get() as Promise<Settings>,
  });

  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
  });

  const updateMutation = useMutation({
    mutationFn: (settings: Settings) => api.settings.update(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
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
