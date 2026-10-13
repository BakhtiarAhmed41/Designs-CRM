import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { ProfilePhoto } from '@/lib/profilePhoto';
import { AvatarImage } from './AvatarImage';

export function CustomerAvatar({ customerId, ...props }: {
  customerId?: string | null; name: string; initials: string; className: string;
}) {
  const { data } = useQuery({
    queryKey: ['customer-photo', customerId],
    queryFn: () => apiFetch<ProfilePhoto>(`/admin/customers/${encodeURIComponent(customerId!)}/photo`),
    enabled: Boolean(customerId && customerId !== 'unknown'),
    staleTime: 60_000,
    retry: false,
  });
  return <AvatarImage {...props} url={data?.url} />;
}
