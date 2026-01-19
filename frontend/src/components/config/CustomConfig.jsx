import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { configApi } from '../../lib/api';
import { Settings, Plus, Trash2, Save, Loader2, Eye, EyeOff, Search, X } from 'lucide-react';

export default function CustomConfig() {
  const [newConfig, setNewConfig] = useState({ key: '', value: '', isSecret: false });
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [showSecrets, setShowSecrets] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: () => configApi.list().then((r) => r.data),
  });

  const setMutation = useMutation({
    mutationFn: ({ key, value, isSecret }) => configApi.set(key, value, isSecret),
    onSuccess: () => {
      queryClient.invalidateQueries(['config']);
      setNewConfig({ key: '', value: '', isSecret: false });
    },
    onError: (error) => {
      alert(`Failed to save configuration: ${error.response?.data?.message || error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key) => configApi.delete(key),
    onSuccess: () => {
      queryClient.invalidateQueries(['config']);
    },
    onError: (error) => {
      alert(`Failed to delete configuration: ${error.response?.data?.message || error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value, isSecret }) => configApi.set(key, value, isSecret),
    onSuccess: () => {
      queryClient.invalidateQueries(['config']);
      setEditingKey(null);
      setEditValue('');
    },
    onError: (error) => {
      alert(`Failed to update configuration: ${error.response?.data?.message || error.message}`);
    },
  });

  const handleCreate = () => {
    if (!newConfig.key.trim()) {
      alert('Configuration key is required');
      return;
    }
    setMutation.mutate(newConfig);
  };

  const handleUpdate = (key, isSecret) => {
    if (!editValue.trim()) {
      alert('Configuration value is required');
      return;
    }
    updateMutation.mutate({ key, value: editValue, isSecret });
  };

  const handleDelete = (key) => {
    if (confirm(`Are you sure you want to delete configuration "${key}"?`)) {
      deleteMutation.mutate(key);
    }
  };

  const filteredConfigs = data?.configs?.filter((config) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      config.config_key.toLowerCase().includes(query) ||
      (config.config_value && String(config.config_value).toLowerCase().includes(query))
    );
  }) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <Settings className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Custom Configuration</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Manage custom key-value configuration settings
          </p>
        </div>
      </div>

      {/* Add New Config */}
      <div className="p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-[var(--color-border)]">
        <h3 className="font-medium text-[var(--color-text)] mb-4">Add New Configuration</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Key</label>
            <input
              type="text"
              value={newConfig.key}
              onChange={(e) => setNewConfig({ ...newConfig, key: e.target.value })}
              className="input"
              placeholder="config_key"
            />
          </div>
          <div>
            <label className="label">Value</label>
            <input
              type={newConfig.isSecret ? 'password' : 'text'}
              value={newConfig.value}
              onChange={(e) => setNewConfig({ ...newConfig, value: e.target.value })}
              className="input"
              placeholder="config_value"
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newConfig.isSecret}
                  onChange={(e) => setNewConfig({ ...newConfig, isSecret: e.target.checked })}
                  className="w-4 h-4 rounded border-[var(--color-border)] text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-[var(--color-text)]">Secret</span>
              </label>
            </div>
            <button
              onClick={handleCreate}
              disabled={setMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {setMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
        <input
          type="text"
          placeholder="Search configurations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input pl-10"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Config List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 skeleton rounded-lg" />
          ))}
        </div>
      ) : filteredConfigs.length > 0 ? (
        <div className="space-y-3">
          {filteredConfigs.map((config) => {
            const isEditing = editingKey === config.config_key;
            const isSecret = config.is_secret;
            const showSecret = showSecrets[config.config_key];

            return (
              <div
                key={config.config_key}
                className="p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-[var(--color-border)]"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <code className="text-sm font-mono text-primary-500">{config.config_key}</code>
                      {isSecret && (
                        <span className="badge badge-warning text-xs">Secret</span>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type={isSecret && !showSecret ? 'password' : 'text'}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="input flex-1"
                          autoFocus
                        />
                        {isSecret && (
                          <button
                            onClick={() => setShowSecrets({ ...showSecrets, [config.config_key]: !showSecret })}
                            className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded"
                          >
                            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                        <button
                          onClick={() => handleUpdate(config.config_key, isSecret)}
                          disabled={updateMutation.isPending}
                          className="btn-primary flex items-center gap-2"
                        >
                          {updateMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setEditingKey(null);
                            setEditValue('');
                          }}
                          className="btn-secondary p-2"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono text-[var(--color-text-muted)] break-all">
                          {isSecret ? (showSecret ? config.config_value : '••••••••') : config.config_value}
                        </code>
                        {isSecret && (
                          <button
                            onClick={() => setShowSecrets({ ...showSecrets, [config.config_key]: !showSecret })}
                            className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded"
                          >
                            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setEditingKey(config.config_key);
                          setEditValue(config.config_value || '');
                        }}
                        className="btn-secondary p-2"
                        title="Edit"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(config.config_key)}
                        disabled={deleteMutation.isPending}
                        className="btn-danger p-2"
                        title="Delete"
                      >
                        {deleteMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center p-12 text-[var(--color-text-muted)]">
          {searchQuery ? 'No configurations match your search' : 'No custom configurations yet'}
        </div>
      )}
    </div>
  );
}
