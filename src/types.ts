export type IssueType =
  | 'security'
  | 'bugs'
  | 'types'
  | 'lint'
  | 'dead-code'
  | 'stubs'
  | 'duplicates'
  | 'coverage';

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type AgentType = 'claude' | 'codex';

export type ScanScope = 'auto' | 'pr' | 'full';

export interface SloppyConfig {
  mode: 'scan' | 'fix';
  agent: AgentType;
  timeout: number;
  maxCost: number;
  maxPasses: number;
  minPasses: number;
  maxChains: number;
  fixTypes: IssueType[];
  strictness: 'low' | 'medium' | 'high';
  model: string;
  githubModelsModel: string;
  testCommand: string;
  failBelow: number;
  verbose: boolean;
  maxTurns: { scan: number; fix: number };
  maxIssuesPerPass: number;
  scanScope: ScanScope;
  outputFile: string;
  customPrompt: string;
  customPromptFile: string;
  pluginsEnabled: boolean;
  parallelAgents: number;
}

/** Repo-level .sloppy.yml configuration. */
export interface RepoConfig {
  ignore?: string[];
  rules?: Record<string, 'off' | Severity>;
  fixTypes?: IssueType[];
  testCommand?: string;
  strictness?: 'low' | 'medium' | 'high';
  failBelow?: number;
}

export interface Issue {
  id: string;
  type: IssueType;
  severity: Severity;
  file: string;
  line?: number;
  description: string;
  status: 'found' | 'fixed' | 'skipped';
  skipReason?: string;
  commitSha?: string;
}

export interface PassResult {
  number: number;
  found: number;
  fixed: number;
  skipped: number;
  durationMs: number;
}

export interface LoopState {
  runId: string;
  pass: number;
  chainNumber: number;
  branchName: string;
  issues: Issue[];
  passes: PassResult[];
  totalFixed: number;
  totalSkipped: number;
  startTime: string;
  scoreBefore: number;
  scoreAfter: number;
  complete: boolean;
}

export interface ScanResult {
  issues: Issue[];
  score: number;
  summary: string;
  tokens: number;
}

export interface HistoryEntry {
  run: number;
  date: string;
  score: number;
  scoreBefore: number;
  fixed: number;
  skipped: number;
  passes: number;
  durationMs: number;
  byType: Record<string, number>;
  prUrl?: string;
  mode: 'scan' | 'fix';
  agent: string;
}

// ---------------------------------------------------------------------------
// Plugin system types
// ---------------------------------------------------------------------------

/** A custom regex pattern contributed by a plugin for Layer 0 scanning. */
export interface PluginPattern {
  regex: string;
  type: IssueType | string;
  severity: Severity;
  description: string;
  extensions?: string[];
}

/** Lifecycle hook definition — a shell command to run at a specific phase. */
export interface PluginHooks {
  'pre-scan'?: string;
  'post-scan'?: string;
  'pre-fix'?: string;
  'post-fix'?: string;
}

/** Issue filter rules contributed by a plugin. */
export interface PluginFilters {
  'exclude-paths'?: string[];
  'exclude-types'?: string[];
  'min-severity'?: Severity;
}

/** A single loaded plugin manifest. */
export interface SloppyPlugin {
  name: string;
  version?: string;
  description?: string;
  /** Custom prompt text injected into every scan/fix prompt. */
  prompt?: string;
  /** Custom regex patterns for Layer 0 local scanning. */
  patterns?: PluginPattern[];
  /** Lifecycle hook shell commands. */
  hooks?: PluginHooks;
  /** Issue filter rules. */
  filters?: PluginFilters;
  /** Directory the plugin was loaded from (for resolving relative hook paths). */
  _dir: string;
}

/** Aggregated context from all loaded plugins. */
export interface PluginContext {
  plugins: SloppyPlugin[];
  /** Merged custom prompt text (custom-prompt input + plugin prompts). */
  customPrompt: string;
  /** Merged extra patterns for local scanning. */
  extraPatterns: PluginPattern[];
  /** Merged filters. */
  filters: PluginFilters;
}
