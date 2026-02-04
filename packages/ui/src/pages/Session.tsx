import { useState } from 'react';
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
} from 'lucide-react';
import Button from '@/components/Button';
import Badge, { StatusBadge } from '@/components/Badge';
import ProgressBar from '@/components/ProgressBar';
import IssueCard from '@/components/IssueCard';
import CommitCard from '@/components/CommitCard';
import ActivityLog, { ActivityIndicator } from '@/components/ActivityLog';
import MetricsChart from '@/components/MetricsChart';
import { ConfirmModal } from '@/components/Modal';
import Select from '@/components/Select';
import Input from '@/components/Input';
import { useSession } from '@/hooks/useSession';
import { useSessionWebSocket } from '@/hooks/useWebSocket';
import { useSessionStore } from '@/stores/session';
import { useIssuesStore, selectFilteredIssues, selectIssueStats, type IssueFilter } from '@/stores/issues';
import { api } from '@/lib/api';

type Tab = 'issues' | 'commits' | 'activity' | 'metrics';

export default function Session() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('issues');
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
  useSessionWebSocket(id!);

  // Store data
  const activities = useSessionStore((s) => s.activities);
  const metrics = useSessionStore((s) => s.metrics);
  const issues = useIssuesStore(selectFilteredIssues);
  const issueStats = useIssuesStore(selectIssueStats);
  const commits = useIssuesStore((s) => s.commits);
  const filters = useIssuesStore((s) => s.filters);
  const setFilters = useIssuesStore((s) => s.setFilters);
  const clearFilters = useIssuesStore((s) => s.clearFilters);

  // Mutations
  const approveIssueMutation = useMutation({
    mutationFn: (issueId: string) => api.issues.approve(id!, issueId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', id, 'issues'] }),
  });

  const rejectIssueMutation = useMutation({
    mutationFn: (issueId: string) => api.issues.reject(id!, issueId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', id, 'issues'] }),
  });

  const skipIssueMutation = useMutation({
    mutationFn: (issueId: string) => api.issues.skip(id!, issueId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', id, 'issues'] }),
  });

  const revertCommitMutation = useMutation({
    mutationFn: (commitId: string) => api.commits.revert(id!, commitId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', id, 'commits'] }),
  });

  // Handlers
  const handleStop = async () => {
    await stopSession();
    setShowStopConfirm(false);
  };

  const handleDelete = async () => {
    await deleteSession();
    setShowDeleteConfirm(false);
    navigate('/');
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

  const repoName = session.repoPath.split('/').pop() || session.repoPath;
  const isActive = session.status === 'running' || session.status === 'paused';
  const progress =
    session.stats.issuesFound > 0
      ? (session.stats.issuesResolved / session.stats.issuesFound) * 100
      : 0;

  const elapsedMinutes = Math.floor(session.stats.elapsedTime / 60);
  const elapsedSeconds = session.stats.elapsedTime % 60;

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

          {/* Action buttons */}
          {session.status === 'running' && (
            <Button
              variant="secondary"
              onClick={() => pauseSession()}
              isLoading={isPausing}
              leftIcon={<Pause className="h-4 w-4" />}
            >
              Pause
            </Button>
          )}
          {session.status === 'paused' && (
            <Button
              variant="primary"
              onClick={() => resumeSession()}
              isLoading={isResuming}
              leftIcon={<Play className="h-4 w-4" />}
            >
              Resume
            </Button>
          )}
          {isActive && (
            <Button
              variant="danger"
              onClick={() => setShowStopConfirm(true)}
              leftIcon={<Square className="h-4 w-4" />}
            >
              Stop
            </Button>
          )}
          {!isActive && (
            <Button
              variant="ghost"
              onClick={() => setShowDeleteConfirm(true)}
              leftIcon={<Trash2 className="h-4 w-4" />}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Progress Section */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1">
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
          </div>

          {/* Quick Stats */}
          <div className="flex gap-6 lg:ml-8">
            <div className="text-center">
              <p className="text-2xl font-semibold text-success">
                {session.stats.issuesResolved}
              </p>
              <p className="text-xs text-dark-500">Resolved</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold text-warning">
                {issueStats.pending}
              </p>
              <p className="text-xs text-dark-500">Pending</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold text-accent">
                {session.stats.commitsCreated}
              </p>
              <p className="text-xs text-dark-500">Commits</p>
            </div>
          </div>
        </div>

        {/* Current Activity */}
        {session.status === 'running' && activities.length > 0 && (
          <div className="mt-4 pt-4 border-t border-dark-700">
            <ActivityIndicator
              activity={activities[0]}
              isActive={session.status === 'running'}
            />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-dark-700">
        <nav className="flex gap-1">
          {(['issues', 'commits', 'activity', 'metrics'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
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
            onApprove={(issueId) => approveIssueMutation.mutate(issueId)}
            onReject={(issueId) => rejectIssueMutation.mutate(issueId)}
            onSkip={(issueId) => skipIssueMutation.mutate(issueId)}
            approvalMode={session.config.approvalMode}
          />
        )}

        {activeTab === 'commits' && (
          <CommitsPanel
            commits={commits}
            onRevert={(commitId) => revertCommitMutation.mutate(commitId)}
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

      {/* Modals */}
      <ConfirmModal
        isOpen={showStopConfirm}
        onClose={() => setShowStopConfirm(false)}
        onConfirm={handleStop}
        title="Stop Session"
        message="Are you sure you want to stop this session? This action cannot be undone."
        confirmText="Stop Session"
        variant="danger"
        isLoading={isStopping}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
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
}: IssuesPanelProps) {
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
          value={filters.status || ''}
          onChange={(e) => onSetFilters({ status: (e.target.value || undefined) as IssueFilter['status'] })}
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
          value={filters.type || ''}
          onChange={(e) => onSetFilters({ type: (e.target.value || undefined) as IssueFilter['type'] })}
          className="w-40"
        />
        <Input
          placeholder="Search issues..."
          value={filters.search || ''}
          onChange={(e) => onSetFilters({ search: e.target.value || undefined })}
          className="w-60"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>

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
  commits: any[];
  onRevert: (id: string) => void;
  isReverting: boolean;
}

function CommitsPanel({ commits, onRevert, isReverting }: CommitsPanelProps) {
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
          commit={commit}
          onRevert={onRevert}
          isReverting={isReverting}
        />
      ))}
    </div>
  );
}
