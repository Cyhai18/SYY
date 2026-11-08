import { useCallback, useEffect, useRef } from 'react';

/** One active OCR request per step; cancel its fetch on replacement or unmount. */
export function useOcrRequest() {
  const active = useRef<AbortController | null>(null);
  const cancelRequest = useCallback(() => {
    active.current?.abort();
    active.current = null;
  }, []);
  useEffect(() => cancelRequest, [cancelRequest]);

  const beginRequest = useCallback(() => {
    cancelRequest();
    const controller = new AbortController();
    active.current = controller;
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    return {
      signal: controller.signal,
      isCurrent,
      finish: () => {
        if (active.current === controller) active.current = null;
      },
    };
  }, [cancelRequest]);

  return { beginRequest, cancelRequest };
}
