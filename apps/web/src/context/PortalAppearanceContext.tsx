import { createContext, useContext } from 'react';
import type { PortalLook } from '@/lib/customers';

export const PortalAppearanceContext = createContext<(look: PortalLook | null) => void>(() => {});

export function usePortalAppearancePreview() {
  return useContext(PortalAppearanceContext);
}
