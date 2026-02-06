import * as core from '@actions/core';

const ENDPOINT = 'https://models.github.ai/inference/chat/completions';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string };
}

// JSON Schema type that matches OpenAI's response_format specification
interface ResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict: boolean;
    schema: Record<string, unknown>;
  };
}

function getGitHubToken(): string {
  const token =
    process.env.GITHUB_TOKEN ||
    process.env.INPUT_GITHUB_TOKEN ||
    core.getInput('github-token');

  if (!token) {
    throw new Error(
      'GITHUB_TOKEN is required for GitHub Models free scan.\n' +
      'Add this to your workflow:\n' +
      '  env:\n' +
      '    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n' +
      'Or ensure permissions include: models: read',
    );
  }
  return token;
}

export async function callGitHubModels(
  messages: ChatMessage[],
  model: string = 'openai/gpt-4o',
  options?: { maxTokens?: number; responseFormat?: ResponseFormat },
): Promise<{ content: string; tokens: number }> {
  const token = getGitHubToken();
  const maxTokens = options?.maxTokens ?? 4000;

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.1,
  };

  if (options?.responseFormat) {
    body.response_format = options.responseFormat;
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `GitHub Models auth failed (${response.status}). Ensure your workflow has:\n` +
        '  permissions:\n' +
        '    models: read\n' +
        '  env:\n' +
        '    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
      );
    }
    throw new Error(`GitHub Models API error ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as ChatResponse;
  if (data.error) throw new Error(`GitHub Models: ${data.error.message}`);

  return {
    content: data.choices?.[0]?.message?.content || '',
    tokens: data.usage?.total_tokens || 0,
  };
}
