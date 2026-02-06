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
