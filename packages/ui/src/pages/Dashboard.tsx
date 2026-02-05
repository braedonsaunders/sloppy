import type { JSX } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Zap,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle,
  AlertCircle,
  Sparkles,
  FolderOpen,
  Minus,
} from 'lucide-react';
import Button from '@/components/Button';
import { StatusBadge } from '@/components/Badge';
import ProgressBar from '@/components/ProgressBar';
import { useSessions } from '@/hooks/useSession';
import type { Session } from '@/lib/api';

export default function Dashboard(): JSX.Element {
  const { sessions, isLoading } = useSessions();
  const navigate = useNavigate();
  const [quickPath, setQuickPath] = useState('');

  // Calculate stats
  const stats = {
    totalSessions: sessions.length,
    activeSessions: sessions.filter(
      (s) => s.status === 'running' || s.status === 'paused'
    ).length,
    totalIssuesResolved: sessions.reduce(
      (sum, s) => sum + s.stats.issuesResolved,
      0
    ),
    totalIssuesFound: sessions.reduce(
      (sum, s) => sum + s.stats.issuesFound,
      0
    ),
    totalCommits: sessions.reduce(
      (sum, s) => sum + s.stats.commitsCreated,
      0
    ),
  };

  // Group sessions by repo
  const projectMap = new Map<string, Session[]>();
  for (const session of sessions) {
    const repoName = session.repoPath.split('/').pop() ?? session.repoPath;
    const existing = projectMap.get(repoName) ?? [];
    existing.push(session);
    projectMap.set(repoName, existing);
  }

  const projects = Array.from(projectMap.entries()).map(([name, projectSessions]) => {
    const sorted = [...projectSessions].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    const latest = sorted[0];
    const previous = sorted[1];
    const resolveRate = latest.stats.issuesFound > 0
      ? Math.round((latest.stats.issuesResolved / latest.stats.issuesFound) * 100)
      : 0;

    return {
      name,
      repoPath: latest.repoPath,
      latest,
      sessions: sorted,
      resolveRate,
      trend: previous
        ? latest.stats.issuesResolved > previous.stats.issuesResolved ? 'up' :
          latest.stats.issuesResolved < previous.stats.issuesResolved ? 'down' : 'stable'
        : 'stable' as 'up' | 'down' | 'stable',
    };
  });

  const activeSessions = sessions.filter(
    (s) => s.status === 'running' || s.status === 'paused'
  );

  const handleQuickClean = (): void => {
    if (!quickPath.trim()) return;
    navigate(`/session/new?path=${encodeURIComponent(quickPath)}`);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Quick Start - Hero Section */}
      <div className="rounded-2xl border border-dark-700 bg-gradient-to-br from-dark-800 via-dark-800 to-accent/5 p-8">
        <div className="flex items-center gap-3 mb-2">
          <Sparkles className="h-6 w-6 text-accent" />
          <h1 className="text-2xl font-bold text-dark-100">Clean This Project</h1>
        </div>
        <p className="text-dark-400 mb-6 max-w-xl">
          Point Sloppy at any codebase and it will find and fix issues automatically.
          Each fix is an atomic, revertible git commit.
        </p>
        <div className="flex gap-3 max-w-2xl">
          <div className="relative flex-1">
            <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-dark-500" />
            <input
              type="text"
              value={quickPath}
              onChange={(e) => setQuickPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleQuickClean(); }}
              placeholder="/path/to/your/project or https://github.com/user/repo"
              className="w-full rounded-xl border border-dark-600 bg-dark-900 py-3 pl-11 pr-4 text-dark-100 placeholder-dark-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <Button
            variant="primary"
            onClick={handleQuickClean}
            disabled={!quickPath.trim()}
            className="px-8 rounded-xl"
            leftIcon={<Zap className="h-5 w-5" />}
          >
            Clean
          </Button>
        </div>
        <div className="flex items-center gap-1 mt-3 text-xs text-dark-500">
          <span>or</span>
          <Link to="/session/new" className="text-accent hover:text-accent-hover underline">
            configure a session
          </Link>
          <span>with advanced options</span>
        </div>
      </div>

      {/* Compact Stats Bar */}
      <div className="flex items-center gap-6 rounded-xl border border-dark-700 bg-dark-800 px-6 py-3">
        <StatPill icon={Zap} label="Active" value={stats.activeSessions} color="text-accent" />
        <div className="h-4 w-px bg-dark-700" />
        <StatPill icon={CheckCircle} label="Resolved" value={stats.totalIssuesResolved} color="text-success" />
        <div className="h-4 w-px bg-dark-700" />
        <StatPill icon={AlertCircle} label="Found" value={stats.totalIssuesFound} color="text-warning" />
        <div className="h-4 w-px bg-dark-700" />
        <StatPill icon={TrendingUp} label="Commits" value={stats.totalCommits} color="text-blue-400" />
        <div className="flex-1" />
        <Link to="/session/new">
          <Button variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />}>
            New Session
          </Button>
        </Link>
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

      {/* Projects Grid */}
      <section>
        <h2 className="mb-4 text-lg font-medium text-dark-200">Your Projects</h2>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-xl bg-dark-800" />
            ))}
          </div>
        ) : projects.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.name} project={project} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>
    </div>
  );
}

