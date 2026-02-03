/**
 * @sloppy/analyzers - Code analysis tools for detecting various issues
 *
 * This package provides a comprehensive suite of code analyzers for detecting
 * quality issues in TypeScript and JavaScript codebases.
 */

// Base types and classes
export {
  BaseAnalyzer,
  type Issue,
  type AnalyzerOptions,
  type AnalysisResult,
  type IssueCategory,
  type Severity,
  type SourceLocation,
  type FileContent,
} from './base.js';

// Individual analyzers
export { StubAnalyzer } from './stubs/index.js';
export { DuplicateAnalyzer, type DuplicateAnalyzerConfig, type DuplicateGroup } from './duplicates/index.js';
export { BugAnalyzer, type BugAnalyzerConfig } from './bugs/index.js';
export { TypeAnalyzer, type TypeAnalyzerConfig } from './types/index.js';
export { CoverageAnalyzer, type CoverageAnalyzerConfig } from './coverage/index.js';
export { LintAnalyzer, type LintAnalyzerConfig } from './lint/index.js';
export { SecurityAnalyzer, type SecurityAnalyzerConfig } from './security/index.js';
export { DeadCodeAnalyzer, type DeadCodeAnalyzerConfig } from './dead-code/index.js';

// Orchestrator
export {
  AnalysisOrchestrator,
  analyze,
  type OrchestratorConfig,
  type ProgressCallback,
} from './orchestrator.js';

/**
 * Create all default analyzers
 */
export function createAnalyzers(): Map<string, BaseAnalyzer> {
  const { StubAnalyzer } = require('./stubs/index.js');
  const { DuplicateAnalyzer } = require('./duplicates/index.js');
  const { BugAnalyzer } = require('./bugs/index.js');
  const { TypeAnalyzer } = require('./types/index.js');
  const { CoverageAnalyzer } = require('./coverage/index.js');
  const { LintAnalyzer } = require('./lint/index.js');
  const { SecurityAnalyzer } = require('./security/index.js');
  const { DeadCodeAnalyzer } = require('./dead-code/index.js');

  return new Map([
    ['stub', new StubAnalyzer()],
    ['duplicate', new DuplicateAnalyzer()],
    ['bug', new BugAnalyzer()],
    ['type', new TypeAnalyzer()],
    ['coverage', new CoverageAnalyzer()],
    ['lint', new LintAnalyzer()],
    ['security', new SecurityAnalyzer()],
    ['dead-code', new DeadCodeAnalyzer()],
  ]);
}

/**
 * Default export - the main analyze function
 */
export default analyze;
