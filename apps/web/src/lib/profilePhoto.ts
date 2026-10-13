import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export type ProfilePhoto = { url: string | null };
export const profilePhotoKey = (userId?: string) => ['profile-photo', userId];

/** All avatars for the signed-in account share the same photo and mutation cache. */
export function useProfilePhoto(userId?: string) {
  return useQuery({
    queryKey: profilePhotoKey(userId),
    queryFn: () => apiFetch<ProfilePhoto>('/users/me/photo'),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
}
