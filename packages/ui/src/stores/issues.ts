import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type { Issue, Commit } from '@/lib/api';

export type IssueFilter = {
  status?: Issue['status'];
  type?: Issue['type'];
  severity?: Issue['severity'];
  search?: string;
};

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
  issues: [],
  commits: [],
  filters: {},
  selectedIssueId: null,
  selectedCommitId: null,
  isLoading: false,
  error: null,
};

export const useIssuesStore = create<IssuesState>()(
  devtools(
    subscribeWithSelector((set) => ({
      ...initialState,

      setIssues: (issues) => set({ issues }, false, 'setIssues'),

      addIssue: (issue) =>
        set(
          (state) => ({
            issues: [issue, ...state.issues],
          }),
          false,
          'addIssue'
        ),

      updateIssue: (id, updates) =>
        set(
          (state) => ({
            issues: state.issues.map((issue) =>
              issue.id === id ? { ...issue, ...updates } : issue
            ),
          }),
          false,
          'updateIssue'
        ),

      removeIssue: (id) =>
        set(
          (state) => ({
            issues: state.issues.filter((issue) => issue.id !== id),
            selectedIssueId:
              state.selectedIssueId === id ? null : state.selectedIssueId,
          }),
          false,
          'removeIssue'
        ),

      setCommits: (commits) => set({ commits }, false, 'setCommits'),

      addCommit: (commit) =>
        set(
          (state) => ({
            commits: [commit, ...state.commits],
          }),
          false,
          'addCommit'
        ),

      updateCommit: (id, updates) =>
        set(
          (state) => ({
            commits: state.commits.map((commit) =>
              commit.id === id ? { ...commit, ...updates } : commit
            ),
          }),
          false,
          'updateCommit'
        ),

      setFilters: (filters) =>
        set(
          (state) => ({
            filters: { ...state.filters, ...filters },
          }),
          false,
          'setFilters'
        ),

      clearFilters: () => set({ filters: {} }, false, 'clearFilters'),

      setSelectedIssue: (id) =>
        set({ selectedIssueId: id }, false, 'setSelectedIssue'),

      setSelectedCommit: (id) =>
        set({ selectedCommitId: id }, false, 'setSelectedCommit'),

      setLoading: (isLoading) => set({ isLoading }, false, 'setLoading'),

      setError: (error) => set({ error }, false, 'setError'),

      reset: () => set(initialState, false, 'reset'),
    })),
    { name: 'issues-store' }
  )
);

// Selectors
export const selectIssues = (state: IssuesState) => state.issues;
export const selectCommits = (state: IssuesState) => state.commits;
export const selectFilters = (state: IssuesState) => state.filters;
export const selectSelectedIssueId = (state: IssuesState) => state.selectedIssueId;
export const selectSelectedCommitId = (state: IssuesState) => state.selectedCommitId;
export const selectIsLoading = (state: IssuesState) => state.isLoading;
export const selectError = (state: IssuesState) => state.error;

// Filtered selectors
export const selectFilteredIssues = (state: IssuesState) => {
  let filtered = state.issues;
  const { status, type, severity, search } = state.filters;

  if (status) {
    filtered = filtered.filter((issue) => issue.status === status);
  }

  if (type) {
    filtered = filtered.filter((issue) => issue.type === type);
  }

  if (severity) {
    filtered = filtered.filter((issue) => issue.severity === severity);
  }

  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(
      (issue) =>
        issue.message.toLowerCase().includes(searchLower) ||
        issue.file.toLowerCase().includes(searchLower)
    );
  }

  return filtered;
};

export const selectIssueById = (id: string) => (state: IssuesState) =>
  state.issues.find((issue) => issue.id === id);

export const selectCommitById = (id: string) => (state: IssuesState) =>
  state.commits.find((commit) => commit.id === id);

export const selectSelectedIssue = (state: IssuesState) =>
  state.selectedIssueId
    ? state.issues.find((issue) => issue.id === state.selectedIssueId)
    : null;

export const selectSelectedCommit = (state: IssuesState) =>
  state.selectedCommitId
    ? state.commits.find((commit) => commit.id === state.selectedCommitId)
    : null;

export const selectIssuesByStatus = (status: Issue['status']) => (state: IssuesState) =>
  state.issues.filter((issue) => issue.status === status);

export const selectPendingIssues = (state: IssuesState) =>
  state.issues.filter((issue) => issue.status === 'pending');

export const selectResolvedIssues = (state: IssuesState) =>
  state.issues.filter((issue) => issue.status === 'resolved');

export const selectIssueStats = (state: IssuesState) => {
  const total = state.issues.length;
  const resolved = state.issues.filter((i) => i.status === 'resolved').length;
  const pending = state.issues.filter((i) => i.status === 'pending').length;
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
