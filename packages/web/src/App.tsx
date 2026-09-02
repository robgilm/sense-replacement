import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  FileText,
  House,
  Plug,
  Puzzle,
  Radio,
  Settings as SettingsIcon,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { StatusResponse } from '@sense/shared';
import { get } from './api/client.js';
import { Live } from './pages/Live.js';
import { Now } from './pages/Now.js';
import { Devices } from './pages/Devices.js';
import { Detection } from './pages/Detection.js';
import { Trends } from './pages/Trends.js';
import { PowerQuality } from './pages/PowerQuality.js';
import { Reports } from './pages/Reports.js';
import { Settings } from './pages/Settings.js';
import { SetupMfa } from './pages/SetupMfa.js';

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/now', label: 'Now', icon: House },
  { to: '/', label: 'Live', icon: Zap },
  { to: '/devices', label: 'Devices', icon: Plug },
  { to: '/detection', label: 'Detection', icon: Puzzle },
  { to: '/trends', label: 'Trends', icon: BarChart3 },
  { to: '/power-quality', label: 'Power', icon: Activity },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function Nav() {
  const link = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
    borderBottomColor: isActive ? 'var(--text-primary)' : 'transparent',
  });
  return (
    <>
      {/* desktop top bar — matches the real Sense app's horizontal nav:
          icon+label pairs in a row, active tab underlined, not a sidebar. */}
      <nav
        className="fixed inset-x-0 top-0 z-20 hidden h-14 items-center gap-1 border-b px-4 md:flex"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            style={link}
            className="flex h-14 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors"
          >
            <n.icon size={18} strokeWidth={2} />
            {n.label}
          </NavLink>
        ))}
      </nav>
      {/* mobile bottom bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex border-t md:hidden"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            style={link}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs"
          >
            <n.icon size={20} strokeWidth={2} />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export function App() {
  const location = useLocation();
  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => get<StatusResponse>('/api/status'),
    refetchInterval: 5000,
  });

  if (status.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ color: 'var(--text-muted)' }}>
        Connecting…
      </div>
    );
  }

  if (status.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card max-w-sm p-6 text-center">
          <Radio size={32} className="mx-auto" />
          <div className="mt-2 font-semibold">Can't reach the server</div>
          <div className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {(status.error as Error).message}
          </div>
        </div>
      </div>
    );
  }

  const s = status.data!;
  if (s.authState === 'needs_mfa') {
    return <SetupMfa message={null} />;
  }
  if (s.authState === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card max-w-md p-6 text-center">
          <TriangleAlert size={32} className="mx-auto" />
          <div className="mt-2 font-semibold">Sense sign-in failed</div>
          <div className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Check SENSE_EMAIL / SENSE_PASSWORD in your .env and restart. Archived data is still served via the API.
          </div>
        </div>
      </div>
    );
  }

  // The Now page's bubble layout wants the full window, and the Devices
  // sidebar+detail split view wants more than the app's usual centered
  // column, so both opt out of the max-width container.
  const isNow = location.pathname === '/now';
  const isDevices = location.pathname.startsWith('/devices');

  return (
    <div className="min-h-screen">
      <Nav />
      <main
        className={
          isNow
            ? 'md:pt-14'
            : isDevices
              ? 'px-4 pb-20 pt-4 md:pb-8 md:pt-[4.5rem]'
              : 'mx-auto max-w-5xl px-4 pb-20 pt-4 md:pb-8 md:pt-[4.5rem]'
        }
      >
        {!s.cloudConnected && s.authState === 'ok' && (
          <div
            className="mb-4 rounded-md px-3 py-2 text-sm"
            style={{ background: 'var(--surface-2)', color: 'var(--status-warning)' }}
          >
            Sense cloud disconnected — showing archived data
          </div>
        )}
        <Routes>
          <Route path="/" element={<Live />} />
          <Route path="/now" element={<Now />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/devices/:id" element={<Devices />} />
          <Route path="/detection" element={<Detection />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/power-quality" element={<PowerQuality />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
