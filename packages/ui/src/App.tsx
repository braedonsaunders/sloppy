import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Session from './pages/Session';
import Settings from './pages/Settings';
import NewSession from './pages/NewSession';
import { wsClient } from './lib/websocket';

export default function App() {
  const connectedRef = useRef(false);

  useEffect(() => {
    // Only connect once, don't disconnect on unmount (singleton)
    if (!connectedRef.current) {
      connectedRef.current = true;
      wsClient.connect();
    }
    // No cleanup - WebSocket stays connected for app lifetime
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-dark-900">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/session/:id" element={<Session />} />
            <Route path="/session/new" element={<NewSession />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
