import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import { Loader2 } from 'lucide-react';

// Lazy load pages for code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Sources = lazy(() => import('./pages/Sources'));
const TestRequest = lazy(() => import('./pages/TestRequest'));
const CacheViewer = lazy(() => import('./pages/CacheViewer'));
const Config = lazy(() => import('./pages/Config'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const Users = lazy(() => import('./pages/Users'));
const RateLimits = lazy(() => import('./pages/RateLimits'));
const CachePolicies = lazy(() => import('./pages/CachePolicies'));
const StoragePools = lazy(() => import('./pages/StoragePools'));
const PoolDetail = lazy(() => import('./pages/PoolDetail'));
const CostSavings = lazy(() => import('./pages/CostSavings'));

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function AdminRoute({ children }) {
  const { isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <ErrorBoundary>
                  <Suspense fallback={<LoadingFallback />}>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/cache" element={<CacheViewer />} />
                      <Route path="/cost-savings" element={<CostSavings />} />
                      <Route path="/test" element={<TestRequest />} />
                      <Route path="/sources" element={<Sources />} />
                      <Route path="/storage-pools" element={<StoragePools />} />
                      <Route path="/storage-pools/:id" element={<PoolDetail />} />
                      <Route path="/rate-limits" element={<RateLimits />} />
                      <Route path="/cache-policies" element={<CachePolicies />} />
                      <Route path="/audit" element={<AdminRoute><AuditLogs /></AdminRoute>} />
                      <Route path="/config" element={<AdminRoute><Config /></AdminRoute>} />
                      <Route path="/users" element={<AdminRoute><Users /></AdminRoute>} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </ErrorBoundary>
  );
}