interface StatPillProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}

function StatPill({ icon: Icon, label, value, color }: StatPillProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-4 w-4 ${color}`} />
      <span className="text-sm font-medium text-dark-100">{value}</span>
      <span className="text-xs text-dark-500">{label}</span>
    </div>
  );
}

interface ProjectCardProps {
  project: {
    name: string;
    repoPath: string;
    latest: Session;
    sessions: Session[];
    resolveRate: number;
    trend: 'up' | 'down' | 'stable';
  };
}

function ProjectCard({ project }: ProjectCardProps): JSX.Element {
  const TrendIcon = project.trend === 'up' ? TrendingUp : project.trend === 'down' ? TrendingDown : Minus;
  const trendColor = project.trend === 'up' ? 'text-success' : project.trend === 'down' ? 'text-error' : 'text-dark-500';

  // Score approximation based on resolve rate
  const score = project.resolveRate;
  const scoreColor = score >= 80 ? 'text-success' : score >= 60 ? 'text-warning' : 'text-error';
  const strokeColor = score >= 80 ? 'stroke-success' : score >= 60 ? 'stroke-warning' : 'stroke-error';

  return (
    <Link
      to={`/session/${project.latest.id}`}
      className="group rounded-xl border border-dark-700 bg-dark-800 p-5 transition-all hover:border-dark-600 hover:bg-dark-750"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-dark-100 truncate">{project.name}</h3>
          <p className="text-xs text-dark-500 mt-0.5">
            {project.sessions.length} session{project.sessions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <TrendIcon className={`h-4 w-4 ${trendColor}`} />
        </div>
      </div>

      {/* Score Circle */}
      <div className="flex items-center justify-center mb-4">
        <div className="relative w-24 h-24">
          <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" fill="none" className="stroke-dark-700" strokeWidth="8" />
            <circle
              cx="50" cy="50" r="42" fill="none"
              className={strokeColor}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${score * 2.64} 264`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-2xl font-bold ${scoreColor}`}>{score}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-xs text-dark-400">
        <span>{project.latest.stats.issuesResolved}/{project.latest.stats.issuesFound} resolved</span>
        <StatusBadge status={project.latest.status} size="sm" />
      </div>
    </Link>
  );
}

interface ActiveSessionCardProps {
  session: Session;
}

function ActiveSessionCard({ session }: ActiveSessionCardProps): JSX.Element {
  const repoName = session.repoPath.split('/').pop() ?? session.repoPath;
  const progress = session.stats.issuesFound > 0 ? (session.stats.issuesResolved / session.stats.issuesFound) * 100 : 0;
  const elapsedMinutes = Math.floor(session.stats.elapsedTime / 60);

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
            {session.stats.issuesResolved}/{session.stats.issuesFound} issues
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

function EmptyState(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-dark-600 bg-dark-850 py-12 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-dark-700">
        <Zap className="h-6 w-6 text-dark-400" />
      </div>
      <h3 className="mt-4 text-lg font-medium text-dark-200">
        No sessions yet
      </h3>
      <p className="mt-2 text-sm text-dark-400 max-w-sm">
        Enter a project path above and click Clean to get started, or create a session with custom options.
      </p>
      <Link to="/session/new" className="mt-6">
        <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>
          Create Session
        </Button>
      </Link>
    </div>
  );
}
