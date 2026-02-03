import { describe, it, expect } from 'vitest';
import {
  IssueType,
  IssueSeverity,
  IssueCategory,
  IssueStatus,
  SessionStatus,
  ProviderType,
  type Issue,
  type Session,
  type SessionConfig,
} from '../types/index.js';

describe('Issue Types', () => {
  it('should have correct IssueType values', () => {
    expect(IssueType.STUB).toBe('stub');
    expect(IssueType.DUPLICATE).toBe('duplicate');
    expect(IssueType.BUG).toBe('bug');
    expect(IssueType.TYPE_ERROR).toBe('type_error');
    expect(IssueType.LINT_ERROR).toBe('lint_error');
    expect(IssueType.MISSING_TEST).toBe('missing_test');
    expect(IssueType.DEAD_CODE).toBe('dead_code');
    expect(IssueType.SECURITY).toBe('security');
  });

  it('should have correct IssueSeverity values', () => {
    expect(IssueSeverity.CRITICAL).toBe('critical');
    expect(IssueSeverity.HIGH).toBe('high');
    expect(IssueSeverity.MEDIUM).toBe('medium');
    expect(IssueSeverity.LOW).toBe('low');
  });

  it('should have correct IssueCategory values', () => {
    expect(IssueCategory.ERROR).toBe('error');
    expect(IssueCategory.WARNING).toBe('warning');
    expect(IssueCategory.SUGGESTION).toBe('suggestion');
  });

  it('should have correct IssueStatus values', () => {
    expect(IssueStatus.PENDING).toBe('pending');
    expect(IssueStatus.IN_PROGRESS).toBe('in_progress');
    expect(IssueStatus.RESOLVED).toBe('resolved');
    expect(IssueStatus.FAILED).toBe('failed');
    expect(IssueStatus.SKIPPED).toBe('skipped');
  });

  it('should create valid Issue object', () => {
    const issue: Issue = {
      id: 'issue-1',
      sessionId: 'session-1',
      type: IssueType.BUG,
      severity: IssueSeverity.HIGH,
      category: IssueCategory.ERROR,
      source: 'typescript',
      filePath: 'src/index.ts',
      line: 10,
      column: 5,
      endLine: 10,
      endColumn: 20,
      message: 'Type error found',
      code: 'const x: string = 123;',
      status: IssueStatus.PENDING,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(issue.id).toBe('issue-1');
    expect(issue.type).toBe(IssueType.BUG);
    expect(issue.severity).toBe(IssueSeverity.HIGH);
  });
});

describe('Session Types', () => {
  it('should have correct SessionStatus values', () => {
    expect(SessionStatus.PENDING).toBe('pending');
    expect(SessionStatus.RUNNING).toBe('running');
    expect(SessionStatus.PAUSED).toBe('paused');
    expect(SessionStatus.COMPLETED).toBe('completed');
    expect(SessionStatus.FAILED).toBe('failed');
    expect(SessionStatus.STOPPED).toBe('stopped');
    expect(SessionStatus.TIMEOUT).toBe('timeout');
  });

  it('should create valid SessionConfig', () => {
    const config: SessionConfig = {
      provider: ProviderType.CLAUDE,
      model: 'claude-sonnet-4-20250514',
      maxRetries: 3,
      timeoutMinutes: 60,
      analysisTypes: [IssueType.BUG, IssueType.TYPE_ERROR],
      excludePatterns: ['node_modules/**', 'dist/**'],
      testCommand: 'npm test',
      lintCommand: 'npm run lint',
      buildCommand: 'npm run build',
      commitAfterEachFix: true,
      runVerificationAfterEachFix: true,
      checkpointIntervalMinutes: 10,
    };

    expect(config.provider).toBe(ProviderType.CLAUDE);
    expect(config.maxRetries).toBe(3);
    expect(config.analysisTypes).toContain(IssueType.BUG);
  });

  it('should create valid Session object', () => {
    const session: Session = {
      id: 'session-1',
      repositoryPath: '/path/to/repo',
      branch: 'main',
      cleaningBranch: 'sloppy/clean-session-1',
      status: SessionStatus.PENDING,
      config: {
        provider: ProviderType.CLAUDE,
        model: 'claude-sonnet-4-20250514',
        maxRetries: 3,
        timeoutMinutes: 60,
        analysisTypes: [IssueType.BUG],
        excludePatterns: [],
        commitAfterEachFix: true,
        runVerificationAfterEachFix: true,
        checkpointIntervalMinutes: 10,
      },
      totalIssues: 0,
      resolvedIssues: 0,
      failedIssues: 0,
      skippedIssues: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(session.id).toBe('session-1');
    expect(session.status).toBe(SessionStatus.PENDING);
  });
});

describe('Provider Types', () => {
  it('should have correct ProviderType values', () => {
    expect(ProviderType.CLAUDE).toBe('claude');
    expect(ProviderType.OPENAI).toBe('openai');
    expect(ProviderType.OLLAMA).toBe('ollama');
    expect(ProviderType.CLAUDE_CODE_CLI).toBe('claude_code_cli');
    expect(ProviderType.CODEX_CLI).toBe('codex_cli');
  });
});
