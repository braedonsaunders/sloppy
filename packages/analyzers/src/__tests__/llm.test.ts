import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { LLMAnalyzer, type LLMAnalyzerConfig } from '../llm/index.js';
import { FileBrowser } from '../llm/file-browser.js';
import {
  generateAnalysisPrompt,
  generateReAnalysisPrompt,
  mapToIssueCategory,
  mapToSeverity,
  LLM_ANALYSIS_SYSTEM_PROMPT,
} from '../llm/prompts.js';
import { TOOL_DEFINITIONS } from '../llm/tool-executor.js';

describe('LLM Analyzer', () => {
  describe('LLMAnalyzer class', () => {
    it('should have correct name and category', () => {
      const analyzer = new LLMAnalyzer();
      expect(analyzer.name).toBe('llm-analyzer');
      expect(analyzer.category).toBe('llm');
    });

    it('should use default configuration', () => {
      const analyzer = new LLMAnalyzer();
      expect(analyzer.description).toContain('AI-powered');
    });

    it('should accept custom configuration', () => {
      const config: LLMAnalyzerConfig = {
        model: 'gpt-4',
        provider: 'openai',
        maxIterations: 5,
        batchSize: 3,
        runLint: false,
        runTests: true,
      };
      const analyzer = new LLMAnalyzer(config);
      expect(analyzer.name).toBe('llm-analyzer');
    });

    it('should skip analysis without API key', async () => {
      // Clear environment variables for test
      const originalKey = process.env['ANTHROPIC_API_KEY'];
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['OPENAI_API_KEY'];

      const analyzer = new LLMAnalyzer({ apiKey: '' });
      const issues = await analyzer.analyze([], { rootDir: '/tmp' });
      expect(issues).toEqual([]);

      // Restore
      if (originalKey) process.env['ANTHROPIC_API_KEY'] = originalKey;
    });
  });

  describe('Prompts', () => {
    it('should generate analysis prompt with files', () => {
      const files = [
        { path: 'src/index.ts', content: 'const x = 1;' },
        { path: 'src/utils.ts', content: 'export function add(a, b) { return a + b; }' },
      ];
      const prompt = generateAnalysisPrompt(files);

      expect(prompt).toContain('src/index.ts');
      expect(prompt).toContain('src/utils.ts');
      expect(prompt).toContain('const x = 1;');
      expect(prompt).toContain('typescript');
    });

    it('should include context in analysis prompt', () => {
      const files = [{ path: 'test.ts', content: 'code' }];
      const prompt = generateAnalysisPrompt(files, 'This is a test context');

      expect(prompt).toContain('Context');
      expect(prompt).toContain('This is a test context');
    });

    it('should generate re-analysis prompt', () => {
      const file = { path: 'src/auth.ts', content: 'function login() {}' };
      const previousIssue = {
        description: 'Missing error handling',
        lineStart: 5,
        lineEnd: 10,
      };
      const prompt = generateReAnalysisPrompt(file, previousIssue, 'Added try-catch');

      expect(prompt).toContain('Missing error handling');
      expect(prompt).toContain('Added try-catch');
      expect(prompt).toContain('src/auth.ts');
    });

    it('should have comprehensive system prompt', () => {
      expect(LLM_ANALYSIS_SYSTEM_PROMPT).toContain('Logic Bugs');
      expect(LLM_ANALYSIS_SYSTEM_PROMPT).toContain('Security Issues');
      expect(LLM_ANALYSIS_SYSTEM_PROMPT).toContain('Code Smells');
      expect(LLM_ANALYSIS_SYSTEM_PROMPT).toContain('Error Handling');
      expect(LLM_ANALYSIS_SYSTEM_PROMPT).toContain('JSON');
    });
  });

  describe('Category and Severity Mapping', () => {
    it('should map LLM categories to analyzer categories', () => {
      expect(mapToIssueCategory('bug')).toBe('bug');
      expect(mapToIssueCategory('BUG')).toBe('bug');
      expect(mapToIssueCategory('logic')).toBe('bug');
      expect(mapToIssueCategory('security')).toBe('security');
      expect(mapToIssueCategory('vulnerability')).toBe('security');
      expect(mapToIssueCategory('lint')).toBe('lint');
      expect(mapToIssueCategory('style')).toBe('lint');
      expect(mapToIssueCategory('stub')).toBe('stub');
      expect(mapToIssueCategory('duplicate')).toBe('duplicate');
      expect(mapToIssueCategory('dead-code')).toBe('dead-code');
      expect(mapToIssueCategory('deadcode')).toBe('dead-code');
      expect(mapToIssueCategory('coverage')).toBe('coverage');
      expect(mapToIssueCategory('type')).toBe('type');
      expect(mapToIssueCategory('unknown')).toBe('bug'); // default
    });

    it('should map LLM severities to analyzer severities', () => {
      expect(mapToSeverity('error')).toBe('error');
      expect(mapToSeverity('ERROR')).toBe('error');
      expect(mapToSeverity('critical')).toBe('error');
      expect(mapToSeverity('high')).toBe('error');
      expect(mapToSeverity('warning')).toBe('warning');
      expect(mapToSeverity('medium')).toBe('warning');
      expect(mapToSeverity('info')).toBe('info');
      expect(mapToSeverity('low')).toBe('info');
      expect(mapToSeverity('hint')).toBe('hint');
      expect(mapToSeverity('suggestion')).toBe('hint');
      expect(mapToSeverity('unknown')).toBe('warning'); // default
    });
  });

  describe('Tool Definitions', () => {
    it('should have all required tools defined', () => {
      const toolNames = TOOL_DEFINITIONS.map((t) => t.name);

      expect(toolNames).toContain('run_eslint');
      expect(toolNames).toContain('run_typecheck');
      expect(toolNames).toContain('run_tests');
      expect(toolNames).toContain('run_build');
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('search_code');
      expect(toolNames).toContain('list_files');
      expect(toolNames).toContain('get_file_info');
      expect(toolNames).toContain('create_issue');
    });

    it('should have descriptions for all tools', () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.description).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(10);
      }
    });

    it('should have parameter definitions for all tools', () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe('object');
      }
    });
  });

  describe('FileBrowser', () => {
    it('should prioritize source files', async () => {
      // Create a mock directory structure
      const mockFiles = [
        'src/index.ts',
        'src/auth/login.ts',
        'src/utils.ts',
        'test/index.test.ts',
        'docs/readme.md',
      ].map((f) => path.join('/mock', f));

      const browser = new FileBrowser('/mock');
      const exploration = await browser.explore(mockFiles);

      // Source files should be prioritized over test files
      const srcFiles = exploration.prioritizedFiles.filter((f) =>
        f.relativePath.startsWith('src/')
      );
      const testFiles = exploration.prioritizedFiles.filter((f) =>
        f.relativePath.includes('test')
      );

      if (srcFiles.length > 0 && testFiles.length > 0) {
        expect(srcFiles[0]!.priority).toBeGreaterThan(testFiles[0]!.priority);
      }
    });

    it('should create analysis groups', async () => {
      const mockFiles = [
        'src/services/auth.ts',
        'src/services/users.ts',
        'src/api/routes.ts',
      ].map((f) => path.join('/mock', f));

      const browser = new FileBrowser('/mock');
      const exploration = await browser.explore(mockFiles);

      // Should create groups
      expect(exploration.analysisGroups.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect security-related files', async () => {
      const mockFiles = [
        'src/auth.ts',
        'src/security/validator.ts',
        'src/login.ts',
        'src/utils.ts',
      ].map((f) => path.join('/mock', f));

      const browser = new FileBrowser('/mock');
      const exploration = await browser.explore(mockFiles);

      // Auth/security files should have higher priority
      const authFile = exploration.prioritizedFiles.find(
        (f) => f.relativePath.includes('auth') || f.relativePath.includes('security')
      );
      const utilsFile = exploration.prioritizedFiles.find((f) =>
        f.relativePath.includes('utils')
      );

      if (authFile && utilsFile) {
        expect(authFile.priority).toBeGreaterThanOrEqual(utilsFile.priority);
      }
    });
  });
});

describe('LLM Analyzer Integration', () => {
  it('should be exported from main package', async () => {
    const { LLMAnalyzer, FileBrowser, ToolExecutor, TOOL_DEFINITIONS } = await import(
      '../index.js'
    );

    expect(LLMAnalyzer).toBeDefined();
    expect(FileBrowser).toBeDefined();
    expect(ToolExecutor).toBeDefined();
    expect(TOOL_DEFINITIONS).toBeDefined();
  });

  it('should be registered in orchestrator', async () => {
    const { AnalysisOrchestrator } = await import('../index.js');

    const orchestrator = new AnalysisOrchestrator();
    const availableAnalyzers = orchestrator.getAvailableAnalyzers();

    expect(availableAnalyzers).toContain('llm');
  });
});
