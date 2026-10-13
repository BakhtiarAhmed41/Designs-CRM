import { useState } from 'react';
import { resolveFileUrl } from '@/lib/api';

export function AvatarImage({ url, name, initials, className }: {
  url?: string | null; name: string; initials: string; className: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasPhoto = Boolean(url && failedUrl !== url);
  return <span className={`${className}${hasPhoto ? ' avatar-has-photo' : ''}`}>
    {hasPhoto && url ? <img className="profile-avatar-image" src={resolveFileUrl(url)}
      alt={`${name || 'Your'} profile photo`} onError={() => setFailedUrl(url)} /> : <span aria-hidden>{initials}</span>}
  </span>;
}
