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

export async function callGitHubModels(
  messages: ChatMessage[],
  model: string = 'openai/gpt-4o',
  maxTokens: number = 4000,
): Promise<{ content: string; tokens: number }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required for GitHub Models');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.1 }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub Models API error ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as ChatResponse;
  if (data.error) throw new Error(`GitHub Models: ${data.error.message}`);

  return {
    content: data.choices?.[0]?.message?.content || '',
    tokens: data.usage?.total_tokens || 0,
  };
}
