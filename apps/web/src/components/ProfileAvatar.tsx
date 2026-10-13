import { useState } from 'react';
import { resolveFileUrl } from '@/lib/api';
import { useProfilePhoto } from '@/lib/profilePhoto';

/** Avatar for the current account, with initials only when its photo is unavailable. */
export function ProfileAvatar({ userId, name, initials, className }: {
  userId?: string; name: string; initials: string; className: string;
}) {
  const { data } = useProfilePhoto(userId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = data?.url;
  return <span className={className}>
    {url && failedUrl !== url ? <img className="profile-avatar-image" src={resolveFileUrl(url)}
      alt={`${name || 'Your'} profile photo`} onError={() => setFailedUrl(url)} /> : <span aria-hidden>{initials}</span>}
  </span>;
}
