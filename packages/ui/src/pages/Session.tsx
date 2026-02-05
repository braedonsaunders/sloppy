import type { JSX } from 'react';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Play,
  Pause,
  Square,
  Clock,
  GitCommit,
  CheckCircle,
  RefreshCw,
  Trash2,
  AlertCircle,
  AlertTriangle,
  Info,
  Cpu,
  Zap,
  FileCode,
} from 'lucide-react';
import Button from '@/components/Button';
import Badge, { StatusBadge } from '@/components/Badge';
import ProgressBar from '@/components/ProgressBar';
import IssueCard from '@/components/IssueCard';
import CommitCard from '@/components/CommitCard';
import ActivityLog, { ActivityIndicator } from '@/components/ActivityLog';
import MetricsChart from '@/components/MetricsChart';
import LLMRequestPanel, { LLMStatusIndicator } from '@/components/LLMRequestPanel';
import { ConfirmModal } from '@/components/Modal';
import Select from '@/components/Select';
import Input from '@/components/Input';
import { useSession } from '@/hooks/useSession';
import { useSessionWebSocket } from '@/hooks/useWebSocket';
import { useSessionStore } from '@/stores/session';
import { useIssuesStore, selectFilteredIssues, selectIssueStats, type IssueFilter } from '@/stores/issues';
import { api } from '@/lib/api';
import type { ScoreData } from '@/lib/api';
import SloppyScore from '@/components/SloppyScore';

type Tab = 'issues' | 'commits' | 'activity' | 'metrics';

