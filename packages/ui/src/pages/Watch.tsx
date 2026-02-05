import type { JSX } from 'react';
import { useState, useEffect, useRef } from 'react';
import {
  Eye,
  Play,
  Pause,
  Square,
  FolderOpen,
  FileCode,
  Zap,
  CheckCircle,
  Clock,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import Button from '@/components/Button';
import { api } from '@/lib/api';
import { wsClient } from '@/lib/websocket';

interface WatchSession {
  id: string;
  repoPath: string;
  status: string;
  startedAt: string;
  issuesFixed: number;
  lastActivity: string;
  changedFiles?: string[];
}

interface WatchEvent {
  id: string;
  type: 'change' | 'fix' | 'error' | 'info';
  message: string;
  timestamp: string;
  files?: string[];
}

export default function Watch(): JSX.Element {
  const [repoPath, setRepoPath] = useState('');
  const [activeSession, setActiveSession] = useState<WatchSession | null>(null);
  const [events, setEvents] = useState<WatchEvent[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  // Listen for watch events via WebSocket
  useEffect(() => {
    const unsubChange = wsClient.subscribe('watch:change', (msg) => {
      const payload = msg.payload as { files?: string[]; message?: string };
      setEvents(prev => [{
        id: `evt-${String(Date.now())}`,
        type: 'change' as const,
        message: payload.message ?? 'Files changed',
        timestamp: new Date().toISOString(),
        files: payload.files,
      }, ...prev].slice(0, 200));
    });

    const unsubActivity = wsClient.subscribe('activity:log', (msg) => {
      const payload = msg.payload as { watchSessionId?: string; type?: string; message?: string };
      if (payload.watchSessionId !== undefined && payload.watchSessionId !== '') {
        setEvents(prev => [{
          id: `evt-${String(Date.now())}`,
          type: (payload.type === 'error' ? 'error' : payload.type === 'success' ? 'fix' : 'info') as WatchEvent['type'],
          message: payload.message ?? '',
          timestamp: new Date().toISOString(),
        }, ...prev].slice(0, 200));
      }
    });

    return (): void => {
      unsubChange();
      unsubActivity();
    };
  }, []);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [events.length]);

  const handleStart = async (): Promise<void> => {
    if (repoPath.trim() === '') {
      return;
    }
    setIsStarting(true);
    try {
      const result = await api.watch.start(repoPath);
      setActiveSession({
        id: result.id,
        repoPath: result.repoPath,
        status: result.status,
        startedAt: result.startedAt,
        issuesFixed: 0,
        lastActivity: result.startedAt,
      });
      setEvents(prev => [{
        id: `evt-${String(Date.now())}`,
        type: 'info' as const,
        message: `Started watching ${repoPath}`,
        timestamp: new Date().toISOString(),
      }, ...prev]);
    } catch (err) {
      setEvents(prev => [{
        id: `evt-${String(Date.now())}`,
        type: 'error' as const,
        message: `Failed to start: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      }, ...prev]);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async (): Promise<void> => {
    if (activeSession === null) {
      return;
    }
    try {
      await api.watch.stop(activeSession.id);
      setActiveSession(null);
      setEvents(prev => [{
        id: `evt-${String(Date.now())}`,
        type: 'info' as const,
        message: 'Watch mode stopped',
        timestamp: new Date().toISOString(),
      }, ...prev]);
    } catch {
      // ignore
    }
  };

  const handlePause = async (): Promise<void> => {
    if (activeSession === null) {
      return;
    }
    await api.watch.pause(activeSession.id);
    setActiveSession(prev => prev !== null ? { ...prev, status: 'paused' } : null);
  };

  const handleResume = async (): Promise<void> => {
    if (activeSession === null) {
      return;
    }
    await api.watch.resume(activeSession.id);
    setActiveSession(prev => prev !== null ? { ...prev, status: 'watching' } : null);
  };

  const eventIcons: Record<string, typeof CheckCircle> = {
    change: FileCode,
    fix: CheckCircle,
    error: AlertCircle,
    info: Eye,
  };

  const eventColors: Record<string, string> = {
    change: 'text-accent',
    fix: 'text-success',
    error: 'text-error',
    info: 'text-dark-400',
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Eye className="h-6 w-6 text-accent" />
            <h1 className="text-2xl font-semibold text-dark-100">Watch Mode</h1>
            {activeSession?.status === 'watching' && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success/10 text-success text-xs font-medium">
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                Active
              </span>
            )}
          </div>
          <p className="mt-1 text-dark-400">
            Sloppy watches your code and automatically fixes issues as you work
          </p>
        </div>
      </div>

      {/* Start/Control Bar */}
      {activeSession === null ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-dark-500" />
              <input
                type="text"
                value={repoPath}
                onChange={(e) => { setRepoPath(e.target.value); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { void handleStart(); } }}
                placeholder="/path/to/your/project"
                className="w-full rounded-xl border border-dark-600 bg-dark-900 py-3 pl-11 pr-4 text-dark-100 placeholder-dark-500 focus:border-accent focus:outline-none"
              />
            </div>
            <Button
              variant="primary"
              onClick={() => { void handleStart(); }}
              isLoading={isStarting}
              disabled={repoPath.trim() === ''}
              leftIcon={<Play className="h-4 w-4" />}
              className="px-6"
            >
              Start Watching
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-accent" />
                <span className="text-sm font-medium text-dark-200">{activeSession.repoPath}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-dark-400">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Since {new Date(activeSession.startedAt).toLocaleTimeString()}
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5 text-success" />
                  {activeSession.issuesFixed} fixed
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeSession.status === 'watching' ? (
                <Button variant="secondary" size="sm" onClick={() => { void handlePause(); }} leftIcon={<Pause className="h-3.5 w-3.5" />}>
                  Pause
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => { void handleResume(); }} leftIcon={<Play className="h-3.5 w-3.5" />}>
                  Resume
                </Button>
              )}
              <Button variant="danger" size="sm" onClick={() => { void handleStop(); }} leftIcon={<Square className="h-3.5 w-3.5" />}>
                Stop
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Live Feed */}
      <div className="rounded-xl border border-dark-700 bg-dark-900 overflow-hidden">
        <div className="px-4 py-3 bg-dark-800/50 border-b border-dark-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 text-accent ${activeSession?.status === 'watching' ? 'animate-spin' : ''}`} />
            <span className="text-sm font-medium text-dark-200">Live Feed</span>
          </div>
          <span className="text-xs text-dark-500">{String(events.length)} events</span>
        </div>
        <div
          ref={feedRef}
          className="max-h-[500px] overflow-y-auto p-2 font-mono text-xs"
        >
          {events.length === 0 ? (
            <div className="p-8 text-center text-dark-500">
              {activeSession !== null ? 'Waiting for file changes...' : 'Start watching to see activity'}
            </div>
          ) : (
            <div className="space-y-0.5">
              {events.map((event) => {
                const Icon = eventIcons[event.type] ?? Eye;
                const color = eventColors[event.type] ?? 'text-dark-400';
                const time = new Date(event.timestamp).toLocaleTimeString([], {
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                });

                return (
                  <div key={event.id} className="flex items-start gap-2 px-2 py-1 rounded hover:bg-dark-800/50">
                    <span className="text-dark-600 flex-shrink-0">{time}</span>
                    <Icon className={`h-3.5 w-3.5 flex-shrink-0 mt-0.5 ${color}`} />
                    <span className={`${color} break-all`}>{event.message}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
