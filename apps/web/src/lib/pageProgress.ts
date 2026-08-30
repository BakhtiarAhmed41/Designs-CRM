declare global {
  interface Window {
    __lvdStart?: () => void;
    __lvdReady?: () => void;
  }
}

export function startPageProgress() {
  window.__lvdStart?.();
}

export function finishPageProgress() {
  window.__lvdReady?.();
}
