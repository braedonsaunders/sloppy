/**
 * Service to dynamically fetch available models from AI provider APIs
 */

export interface FetchedModel {
  id: string;
  name?: string;
  description?: string;
  contextLength?: number;
}

export interface FetchModelsResult {
  success: boolean;
  models: string[];
  error?: string;
}

/**
 * Fetch available models from a provider's API
 */
export async function fetchModelsFromProvider(
  providerId: string,
  apiKey: string | null,
  baseUrl?: string | null
): Promise<FetchModelsResult> {
  try {
    switch (providerId) {
      case 'claude':
        return await fetchClaudeModels(apiKey);

      case 'openai':
        return await fetchOpenAIModels(apiKey, baseUrl);

      case 'gemini':
        return await fetchGeminiModels(apiKey);

      case 'openrouter':
        return await fetchOpenRouterModels(apiKey);

      case 'deepseek':
        return await fetchDeepSeekModels(apiKey);

      case 'mistral':
        return await fetchMistralModels(apiKey);

      case 'groq':
        return await fetchGroqModels(apiKey);

      case 'together':
        return await fetchTogetherModels(apiKey);

      case 'cohere':
        return await fetchCohereModels(apiKey);

      case 'ollama':
        return await fetchOllamaModels(baseUrl);

      default:
        return { success: false, models: [], error: 'Unknown provider' };
    }
  } catch (error) {
    return {
      success: false,
      models: [],
      error: error instanceof Error ? error.message : 'Failed to fetch models',
    };
  }
}

/**
 * Fetch Claude models from Anthropic API
 */
async function fetchClaudeModels(apiKey: string | null): Promise<FetchModelsResult> {
  if (!apiKey) {
    return { success: false, models: [], error: 'API key required' };
  }

  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
    return {
      success: false,
      models: [],
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  }

  const data = await response.json() as { data?: Array<{ id: string }> };
  const models = (data.data ?? [])
    .map((m) => m.id)
    .filter((id) => id.startsWith('claude'))
    .sort((a, b) => b.localeCompare(a)); // Newest first

  return { success: true, models };
}

/**
 * Fetch OpenAI models
 */
async function fetchOpenAIModels(
  apiKey: string | null,
  baseUrl?: string | null
): Promise<FetchModelsResult> {
  if (!apiKey) {
    return { success: false, models: [], error: 'API key required' };
  }

  const url = `${baseUrl || 'https://api.openai.com/v1'}/models`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
    return {
      success: false,
      models: [],
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  }

  const data = await response.json() as { data?: Array<{ id: string }> };
  const models = (data.data ?? [])
    .map((m) => m.id)
    .filter((id) => id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3'))
    .sort((a, b) => b.localeCompare(a));

  return { success: true, models };
}

/**
 * Fetch Google Gemini models
 */
async function fetchGeminiModels(apiKey: string | null): Promise<FetchModelsResult> {
  if (!apiKey) {
    return { success: false, models: [], error: 'API key required' };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    { signal: AbortSignal.timeout(15000) }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
    return {
      success: false,
      models: [],
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  }

  const data = await response.json() as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
  const models = (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace('models/', ''))
    .filter((id) => id.startsWith('gemini'))
    .sort((a, b) => b.localeCompare(a));

  return { success: true, models };
}

/**
 * Fetch OpenRouter models
 */
async function fetchOpenRouterModels(apiKey: string | null): Promise<FetchModelsResult> {
  if (!apiKey) {
    return { success: false, models: [], error: 'API key required' };
  }

  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
    return {
      success: false,
      models: [],
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  }

  const data = await response.json() as { data?: Array<{ id: string }> };
  // Get top models - OpenRouter has hundreds, so limit to popular ones
  const models = (data.data ?? [])
    .map((m) => m.id)
    .slice(0, 50); // Take top 50 models

  return { success: true, models };
}

/**
 * Fetch DeepSeek models (OpenAI-compatible)
 */
async function fetchDeepSeekModels(apiKey: string | null): Promise<FetchModelsResult> {
  if (!apiKey) {
    return { success: false, models: [], error: 'API key required' };
  }

  const response = await fetch('https://api.deepseek.com/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
    return {
      success: false,
      models: [],
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  }

  const data = await response.json() as { data?: Array<{ id: string }> };
  const models = (data.data ?? [])
    .map((m) => m.id)
    .sort((a, b) => b.localeCompare(a));

  return { success: true, models };
}

/**
 * Fetch Mistral models
 */
async function fetchMistralModels(apiKey: string | null): Promise<FetchModelsResult> {
  if (!apiKey) {
    return { success: false, models: [], error: 'API key required' };
  }

  const response = await fetch('https://api.mistral.ai/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
    return {
      success: false,
      models: [],
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  }

  const data = await response.json() as { data?: Array<{ id: string }> };
  const models = (data.data ?? [])
    .map((m) => m.id)
    .sort((a, b) => b.localeCompare(a));

  return { success: true, models };
}

/**
 * Fetch Groq models (OpenAI-compatible)
 */
async function fetchGroqModels(apiKey: string | null): Promise<FetchModelsResult> {
  if (!apiKey) {
    return { success: false, models: [], error: 'API key required' };
  }

  const response = await fetch('https://api.groq.com/openai/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
    return {
      success: false,
      models: [],
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  }

  const data = await response.json() as { data?: Array<{ id: string }> };
  const models = (data.data ?? [])
    .map((m) => m.id)
    .sort((a, b) => b.localeCompare(a));

  return { success: true, models };
}

/**
 * Fetch Together AI models
 */
async function fetchTogetherModels(apiKey: string | null): Promise<FetchModelsResult> {
  if (!apiKey) {
    return { success: false, models: [], error: 'API key required' };
  }

  const response = await fetch('https://api.together.xyz/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
    return {
      success: false,
      models: [],
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  }

  const data = await response.json() as Array<{ id: string; type?: string }>;
  // Filter to chat/language models, limit to reasonable number
  const models = (Array.isArray(data) ? data : [])
    .filter((m) => m.type === 'chat' || m.type === 'language')
    .map((m) => m.id)
    .slice(0, 50);

  return { success: true, models };
}

/**
 * Fetch Cohere models
 */
async function fetchCohereModels(apiKey: string | null): Promise<FetchModelsResult> {
  if (!apiKey) {
    return { success: false, models: [], error: 'API key required' };
  }

  const response = await fetch('https://api.cohere.ai/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
    return {
      success: false,
      models: [],
      error: error.error?.message ?? `HTTP ${response.status}`,
    };
  }

  const data = await response.json() as { models?: Array<{ name: string; endpoints?: string[] }> };
  const models = (data.models ?? [])
    .filter((m) => m.endpoints?.includes('chat') || m.endpoints?.includes('generate'))
    .map((m) => m.name)
    .sort((a, b) => b.localeCompare(a));

  return { success: true, models };
}

/**
 * Fetch Ollama models (local)
 */
async function fetchOllamaModels(baseUrl?: string | null): Promise<FetchModelsResult> {
  const url = `${baseUrl || 'http://localhost:11434'}/api/tags`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return {
        success: false,
        models: [],
        error: `HTTP ${response.status}`,
      };
    }

    const data = await response.json() as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);

    return { success: true, models };
  } catch (error) {
    return {
      success: false,
      models: [],
      error: 'Failed to connect. Is Ollama running?',
    };
  }
}
