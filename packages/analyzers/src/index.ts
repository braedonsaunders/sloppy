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
export {
  LLMAnalyzer,
  type LLMAnalyzerConfig,
  type AnalyzerEvent,
  FileBrowser,
  ToolExecutor,
  TOOL_DEFINITIONS,
  ReAnalysisLoop,
  createReAnalysisRunner,
  type ReAnalysisConfig,
  type ReAnalysisResult,
  type AnalysisLoopResult,
} from './llm/index.js';

// Plugin system
export {
  PluginRegistry,
  type AnalyzerPlugin,
  type AnalyzerPluginManifest,
  PluginValidationError,
  validatePlugin,
  loadPluginFromPath,
  loadPluginsFromDirectory,
  createPlugin,
} from './plugin.js';

// Orchestrator
export {
  AnalysisOrchestrator,
  analyze,
  type OrchestratorConfig,
  type ProgressCallback,
} from './orchestrator.js';

// Re-export analyze as default
export { analyze as default } from './orchestrator.js';
