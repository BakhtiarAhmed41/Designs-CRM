/** Poll only while the browser tab is visible. */
export function whenVisible(ms: number) {
  return () =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden'
      ? false
      : ms;
}

/** Always refetch when the user opens this screen, even if the cache is still “fresh”. */
export const freshOnOpen = {
  refetchOnMount: 'always' as const,
};
