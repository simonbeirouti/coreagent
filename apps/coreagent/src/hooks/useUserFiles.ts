import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCachedData, getCachedDataUpdatedAt } from '@/lib/tauri-store';
import { cacheFirstStaticQueryPolicy } from '@/lib/query-policies';
import { userFileKeys } from '@/lib/query-keys';
import supabase from '@/lib/supabase';
import {
  ALLOWED_USER_FILE_EXTENSIONS,
  type AllowedUserFileExtension,
  type UserFileRecord,
  deleteUserFile,
  uploadUserFile,
} from '@/lib/storage';

export { userFileKeys };

const USER_FILES_BUCKET = 'user-files';
const USER_FILES_REFRESH_INTERVAL_MS = 60_000;

function isAllowedExt(ext: string): ext is AllowedUserFileExtension {
  return ALLOWED_USER_FILE_EXTENSIONS.includes(ext as AllowedUserFileExtension);
}

function extFromName(name: string): AllowedUserFileExtension {
  const ext = name.split('.').pop()?.toLowerCase() ?? 'txt';
  return isAllowedExt(ext) ? ext : 'txt';
}

function isBucketPlaceholder(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === '.emptyFolderPlaceholder' || trimmed.endsWith('/.emptyFolderPlaceholder');
}

type BucketFileRow = {
  id?: string | null;
  name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: { size?: number; mimetype?: string } | null;
};

async function listBucketBackedFiles(userId: string, limit?: number): Promise<UserFileRecord[]> {
  const { data, error } = await supabase.storage
    .from(USER_FILES_BUCKET)
    .list(userId, {
      limit: limit ?? 100,
      sortBy: { column: 'name', order: 'desc' },
    });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as BucketFileRow[];
  const nowIso = new Date().toISOString();
  return rows
    .filter((row) => {
      const name = row?.name?.trim();
      if (!name || name.endsWith('/')) return false;
      return !isBucketPlaceholder(name);
    })
    .map((row) => {
      const fileName = row.name as string;
      const storagePath = `${userId}/${fileName}`;
      const fileExt = extFromName(fileName);
      const sizeBytes = Number(row.metadata?.size ?? 0);
      return {
        id: `storage:${storagePath}`,
        user_id: userId,
        storage_path: storagePath,
        file_name: fileName,
        file_ext: fileExt,
        mime_type: row.metadata?.mimetype || 'application/octet-stream',
        size_bytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
        created_at: row.created_at || nowIso,
        updated_at: row.updated_at || row.created_at || nowIso,
      } as UserFileRecord;
    });
}

async function listMergedUserFiles(userId: string, limit?: number): Promise<UserFileRecord[]> {
  const [tableResult, bucketResult] = await Promise.allSettled([
    supabase
      .from('user_files')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit ?? 100),
    listBucketBackedFiles(userId, limit),
  ]);

  const tableRows =
    tableResult.status === 'fulfilled' && !tableResult.value.error
      ? ((tableResult.value.data ?? []) as UserFileRecord[])
      : [];
  const bucketRows = bucketResult.status === 'fulfilled' ? bucketResult.value : [];

  const merged = new Map<string, UserFileRecord>();
  for (const row of bucketRows) {
    merged.set(row.storage_path, row);
  }
  for (const row of tableRows) {
    merged.set(row.storage_path, row);
  }

  const list = Array.from(merged.values()).sort(
    (a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || '')
  );
  return typeof limit === 'number' ? list.slice(0, limit) : list;
}

