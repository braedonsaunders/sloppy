import * as core from '@actions/core';

const ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const MAX_RETRIES = 4;

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function callGitHubModels(
  messages: ChatMessage[],
  model: string = 'openai/gpt-4o-mini',
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

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const data = (await response.json()) as ChatResponse;
      if (data.error) throw new Error(`GitHub Models: ${data.error.message}`);
      return {
        content: data.choices?.[0]?.message?.content || '',
        tokens: data.usage?.total_tokens || 0,
      };
    }

    // Handle rate limiting with retry
    if (response.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `GitHub Models rate limit exceeded after ${MAX_RETRIES} retries. ` +
          'Try using a smaller model (openai/gpt-4o-mini gets 3x the quota of gpt-4o), ' +
          'or reduce chunk count by increasing chunk size.',
        );
      }

      // Respect Retry-After header if present, otherwise exponential backoff
      const retryAfter = response.headers.get('retry-after');
      let waitMs: number;
      if (retryAfter) {
        waitMs = (parseInt(retryAfter) || 10) * 1000;
      } else {
        // Exponential backoff: 5s, 15s, 30s, 60s
        waitMs = Math.min(60000, 5000 * Math.pow(3, attempt));
      }

      const waitSec = Math.ceil(waitMs / 1000);
      core.info(`       Rate limited (429). Waiting ${waitSec}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
      await sleep(waitMs);
      continue;
    }

    // Handle other errors
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

  // Should not reach here, but TypeScript needs it
  throw new Error('GitHub Models: unexpected retry loop exit');
}
