import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import SecurityConfig from '../components/config/SecurityConfig';
import CacheConfig from '../components/config/CacheConfig';
import SSOConfig from '../components/config/SSOConfig';
import CustomConfig from '../components/config/CustomConfig';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function Config() {
  const [collapsedSections, setCollapsedSections] = useState({
    security: false,
    cache: false,
    sso: false,
    custom: false,
  });
  const { isAdmin } = useAuth();

  const toggleSection = (section) => {
    setCollapsedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--color-text)]">Configuration</h1>
        <p className="text-[var(--color-text-muted)] mt-1">
          Manage your application settings
        </p>
      </div>

      {/* Security Section */}
      {isAdmin && (
        <div className="card p-0 overflow-hidden">
          <button
            onClick={() => toggleSection('security')}
            className="w-full p-6 flex items-center justify-between hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors"
          >
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Security</h2>
            {collapsedSections.security ? (
              <ChevronUp className="w-5 h-5 text-[var(--color-text-muted)]" />
            ) : (
              <ChevronDown className="w-5 h-5 text-[var(--color-text-muted)]" />
            )}
          </button>
          {!collapsedSections.security && (
            <div className="px-6 pb-6">
              <SecurityConfig />
            </div>
          )}
        </div>
      )}

      {/* Cache Settings Section */}
      {isAdmin && (
        <div className="card p-0 overflow-hidden">
          <button
            onClick={() => toggleSection('cache')}
            className="w-full p-6 flex items-center justify-between hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors"
          >
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Cache Settings</h2>
            {collapsedSections.cache ? (
              <ChevronUp className="w-5 h-5 text-[var(--color-text-muted)]" />
            ) : (
              <ChevronDown className="w-5 h-5 text-[var(--color-text-muted)]" />
            )}
          </button>
          {!collapsedSections.cache && (
            <div className="px-6 pb-6">
              <CacheConfig />
            </div>
          )}
        </div>
      )}

      {/* SSO/OIDC Configuration Section */}
      {isAdmin && (
        <div className="card p-0 overflow-hidden">
          <button
            onClick={() => toggleSection('sso')}
            className="w-full p-6 flex items-center justify-between hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors"
          >
            <h2 className="text-lg font-semibold text-[var(--color-text)]">SSO Configuration</h2>
            {collapsedSections.sso ? (
              <ChevronUp className="w-5 h-5 text-[var(--color-text-muted)]" />
            ) : (
              <ChevronDown className="w-5 h-5 text-[var(--color-text-muted)]" />
            )}
          </button>
          {!collapsedSections.sso && (
            <div className="px-6 pb-6">
              <SSOConfig />
            </div>
          )}
        </div>
      )}

      {/* Custom Settings Section */}
      <div className="card p-0 overflow-hidden">
        <button
          onClick={() => toggleSection('custom')}
          className="w-full p-6 flex items-center justify-between hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors"
        >
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Custom Settings</h2>
          {collapsedSections.custom ? (
            <ChevronUp className="w-5 h-5 text-[var(--color-text-muted)]" />
          ) : (
            <ChevronDown className="w-5 h-5 text-[var(--color-text-muted)]" />
          )}
        </button>
        {!collapsedSections.custom && (
          <div className="px-6 pb-6">
            <CustomConfig />
          </div>
        )}
      </div>
    </div>
  );
}
