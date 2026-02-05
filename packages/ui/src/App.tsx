import type { JSX } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Session from './pages/Session';
import Settings from './pages/Settings';
import NewSession from './pages/NewSession';
import Onboarding from './pages/Onboarding';
import { wsClient } from './lib/websocket';

function AppLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex h-screen overflow-hidden bg-dark-900">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

export default function App(): JSX.Element {
  const connectedRef = useRef(false);
  const location = useLocation();

  useEffect(() => {
    // Only connect once, don't disconnect on unmount (singleton)
    if (!connectedRef.current) {
      connectedRef.current = true;
      wsClient.connect();
    }
    // No cleanup - WebSocket stays connected for app lifetime
  }, []);

  // Onboarding page gets its own layout (no sidebar/header)
  if (location.pathname === '/setup') {
    return (
      <div className="h-screen overflow-auto bg-dark-900">
        <Routes>
          <Route path="/setup" element={<Onboarding />} />
        </Routes>
      </div>
    );
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/session/:id" element={<Session />} />
        <Route path="/session/new" element={<NewSession />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/setup" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}
