import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { getCachedData, getCachedDataUpdatedAt } from '../lib/tauri-store';
import type { UserProfile, UpdateUserProfileRequest } from '../types/user-profile';
import { userProfileKeys } from '@/lib/query-keys';
import { cacheFirstStaticQueryPolicy } from '@/lib/query-policies';

export { userProfileKeys };

// Fetch user profile
export function useUserProfile(userId: string) {
  const initialData = getCachedData<UserProfile>(userProfileKeys.profile(userId));
  const initialDataUpdatedAt = getCachedDataUpdatedAt(userProfileKeys.profile(userId));

  return useQuery({
    queryKey: userProfileKeys.profile(userId),
    queryFn: async (): Promise<UserProfile> => {
      return await invoke('get_user_profile', { userId });
    },
    enabled: !!userId,
    ...cacheFirstStaticQueryPolicy,
    initialData,
    initialDataUpdatedAt,
  });
}

// Update user profile
export function useUpdateUserProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      updates,
    }: {
      userId: string;
      updates: UpdateUserProfileRequest;
    }): Promise<UserProfile> => {
      return await invoke('update_user_profile', { userId, updates });
    },
    onMutate: async ({ userId, updates }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: userProfileKeys.profile(userId) });

      // Snapshot previous data
      const previousProfile = queryClient.getQueryData<UserProfile>(
        userProfileKeys.profile(userId)
      );

      // Optimistically update
      if (previousProfile) {
        queryClient.setQueryData<UserProfile>(
          userProfileKeys.profile(userId),
          {
            ...previousProfile,
            ...updates,
            // Merge JSONB fields properly
            preferences: updates.preferences
              ? { ...previousProfile.preferences, ...updates.preferences }
              : previousProfile.preferences,
            habits: updates.habits
              ? { ...previousProfile.habits, ...updates.habits }
              : previousProfile.habits,
            work_patterns: updates.work_patterns
              ? { ...previousProfile.work_patterns, ...updates.work_patterns }
              : previousProfile.work_patterns,
            updated_at: new Date().toISOString(),
          }
        );
      }

      return { previousProfile, userId };
    },
    onError: (err, _variables, context) => {
      console.error('Failed to update user profile:', err);

      // Rollback on error
      if (context?.previousProfile) {
        queryClient.setQueryData(
          userProfileKeys.profile(context.userId),
          context.previousProfile
        );
      }
    },
    onSettled: (_data, _error, variables) => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({
        queryKey: userProfileKeys.profile(variables.userId)
      });
    },
  });
}