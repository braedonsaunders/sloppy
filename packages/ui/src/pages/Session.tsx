import type { JSX } from 'react';
import { useState, useEffect, useRef } from 'react';
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
  Info,
  Cpu,
  Zap,
  FileCode,
  Terminal,
  ChevronDown,
  ChevronUp,
  Search,
  Wrench,
} from 'lucide-react';
import Button from '@/components/Button';
import Badge, { StatusBadge } from '@/components/Badge';
import ProgressBar from '@/components/ProgressBar';
import IssueCard from '@/components/IssueCard';
import CommitCard from '@/components/CommitCard';
import MetricsChart from '@/components/MetricsChart';
import LLMRequestPanel, { LLMStatusIndicator } from '@/components/LLMRequestPanel';
import { ConfirmModal } from '@/components/Modal';
import Select from '@/components/Select';
import Input from '@/components/Input';
import { useSession } from '@/hooks/useSession';
import { useSessionWebSocket } from '@/hooks/useWebSocket';
import { useSessionStore } from '@/stores/session';
import { useIssuesStore, selectFilteredIssues, type IssueFilter } from '@/stores/issues';
import { api } from '@/lib/api';
import type { ScoreData, Activity } from '@/lib/api';
import SloppyScore from '@/components/SloppyScore';

type Tab = 'issues' | 'commits' | 'metrics';

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
    <div className="max-w-[1600px] mx-auto space-y-4">
      {/* Header - Compact */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-dark-100">{repoName}</h1>
              <StatusBadge status={session.status} />
            </div>
            <p className="mt-0.5 text-sm text-dark-400">
              {session.provider} / {session.model}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Compact Stats Bar */}
          <div className="flex items-center gap-3 rounded-lg bg-dark-800 px-3 py-1.5 border border-dark-700 text-xs">
            <span className="flex items-center gap-1 text-dark-300">
              <Clock className="h-3.5 w-3.5 text-dark-500" />
              <span className="font-mono">{String(elapsedMinutes).padStart(2, '0')}:{String(elapsedSeconds).padStart(2, '0')}</span>
            </span>
            <span className="text-dark-600">|</span>
            <span className="flex items-center gap-1 text-dark-300">
              <Cpu className="h-3.5 w-3.5 text-dark-500" />
              <span className="font-mono">{llmRequests.length} calls</span>
            </span>
            <span className="text-dark-600">|</span>
            <span className="flex items-center gap-1 text-dark-300">
              <FileCode className="h-3.5 w-3.5 text-dark-500" />
              <span className="font-mono">{issues.length} issues</span>
            </span>
            {activeLLMRequest && (
              <>
                <span className="text-dark-600">|</span>
                <LLMStatusIndicator
                  activeRequest={activeLLMRequest}
                  totalRequests={llmRequests.length}
                />
              </>
            )}
          </div>

          {/* Action buttons */}
          {session.status === 'running' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { void pauseSession(); }}
              isLoading={isPausing}
              leftIcon={<Pause className="h-3.5 w-3.5" />}
            >
              Pause
            </Button>
          )}
          {session.status === 'paused' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => { void resumeSession(); }}
              isLoading={isResuming}
              leftIcon={<Play className="h-3.5 w-3.5" />}
            >
              Resume
            </Button>
          )}
          {isActive && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => { setShowStopConfirm(true); }}
              leftIcon={<Square className="h-3.5 w-3.5" />}
            >
              Stop
            </Button>
          )}
          {!isActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowDeleteConfirm(true); }}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Live Activity Feed - Always Visible */}
      <LiveActivityFeed
        activities={activities}
        isActive={session.status === 'running'}
        llmRequests={llmRequests}
        activeLLMRequest={activeLLMRequest}
      />

      {/* Stats + Progress Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          icon={<FileCode className="h-4 w-4" />}
          label="Issues"
          value={String(session.stats.issuesFound)}
          detail={
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-error">{issueBreakdown.errors} err</span>
              <span className="text-warning">{issueBreakdown.warnings} warn</span>
              <span className="text-accent">{issueBreakdown.info} info</span>
            </div>
          }
        />
        <StatCard
          icon={<CheckCircle className="h-4 w-4" />}
          label="Resolved"
          value={String(session.stats.issuesResolved)}
          valueColor="text-success"
          detail={
            <span className="text-xs text-dark-500">
              {session.stats.issuesFound > 0
                ? `${String(Math.round(progress))}%`
                : '-'}
            </span>
          }
        />
        <StatCard
          icon={<Cpu className="h-4 w-4" />}
          label="LLM Calls"
          value={String(llmRequests.length)}
          detail={
            activeLLMRequest
              ? <span className="text-xs text-accent animate-pulse">Active</span>
              : <span className="text-xs text-dark-500">Idle</span>
          }
        />
        <StatCard
          icon={<GitCommit className="h-4 w-4" />}
          label="Commits"
          value={String(session.stats.commitsCreated)}
          valueColor="text-accent"
        />
        <StatCard
          icon={<Zap className="h-4 w-4" />}
          label="Tokens"
          value={formatTokens(
            llmRequests.reduce(
              (acc, r) => acc + (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
              0
            )
          )}
        />
      </div>

      {/* Progress Bar - Only when active or has issues */}
      {(isActive || session.stats.issuesFound > 0) && (
        <div className="rounded-lg border border-dark-700 bg-dark-800 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-dark-400">Resolution Progress</span>
            <span className="text-xs font-medium text-dark-300">
              {session.stats.issuesResolved} / {session.stats.issuesFound}
            </span>
          </div>
          <ProgressBar
            value={progress}
            variant={session.status === 'running' ? 'gradient' : 'default'}
            animated={session.status === 'running'}
            size="md"
          />
        </div>
      )}

      {/* Session Complete Summary */}
      {(session.status === 'completed' || session.status === 'stopped') && (
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className={`flex h-9 w-9 items-center justify-center rounded-full ${
              session.status === 'completed' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
            }`}>
              {session.status === 'completed' ? <CheckCircle className="h-5 w-5" /> : <Square className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-dark-100">
                Session {session.status === 'completed' ? 'Complete' : 'Stopped'}
              </h2>
              <p className="text-sm text-dark-400">
                {session.stats.issuesFound} issues found, {session.stats.issuesResolved} resolved
                {session.stats.commitsCreated > 0 && ` across ${String(session.stats.commitsCreated)} commits`}
                {' '}in {String(elapsedMinutes)}m {String(elapsedSeconds)}s
                {llmRequests.length > 0 && ` using ${String(llmRequests.length)} LLM calls`}
              </p>
            </div>
            {!scoreData && (
              <button
                onClick={() => {
                  if (id === undefined || id === '') { return; }
                  void api.scores.compute(id).then((data) => {
                    setScoreData(data);
                  });
                }}
                className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
              >
                Compute Score
              </button>
            )}
          </div>
          {scoreData && (
            <SloppyScore
              score={scoreData.score}
              breakdown={scoreData.breakdown}
              issuesBefore={scoreData.issuesBefore}
              issuesAfter={scoreData.issuesAfter}
            />
          )}
        </div>
      )}

      {/* Main Content - Two Column: Issues/Commits + LLM Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column - Issues, Commits, Metrics */}
        <div className="lg:col-span-2 space-y-4">
          {/* Tabs */}
          <div className="border-b border-dark-700">
            <nav className="flex gap-1">
              {(['issues', 'commits', 'metrics'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab); }}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
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

// Stat card component
interface StatCardProps {
  icon: JSX.Element;
  label: string;
  value: string;
  valueColor?: string;
  detail?: JSX.Element;
}

function StatCard({ icon, label, value, valueColor = 'text-dark-100', detail }: StatCardProps): JSX.Element {
  return (
    <div className="rounded-lg border border-dark-700 bg-dark-800 p-3">
      <div className="flex items-center gap-1.5 text-dark-400 mb-1">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`text-xl font-semibold ${valueColor}`}>{value}</p>
      {detail !== undefined && <div className="mt-1">{detail}</div>}
    </div>
  );
}

