import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProvider } from '../factory.js';
import type { ProviderConfig } from '../factory.js';

// Mock the provider modules
vi.mock('../claude/index.js', () => ({
  ClaudeProvider: vi.fn().mockImplementation((config) => ({
    name: 'claude',
    config,
    analyzeCode: vi.fn(),
    fixIssue: vi.fn(),
    verifyFix: vi.fn(),
  })),
}));

vi.mock('../openai/index.js', () => ({
  OpenAIProvider: vi.fn().mockImplementation((config) => ({
    name: 'openai',
    config,
    analyzeCode: vi.fn(),
    fixIssue: vi.fn(),
    verifyFix: vi.fn(),
  })),
}));

vi.mock('../ollama/index.js', () => ({
  OllamaProvider: vi.fn().mockImplementation((config) => ({
    name: 'ollama',
    config,
    analyzeCode: vi.fn(),
    fixIssue: vi.fn(),
    verifyFix: vi.fn(),
  })),
}));

vi.mock('../cli/claude-code.js', () => ({
  ClaudeCodeCLIProvider: vi.fn().mockImplementation((config) => ({
    name: 'claude-cli',
    config,
  })),
}));

vi.mock('../cli/codex.js', () => ({
  CodexCLIProvider: vi.fn().mockImplementation((config) => ({
    name: 'codex-cli',
    config,
  })),
}));

describe('createProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create Claude provider', () => {
    const provider = createProvider({
      type: 'claude',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    expect(provider.name).toBe('claude');
  });

  it('should create OpenAI provider', () => {
    const provider = createProvider({
      type: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4',
    });

    expect(provider.name).toBe('openai');
  });

  it('should create Ollama provider', () => {
    const provider = createProvider({
      type: 'ollama',
      model: 'codellama',
      baseUrl: 'http://localhost:11434',
    });

    expect(provider.name).toBe('ollama');
  });

  it('should throw for unknown provider type', () => {
    expect(() => {
      createProvider({
        type: 'unknown' as ProviderConfig['type'],
      } as ProviderConfig);
    }).toThrow();
  });

  it('should not require API key for Ollama', () => {
    expect(() => {
      createProvider({
        type: 'ollama',
        model: 'codellama',
      });
    }).not.toThrow();
  });

  it('should pass config options to Claude provider', () => {
    const provider = createProvider({
      type: 'claude',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      temperature: 0.5,
    });

    expect(provider).toBeDefined();
    expect(provider.name).toBe('claude');
  });

  it('should pass config options to OpenAI provider', () => {
    const provider = createProvider({
      type: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o',
      maxTokens: 2048,
    });

    expect(provider).toBeDefined();
    expect(provider.name).toBe('openai');
  });

  it('should create Claude CLI provider', () => {
    const provider = createProvider({
      type: 'claude-cli',
      workingDirectory: '/test/dir',
    });

    expect(provider.name).toBe('claude-cli');
  });

  it('should create Codex CLI provider', () => {
    const provider = createProvider({
      type: 'codex-cli',
      approvalMode: 'auto-edit',
    });

    expect(provider.name).toBe('codex-cli');
  });

  it('should create Gemini provider via OpenAI compatibility', () => {
    const provider = createProvider({
      type: 'gemini',
      apiKey: 'test-key',
      model: 'gemini-2.0-flash',
    });

    // Gemini uses OpenAI provider under the hood
    expect(provider.name).toBe('openai');
  });
});
