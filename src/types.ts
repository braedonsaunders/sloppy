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

export type AppType = 'web-app' | 'api' | 'cli' | 'library' | 'worker' | 'mobile' | 'desktop';
export type AppExposure = 'public' | 'internal' | 'local';
export type AppNetwork = 'internet' | 'vpn' | 'localhost';
export type DataSensitivity = 'high' | 'medium' | 'low';

/** Application context — helps the AI calibrate severity of findings. */
export interface AppContext {
  type?: AppType;
  exposure?: AppExposure;
  auth?: boolean;
  network?: AppNetwork;
  dataSensitivity?: DataSensitivity;
}

/** A false-positive suppression rule. */
export interface AllowRule {
  pattern: string;
  reason: string;
}

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
  minSeverity: Severity;
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
  app: AppContext;
  framework: string;
  runtime: string;
  trustInternal: string[];
  trustUntrusted: string[];
  allow: AllowRule[];
  profile: string;
}

/** Repo-level .sloppy.yml configuration — the single source of truth. */
export interface RepoConfig {
  // Filtering
  ignore?: string[];
  rules?: Record<string, 'off' | Severity>;
  fixTypes?: IssueType[];
  testCommand?: string;
  strictness?: 'low' | 'medium' | 'high';
  minSeverity?: Severity;
  failBelow?: number;

  // Operational
  mode?: 'scan' | 'fix';
  agent?: AgentType;
  timeout?: string;
  maxCost?: string;
  maxPasses?: number;
  minPasses?: number;
  maxChains?: number;
  model?: string;
  githubModelsModel?: string;
  verbose?: boolean;
  maxTurns?: number;
  maxIssuesPerPass?: number;
  scanScope?: ScanScope;
  outputFile?: string;
  customPrompt?: string;
  customPromptFile?: string;
  plugins?: boolean;
  parallelAgents?: number;

  // App context
  app?: AppContext;
  framework?: string;
  runtime?: string;
  trustInternal?: string[];
  trustUntrusted?: string[];
  allow?: AllowRule[];
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
