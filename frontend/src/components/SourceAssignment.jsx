import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sourcesApi, storagePoolsApi } from '../lib/api';
import { Loader2, Plus, X, Users } from 'lucide-react';

export default function SourceAssignment({ poolId, appId, isDedicated = false }) {
  const [showModal, setShowModal] = useState(false);
  const queryClient = useQueryClient();

  const { data: poolSources } = useQuery({
    queryKey: ['pool-sources', poolId],
    queryFn: () => storagePoolsApi.getSources(poolId).then((r) => r.data),
    enabled: !!poolId && !isDedicated,
  });

  const { data: allSources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.list().then((r) => r.data),
  });

  const assignMutation = useMutation({
    mutationFn: ({ sourceId, poolId: pId }) => {
      if (isDedicated) {
        // Switch to dedicated mode
        return sourcesApi.update(sourceId, { storage_mode: 'dedicated', storage_pool_id: null });
      } else {
        // Assign to pool
        return sourcesApi.update(sourceId, { storage_mode: 'shared', storage_pool_id: pId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['pool-sources', poolId]);
      queryClient.invalidateQueries(['sources']);
      queryClient.invalidateQueries(['storage-pools']);
      setShowModal(false);
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (sourceId) => {
      return sourcesApi.update(sourceId, { storage_mode: 'dedicated', storage_pool_id: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['pool-sources', poolId]);
      queryClient.invalidateQueries(['sources']);
      queryClient.invalidateQueries(['storage-pools']);
    },
  });

  const assignedSourceIds = new Set((poolSources?.sources || []).map(s => s.id));
  const availableSources = (allSources?.sources || []).filter(s => !assignedSourceIds.has(s.id));

  return (
    <>
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-[var(--color-text)] flex items-center gap-2">
            <Users className="w-5 h-5" />
            Assigned Sources
          </h2>
          {!isDedicated && (
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Plus className="w-4 h-4" />
              Assign Source
            </button>
          )}
        </div>

        {poolSources?.sources && poolSources.sources.length > 0 ? (
          <div className="space-y-2">
            {poolSources.sources.map((source) => (
              <div
                key={source.id}
                className="flex items-center justify-between p-3 bg-surface-50 dark:bg-surface-800 rounded-lg"
              >
                <div>
                  <p className="font-medium text-[var(--color-text)]">{source.name}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">{source.base_url}</p>
                </div>
                {!isDedicated && (
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${source.name} from this pool?`)) {
                        unassignMutation.mutate(source.id);
                      }
                    }}
                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    disabled={unassignMutation.isPending}
                  >
                    {unassignMutation.isPending ? (
                      <Loader2 className="w-4 h-4 text-red-500 animate-spin" />
                    ) : (
                      <X className="w-4 h-4 text-red-500" />
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center p-8 text-[var(--color-text-muted)]">
            {isDedicated ? 'No sources using dedicated mode' : 'No sources assigned to this pool'}
          </div>
        )}
      </div>

      {/* Assign Source Modal */}
      {showModal && !isDedicated && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg max-h-[90vh] overflow-auto animate-slide-up">
            <div className="p-6 border-b border-[var(--color-border)]">
              <h2 className="text-xl font-bold text-[var(--color-text)]">Assign Source to Pool</h2>
            </div>

            <div className="p-6 space-y-3">
              {availableSources.length > 0 ? (
                availableSources.map((source) => (
                  <button
                    key={source.id}
                    onClick={() => assignMutation.mutate({ sourceId: source.id, poolId })}
                    disabled={assignMutation.isPending}
                    className="w-full text-left p-3 bg-surface-50 dark:bg-surface-800 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                  >
                    <p className="font-medium text-[var(--color-text)]">{source.name}</p>
                    <p className="text-sm text-[var(--color-text-muted)]">{source.base_url}</p>
                  </button>
                ))
              ) : (
                <p className="text-[var(--color-text-muted)] text-center py-4">
                  All sources are already assigned
                </p>
              )}
            </div>

            <div className="p-6 border-t border-[var(--color-border)] flex justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

