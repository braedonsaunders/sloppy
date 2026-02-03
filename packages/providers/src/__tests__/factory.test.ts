import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderFactory, createProvider } from '../factory.js';
import { ProviderType } from '@sloppy/core';

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

describe('ProviderFactory', () => {
  let factory: ProviderFactory;

  beforeEach(() => {
    factory = new ProviderFactory();
    vi.clearAllMocks();
  });

  describe('createProvider', () => {
    it('should create Claude provider', () => {
      const provider = factory.createProvider({
        type: ProviderType.CLAUDE,
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      });

      expect(provider.name).toBe('claude');
    });

    it('should create OpenAI provider', () => {
      const provider = factory.createProvider({
        type: ProviderType.OPENAI,
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      expect(provider.name).toBe('openai');
    });

    it('should create Ollama provider', () => {
      const provider = factory.createProvider({
        type: ProviderType.OLLAMA,
        model: 'codellama',
        baseUrl: 'http://localhost:11434',
      });

      expect(provider.name).toBe('ollama');
    });

    it('should throw for unknown provider type', () => {
      expect(() => {
        factory.createProvider({
          type: 'unknown' as ProviderType,
          apiKey: 'test-key',
        });
      }).toThrow();
    });

    it('should throw when API key missing for Claude', () => {
      expect(() => {
        factory.createProvider({
          type: ProviderType.CLAUDE,
          model: 'claude-sonnet-4-20250514',
        });
      }).toThrow(/API key/i);
    });

    it('should throw when API key missing for OpenAI', () => {
      expect(() => {
        factory.createProvider({
          type: ProviderType.OPENAI,
          model: 'gpt-4',
        });
      }).toThrow(/API key/i);
    });

    it('should not require API key for Ollama', () => {
      expect(() => {
        factory.createProvider({
          type: ProviderType.OLLAMA,
          model: 'codellama',
        });
      }).not.toThrow();
    });
  });

  describe('getAvailableProviders', () => {
    it('should return list of available providers', () => {
      const providers = factory.getAvailableProviders();

      expect(providers).toContain(ProviderType.CLAUDE);
      expect(providers).toContain(ProviderType.OPENAI);
      expect(providers).toContain(ProviderType.OLLAMA);
    });
  });

  describe('isValidConfig', () => {
    it('should validate Claude config', () => {
      expect(
        factory.isValidConfig({
          type: ProviderType.CLAUDE,
          apiKey: 'key',
          model: 'claude-sonnet-4-20250514',
        })
      ).toBe(true);

      expect(
        factory.isValidConfig({
          type: ProviderType.CLAUDE,
          model: 'claude-sonnet-4-20250514',
        })
      ).toBe(false);
    });

    it('should validate OpenAI config', () => {
      expect(
        factory.isValidConfig({
          type: ProviderType.OPENAI,
          apiKey: 'key',
          model: 'gpt-4',
        })
      ).toBe(true);

      expect(
        factory.isValidConfig({
          type: ProviderType.OPENAI,
        })
      ).toBe(false);
    });

    it('should validate Ollama config', () => {
      expect(
        factory.isValidConfig({
          type: ProviderType.OLLAMA,
          model: 'codellama',
        })
      ).toBe(true);
    });
  });
});

describe('createProvider helper', () => {
  it('should create provider using factory', () => {
    const provider = createProvider({
      type: ProviderType.CLAUDE,
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    expect(provider.name).toBe('claude');
  });
});
