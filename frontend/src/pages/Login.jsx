import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Eye, EyeOff, Sun, Moon, ArrowRight, AlertCircle, Key, User, Globe } from 'lucide-react';
import { oidcApi } from '../lib/api';

export default function Login() {
  const [loginMethod, setLoginMethod] = useState('apikey'); // 'apikey' or 'password'
  const [apiKey, setApiKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [oidcLoginUrl, setOidcLoginUrl] = useState(null);
  const { login, loginWithPassword } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Handle OIDC callback token
  useEffect(() => {
    const token = searchParams.get('token');
    const role = searchParams.get('role');
    
    if (token) {
      // Store token and redirect to dashboard
      localStorage.setItem('token', token);
      navigate('/');
    }
  }, [searchParams, navigate]);

  // Check OIDC availability when API key changes (only for API key login)
  useEffect(() => {
    if (loginMethod !== 'apikey') {
      setOidcEnabled(false);
      setOidcLoginUrl(null);
      return;
    }
    
    const checkOidc = async () => {
      if (apiKey.length > 10) {
        try {
          const response = await oidcApi.getLoginUrl(apiKey);
          setOidcEnabled(response.data.enabled);
          setOidcLoginUrl(response.data.login_url);
        } catch {
          setOidcEnabled(false);
          setOidcLoginUrl(null);
        }
      } else {
        setOidcEnabled(false);
        setOidcLoginUrl(null);
      }
    };
    
    const debounce = setTimeout(checkOidc, 500);
    return () => clearTimeout(debounce);
  }, [apiKey, loginMethod]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (loginMethod === 'apikey') {
        if (!apiKey.trim()) {
          setError('Please enter your API key');
          setLoading(false);
          return;
        }
        await login(apiKey);
      } else {
        if (!email.trim() || !password.trim()) {
          setError('Please enter your email and password');
          setLoading(false);
          return;
        }
        // Password login without API key - backend will find user by email
        await loginWithPassword(null, email, password);
      }
      navigate('/');
    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || 'Login failed';
      setError(errorMessage);
      
      // Show more helpful error messages
      if (err.response?.status === 401) {
        setError('Invalid credentials. Please check your API key, email, or password.');
      } else if (err.response?.status === 429) {
        setError('Too many login attempts. Please try again later.');
      } else if (err.response?.status >= 500) {
        setError('Server error. Please try again later.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-accent-500/10 rounded-full blur-3xl" />
        <div className="absolute inset-0 bg-grid-pattern bg-[size:60px_60px] opacity-30" />
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-6 right-6 p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
      >
        {theme === 'dark' ? (
          <Moon className="w-5 h-5 text-primary-400" />
        ) : (
          <Sun className="w-5 h-5 text-amber-500" />
        )}
      </button>

      {/* Login card */}
      <div className="w-full max-w-md relative z-10 animate-fade-in">
        <div className="card p-8 backdrop-blur-xl bg-[var(--color-surface)]/80">
          {/* Logo and title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-24 h-24 mb-4">
              <img src="/favicon-96x96.png" alt="APi-Saver" className="w-full h-full rounded-2xl shadow-xl" />
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">APi-Saver</h1>
            <p className="text-purple-500 dark:text-purple-400 mt-1">Enterprise API Cache & Storage</p>
            <p className="text-xs text-primary-500 font-medium mt-2">by DevOps-Corp</p>
          </div>

          {/* Login method tabs */}
          <div className="flex mb-6 p-1 bg-surface-100 dark:bg-surface-800 rounded-lg">
            <button
              type="button"
              onClick={() => setLoginMethod('apikey')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                loginMethod === 'apikey'
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              <Key className="w-4 h-4" />
              API Key
            </button>
            <button
              type="button"
              onClick={() => setLoginMethod('password')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                loginMethod === 'password'
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              <User className="w-4 h-4" />
              User Login
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* API Key field - only for API key login */}
            {loginMethod === 'apikey' && (
              <div>
                <label htmlFor="apiKey" className="label">
                  API Key
                </label>
                <div className="relative">
                  <input
                    id="apiKey"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="ask_xxxxxxxxxxxxxxxxxxxx"
                    className="input input-secret pr-10"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                  >
                    {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Email and Password fields - only for user login */}
            {loginMethod === 'password' && (
              <>
                <div>
                  <label htmlFor="email" className="label">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="input"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="label">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="input pr-10"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-500 text-sm animate-slide-up">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed mt-6"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          {/* OIDC SSO button */}
          {oidcEnabled && oidcLoginUrl && (
            <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
              <a
                href={oidcLoginUrl}
                className="btn-secondary w-full flex items-center justify-center gap-2 py-3 text-base"
              >
                <Globe className="w-5 h-5" />
                <span>Sign in with SSO</span>
              </a>
            </div>
          )}

          {/* Help text */}
          <p className="text-center text-sm text-[var(--color-text-muted)] mt-6">
            {loginMethod === 'apikey' 
              ? 'API key login grants admin access.'
              : oidcEnabled 
                ? 'Use SSO for enterprise authentication.'
                : 'User accounts have role-based permissions.'}
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-[var(--color-text-muted)] mt-6">
          © {new Date().getFullYear()} DevOps-Corp. All rights reserved.
        </p>
      </div>
    </div>
  );
}