export function useUserFiles(userId: string) {
  const queryClient = useQueryClient();
  const initialData = getCachedData<UserFileRecord[]>(userFileKeys.list(userId));
  const initialDataUpdatedAt = getCachedDataUpdatedAt(userFileKeys.list(userId));

  const query = useQuery({
    queryKey: userFileKeys.list(userId),
    queryFn: async (): Promise<UserFileRecord[]> => listMergedUserFiles(userId),
    enabled: !!userId,
    initialData,
    initialDataUpdatedAt,
    refetchInterval: USER_FILES_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    ...cacheFirstStaticQueryPolicy,
  });

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`user-files-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_files',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // Keep list/recents in sync with uploads/deletes from any flow.
          queryClient.invalidateQueries({ queryKey: userFileKeys.list(userId) });
          queryClient.invalidateQueries({
            predicate: (q) =>
              Array.isArray(q.queryKey) &&
              q.queryKey[0] === userFileKeys.all[0] &&
              q.queryKey[1] === 'recent' &&
              q.queryKey[2] === userId,
          });
          // `useUserFiles` is cache-first/static; force active refetch so UI updates immediately.
          void queryClient.refetchQueries({
            queryKey: userFileKeys.list(userId),
            type: 'active',
          });
          void queryClient.refetchQueries({
            predicate: (q) =>
              Array.isArray(q.queryKey) &&
              q.queryKey[0] === userFileKeys.all[0] &&
              q.queryKey[1] === 'recent' &&
              q.queryKey[2] === userId,
            type: 'active',
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);

  useEffect(() => {
    if (!userId) return;
    // Cache-first policy can keep stale snapshots forever; force a sync fetch on mount.
    void query.refetch();
  }, [query, userId]);

  return query;
}

export function useRecentUserFiles(userId: string, limit = 5) {
  const initialData = getCachedData<UserFileRecord[]>(userFileKeys.recents(userId, limit));
  const initialDataUpdatedAt = getCachedDataUpdatedAt(userFileKeys.recents(userId, limit));

  const query = useQuery({
    queryKey: userFileKeys.recents(userId, limit),
    queryFn: async (): Promise<UserFileRecord[]> => listMergedUserFiles(userId, limit),
    enabled: !!userId,
    initialData,
    initialDataUpdatedAt,
    refetchInterval: USER_FILES_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    ...cacheFirstStaticQueryPolicy,
  });

  useEffect(() => {
    if (!userId) return;
    void query.refetch();
  }, [query, userId, limit]);

  return query;
}

export function useUploadUserFile(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      return uploadUserFile(file, userId);
    },
    onMutate: async (file) => {
      await queryClient.cancelQueries({ queryKey: userFileKeys.list(userId) });
      await queryClient.cancelQueries({ queryKey: userFileKeys.recents(userId, 5) });

      const previousList = queryClient.getQueryData<UserFileRecord[]>(userFileKeys.list(userId));
      const previousRecent = queryClient.getQueryData<UserFileRecord[]>(
        userFileKeys.recents(userId, 5)
      );

      const nowIso = new Date().toISOString();
      const optimisticRecord: UserFileRecord = {
        id: `temp-${Date.now()}`,
        user_id: userId,
        storage_path: `pending/${file.name}`,
        file_name: file.name,
        file_ext: (file.name.split('.').pop()?.toLowerCase() || 'txt') as UserFileRecord['file_ext'],
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        created_at: nowIso,
        updated_at: nowIso,
      };

      queryClient.setQueryData<UserFileRecord[]>(userFileKeys.list(userId), (old = []) => [
        optimisticRecord,
        ...old,
      ]);

      queryClient.setQueryData<UserFileRecord[]>(userFileKeys.recents(userId, 5), (old = []) => [
        optimisticRecord,
        ...old,
      ].slice(0, 5));

      return { previousList, previousRecent, tempId: optimisticRecord.id };
    },
    onError: (_error, _file, context) => {
      if (!context) return;
      queryClient.setQueryData(userFileKeys.list(userId), context.previousList ?? []);
      queryClient.setQueryData(userFileKeys.recents(userId, 5), context.previousRecent ?? []);
    },
    onSuccess: ({ record }, _file, context) => {
      queryClient.setQueryData<UserFileRecord[]>(userFileKeys.list(userId), (old = []) =>
        old.map((entry) => (entry.id === context?.tempId ? record : entry))
      );
      queryClient.setQueryData<UserFileRecord[]>(userFileKeys.recents(userId, 5), (old = []) =>
        old.map((entry) => (entry.id === context?.tempId ? record : entry))
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userFileKeys.list(userId) });
      queryClient.invalidateQueries({ queryKey: userFileKeys.recents(userId, 5) });
    },
  });
}

export function useDeleteUserFile(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (record: UserFileRecord) => {
      await deleteUserFile(record);
      return record;
    },
    onMutate: async (record) => {
      await queryClient.cancelQueries({ queryKey: userFileKeys.list(userId) });
      await queryClient.cancelQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === userFileKeys.all[0] &&
          q.queryKey[1] === 'recent' &&
          q.queryKey[2] === userId,
      });

      const previousList = queryClient.getQueryData<UserFileRecord[]>(userFileKeys.list(userId));
      const previousRecents = queryClient.getQueriesData<UserFileRecord[]>({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === userFileKeys.all[0] &&
          q.queryKey[1] === 'recent' &&
          q.queryKey[2] === userId,
      });

      const shouldKeep = (entry: UserFileRecord) =>
        entry.id !== record.id && entry.storage_path !== record.storage_path;

      queryClient.setQueryData<UserFileRecord[]>(userFileKeys.list(userId), (old = []) =>
        old.filter(shouldKeep)
      );
      queryClient.setQueriesData<UserFileRecord[]>(
        {
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            q.queryKey[0] === userFileKeys.all[0] &&
            q.queryKey[1] === 'recent' &&
            q.queryKey[2] === userId,
        },
        (old = []) => old.filter(shouldKeep)
      );

      return { previousList, previousRecents };
    },
    onError: (_error, _record, context) => {
      if (!context) return;
      queryClient.setQueryData(userFileKeys.list(userId), context.previousList ?? []);
      for (const [queryKey, data] of context.previousRecents ?? []) {
        queryClient.setQueryData(queryKey, data ?? []);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userFileKeys.list(userId) });
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === userFileKeys.all[0] &&
          q.queryKey[1] === 'recent' &&
          q.queryKey[2] === userId,
      });
      void queryClient.refetchQueries({ queryKey: userFileKeys.list(userId), type: 'active' });
      void queryClient.refetchQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === userFileKeys.all[0] &&
          q.queryKey[1] === 'recent' &&
          q.queryKey[2] === userId,
        type: 'active',
      });
    },
  });
}
