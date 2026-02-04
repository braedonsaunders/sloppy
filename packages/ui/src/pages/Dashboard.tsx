import { Link } from 'react-router-dom';
import {
  Plus,
  Zap,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import Button from '@/components/Button';
import { StatusBadge } from '@/components/Badge';
import ProgressBar from '@/components/ProgressBar';
import { useSessions } from '@/hooks/useSession';
import type { Session } from '@/lib/api';

export default function Dashboard() {
  const { sessions, isLoading } = useSessions();

  // Calculate stats
  const stats = {
    totalSessions: sessions.length,
    activeSessions: sessions.filter(
      (s) => s.status === 'running' || s.status === 'paused'
    ).length,
    totalIssuesResolved: sessions.reduce(
      (sum, s) => sum + (s.stats?.issuesResolved ?? 0),
      0
    ),
    totalIssuesFound: sessions.reduce(
      (sum, s) => sum + (s.stats?.issuesFound ?? 0),
      0
    ),
    totalCommits: sessions.reduce(
      (sum, s) => sum + (s.stats?.commitsCreated ?? 0),
      0
    ),
  };

  const activeSessions = sessions.filter(
    (s) => s.status === 'running' || s.status === 'paused'
  );

  const recentSessions = sessions
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )
    .slice(0, 10);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-dark-100">Dashboard</h1>
          <p className="mt-1 text-dark-400">
            Monitor your code quality improvement sessions
          </p>
        </div>
        <Link to="/session/new">
          <Button
            variant="primary"
            leftIcon={<Plus className="h-4 w-4" />}
          >
            New Session
          </Button>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          icon={Zap}
          label="Active Sessions"
          value={stats.activeSessions}
          color="accent"
        />
        <StatCard
          icon={CheckCircle}
          label="Issues Resolved"
          value={stats.totalIssuesResolved}
          color="success"
        />
        <StatCard
          icon={AlertCircle}
          label="Issues Found"
          value={stats.totalIssuesFound}
          color="warning"
        />
        <StatCard
          icon={TrendingUp}
          label="Total Commits"
          value={stats.totalCommits}
          color="info"
        />
      </div>

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-medium text-dark-200">
            Active Sessions
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {activeSessions.map((session) => (
              <ActiveSessionCard key={session.id} session={session} />
            ))}
          </div>
        </section>
      )}

      {/* Recent Sessions */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-dark-200">Recent Sessions</h2>
          {sessions.length > 10 && (
            <Link
              to="/sessions"
              className="text-sm text-accent hover:text-accent-hover flex items-center gap-1"
            >
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        {isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-lg bg-dark-800"
              />
            ))}
          </div>
        ) : recentSessions.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {recentSessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>
    </div>
  );
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: 'accent' | 'success' | 'warning' | 'info';
}

function StatCard({ icon: Icon, label, value, color }: StatCardProps) {
  const colorStyles = {
    accent: 'bg-accent/10 text-accent',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    info: 'bg-blue-500/10 text-blue-400',
  };

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
      <div
        className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${colorStyles[color]}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-2xl font-semibold text-dark-100">{value}</p>
      <p className="mt-1 text-sm text-dark-400">{label}</p>
    </div>
  );
}

interface ActiveSessionCardProps {
  session: Session;
}

function ActiveSessionCard({ session }: ActiveSessionCardProps) {
  const repoPath = session.repoPath || '';
  const repoName = repoPath.split('/').pop() || repoPath || 'Unknown';
  const issuesFound = session.stats?.issuesFound ?? 0;
  const issuesResolved = session.stats?.issuesResolved ?? 0;
  const progress = issuesFound > 0 ? (issuesResolved / issuesFound) * 100 : 0;
  const elapsedMinutes = Math.floor((session.stats?.elapsedTime ?? 0) / 60);

  return (
    <Link
      to={`/session/${session.id}`}
      className="block rounded-xl border border-dark-700 bg-dark-800 p-5 transition-all hover:border-dark-600 hover:bg-dark-750"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-dark-100">{repoName}</h3>
            <StatusBadge status={session.status} />
          </div>
          <p className="mt-1 text-sm text-dark-400">
            {session.provider} / {session.model}
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm text-dark-400">
          <Clock className="h-4 w-4" />
          <span>{elapsedMinutes}m</span>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-dark-400">Progress</span>
          <span className="text-dark-200">
            {issuesResolved}/{issuesFound} issues
          </span>
        </div>
        <ProgressBar
          value={progress}
          variant={session.status === 'paused' ? 'warning' : 'gradient'}
          animated={session.status === 'running'}
        />
      </div>
    </Link>
  );
}

interface SessionCardProps {
  session: Session;
}

function SessionCard({ session }: SessionCardProps) {
  const repoPath = session.repoPath || '';
  const repoName = repoPath.split('/').pop() || repoPath || 'Unknown';
  const date = session.startedAt
    ? new Date(session.startedAt).toLocaleDateString()
    : 'N/A';
  const issuesResolved = session.stats?.issuesResolved ?? 0;
  const issuesFound = session.stats?.issuesFound ?? 0;

  return (
    <Link
      to={`/session/${session.id}`}
      className="flex items-center gap-4 rounded-xl border border-dark-700 bg-dark-800 p-4 transition-all hover:border-dark-600 hover:bg-dark-750"
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-lg ${
          session.status === 'completed'
            ? 'bg-success/10 text-success'
            : session.status === 'failed'
            ? 'bg-error/10 text-error'
            : 'bg-dark-700 text-dark-400'
        }`}
      >
        {session.status === 'completed' ? (
          <CheckCircle className="h-5 w-5" />
        ) : session.status === 'failed' ? (
          <AlertCircle className="h-5 w-5" />
        ) : (
          <Clock className="h-5 w-5" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-dark-200 truncate">{repoName}</h3>
          <StatusBadge status={session.status} size="sm" />
        </div>
        <p className="text-sm text-dark-500">
          {date} • {issuesResolved}/{issuesFound} resolved
        </p>
      </div>

      <ArrowRight className="h-4 w-4 text-dark-500" />
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-dark-600 bg-dark-850 py-12 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-dark-700">
        <Zap className="h-6 w-6 text-dark-400" />
      </div>
      <h3 className="mt-4 text-lg font-medium text-dark-200">
        No sessions yet
      </h3>
      <p className="mt-2 text-sm text-dark-400 max-w-sm">
        Start your first code quality improvement session to automatically fix
        issues in your codebase.
      </p>
      <Link to="/session/new" className="mt-6">
        <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>
          Create Session
        </Button>
      </Link>
    </div>
  );
}