// Live activity feed - terminal-style, always visible
interface LiveActivityFeedProps {
  activities: Activity[];
  isActive: boolean;
  llmRequests: { id: string; status: string }[];
  activeLLMRequest?: { id: string; status: string; model: string; provider: string };
}

function LiveActivityFeed({ activities, isActive, llmRequests, activeLLMRequest }: LiveActivityFeedProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activities.length, isExpanded]);

  const activityIcons: Record<string, typeof Search> = {
    analyzing: Search,
    fixing: Wrench,
    error: AlertCircle,
    info: Info,
    success: CheckCircle,
  };

  const activityColors: Record<string, string> = {
    analyzing: 'text-accent',
    fixing: 'text-warning',
    error: 'text-error',
    info: 'text-dark-400',
    success: 'text-success',
  };

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-900 overflow-hidden">
      {/* Feed Header */}
      <button
        type="button"
        onClick={() => { setIsExpanded(!isExpanded); }}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-dark-800/50 border-b border-dark-700 hover:bg-dark-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-dark-200">Live Analysis Feed</span>
          {isActive && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <span className="text-xs text-success">Live</span>
            </span>
          )}
          {activeLLMRequest && (
            <span className="text-xs text-dark-400 ml-2">
              {activeLLMRequest.provider}/{activeLLMRequest.model}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-dark-500">{activities.length} events</span>
          {isExpanded ? <ChevronUp className="h-4 w-4 text-dark-500" /> : <ChevronDown className="h-4 w-4 text-dark-500" />}
        </div>
      </button>

      {/* Feed Content */}
      {isExpanded && (
        <div
          ref={scrollRef}
          className="overflow-y-auto font-mono text-xs leading-relaxed"
          style={{ maxHeight: '280px' }}
        >
          {activities.length === 0 ? (
            <div className="p-6 text-center">
              {isActive ? (
                <div className="flex items-center justify-center gap-2 text-dark-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Waiting for analysis events...</span>
                </div>
              ) : (
                <span className="text-dark-500">No activity yet</span>
              )}
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {[...activities].reverse().map((activity, i) => {
                const Icon = activityIcons[activity.type] ?? Info;
                const color = activityColors[activity.type] ?? 'text-dark-400';
                const time = new Date(activity.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });

                return (
                  <div
                    key={activity.id ?? `activity-${String(i)}`}
                    className="flex items-start gap-2 px-2 py-1 rounded hover:bg-dark-800/50 group"
                  >
                    <span className="text-dark-600 flex-shrink-0 pt-0.5">{time}</span>
                    <Icon className={`h-3.5 w-3.5 flex-shrink-0 mt-0.5 ${color}`} />
                    <span className={`${color} break-all`}>{activity.message}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
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
              issues.filter(i => i.status === 'pending').forEach(i => { onApprove(i.id); });
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