export default function Session(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('issues');
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [scoreData, setScoreData] = useState<ScoreData | null>(null);

  // Hooks
  const {
    session,
    isLoading,
    isPausing,
    isResuming,
    isStopping,
    isDeleting,
    pauseSession,
    resumeSession,
    stopSession,
    deleteSession,
  } = useSession(id);

  // WebSocket for real-time updates
  useSessionWebSocket(id ?? '');

  // Store data
  const activities = useSessionStore((s) => s.activities);
  const metrics = useSessionStore((s) => s.metrics);
  const llmRequests = useSessionStore((s) => s.llmRequests);
  const activeLLMRequest = useSessionStore((s) => s.activeLLMRequest);
  const issues = useIssuesStore(selectFilteredIssues);
  const issueStats = useIssuesStore(selectIssueStats);
  const commits = useIssuesStore((s) => s.commits);
  const filters = useIssuesStore((s) => s.filters);
  const setFilters = useIssuesStore((s) => s.setFilters);
  const clearFilters = useIssuesStore((s) => s.clearFilters);

  // Fetch score data
  useEffect(() => {
    if (id === undefined || id === '') { return; }
    void api.scores.get(id).then((data) => {
      setScoreData(data);
    }).catch(() => {
      // Score not yet computed, that's fine
    });
  }, [id, session?.status]);

  // Mutations
  const approveIssueMutation = useMutation({
    mutationFn: (issueId: string) => api.issues.approve(id ?? '', issueId),
    onSuccess: (): void => { void queryClient.invalidateQueries({ queryKey: ['session', id, 'issues'] }); },
  });

  const rejectIssueMutation = useMutation({
    mutationFn: (issueId: string) => api.issues.reject(id ?? '', issueId),
    onSuccess: (): void => { void queryClient.invalidateQueries({ queryKey: ['session', id, 'issues'] }); },
  });

  const skipIssueMutation = useMutation({
    mutationFn: (issueId: string) => api.issues.skip(id ?? '', issueId),
    onSuccess: (): void => { void queryClient.invalidateQueries({ queryKey: ['session', id, 'issues'] }); },
  });

  const revertCommitMutation = useMutation({
    mutationFn: (commitId: string) => api.commits.revert(id ?? '', commitId),
    onSuccess: (): void => { void queryClient.invalidateQueries({ queryKey: ['session', id, 'commits'] }); },
  });

  // Handlers
  const handleStop = (): void => {
    void stopSession().then(() => {
      setShowStopConfirm(false);
    });
  };

  const handleDelete = (): void => {
    void deleteSession().then(() => {
      setShowDeleteConfirm(false);
      navigate('/');
    });
  };

  if (isLoading || !session) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-accent mx-auto" />
          <p className="mt-4 text-dark-400">Loading session...</p>
        </div>
      </div>
    );
  }

  const repoName = session.repoPath.split('/').pop() ?? session.repoPath;
  const isActive = session.status === 'running' || session.status === 'paused';
  const progress =
    session.stats.issuesFound > 0
      ? (session.stats.issuesResolved / session.stats.issuesFound) * 100
      : 0;

  const elapsedMinutes = Math.floor(session.stats.elapsedTime / 60);
  const elapsedSeconds = session.stats.elapsedTime % 60;

  // Calculate issue breakdown
  const issueBreakdown = {
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-dark-100">{repoName}</h1>
            <StatusBadge status={session.status} />
          </div>
          <p className="mt-1 text-dark-400">
            {session.provider} / {session.model} • {session.config.strictness} strictness
          </p>
          <p className="mt-0.5 text-xs text-dark-500 font-mono truncate max-w-md">
            {session.repoPath}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Timer */}
          <div className="flex items-center gap-2 rounded-lg bg-dark-800 px-4 py-2 border border-dark-700">
            <Clock className="h-4 w-4 text-dark-400" />
            <span className="font-mono text-dark-200">
              {String(elapsedMinutes).padStart(2, '0')}:
              {String(elapsedSeconds).padStart(2, '0')}
            </span>
          </div>

          {/* LLM Status (compact) */}
          <div className="hidden md:flex items-center gap-2 rounded-lg bg-dark-800 px-4 py-2 border border-dark-700">
            <LLMStatusIndicator
              activeRequest={activeLLMRequest}
              totalRequests={llmRequests.length}
            />
          </div>

          {/* Action buttons */}
          {session.status === 'running' && (
            <Button
              variant="secondary"
              onClick={() => { void pauseSession(); }}
              isLoading={isPausing}
              leftIcon={<Pause className="h-4 w-4" />}
            >
              Pause
            </Button>
          )}
          {session.status === 'paused' && (
            <Button
              variant="primary"
              onClick={() => { void resumeSession(); }}
              isLoading={isResuming}
              leftIcon={<Play className="h-4 w-4" />}
            >
              Resume
            </Button>
          )}
          {isActive && (
            <Button
              variant="danger"
              onClick={() => { setShowStopConfirm(true); }}
              leftIcon={<Square className="h-4 w-4" />}
            >
              Stop
            </Button>
          )}
          {!isActive && (
            <Button
              variant="ghost"
              onClick={() => { setShowDeleteConfirm(true); }}
              leftIcon={<Trash2 className="h-4 w-4" />}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Sloppy Score + Stats Overview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Score Display */}
        <div className="lg:col-span-1">
          {scoreData ? (
            <SloppyScore
              score={scoreData.score}
              breakdown={scoreData.breakdown}
              issuesBefore={scoreData.issuesBefore}
              issuesAfter={scoreData.issuesAfter}
            />
          ) : (
            <div className="rounded-xl border border-dark-700 bg-dark-800 p-6 flex flex-col items-center justify-center min-h-[200px]">
              <p className="text-dark-500 text-sm mb-3">No score computed yet</p>
              <button
                onClick={() => {
                  if (id === undefined || id === '') { return; }
                  void api.scores.compute(id).then((data) => {
                    setScoreData(data);
                  });
                }}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
              >
                Compute Score
              </button>
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* Issues Found */}
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="flex items-center gap-2 text-dark-400 mb-2">
            <FileCode className="h-4 w-4" />
            <span className="text-xs font-medium">Issues Found</span>
          </div>
          <p className="text-2xl font-semibold text-dark-100">{session.stats.issuesFound}</p>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-error flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {issueBreakdown.errors}
            </span>
            <span className="text-warning flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {issueBreakdown.warnings}
            </span>
            <span className="text-accent flex items-center gap-1">
              <Info className="h-3 w-3" /> {issueBreakdown.info}
            </span>
          </div>
        </div>

        {/* Issues Resolved */}
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="flex items-center gap-2 text-dark-400 mb-2">
            <CheckCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Resolved</span>
          </div>
          <p className="text-2xl font-semibold text-success">{session.stats.issuesResolved}</p>
          <p className="text-xs text-dark-500 mt-2">
            {session.stats.issuesFound > 0
              ? `${String(Math.round(progress))}% complete`
              : 'No issues yet'}
          </p>
        </div>

        {/* Pending */}
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="flex items-center gap-2 text-dark-400 mb-2">
            <Clock className="h-4 w-4" />
            <span className="text-xs font-medium">Pending</span>
          </div>
          <p className="text-2xl font-semibold text-warning">{issueStats.pending}</p>
          <p className="text-xs text-dark-500 mt-2">
            {issueStats.inProgress > 0 ? `${String(issueStats.inProgress)} in progress` : ''}
          </p>
        </div>

        {/* Commits */}
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="flex items-center gap-2 text-dark-400 mb-2">
            <GitCommit className="h-4 w-4" />
            <span className="text-xs font-medium">Commits</span>
          </div>
          <p className="text-2xl font-semibold text-accent">{session.stats.commitsCreated}</p>
          <p className="text-xs text-dark-500 mt-2">{commits.length} in session</p>
        </div>

        {/* LLM Requests */}
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="flex items-center gap-2 text-dark-400 mb-2">
            <Cpu className="h-4 w-4" />
            <span className="text-xs font-medium">LLM Requests</span>
          </div>
          <p className="text-2xl font-semibold text-dark-100">{llmRequests.length}</p>
          <p className="text-xs text-dark-500 mt-2">
            {activeLLMRequest ? (
              <span className="text-accent">Processing...</span>
            ) : (
              'Idle'
            )}
          </p>
        </div>

        {/* Token Usage */}
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="flex items-center gap-2 text-dark-400 mb-2">
            <Zap className="h-4 w-4" />
            <span className="text-xs font-medium">Tokens Used</span>
          </div>
          <p className="text-2xl font-semibold text-dark-100">
            {formatTokens(
              llmRequests.reduce(
                (acc, r) => acc + (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
                0
              )
            )}
          </p>
          <p className="text-xs text-dark-500 mt-2">
            Total input + output
          </p>
        </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-dark-400">Overall Progress</span>
          <span className="text-sm font-medium text-dark-200">
            {session.stats.issuesResolved} / {session.stats.issuesFound} issues resolved
          </span>
        </div>
        <ProgressBar
          value={progress}
          variant={session.status === 'running' ? 'gradient' : 'default'}
          animated={session.status === 'running'}
          size="lg"
        />

        {/* Current Activity */}
        {activities.length > 0 && (
          <div className="mt-4 pt-4 border-t border-dark-700">
            <ActivityIndicator
              activity={activities[0]}
              isActive={session.status === 'running'}
            />
          </div>
        )}
      </div>

      {/* Session Complete Summary */}
      {(session.status === 'completed' || session.status === 'stopped') && (
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
              session.status === 'completed' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
            }`}>
              {session.status === 'completed' ? <CheckCircle className="h-5 w-5" /> : <Square className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-dark-100">
                Session {session.status === 'completed' ? 'Complete' : 'Stopped'}
              </h2>
              <p className="text-sm text-dark-400">
                {session.stats.issuesResolved} of {session.stats.issuesFound} issues resolved
                {session.stats.commitsCreated > 0 && ` across ${session.stats.commitsCreated} commits`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-dark-700/50">
              <p className="text-2xl font-bold text-success">{session.stats.issuesResolved}</p>
              <p className="text-xs text-dark-400 mt-1">Fixed</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-dark-700/50">
              <p className="text-2xl font-bold text-dark-200">{session.stats.commitsCreated}</p>
              <p className="text-xs text-dark-400 mt-1">Commits</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-dark-700/50">
              <p className="text-2xl font-bold text-dark-200">
                {String(elapsedMinutes).padStart(2, '0')}:{String(elapsedSeconds).padStart(2, '0')}
              </p>
              <p className="text-xs text-dark-400 mt-1">Duration</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-dark-700/50">
              <p className="text-2xl font-bold text-dark-200">
                {formatTokens(llmRequests.reduce((acc, r) => acc + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0))}
              </p>
              <p className="text-xs text-dark-400 mt-1">Tokens</p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area - Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Tabs and Content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Tabs */}
          <div className="border-b border-dark-700">
            <nav className="flex gap-1">
              {(['issues', 'commits', 'activity', 'metrics'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab); }}
                  className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === tab
                      ? 'border-accent text-accent'
                      : 'border-transparent text-dark-400 hover:text-dark-200'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {tab === 'issues' && issues.length > 0 && (
                    <Badge variant="neutral" size="sm" className="ml-2">
                      {issues.length}
                    </Badge>
                  )}
                  {tab === 'commits' && commits.length > 0 && (
                    <Badge variant="neutral" size="sm" className="ml-2">
                      {commits.length}
                    </Badge>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="min-h-[400px]">
            {activeTab === 'issues' && (
              <IssuesPanel
                issues={issues}
                filters={filters}
                onSetFilters={setFilters}
                onClearFilters={clearFilters}
                onApprove={(issueId) => { approveIssueMutation.mutate(issueId); }}
                onReject={(issueId) => { rejectIssueMutation.mutate(issueId); }}
                onSkip={(issueId) => { skipIssueMutation.mutate(issueId); }}
                approvalMode={session.config.approvalMode}
              />
            )}

            {activeTab === 'commits' && (
              <CommitsPanel
                commits={commits}
                onRevert={(commitId) => { revertCommitMutation.mutate(commitId); }}
                isReverting={revertCommitMutation.isPending}
              />
            )}

            {activeTab === 'activity' && (
              <ActivityLog activities={activities} maxHeight="600px" />
            )}

            {activeTab === 'metrics' && (
              <div className="space-y-6">
                <MetricsChart
                  data={metrics}
                  metrics={['issuesFound', 'issuesResolved']}
                  height={300}
                />
                <MetricsChart
                  data={metrics}
                  type="bar"
                  metrics={['testsPassing', 'testsFailing', 'lintErrors']}
                  height={250}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Column - LLM Requests Panel */}
        <div className="space-y-4">
          <LLMRequestPanel
            requests={llmRequests}
            activeRequest={activeLLMRequest}
          />
        </div>
      </div>

      {/* Modals */}
      <ConfirmModal
        isOpen={showStopConfirm}
        onClose={() => { setShowStopConfirm(false); }}
        onConfirm={handleStop}
        title="Stop Session"
        message="Are you sure you want to stop this session? This action cannot be undone."
        confirmText="Stop Session"
        variant="danger"
        isLoading={isStopping}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => { setShowDeleteConfirm(false); }}
        onConfirm={handleDelete}
        title="Delete Session"
        message="Are you sure you want to delete this session? All data will be permanently removed."
        confirmText="Delete"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}

function formatTokens(count: number): string {
  if (count >= 1000000) {return `${(count / 1000000).toFixed(1)}M`;}
  if (count >= 1000) {return `${(count / 1000).toFixed(1)}k`;}
  return count.toString();
}

interface IssuesPanelProps {
  issues: ReturnType<typeof selectFilteredIssues>;
  filters: IssueFilter;
  onSetFilters: (filters: IssueFilter) => void;
  onClearFilters: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onSkip: (id: string) => void;
  approvalMode: boolean;
}

function IssuesPanel({
  issues,
  filters,
  onSetFilters,
  onClearFilters,
  onApprove,
  onReject,
  onSkip,
  approvalMode,
}: IssuesPanelProps): JSX.Element {
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          options={[
            { value: '', label: 'All statuses' },
            { value: 'pending', label: 'Pending' },
            { value: 'in_progress', label: 'In Progress' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'skipped', label: 'Skipped' },
          ]}
          value={filters.status ?? ''}
          onChange={(e) => { onSetFilters({ status: (e.target.value !== '' ? e.target.value : undefined) as IssueFilter['status'] }); }}
          className="w-40"
        />
        <Select
          options={[
            { value: '', label: 'All types' },
            { value: 'lint', label: 'Lint' },
            { value: 'type', label: 'Type' },
            { value: 'test', label: 'Test' },
            { value: 'security', label: 'Security' },
            { value: 'performance', label: 'Performance' },
            { value: 'style', label: 'Style' },
          ]}
          value={filters.type ?? ''}
          onChange={(e) => { onSetFilters({ type: (e.target.value !== '' ? e.target.value : undefined) as IssueFilter['type'] }); }}
          className="w-40"
        />
        <Select
          options={[
            { value: '', label: 'All severities' },
            { value: 'error', label: 'Errors' },
            { value: 'warning', label: 'Warnings' },
            { value: 'info', label: 'Info' },
          ]}
          value={filters.severity ?? ''}
          onChange={(e) => { onSetFilters({ severity: (e.target.value !== '' ? e.target.value : undefined) as IssueFilter['severity'] }); }}
          className="w-40"
        />
        <Input
          placeholder="Search issues..."
          value={filters.search ?? ''}
          onChange={(e) => { onSetFilters({ search: e.target.value !== '' ? e.target.value : undefined }); }}
          className="w-60"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Fix All Bar */}
      {approvalMode && issues.filter(i => i.status === 'pending').length > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-accent/5 border border-accent/20 p-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-accent" />
            <span className="text-sm text-dark-200">
              {issues.filter(i => i.status === 'pending').length} issues ready to fix
            </span>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              issues.filter(i => i.status === 'pending').forEach(i => onApprove(i.id));
            }}
            leftIcon={<Zap className="h-3.5 w-3.5" />}
          >
            Fix All
          </Button>
        </div>
      )}

      {/* Issues List */}
      {issues.length > 0 ? (
        <div className="space-y-3">
          {issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onApprove={approvalMode ? onApprove : undefined}
              onReject={approvalMode ? onReject : undefined}
              onSkip={onSkip}
              showActions={approvalMode}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle className="h-12 w-12 text-dark-600" />
          <p className="mt-4 text-dark-400">
            {hasFilters ? 'No issues match your filters' : 'No issues found'}
          </p>
        </div>
      )}
    </div>
  );
}

interface CommitsPanelProps {
  commits: { id: string; hash: string; message: string; files: string[]; diff: string; issueIds: string[]; createdAt: string; reverted: boolean }[];
  onRevert: (id: string) => void;
  isReverting: boolean;
}

function CommitsPanel({ commits, onRevert, isReverting }: CommitsPanelProps): JSX.Element {
  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <GitCommit className="h-12 w-12 text-dark-600" />
        <p className="mt-4 text-dark-400">No commits yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {commits.map((commit) => (
        <CommitCard
          key={commit.id}
          commit={{
            id: commit.id,
            sessionId: '',
            hash: commit.hash,
            message: commit.message,
            files: commit.files,
            diff: commit.diff,
            issueIds: commit.issueIds,
            createdAt: commit.createdAt,
            reverted: commit.reverted,
          }}
          onRevert={onRevert}
          isReverting={isReverting}
        />
      ))}
    </div>
  );
}
