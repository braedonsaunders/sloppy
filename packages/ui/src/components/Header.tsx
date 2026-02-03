import { Link, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  Settings,
  Plus,
  Wifi,
  WifiOff,
  Home,
  Menu,
} from 'lucide-react';
import Button from './Button';
import { useWebSocket } from '@/hooks/useWebSocket';

export interface HeaderProps {
  className?: string;
  onMenuClick?: () => void;
}

export default function Header({ className, onMenuClick }: HeaderProps) {
  const location = useLocation();
  const { isConnected, connectionState } = useWebSocket();

  return (
    <header
      className={twMerge(
        'flex h-14 items-center justify-between border-b border-dark-700 bg-dark-800 px-4',
        className
      )}
    >
      {/* Left section */}
      <div className="flex items-center gap-4">
        {/* Mobile menu button */}
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2 text-dark-400 hover:text-dark-200 transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        {/* Breadcrumb / Page title */}
        <nav className="flex items-center gap-2 text-sm">
          <Link
            to="/"
            className="text-dark-400 hover:text-dark-200 transition-colors"
          >
            <Home className="h-4 w-4" />
          </Link>
          {location.pathname !== '/' && (
            <>
              <span className="text-dark-600">/</span>
              <span className="text-dark-200">
                {getPageTitle(location.pathname)}
              </span>
            </>
          )}
        </nav>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        {/* Connection status */}
        <ConnectionIndicator
          isConnected={isConnected}
          state={connectionState}
        />

        {/* New session button */}
        <Link to="/session/new">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus className="h-4 w-4" />}
          >
            <span className="hidden sm:inline">New Session</span>
          </Button>
        </Link>

        {/* Settings link */}
        <Link to="/settings">
          <Button
            variant="ghost"
            size="sm"
            className={clsx(
              'p-2',
              location.pathname === '/settings' && 'bg-dark-700'
            )}
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </header>
  );
}

interface ConnectionIndicatorProps {
  isConnected: boolean;
  state: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
}

function ConnectionIndicator({ isConnected, state }: ConnectionIndicatorProps) {
  const statusConfig = {
    connected: {
      icon: Wifi,
      color: 'text-success',
      bgColor: 'bg-success/10',
      label: 'Connected',
    },
    connecting: {
      icon: Wifi,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
      label: 'Connecting...',
    },
    reconnecting: {
      icon: WifiOff,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
      label: 'Reconnecting...',
    },
    disconnected: {
      icon: WifiOff,
      color: 'text-error',
      bgColor: 'bg-error/10',
      label: 'Disconnected',
    },
  };

  const config = statusConfig[state];
  const Icon = config.icon;

  return (
    <div
      className={clsx(
        'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium',
        config.bgColor
      )}
      title={config.label}
    >
      <Icon className={clsx('h-3.5 w-3.5', config.color)} />
      <span className={clsx('hidden sm:inline', config.color)}>
        {config.label}
      </span>
    </div>
  );
}

function getPageTitle(pathname: string): string {
  if (pathname === '/settings') return 'Settings';
  if (pathname === '/session/new') return 'New Session';
  if (pathname.startsWith('/session/')) return 'Session';
  return 'Dashboard';
}
