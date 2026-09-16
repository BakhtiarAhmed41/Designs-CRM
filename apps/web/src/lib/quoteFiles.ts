export type QuoteFormFile = File | { file: File; designIndex?: number };

declare global {
  interface Window {
    LVD_GET_FILES?: () => QuoteFormFile[];
    LVD_RESET_SUBMIT?: () => void;
  }
}

export function filesFromQuoteForm(raw: QuoteFormFile[] | File[] | undefined | null): File[] {
  if (!raw?.length) return [];
  return raw
    .map((item) => (item instanceof File ? item : item?.file))
    .filter((file): file is File => file instanceof File);
}
