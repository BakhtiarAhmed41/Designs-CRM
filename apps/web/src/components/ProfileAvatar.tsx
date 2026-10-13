import { AvatarImage } from './AvatarImage';
import { useProfilePhoto } from '@/lib/profilePhoto';

/** Avatar for the current account, with initials only when its photo is unavailable. */
export function ProfileAvatar({ userId, name, initials, className }: {
  userId?: string; name: string; initials: string; className: string;
}) {
  const { data } = useProfilePhoto(userId);
  return <AvatarImage url={data?.url} className={className} name={name} initials={initials} />;
}
