import { NavLink, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Database,
  TestTube2,
  Archive,
  Settings,
  FileText,
  Sun,
  Moon,
  LogOut,
  Shield,
  Eye,
  Users,
  Gauge,
  Settings2,
  Layers,
  DollarSign,
} from 'lucide-react';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/cache', icon: Archive, label: 'Cache Viewer' },
  { path: '/cost-savings', icon: DollarSign, label: 'Cost Savings' },
  { path: '/test', icon: TestTube2, label: 'Test Request' },
  { path: '/sources', icon: Database, label: 'Sources' },
];

const viewerNavItems = [
  { path: '/storage-pools', icon: Layers, label: 'Storage Pools' },
  { path: '/cache-policies', icon: Settings2, label: 'Cache Policies' },
  { path: '/rate-limits', icon: Gauge, label: 'Rate Limits' },
];

const adminNavItems = [
  { path: '/users', icon: Users, label: 'Users' },
  { path: '/config', icon: Settings, label: 'Configuration' },
  { path: '/audit', icon: FileText, label: 'Audit Logs' },
];

export default function Layout({ children }) {
  const { theme, toggleTheme } = useTheme();
  const { user, role, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10">
              <img src="/favicon-96x96.png" alt="APi-Saver" className="w-full h-full rounded-lg" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-[var(--color-text)]">APi-Saver</h1>
              <p className="text-xs text-primary-500 font-medium">by DevOps-Corp</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `nav-link ${isActive ? 'active' : ''}`
              }
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </NavLink>
          ))}
          
          {/* Viewer Section - Rate Limits, Cache Policies, Storage Pools */}
          {viewerNavItems.length > 0 && (
            <>
              {viewerNavItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `nav-link ${isActive ? 'active' : ''}`
                  }
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </>
          )}
          
          {/* Admin Section */}
          {role === 'admin' && (
            <>
              <div className="pt-4 pb-2">
                <p className="px-4 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  Admin
                </p>
              </div>
              {adminNavItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `nav-link ${isActive ? 'active' : ''}`
                  }
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--color-border)] space-y-3">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <span className="text-sm text-[var(--color-text-muted)]">Theme</span>
            <div className="flex items-center gap-2">
              {theme === 'dark' ? (
                <Moon className="w-4 h-4 text-primary-400" />
              ) : (
                <Sun className="w-4 h-4 text-amber-500" />
              )}
            </div>
          </button>

          {/* User info */}
          <div className="px-4 py-2">
            <p className="text-xs text-[var(--color-text-muted)]">Logged in as</p>
            <p className="text-sm font-medium text-[var(--color-text)] truncate">
              {user?.email || user?.name || 'App'}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              {role === 'admin' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400">
                  <Shield className="w-3 h-3" />
                  Admin
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-surface-100 dark:bg-surface-700 text-[var(--color-text-muted)]">
                  <Eye className="w-3 h-3" />
                  Viewer
                </span>
              )}
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

