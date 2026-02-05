import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type { Issue, Commit } from '@/lib/api';

export interface IssueFilter {
  status?: Issue['status'];
  type?: Issue['type'];
  severity?: Issue['severity'];
  search?: string;
}

export interface IssuesState {
  // Issues
  issues: Issue[];
  commits: Commit[];
  filters: IssueFilter;
  selectedIssueId: string | null;
  selectedCommitId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setIssues: (issues: Issue[]) => void;
  addIssue: (issue: Issue) => void;
  updateIssue: (id: string, updates: Partial<Issue>) => void;
  removeIssue: (id: string) => void;
  setCommits: (commits: Commit[]) => void;
  addCommit: (commit: Commit) => void;
  updateCommit: (id: string, updates: Partial<Commit>) => void;
  setFilters: (filters: IssueFilter) => void;
  clearFilters: () => void;
  setSelectedIssue: (id: string | null) => void;
  setSelectedCommit: (id: string | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  issues: [] as Issue[],
  commits: [] as Commit[],
  filters: {} as IssueFilter,
  selectedIssueId: null as string | null,
  selectedCommitId: null as string | null,
  isLoading: false,
  error: null as string | null,
};

export const useIssuesStore = create<IssuesState>()(
  devtools(
    subscribeWithSelector((set) => ({
      ...initialState,

      setIssues: (issues: Issue[]): void => {
        set({ issues }, false, 'setIssues');
      },

      addIssue: (issue: Issue): void => {
        set(
          (state) => ({
            issues: [issue, ...state.issues],
          }),
          false,
          'addIssue'
        );
      },

      updateIssue: (id: string, updates: Partial<Issue>): void => {
        set(
          (state) => ({
            issues: state.issues.map((issue) =>
              issue.id === id ? { ...issue, ...updates } : issue
            ),
          }),
          false,
          'updateIssue'
        );
      },

      removeIssue: (id: string): void => {
        set(
          (state) => ({
            issues: state.issues.filter((issue) => issue.id !== id),
            selectedIssueId:
              state.selectedIssueId === id ? null : state.selectedIssueId,
          }),
          false,
          'removeIssue'
        );
      },

      setCommits: (commits: Commit[]): void => {
        set({ commits }, false, 'setCommits');
      },

      addCommit: (commit: Commit): void => {
        set(
          (state) => ({
            commits: [commit, ...state.commits],
          }),
          false,
          'addCommit'
        );
      },

      updateCommit: (id: string, updates: Partial<Commit>): void => {
        set(
          (state) => ({
            commits: state.commits.map((commit) =>
              commit.id === id ? { ...commit, ...updates } : commit
            ),
          }),
          false,
          'updateCommit'
        );
      },

      setFilters: (filters: IssueFilter): void => {
        set(
          (state) => ({
            filters: { ...state.filters, ...filters },
          }),
          false,
          'setFilters'
        );
      },

      clearFilters: (): void => {
        set({ filters: {} }, false, 'clearFilters');
      },

      setSelectedIssue: (id: string | null): void => {
        set({ selectedIssueId: id }, false, 'setSelectedIssue');
      },

      setSelectedCommit: (id: string | null): void => {
        set({ selectedCommitId: id }, false, 'setSelectedCommit');
      },

      setLoading: (isLoading: boolean): void => {
        set({ isLoading }, false, 'setLoading');
      },

      setError: (error: string | null): void => {
        set({ error }, false, 'setError');
      },

      reset: (): void => {
        set(initialState, false, 'reset');
      },
    })),
    { name: 'issues-store' }
  )
);

// Selectors
export const selectIssues = (state: IssuesState): Issue[] => state.issues;
export const selectCommits = (state: IssuesState): Commit[] => state.commits;
export const selectFilters = (state: IssuesState): IssueFilter => state.filters;
export const selectSelectedIssueId = (state: IssuesState): string | null => state.selectedIssueId;
export const selectSelectedCommitId = (state: IssuesState): string | null => state.selectedCommitId;
export const selectIsLoading = (state: IssuesState): boolean => state.isLoading;
export const selectError = (state: IssuesState): string | null => state.error;

// Filtered selectors
export const selectFilteredIssues = (state: IssuesState): Issue[] => {
  let filtered = state.issues;
  const { status, type, severity, search } = state.filters;

  if (status !== undefined) {
    filtered = filtered.filter((issue) => issue.status === status);
  }

  if (type !== undefined) {
    filtered = filtered.filter((issue) => issue.type === type);
  }

  if (severity !== undefined) {
    filtered = filtered.filter((issue) => issue.severity === severity);
  }

  if (search !== undefined && search !== '') {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(
      (issue) =>
        issue.message.toLowerCase().includes(searchLower) ||
        issue.file.toLowerCase().includes(searchLower)
    );
  }

  return filtered;
};

export const selectIssueById = (id: string): ((state: IssuesState) => Issue | undefined) =>
  (state: IssuesState): Issue | undefined => state.issues.find((issue) => issue.id === id);

export const selectCommitById = (id: string): ((state: IssuesState) => Commit | undefined) =>
  (state: IssuesState): Commit | undefined => state.commits.find((commit) => commit.id === id);

export const selectSelectedIssue = (state: IssuesState): Issue | undefined =>
  state.selectedIssueId !== null
    ? state.issues.find((issue) => issue.id === state.selectedIssueId)
    : undefined;

export const selectSelectedCommit = (state: IssuesState): Commit | undefined =>
  state.selectedCommitId !== null
    ? state.commits.find((commit) => commit.id === state.selectedCommitId)
    : undefined;

export const selectIssuesByStatus = (status: Issue['status']): ((state: IssuesState) => Issue[]) =>
  (state: IssuesState): Issue[] => state.issues.filter((issue) => issue.status === status);

export const selectPendingIssues = (state: IssuesState): Issue[] =>
  state.issues.filter((issue) => issue.status === 'detected');

export const selectResolvedIssues = (state: IssuesState): Issue[] =>
  state.issues.filter((issue) => issue.status === 'fixed' || issue.status === 'approved');

interface IssueStats {
  total: number;
  resolved: number;
  pending: number;
  inProgress: number;
  skipped: number;
  resolvedPercentage: number;
}

export const selectIssueStats = (state: IssuesState): IssueStats => {
  const total = state.issues.length;
  const resolved = state.issues.filter((i) => i.status === 'fixed').length;
  const pending = state.issues.filter((i) => i.status === 'detected').length;
  const inProgress = state.issues.filter((i) => i.status === 'in_progress').length;
  const skipped = state.issues.filter((i) => i.status === 'skipped').length;

  return {
    total,
    resolved,
    pending,
    inProgress,
    skipped,
    resolvedPercentage: total > 0 ? Math.round((resolved / total) * 100) : 0,
  };
};

export default useIssuesStore;
