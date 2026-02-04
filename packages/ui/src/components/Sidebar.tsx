import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  Home,
  Plus,
  Settings,
  Clock,
  CheckCircle,
  PauseCircle,
  XCircle,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { useSessions } from '@/hooks/useSession';
import type { Session } from '@/lib/api';

export interface SidebarProps {
  className?: string;
}

export default function Sidebar({ className }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { sessions, isLoading } = useSessions();

  const activeSessions = sessions.filter((s) => s.status === 'running' || s.status === 'paused');
  const recentSessions = sessions
    .filter((s) => s.status !== 'running' && s.status !== 'paused')
    .slice(0, 5);

  return (
    <aside
      className={twMerge(
        clsx(
          'flex flex-col border-r border-dark-700 bg-dark-850 transition-all duration-300',
          isCollapsed ? 'w-16' : 'w-64'
        ),
        className
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center justify-between border-b border-dark-700 px-4">
        {!isCollapsed && (
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
              <Zap className="h-5 w-5 text-accent" />
            </div>
            <span className="text-lg font-semibold text-dark-100">Sloppy</span>
          </Link>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={clsx(
            'p-1.5 text-dark-500 hover:text-dark-300 transition-colors rounded-lg hover:bg-dark-700',
            isCollapsed && 'mx-auto'
          )}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-6">
        {/* Main Navigation */}
        <div className="space-y-1">
          <NavItem
            to="/"
            icon={Home}
            label="Dashboard"
            isActive={location.pathname === '/'}
            isCollapsed={isCollapsed}
          />
          <NavItem
            to="/session/new"
            icon={Plus}
            label="New Session"
            isActive={location.pathname === '/session/new'}
            isCollapsed={isCollapsed}
          />
          <NavItem
            to="/settings"
            icon={Settings}
            label="Settings"
            isActive={location.pathname === '/settings'}
            isCollapsed={isCollapsed}
          />
        </div>

        {/* Active Sessions */}
        {!isCollapsed && activeSessions.length > 0 && (
          <div>
            <h3 className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-dark-500">
              Active Sessions
            </h3>
            <div className="space-y-1">
              {activeSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={location.pathname === `/session/${session.id}`}
                  onClick={() => navigate(`/session/${session.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Recent Sessions */}
        {!isCollapsed && recentSessions.length > 0 && (
          <div>
            <h3 className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-dark-500">
              Recent
            </h3>
            <div className="space-y-1">
              {recentSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={location.pathname === `/session/${session.id}`}
                  onClick={() => navigate(`/session/${session.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading && !isCollapsed && (
          <div className="px-2">
            <div className="animate-pulse space-y-2">
              <div className="h-8 rounded bg-dark-700" />
              <div className="h-8 rounded bg-dark-700" />
            </div>
          </div>
        )}
      </nav>

      {/* Footer */}
      {!isCollapsed && (
        <div className="border-t border-dark-700 p-3">
          <p className="text-xs text-dark-500 text-center">
            Sloppy v0.1.0
          </p>
        </div>
      )}
    </aside>
  );
}

interface NavItemProps {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
}

function NavItem({ to, icon: Icon, label, isActive, isCollapsed }: NavItemProps) {
  return (
    <Link
      to={to}
      className={clsx(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-accent/10 text-accent'
          : 'text-dark-400 hover:bg-dark-700 hover:text-dark-200',
        isCollapsed && 'justify-center px-2'
      )}
      title={isCollapsed ? label : undefined}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      {!isCollapsed && <span>{label}</span>}
    </Link>
  );
}

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onClick: () => void;
}

function SessionItem({ session, isActive, onClick }: SessionItemProps) {
  const statusIcons = {
    running: Clock,
    paused: PauseCircle,
    completed: CheckCircle,
    failed: AlertCircle,
    stopped: XCircle,
  };

  const StatusIcon = statusIcons[session.status];

  const repoName = session.repoPath.split('/').pop() || session.repoPath;

  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
        isActive
          ? 'bg-accent/10 text-accent'
          : 'text-dark-400 hover:bg-dark-700 hover:text-dark-200'
      )}
    >
      <StatusIcon
        className={clsx(
          'h-4 w-4 flex-shrink-0',
          session.status === 'running' && 'text-success animate-pulse',
          session.status === 'paused' && 'text-warning',
          session.status === 'completed' && 'text-success',
          session.status === 'failed' && 'text-error',
          session.status === 'stopped' && 'text-dark-500'
        )}
      />
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium">{repoName}</p>
        <p className="text-xs text-dark-500 truncate">
          {session.stats.issuesResolved}/{session.stats.issuesFound} resolved
        </p>
      </div>
    </button>
  );
}
