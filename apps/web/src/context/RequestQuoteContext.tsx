import { createContext, useContext } from 'react';

export type RequestQuoteApi = {
  openRequestQuote: (service?: string | null) => void;
};

export const RequestQuoteContext = createContext<RequestQuoteApi>({
  openRequestQuote: () => {},
});

export function useRequestQuote() {
  return useContext(RequestQuoteContext);
}
