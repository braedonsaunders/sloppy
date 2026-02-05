import type { JSX } from 'react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Zap,
  Key,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  FolderOpen,
  Shield,
  Sparkles,
} from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { api } from '@/lib/api';

type Step = 'welcome' | 'provider' | 'ready';

interface Provider {
  id: string;
  name: string;
  configured: boolean;
  models: string[];
}

const PROVIDER_INFO: Record<string, { description: string; keyName: string; keyUrl: string }> = {
  claude: {
    description: 'Anthropic\'s Claude - best for deep code understanding',
    keyName: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    description: 'OpenAI\'s GPT models - widely supported',
    keyName: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  ollama: {
    description: 'Run locally with Ollama - free, private, no API key needed',
    keyName: '',
    keyUrl: 'https://ollama.com/download',
  },
  gemini: {
    description: 'Google\'s Gemini models',
    keyName: 'GOOGLE_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  deepseek: {
    description: 'DeepSeek - strong coding models',
    keyName: 'DEEPSEEK_API_KEY',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  groq: {
    description: 'Groq - ultra-fast inference',
    keyName: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
  },
};

export default function Onboarding(): JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
  });

  const { data: envProviders } = useQuery({
    queryKey: ['detect', 'providers'],
    queryFn: () => api.detect.providers(),
  });

  // Check if any provider is already configured
  const configuredProvider = providers?.find((p: Provider) => p.configured);

  // Auto-skip if already configured
  useEffect(() => {
    if (configuredProvider) {
      navigate('/', { replace: true });
    }
  }, [configuredProvider, navigate]);

  // Check for env-detected providers
  const envData = envProviders as { detectedProviders?: Record<string, boolean> } | undefined;
  const detectedProviders = envData?.detectedProviders
    ? Object.entries(envData.detectedProviders)
        .filter(([, detected]) => detected)
        .map(([id]) => id)
    : [];

  const configureMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProvider) return;

      // Configure the provider
      await api.providers.configure({
        providerId: selectedProvider,
        apiKey: apiKey || undefined,
      });

      // Test the connection
      setTestResult('testing');
      try {
        await api.providers.test(selectedProvider);
        setTestResult('success');
      } catch (err) {
        setTestResult('error');
        setTestError(err instanceof Error ? err.message : 'Connection test failed');
        throw err;
      }
    },
  });

  const handleTestAndSave = (): void => {
    setTestResult('testing');
    setTestError(null);
    configureMutation.mutate();
  };

  const providerInfo = selectedProvider ? PROVIDER_INFO[selectedProvider] : null;

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-xl">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {(['welcome', 'provider', 'ready'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  step === s
                    ? 'bg-accent text-white'
                    : (['welcome', 'provider', 'ready'].indexOf(step) > i)
                    ? 'bg-success/20 text-success'
                    : 'bg-dark-700 text-dark-500'
                }`}
              >
                {(['welcome', 'provider', 'ready'].indexOf(step) > i) ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              {i < 2 && <div className="w-12 h-px bg-dark-700" />}
            </div>
          ))}
        </div>

        {/* Welcome Step */}
        {step === 'welcome' && (
          <div className="text-center space-y-6">
            <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-accent/10">
              <Zap className="h-10 w-10 text-accent" />
            </div>

            <div>
              <h1 className="text-3xl font-bold text-dark-100">Welcome to Sloppy</h1>
              <p className="mt-3 text-dark-400 text-lg">
                AI-powered code quality tool that finds and fixes issues automatically
              </p>
            </div>

            <div className="grid gap-4 text-left">
              <div className="flex items-start gap-4 rounded-xl border border-dark-700 bg-dark-800 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 flex-shrink-0">
                  <FolderOpen className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-medium text-dark-200">Point at any codebase</h3>
                  <p className="text-sm text-dark-500">Local directories, Git URLs, or GitHub repos</p>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-xl border border-dark-700 bg-dark-800 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 flex-shrink-0">
                  <Shield className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="font-medium text-dark-200">8 analyzers scan in parallel</h3>
                  <p className="text-sm text-dark-500">Security, bugs, types, lint, dead code, duplicates, stubs, coverage</p>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-xl border border-dark-700 bg-dark-800 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 flex-shrink-0">
                  <Sparkles className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <h3 className="font-medium text-dark-200">AI fixes issues automatically</h3>
                  <p className="text-sm text-dark-500">Each fix is one atomic, revertible git commit</p>
                </div>
              </div>
            </div>

            <Button
              variant="primary"
              size="lg"
              onClick={() => { setStep('provider'); }}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              className="w-full justify-center"
            >
              Get Started
            </Button>
          </div>
        )}

        {/* Provider Step */}
        {step === 'provider' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-dark-100">Connect an AI Provider</h2>
              <p className="mt-2 text-dark-400">
                Sloppy uses AI to understand and fix your code. Choose a provider.
              </p>
            </div>

            {detectedProviders.length > 0 && (
              <div className="rounded-lg bg-success/10 p-3 text-sm text-success flex items-center gap-2">
                <CheckCircle className="h-4 w-4 flex-shrink-0" />
                <span>
                  Detected API key{detectedProviders.length > 1 ? 's' : ''} for:{' '}
                  {detectedProviders.join(', ')}
                </span>
              </div>
            )}

            {/* Provider selection */}
            <div className="grid gap-3">
              {(providers ?? [])
                .filter((p: Provider) => PROVIDER_INFO[p.id])
                .map((p: Provider) => {
                  const info = PROVIDER_INFO[p.id];
                  const isDetected = detectedProviders.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedProvider(p.id);
                        setApiKey('');
                        setTestResult('idle');
                        setTestError(null);
                      }}
                      className={`flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                        selectedProvider === p.id
                          ? 'border-accent bg-accent/5'
                          : 'border-dark-700 bg-dark-800 hover:border-dark-600'
                      }`}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-dark-700 text-lg font-bold text-dark-300">
                        {p.name.charAt(0)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-dark-200">{p.name}</span>
                          {isDetected && (
                            <span className="text-xs bg-success/20 text-success px-2 py-0.5 rounded-full">
                              Key detected
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-dark-500">{info?.description}</p>
                      </div>
                    </button>
                  );
                })}
            </div>

            {/* API Key input */}
            {selectedProvider && selectedProvider !== 'ollama' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-dark-200">
                    API Key
                  </label>
                  {providerInfo?.keyUrl && (
                    <a
                      href={providerInfo.keyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent hover:text-accent-hover flex items-center gap-1"
                    >
                      Get API key <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <Input
                  type="password"
                  placeholder={`Enter your ${providerInfo?.keyName ?? 'API key'}`}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); }}
                  leftIcon={<Key className="h-4 w-4" />}
                />
                {detectedProviders.includes(selectedProvider) && !apiKey && (
                  <p className="text-xs text-success">
                    Using key from environment variable. Leave blank to use it.
                  </p>
                )}
              </div>
            )}

            {selectedProvider === 'ollama' && (
              <div className="rounded-lg bg-dark-800 border border-dark-700 p-4">
                <p className="text-sm text-dark-300">
                  Make sure Ollama is running locally. No API key needed.
                </p>
                <code className="text-xs text-dark-500 mt-2 block">
                  ollama serve
                </code>
              </div>
            )}

            {/* Test result */}
            {testResult === 'success' && (
              <div className="rounded-lg bg-success/10 p-3 text-sm text-success flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Connection successful! Provider is ready.
              </div>
            )}

            {testResult === 'error' && (
              <div className="rounded-lg bg-error/10 p-3 text-sm text-error">
                {testError ?? 'Connection failed. Check your API key and try again.'}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => { setStep('welcome'); }}
                leftIcon={<ArrowLeft className="h-4 w-4" />}
              >
                Back
              </Button>
              <Button
                variant="primary"
                className="flex-1 justify-center"
                onClick={() => {
                  if (testResult === 'success') {
                    setStep('ready');
                  } else {
                    handleTestAndSave();
                  }
                }}
                disabled={!selectedProvider || (testResult === 'testing')}
                isLoading={testResult === 'testing'}
                rightIcon={testResult === 'success' ? <ArrowRight className="h-4 w-4" /> : undefined}
              >
                {testResult === 'success' ? 'Continue' : testResult === 'testing' ? 'Testing...' : 'Test Connection'}
              </Button>
            </div>
          </div>
        )}

        {/* Ready Step */}
        {step === 'ready' && (
          <div className="text-center space-y-6">
            <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-success/10">
              <CheckCircle className="h-10 w-10 text-success" />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-dark-100">You're all set!</h2>
              <p className="mt-2 text-dark-400">
                Start your first session to analyze and improve your code.
              </p>
            </div>

            <div className="space-y-3">
              <Button
                variant="primary"
                size="lg"
                onClick={() => { navigate('/session/new'); }}
                rightIcon={<Sparkles className="h-4 w-4" />}
                className="w-full justify-center"
              >
                Create First Session
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => { navigate('/'); }}
                className="w-full justify-center"
              >
                Go to Dashboard
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
