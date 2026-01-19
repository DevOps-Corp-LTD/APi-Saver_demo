import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { oidcApi } from '../../lib/api';
import { Globe, Save, Loader2, Eye, EyeOff, TestTube2, Trash2, AlertTriangle } from 'lucide-react';

export default function SSOConfig() {
  const [showOidcSecret, setShowOidcSecret] = useState(false);
  const [oidcFormData, setOidcFormData] = useState({
    issuer: '',
    client_id: '',
    client_secret: '',
    redirect_uri: '',
    scopes: 'openid profile email',
    role_claim: 'role',
    admin_role_value: 'admin',
    is_enabled: true,
  });
  const queryClient = useQueryClient();

  const { data: oidcConfig, isLoading: oidcLoading } = useQuery({
    queryKey: ['oidc-config'],
    queryFn: () => oidcApi.getConfig().then((r) => r.data),
  });

  const oidcSetMutation = useMutation({
    mutationFn: (data) => oidcApi.setConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['oidc-config']);
    },
    onError: (error) => {
      alert(`Failed to save OIDC configuration: ${error.response?.data?.message || error.message}`);
    },
  });

  const oidcTestMutation = useMutation({
    mutationFn: (data) => oidcApi.testConfig(data),
  });

  const oidcDeleteMutation = useMutation({
    mutationFn: () => oidcApi.deleteConfig(),
    onSuccess: () => {
      queryClient.invalidateQueries(['oidc-config']);
      setOidcFormData({
        issuer: '',
        client_id: '',
        client_secret: '',
        redirect_uri: '',
        scopes: 'openid profile email',
        role_claim: 'role',
        admin_role_value: 'admin',
        is_enabled: true,
      });
    },
    onError: (error) => {
      alert(`Failed to delete OIDC configuration: ${error.response?.data?.message || error.message}`);
    },
  });

  // Initialize form data from config
  useEffect(() => {
    if (oidcConfig) {
      setOidcFormData({
        issuer: oidcConfig.issuer || '',
        client_id: oidcConfig.client_id || '',
        client_secret: '', // Don't populate secret
        redirect_uri: oidcConfig.redirect_uri || '',
        scopes: oidcConfig.scopes || 'openid profile email',
        role_claim: oidcConfig.role_claim || 'role',
        admin_role_value: oidcConfig.admin_role_value || 'admin',
        is_enabled: oidcConfig.is_enabled ?? true,
      });
    }
  }, [oidcConfig]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
          <Globe className="w-5 h-5 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">SSO / OIDC Configuration</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Configure OpenID Connect (OIDC) for single sign-on authentication
          </p>
        </div>
      </div>

      {oidcLoading ? (
        <div className="space-y-4">
          <div className="h-64 skeleton rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="p-6 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-[var(--color-border)] space-y-4">
            {/* Test Connection */}
            {oidcFormData.issuer && oidcFormData.client_id && (
              <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <button
                  onClick={() => {
                    const testData = { ...oidcFormData };
                    if (!testData.client_secret && oidcConfig) {
                      delete testData.client_secret;
                    }
                    oidcTestMutation.mutate(testData);
                  }}
                  disabled={oidcTestMutation.isPending}
                  className="btn-secondary flex items-center gap-2"
                >
                  {oidcTestMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <TestTube2 className="w-4 h-4" />
                  )}
                  <span>Test Connection</span>
                </button>
                {oidcTestMutation.isSuccess && (
                  <div className="mt-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                      ✓ Connection successful
                    </p>
                    {oidcTestMutation.data?.data?.issuer && (
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        Issuer: {oidcTestMutation.data.data.issuer}
                      </p>
                    )}
                  </div>
                )}
                {oidcTestMutation.isError && (
                  <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                      ✗ Connection failed
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      {oidcTestMutation.error?.response?.data?.message || oidcTestMutation.error?.message || 'Unknown error'}
                    </p>
                    {oidcTestMutation.error?.response?.data?.details && (
                      <details className="mt-2">
                        <summary className="text-xs text-red-600 dark:text-red-400 cursor-pointer">
                          Show details
                        </summary>
                        <pre className="text-xs mt-1 p-2 bg-red-100 dark:bg-red-900/30 rounded overflow-auto">
                          {JSON.stringify(oidcTestMutation.error.response.data.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="label">Issuer URL *</label>
              <input
                type="url"
                value={oidcFormData.issuer}
                onChange={(e) => setOidcFormData({ ...oidcFormData, issuer: e.target.value })}
                className="input"
                placeholder="https://accounts.example.com"
                required
              />
            </div>

            <div>
              <label className="label">Client ID *</label>
              <input
                type="text"
                value={oidcFormData.client_id}
                onChange={(e) => setOidcFormData({ ...oidcFormData, client_id: e.target.value })}
                className="input"
                placeholder="apisaver-client"
                required
              />
            </div>

            <div>
              <label className="label">Client Secret *</label>
              <div className="relative">
                <input
                  type={showOidcSecret ? 'text' : 'password'}
                  value={oidcFormData.client_secret}
                  onChange={(e) => setOidcFormData({ ...oidcFormData, client_secret: e.target.value })}
                  className="input input-secret pr-10"
                  placeholder={oidcConfig ? 'Leave blank to keep current' : 'Enter client secret'}
                  required={!oidcConfig}
                />
                <button
                  type="button"
                  onClick={() => setShowOidcSecret(!showOidcSecret)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  {showOidcSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {oidcConfig && (
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Leave blank to keep the current secret
                </p>
              )}
            </div>

            <div>
              <label className="label">Redirect URI *</label>
              <input
                type="url"
                value={oidcFormData.redirect_uri}
                onChange={(e) => setOidcFormData({ ...oidcFormData, redirect_uri: e.target.value })}
                className="input"
                placeholder="https://apisaver.example.com/auth/callback"
                required
              />
            </div>

            <div>
              <label className="label">Scopes</label>
              <input
                type="text"
                value={oidcFormData.scopes}
                onChange={(e) => setOidcFormData({ ...oidcFormData, scopes: e.target.value })}
                className="input"
                placeholder="openid profile email"
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Space-separated list of OIDC scopes
              </p>
            </div>

            <div>
              <label className="label">Role Claim</label>
              <input
                type="text"
                value={oidcFormData.role_claim}
                onChange={(e) => setOidcFormData({ ...oidcFormData, role_claim: e.target.value })}
                className="input"
                placeholder="role"
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                JWT claim name that contains the user role
              </p>
            </div>

            <div>
              <label className="label">Admin Role Value</label>
              <input
                type="text"
                value={oidcFormData.admin_role_value}
                onChange={(e) => setOidcFormData({ ...oidcFormData, admin_role_value: e.target.value })}
                className="input"
                placeholder="admin"
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Users with this role get admin access
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="oidc-enabled"
                checked={oidcFormData.is_enabled}
                onChange={(e) => setOidcFormData({ ...oidcFormData, is_enabled: e.target.checked })}
                className="w-4 h-4 rounded border-[var(--color-border)] text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="oidc-enabled" className="text-sm text-[var(--color-text)]">
                Enable SSO login
              </label>
            </div>

            <div className="flex items-center gap-3 pt-4 border-t border-[var(--color-border)]">
              <button
                onClick={() => {
                  // Validate required fields
                  if (!oidcFormData.issuer?.trim()) {
                    alert('Issuer URL is required');
                    return;
                  }
                  if (!oidcFormData.client_id?.trim()) {
                    alert('Client ID is required');
                    return;
                  }
                  if (!oidcFormData.redirect_uri?.trim()) {
                    alert('Redirect URI is required');
                    return;
                  }
                  
                  // Validate URLs
                  try {
                    new URL(oidcFormData.issuer);
                    new URL(oidcFormData.redirect_uri);
                  } catch (err) {
                    alert('Invalid URL format. Please check Issuer and Redirect URI.');
                    return;
                  }
                  
                  // Only require client_secret for new configs or if user wants to update it
                  const configToSave = { ...oidcFormData };
                  // If editing existing config and secret is empty, don't send it
                  if (oidcConfig && !configToSave.client_secret) {
                    delete configToSave.client_secret;
                  }
                  oidcSetMutation.mutate(configToSave);
                }}
                disabled={oidcSetMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {oidcSetMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Save Configuration</span>
              </button>

              {oidcConfig && (
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to delete the OIDC configuration? SSO login will be disabled.')) {
                      oidcDeleteMutation.mutate();
                    }
                  }}
                  disabled={oidcDeleteMutation.isPending}
                  className="btn-danger flex items-center gap-2"
                >
                  {oidcDeleteMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  <span>Delete Configuration</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
