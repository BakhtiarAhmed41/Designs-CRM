export type QuoteFormFile = File | { file: File; designIndex?: number };

declare global {
  interface Window {
    LVD_GET_FILES?: () => QuoteFormFile[];
    LVD_RESET_SUBMIT?: () => void;
  }
}

/** File objects from an iframe fail `instanceof File` in the parent window. */
function isFileLike(value: unknown): value is File {
  if (!value || typeof value !== 'object') return false;
  const file = value as File;
  return (
    typeof file.name === 'string' &&
    typeof file.size === 'number' &&
    typeof file.slice === 'function'
  );
}

export function filesFromQuoteForm(raw: QuoteFormFile[] | File[] | undefined | null): File[] {
  if (!raw?.length) return [];
  return raw
    .map((item) => {
      if (isFileLike(item)) return item;
      if (item && typeof item === 'object' && isFileLike((item as { file?: unknown }).file)) {
        return (item as { file: File }).file;
      }
      return null;
    })
    .filter((file): file is File => file !== null);
}
